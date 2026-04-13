"""
app/api/endpoints/verify.py
════════════════════════════════════════════════════════════════════════════════
POST /verify — submit a new verification job.

Full request-to-result flow
────────────────────────────
  HTTP layer (sync, returns immediately)
  1.  Extract client IP from request
  2.  Rate-limit check  (10 calls / min per IP  — RateLimiter)
  3.  Pydantic validates the request body     — raises 422 on bad input
  4.  JobStore.create()  → new PENDING job
  5.  Register _run_verification as a BackgroundTask
  6.  Return 202 Accepted  { job_id, status: PENDING, message }

  Background layer (async, after HTTP response is sent)
  7.  JobStore.mark_running()            → status = RUNNING
  8a. [ipfs_cid]  download_from_ipfs()   → local .zip file
  8b. [github_url / local_path]          → pass URL/path directly
  9.  asyncio event-loop offload:
        loop.run_in_executor(None, verifier.verify, ...)
      CodeVerifier.verify() is CPU-bound (subprocess calls) — running it
      inside run_in_executor keeps the event loop free for other requests.
  10. JobStore.mark_completed()          → status = COMPLETED + full results
      OR
      JobStore.mark_failed()             → status = FAILED  + error_code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  REAL (wired, does actual work)
  ✅ Rate limiter          — app/core/rate_limiter.py
  ✅ Input validation      — app/models/schemas.py  (Pydantic)
  ✅ JobStore CRUD         — app/core/job_store.py
  ✅ CodeVerifier          — app/services/code_verifier.py
                             runs pytest + pylint + flake8 via subprocess
  ✅ IPFS download         — app/services/ipfs_client.py
                             real httpx GET to Pinata gateway
  ✅ Background execution  — FastAPI BackgroundTasks + asyncio executor

  STUB / NOT YET WIRED (marked with ⚠️ in code)
  ⚠️ IPFS *upload* (evidence)  — Pinata upload before verification
                                  needs PINATA_API_KEY + PINATA_SECRET_KEY
  ⚠️ On-chain EvidenceRegistry  — store submission hash on-chain
                                  needs ORACLE_PRIVATE_KEY + contract address
  ⚠️ Oracle result posting      — sign + send tx after verdict
                                  Phase 3 (oracle/ directory)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import (
    Job,
    JobStatus,
    SubmissionType,
    VerifyRequest,
    VerifyResponse,
)
from app.services.code_verifier import (
    CodeVerifier,
    EmptySubmissionError,
    NoPythonFilesError,
    NoTestsFoundError,
    SubmissionIngestionError,
    SuiteTimeoutError,
    VerificationError,
)
from app.services.ipfs_client import download_from_ipfs

logger = logging.getLogger(__name__)
router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
#  Dependency providers
#  Named functions (not lambdas) so FastAPI's DI can inject `request`
#  as a resolved parameter rather than a closure variable.
# ══════════════════════════════════════════════════════════════════════════════

def _get_job_store(request: Request) -> JobStore:
    return request.app.state.job_store


def _get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


# ══════════════════════════════════════════════════════════════════════════════
#  Background verification task
#  Runs AFTER the 202 response has been sent to the client.
# ══════════════════════════════════════════════════════════════════════════════

async def _run_verification(
    job_id:   str,
    request:  VerifyRequest,
    store:    JobStore,
    settings: Settings,
) -> None:
    """
    Full verification pipeline executed as a FastAPI BackgroundTask.

    Steps
    ─────
    1. Mark job RUNNING
    2. Resolve the submission source (IPFS download or pass-through)
    3. Run CodeVerifier in a thread-pool executor so the async event
       loop is never blocked by the CPU-bound subprocess calls
    4. Mark job COMPLETED or FAILED

    Error → error_code mapping
    ──────────────────────────
    SubmissionIngestionError → INGESTION_FAILED
    NoPythonFilesError       → NO_PYTHON_FILES
    NoTestsFoundError        → NO_TESTS_FOUND
    EmptySubmissionError     → EMPTY_SUBMISSION
    SuiteTimeoutError        → TEST_TIMEOUT
    VerificationError        → VERIFICATION_FAILED
    Exception                → INTERNAL_ERROR
    """
    # ── 1. Transition to RUNNING ──────────────────────────────────────────────
    await store.mark_running(job_id)

    downloaded_path: Path | None = None

    try:
        # ── 2. Resolve submission source ──────────────────────────────────────
        if request.submission_type == SubmissionType.IPFS_CID:
            # ✅ REAL: downloads archive from Pinata IPFS gateway via httpx
            # Requires PINATA_GATEWAY to be set in .env (has a default)
            downloaded_path = await download_from_ipfs(request.submission_value)
            submission = str(downloaded_path)
            logger.info(
                "ipfs_submission_downloaded",
                extra={"job_id": job_id, "path": submission},
            )
        else:
            # github_url  → CodeVerifier clones it via gitpython
            # local_path  → used in tests / local dev
            submission = request.submission_value

        # ── ⚠️ STUB: Upload to IPFS for tamper-evidence (Phase 3) ─────────────
        # When PINATA_API_KEY is configured this should:
        #   ipfs_cid = await upload_to_ipfs(submission)
        #   await store.set_ipfs_cid(job_id, ipfs_cid)
        # For now we skip the upload and proceed directly to verification.

        # ── 3. Run CodeVerifier (CPU-bound) in thread-pool executor ───────────
        # CodeVerifier.verify() calls subprocess (pytest, pylint, flake8).
        # Blocking the event loop here would prevent other requests from
        # being handled. run_in_executor() runs it in a separate OS thread.
        verifier = CodeVerifier()
        loop     = asyncio.get_event_loop()

        # functools.partial packages the keyword arguments for run_in_executor
        result = await loop.run_in_executor(
            None,   # default ThreadPoolExecutor
            functools.partial(
                verifier.verify,
                submission    = submission,
                test_commands = request.test_commands,
                thresholds    = {
                    "approval":      request.acceptance_threshold,
                    "ambiguity_low": settings.ambiguity_band_low,
                },
            ),
        )

        # ── ⚠️ STUB: Post result to EvidenceRegistry on-chain (Phase 3) ───────
        # When ORACLE_PRIVATE_KEY and EVIDENCE_REGISTRY_ADDRESS are set:
        #   tx_hash = await post_oracle_result(
        #       job_id          = job_id,
        #       submission_hash = result["submission_hash"],
        #       score           = result["final_score"],
        #       verdict         = result["verdict"],
        #   )
        #   await store.set_oracle_tx(job_id, tx_hash)

        # ── 4. Persist completed result ───────────────────────────────────────
        await store.mark_completed(job_id, result)

        logger.info(
            "verification_completed",
            extra={
                "job_id":  job_id,
                "score":   result.get("final_score"),
                "verdict": result.get("verdict"),
            },
        )

    # ── Typed error handling — each maps to a distinct error_code ────────────
    except SubmissionIngestionError as exc:
        logger.warning("ingestion_failed job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "INGESTION_FAILED", str(exc))

    except NoPythonFilesError as exc:
        logger.warning("no_python_files job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "NO_PYTHON_FILES", str(exc))

    except NoTestsFoundError as exc:
        logger.warning("no_tests_found job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "NO_TESTS_FOUND", str(exc))

    except EmptySubmissionError as exc:
        logger.warning("empty_submission job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "EMPTY_SUBMISSION", str(exc))

    except SuiteTimeoutError as exc:
        logger.warning("test_timeout job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "TEST_TIMEOUT", str(exc))

    except VerificationError as exc:
        logger.warning("verification_failed job_id=%s: %s", job_id, exc)
        await store.mark_failed(job_id, "VERIFICATION_FAILED", str(exc))

    except Exception as exc:  # noqa: BLE001
        logger.exception("unexpected_background_error job_id=%s", job_id)
        await store.mark_failed(job_id, "INTERNAL_ERROR", str(exc))

    finally:
        # Always clean up any IPFS temp file, even on error
        if downloaded_path and downloaded_path.exists():
            try:
                os.unlink(downloaded_path)
                logger.debug("ipfs_temp_deleted path=%s", downloaded_path)
            except OSError as exc:
                logger.warning("ipfs_temp_delete_failed path=%s err=%s",
                               downloaded_path, exc)


# ══════════════════════════════════════════════════════════════════════════════
#  POST /verify endpoint
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/verify",
    response_model=VerifyResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a verification job",
    responses={
        202: {"description": "Job accepted — poll GET /result/{job_id} for results"},
        422: {"description": "Validation error in request body"},
        429: {"description": "Rate limit exceeded — max 10 jobs/minute per IP"},
    },
)
async def submit_verification(
    body:             VerifyRequest,
    background_tasks: BackgroundTasks,
    request:          Request,
    store:            JobStore      = Depends(_get_job_store),
    rate_limiter:     RateLimiter   = Depends(_get_rate_limiter),
    settings:         Settings      = Depends(get_settings),
) -> VerifyResponse:
    """
    Submit a new verification job and return **immediately**.

    The verification pipeline (clone repo → run pytest → pylint → flake8 →
    score → verdict) runs in the background.  Poll
    `GET /result/{job_id}` until `status` is `COMPLETED` or `FAILED`.

    **Submission types**
    - `github_url`  — public GitHub repository HTTPS URL
    - `ipfs_cid`    — IPFS content identifier (downloaded from Pinata gateway)
    - `local_path`  — absolute local path (development / testing only)

    **Rate limit:** 10 requests per minute per IP address.
    """
    # ── Extract client IP ─────────────────────────────────────────────────────
    client_ip: str = (request.client.host if request.client else "unknown")

    # ── Rate-limit check ──────────────────────────────────────────────────────
    allowed = await rate_limiter.is_allowed(client_ip)
    if not allowed:
        remaining = await rate_limiter.remaining(client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error":           "Rate limit exceeded. Maximum 10 verification jobs per minute.",
                "code":            "RATE_LIMIT_EXCEEDED",
                "remaining_calls": remaining,
            },
        )

    # ── Create PENDING job record ─────────────────────────────────────────────
    job: Job = await store.create(
        milestone_id        = body.milestone_id,
        submission_type     = body.submission_type,
        submission_value    = body.submission_value,
        test_commands       = body.test_commands,
        acceptance_threshold = body.acceptance_threshold,
    )

    # ── Schedule background verification (non-blocking) ───────────────────────
    background_tasks.add_task(
        _run_verification,
        job_id   = job.job_id,
        request  = body,
        store    = store,
        settings = settings,
    )

    logger.info(
        "job_accepted  job_id=%s  milestone=%s  type=%s  ip=%s",
        job.job_id, body.milestone_id, body.submission_type.value, client_ip,
    )

    # ── Return immediately (202 Accepted) ─────────────────────────────────────
    return VerifyResponse(
        job_id  = job.job_id,
        status  = JobStatus.PENDING,
        message = (
            f"Verification job {job.job_id} accepted. "
            f"Poll GET /result/{job.job_id} for results."
        ),
    )
