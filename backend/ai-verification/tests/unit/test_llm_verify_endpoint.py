"""
tests/unit/test_llm_verify_endpoint.py

Tests for POST /llm-verify endpoint.

Strategy
────────
- CodeVerificationAgent.verify() is mocked for all tests — we are testing
  the endpoint wiring, not the agent logic (that is covered in test_code_agent.py).
- The LLM provider on app.state is a MagicMock.
- Background tasks are awaited inline using the TestClient's built-in support.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Shared verdict fixture
# ---------------------------------------------------------------------------

_APPROVED_VERDICT = {
    "score": 0.88,
    "verdict": "APPROVED",
    "confidence": 0.9,
    "requirements_met": [
        {"requirement": "implement add", "met": True, "evidence": "add() present"}
    ],
    "critical_issues": [],
    "minor_issues": ["no docstrings"],
    "strengths": ["all ops correct"],
    "score_breakdown": {
        "test_execution": 1.0,
        "code_quality": 0.8,
        "requirements_coverage": 0.9,
        "llm_reasoning": 0.85,
    },
    "reasoning": "All requirements met with only minor style issues.",
    "recommendation": "Add docstrings.",
    "submission_hash": "abc123",
    "tool_metrics": {
        "pytest_pass_rate": 1.0,
        "pylint_score": 8.5,
        "flake8_violations": 2,
        "total_loc": 42,
    },
}

_REJECTED_VERDICT = {**_APPROVED_VERDICT, "score": 0.20, "verdict": "REJECTED"}

_BASE_REQUEST = {
    "milestone_id": "test-milestone-001",
    "submission_type": "local_path",
    "submission_value": "./tests/fixtures/sample_submissions/01_calculator_complete",
    "test_commands": ["pytest tests/"],
    "acceptance_criteria": "Implement a calculator with add, subtract, multiply, divide.",
    "acceptance_threshold": 0.75,
}


# ---------------------------------------------------------------------------
# App fixture with mocked LLM provider
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_app():
    """Return a TestClient with a mocked LLM provider on app.state."""
    from main import app

    mock_llm = MagicMock()
    mock_llm.name = "ollama/llama3.2:3b"

    app.state.llm_provider = mock_llm
    return app


@pytest.fixture
def client(mock_app):
    return TestClient(mock_app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Helper: submit + wait for background task to complete
# ---------------------------------------------------------------------------

def _submit_and_wait(client: TestClient, body: dict, agent_verdict: dict) -> dict:
    """
    POST /llm-verify with a mocked agent, then poll GET /result/{job_id}
    until the job is no longer PENDING/RUNNING.
    """
    with patch(
        "app.api.endpoints.llm_verify.CodeVerificationAgent"
    ) as MockAgent:
        instance = MockAgent.return_value
        instance.verify = AsyncMock(return_value=agent_verdict)

        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 202, resp.text
        job_id = resp.json()["job_id"]

        # Poll until terminal state (TestClient runs background tasks synchronously)
        for _ in range(20):
            result = client.get(f"/result/{job_id}")
            if result.json().get("status") not in ("PENDING", "RUNNING"):
                break

        return result.json()


# ===========================================================================
# 1. HTTP response shape
# ===========================================================================

class TestHTTPResponseShape:

    def test_202_accepted(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        assert resp.status_code == 202

    def test_response_has_job_id(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        data = resp.json()
        assert "job_id" in data
        assert len(data["job_id"]) > 0

    def test_response_status_is_pending(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        assert resp.json()["status"] == "PENDING"

    def test_response_has_llm_provider(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        assert "llm_provider" in resp.json()
        assert resp.json()["llm_provider"] == "ollama/llama3.2:3b"

    def test_response_message_contains_job_id(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        data = resp.json()
        assert data["job_id"] in data["message"]


# ===========================================================================
# 2. Input validation
# ===========================================================================

class TestInputValidation:

    def test_acceptance_criteria_required(self, client):
        body = {k: v for k, v in _BASE_REQUEST.items() if k != "acceptance_criteria"}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_missing_milestone_id_returns_422(self, client):
        body = {k: v for k, v in _BASE_REQUEST.items() if k != "milestone_id"}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_acceptance_criteria_too_short_returns_422(self, client):
        body = {**_BASE_REQUEST, "acceptance_criteria": "short"}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_invalid_submission_type_returns_422(self, client):
        body = {**_BASE_REQUEST, "submission_type": "ftp_url"}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_non_pytest_command_returns_422(self, client):
        body = {**_BASE_REQUEST, "test_commands": ["npm test"]}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_threshold_above_1_returns_422(self, client):
        body = {**_BASE_REQUEST, "acceptance_threshold": 1.5}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_invalid_provider_override_returns_422(self, client):
        body = {**_BASE_REQUEST, "llm_provider_override": "gpt-5-turbo"}
        resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 422

    def test_valid_provider_override_accepted(self, client):
        body = {**_BASE_REQUEST, "llm_provider_override": "openai"}
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            with patch("app.services.llm.provider.LLMProvider.from_config") as mock_fc:
                mock_provider = MagicMock()
                mock_provider.name = "openai/gpt-4o-mini"
                mock_fc.return_value = mock_provider
                resp = client.post("/llm-verify", json=body)
        assert resp.status_code == 202

    def test_validation_error_has_code_field(self, client):
        body = {k: v for k, v in _BASE_REQUEST.items() if k != "acceptance_criteria"}
        resp = client.post("/llm-verify", json=body)
        assert resp.json().get("code") == "VALIDATION_ERROR"


# ===========================================================================
# 3. Job lifecycle — COMPLETED with full verdict in details
# ===========================================================================

class TestJobLifecycle:

    def test_job_transitions_to_completed(self, client):
        result = _submit_and_wait(client, _BASE_REQUEST, _APPROVED_VERDICT)
        assert result["status"] == "COMPLETED"

    def test_completed_job_has_verdict(self, client):
        result = _submit_and_wait(client, _BASE_REQUEST, _APPROVED_VERDICT)
        assert result["verdict"] == "APPROVED"

    def test_completed_job_has_score(self, client):
        result = _submit_and_wait(client, _BASE_REQUEST, _APPROVED_VERDICT)
        assert result["score"] is not None
        assert 0.0 <= result["score"] <= 1.0

    def test_completed_job_has_full_verdict_in_details(self, client):
        """
        The full LLM verdict dict must be stored in job.details so the
        frontend can display reasoning, requirements_met, etc.
        """
        result = _submit_and_wait(client, _BASE_REQUEST, _APPROVED_VERDICT)
        details = result.get("details")
        assert details is not None, "job.details must be populated on COMPLETED"
        assert "reasoning" in details
        assert "score_breakdown" in details
        assert "requirements_met" in details

    def test_rejected_verdict_stored_correctly(self, client):
        result = _submit_and_wait(client, _BASE_REQUEST, _REJECTED_VERDICT)
        assert result["verdict"] == "REJECTED"
        assert result["score"] < 0.45

    def test_job_has_llm_provider_field(self, client):
        result = _submit_and_wait(client, _BASE_REQUEST, _APPROVED_VERDICT)
        assert result.get("llm_provider") == "ollama/llama3.2:3b"


# ===========================================================================
# 4. Error handling
# ===========================================================================

class TestErrorHandling:

    def test_llm_unavailable_error_code(self, client):
        """When LLMProviderError is raised, job must fail with LLM_UNAVAILABLE."""
        from app.services.llm.provider import LLMProviderError

        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.verify = AsyncMock(
                side_effect=LLMProviderError("Ollama not running")
            )
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
            job_id = resp.json()["job_id"]

            for _ in range(20):
                result = client.get(f"/result/{job_id}")
                if result.json().get("status") not in ("PENDING", "RUNNING"):
                    break

        data = result.json()
        assert data["status"] == "FAILED"
        assert data["error_code"] == "LLM_UNAVAILABLE"

    def test_ingestion_failed_error_code(self, client):
        """Submission ingestion failures must use INGESTION_FAILED code."""
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.verify = AsyncMock(
                side_effect=Exception("ingestion failed: path not found")
            )
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
            job_id = resp.json()["job_id"]

            for _ in range(20):
                result = client.get(f"/result/{job_id}")
                if result.json().get("status") not in ("PENDING", "RUNNING"):
                    break

        data = result.json()
        assert data["status"] == "FAILED"
        assert data["error_code"] in ("INGESTION_FAILED", "VERIFICATION_FAILED")

    def test_unknown_job_id_returns_404(self, client):
        resp = client.get("/result/nonexistent-job-id-xyz")
        assert resp.status_code == 404


# ===========================================================================
# 5. Rate limiting
# ===========================================================================

class TestRateLimiting:

    def test_calls_within_limit_succeed(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            for _ in range(5):
                resp = client.post("/llm-verify", json=_BASE_REQUEST)
                assert resp.status_code == 202

    def test_call_over_limit_returns_429(self, client):
        """After 10 requests the 11th must be rate-limited."""
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            for _ in range(10):
                client.post("/llm-verify", json=_BASE_REQUEST)
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        assert resp.status_code == 429

    def test_429_body_has_rate_limit_code(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            for _ in range(10):
                client.post("/llm-verify", json=_BASE_REQUEST)
            resp = client.post("/llm-verify", json=_BASE_REQUEST)
        assert resp.json()["code"] == "RATE_LIMIT_EXCEEDED"


# ===========================================================================
# 6. CORS
# ===========================================================================

class TestCORS:

    def test_cors_header_present(self, client):
        resp = client.options(
            "/llm-verify",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert resp.status_code in (200, 204)

    def test_cors_allows_localhost_3000(self, client):
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            resp = client.post(
                "/llm-verify",
                json=_BASE_REQUEST,
                headers={"Origin": "http://localhost:3000"},
            )
        assert "access-control-allow-origin" in resp.headers


# ===========================================================================
# 7. Backward compatibility — existing /verify still works
# ===========================================================================

class TestBackwardCompatibility:

    def test_old_verify_endpoint_still_works(self, client):
        """POST /verify must continue to return 202 after adding /llm-verify."""
        old_body = {
            "milestone_id": "old-milestone-001",
            "submission_type": "github_url",
            "submission_value": "https://github.com/alice/repo",
            "test_commands": ["pytest tests/"],
        }
        resp = client.post("/verify", json=old_body)
        assert resp.status_code == 202

    def test_old_verify_returns_job_id(self, client):
        old_body = {
            "milestone_id": "old-milestone-002",
            "submission_type": "github_url",
            "submission_value": "https://github.com/alice/repo",
        }
        resp = client.post("/verify", json=old_body)
        assert "job_id" in resp.json()

    def test_old_verify_no_acceptance_criteria_required(self, client):
        """The old /verify endpoint must NOT require acceptance_criteria."""
        old_body = {
            "milestone_id": "old-milestone-003",
            "submission_type": "local_path",
            "submission_value": "./some/path",
        }
        resp = client.post("/verify", json=old_body)
        # Should be 202, not 422
        assert resp.status_code == 202

    def test_llm_verify_and_verify_independent_job_stores(self, client):
        """Jobs from /verify and /llm-verify must coexist in the same job store."""
        old_body = {
            "milestone_id": "old-001",
            "submission_type": "local_path",
            "submission_value": "./path",
        }
        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent"):
            llm_resp = client.post("/llm-verify", json=_BASE_REQUEST)
        old_resp = client.post("/verify", json=old_body)

        llm_job_id = llm_resp.json()["job_id"]
        old_job_id = old_resp.json()["job_id"]

        assert llm_job_id != old_job_id
        assert client.get(f"/result/{llm_job_id}").status_code == 200
        assert client.get(f"/result/{old_job_id}").status_code == 200


# ===========================================================================
# 8. Dependency injection
# ===========================================================================

class TestDependencyInjection:

    def test_llm_provider_from_app_state_is_used(self, mock_app, client):
        """The endpoint must use app.state.llm_provider, not a new instance."""
        provider_used = []

        with patch("app.api.endpoints.llm_verify.CodeVerificationAgent") as MockAgent:
            def capture_llm(llm, config):
                provider_used.append(llm)
                instance = MagicMock()
                instance.verify = AsyncMock(return_value=_APPROVED_VERDICT)
                return instance
            MockAgent.side_effect = capture_llm
            client.post("/llm-verify", json=_BASE_REQUEST)

        assert len(provider_used) == 1
        assert provider_used[0] is mock_app.state.llm_provider
