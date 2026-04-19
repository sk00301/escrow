"""
app/services/agents/base_agent.py

Abstract base class for all verification agents.
Concrete subclasses (CodeVerificationAgent, DocumentVerificationAgent, etc.)
implement the verify() method and call the shared helpers defined here.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from app.core.config import Settings
from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Required top-level keys every verdict dict must contain
# ---------------------------------------------------------------------------
_REQUIRED_VERDICT_KEYS = {
    "score",
    "verdict",
    "confidence",
    "requirements_met",
    "critical_issues",
    "minor_issues",
    "strengths",
    "score_breakdown",
    "reasoning",
    "recommendation",
}

_REQUIRED_BREAKDOWN_KEYS = {
    "test_execution",
    "code_quality",
    "requirements_coverage",
    "llm_reasoning",
}

_VALID_VERDICTS = {"APPROVED", "DISPUTED", "REJECTED"}


class BaseVerificationAgent(ABC):
    """
    Shared interface and utilities for all verification agent types.

    Subclasses must implement verify() and may override the helper methods
    if their pipeline differs from the default.
    """

    def __init__(self, llm: LLMProvider, config: Settings) -> None:
        self.llm = llm
        self.config = config

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abstractmethod
    async def verify(
        self,
        submission: str,
        acceptance_criteria: str,
        test_commands: list[str],
    ) -> dict:
        """
        Run the full verification pipeline for a submission.

        Args:
            submission:          GitHub URL, local path, or zip path.
            acceptance_criteria: Free-text milestone requirements.
            test_commands:       pytest command strings to execute.

        Returns:
            Structured verdict dict matching the schema defined in context.
        """

    # ------------------------------------------------------------------
    # Shared helpers (used by concrete subclasses)
    # ------------------------------------------------------------------

    def _build_context_prompt(self, tool_results: dict) -> str:
        """
        Assemble all tool outputs into a well-structured LLM prompt section.

        This is the shared "evidence block" that gets embedded into every
        sub-agent prompt so each sub-agent sees the same ground truth.

        Args:
            tool_results: Dict containing keys:
                - pytest_results   (from run_tests)
                - pylint_results   (from run_pylint)
                - flake8_results   (from run_flake8)
                - code_structure   (from extract_code_structure)

        Returns:
            A formatted multi-line string ready to embed in a prompt.
        """
        pytest_r = tool_results.get("pytest_results", {})
        pylint_r = tool_results.get("pylint_results", {})
        flake8_r = tool_results.get("flake8_results", {})
        code_s   = tool_results.get("code_structure", {})

        # ── Test results ──────────────────────────────────────────────────
        test_section = _fmt_section("TEST EXECUTION RESULTS", [
            f"Total tests : {pytest_r.get('total', 0)}",
            f"Passed      : {pytest_r.get('passed', 0)}",
            f"Failed      : {pytest_r.get('failed', 0)}",
            f"Pass rate   : {pytest_r.get('pass_rate', 0.0):.1%}",
        ])

        failed_details = pytest_r.get("failed_test_details", [])
        if failed_details:
            lines = ["", "FAILED TEST DETAILS (root cause evidence for LLM):"]
            for fd in failed_details:
                lines.append(f"  • {fd.get('name', '?')}")
                lines.append(f"    Error: {fd.get('error_message', 'no details')[:300]}")
            test_section += "\n".join(lines)

        passed_tests = pytest_r.get("passed_tests", [])
        if passed_tests:
            test_section += f"\n\nPASSED TESTS:\n" + "\n".join(
                f"  ✓ {t}" for t in passed_tests[:20]
            )

        # ── Code quality ──────────────────────────────────────────────────
        quality_section = _fmt_section("STATIC ANALYSIS", [
            f"Pylint score : {pylint_r.get('score_raw', 0):.1f}/10  "
            f"(normalised: {pylint_r.get('score_normalised', 0):.2f})",
            f"Pylint errors: {pylint_r.get('error_count', 0)}  "
            f"warnings: {pylint_r.get('warning_count', 0)}  "
            f"conventions: {pylint_r.get('convention_count', 0)}",
            f"Flake8 violations: {flake8_r.get('violation_count', 0)}  "
            f"(normalised: {flake8_r.get('score_normalised', 0):.2f})",
        ])

        top_issues = pylint_r.get("top_issues", [])
        if top_issues:
            quality_section += "\n\nTOP PYLINT ISSUES:\n" + "\n".join(
                f"  [{i['code']}] {i['file']}:{i['line']} — {i['message']}"
                for i in top_issues[:5]
            )

        top_violations = flake8_r.get("top_violations", [])
        if top_violations:
            quality_section += "\n\nTOP FLAKE8 VIOLATIONS:\n" + "\n".join(
                f"  {v}" for v in top_violations[:5]
            )

        # ── Code structure ────────────────────────────────────────────────
        files = code_s.get("files", [])
        structure_lines = [
            f"Total files     : {len(files)}",
            f"Total LOC       : {code_s.get('total_loc', 0)}",
            f"Total functions : {code_s.get('total_functions', 0)}",
            f"Total classes   : {code_s.get('total_classes', 0)}",
            f"Has test files  : {code_s.get('has_tests', False)}",
        ]
        structure_section = _fmt_section("CODE STRUCTURE", structure_lines)

        for f in files:
            if f.get("path", "").startswith("test"):
                continue  # skip test files in the structure summary
            fns = [fn["name"] for fn in f.get("functions", [])]
            clss = [c["name"] for c in f.get("classes", [])]
            structure_section += (
                f"\n\nFile: {f['path']}  (LOC={f.get('loc', 0)}, "
                f"error_handling={f.get('has_error_handling', False)})\n"
            )
            if fns:
                structure_section += f"  Functions : {', '.join(fns)}\n"
            if clss:
                structure_section += f"  Classes   : {', '.join(clss)}\n"

        # ── Full file contents (truncated) ────────────────────────────────
        content_section = "\n\n=== SOURCE CODE ===\n"
        for f in files:
            if f.get("path", "").startswith("test"):
                continue
            content_section += f"\n--- {f['path']} ---\n"
            content_section += f.get("content", "(no content)")[:2000]
            content_section += "\n"

        return test_section + "\n\n" + quality_section + "\n\n" + structure_section + content_section

    def _parse_verdict(self, response: str) -> dict:
        """
        Parse and validate the LLM's JSON response against the verdict schema.

        Strips markdown fences, parses JSON, validates required keys, clamps
        numeric fields to [0, 1], and normalises the verdict string.

        Args:
            response: Raw string from the LLM.

        Returns:
            Validated verdict dict.

        Raises:
            ValueError: If required keys are missing or types are wrong.
        """
        from app.services.llm.provider import LLMProvider as _LP
        cleaned = _LP.strip_markdown_fences(response)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Response is not valid JSON: {exc}\nRaw: {response[:500]}") from exc

        if not isinstance(data, dict):
            raise ValueError(f"Expected a JSON object, got {type(data).__name__}")

        # Check required top-level keys
        missing = _REQUIRED_VERDICT_KEYS - data.keys()
        if missing:
            raise ValueError(f"Verdict missing required keys: {missing}")

        # Clamp score and confidence to [0, 1]
        data["score"] = max(0.0, min(1.0, float(data["score"])))
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))

        # Normalise verdict string
        verdict = str(data.get("verdict", "")).strip().upper()
        if verdict not in _VALID_VERDICTS:
            # Re-derive from score if the LLM returned something unexpected
            verdict = self._apply_decision_gate(data["score"])
            logger.warning("Invalid verdict '%s' from LLM — re-derived as '%s'", data["verdict"], verdict)
        data["verdict"] = verdict

        # Validate score_breakdown
        breakdown = data.get("score_breakdown", {})
        if not isinstance(breakdown, dict):
            data["score_breakdown"] = {k: 0.5 for k in _REQUIRED_BREAKDOWN_KEYS}
        else:
            for k in _REQUIRED_BREAKDOWN_KEYS:
                breakdown[k] = max(0.0, min(1.0, float(breakdown.get(k, 0.5))))

        # Ensure list fields are lists
        for key in ("requirements_met", "critical_issues", "minor_issues", "strengths"):
            if not isinstance(data.get(key), list):
                data[key] = []

        # Ensure string fields are strings
        for key in ("reasoning", "recommendation"):
            if not isinstance(data.get(key), str):
                data[key] = str(data.get(key, ""))

        return data

    def _apply_decision_gate(self, score: float) -> str:
        """
        Map a numeric score to a verdict string using the decision gate.

        Thresholds read from config (verdict_approved_threshold and
        verdict_rejected_threshold) so they can be tuned without code changes.

        Args:
            score: Float in [0.0, 1.0].

        Returns:
            "APPROVED", "DISPUTED", or "REJECTED".
        """
        approved_threshold = getattr(self.config, "verdict_approved_threshold", 0.75)
        rejected_threshold = getattr(self.config, "verdict_rejected_threshold", 0.45)

        if score >= approved_threshold:
            return "APPROVED"
        if score >= rejected_threshold:
            return "DISPUTED"
        return "REJECTED"

    def _compute_final_score(self, tool_results: dict, breakdown: dict) -> float:
        """
        Compute the weighted final score from the score breakdown.

        Uses weights from config (llm_weight_* fields), falling back to
        the values defined in the context document.
        """
        w_req  = getattr(self.config, "llm_weight_requirements",    0.40)
        w_test = getattr(self.config, "llm_weight_test_execution",  0.30)
        w_qual = getattr(self.config, "llm_weight_code_quality",    0.20)
        w_stat = getattr(self.config, "llm_weight_static_analysis", 0.10)

        req_score  = float(breakdown.get("requirements_coverage", 0.5))
        test_score = float(breakdown.get("test_execution", 0.5))
        qual_score = float(breakdown.get("code_quality", 0.5))

        # Static analysis: average of pylint + flake8 normalised scores
        pylint_norm = tool_results.get("pylint_results", {}).get("score_normalised", 0.5)
        flake8_norm = tool_results.get("flake8_results", {}).get("score_normalised", 0.5)
        stat_score  = (pylint_norm + flake8_norm) / 2.0

        score = (
            req_score  * w_req  +
            test_score * w_test +
            qual_score * w_qual +
            stat_score * w_stat
        )
        return round(max(0.0, min(1.0, score)), 4)

    def _error_verdict(self, message: str) -> dict:
        """Return a safe REJECTED verdict when the pipeline itself fails."""
        return {
            "score": 0.0,
            "verdict": "REJECTED",
            "confidence": 0.0,
            "requirements_met": [],
            "critical_issues": [f"Verification pipeline error: {message}"],
            "minor_issues": [],
            "strengths": [],
            "score_breakdown": {
                "test_execution": 0.0,
                "code_quality": 0.0,
                "requirements_coverage": 0.0,
                "llm_reasoning": 0.0,
            },
            "reasoning": f"Verification failed due to an internal error: {message}",
            "recommendation": "Please resubmit. If the problem persists, contact support.",
        }


# ---------------------------------------------------------------------------
# Internal formatting helper
# ---------------------------------------------------------------------------

def _fmt_section(title: str, lines: list[str]) -> str:
    border = "=" * 60
    body = "\n".join(f"  {l}" for l in lines)
    return f"{border}\n{title}\n{border}\n{body}"
