"""
tests/unit/test_milestone_resolver.py
──────────────────────────────────────
Unit tests for MilestoneResolver — the SRS parser that extracts
MilestoneScope objects from the ## Milestone Deliverables section.

Coverage
────────
  - Happy path: single milestone, two milestones, three milestones
  - Missing section → empty list (backwards-compat fallback)
  - Missing optional fields → safe defaults
  - Weight normalisation (non-summing weights are corrected)
  - get() API: found, not found, None-section SRS
  - MilestoneScope model validator: weight normalisation in schema
  - Backwards compatibility: existing VerifyRequest without scope still valid
  - Regression: full-SRS cases still produce unchanged verdicts with no scope

Run with:
    pytest tests/unit/test_milestone_resolver.py -v
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.schemas import MilestoneScope, VerifyRequest, LLMVerifyRequest, SubmissionType
from app.services.milestone_resolver import MilestoneResolver


# ── Fixtures ──────────────────────────────────────────────────────────────────

EXAMPLE_SRS = """\
# Software Requirements Specification

## 1. Project Overview

**Project Name:** Calculator

## 2. Functions / Classes Required

### Function: `add(a, b)`
Returns a + b.

## 4. Acceptance Criteria

- MUST implement add, subtract, multiply, divide

## 9. Milestone Deliverables

### Milestone 1 — Core scaffold
**Due:** 2026-07-01
**Required functions:** add, subtract
**Required keywords:** basic arithmetic, input validation
**Test scope:** pytest tests/unit/m1/
**Acceptance criteria:** Implement add(a, b) and subtract(a, b) with docstrings.

### Milestone 2 — Multiplication and division
**Due:** 2026-07-15
**Required functions:** multiply, divide
**Required keywords:** zero division, ValueError
**Test scope:** pytest tests/unit/m2/
**Acceptance criteria:** Implement multiply and divide. divide() MUST raise ValueError for zero.
**Weight test:** 0.70
**Weight pylint:** 0.20
**Weight flake8:** 0.10

### Milestone 3 — Final delivery
**Due:** 2026-08-01
**Required functions:** add, subtract, multiply, divide, power, modulo
**Required keywords:** basic arithmetic, zero division
**Test scope:** pytest tests/
**Acceptance criteria:** Full implementation of all six functions.
"""

MINIMAL_SRS_NO_MILESTONES = """\
# SRS

## 1. Project Overview

Nothing here about milestones.

## 4. Acceptance Criteria

- MUST implement add
"""

SRS_MISSING_OPTIONAL_FIELDS = """\
# SRS

## 9. Milestone Deliverables

### Milestone 1 — Bare minimum
**Acceptance criteria:** Just do something.
"""

SRS_BAD_WEIGHTS = """\
# SRS

## 9. Milestone Deliverables

### Milestone 1 — Weighted
**Required functions:** add
**Test scope:** pytest tests/unit/
**Acceptance criteria:** Implement add.
**Weight test:** 0.50
**Weight pylint:** 0.30
**Weight flake8:** 0.40
"""

# ── MilestoneResolver tests ───────────────────────────────────────────────────

class TestMilestoneResolverParse:

    def setup_method(self):
        self.resolver = MilestoneResolver()

    def test_parse_returns_all_milestones(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        assert len(scopes) == 3

    def test_milestones_are_ordered_by_number(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        numbers = [s.milestone_number for s in scopes]
        assert numbers == sorted(numbers)

    def test_milestone_1_fields(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        m1 = scopes[0]
        assert m1.milestone_number == 1
        assert m1.label == "Core scaffold"
        assert "add" in m1.required_functions
        assert "subtract" in m1.required_functions
        assert "basic arithmetic" in m1.required_keywords
        assert "input validation" in m1.required_keywords
        assert m1.test_scope == ["pytest tests/unit/m1/"]
        assert "add(a, b)" in m1.acceptance_criteria or "add" in m1.acceptance_criteria

    def test_milestone_2_fields(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        m2 = scopes[1]
        assert m2.milestone_number == 2
        assert m2.label == "Multiplication and division"
        assert "multiply" in m2.required_functions
        assert "divide" in m2.required_functions
        assert "zero division" in m2.required_keywords

    def test_milestone_2_weight_overrides(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        m2 = scopes[1]
        assert "weight_test" in m2.weight_overrides
        assert abs(m2.weight_overrides["weight_test"] - 0.70) < 0.01
        assert abs(m2.weight_overrides["weight_pylint"] - 0.20) < 0.01
        assert abs(m2.weight_overrides["weight_flake8"] - 0.10) < 0.01

    def test_milestone_3_full_test_scope(self):
        scopes = self.resolver.parse(EXAMPLE_SRS)
        m3 = scopes[2]
        assert "pytest tests/" in m3.test_scope[0]

    def test_no_milestone_section_returns_empty_list(self):
        scopes = self.resolver.parse(MINIMAL_SRS_NO_MILESTONES)
        assert scopes == []

    def test_empty_string_returns_empty_list(self):
        scopes = self.resolver.parse("")
        assert scopes == []

    def test_missing_optional_fields_use_defaults(self):
        scopes = self.resolver.parse(SRS_MISSING_OPTIONAL_FIELDS)
        assert len(scopes) == 1
        m1 = scopes[0]
        assert m1.required_functions == []
        assert m1.required_keywords == []
        assert m1.test_scope == ["pytest"]   # default when not specified
        assert m1.weight_overrides == {}

    def test_bad_weights_are_normalised(self):
        """Weights summing to 1.2 instead of 1.0 must be normalised."""
        scopes = self.resolver.parse(SRS_BAD_WEIGHTS)
        assert len(scopes) == 1
        overrides = scopes[0].weight_overrides
        total = sum(overrides.values())
        assert abs(total - 1.0) < 0.01, f"Weights should sum to 1.0, got {total}"

    def test_test_scope_gets_pytest_prefix(self):
        """Entries missing 'pytest' prefix should be prefixed automatically."""
        srs = """\
## 9. Milestone Deliverables

### Milestone 1 — Bare
**Test scope:** tests/unit/m1/
**Acceptance criteria:** Do things.
"""
        scopes = self.resolver.parse(srs)
        assert scopes[0].test_scope[0].startswith("pytest")

    def test_multiple_test_scope_commands(self):
        srs = """\
## 9. Milestone Deliverables

### Milestone 1 — Multi
**Test scope:** pytest tests/unit/, pytest tests/integration/
**Acceptance criteria:** Do things.
"""
        scopes = self.resolver.parse(srs)
        assert len(scopes[0].test_scope) == 2
        assert all(c.startswith("pytest") for c in scopes[0].test_scope)


class TestMilestoneResolverGet:

    def setup_method(self):
        self.resolver = MilestoneResolver()

    def test_get_existing_milestone(self):
        scope = self.resolver.get(EXAMPLE_SRS, milestone_number=2)
        assert scope is not None
        assert scope.milestone_number == 2
        assert scope.label == "Multiplication and division"

    def test_get_nonexistent_milestone_returns_none(self):
        scope = self.resolver.get(EXAMPLE_SRS, milestone_number=99)
        assert scope is None

    def test_get_from_srs_without_section_returns_none(self):
        scope = self.resolver.get(MINIMAL_SRS_NO_MILESTONES, milestone_number=1)
        assert scope is None

    def test_get_milestone_1(self):
        scope = self.resolver.get(EXAMPLE_SRS, milestone_number=1)
        assert scope is not None
        assert scope.milestone_number == 1


# ── MilestoneScope model validator tests ──────────────────────────────────────

class TestMilestoneScopeModel:

    def test_valid_scope_constructs(self):
        scope = MilestoneScope(
            milestone_number=1,
            label="Core scaffold",
            required_functions=["add", "subtract"],
            required_keywords=["basic arithmetic"],
            test_scope=["pytest tests/unit/m1/"],
            acceptance_criteria="Implement add and subtract.",
        )
        assert scope.milestone_number == 1
        assert scope.label == "Core scaffold"

    def test_weight_overrides_normalised_by_validator(self):
        scope = MilestoneScope(
            milestone_number=1,
            label="Test",
            weight_overrides={"weight_test": 6, "weight_pylint": 2, "weight_flake8": 2},
        )
        total = sum(scope.weight_overrides.values())
        assert abs(total - 1.0) < 0.01

    def test_already_normalised_weights_unchanged(self):
        scope = MilestoneScope(
            milestone_number=1,
            label="Test",
            weight_overrides={"weight_test": 0.60, "weight_pylint": 0.25, "weight_flake8": 0.15},
        )
        assert abs(scope.weight_overrides["weight_test"] - 0.60) < 0.001

    def test_invalid_test_scope_raises(self):
        with pytest.raises(ValidationError):
            MilestoneScope(
                milestone_number=1,
                label="Test",
                test_scope=["npm test"],   # must start with pytest
            )

    def test_empty_weight_overrides_allowed(self):
        scope = MilestoneScope(milestone_number=1, label="Test")
        assert scope.weight_overrides == {}

    def test_defaults_are_safe(self):
        scope = MilestoneScope(milestone_number=1, label="Minimal")
        assert scope.required_functions == []
        assert scope.required_keywords == []
        assert scope.test_scope == ["pytest"]
        assert scope.acceptance_criteria == ""


# ── Backwards compatibility tests ─────────────────────────────────────────────

class TestBackwardsCompatibility:
    """
    Ensure existing code that sends VerifyRequest / LLMVerifyRequest
    without milestone_scope continues to work unchanged.
    """

    def test_verify_request_without_scope_is_valid(self):
        req = VerifyRequest(
            milestone_id="milestone-42",
            submission_type=SubmissionType.LOCAL_PATH,
            submission_value="/tmp/submission",
            test_commands=["pytest tests/"],
            acceptance_threshold=0.75,
        )
        assert req.milestone_scope is None

    def test_verify_request_with_scope_is_valid(self):
        req = VerifyRequest(
            milestone_id="milestone-42",
            submission_type=SubmissionType.LOCAL_PATH,
            submission_value="/tmp/submission",
            test_commands=["pytest tests/"],
            acceptance_threshold=0.75,
            milestone_scope=MilestoneScope(
                milestone_number=1,
                label="Core scaffold",
                test_scope=["pytest tests/unit/m1/"],
                acceptance_criteria="Implement add and subtract.",
            ),
        )
        assert req.milestone_scope is not None
        assert req.milestone_scope.milestone_number == 1

    def test_llm_verify_request_without_scope_is_valid(self):
        req = LLMVerifyRequest(
            milestone_id="milestone-42",
            submission_type=SubmissionType.LOCAL_PATH,
            submission_value="/tmp/submission",
            acceptance_criteria="Implement the full calculator.",
        )
        assert req.milestone_scope is None

    def test_llm_verify_request_with_scope_uses_scope_criteria(self):
        scope = MilestoneScope(
            milestone_number=2,
            label="Division",
            acceptance_criteria="Implement divide() raising ValueError for zero.",
        )
        req = LLMVerifyRequest(
            milestone_id="milestone-42",
            submission_type=SubmissionType.LOCAL_PATH,
            submission_value="/tmp/submission",
            acceptance_criteria="Full SRS acceptance criteria (used for audit only).",
            milestone_scope=scope,
        )
        assert req.milestone_scope.acceptance_criteria == (
            "Implement divide() raising ValueError for zero."
        )


# ── Regression: full-SRS path unaffected ─────────────────────────────────────

class TestFullSRSRegression:
    """
    When no milestone_scope is supplied, DocumentVerifier and CodeVerifier
    must behave exactly as before — no accidental changes to the legacy path.
    """

    def test_document_verifier_without_scope_uses_passed_keywords(self):
        """
        DocumentVerifier.verify() called without milestone_scope must use
        the required_keywords argument as before.
        """
        from unittest.mock import MagicMock, patch
        from app.services.document_verifier import DocumentVerifier

        mock_model = MagicMock()
        mock_model.encode.return_value = [[0.1, 0.2], [0.1, 0.2]]

        verifier = DocumentVerifier(_model_override=mock_model)
        result = verifier.verify(
            submitted_document="This document covers basic arithmetic and input validation.",
            requirement_specification="Implement add and subtract.",
            required_keywords=["basic arithmetic", "input validation"],
            milestone_scope=None,
        )

        assert result["keywords"]["required"] == ["basic arithmetic", "input validation"]
        assert result["milestone"]["scope_applied"] is False

    def test_document_verifier_with_scope_uses_scope_keywords(self):
        """
        DocumentVerifier.verify() with milestone_scope must use
        scope.required_keywords, ignoring the required_keywords argument.
        """
        from unittest.mock import MagicMock
        from app.services.document_verifier import DocumentVerifier

        mock_model = MagicMock()
        mock_model.encode.return_value = [[0.1, 0.2], [0.1, 0.2]]

        scope = MilestoneScope(
            milestone_number=1,
            label="Core scaffold",
            required_keywords=["add", "subtract"],
            acceptance_criteria="Implement add and subtract.",
        )

        verifier = DocumentVerifier(_model_override=mock_model)
        result = verifier.verify(
            submitted_document="This covers add and subtract operations.",
            requirement_specification="Full SRS spec.",
            required_keywords=["should", "be", "ignored"],
            milestone_scope=scope,
        )

        assert result["keywords"]["required"] == ["add", "subtract"]
        assert result["milestone"]["scope_applied"] is True
        assert result["milestone"]["number"] == 1
        assert result["milestone"]["label"] == "Core scaffold"
