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


# ── Milestone scope model ─────────────────────────────────────────────────────

class MilestoneScope(BaseModel):
    """
    Deliverable constraints for a single project milestone.

    Populated either by the client directly (structured request) or by
    MilestoneResolver parsing the SRS  ## Milestone Deliverables  section.

    When a MilestoneScope is attached to a verification request the
    pipeline restricts ALL checks to this scope:
      - CodeVerifier  uses  test_scope  instead of the top-level test_commands
      - DocumentVerifier  uses  required_keywords  and  acceptance_criteria
      - LLM agent  uses  acceptance_criteria  instead of the full SRS text

    If no scope is provided, legacy full-SRS behaviour is used (backwards
    compatible with all existing jobs).
    """

    milestone_number: int = Field(
        ...,
        ge=1,
        description="1-based milestone number matching the SRS section.",
        examples=[1, 2, 3],
    )
    label: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Short human-readable milestone title, e.g. 'Core scaffold'.",
        examples=["Core scaffold", "Advanced operations", "Final delivery"],
    )
    required_functions: list[str] = Field(
        default_factory=list,
        description=(
            "Function/method names that MUST be implemented for this milestone. "
            "CodeVerifier and the LLM agent check for their presence."
        ),
        examples=[["add", "subtract"], ["multiply", "divide"]],
    )
    required_keywords: list[str] = Field(
        default_factory=list,
        description=(
            "Keywords or phrases that must appear in a document submission. "
            "DocumentVerifier checks these instead of the full SRS keyword list."
        ),
        examples=[["basic arithmetic", "input validation"], ["zero division"]],
    )
    test_scope: list[str] = Field(
        default=["pytest"],
        description=(
            "Pytest commands to execute for this milestone. "
            "Replaces the top-level test_commands when a scope is provided."
        ),
        examples=[["pytest tests/unit/m1/"], ["pytest tests/unit/m2/ -v"]],
    )
    acceptance_criteria: str = Field(
        default="",
        max_length=4096,
        description=(
            "Milestone-specific acceptance criteria text. "
            "Used as the specification for LLM and DocumentVerifier evaluation "
            "instead of the full SRS requirement text."
        ),
    )
    weight_overrides: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Optional per-milestone scoring weight overrides. "
            "Keys: weight_test, weight_pylint, weight_flake8 (code) "
            "or weight_similarity, weight_keywords, weight_structure (document). "
            "Values are normalised to sum to 1.0 if they do not already."
        ),
        examples=[{"weight_test": 0.70, "weight_pylint": 0.20, "weight_flake8": 0.10}],
    )

    @model_validator(mode="after")
    def normalise_weights(self) -> "MilestoneScope":
        """Silently normalise weights that don't sum to 1.0 (±0.01)."""
        if not self.weight_overrides:
            return self
        total = sum(self.weight_overrides.values())
        if total == 0 or abs(total - 1.0) < 0.01:
            return self
        self.weight_overrides = {
            k: round(v / total, 6) for k, v in self.weight_overrides.items()
        }
        return self

    @field_validator("test_scope")
    @classmethod
    def validate_test_scope(cls, cmds: list[str]) -> list[str]:
        for cmd in cmds:
            if not cmd.strip().startswith("pytest"):
                raise ValueError(
                    f"test_scope entries must be pytest commands. Got: '{cmd}'"
                )
        return [c.strip() for c in cmds]


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
    milestone_scope: MilestoneScope | None = Field(
        default=None,
        description=(
            "Optional milestone scope. When provided, the verifier restricts all "
            "checks (test commands, keywords, acceptance criteria) to this scope only. "
            "When None, legacy full-SRS verification is used."
        ),
    )

    @field_validator("submission_value")
    @classmethod
    def validate_submission_value(cls, v: str, info) -> str:
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


# ── NEW: LLM endpoint request / response ─────────────────────────────────────

class LLMVerifyRequest(BaseModel):
    """
    Body for  POST /llm-verify

    Extends VerifyRequest with acceptance_criteria (required) and an
    optional per-request LLM provider override.

    Example:
        {
          "milestone_id": "milestone-42",
          "submission_type": "local_path",
          "submission_value": "./tests/fixtures/sample_submissions/01_calculator_complete",
          "test_commands": ["pytest tests/ -v"],
          "acceptance_criteria": "Implement a calculator with add, subtract, multiply,
                                  divide (zero-division guard), power, sqrt, modulo.",
          "acceptance_threshold": 0.75
        }
    """
    milestone_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="On-chain milestone ID",
        examples=["milestone-42"],
    )
    submission_type: SubmissionType = Field(
        ...,
        description="How the submission is delivered",
    )
    submission_value: str = Field(
        ...,
        min_length=1,
        max_length=512,
        description="GitHub repo URL, IPFS CID, or local path",
    )
    test_commands: list[str] = Field(
        default=["pytest"],
        min_length=1,
        description="Pytest commands to execute",
    )
    acceptance_criteria: str = Field(
        ...,
        min_length=10,
        max_length=4096,
        description=(
            "Human-readable description of what the submission must do. "
            "This is the primary input to the LLM reasoning pipeline."
        ),
        examples=[
            "Implement a calculator with add, subtract, multiply, divide. "
            "Handle division by zero with a ZeroDivisionError."
        ],
    )
    acceptance_threshold: float = Field(
        default=0.75,
        ge=0.0,
        le=1.0,
        description="Score threshold for APPROVED verdict.",
    )
    llm_provider_override: str | None = Field(
        default=None,
        description=(
            "Optional per-request LLM provider override. "
            "Accepts: 'ollama', 'openai', 'anthropic'. "
            "Defaults to the server-configured LLM_PROVIDER env var."
        ),
        examples=["openai", "ollama", None],
    )
    milestone_scope: MilestoneScope | None = Field(
        default=None,
        description=(
            "Optional milestone scope. When provided, the LLM agent evaluates "
            "the submission only against this milestone's acceptance_criteria and "
            "required_functions, not the full SRS. When None, the top-level "
            "acceptance_criteria field is used (legacy behaviour)."
        ),
    )

    @field_validator("submission_value")
    @classmethod
    def strip_submission_value(cls, v: str) -> str:
        return v.strip()

    @model_validator(mode="after")
    def validate_submission(self) -> "LLMVerifyRequest":
        if self.submission_type == SubmissionType.GITHUB_URL:
            if not self.submission_value.startswith(
                ("https://github.com", "http://github.com", "git@github.com")
            ):
                raise ValueError(
                    f"submission_value must be a valid GitHub URL. "
                    f"Got: '{self.submission_value}'"
                )
        if self.submission_type == SubmissionType.IPFS_CID:
            v = self.submission_value
            if v.startswith("ipfs://"):
                v = v[len("ipfs://"):]
            if len(v) < 10:
                raise ValueError(
                    f"submission_value does not look like a valid IPFS CID. "
                    f"Got: '{self.submission_value}'"
                )
        return self

    @field_validator("test_commands")
    @classmethod
    def validate_test_commands(cls, cmds: list[str]) -> list[str]:
        for cmd in cmds:
            if not cmd.strip().startswith("pytest"):
                raise ValueError(
                    f"Only pytest commands are supported. Got: '{cmd}'"
                )
        return [c.strip() for c in cmds]

    @field_validator("llm_provider_override")
    @classmethod
    def validate_provider_override(cls, v: str | None) -> str | None:
        if v is not None and v not in ("ollama", "openai", "anthropic"):
            raise ValueError(
                f"llm_provider_override must be one of: ollama, openai, anthropic. "
                f"Got: '{v}'"
            )
        return v


class LLMVerifyResponse(BaseModel):
    """Returned immediately by POST /llm-verify (202 Accepted)."""
    job_id: str
    status: JobStatus
    message: str
    llm_provider: str = Field(
        description="Which LLM provider is processing this job (for frontend display).",
        examples=["ollama/llama3.2:3b", "openai/gpt-4o-mini"],
    )


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
    The canonical job record.  Created by POST /verify or POST /llm-verify,
    returned by GET /result/{job_id}, listed by GET /jobs.
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
    ipfs_cid: str | None                     = None

    # ── LLM-specific fields (populated for /llm-verify jobs) ──────────────────
    details: dict[str, Any] | None = Field(
        default=None,
        description="Full LLM verdict dict for /llm-verify jobs.",
    )
    llm_provider: str | None = Field(
        default=None,
        description="Which LLM provider processed this job.",
    )
    acceptance_criteria: str | None = Field(
        default=None,
        description="The acceptance criteria used for LLM evaluation.",
    )

    # ── Milestone scope (populated when a scoped request is made) ─────────────
    milestone_scope: MilestoneScope | None = Field(
        default=None,
        description=(
            "The milestone scope used for this job. None means full-SRS evaluation."
        ),
    )
    milestone_scope_label: str | None = Field(
        default=None,
        description=(
            "Human-readable scope label for the frontend, e.g. 'Milestone 1 — Core scaffold'. "
            "None when no scope was applied."
        ),
    )

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
