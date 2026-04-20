"""
app/api/endpoints/llm_verify.py

POST /llm-verify — LLM-powered code verification endpoint.

Follows the same dependency-injection and job-lifecycle pattern as the
existing POST /verify endpoint:
  PENDING → RUNNING → COMPLETED | FAILED

The CodeVerificationAgent runs in a thread-pool executor so its
CPU-bound tool calls and blocking httpx requests don't block the event loop.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Request, status
from fastapi.responses import JSONResponse

from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import (
    Job,
    JobStatus,
    LLMVerifyRequest,
    LLMVerifyResponse,
    SubmissionType,
    Verdict,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Dependency helpers (mirror the pattern in verify.py) ─────────────────────

def _get_job_store(request: Request) -> JobStore:
    return request.app.state.job_store


def _get_rate_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def _get_llm_provider(request: Request):
    return request.app.state.llm_provider


def _get_settings(request: Request):
    from app.core.config import get_settings
    return get_settings()


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post(
    "/llm-verify",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=LLMVerifyResponse,
    summary="Submit a code submission for LLM-powered verification",
    description=(
        "Accepts a code submission and acceptance criteria, queues an LLM "
        "verification job, and returns a job_id for polling. "
        "The full verdict is available at GET /result/{job_id} once COMPLETED."
    ),
)
async def llm_verify(
    body: LLMVerifyRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> LLMVerifyResponse:

# ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limiter = _get_rate_limiter(request)
    client_ip = request.client.host if request.client else "unknown"
    allowed = await rate_limiter.is_allowed(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "error": "Rate limit exceeded. Maximum 10 requests per minute.",
                "code": "RATE_LIMIT_EXCEEDED",
                "job_id": None,
            },
        )

    # ── Resolve LLM provider ──────────────────────────────────────────────────
    llm_provider = _get_llm_provider(request)
    cfg = _get_settings(request)

    # Handle optional per-request provider override
    if body.llm_provider_override:
        try:
            from app.services.llm.provider import LLMProvider
            llm_provider = LLMProvider.from_config(
                _ProviderOverrideSettings(body.llm_provider_override, cfg)
            )
            logger.info(
                "[llm_verify] per-request provider override: %s", body.llm_provider_override
            )
        except Exception as exc:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "error": f"Invalid LLM provider override: {exc}",
                    "code": "INVALID_PROVIDER",
                    "job_id": None,
                },
            )

    # ── Create job record ─────────────────────────────────────────────────────
    job_store = _get_job_store(request)
    job = Job(
        milestone_id=body.milestone_id,
        submission_type=body.submission_type,
        submission_value=body.submission_value,
        test_commands=body.test_commands,
        acceptance_threshold=body.acceptance_threshold,
        acceptance_criteria=body.acceptance_criteria,
        llm_provider=llm_provider.name,
    )
    await job_store.create(job)
    logger.info(
        "[llm_verify] job_created job_id=%s milestone=%s provider=%s",
        job.job_id, body.milestone_id, llm_provider.name,
    )

    # ── Queue background task ─────────────────────────────────────────────────
    background_tasks.add_task(
        _run_llm_verification,
        job_id=job.job_id,
        body=body,
        job_store=job_store,
        llm_provider=llm_provider,
        config=cfg,
    )

    return LLMVerifyResponse(
        job_id=job.job_id,
        status=JobStatus.PENDING,
        message=f"LLM verification queued. Poll GET /result/{job.job_id} for results.",
        llm_provider=llm_provider.name,
    )


# ── Background task ───────────────────────────────────────────────────────────

async def _run_llm_verification(
    job_id: str,
    body: LLMVerifyRequest,
    job_store: JobStore,
    llm_provider,
    config,
) -> None:
    """
    Background coroutine that runs the full CodeVerificationAgent pipeline.

    Job lifecycle:  PENDING → RUNNING → COMPLETED | FAILED
    On COMPLETED:   stores the full LLM verdict dict in job.details
    On FAILED:      stores error_code and error_message
    """
    from app.services.agents.code_agent import CodeVerificationAgent
    from app.services.llm.provider import LLMProviderError

    await job_store.mark_running(job_id)
    logger.info("[llm_verify] job_running job_id=%s", job_id)

    try:
        agent = CodeVerificationAgent(llm=llm_provider, config=config)

        # Run in executor — agent uses blocking subprocesses + httpx
        loop = asyncio.get_event_loop()
        verdict = await loop.run_in_executor(
            None,
            lambda: asyncio.run(
                agent.verify(
                    submission=body.submission_value,
                    acceptance_criteria=body.acceptance_criteria,
                    test_commands=body.test_commands,
                )
            ),
        )

        # Map LLM verdict string to Verdict enum
        verdict_str = verdict.get("verdict", "REJECTED").upper()
        verdict_enum = Verdict(verdict_str) if verdict_str in Verdict._value2member_map_ else Verdict.REJECTED

        await job_store.mark_completed(
            job_id=job_id,
            verdict=verdict_enum,
            score=float(verdict.get("score", 0.0)),
            details=verdict,
        )
        logger.info(
            "[llm_verify] job_completed job_id=%s verdict=%s score=%.3f",
            job_id, verdict_enum, verdict.get("score", 0.0),
        )

    except LLMProviderError as exc:
        logger.error("[llm_verify] LLM unavailable job_id=%s: %s", job_id, exc)
        await job_store.mark_failed(
            job_id=job_id,
            error_code="LLM_UNAVAILABLE",
            error_message=str(exc),
        )

    except ValueError as exc:
        logger.error("[llm_verify] parse error job_id=%s: %s", job_id, exc)
        await job_store.mark_failed(
            job_id=job_id,
            error_code="LLM_PARSE_ERROR",
            error_message=str(exc),
        )

    except Exception as exc:
        logger.exception("[llm_verify] unexpected error job_id=%s", job_id)
        error_msg = str(exc)
        if "ingest" in error_msg.lower() or "submission" in error_msg.lower():
            code = "INGESTION_FAILED"
        else:
            code = "VERIFICATION_FAILED"
        await job_store.mark_failed(
            job_id=job_id,
            error_code=code,
            error_message=error_msg,
        )


# ── Provider override helper ──────────────────────────────────────────────────

class _ProviderOverrideSettings:
    """Minimal settings shim for per-request provider overrides."""

    def __init__(self, provider_name: str, base_config) -> None:
        self.llm_provider = provider_name
        # Copy all attributes from the real config
        for attr in dir(base_config):
            if not attr.startswith("_"):
                try:
                    setattr(self, attr, getattr(base_config, attr))
                except Exception:
                    pass
        self.llm_provider = provider_name  # ensure override wins
