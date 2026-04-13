"""
app/models/job.py
─────────────────
Pydantic models that represent a verification job throughout its lifecycle.

JobStatus  — enum of possible states the job can be in
Verdict    — enum of the final AI decision
JobCreate  — payload accepted by POST /verify
Job        — full job record stored in memory / DB
JobSummary — lightweight version for list responses
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ── Enumerations ─────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    """Mirrors the smart-contract state machine."""
    PENDING    = "PENDING"     # Job created, not yet picked up by worker
    RUNNING    = "RUNNING"     # Worker is actively evaluating
    COMPLETED  = "COMPLETED"   # Evaluation finished — check verdict
    FAILED     = "FAILED"      # Unrecoverable error during evaluation


class Verdict(str, Enum):
    """AI decision gate output — maps directly to on-chain actions."""
    APPROVED  = "APPROVED"    # Score ≥ APPROVAL_THRESHOLD  → release payment
    DISPUTED  = "DISPUTED"    # Score in ambiguity band     → trigger jury
    REJECTED  = "REJECTED"    # Score < AMBIGUITY_BAND_LOW  → reject submission
    PENDING   = "PENDING"     # Not yet determined


class DeliverableType(str, Enum):
    CODE      = "CODE"        # Python code repo (supported in prototype)
    DOCUMENT  = "DOCUMENT"    # Future: text/PDF deliverables
    DESIGN    = "DESIGN"      # Future: image/Figma deliverables


# ── Request / Response models ─────────────────────────────────────────────────

class JobCreate(BaseModel):
    """
    Body expected by  POST /verify.
    The client (oracle bridge or frontend) submits this to kick off evaluation.
    """
    milestone_id: str = Field(
        ...,
        description="On-chain milestone identifier (bytes32 hex string or UUID)",
        examples=["0xabc123...", "milestone-42"],
    )
    submission_url: str = Field(
        ...,
        description="GitHub repo URL or IPFS CID of the submitted deliverable",
        examples=[
            "https://github.com/freelancer/my-submission",
            "ipfs://QmXyz...",
        ],
    )
    deliverable_type: DeliverableType = Field(
        default=DeliverableType.CODE,
        description="Type of deliverable — only CODE is supported in prototype",
    )
    acceptance_criteria: str | None = Field(
        default=None,
        description="Natural-language or JSON acceptance criteria from MilestoneDescriptor",
    )
    test_suite_url: str | None = Field(
        default=None,
        description="URL to the pytest test suite to run against the submission",
    )


class ScoreBreakdown(BaseModel):
    """
    Granular sub-scores that compose the final normalised score.
    Surfaced in the frontend's AI Verification results page.
    """
    test_pass_rate: float | None   = Field(None, ge=0.0, le=1.0)
    static_analysis: float | None = Field(None, ge=0.0, le=1.0)
    complexity: float | None      = Field(None, ge=0.0, le=1.0)
    semantic_match: float | None  = Field(None, ge=0.0, le=1.0)
    weighted_total: float | None  = Field(None, ge=0.0, le=1.0)


class Job(BaseModel):
    """
    Complete job record — stored in the in-memory dict and returned by
    GET /result/{job_id}.
    """
    job_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this verification job",
    )
    milestone_id: str
    submission_url: str
    deliverable_type: DeliverableType = DeliverableType.CODE
    acceptance_criteria: str | None = None
    test_suite_url: str | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────────
    status: JobStatus = JobStatus.PENDING
    score: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Normalised aggregate score (0.0 – 1.0)",
    )
    verdict: Verdict = Verdict.PENDING
    score_breakdown: ScoreBreakdown | None = None

    # Free-form dict for worker-produced artefacts (pylint report, test output…)
    details: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None

    # ── Timestamps ───────────────────────────────────────────────────────────
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    completed_at: datetime | None = None

    # ── On-chain artefacts (filled after oracle posts result) ─────────────────
    ipfs_cid: str | None = Field(
        default=None,
        description="IPFS CID of the submission archive uploaded to Pinata",
    )
    submission_hash: str | None = Field(
        default=None,
        description="SHA-256 hash of the submission — stored on-chain via EvidenceRegistry",
    )
    oracle_tx_hash: str | None = Field(
        default=None,
        description="Transaction hash of the oracle's on-chain result post",
    )


class JobSummary(BaseModel):
    """Lightweight projection used in GET /jobs list responses."""
    job_id: str
    milestone_id: str
    status: JobStatus
    verdict: Verdict
    score: float | None
    created_at: datetime
    completed_at: datetime | None
