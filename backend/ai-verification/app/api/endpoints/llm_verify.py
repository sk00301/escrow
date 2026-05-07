"""
app/api/endpoints/llm_verify.py

POST /llm-verify — LLM-powered code verification.

BUG FIX (2026-05-03):
  When submission_type == IPFS_CID, the raw CID was being passed directly
  to CodeVerificationAgent which tried to open it as a local path and failed.
  Fix: download from IPFS first, exactly like verify.py does.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Request, status
from fastapi.responses import JSONResponse

from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import (
    JobStatus,
    LLMVerifyRequest,
    LLMVerifyResponse,
    SubmissionType,
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

    rate_limiter = _get_rate_limiter(request)
    client_ip = request.client.host if request.client else "unknown"
    allowed = await rate_limiter.is_allowed(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": "Rate limit exceeded.", "code": "RATE_LIMIT_EXCEEDED", "job_id": None},
        )

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
                content={"error": f"Invalid LLM provider override: {exc}", "code": "INVALID_PROVIDER", "job_id": None},
            )

    job_store = _get_job_store(request)
    job = await job_store.create(
        milestone_id=body.milestone_id,
        submission_type=body.submission_type,
        submission_value=body.submission_value,
        test_commands=body.test_commands,
        acceptance_threshold=body.acceptance_threshold,
    )
    job.llm_provider = llm_provider.name
    # When a scope is present, the agent uses scope.acceptance_criteria.
    # We still record the original field for audit/display purposes.
    job.acceptance_criteria = body.acceptance_criteria
    job.milestone_scope = body.milestone_scope
    if body.milestone_scope is not None:
        job.milestone_scope_label = (
            f"Milestone {body.milestone_scope.milestone_number} — {body.milestone_scope.label}"
        )

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
    from app.services.ipfs_client import download_from_ipfs

    await job_store.mark_running(job_id)
    logger.info("[llm_verify] job_running job_id=%s", job_id)

    downloaded_path: Path | None = None

    try:
        # ── Step 1: resolve submission source ─────────────────────────────────
        if body.submission_type == SubmissionType.IPFS_CID:
            logger.info("[llm_verify] downloading IPFS CID=%s", body.submission_value)
            downloaded_path = await download_from_ipfs(body.submission_value)
            submission = str(downloaded_path)
            logger.info("[llm_verify] IPFS downloaded to %s", submission)
        else:
            submission = body.submission_value

        # ── Step 2: detect content type — zip vs plain text ───────────────────
        # ipfs_client always saves with .zip suffix regardless of actual content.
        # A plain-text submission (work notes, markdown, etc.) is NOT a zip and
        # CodeVerificationAgent will crash trying to unzip it.
        # Solution: check with zipfile.is_zipfile(); if not a zip, use the
        # LLM text-evaluation path instead of the code-analysis path.
        import zipfile as _zipfile

        is_zip = False
        if downloaded_path and downloaded_path.exists():
            try:
                is_zip = _zipfile.is_zipfile(str(downloaded_path))
            except Exception:
                is_zip = False
        elif submission and Path(submission).exists():
            try:
                is_zip = _zipfile.is_zipfile(submission)
            except Exception:
                is_zip = False
        else:
            # GitHub URL or non-IPFS path — let CodeVerificationAgent handle it
            is_zip = True   # agent handles git cloning natively

        if not is_zip:
            # ── Plain text / document submission ──────────────────────────────
            # Read the content and evaluate with LLM directly (no code tools).
            logger.info("[llm_verify] content is not a zip — routing to text evaluation")
            raw_bytes = downloaded_path.read_bytes() if downloaded_path else Path(submission).read_bytes()
            try:
                submission_text = raw_bytes.decode("utf-8", errors="replace")
            except Exception:
                submission_text = raw_bytes.decode("latin-1", errors="replace")

            # Truncate to avoid blowing the LLM context window
            MAX_CHARS = 8_000
            if len(submission_text) > MAX_CHARS:
                submission_text = submission_text[:MAX_CHARS] + "\n\n[...truncated...]"

            # When a scope is present, use its criteria and inject required keywords
            scope = body.milestone_scope
            if scope and scope.acceptance_criteria:
                effective_criteria = scope.acceptance_criteria
                logger.info(
                    "[llm_verify] text path: applying scope milestone=%d ('%s')",
                    scope.milestone_number, scope.label,
                )
            else:
                effective_criteria = body.acceptance_criteria

            verdict = await _evaluate_text_with_llm(
                llm_provider=llm_provider,
                submission_text=submission_text,
                acceptance_criteria=effective_criteria,
            )
        else:
            # ── Code submission (zip or git repo) ─────────────────────────────
            logger.info("[llm_verify] content is a zip — routing to CodeVerificationAgent")
            agent = CodeVerificationAgent(llm=llm_provider, config=config)
            loop  = asyncio.get_event_loop()

            # When a scope is present, use its criteria and test commands
            scope = body.milestone_scope
            if scope:
                effective_criteria = scope.acceptance_criteria or body.acceptance_criteria
                effective_test_cmds = scope.test_scope or body.test_commands
                logger.info(
                    "[llm_verify] code path: applying scope milestone=%d ('%s') "
                    "test_commands=%s",
                    scope.milestone_number, scope.label, effective_test_cmds,
                )
            else:
                effective_criteria  = body.acceptance_criteria
                effective_test_cmds = body.test_commands

            verdict = await loop.run_in_executor(
                None,
                lambda: asyncio.run(
                    agent.verify(
                        submission=submission,
                        acceptance_criteria=effective_criteria,
                        test_commands=effective_test_cmds,
                    )
                ),
            )

        score = float(verdict.get("score", 0.0))
        verdict_str = verdict.get("verdict", "REJECTED").upper()
        try:
            verdict_enum = Verdict(verdict_str)
        except ValueError:
            verdict_enum = Verdict.REJECTED

        tool_metrics = verdict.get("tool_metrics", {})
        breakdown    = verdict.get("score_breakdown", {})
        scope = body.milestone_scope
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
                "total":     0,
                "passed":    0,
                "failed":    0,
                "errored":   0,
                "skipped":   0,
                "pass_rate": tool_metrics.get("pytest_pass_rate", 0.0),
            },
            "static_analysis": {
                "pylint_raw_score":  tool_metrics.get("pylint_score", 0.0),
                "pylint_score":      min(1.0, tool_metrics.get("pylint_score", 0.0) / 10.0),
                "flake8_violations": tool_metrics.get("flake8_violations", 0),
                "flake8_score":      1.0,
            },
            # Milestone scope metadata
            "milestone": (
                {
                    "number":        scope.milestone_number,
                    "label":         scope.label,
                    "scope_applied": True,
                    "scope_label":   f"Milestone {scope.milestone_number} — {scope.label}",
                }
                if scope else {"scope_applied": False}
            ),
        }

        job = await job_store.mark_completed(job_id=job_id, result=result_dict)
        if job:
            job.details = verdict

        logger.info(
            "[llm_verify] job_completed job_id=%s verdict=%s score=%.3f",
            job_id, verdict_enum.value, score,
        )

    except LLMProviderError as exc:
        logger.error("[llm_verify] LLM unavailable job_id=%s: %s", job_id, exc)
        await job_store.mark_failed(job_id=job_id, error_code="LLM_UNAVAILABLE", error_message=str(exc))

    except ValueError as exc:
        logger.error("[llm_verify] parse error job_id=%s: %s", job_id, exc)
        await job_store.mark_failed(job_id=job_id, error_code="LLM_PARSE_ERROR", error_message=str(exc))

    except Exception as exc:
        logger.exception("[llm_verify] unexpected error job_id=%s", job_id)
        error_msg = str(exc)
        code = "INGESTION_FAILED" if ("ingest" in error_msg.lower() or "submission" in error_msg.lower()) else "VERIFICATION_FAILED"
        await job_store.mark_failed(job_id=job_id, error_code=code, error_message=error_msg)

    finally:
        if downloaded_path and downloaded_path.exists():
            try:
                os.unlink(downloaded_path)
            except OSError:
                pass


# ── Text evaluation helper ────────────────────────────────────────────────────

_TEXT_SYSTEM = """You are an objective, impartial deliverable assessor for a freelance escrow platform.
Your verdict determines whether a freelancer gets paid. Be fair but rigorous.

VERDICT THRESHOLDS:
  score >= 0.75  → "APPROVED"   (payment released)
  0.45 <= score < 0.75  → "DISPUTED"  (human review)
  score < 0.45  → "REJECTED"   (resubmission required)

Return ONLY a valid JSON object. No prose, no markdown fences."""

_TEXT_USER = """MILESTONE ACCEPTANCE CRITERIA:
{acceptance_criteria}

SUBMITTED WORK:
---
{submission_text}
---

Evaluate whether the submitted work satisfies the acceptance criteria.

Return ONLY a JSON object:
{{
  "score": <float 0.0-1.0>,
  "verdict": <"APPROVED"|"DISPUTED"|"REJECTED">,
  "confidence": <float 0.0-1.0>,
  "requirements_met": [
    {{"requirement": "...", "met": true|false, "evidence": "..."}}
  ],
  "critical_issues": ["blocking problems"],
  "minor_issues": ["non-blocking issues"],
  "strengths": ["what was done well"],
  "score_breakdown": {{
    "requirements_coverage": <float>,
    "quality": <float>,
    "completeness": <float>
  }},
  "reasoning": "2-3 sentence plain English explanation",
  "recommendation": "specific actionable advice"
}}"""


async def _evaluate_text_with_llm(
    llm_provider,
    submission_text: str,
    acceptance_criteria: str,
) -> dict:
    """
    Use the LLM to evaluate a plain-text submission against acceptance criteria.
    Returns a verdict dict in the same shape as CodeVerificationAgent.verify().
    """
    import json as _json

    user_prompt = _TEXT_USER.format(
        acceptance_criteria=acceptance_criteria,
        submission_text=submission_text,
    )

    try:
        raw = await llm_provider.complete(prompt=user_prompt, system=_TEXT_SYSTEM)
    except Exception as exc:
        logger.error("[llm_verify] text LLM call failed: %s", exc)
        return {"score": 0.0, "verdict": "REJECTED", "confidence": 0.0,
                "reasoning": f"LLM call failed: {exc}", "recommendation": "Resubmit."}

    # Strip markdown fences and parse JSON
    text = raw.strip()
    for fence in ("```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
            if text.endswith("```"):
                text = text[:-3]
            break
    text = text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]

    try:
        verdict = _json.loads(text)
    except _json.JSONDecodeError:
        logger.warning("[llm_verify] text verdict JSON parse failed — raw: %s", raw[:300])
        verdict = {"score": 0.0, "verdict": "REJECTED", "confidence": 0.0,
                   "reasoning": "Could not parse LLM response.", "recommendation": "Resubmit."}

    # Ensure verdict string is valid
    score = float(verdict.get("score", 0.0))
    v_str = verdict.get("verdict", "").upper()
    if v_str not in ("APPROVED", "DISPUTED", "REJECTED"):
        v_str = "APPROVED" if score >= 0.75 else "DISPUTED" if score >= 0.45 else "REJECTED"
        verdict["verdict"] = v_str

    # Normalise score_breakdown keys to match what the UI expects
    bd = verdict.get("score_breakdown", {})
    verdict["score_breakdown"] = {
        "test_execution":        bd.get("test_execution",        bd.get("completeness",          0.0)),
        "code_quality":          bd.get("code_quality",          bd.get("quality",               0.0)),
        "requirements_coverage": bd.get("requirements_coverage", 0.0),
    }
    verdict["tool_metrics"] = {"pytest_pass_rate": 0.0, "pylint_score": 0.0, "flake8_violations": 0}

    logger.info("[llm_verify] text evaluation verdict=%s score=%.3f", verdict["verdict"], score)
    return verdict


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
