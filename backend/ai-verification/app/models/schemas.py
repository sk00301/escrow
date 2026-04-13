"""
app/models/schemas.py
─────────────────────
All Pydantic models for API request bodies, response bodies, and the
central Job record. Keeping every schema in one file makes it easy to
see the full API surface at a glance.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Enumerations ──────────────────────────────────────────────────────────────

class SubmissionType(str, Enum):
    GITHUB_URL = "github_url"
    IPFS_CID   = "ipfs_cid"
    LOCAL_PATH = "local_path"   # test/dev convenience only


class JobStatus(str, Enum):
    PENDING   = "PENDING"
    RUNNING   = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED    = "FAILED"


class Verdict(str, Enum):
    APPROVED  = "APPROVED"
    DISPUTED  = "DISPUTED"
    REJECTED  = "REJECTED"
    PENDING   = "PENDING"    # not yet determined


# ── Request models ────────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    """
    Body for  POST /verify

    Examples
    --------
    GitHub URL:
        {
          "milestone_id": "milestone-42",
          "submission_type": "github_url",
          "submission_value": "https://github.com/alice/my-project",
          "test_commands": ["pytest tests/"],
          "acceptance_threshold": 0.75
        }

    IPFS CID:
        {
          "milestone_id": "milestone-42",
          "submission_type": "ipfs_cid",
          "submission_value": "QmXyz...",
          "test_commands": ["pytest tests/unit/"],
          "acceptance_threshold": 0.75
        }
    """
    milestone_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="On-chain milestone ID (hex bytes32 or human-readable string)",
        examples=["milestone-42", "0xdeadbeef"],
    )
    submission_type: SubmissionType = Field(
        ...,
        description="How the submission is delivered — github_url or ipfs_cid",
    )
    submission_value: str = Field(
        ...,
        min_length=1,
        max_length=512,
        description="GitHub repo URL, IPFS CID, or local path depending on submission_type",
        examples=["https://github.com/alice/repo", "QmXyz123abc"],
    )
    test_commands: list[str] = Field(
        default=["pytest"],
        min_length=1,
        description="Pytest commands to run against the submission",
        examples=[["pytest tests/"], ["pytest tests/unit/", "pytest tests/integration/"]],
    )
    acceptance_threshold: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        description="Minimum score to APPROVE. Overrides the server default for this job.",
    )
    document_text: str | None = Field(
        default=None,
        description="Extracted text of the submitted document (for DOCUMENT type)",
    )
    required_keywords: list[str] = Field(
        default_factory=list,
        description="Keywords that must appear in the document",
    )

    @field_validator("submission_value")
    @classmethod
    def validate_submission_value(cls, v: str, info) -> str:
        # We can't access other fields easily in field_validator without model_validator
        return v.strip()

    @model_validator(mode="after")
    def validate_github_url_format(self) -> "VerifyRequest":
        if self.submission_type == SubmissionType.GITHUB_URL:
            if not self.submission_value.startswith(
                ("https://github.com", "http://github.com", "git@github.com")
            ):
                raise ValueError(
                    "submission_value must be a valid GitHub URL when "
                    "submission_type is 'github_url'. "
                    f"Got: '{self.submission_value}'"
                )
        if self.submission_type == SubmissionType.IPFS_CID:
            v = self.submission_value
            if v.startswith("ipfs://"):
                v = v[len("ipfs://"):]
            if len(v) < 10:
                raise ValueError(
                    "submission_value does not look like a valid IPFS CID. "
                    f"Got: '{self.submission_value}'"
                )
        return self

    @field_validator("test_commands")
    @classmethod
    def validate_test_commands(cls, cmds: list[str]) -> list[str]:
        for cmd in cmds:
            if not cmd.strip().startswith("pytest"):
                raise ValueError(
                    f"Only pytest commands are supported in this prototype. "
                    f"Got: '{cmd}'"
                )
        return [c.strip() for c in cmds]


# ── Score / result sub-models ─────────────────────────────────────────────────

class ScoreBreakdown(BaseModel):
    test_pass_rate: float | None    = Field(None, ge=0.0, le=1.0)
    pylint_score: float | None      = Field(None, ge=0.0, le=1.0)
    flake8_score: float | None      = Field(None, ge=0.0, le=1.0)
    weighted_total: float | None    = Field(None, ge=0.0, le=1.0)
    test_contribution: float | None = None
    pylint_contribution: float | None = None
    flake8_contribution: float | None = None


class TestSummary(BaseModel):
    total: int   = 0
    passed: int  = 0
    failed: int  = 0
    errored: int = 0
    skipped: int = 0
    pass_rate: float = 0.0


class StaticSummary(BaseModel):
    pylint_raw_score: float  = 0.0
    pylint_score: float      = 0.0
    flake8_violations: int   = 0
    flake8_score: float      = 1.0


# ── Core Job model ────────────────────────────────────────────────────────────

class Job(BaseModel):
    """
    The canonical job record.  Created by POST /verify, returned by
    GET /result/{job_id}, listed by GET /jobs.
    """
    job_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
    )
    milestone_id: str
    submission_type: SubmissionType
    submission_value: str
    test_commands: list[str]
    acceptance_threshold: float

    # ── Lifecycle ─────────────────────────────────────────────────────────────
    status: JobStatus = JobStatus.PENDING
    verdict: Verdict  = Verdict.PENDING
    score: float | None = Field(None, ge=0.0, le=1.0)

    # ── Rich results (populated on COMPLETED) ─────────────────────────────────
    score_breakdown: ScoreBreakdown | None   = None
    test_summary: TestSummary | None         = None
    static_summary: StaticSummary | None     = None
    passed_tests: list[str]                  = Field(default_factory=list)
    failed_tests: list[dict[str, Any]]       = Field(default_factory=list)
    submission_hash: str | None              = None
    ipfs_cid: str | None                     = None   # set for ipfs_cid submissions

    # ── Error info (populated on FAILED) ──────────────────────────────────────
    error_code: str | None    = None
    error_message: str | None = None

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: datetime  = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None  = None
    completed_at: datetime | None = None

    @property
    def execution_time_seconds(self) -> float | None:
        if self.started_at and self.completed_at:
            return round((self.completed_at - self.started_at).total_seconds(), 3)
        return None


# ── API Response models ───────────────────────────────────────────────────────

class VerifyResponse(BaseModel):
    """Returned immediately by POST /verify (202 Accepted)."""
    job_id: str
    status: JobStatus
    message: str


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime_seconds: float
    jobs_processed: int
    jobs_pending: int


class ErrorResponse(BaseModel):
    """Consistent error envelope returned by the error middleware."""
    error: str
    code: str
    job_id: str | None = None
    detail: Any        = None
