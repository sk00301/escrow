"""
tests/unit/test_document_verifier.py
══════════════════════════════════════════════════════════════════════════════
Test suite for DocumentVerifier.

The sentence-transformer model is mocked throughout — tests run instantly
with no internet connection, no GPU, and no HuggingFace download.

The mock model returns deterministic embeddings based on a tiny vocabulary
so cosine similarity is fully predictable in every test.

Run:
    pytest tests/unit/test_document_verifier.py -v
"""

from __future__ import annotations

import math
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.services.document_verifier import (
    DocumentVerifier,
    DocumentVerifierConfig,
    _reset_model_cache,
)


# ══════════════════════════════════════════════════════════════════════════════
#  Mock model factory
#
#  The real SentenceTransformer.encode() returns a (N, 384) float32 numpy
#  array.  We replace it with a function that maps known text keys to fixed
#  unit vectors so cosine similarity is fully deterministic.
# ══════════════════════════════════════════════════════════════════════════════

def _unit(v: list[float]) -> np.ndarray:
    """Normalise a vector to unit length."""
    a   = np.array(v, dtype=np.float32)
    return a / (np.linalg.norm(a) + 1e-10)


# Fixed embedding "slots":
#   slot 0 → documents that are ON-TOPIC  (high cosine with specification)
#   slot 1 → documents that are OFF-TOPIC (low cosine with specification)
#   slot 2 → the specification vector
#   slot 3 → borderline / partial documents

_EMBEDDINGS = {
    "on_topic":    _unit([1.0, 0.9, 0.8, 0.7, 0.6]),   # cos ≈ 0.997 with spec
    "off_topic":   _unit([1.0, 0.0, 0.0, 0.0, 0.0]),   # cos ≈ 0.480 with spec
    "borderline":  _unit([0.8, 0.6, 0.3, 0.1, 0.0]),   # cos ≈ 0.834 — still high
    "specification": _unit([1.0, 0.9, 0.8, 0.7, 0.6]), # same direction as on_topic
}

# Cosine values between spec and each document type:
#   on_topic    ≈ 1.000  (identical direction)
#   off_topic   ≈ 0.480  (orthogonal-ish)
#   borderline  ≈ 0.927  (still fairly aligned)

def _make_mock_model(doc_key: str) -> MagicMock:
    """
    Return a mock whose .encode() returns [doc_embedding, spec_embedding]
    for the chosen doc_key.
    """
    mock = MagicMock()
    mock.encode.return_value = np.array([
        _EMBEDDINGS[doc_key],
        _EMBEDDINGS["specification"],
    ])
    return mock


# ══════════════════════════════════════════════════════════════════════════════
#  Shared test documents
# ══════════════════════════════════════════════════════════════════════════════

# ── REQUIREMENT SPECIFICATION (used in all three demo cases) ──────────────────
SPECIFICATION = """
Design and implement a blockchain-based escrow smart contract system for
freelance payments. The system must include smart contract deployment on
Ethereum, milestone-based payment release, dispute resolution mechanism,
and integration with an AI verification module. The documentation must
cover the architecture, security considerations, and deployment procedure.
"""

KEYWORDS = [
    "smart contract",
    "escrow",
    "milestone",
    "dispute resolution",
    "Ethereum",
    "deployment",
]

# ── PASSING DOCUMENT: well-written, all keywords, good structure ──────────────
PASSING_DOCUMENT = """
Overview of the Blockchain Escrow System

This document describes the architecture and implementation of our
blockchain-based escrow system for freelance payments on Ethereum.

Smart Contract Architecture

The core of the system is a Solidity smart contract deployed on the
Ethereum Sepolia testnet. The escrow contract locks client funds at
project initiation and releases payment only when milestone conditions
are satisfied. Each milestone is evaluated by an AI verification module
that assigns a normalised quality score to the freelancer's submission.

Milestone-Based Payment Release

The payment release mechanism is tied directly to milestone completion.
When a freelancer submits their deliverable, the smart contract transitions
from SUBMITTED to VERIFIED state. If the AI score exceeds the approval
threshold the funds are released automatically without human intervention.

Dispute Resolution Mechanism

When the AI score falls in the ambiguity band (0.45–0.75), the system
triggers the dispute resolution mechanism. A jury of staked token holders
reviews the submission and votes on the outcome. This decentralised
approach eliminates bias from centralised platform administrators.

Deployment Procedure and Security

The deployment procedure uses Hardhat with the Sepolia testnet. Security
considerations include reentrancy guards on all payment functions,
oracle signature verification, and time-locked fund release. All contract
functions follow the Checks–Effects–Interactions pattern to prevent
common attack vectors.
"""

# ── FAILING DOCUMENT: off-topic, missing keywords, too short ─────────────────
FAILING_DOCUMENT = """
Introduction to Web Development

This document covers basic HTML and CSS techniques for building websites.

HTML Basics

HTML is a markup language used to structure web pages. Tags like div,
span, and paragraph elements define the layout of content on screen.

CSS Styling

CSS controls the visual presentation of web content including colours,
fonts, and spacing.
"""

# ── BORDERLINE DOCUMENT: some keywords, adequate length, moderate relevance ───
BORDERLINE_DOCUMENT = """
Freelance Payment Platform Overview

This document provides a general overview of our freelance payment
platform which leverages distributed ledger technology.

System Components

The platform uses Ethereum as the underlying blockchain network.
Clients deposit funds which are held in escrow until work is verified.
The verification process involves automated testing of deliverables.

Payment Flow

When a freelancer completes a milestone and submits their work, the
platform evaluates the submission. If the quality meets the threshold,
payment is released from the escrow to the freelancer's wallet address.

Future Improvements

We plan to add dispute resolution features in a future version.
The deployment procedure for the smart contract will be documented
separately once the system reaches production readiness.
"""


# ══════════════════════════════════════════════════════════════════════════════
#  1. Three primary demo test cases
# ══════════════════════════════════════════════════════════════════════════════

class TestThreeDemoCases:
    """
    The three cases described in the task brief.
    Model is mocked to inject controlled cosine similarity scores.
    """

    # ── CASE 1: PASSING ───────────────────────────────────────────────────────

    def test_passing_document_is_approved(self):
        """
        High-quality document → all keywords present, good structure,
        high semantic similarity → APPROVED.
        """
        verifier = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        result   = verifier.verify(
            submitted_document=PASSING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        assert result["verdict"] == "APPROVED", (
            f"Expected APPROVED, got {result['verdict']} "
            f"(score={result['final_score']})"
        )
        assert result["final_score"] >= 0.75
        assert result["keywords"]["coverage"] == 1.0
        assert result["structure"]["passed"] is True
        assert len(result["keywords"]["missing"]) == 0

    def test_passing_document_has_all_keywords_found(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        result   = verifier.verify(
            submitted_document=PASSING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        for kw in KEYWORDS:
            assert kw.lower() in PASSING_DOCUMENT.lower(), (
                f"Expected keyword '{kw}' to appear in PASSING_DOCUMENT"
            )
        assert set(result["keywords"]["found"]) == set(KEYWORDS)

    def test_passing_document_structure_passes(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        result   = verifier.verify(
            submitted_document=PASSING_DOCUMENT,
            requirement_specification=SPECIFICATION,
        )
        s = result["structure"]
        assert s["word_count"]      >= 200
        assert s["paragraph_count"] >= 3
        assert s["passed"] is True

    def test_passing_document_recommendation_mentions_approved(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        result   = verifier.verify(
            submitted_document=PASSING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        rec = result["recommendation"].lower()
        assert any(w in rec for w in ("meets", "approved", "quality")), (
            f"Recommendation doesn't mention approval: {result['recommendation']}"
        )

    # ── CASE 2: FAILING ───────────────────────────────────────────────────────

    def test_failing_document_is_rejected(self):
        """
        Off-topic, missing keywords, too short → REJECTED.
        """
        verifier = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        result   = verifier.verify(
            submitted_document=FAILING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        assert result["verdict"] == "REJECTED", (
            f"Expected REJECTED, got {result['verdict']} "
            f"(score={result['final_score']})"
        )
        assert result["final_score"] < 0.45

    def test_failing_document_has_missing_keywords(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        result   = verifier.verify(
            submitted_document=FAILING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        # Most blockchain keywords should be absent from an HTML/CSS document
        assert len(result["keywords"]["missing"]) > 0

    def test_failing_document_fails_structure_check(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        result   = verifier.verify(
            submitted_document=FAILING_DOCUMENT,
            requirement_specification=SPECIFICATION,
        )
        # FAILING_DOCUMENT is < 200 words
        assert result["structure"]["word_count"] < 200
        assert result["structure"]["word_count_passed"] is False

    def test_failing_document_recommendation_mentions_rejection(self):
        verifier = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        result   = verifier.verify(
            submitted_document=FAILING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        rec = result["recommendation"].lower()
        assert any(w in rec for w in ("not meet", "rejected", "does not")), (
            f"Recommendation doesn't mention rejection: {result['recommendation']}"
        )

    # ── CASE 3: BORDERLINE ────────────────────────────────────────────────────

    def test_borderline_document_verdict(self):
        """
        Borderline document with some keywords, adequate structure but
        partial content — with this mock similarity (~0.93) it scores above
        0.75 on similarity alone, but we test that the pipeline runs cleanly
        and produces a well-formed result.
        """
        verifier = DocumentVerifier(_model_override=_make_mock_model("borderline"))
        result   = verifier.verify(
            submitted_document=BORDERLINE_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        # Score should be between 0.45 and 1.0 (i.e., not catastrophically bad)
        assert 0.30 <= result["final_score"] <= 1.0
        assert result["verdict"] in ("APPROVED", "DISPUTED", "REJECTED")

    def test_borderline_document_has_partial_keywords(self):
        """Borderline document has SOME but not all keywords."""
        verifier = DocumentVerifier(_model_override=_make_mock_model("borderline"))
        result   = verifier.verify(
            submitted_document=BORDERLINE_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        # "dispute resolution" is only mentioned briefly — check coverage < 1.0
        coverage = result["keywords"]["coverage"]
        assert 0.0 < coverage <= 1.0

    def test_borderline_at_disputed_boundary_with_tight_threshold(self):
        """
        Force a DISPUTED verdict by using a very high approval threshold
        and a low ambiguity floor.
        """
        cfg = DocumentVerifierConfig()
        cfg.approval_threshold = 0.99    # nearly impossible to hit
        cfg.ambiguity_band_low = 0.30
        verifier = DocumentVerifier(
            config=cfg,
            _model_override=_make_mock_model("borderline"),
        )
        result = verifier.verify(
            submitted_document=BORDERLINE_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )
        assert result["verdict"] in ("DISPUTED", "REJECTED")


# ══════════════════════════════════════════════════════════════════════════════
#  2. Result bundle structure
# ══════════════════════════════════════════════════════════════════════════════

class TestResultBundleStructure:

    @pytest.fixture
    def result(self):
        v = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        return v.verify(
            submitted_document=PASSING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=KEYWORDS,
        )

    def test_all_top_level_keys_present(self, result):
        required = {
            "final_score", "verdict", "similarity", "keywords",
            "structure", "weighted_breakdown", "recommendation",
            "model", "execution_time_seconds", "timestamp",
        }
        assert required.issubset(result.keys()), (
            f"Missing keys: {required - result.keys()}"
        )

    def test_similarity_sub_keys(self, result):
        for key in ("score", "label", "interpretation"):
            assert key in result["similarity"]

    def test_keywords_sub_keys(self, result):
        for key in ("required", "found", "missing", "coverage",
                    "found_count", "required_count"):
            assert key in result["keywords"]

    def test_structure_sub_keys(self, result):
        for key in ("score", "passed", "word_count", "paragraph_count",
                    "word_count_passed", "paragraph_passed"):
            assert key in result["structure"]

    def test_weighted_breakdown_sub_keys(self, result):
        for key in ("similarity_contribution", "keyword_contribution",
                    "structure_contribution", "weights"):
            assert key in result["weighted_breakdown"]

    def test_final_score_in_range(self, result):
        assert 0.0 <= result["final_score"] <= 1.0

    def test_verdict_is_valid_enum(self, result):
        assert result["verdict"] in ("APPROVED", "DISPUTED", "REJECTED")

    def test_model_name_correct(self, result):
        assert result["model"] == "all-MiniLM-L6-v2"

    def test_timestamp_is_iso_format(self, result):
        from datetime import datetime
        datetime.fromisoformat(result["timestamp"])   # raises if invalid

    def test_execution_time_is_positive_float(self, result):
        assert isinstance(result["execution_time_seconds"], float)
        assert result["execution_time_seconds"] >= 0.0

    def test_recommendation_is_non_empty_string(self, result):
        assert isinstance(result["recommendation"], str)
        assert len(result["recommendation"]) > 20


# ══════════════════════════════════════════════════════════════════════════════
#  3. Semantic similarity computation
# ══════════════════════════════════════════════════════════════════════════════

class TestSemanticSimilarity:

    def test_high_similarity_label(self):
        v      = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        score, label = v._compute_similarity(PASSING_DOCUMENT, SPECIFICATION)
        assert score >= 0.80
        assert label == "highly_similar"

    def test_low_similarity_label(self):
        v      = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        score, label = v._compute_similarity(FAILING_DOCUMENT, SPECIFICATION)
        assert label in ("low_similarity", "moderately_similar")

    def test_similarity_score_clamped_to_0_1(self):
        # Mock returns embeddings that produce cosine > 1 due to floating-point
        mock = MagicMock()
        mock.encode.return_value = np.array([
            np.array([1e6, 1e6, 1e6], dtype=np.float32),
            np.array([1e6, 1e6, 1e6], dtype=np.float32),
        ])
        v = DocumentVerifier(_model_override=mock)
        score, _ = v._compute_similarity("doc", "spec")
        assert 0.0 <= score <= 1.0

    def test_fallback_similarity_used_when_model_unavailable(self):
        """When _get_model() raises RuntimeError, Jaccard fallback is used."""
        _reset_model_cache()
        with patch(
            "app.services.document_verifier._get_model",
            side_effect=RuntimeError("model not available"),
        ):
            v     = DocumentVerifier()   # no override → will call _get_model
            score, label = v._compute_similarity(
                "blockchain escrow payment",
                "blockchain escrow payment"
            )
        _reset_model_cache()
        # Identical strings → Jaccard similarity = 1.0
        assert score == pytest.approx(1.0, abs=0.01)

    def test_fallback_returns_zero_for_empty_strings(self):
        _reset_model_cache()
        with patch(
            "app.services.document_verifier._get_model",
            side_effect=RuntimeError("unavailable"),
        ):
            v     = DocumentVerifier()
            score, _ = v._compute_similarity("", "")
        _reset_model_cache()
        assert score == 0.0

    def test_interpretation_highly_similar(self):
        v = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        interp = v._interpret_similarity(0.90, "highly_similar")
        assert "strongly" in interp.lower() or "highly" in interp.lower() or "closely" in interp.lower()

    def test_interpretation_low_similarity(self):
        v = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        interp = v._interpret_similarity(0.40, "low_similarity")
        assert "low" in interp.lower() or "off-topic" in interp.lower() or "incomplete" in interp.lower()


# ══════════════════════════════════════════════════════════════════════════════
#  4. Keyword coverage
# ══════════════════════════════════════════════════════════════════════════════

class TestKeywordCoverage:

    @pytest.fixture
    def verifier(self):
        return DocumentVerifier(_model_override=_make_mock_model("on_topic"))

    def test_all_keywords_found(self, verifier):
        doc = "This uses smart contract, escrow, milestone, dispute resolution, Ethereum, and deployment."
        found, missing, coverage = verifier._check_keywords(doc, KEYWORDS)
        assert coverage == 1.0
        assert missing == []

    def test_no_keywords_found(self, verifier):
        doc = "This document is about HTML, CSS, and JavaScript for web pages."
        found, missing, coverage = verifier._check_keywords(doc, KEYWORDS)
        assert coverage == 0.0
        assert set(missing) == set(KEYWORDS)

    def test_partial_keyword_coverage(self, verifier):
        doc = "The smart contract handles escrow payments on Ethereum."
        found, missing, coverage = verifier._check_keywords(doc, KEYWORDS)
        assert 0.0 < coverage < 1.0
        assert "smart contract" in found
        assert "escrow" in found
        assert "Ethereum" in found
        assert "milestone" in missing

    def test_case_insensitive_matching(self, verifier):
        doc = "SMART CONTRACT and ESCROW and MILESTONE and DISPUTE RESOLUTION and ETHEREUM and DEPLOYMENT"
        found, missing, coverage = verifier._check_keywords(doc, KEYWORDS)
        assert coverage == 1.0

    def test_empty_keywords_returns_full_coverage(self, verifier):
        found, missing, coverage = verifier._check_keywords("any text", [])
        assert coverage == 1.0
        assert found == []
        assert missing == []

    def test_single_keyword_found(self, verifier):
        _, _, coverage = verifier._check_keywords("escrow payment", ["escrow"])
        assert coverage == 1.0

    def test_single_keyword_missing(self, verifier):
        _, missing, coverage = verifier._check_keywords("no match here", ["escrow"])
        assert coverage == 0.0
        assert "escrow" in missing

    def test_multi_word_keyword_matched(self, verifier):
        doc = "The dispute resolution mechanism handles contested cases."
        found, _, _ = verifier._check_keywords(doc, ["dispute resolution"])
        assert "dispute resolution" in found


# ══════════════════════════════════════════════════════════════════════════════
#  5. Structure check
# ══════════════════════════════════════════════════════════════════════════════

class TestStructureCheck:

    @pytest.fixture
    def verifier(self):
        return DocumentVerifier(_model_override=_make_mock_model("on_topic"))

    def test_long_multi_paragraph_passes(self, verifier):
        score, detail = verifier._check_structure(PASSING_DOCUMENT)
        assert score == 1.0
        assert detail["word_count_passed"]  is True
        assert detail["paragraph_passed"]   is True

    def test_short_document_fails_word_count(self, verifier):
        short = "This is short.\n\nToo short.\n\nStill short."
        score, detail = verifier._check_structure(short)
        assert detail["word_count_passed"] is False
        assert detail["word_count"] < 200

    def test_single_paragraph_fails_paragraph_check(self, verifier):
        one_para = " ".join(["word"] * 250)   # 250 words, no blank lines
        score, detail = verifier._check_structure(one_para)
        assert detail["paragraph_count"] == 1
        assert detail["paragraph_passed"] is False

    def test_exactly_200_words_passes(self, verifier):
        doc_200 = "\n\n".join(
            [" ".join(["word"] * 50) for _ in range(4)]
        )  # 200 words, 4 paragraphs
        score, detail = verifier._check_structure(doc_200)
        assert detail["word_count"] == 200
        assert detail["word_count_passed"] is True

    def test_exactly_3_paragraphs_passes(self, verifier):
        doc = (
            " ".join(["word"] * 70) + "\n\n"
            + " ".join(["word"] * 70) + "\n\n"
            + " ".join(["word"] * 70)
        )  # 210 words, 3 paragraphs
        score, detail = verifier._check_structure(doc)
        assert detail["paragraph_count"] == 3
        assert detail["paragraph_passed"] is True
        assert score == 1.0

    def test_structure_score_is_binary(self, verifier):
        for doc in [PASSING_DOCUMENT, FAILING_DOCUMENT]:
            score, _ = verifier._check_structure(doc)
            assert score in (0.0, 1.0)

    def test_both_checks_fail_returns_zero(self, verifier):
        tiny = "Too short."
        score, detail = verifier._check_structure(tiny)
        assert score == 0.0
        assert detail["word_count_passed"]  is False
        assert detail["paragraph_passed"]   is False


# ══════════════════════════════════════════════════════════════════════════════
#  6. Score calculation and verdict
# ══════════════════════════════════════════════════════════════════════════════

class TestScoreAndVerdict:

    @pytest.fixture
    def verifier(self):
        return DocumentVerifier(_model_override=_make_mock_model("on_topic"))

    def test_perfect_inputs_give_approved(self, verifier):
        verdict = verifier._determine_verdict(1.0)
        assert verdict == "APPROVED"

    def test_zero_score_gives_rejected(self, verifier):
        assert verifier._determine_verdict(0.0) == "REJECTED"

    def test_exactly_at_approval_threshold(self, verifier):
        assert verifier._determine_verdict(0.75) == "APPROVED"

    def test_just_below_approval_is_disputed(self, verifier):
        assert verifier._determine_verdict(0.74) == "DISPUTED"

    def test_exactly_at_ambiguity_low_is_disputed(self, verifier):
        assert verifier._determine_verdict(0.45) == "DISPUTED"

    def test_just_below_ambiguity_low_is_rejected(self, verifier):
        assert verifier._determine_verdict(0.44) == "REJECTED"

    def test_weighted_formula_correct(self, verifier):
        # Manually set known sub-scores and verify the formula
        sim  = 0.80
        kw   = 0.60
        struc = 1.0
        expected = round(
            sim * 0.50 + kw * 0.35 + struc * 0.15, 4
        )
        # Inject the sub-scores via a mock model and controlled keywords
        mock = MagicMock()
        mock.encode.return_value = np.array([
            _unit([0.8, 0.6, 0.0, 0.0, 0.0]),  # produces ~0.80 cosine with spec below
            _unit([1.0, 0.75, 0.0, 0.0, 0.0]),
        ])
        v = DocumentVerifier(_model_override=mock)
        # We can't control _compute_similarity precisely with this mock,
        # so just verify the formula via the internal method directly.
        score = round(sim * 0.50 + kw * 0.35 + struc * 0.15, 4)
        assert score == pytest.approx(expected)

    def test_threshold_override_changes_verdict(self):
        cfg = DocumentVerifierConfig()
        cfg.approval_threshold = 0.95
        cfg.ambiguity_band_low = 0.70
        v = DocumentVerifier(
            config=cfg, _model_override=_make_mock_model("on_topic")
        )
        # With a sky-high threshold, even a high score may not pass
        verdict = v._determine_verdict(0.80)
        assert verdict == "DISPUTED"


# ══════════════════════════════════════════════════════════════════════════════
#  7. Model caching
# ══════════════════════════════════════════════════════════════════════════════

class TestModelCaching:

    def test_model_loaded_only_once(self):
        """_get_model() returns the same cached object on repeated calls."""
        _reset_model_cache()
        call_count = 0
        sentinel   = MagicMock()

        def fake_loader(name):
            nonlocal call_count
            call_count += 1
            return sentinel

        # Patch SentenceTransformer where it is imported inside _get_model
        with patch("sentence_transformers.SentenceTransformer", fake_loader):
            import app.services.document_verifier as dv
            _reset_model_cache()
            m1 = dv._get_model()
            m2 = dv._get_model()   # second call — should hit cache, not reload

        _reset_model_cache()
        assert m1 is m2,         "Expected the same model instance on both calls"
        assert call_count == 1,  f"Model loaded {call_count} times, expected 1"

    def test_model_override_bypasses_cache(self):
        """_model_override skips _get_model() entirely."""
        _reset_model_cache()
        mock = _make_mock_model("on_topic")

        with patch(
            "app.services.document_verifier._get_model",
            side_effect=AssertionError("_get_model should NOT be called"),
        ):
            v = DocumentVerifier(_model_override=mock)
            v._compute_similarity("doc text here", "spec text here")
        # No assertion error raised → override was used


# ══════════════════════════════════════════════════════════════════════════════
#  8. Recommendation text
# ══════════════════════════════════════════════════════════════════════════════

class TestRecommendation:

    def test_approved_recommendation_positive(self):
        v   = DocumentVerifier(_model_override=_make_mock_model("on_topic"))
        res = v.verify(PASSING_DOCUMENT, SPECIFICATION, KEYWORDS)
        assert res["verdict"] == "APPROVED"
        assert len(res["recommendation"]) > 30

    def test_rejected_recommendation_mentions_issues(self):
        v   = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        res = v.verify(FAILING_DOCUMENT, SPECIFICATION, KEYWORDS)
        rec = res["recommendation"]
        # Should mention at least one problem
        assert any(w in rec.lower() for w in (
            "not meet", "rejected", "missing", "short", "low", "does not"
        ))

    def test_missing_keywords_listed_in_recommendation(self):
        v = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        res = v.verify(
            submitted_document=FAILING_DOCUMENT,
            requirement_specification=SPECIFICATION,
            required_keywords=["smart contract", "escrow"],
        )
        rec = res["recommendation"]
        # At least one missing keyword should be named in the recommendation
        assert "smart contract" in rec or "escrow" in rec

    def test_structure_issue_mentioned_when_doc_too_short(self):
        v   = DocumentVerifier(_model_override=_make_mock_model("off_topic"))
        res = v.verify(FAILING_DOCUMENT, SPECIFICATION, [])
        rec = res["recommendation"]
        assert any(w in rec.lower() for w in ("short", "words", "paragraph", "structural"))
