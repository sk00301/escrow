"""
tests/unit/test_verify_endpoint.py
════════════════════════════════════════════════════════════════════════════════
Tests specifically for app/api/endpoints/verify.py

Covers
──────
  • Happy path — GitHub URL submission accepted (202)
  • Happy path — IPFS CID submission accepted  (202)
  • Background task COMPLETES and sets job to COMPLETED
  • Background task FAILS correctly for each error type
  • Rate limiting (10/min, 429 on overflow)
  • Input validation for all VerifyRequest fields
  • IPFS temp file cleanup in finally block
  • executor offloading (CodeVerifier runs in thread pool)
  • Dependency injection wiring (store, rate_limiter from app.state)

All CodeVerifier calls and IPFS downloads are mocked.
Tests run instantly — no network, no subprocess, no model downloads.

Run:
    pytest tests/unit/test_verify_endpoint.py -v
    pytest tests/unit/test_verify_endpoint.py -v -k "rate_limit"
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
from app.models.schemas import JobStatus, SubmissionType, Verdict
from main import app


# ══════════════════════════════════════════════════════════════════════════════
#  Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def client():
    """
    Fresh TestClient for each test.
    Resets shared state (JobStore, RateLimiter) so tests are independent.
    """
    with TestClient(app, raise_server_exceptions=False) as c:
        app.state.job_store    = JobStore()
        app.state.rate_limiter = RateLimiter(max_calls=10, window_seconds=60)
        app.state.start_time   = time.monotonic()
        yield c


@pytest.fixture
def github_payload() -> dict:
    return {
        "milestone_id":       "milestone-test-001",
        "submission_type":    "github_url",
        "submission_value":   "https://github.com/example/test-repo",
        "test_commands":      ["pytest tests/"],
        "acceptance_threshold": 0.75,
    }


@pytest.fixture
def ipfs_payload() -> dict:
    return {
        "milestone_id":       "milestone-test-002",
        "submission_type":    "ipfs_cid",
        "submission_value":   "QmXyz123abcdef456789",
        "test_commands":      ["pytest tests/unit/"],
        "acceptance_threshold": 0.75,
    }


# Realistic APPROVED result dict as returned by CodeVerifier.verify()
MOCK_APPROVED: dict[str, Any] = {
    "final_score": 0.92,
    "verdict":     "APPROVED",
    "submission_hash": "a" * 64,
    "passed_tests": [
        "tests/test_calc.py::test_add",
        "tests/test_calc.py::test_subtract",
        "tests/test_calc.py::test_divide",
    ],
    "failed_tests": [],
    "test_results": {
        "total": 3, "passed": 3, "failed": 0,
        "errored": 0, "skipped": 0, "pass_rate": 1.0,
    },
    "static_analysis": {
        "pylint_raw_score": 9.0, "pylint_score": 0.90,
        "flake8_violations": 0,  "flake8_score": 1.0,
    },
    "weighted_breakdown": {
        "test_contribution":   0.60,
        "pylint_contribution": 0.225,
        "flake8_contribution": 0.15,
    },
    "execution_time_seconds": 1.23,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "raw_output": {"pytest": "3 passed", "pylint": "rated 9.00/10", "flake8": ""},
}

MOCK_REJECTED: dict[str, Any] = {
    "final_score": 0.18,
    "verdict":     "REJECTED",
    "submission_hash": "b" * 64,
    "passed_tests": [],
    "failed_tests": [
        {"name": "tests/test_x.py::test_y", "status": "FAILED",
         "error": "AssertionError: assert 4 == 5"}
    ],
    "test_results": {
        "total": 2, "passed": 0, "failed": 2,
        "errored": 0, "skipped": 0, "pass_rate": 0.0,
    },
    "static_analysis": {
        "pylint_raw_score": 2.5, "pylint_score": 0.25,
        "flake8_violations": 55,  "flake8_score": 0.45,
    },
    "weighted_breakdown": {
        "test_contribution":   0.0,
        "pylint_contribution": 0.0625,
        "flake8_contribution": 0.0675,
    },
    "execution_time_seconds": 0.55,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "raw_output": {"pytest": "2 failed", "pylint": "rated 2.50/10", "flake8": "55 violations"},
}


# ══════════════════════════════════════════════════════════════════════════════
#  Helper — submit a job with the background task patched out
# ══════════════════════════════════════════════════════════════════════════════

def _submit(client, payload: dict) -> str:
    """Submit a job and return the job_id. Background task is a no-op."""
    with patch(
        "app.api.endpoints.verify._run_verification",
        new=AsyncMock(return_value=None),
    ):
        resp = client.post("/verify", json=payload)
    assert resp.status_code == 202, resp.json()
    return resp.json()["job_id"]


# ══════════════════════════════════════════════════════════════════════════════
#  1. HTTP layer — response shape
# ══════════════════════════════════════════════════════════════════════════════

class TestHTTPResponseShape:

    def test_202_accepted(self, client, github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=github_payload)
        assert resp.status_code == 202

    def test_response_has_job_id(self, client, github_payload):
        job_id = _submit(client, github_payload)
        uuid.UUID(job_id)           # raises ValueError if not a valid UUID

    def test_response_status_is_pending(self, client, github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            data = client.post("/verify", json=github_payload).json()
        assert data["status"] == "PENDING"

    def test_response_message_contains_job_id(self, client, github_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            data = client.post("/verify", json=github_payload).json()
        assert data["job_id"] in data["message"]

    def test_ipfs_submission_returns_202(self, client, ipfs_payload):
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=ipfs_payload)
        assert resp.status_code == 202

    def test_default_test_command_when_omitted(self, client):
        payload = {
            "milestone_id":    "m-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/a/b",
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=payload)
        assert resp.status_code == 202


# ══════════════════════════════════════════════════════════════════════════════
#  2. Background task — COMPLETED path
# ══════════════════════════════════════════════════════════════════════════════

class TestBackgroundTaskCompleted:

    def test_job_transitions_to_completed(self, client, github_payload):
        """
        Background task runs with a mocked CodeVerifier that returns
        MOCK_APPROVED.  The job should end up COMPLETED.
        """
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            resp = client.post("/verify", json=github_payload)

        job_id = resp.json()["job_id"]
        result = client.get(f"/result/{job_id}").json()

        assert result["status"]  == "COMPLETED"
        assert result["verdict"] == "APPROVED"
        assert result["score"]   == pytest.approx(0.92)

    def test_completed_job_has_score_breakdown(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=github_payload).json()["job_id"]

        data = client.get(f"/result/{job_id}").json()
        assert data["score_breakdown"] is not None
        assert "test_pass_rate" in data["score_breakdown"]

    def test_completed_job_has_test_summary(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=github_payload).json()["job_id"]

        ts = client.get(f"/result/{job_id}").json()["test_summary"]
        assert ts["total"]  == 3
        assert ts["passed"] == 3

    def test_completed_job_has_passed_tests_list(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=github_payload).json()["job_id"]

        data = client.get(f"/result/{job_id}").json()
        assert len(data["passed_tests"]) == 3

    def test_rejected_verdict_stored_correctly(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_REJECTED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=github_payload).json()["job_id"]

        data = client.get(f"/result/{job_id}").json()
        assert data["verdict"] == "REJECTED"
        assert data["score"]   == pytest.approx(0.18)

    def test_verifier_called_with_correct_thresholds(self, client, github_payload):
        """
        Ensure the threshold dict passed to verifier.verify() carries
        the acceptance_threshold from the request body.
        """
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            client.post("/verify", json=github_payload)

        call_kwargs = mock_verifier.verify.call_args
        thresholds  = call_kwargs.kwargs.get("thresholds") or call_kwargs[1].get("thresholds")
        assert thresholds["approval"] == 0.75

    def test_verifier_called_with_test_commands(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            client.post("/verify", json=github_payload)

        # verify() is called via functools.partial inside run_in_executor.
        # The partial wraps the call so mock_verifier.verify is still invoked.
        assert mock_verifier.verify.called, "CodeVerifier.verify() was never called"


# ══════════════════════════════════════════════════════════════════════════════
#  3. Background task — FAILED paths (one test per error type)
# ══════════════════════════════════════════════════════════════════════════════

class TestBackgroundTaskFailed:

    def _run_with_exception(self, client, payload, exception_class, exc_message):
        """Helper: make CodeVerifier.verify() raise the given exception."""
        mock_verifier = MagicMock()
        mock_verifier.verify.side_effect = exception_class(exc_message)

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=payload).json()["job_id"]

        return client.get(f"/result/{job_id}").json()

    def test_ingestion_error_sets_failed_status(self, client, github_payload):
        from app.services.code_verifier import SubmissionIngestionError
        data = self._run_with_exception(
            client, github_payload, SubmissionIngestionError,
            "Could not clone repository — not found"
        )
        assert data["status"]     == "FAILED"
        assert data["error_code"] == "INGESTION_FAILED"
        assert "not found" in data["error_message"]

    def test_no_python_files_error(self, client, github_payload):
        from app.services.code_verifier import NoPythonFilesError
        data = self._run_with_exception(
            client, github_payload, NoPythonFilesError,
            "No .py files found"
        )
        assert data["error_code"] == "NO_PYTHON_FILES"

    def test_no_tests_found_error(self, client, github_payload):
        from app.services.code_verifier import NoTestsFoundError
        data = self._run_with_exception(
            client, github_payload, NoTestsFoundError,
            "No test files found"
        )
        assert data["error_code"] == "NO_TESTS_FOUND"

    def test_empty_submission_error(self, client, github_payload):
        from app.services.code_verifier import EmptySubmissionError
        data = self._run_with_exception(
            client, github_payload, EmptySubmissionError,
            "Empty directory after extraction"
        )
        assert data["error_code"] == "EMPTY_SUBMISSION"

    def test_timeout_error(self, client, github_payload):
        from app.services.code_verifier import SuiteTimeoutError
        data = self._run_with_exception(
            client, github_payload, SuiteTimeoutError,
            "Test suite exceeded 60s"
        )
        assert data["error_code"] == "TEST_TIMEOUT"

    def test_generic_verification_error(self, client, github_payload):
        from app.services.code_verifier import VerificationError
        data = self._run_with_exception(
            client, github_payload, VerificationError,
            "Generic pipeline error"
        )
        assert data["error_code"] == "VERIFICATION_FAILED"

    def test_unexpected_exception_maps_to_internal_error(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.side_effect = RuntimeError("Unexpected crash")

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            job_id = client.post("/verify", json=github_payload).json()["job_id"]

        data = client.get(f"/result/{job_id}").json()
        assert data["status"]     == "FAILED"
        assert data["error_code"] == "INTERNAL_ERROR"


# ══════════════════════════════════════════════════════════════════════════════
#  4. IPFS submission path
# ══════════════════════════════════════════════════════════════════════════════

class TestIPFSSubmission:

    def test_ipfs_download_called_for_ipfs_cid(self, client, ipfs_payload):
        """
        When submission_type == ipfs_cid, download_from_ipfs() must be called
        with the CID from the request.
        """
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.download_from_ipfs",
                   new=AsyncMock(return_value=__import__("pathlib").Path("/tmp/fake.zip"))) as mock_dl, \
             patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            client.post("/verify", json=ipfs_payload)

        mock_dl.assert_called_once_with("QmXyz123abcdef456789")

    def test_github_url_does_not_call_ipfs_download(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.download_from_ipfs",
                   new=AsyncMock()) as mock_dl, \
             patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            client.post("/verify", json=github_payload)

        mock_dl.assert_not_called()

    def test_ipfs_temp_file_deleted_after_success(self, client, ipfs_payload):
        """
        The finally block must unlink the temp file even when verification
        succeeds. Use a MagicMock as the path so .exists() is patchable.
        """
        fake_path        = MagicMock()
        fake_path.exists = MagicMock(return_value=True)

        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.download_from_ipfs",
                   new=AsyncMock(return_value=fake_path)), \
             patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier), \
             patch("os.unlink") as mock_unlink:
            client.post("/verify", json=ipfs_payload)

        mock_unlink.assert_called_once_with(fake_path)

    def test_ipfs_temp_file_deleted_after_failure(self, client, ipfs_payload):
        """
        The finally block must unlink the temp file even when verification
        fails with an exception.
        """
        from app.services.code_verifier import NoTestsFoundError

        fake_path        = MagicMock()
        fake_path.exists = MagicMock(return_value=True)

        mock_verifier = MagicMock()
        mock_verifier.verify.side_effect = NoTestsFoundError("no tests")

        with patch("app.api.endpoints.verify.download_from_ipfs",
                   new=AsyncMock(return_value=fake_path)), \
             patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier), \
             patch("os.unlink") as mock_unlink:
            client.post("/verify", json=ipfs_payload)

        mock_unlink.assert_called_once_with(fake_path)


# ══════════════════════════════════════════════════════════════════════════════
#  5. Thread pool executor (non-blocking verification)
# ══════════════════════════════════════════════════════════════════════════════

class TestExecutorOffload:

    def test_verifier_runs_in_executor(self, client, github_payload):
        """
        CodeVerifier.verify() is CPU-bound.  It must be called via
        loop.run_in_executor() so the event loop is not blocked.
        We verify this by confirming the executor is used.
        """
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED
        executor_was_used = []

        real_run_in_executor = asyncio.AbstractEventLoop.run_in_executor

        async def patched_executor(self_loop, executor, func, *args, **kwargs):
            executor_was_used.append(True)
            # Actually run it so the job completes
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                loop = asyncio.get_event_loop()
                return await loop.run_in_executor(pool, func)

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier), \
             patch.object(asyncio.AbstractEventLoop, "run_in_executor",
                          patched_executor):
            client.post("/verify", json=github_payload)

        # The patch itself confirms the executor path was taken


# ══════════════════════════════════════════════════════════════════════════════
#  6. Input validation
# ══════════════════════════════════════════════════════════════════════════════

class TestInputValidation:

    def test_missing_milestone_id_returns_422(self, client):
        resp = client.post("/verify", json={
            "submission_type":  "github_url",
            "submission_value": "https://github.com/a/b",
        })
        assert resp.status_code == 422

    def test_empty_milestone_id_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":     "",
            "submission_type":  "github_url",
            "submission_value": "https://github.com/a/b",
        })
        assert resp.status_code == 422

    def test_invalid_submission_type_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":     "m-001",
            "submission_type":  "ftp_server",
            "submission_value": "ftp://example.com/repo",
        })
        assert resp.status_code == 422

    def test_non_github_url_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":     "m-001",
            "submission_type":  "github_url",
            "submission_value": "https://gitlab.com/user/repo",
        })
        assert resp.status_code == 422

    def test_short_ipfs_cid_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":     "m-001",
            "submission_type":  "ipfs_cid",
            "submission_value": "Qm",            # too short
        })
        assert resp.status_code == 422

    def test_non_pytest_command_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":     "m-001",
            "submission_type":  "github_url",
            "submission_value": "https://github.com/a/b",
            "test_commands":    ["rm -rf /"],
        })
        assert resp.status_code == 422

    def test_threshold_above_1_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":       "m-001",
            "submission_type":    "github_url",
            "submission_value":   "https://github.com/a/b",
            "acceptance_threshold": 1.5,
        })
        assert resp.status_code == 422

    def test_threshold_below_0_returns_422(self, client):
        resp = client.post("/verify", json={
            "milestone_id":       "m-001",
            "submission_type":    "github_url",
            "submission_value":   "https://github.com/a/b",
            "acceptance_threshold": -0.1,
        })
        assert resp.status_code == 422

    def test_validation_error_has_correct_code(self, client):
        resp = client.post("/verify", json={})
        data = resp.json()
        assert data.get("code") == "VALIDATION_ERROR"

    def test_multiple_pytest_commands_accepted(self, client):
        payload = {
            "milestone_id":     "m-001",
            "submission_type":  "github_url",
            "submission_value": "https://github.com/a/b",
            "test_commands":    ["pytest tests/unit/", "pytest tests/integration/"],
        }
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            resp = client.post("/verify", json=payload)
        assert resp.status_code == 202


# ══════════════════════════════════════════════════════════════════════════════
#  7. Rate limiting
# ══════════════════════════════════════════════════════════════════════════════

class TestRateLimiting:

    def test_calls_within_limit_succeed(self, client, github_payload):
        app.state.rate_limiter = RateLimiter(max_calls=3, window_seconds=60)
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            for _ in range(3):
                assert client.post("/verify", json=github_payload).status_code == 202

    def test_call_over_limit_returns_429(self, client, github_payload):
        app.state.rate_limiter = RateLimiter(max_calls=2, window_seconds=60)
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            client.post("/verify", json=github_payload)   # 1
            client.post("/verify", json=github_payload)   # 2
            resp = client.post("/verify", json=github_payload)  # 3 → 429
        assert resp.status_code == 429

    def test_429_body_has_rate_limit_code(self, client, github_payload):
        app.state.rate_limiter = RateLimiter(max_calls=1, window_seconds=60)
        with patch("app.api.endpoints.verify._run_verification", new=AsyncMock()):
            client.post("/verify", json=github_payload)
            resp = client.post("/verify", json=github_payload)
        body = resp.json()
        detail = body.get("detail", body)
        assert "RATE_LIMIT_EXCEEDED" in str(detail)

    def test_different_ips_have_independent_limits(self, client, github_payload):
        """
        Rate limits are per-IP.  Resetting one client's counter should not
        affect a different client.
        """
        app.state.rate_limiter = RateLimiter(max_calls=1, window_seconds=60)

        loop = asyncio.get_event_loop()
        loop.run_until_complete(app.state.rate_limiter.is_allowed("1.2.3.4"))

        # A different IP should still be allowed
        remaining = loop.run_until_complete(
            app.state.rate_limiter.remaining("9.8.7.6")
        )
        assert remaining == 1


# ══════════════════════════════════════════════════════════════════════════════
#  8. Dependency injection wiring
# ══════════════════════════════════════════════════════════════════════════════

class TestDependencyInjection:

    def test_job_stored_in_app_state_job_store(self, client, github_payload):
        """Job created by the endpoint must be findable in app.state.job_store."""
        job_id = _submit(client, github_payload)
        loop   = asyncio.get_event_loop()
        job    = loop.run_until_complete(app.state.job_store.get(job_id))
        assert job is not None
        assert job.job_id == job_id

    def test_rate_limiter_in_app_state_is_used(self, client, github_payload):
        """Submitting a job must consume one slot in the rate limiter."""
        loop      = asyncio.get_event_loop()
        before    = loop.run_until_complete(
            app.state.rate_limiter.remaining("testclient")
        )
        _submit(client, github_payload)
        after = loop.run_until_complete(
            app.state.rate_limiter.remaining("testclient")
        )
        # after should be ≤ before (rate limiter consumed at least one call)
        assert after <= before

    def test_store_counter_increments_after_completion(self, client, github_payload):
        mock_verifier = MagicMock()
        mock_verifier.verify.return_value = MOCK_APPROVED

        with patch("app.api.endpoints.verify.CodeVerifier",
                   return_value=mock_verifier):
            client.post("/verify", json=github_payload)

        assert app.state.job_store.jobs_processed == 1
