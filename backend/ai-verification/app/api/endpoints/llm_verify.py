"""
app/api/endpoints/llm_verify.py

POST /llm-verify — LLM-powered code verification endpoint.

Job lifecycle:  PENDING → RUNNING → COMPLETED | FAILED
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Request, status
from fastapi.responses import JSONResponse

from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import (
    JobStatus,
    LLMVerifyRequest,
    LLMVerifyResponse,
    Verdict,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Dependency helpers ────────────────────────────────────────────────────────

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

    if body.llm_provider_override:
        try:
            from app.services.llm.provider import LLMProvider
            llm_provider = LLMProvider.from_config(
                _ProviderOverrideSettings(body.llm_provider_override, cfg)
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

    # ── Create job using JobStore.create() with individual args ───────────────
    job_store = _get_job_store(request)
    job = await job_store.create(
        milestone_id=body.milestone_id,
        submission_type=body.submission_type,
        submission_value=body.submission_value,
        test_commands=body.test_commands,
        acceptance_threshold=body.acceptance_threshold,
    )

    # Attach LLM-specific fields directly on the job object
    job.llm_provider = llm_provider.name
    job.acceptance_criteria = body.acceptance_criteria

    logger.info(
        "[llm_verify] job_created job_id=%s milestone=%s provider=%s",
        job.job_id, body.milestone_id, llm_provider.name,
    )

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
    from app.services.agents.code_agent import CodeVerificationAgent
    from app.services.llm.provider import LLMProviderError

    await job_store.mark_running(job_id)
    logger.info("[llm_verify] job_running job_id=%s", job_id)

    try:
        agent = CodeVerificationAgent(llm=llm_provider, config=config)

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

        score = float(verdict.get("score", 0.0))
        verdict_str = verdict.get("verdict", "REJECTED").upper()
        try:
            verdict_enum = Verdict(verdict_str)
        except ValueError:
            verdict_enum = Verdict.REJECTED

        # Bridge LLM verdict into the shape mark_completed() expects
        tool_metrics = verdict.get("tool_metrics", {})
        breakdown    = verdict.get("score_breakdown", {})
        result_dict  = {
            "final_score":    score,
            "verdict":        verdict_enum.value,
            "submission_hash": verdict.get("submission_hash", ""),
            "passed_tests":   [],
            "failed_tests":   [],
            "weighted_breakdown": {
                "test_contribution":   breakdown.get("test_execution", 0.0),
                "pylint_contribution": breakdown.get("code_quality", 0.0),
                "flake8_contribution": breakdown.get("requirements_coverage", 0.0),
            },
            "test_results": {
                "total":    0,
                "passed":   0,
                "failed":   0,
                "errored":  0,
                "skipped":  0,
                "pass_rate": tool_metrics.get("pytest_pass_rate", 0.0),
            },
            "static_analysis": {
                "pylint_raw_score":  tool_metrics.get("pylint_score", 0.0),
                "pylint_score":      min(1.0, tool_metrics.get("pylint_score", 0.0) / 10.0),
                "flake8_violations": tool_metrics.get("flake8_violations", 0),
                "flake8_score":      1.0,
            },
        }

        job = await job_store.mark_completed(job_id=job_id, result=result_dict)

        # Attach full LLM verdict so evaluation harness and frontend can read it
        if job:
            job.details = verdict

        logger.info(
            "[llm_verify] job_completed job_id=%s verdict=%s score=%.3f",
            job_id, verdict_enum.value, score,
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
        code = "INGESTION_FAILED" if ("ingest" in error_msg.lower() or "submission" in error_msg.lower()) else "VERIFICATION_FAILED"
        await job_store.mark_failed(
            job_id=job_id,
            error_code=code,
            error_message=error_msg,
        )


# ── Provider override helper ──────────────────────────────────────────────────

class _ProviderOverrideSettings:
    def __init__(self, provider_name: str, base_config) -> None:
        for attr in dir(base_config):
            if not attr.startswith("_"):
                try:
                    setattr(self, attr, getattr(base_config, attr))
                except Exception:
                    pass
        self.llm_provider = provider_name
