"""
app/services/document_verifier.py
══════════════════════════════════════════════════════════════════════════════
Document verification engine using sentence-transformers (HuggingFace).

Evaluates a submitted text document against a milestone's requirement
specification and returns a normalised quality score (0.0–1.0) with a
full explainability bundle — same shape as CodeVerifier so the React
frontend can render both through the same AI Verification results page.

Model
─────
    all-MiniLM-L6-v2  — 22 MB, runs on CPU, no GPU needed.
    Downloaded once to ~/.cache/huggingface/hub on first use.
    All subsequent uses load from the local cache (offline-capable).

Pipeline
────────
    Step 1  Semantic similarity  — cosine sim of sentence embeddings (×0.50)
    Step 2  Keyword coverage     — required keywords found / total   (×0.35)
    Step 3  Structure check      — length + paragraph count          (×0.15)
    Step 4  Weighted final score + verdict
    Step 5  Explainability bundle

Usage
─────
    from app.services.document_verifier import DocumentVerifier

    verifier = DocumentVerifier()          # model loads here (once)
    result   = verifier.verify(
        submitted_document      = "The smart contract system implements...",
        requirement_specification = "Build a blockchain escrow system...",
        required_keywords       = ["escrow", "smart contract", "payment"],
    )
    print(result["verdict"])        # "APPROVED" | "DISPUTED" | "REJECTED"
    print(result["recommendation"]) # plain-English explanation
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ── Model name constant — change here to swap models project-wide ─────────────
MODEL_NAME = "all-MiniLM-L6-v2"

# ── Module-level singleton — loaded once, reused for every request ────────────
# This is intentionally a module-level variable (not a class attribute) so it
# survives across multiple DocumentVerifier instances within the same process.
_model_singleton = None
_model_load_error: str | None = None   # stores error message if load failed


def _get_model():
    """
    Return the cached SentenceTransformer model, loading it on first call.

    Thread safety: FastAPI's async event loop is single-threaded, so there
    is no race condition for the module-level assignment in an async context.
    If you use multiple worker processes (e.g. gunicorn -w 4), each process
    loads its own copy — which is fine.

    Raises
    ------
    RuntimeError
        If the model cannot be loaded (no internet on first run, corrupt
        cache, or sentence-transformers not installed).
    """
    global _model_singleton, _model_load_error

    # Fast path — already loaded
    if _model_singleton is not None:
        return _model_singleton

    # Propagate a previous load failure immediately
    if _model_load_error is not None:
        raise RuntimeError(_model_load_error)

    # ── First call: load (and possibly download) the model ────────────────────
    try:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        logger.info(
            "model_loading",
            extra={
                "model": MODEL_NAME,
                "note": "Downloading ~22 MB on first run — cached afterwards",
            },
        )
        print(
            f"\n[DocumentVerifier] Loading model '{MODEL_NAME}'…\n"
            f"  First run: ~22 MB will be downloaded to ~/.cache/huggingface/\n"
            f"  Subsequent runs: loaded from local cache (offline-capable)\n",
            flush=True,
        )

        t0 = time.monotonic()
        _model_singleton = SentenceTransformer(MODEL_NAME)
        elapsed = round(time.monotonic() - t0, 2)

        print(f"[DocumentVerifier] Model ready in {elapsed}s\n", flush=True)
        logger.info("model_loaded", extra={"model": MODEL_NAME, "elapsed_s": elapsed})
        return _model_singleton

    except ImportError as exc:
        msg = (
            "sentence-transformers is not installed. "
            "Run:  pip install sentence-transformers"
        )
        _model_load_error = msg
        raise RuntimeError(msg) from exc

    except Exception as exc:
        msg = (
            f"Failed to load model '{MODEL_NAME}': {exc}\n"
            "Ensure you have an internet connection on the first run, "
            "or pre-download the model with:\n"
            "  python -c \"from sentence_transformers import SentenceTransformer; "
            f"SentenceTransformer('{MODEL_NAME}')\""
        )
        _model_load_error = msg
        raise RuntimeError(msg) from exc


def _reset_model_cache() -> None:
    """
    Force the next call to _get_model() to reload the model.
    Used in tests to inject a mock without affecting other tests.
    """
    global _model_singleton, _model_load_error
    _model_singleton   = None
    _model_load_error  = None


# ── Configuration dataclass ───────────────────────────────────────────────────

class DocumentVerifierConfig:
    """Tuneable thresholds — all overridable per-call via the `thresholds` dict."""
    weight_similarity: float  = 0.50
    weight_keywords:   float  = 0.35
    weight_structure:  float  = 0.15

    approval_threshold:  float = 0.75
    ambiguity_band_low:  float = 0.45

    min_word_count:      int   = 200
    min_paragraph_count: int   = 3

    # Similarity interpretation boundaries
    high_similarity_threshold:     float = 0.80
    moderate_similarity_threshold:  float = 0.60


# ── Main verifier class ───────────────────────────────────────────────────────

class DocumentVerifier:
    """
    Stateless document verifier.  One instance at app startup (model loads
    once), then call verify() for each job.

    Parameters
    ----------
    config : DocumentVerifierConfig, optional
        Override default thresholds.
    _model_override : any, optional
        Inject a mock model in tests — skips the real _get_model() call.
    """

    def __init__(
        self,
        config: DocumentVerifierConfig | None = None,
        _model_override: Any = None,
    ) -> None:
        self.config = config or DocumentVerifierConfig()
        self._model_override = _model_override   # test seam

    # ── Public entry point ────────────────────────────────────────────────────

    def verify(
        self,
        submitted_document:        str,
        requirement_specification: str,
        required_keywords:         list[str] | None = None,
        thresholds:                dict[str, float] | None = None,
        milestone_scope:           Any | None = None,
    ) -> dict[str, Any]:
        """
        Run the full document verification pipeline.

        Parameters
        ----------
        submitted_document : str
            Full text of the freelancer's submitted document.
        requirement_specification : str
            The milestone's requirement text (from MilestoneDescriptor).
            Ignored when milestone_scope is provided — scope.acceptance_criteria
            is used as the specification instead.
        required_keywords : list[str], optional
            Keywords / phrases that must appear in the submission.
            Defaults to [] (keyword step contributes 1.0 if empty).
            Ignored when milestone_scope is provided — scope.required_keywords
            is used instead.
        thresholds : dict, optional
            Override scoring thresholds:
                {"approval": 0.75, "ambiguity_low": 0.45}
        milestone_scope : MilestoneScope | None, optional
            When provided, restricts verification to this milestone's scope:
              - scope.acceptance_criteria  replaces requirement_specification
              - scope.required_keywords    replaces required_keywords
              - scope.weight_overrides     overrides scoring weights

        Returns
        -------
        dict
            Full explainability bundle (see Step 5 below).
        """
        start = time.monotonic()
        self._apply_overrides(thresholds)

        # ── Resolve effective spec and keywords from scope ────────────────────
        if milestone_scope is not None:
            if milestone_scope.acceptance_criteria:
                effective_spec = milestone_scope.acceptance_criteria
            else:
                effective_spec = requirement_specification
            effective_keywords = milestone_scope.required_keywords or required_keywords or []
            # Apply any per-milestone weight overrides
            if milestone_scope.weight_overrides:
                self._apply_overrides(milestone_scope.weight_overrides)
            logger.info(
                "document_verifier: scope applied — milestone=%d label='%s' "
                "keywords=%d",
                milestone_scope.milestone_number,
                milestone_scope.label,
                len(effective_keywords),
            )
        else:
            effective_spec     = requirement_specification
            effective_keywords = required_keywords or []

        # ── Step 1 — Semantic similarity ──────────────────────────────────────
        similarity_score, similarity_label = self._compute_similarity(
            submitted_document, effective_spec
        )

        # ── Step 2 — Keyword coverage ─────────────────────────────────────────
        found_kw, missing_kw, keyword_coverage = self._check_keywords(
            submitted_document, effective_keywords
        )

        # ── Step 3 — Structure check ──────────────────────────────────────────
        structure_score, structure_detail = self._check_structure(submitted_document)

        # ── Step 4 — Final score & verdict ────────────────────────────────────
        final_score = round(
            (similarity_score  * self.config.weight_similarity)
            + (keyword_coverage  * self.config.weight_keywords)
            + (structure_score   * self.config.weight_structure),
            4,
        )
        verdict = self._determine_verdict(final_score)

        elapsed = round(time.monotonic() - start, 3)

        # Build milestone metadata for the result bundle
        if milestone_scope is not None:
            milestone_meta = {
                "number":        milestone_scope.milestone_number,
                "label":         milestone_scope.label,
                "scope_applied": True,
                "scope_label":   f"Milestone {milestone_scope.milestone_number} — {milestone_scope.label}",
            }
        else:
            milestone_meta = {"scope_applied": False}

        # ── Step 5 — Explainability bundle ────────────────────────────────────
        return {
            # ── Top-level decision ────────────────────────────────────────────
            "final_score": final_score,
            "verdict":     verdict,

            # ── Milestone scope metadata ──────────────────────────────────────
            "milestone": milestone_meta,

            # ── Semantic similarity ───────────────────────────────────────────
            "similarity": {
                "score":          round(similarity_score, 4),
                "label":          similarity_label,
                "interpretation": self._interpret_similarity(
                    similarity_score, similarity_label
                ),
            },

            # ── Keyword coverage ──────────────────────────────────────────────
            "keywords": {
                "required":        effective_keywords,
                "found":           found_kw,
                "missing":         missing_kw,
                "coverage":        round(keyword_coverage, 4),
                "found_count":     len(found_kw),
                "required_count":  len(effective_keywords),
            },

            # ── Structure ─────────────────────────────────────────────────────
            "structure": {
                "score":           structure_score,
                "passed":          structure_score == 1.0,
                **structure_detail,
            },

            # ── Weighted breakdown (mirrors CodeVerifier shape) ───────────────
            "weighted_breakdown": {
                "similarity_contribution": round(
                    similarity_score * self.config.weight_similarity, 4
                ),
                "keyword_contribution":    round(
                    keyword_coverage * self.config.weight_keywords, 4
                ),
                "structure_contribution":  round(
                    structure_score  * self.config.weight_structure, 4
                ),
                "weights": {
                    "similarity": self.config.weight_similarity,
                    "keywords":   self.config.weight_keywords,
                    "structure":  self.config.weight_structure,
                },
            },

            # ── Plain-English recommendation ──────────────────────────────────
            "recommendation": self._build_recommendation(
                verdict, final_score,
                similarity_score, similarity_label,
                found_kw, missing_kw, keyword_coverage,
                structure_score, structure_detail,
            ),

            # ── Provenance ────────────────────────────────────────────────────
            "model":                    MODEL_NAME,
            "execution_time_seconds":   elapsed,
            "timestamp":                datetime.now(timezone.utc).isoformat(),
        }

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 1 — Semantic similarity
    # ══════════════════════════════════════════════════════════════════════════

    def _compute_similarity(
        self, document: str, specification: str
    ) -> tuple[float, str]:
        """
        Encode both texts and return (cosine_similarity, label).

        Uses the module-level cached model — loads on first call.
        Falls back to keyword-overlap similarity if the model is unavailable,
        so the service degrades gracefully rather than crashing.
        """
        try:
            model = self._model_override or _get_model()
            embeddings = model.encode(
                [document, specification],
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            doc_emb  = embeddings[0]
            spec_emb = embeddings[1]

            # Cosine similarity via numpy (avoids scikit-learn dependency)
            cosine = float(
                np.dot(doc_emb, spec_emb)
                / (np.linalg.norm(doc_emb) * np.linalg.norm(spec_emb) + 1e-10)
            )
            # Clamp to [0, 1] — cosine can technically go negative for very
            # dissimilar texts; negative scores aren't meaningful here.
            score = max(0.0, min(1.0, cosine))

        except RuntimeError as exc:
            logger.warning(
                "model_unavailable_falling_back",
                extra={"reason": str(exc)},
            )
            score = self._fallback_similarity(document, specification)

        label = self._similarity_label(score)
        logger.info("similarity_computed", extra={"score": score, "label": label})
        return score, label

    def _fallback_similarity(self, doc: str, spec: str) -> float:
        """
        Jaccard-based word overlap similarity.
        Used only when the model cannot be loaded.
        """
        doc_words  = set(re.findall(r"\b\w+\b", doc.lower()))
        spec_words = set(re.findall(r"\b\w+\b", spec.lower()))
        if not doc_words or not spec_words:
            return 0.0
        intersection = doc_words & spec_words
        union        = doc_words | spec_words
        return round(len(intersection) / len(union), 4)

    def _similarity_label(self, score: float) -> str:
        if score >= self.config.high_similarity_threshold:
            return "highly_similar"
        if score >= self.config.moderate_similarity_threshold:
            return "moderately_similar"
        return "low_similarity"

    def _interpret_similarity(self, score: float, label: str) -> str:
        interpretations = {
            "highly_similar":     (
                f"Score {score:.2f}: The document strongly aligns with the "
                "requirement specification. The content, tone, and coverage "
                "closely match what was asked for."
            ),
            "moderately_similar": (
                f"Score {score:.2f}: The document partially addresses the "
                "requirements. Some key aspects are covered but important "
                "sections may be missing or underdeveloped."
            ),
            "low_similarity":     (
                f"Score {score:.2f}: The document has low semantic overlap "
                "with the requirements. The submission may be off-topic or "
                "significantly incomplete."
            ),
        }
        return interpretations[label]

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 2 — Keyword coverage
    # ══════════════════════════════════════════════════════════════════════════

    def _check_keywords(
        self, document: str, required_keywords: list[str]
    ) -> tuple[list[str], list[str], float]:
        """
        Case-insensitive check for each required keyword / phrase.

        Returns (found_keywords, missing_keywords, coverage_ratio).
        If required_keywords is empty, coverage is 1.0 (full score).
        """
        if not required_keywords:
            return [], [], 1.0

        doc_lower = document.lower()
        found:   list[str] = []
        missing: list[str] = []

        for kw in required_keywords:
            if kw.lower() in doc_lower:
                found.append(kw)
            else:
                missing.append(kw)

        coverage = round(len(found) / len(required_keywords), 4)
        logger.info(
            "keywords_checked",
            extra={"found": len(found), "missing": len(missing), "coverage": coverage},
        )
        return found, missing, coverage

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 3 — Structure check
    # ══════════════════════════════════════════════════════════════════════════

    def _check_structure(self, document: str) -> tuple[float, dict[str, Any]]:
        """
        Binary structure check (0.0 or 1.0).

        Checks:
          - Word count ≥ min_word_count (default 200)
          - Paragraph count ≥ min_paragraph_count (default 3)

        Returns (score, detail_dict).
        """
        words      = re.findall(r"\b\w+\b", document)
        word_count = len(words)

        # Paragraphs are separated by one or more blank lines
        paragraphs      = [p.strip() for p in re.split(r"\n\s*\n", document) if p.strip()]
        paragraph_count = len(paragraphs)

        word_ok      = word_count      >= self.config.min_word_count
        paragraph_ok = paragraph_count >= self.config.min_paragraph_count
        passed       = word_ok and paragraph_ok

        detail = {
            "word_count":           word_count,
            "word_count_required":  self.config.min_word_count,
            "word_count_passed":    word_ok,
            "paragraph_count":      paragraph_count,
            "paragraph_required":   self.config.min_paragraph_count,
            "paragraph_passed":     paragraph_ok,
        }
        score = 1.0 if passed else 0.0
        logger.info("structure_checked", extra=detail)
        return score, detail

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 4 — Verdict
    # ══════════════════════════════════════════════════════════════════════════

    def _determine_verdict(self, score: float) -> str:
        if score >= self.config.approval_threshold:
            return "APPROVED"
        if score >= self.config.ambiguity_band_low:
            return "DISPUTED"
        return "REJECTED"

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 5 — Plain-English recommendation
    # ══════════════════════════════════════════════════════════════════════════

    def _build_recommendation(
        self,
        verdict:          str,
        final_score:      float,
        similarity_score: float,
        similarity_label: str,
        found_kw:         list[str],
        missing_kw:       list[str],
        keyword_coverage: float,
        structure_score:  float,
        structure_detail: dict[str, Any],
    ) -> str:
        """
        Produce a 2–4 sentence plain-English verdict explanation that a
        non-technical project panel or freelancer can understand.
        """
        parts: list[str] = []

        # ── Opening verdict sentence ──────────────────────────────────────────
        pct = int(final_score * 100)
        if verdict == "APPROVED":
            parts.append(
                f"The document meets the milestone requirements with an overall "
                f"quality score of {pct}%."
            )
        elif verdict == "DISPUTED":
            parts.append(
                f"The document partially meets the requirements (score {pct}%) "
                f"and has been flagged for human review."
            )
        else:
            parts.append(
                f"The document does not meet the minimum requirements "
                f"(score {pct}%) and has been rejected."
            )

        # ── Similarity sentence ───────────────────────────────────────────────
        sim_pct = int(similarity_score * 100)
        if similarity_label == "highly_similar":
            parts.append(
                f"The content is highly relevant to the specification ({sim_pct}% "
                f"semantic match)."
            )
        elif similarity_label == "moderately_similar":
            parts.append(
                f"The content is partially relevant ({sim_pct}% semantic match) — "
                f"consider expanding the sections that address the core requirements."
            )
        else:
            parts.append(
                f"The content has low relevance to the specification ({sim_pct}% "
                f"semantic match) — the document may need to be significantly revised."
            )

        # ── Keyword sentence ──────────────────────────────────────────────────
        if missing_kw:
            kw_list = ", ".join(f'"{k}"' for k in missing_kw[:5])
            suffix  = f" and {len(missing_kw) - 5} more" if len(missing_kw) > 5 else ""
            parts.append(
                f"The following required topics were not found: {kw_list}{suffix}."
            )
        elif found_kw:
            parts.append(
                f"All {len(found_kw)} required keywords were found in the document."
            )

        # ── Structure sentence ────────────────────────────────────────────────
        if structure_score < 1.0:
            issues = []
            if not structure_detail["word_count_passed"]:
                issues.append(
                    f"too short ({structure_detail['word_count']} words, "
                    f"minimum {structure_detail['word_count_required']})"
                )
            if not structure_detail["paragraph_passed"]:
                issues.append(
                    f"too few paragraphs ({structure_detail['paragraph_count']}, "
                    f"minimum {structure_detail['paragraph_required']})"
                )
            parts.append(f"Structural issues: {'; '.join(issues)}.")

        return "  ".join(parts)

    # ══════════════════════════════════════════════════════════════════════════
    #  Helpers
    # ══════════════════════════════════════════════════════════════════════════

    def _apply_overrides(self, thresholds: dict[str, float] | None) -> None:
        if not thresholds:
            return
        if "approval"      in thresholds:
            self.config.approval_threshold = thresholds["approval"]
        if "ambiguity_low" in thresholds:
            self.config.ambiguity_band_low = thresholds["ambiguity_low"]
        if "weight_similarity" in thresholds:
            self.config.weight_similarity = thresholds["weight_similarity"]
        if "weight_keywords"   in thresholds:
            self.config.weight_keywords   = thresholds["weight_keywords"]
        if "weight_structure"  in thresholds:
            self.config.weight_structure  = thresholds["weight_structure"]
