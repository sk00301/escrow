"""
app/api/endpoints/text_verify.py

POST /text-verify — LLM evaluation for non-code submissions.

Used when the freelancer submits:
  - Plain text work notes
  - Document / report deliverables
  - Design descriptions or links
  - Any submission that is NOT a Python code repository

Pipeline (no subprocess tools):
  1. Resolve submission: download from IPFS as raw text OR accept inline text
  2. Ask the LLM to evaluate the text against acceptance_criteria
  3. Parse structured JSON verdict
  4. Return APPROVED / DISPUTED / REJECTED + score + explanation

Verdict thresholds (same as CodeVerificationAgent):
  score >= 0.75  →  APPROVED
  0.45 <= score < 0.75  →  DISPUTED
  score < 0.45  →  REJECTED
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import JobStatus, SubmissionType

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_TEXT_CHARS = 8_000   # truncate very long submissions before sending to LLM


# ── Request / Response schemas ────────────────────────────────────────────────

class TextVerifyRequest(BaseModel):
    milestone_id:         str = Field(..., description="On-chain milestone ID")
    submission_type:      SubmissionType = Field(SubmissionType.IPFS_CID)
    submission_value:     str = Field(..., description="IPFS CID, or raw text if type=local_path")
    acceptance_criteria:  str = Field(..., min_length=5, max_length=4096)
    deliverable_type:     str = Field("document", description="document | design | text")
    acceptance_threshold: float = Field(0.75, ge=0.0, le=1.0)

class TextVerifyResponse(BaseModel):
    job_id:  str
    status:  JobStatus
    message: str


# ── LLM prompt ────────────────────────────────────────────────────────────────

_SYSTEM = """You are an objective, impartial deliverable assessor for a freelance escrow platform.
Your verdict determines whether a freelancer gets paid. Be fair but rigorous.

VERDICT THRESHOLDS:
  score >= 0.75  →  "APPROVED"   (payment released to freelancer)
  0.45 <= score < 0.75  →  "DISPUTED"  (human review required)
  score < 0.45  →  "REJECTED"   (resubmission required)

You MUST return ONLY a valid JSON object. No prose before or after. No markdown fences."""

_USER = """MILESTONE ACCEPTANCE CRITERIA:
{acceptance_criteria}

SUBMITTED DELIVERABLE ({deliverable_type}):
---
{submission_text}
---

Evaluate whether the submitted deliverable satisfies the acceptance criteria.

Return ONLY a JSON object with EXACTLY these keys:
{{
  "score": <float 0.0-1.0>,
  "verdict": <"APPROVED" | "DISPUTED" | "REJECTED">,
  "confidence": <float 0.0-1.0>,
  "requirements_met": [
    {{"requirement": "...", "met": true|false, "evidence": "quote or observation from submission"}}
  ],
  "critical_issues": ["list of blocking problems"],
  "minor_issues": ["list of non-blocking issues"],
  "strengths": ["list of what was done well"],
  "score_breakdown": {{
    "requirements_coverage": <float, most important — fraction of criteria met>,
    "quality":               <float, overall quality of the deliverable>,
    "completeness":          <float, how complete/thorough the submission is>
  }},
  "reasoning": "2-3 sentence plain English explanation of verdict",
  "recommendation": "specific actionable advice for the freelancer"
}}"""


# ── Dependency helpers ────────────────────────────────────────────────────────

def _store(r: Request)        -> JobStore:    return r.app.state.job_store
def _limiter(r: Request)      -> RateLimiter: return r.app.state.rate_limiter
def _llm(r: Request):                         return r.app.state.llm_provider


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post(
    "/text-verify",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=TextVerifyResponse,
    summary="Evaluate a text/document submission against acceptance criteria (no code tools)",
)
async def text_verify(
    body: TextVerifyRequest,
    background_tasks: BackgroundTasks,
    request: Request,
) -> TextVerifyResponse:

    limiter   = _limiter(request)
    client_ip = request.client.host if request.client else "unknown"
    if not await limiter.is_allowed(client_ip):
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": "Rate limit exceeded.", "code": "RATE_LIMIT_EXCEEDED", "job_id": None},
        )

    store = _store(request)
    job = await store.create(
        milestone_id=body.milestone_id,
        submission_type=body.submission_type,
        submission_value=body.submission_value,
        test_commands=[],
        acceptance_threshold=body.acceptance_threshold,
    )
    job.acceptance_criteria = body.acceptance_criteria

    background_tasks.add_task(
        _run_text_verification,
        job_id=job.job_id,
        body=body,
        job_store=store,
        llm_provider=_llm(request),
    )

    logger.info(
        "[text_verify] queued job_id=%s milestone=%s type=%s",
        job.job_id, body.milestone_id, body.deliverable_type,
    )

    return TextVerifyResponse(
        job_id=job.job_id,
        status=JobStatus.PENDING,
        message=f"Text verification queued. Poll GET /result/{job.job_id} for results.",
    )


# ── Background task ───────────────────────────────────────────────────────────

async def _run_text_verification(
    job_id: str,
    body: TextVerifyRequest,
    job_store: JobStore,
    llm_provider,
) -> None:
    from app.services.ipfs_client import download_from_ipfs

    await job_store.mark_running(job_id)
    logger.info("[text_verify] running job_id=%s", job_id)

    downloaded_path: Path | None = None

    try:
        # ── 1. Resolve submission text ─────────────────────────────────────────
        if body.submission_type == SubmissionType.IPFS_CID:
            logger.info("[text_verify] downloading IPFS CID=%s", body.submission_value)
            downloaded_path = await download_from_ipfs(body.submission_value)
            # Read as raw text (works for .txt, .md, notes — not binary)
            raw_bytes = downloaded_path.read_bytes()
            try:
                submission_text = raw_bytes.decode("utf-8", errors="replace")
            except Exception:
                submission_text = raw_bytes.decode("latin-1", errors="replace")
            logger.info("[text_verify] IPFS content length=%d chars", len(submission_text))
        else:
            # local_path or raw text passed inline
            p = Path(body.submission_value)
            if p.exists():
                submission_text = p.read_text(errors="replace")
            else:
                submission_text = body.submission_value   # treat as inline text

        # Truncate to avoid blowing the context window
        if len(submission_text) > MAX_TEXT_CHARS:
            submission_text = submission_text[:MAX_TEXT_CHARS] + "\n\n[...truncated...]"

        # ── 2. Call LLM ────────────────────────────────────────────────────────
        user_prompt = _USER.format(
            acceptance_criteria=body.acceptance_criteria,
            deliverable_type=body.deliverable_type,
            submission_text=submission_text,
        )

        raw_response = await llm_provider.complete(
            prompt=user_prompt,
            system=_SYSTEM,
        )

        # ── 3. Parse verdict ───────────────────────────────────────────────────
        verdict = _parse_verdict(raw_response)
        score   = float(verdict.get("score", 0.0))
        verdict_str = verdict.get("verdict", "REJECTED").upper()
        if verdict_str not in ("APPROVED", "DISPUTED", "REJECTED"):
            verdict_str = _apply_gate(score)

        breakdown = verdict.get("score_breakdown", {})

        result_dict = {
            "final_score":    score,
            "verdict":        verdict_str,
            "submission_hash": "",
            "passed_tests":   [],
            "failed_tests":   [],
            "weighted_breakdown": {
                "requirements_coverage":  breakdown.get("requirements_coverage", 0.0),
                "quality_contribution":   breakdown.get("quality", 0.0),
                "completeness_contribution": breakdown.get("completeness", 0.0),
            },
            "test_results": {"total": 0, "passed": 0, "failed": 0, "errored": 0, "skipped": 0, "pass_rate": 0.0},
            "static_analysis": {"pylint_raw_score": None, "pylint_score": None, "flake8_violations": None},
            # Attach full LLM verdict for the UI
            "llm_verdict": verdict,
        }

        await job_store.mark_completed(job_id=job_id, result=result_dict)
        logger.info("[text_verify] completed job_id=%s verdict=%s score=%.3f", job_id, verdict_str, score)

    except Exception as exc:
        logger.exception("[text_verify] failed job_id=%s", job_id)
        await job_store.mark_failed(job_id=job_id, error_code="VERIFICATION_FAILED", error_message=str(exc))

    finally:
        if downloaded_path and downloaded_path.exists():
            try:
                os.unlink(downloaded_path)
            except OSError:
                pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_verdict(raw: str) -> dict:
    """Strip markdown fences and parse JSON from LLM response."""
    text = raw.strip()
    # Strip ```json ... ``` or ``` ... ``` fences
    for fence in ("```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
            if text.endswith("```"):
                text = text[:-3]
            break
    text = text.strip()
    # Find first { ... } block
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("[text_verify] JSON parse failed, using fallback verdict")
        return {"score": 0.0, "verdict": "REJECTED", "confidence": 0.0,
                "reasoning": "Could not parse LLM response.", "recommendation": "Resubmit."}


def _apply_gate(score: float) -> str:
    if score >= 0.75: return "APPROVED"
    if score >= 0.45: return "DISPUTED"
    return "REJECTED"
