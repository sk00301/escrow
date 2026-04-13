"""
tests/unit/test_endpoints.py
════════════════════════════════════════════════════════════════════════════════
Full TestClient test suite for all API endpoints.

Tests are grouped by endpoint:
  TestHealth         GET /health
  TestVerifyEndpoint POST /verify
  TestResultEndpoint GET /result/{job_id}
  TestJobsEndpoint   GET /jobs
  TestErrorHandling  Validation, 404, rate limiting
  TestCORS           CORS headers

All background verification tasks are patched so tests run instantly
without actually executing pytest/pylint/flake8.

Run:
    pytest tests/unit/test_endpoints.py -v
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter
from app.models.schemas import Job, JobStatus, SubmissionType, Verdict
from main import app


# ══════════════════════════════════════════════════════════════════════════════
#  Shared fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def client():
    """
    TestClient with a fresh JobStore and RateLimiter for every test.
    Using a context manager triggers the lifespan (startup/shutdown).
    """
    with TestClient(app, raise_server_exceptions=False) as c:
        # Reset shared state between tests
        app.state.job_store    = JobStore()
        app.state.rate_limiter = RateLimiter(max_calls=10, window_seconds=60)
        app.state.start_time   = time.monotonic()
        yield c


@pytest.fixture
def valid_github_payload() -> dict:
    return {
        "milestone_id": "milestone-test-001",
        "submission_type": "github_url",
        "submission_value": "https://github.com/example/test-repo",
        "test_commands": ["pytest tests/"],
        "acceptance_threshold": 0.75,
    }


@pytest.fixture
def valid_ipfs_payload() -> dict:
    return {
        "milestone_id": "milestone-test-002",
        "submission_type": "ipfs_cid",
        "submission_value": "QmXyz123abcdef456789",
        "test_commands": ["pytest tests/unit/"],
        "acceptance_threshold": 0.75,
    }


# A realistic result dict as returned by CodeVerifier.verify()
MOCK_RESULT: dict[str, Any] = {
    "final_score": 0.92,
    "verdict": "APPROVED",
    "submission_hash": "a" * 64,
    "passed_tests": [
        "tests/test_calc.py::test_add",
        "tests/test_calc.py::test_sub",
        "tests/test_calc.py::test_mul",
    ],
    "failed_tests": [],
    "test_results": {
        "total": 3, "passed": 3, "failed": 0,
        "errored": 0, "skipped": 0, "pass_rate": 1.0,
    },
    "static_analysis": {
        "pylint_raw_score": 9.0, "pylint_score": 0.9,
        "flake8_violations": 0,  "flake8_score": 1.0,
    },
    "weighted_breakdown": {
        "test_contribution": 0.60,
        "pylint_contribution": 0.225,
        "flake8_contribution": 0.15,
    },
    "execution_time_seconds": 1.23,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "raw_output": {"pytest": "3 passed", "pylint": "rated 9.00/10", "flake8": ""},
}

MOCK_FAILED_RESULT: dict[str, Any] = {
    "final_score": 0.20,
    "verdict": "REJECTED",
    "submission_hash": "b" * 64,
    "passed_tests": [],
    "failed_tests": [{"name": "tests/test_x.py::test_y", "status": "FAILED", "error": "AssertionError"}],
    "test_results": {
        "total": 1, "passed": 0, "failed": 1,
        "errored": 0, "skipped": 0, "pass_rate": 0.0,
    },
    "static_analysis": {
        "pylint_raw_score": 3.0, "pylint_score": 0.3,
        "flake8_violations": 40,  "flake8_score": 0.6,
    },
    "weighted_breakdown": {
        "test_contribution": 0.0,
        "pylint_contribution": 0.075,
        "flake8_contribution": 0.09,
    },
    "execution_time_seconds": 0.55,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "raw_output": {"pytest": "1 failed", "pylint": "rated 3.00/10", "flake8": "40 violations"},
}


# ══════════════════════════════════════════════════════════════════════════════
#  GET /health
# ══════════════════════════════════════════════════════════════════════════════

class TestHealth:

    def test_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_response_shape(self, client):
        data = client.get("/health").json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "uptime_seconds" in data
        assert "jobs_processed" in data
        assert "jobs_pending" in data

    def test_uptime_is_positive_float(self, client):
        data = client.get("/health").json()
        assert isinstance(data["uptime_seconds"], float)
        assert data["uptime_seconds"] >= 0.0

    def test_initial_counters_are_zero(self, client):
        data = client.get("/health").json()
        assert data["jobs_processed"] == 0
        assert data["jobs_pending"] == 0

    def test_pending_count_increments_after_submit(self, client, valid_github_payload):
        # Patch background task so it doesn't run
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            client.post("/verify", json=valid_github_payload)

        data = client.get("/health").json()
        assert data["jobs_pending"] == 1


# ══════════════════════════════════════════════════════════════════════════════
#  POST /verify
# ══════════════════════════════════════════════════════════════════════════════

class TestVerifyEndpoint:

    def test_github_url_accepted_202(self, client, valid_github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=valid_github_payload)
        assert resp.status_code == 202

    def test_response_contains_job_id(self, client, valid_github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            data = client.post("/verify", json=valid_github_payload).json()
        assert "job_id" in data
        # Should be a valid UUID
        uuid.UUID(data["job_id"])

    def test_response_status_is_pending(self, client, valid_github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            data = client.post("/verify", json=valid_github_payload).json()
        assert data["status"] == "PENDING"

    def test_response_contains_message(self, client, valid_github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            data = client.post("/verify", json=valid_github_payload).json()
        assert "message" in data
        assert data["job_id"] in data["message"]

    def test_ipfs_cid_accepted(self, client, valid_ipfs_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=valid_ipfs_payload)
        assert resp.status_code == 202

    def test_default_test_command_used_when_omitted(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=payload)
        assert resp.status_code == 202

    def test_missing_milestone_id_rejected(self, client):
        payload = {
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        resp = client.post("/verify", json=payload)
        assert resp.status_code == 422

    def test_invalid_submission_type_rejected(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "ftp_server",    # not a valid enum
            "submission_value": "ftp://example.com",
        }
        resp = client.post("/verify", json=payload)
        assert resp.status_code == 422

    def test_non_pytest_command_rejected(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
            "test_commands": ["rm -rf /"],   # should be rejected
        }
        resp = client.post("/verify", json=payload)
        assert resp.status_code == 422

    def test_bad_github_url_rejected(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://gitlab.com/a/b",   # not github
        }
        resp = client.post("/verify", json=payload)
        assert resp.status_code == 422

    def test_threshold_out_of_range_rejected(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
            "acceptance_threshold": 1.5,   # > 1.0
        }
        resp = client.post("/verify", json=payload)
        assert resp.status_code == 422

    def test_error_response_shape_on_validation_failure(self, client):
        resp = client.post("/verify", json={})
        data = resp.json()
        assert "error" in data
        assert "code" in data
        assert data["code"] == "VALIDATION_ERROR"

    def test_multiple_test_commands_accepted(self, client):
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
            "test_commands": ["pytest tests/unit/", "pytest tests/integration/"],
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=payload)
        assert resp.status_code == 202


# ══════════════════════════════════════════════════════════════════════════════
#  GET /result/{job_id}
# ══════════════════════════════════════════════════════════════════════════════

class TestResultEndpoint:

    def _submit(self, client, payload) -> str:
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            return client.post("/verify", json=payload).json()["job_id"]

    def test_pending_job_returns_200(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        resp = client.get(f"/result/{job_id}")
        assert resp.status_code == 200

    def test_pending_job_has_correct_status(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        data = client.get(f"/result/{job_id}").json()
        assert data["status"] == "PENDING"
        assert data["verdict"] == "PENDING"
        assert data["score"] is None

    def test_all_job_fields_present(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        data = client.get(f"/result/{job_id}").json()
        required = {
            "job_id", "milestone_id", "submission_type", "submission_value",
            "test_commands", "acceptance_threshold", "status", "verdict",
            "score", "created_at",
        }
        assert required.issubset(data.keys())

    def test_unknown_job_id_returns_404(self, client):
        resp = client.get(f"/result/{uuid.uuid4()}")
        assert resp.status_code == 404

    def test_404_error_shape(self, client):
        resp = client.get("/result/nonexistent-id")
        data = resp.json()
        assert "error" in data or "detail" in data

    def test_completed_job_has_score_and_verdict(self, client, valid_github_payload):
        """Manually mark a job completed and verify the result endpoint reflects it."""
        job_id = self._submit(client, valid_github_payload)

        # Directly update the store (simulates background task completing)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(job_id, MOCK_RESULT)
        )

        data = client.get(f"/result/{job_id}").json()
        assert data["status"] == "COMPLETED"
        assert data["verdict"] == "APPROVED"
        assert data["score"] == pytest.approx(0.92)

    def test_completed_job_has_score_breakdown(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(job_id, MOCK_RESULT)
        )
        data = client.get(f"/result/{job_id}").json()
        assert data["score_breakdown"] is not None
        assert "test_pass_rate" in data["score_breakdown"]

    def test_completed_job_has_test_summary(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(job_id, MOCK_RESULT)
        )
        data = client.get(f"/result/{job_id}").json()
        ts = data["test_summary"]
        assert ts["total"] == 3
        assert ts["passed"] == 3
        assert ts["pass_rate"] == 1.0

    def test_completed_job_has_passed_tests_list(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(job_id, MOCK_RESULT)
        )
        data = client.get(f"/result/{job_id}").json()
        assert len(data["passed_tests"]) == 3

    def test_failed_job_has_error_fields(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_failed(job_id, "NO_TESTS_FOUND", "No test files found.")
        )
        data = client.get(f"/result/{job_id}").json()
        assert data["status"] == "FAILED"
        assert data["error_code"] == "NO_TESTS_FOUND"
        assert data["error_message"] == "No test files found."

    def test_rejected_verdict_reflected(self, client, valid_github_payload):
        job_id = self._submit(client, valid_github_payload)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(job_id, MOCK_FAILED_RESULT)
        )
        data = client.get(f"/result/{job_id}").json()
        assert data["verdict"] == "REJECTED"
        assert data["score"] == pytest.approx(0.20)


# ══════════════════════════════════════════════════════════════════════════════
#  GET /jobs
# ══════════════════════════════════════════════════════════════════════════════

class TestJobsEndpoint:

    def _submit(self, client, milestone_id: str) -> str:
        payload = {
            "milestone_id": milestone_id,
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            return client.post("/verify", json=payload).json()["job_id"]

    def test_empty_store_returns_empty_list(self, client):
        data = client.get("/jobs").json()
        assert data == []

    def test_returns_all_submitted_jobs(self, client):
        self._submit(client, "m-001")
        self._submit(client, "m-002")
        self._submit(client, "m-003")
        data = client.get("/jobs").json()
        assert len(data) == 3

    def test_most_recent_first(self, client):
        self._submit(client, "m-001")
        self._submit(client, "m-002")
        jobs = client.get("/jobs").json()
        # created_at of first result should be >= second
        t0 = jobs[0]["created_at"]
        t1 = jobs[1]["created_at"]
        assert t0 >= t1

    def test_status_filter_pending(self, client):
        j1 = self._submit(client, "m-001")
        j2 = self._submit(client, "m-002")
        loop = asyncio.get_event_loop()
        loop.run_until_complete(
            app.state.job_store.mark_completed(j1, MOCK_RESULT)
        )
        # Only j2 should remain PENDING
        data = client.get("/jobs?status=PENDING").json()
        ids = [j["job_id"] for j in data]
        assert j2 in ids
        assert j1 not in ids

    def test_limit_parameter_respected(self, client):
        for i in range(5):
            self._submit(client, f"m-{i:03d}")
        data = client.get("/jobs?limit=2").json()
        assert len(data) == 2

    def test_offset_parameter_respected(self, client):
        for i in range(5):
            self._submit(client, f"m-{i:03d}")
        all_jobs   = client.get("/jobs?limit=5").json()
        page2_jobs = client.get("/jobs?limit=2&offset=2").json()
        assert page2_jobs[0]["job_id"] == all_jobs[2]["job_id"]


# ══════════════════════════════════════════════════════════════════════════════
#  Error handling
# ══════════════════════════════════════════════════════════════════════════════

class TestErrorHandling:

    def test_404_for_unknown_route(self, client):
        resp = client.get("/nonexistent-route")
        assert resp.status_code == 404

    def test_404_response_has_error_envelope(self, client):
        data = client.get("/nonexistent-route").json()
        assert "error" in data or "detail" in data

    def test_validation_error_has_code(self, client):
        resp = client.post("/verify", json={"milestone_id": ""})
        data = resp.json()
        assert resp.status_code == 422
        assert data.get("code") == "VALIDATION_ERROR"

    def test_validation_error_message_is_human_readable(self, client):
        resp = client.post("/verify", json={})
        data = resp.json()
        assert isinstance(data["error"], str)
        assert len(data["error"]) > 0

    def test_job_not_found_error_shape(self, client):
        resp = client.get("/result/does-not-exist")
        assert resp.status_code == 404
        # FastAPI wraps HTTPException detail — check either format
        body = resp.json()
        assert "detail" in body or "error" in body


# ══════════════════════════════════════════════════════════════════════════════
#  Rate limiting
# ══════════════════════════════════════════════════════════════════════════════

class TestRateLimiting:

    def test_within_limit_all_succeed(self, client):
        app.state.rate_limiter = RateLimiter(max_calls=5, window_seconds=60)
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            for _ in range(5):
                resp = client.post("/verify", json=payload)
                assert resp.status_code == 202

    def test_exceeding_limit_returns_429(self, client):
        app.state.rate_limiter = RateLimiter(max_calls=2, window_seconds=60)
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            client.post("/verify", json=payload)   # call 1 → 202
            client.post("/verify", json=payload)   # call 2 → 202
            resp = client.post("/verify", json=payload)   # call 3 → 429

        assert resp.status_code == 429

    def test_429_response_has_error_detail(self, client):
        app.state.rate_limiter = RateLimiter(max_calls=1, window_seconds=60)
        payload = {
            "milestone_id": "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            client.post("/verify", json=payload)
            resp = client.post("/verify", json=payload)

        # FastAPI wraps HTTPException.detail inside {"detail": ...}
        body = resp.json()
        detail = body.get("detail", body)
        assert "RATE_LIMIT_EXCEEDED" in str(detail)


# ══════════════════════════════════════════════════════════════════════════════
#  CORS
# ══════════════════════════════════════════════════════════════════════════════

class TestCORS:

    def test_cors_header_present_for_allowed_origin(self, client):
        resp = client.get(
            "/health",
            headers={"Origin": "http://localhost:3000"},
        )
        assert "access-control-allow-origin" in resp.headers

    def test_cors_allows_localhost_3000(self, client):
        resp = client.get(
            "/health",
            headers={"Origin": "http://localhost:3000"},
        )
        acao = resp.headers.get("access-control-allow-origin", "")
        assert acao in ("http://localhost:3000", "*")

    def test_preflight_options_succeeds(self, client):
        resp = client.options(
            "/verify",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert resp.status_code in (200, 204)


# ══════════════════════════════════════════════════════════════════════════════
#  JobStore unit tests
# ══════════════════════════════════════════════════════════════════════════════

class TestJobStore:

    @pytest.fixture
    def store(self):
        return JobStore()

    @pytest.mark.asyncio
    async def test_create_returns_pending_job(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        assert job.status == JobStatus.PENDING
        assert job.job_id is not None

    @pytest.mark.asyncio
    async def test_get_returns_created_job(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        fetched = await store.get(job.job_id)
        assert fetched is not None
        assert fetched.job_id == job.job_id

    @pytest.mark.asyncio
    async def test_get_unknown_returns_none(self, store):
        result = await store.get("nonexistent-id")
        assert result is None

    @pytest.mark.asyncio
    async def test_mark_running_updates_status(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        await store.mark_running(job.job_id)
        updated = await store.get(job.job_id)
        assert updated.status == JobStatus.RUNNING
        assert updated.started_at is not None

    @pytest.mark.asyncio
    async def test_mark_completed_populates_all_fields(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        await store.mark_completed(job.job_id, MOCK_RESULT)
        updated = await store.get(job.job_id)
        assert updated.status == JobStatus.COMPLETED
        assert updated.verdict == Verdict.APPROVED
        assert updated.score == pytest.approx(0.92)
        assert updated.submission_hash == "a" * 64
        assert len(updated.passed_tests) == 3
        assert updated.test_summary is not None
        assert updated.score_breakdown is not None

    @pytest.mark.asyncio
    async def test_mark_failed_sets_error_fields(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        await store.mark_failed(job.job_id, "NO_TESTS_FOUND", "No test files.")
        updated = await store.get(job.job_id)
        assert updated.status == JobStatus.FAILED
        assert updated.error_code == "NO_TESTS_FOUND"
        assert updated.error_message == "No test files."

    @pytest.mark.asyncio
    async def test_jobs_processed_increments_on_complete(self, store):
        job = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        assert store.jobs_processed == 0
        await store.mark_completed(job.job_id, MOCK_RESULT)
        assert store.jobs_processed == 1

    @pytest.mark.asyncio
    async def test_list_all_returns_most_recent_first(self, store):
        for i in range(3):
            await store.create(
                milestone_id=f"m-{i:03d}",
                submission_type=SubmissionType.GITHUB_URL,
                submission_value="https://github.com/a/b",
                test_commands=["pytest"],
                acceptance_threshold=0.75,
            )
        jobs = await store.list_all()
        times = [j.created_at for j in jobs]
        assert times == sorted(times, reverse=True)

    @pytest.mark.asyncio
    async def test_list_all_status_filter(self, store):
        j1 = await store.create(
            milestone_id="m-001",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        j2 = await store.create(
            milestone_id="m-002",
            submission_type=SubmissionType.GITHUB_URL,
            submission_value="https://github.com/a/b",
            test_commands=["pytest"],
            acceptance_threshold=0.75,
        )
        await store.mark_completed(j1.job_id, MOCK_RESULT)

        pending = await store.list_all(status_filter=JobStatus.PENDING)
        assert all(j.status == JobStatus.PENDING for j in pending)
        ids = [j.job_id for j in pending]
        assert j2.job_id in ids
        assert j1.job_id not in ids


# ══════════════════════════════════════════════════════════════════════════════
#  RateLimiter unit tests
# ══════════════════════════════════════════════════════════════════════════════

class TestRateLimiterUnit:

    @pytest.mark.asyncio
    async def test_allows_calls_within_limit(self):
        limiter = RateLimiter(max_calls=3, window_seconds=60)
        for _ in range(3):
            assert await limiter.is_allowed("client-a") is True

    @pytest.mark.asyncio
    async def test_blocks_call_over_limit(self):
        limiter = RateLimiter(max_calls=2, window_seconds=60)
        await limiter.is_allowed("client-a")
        await limiter.is_allowed("client-a")
        assert await limiter.is_allowed("client-a") is False

    @pytest.mark.asyncio
    async def test_different_clients_independent(self):
        limiter = RateLimiter(max_calls=1, window_seconds=60)
        assert await limiter.is_allowed("client-a") is True
        assert await limiter.is_allowed("client-b") is True  # different client

    @pytest.mark.asyncio
    async def test_remaining_decrements(self):
        limiter = RateLimiter(max_calls=5, window_seconds=60)
        await limiter.is_allowed("client-a")
        await limiter.is_allowed("client-a")
        remaining = await limiter.remaining("client-a")
        assert remaining == 3

    @pytest.mark.asyncio
    async def test_reset_clears_history(self):
        limiter = RateLimiter(max_calls=1, window_seconds=60)
        await limiter.is_allowed("client-a")   # uses the 1 slot
        assert await limiter.is_allowed("client-a") is False
        await limiter.reset("client-a")
        assert await limiter.is_allowed("client-a") is True  # slot freed
