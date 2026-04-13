"""
app/core/job_store.py
─────────────────────
Thread-safe in-memory job store backed by asyncio.Lock.

Why asyncio.Lock instead of threading.Lock?
  FastAPI runs on an async event loop. asyncio.Lock releases the event loop
  while waiting, so other coroutines can run. threading.Lock would block the
  entire event loop thread.

For the prototype this is sufficient. To graduate to persistence, replace
the `_store` dict with async SQLAlchemy session calls — the public interface
(create/get/update/list/delete) stays identical.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.models.schemas import (
    Job,
    JobStatus,
    ScoreBreakdown,
    StaticSummary,
    TestSummary,
    Verdict,
    SubmissionType,
)

logger = logging.getLogger(__name__)


class JobStore:
    """
    CRUD operations for Job records.

    Usage (FastAPI dependency)
    --------------------------
        # In main.py
        job_store = JobStore()

        # In endpoint
        async def verify(store: JobStore = Depends(get_job_store)):
            job = await store.create(...)
    """

    def __init__(self) -> None:
        self._store: dict[str, Job] = {}
        self._lock  = asyncio.Lock()
        # Counters exposed by GET /health
        self._total_created: int   = 0
        self._total_completed: int = 0

    # ── Create ────────────────────────────────────────────────────────────────

    async def create(
        self,
        milestone_id: str,
        submission_type: SubmissionType,
        submission_value: str,
        test_commands: list[str],
        acceptance_threshold: float,
    ) -> Job:
        """Instantiate and persist a new PENDING job."""
        job = Job(
            milestone_id=milestone_id,
            submission_type=submission_type,
            submission_value=submission_value,
            test_commands=test_commands,
            acceptance_threshold=acceptance_threshold,
        )
        async with self._lock:
            self._store[job.job_id] = job
            self._total_created += 1

        logger.info(
            "job_created",
            extra={"job_id": job.job_id, "milestone": milestone_id},
        )
        return job

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get(self, job_id: str) -> Job | None:
        """Return the job or None if not found."""
        async with self._lock:
            return self._store.get(job_id)

    async def list_all(
        self,
        status_filter: JobStatus | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Job]:
        """Return jobs sorted most-recent first, with optional status filter."""
        async with self._lock:
            jobs = list(self._store.values())

        if status_filter:
            jobs = [j for j in jobs if j.status == status_filter]

        jobs.sort(key=lambda j: j.created_at, reverse=True)
        return jobs[offset : offset + limit]

    # ── Update helpers ────────────────────────────────────────────────────────

    async def mark_running(self, job_id: str) -> None:
        """Transition job to RUNNING and record start time."""
        async with self._lock:
            job = self._store.get(job_id)
            if job:
                job.status     = JobStatus.RUNNING
                job.started_at = datetime.now(timezone.utc)

    async def mark_completed(self, job_id: str, result: dict[str, Any]) -> Job | None:
        """
        Transition job to COMPLETED and populate all result fields from the
        explainability bundle returned by CodeVerifier.verify().
        """
        async with self._lock:
            job = self._store.get(job_id)
            if not job:
                return None

            job.status       = JobStatus.COMPLETED
            job.completed_at = datetime.now(timezone.utc)
            job.score        = result.get("final_score")
            job.verdict      = Verdict(result.get("verdict", "PENDING"))
            job.submission_hash = result.get("submission_hash")
            job.passed_tests = result.get("passed_tests", [])
            job.failed_tests = result.get("failed_tests", [])

            # Score breakdown
            wb = result.get("weighted_breakdown", {})
            sa = result.get("static_analysis", {})
            tr = result.get("test_results", {})
            job.score_breakdown = ScoreBreakdown(
                test_pass_rate      = tr.get("pass_rate"),
                pylint_score        = sa.get("pylint_score"),
                flake8_score        = sa.get("flake8_score"),
                weighted_total      = result.get("final_score"),
                test_contribution   = wb.get("test_contribution"),
                pylint_contribution = wb.get("pylint_contribution"),
                flake8_contribution = wb.get("flake8_contribution"),
            )
            # Test summary
            job.test_summary = TestSummary(
                total   = tr.get("total",    0),
                passed  = tr.get("passed",   0),
                failed  = tr.get("failed",   0),
                errored = tr.get("errored",  0),
                skipped = tr.get("skipped",  0),
                pass_rate = tr.get("pass_rate", 0.0),
            )
            # Static analysis summary
            job.static_summary = StaticSummary(
                pylint_raw_score  = sa.get("pylint_raw_score",  0.0),
                pylint_score      = sa.get("pylint_score",      0.0),
                flake8_violations = sa.get("flake8_violations", 0),
                flake8_score      = sa.get("flake8_score",      1.0),
            )

            self._total_completed += 1
            logger.info(
                "job_completed",
                extra={
                    "job_id": job_id,
                    "score": job.score,
                    "verdict": job.verdict,
                },
            )
            return job

    async def mark_failed(
        self, job_id: str, error_code: str, error_message: str
    ) -> Job | None:
        """Transition job to FAILED with error details."""
        async with self._lock:
            job = self._store.get(job_id)
            if not job:
                return None

            job.status        = JobStatus.FAILED
            job.completed_at  = datetime.now(timezone.utc)
            job.error_code    = error_code
            job.error_message = error_message
            self._total_completed += 1

        logger.error(
            "job_failed  job_id=%s  code=%s  detail=%s",
            job_id, error_code, error_message,
        )
        return job

    # ── Counters for /health ──────────────────────────────────────────────────

    @property
    def jobs_processed(self) -> int:
        return self._total_completed

    @property
    def jobs_pending(self) -> int:
        # Count live — no lock needed for a read of a simple dict len
        return sum(
            1 for j in self._store.values()
            if j.status in (JobStatus.PENDING, JobStatus.RUNNING)
        )
