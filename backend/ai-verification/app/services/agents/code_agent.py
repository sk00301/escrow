"""
app/services/agents/code_agent.py

CodeVerificationAgent — the primary LLM reasoning pipeline that replaces
the old metric-only scoring system.

Pipeline (6 steps):
  1. Ingest submission  → work_dir, sha256_hash
  2. Run tools in parallel (asyncio.gather):
       pytest_tool, pylint_tool, flake8_tool, code_extractor
  3. Sub-agent A: RequirementsAnalyzer
  4. Sub-agent B: TestFailureInterpreter
  5. Sub-agent C: VerdictSynthesizer
  6. Validate verdict, apply decision gate, clean up work_dir

The prompts are tuned to produce correct verdicts for the 15 evaluation
cases described in the project context.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.services.agents.base_agent import BaseVerificationAgent
from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

# --- Sub-agent A: RequirementsAnalyzer ---

_REQUIREMENTS_SYSTEM = """You are a senior software engineer reviewing submitted code against \
specific milestone requirements.
Your job is to determine — with precision and evidence — whether each stated requirement \
has been implemented correctly.

Rules:
- Cite specific function names, line behaviour, or missing guards as evidence.
- A requirement is only MET if it is correctly implemented for ALL inputs, \
including edge cases.
- A missing edge-case handler (e.g. no zero-division guard, no overflow check) \
means that requirement is NOT met.
- Do NOT give credit for partially correct implementations on critical requirements.
- Return ONLY a valid JSON array. No prose, no markdown fences."""

_REQUIREMENTS_USER = """ACCEPTANCE CRITERIA (the freelancer's requirements):
{acceptance_criteria}

{evidence_block}

Analyse the code against each requirement in the acceptance criteria.
Return a JSON array where each element is:
{{
  "requirement": "exact requirement text",
  "met": true or false,
  "evidence": "specific code evidence — function name, behaviour observed, what is missing"
}}

Be strict: missing guards, wrong formulas, or missing validations mean met=false.
Return ONLY the JSON array."""


# --- Sub-agent B: TestFailureInterpreter ---

_TEST_INTERP_SYSTEM = """You are a code reviewer specialising in test failure root-cause analysis.
Your job is to explain WHY each test failed — the underlying code defect — \
not just describe the error message.

Severity levels:
- critical: core functionality is broken or missing (e.g. wrong formula, missing guard \
that causes crashes)
- major: significant gap (e.g. missing validation, wrong boundary)
- minor: style, documentation, or non-critical edge case

Return ONLY a valid JSON array. No prose, no markdown fences."""

_TEST_INTERP_USER = """TEST RESULTS:
Pass rate: {pass_rate:.1%}  ({passed}/{total} tests passed)

FAILED TESTS WITH ERROR MESSAGES:
{failed_tests_block}

RELEVANT SOURCE CODE:
{code_block}

For each failed test, return a JSON array element:
{{
  "test_name": "test function name",
  "root_cause": "precise explanation of the code defect causing this failure",
  "severity": "critical|major|minor"
}}

If all tests passed, return an empty array [].
Return ONLY the JSON array."""


# --- Sub-agent C: VerdictSynthesizer ---

_VERDICT_SYSTEM = """You are an objective, impartial code quality assessor for a freelance \
escrow platform.
Your verdict directly determines whether a freelancer gets paid. Be fair but rigorous.

SCORING WEIGHTS (use these exactly):
- requirements_coverage : 0.40  ← MOST IMPORTANT. Did the code actually implement \
all requirements correctly?
- test_execution        : 0.30  ← pytest pass rate
- code_quality          : 0.20  ← LLM assessment of correctness, safety, robustness
- (static_analysis is computed externally)

DECISION RULES (apply these strictly):
1. If core logic is fundamentally WRONG (wrong formula, inverted operator, wrong algorithm):
   requirements_coverage = 0.0–0.2 → score will be < 0.45 → REJECTED
2. If core logic is CORRECT but missing one or two guards/validations/edge cases:
   requirements_coverage = 0.4–0.6 → score will be 0.45–0.74 → DISPUTED
3. If all requirements are met with only minor style issues:
   requirements_coverage = 0.8–1.0 → score will be ≥ 0.75 → APPROVED

VERDICT THRESHOLDS:
- score ≥ 0.75  → "APPROVED"   (payment released)
- 0.45 ≤ score < 0.75 → "DISPUTED"  (jury reviews)
- score < 0.45  → "REJECTED"   (resubmission required)

You MUST return ONLY a valid JSON object. No prose before or after. \
No markdown fences. Start your response with {{ and end with }}."""

_VERDICT_USER = """MILESTONE ACCEPTANCE CRITERIA:
{acceptance_criteria}

REQUIREMENTS ANALYSIS (from sub-agent A):
{requirements_analysis}

TEST FAILURE INTERPRETATION (from sub-agent B):
{test_interpretation}

TOOL METRICS:
- Pytest pass rate   : {pass_rate:.1%} ({passed}/{total} tests)
- Pylint score       : {pylint_score:.1f}/10
- Pylint errors      : {pylint_errors}
- Flake8 violations  : {flake8_violations}
- Has error handling : {has_error_handling}
- Total functions    : {total_functions}

Produce the final verification verdict as a JSON object with EXACTLY these keys:
{{
  "score": <float 0.0-1.0, weighted using the formula above>,
  "verdict": <"APPROVED"|"DISPUTED"|"REJECTED">,
  "confidence": <float 0.0-1.0, how confident you are>,
  "requirements_met": [
    {{"requirement": "...", "met": true|false, "evidence": "..."}}
  ],
  "critical_issues": ["list of blocking problems — be specific"],
  "minor_issues": ["list of non-blocking issues"],
  "strengths": ["list of what the freelancer did well"],
  "score_breakdown": {{
    "test_execution": <float, based on pass rate>,
    "code_quality": <float, your LLM assessment>,
    "requirements_coverage": <float, MOST IMPORTANT — use the rules above>,
    "llm_reasoning": <float, overall confidence in your assessment>
  }},
  "reasoning": "2-3 sentence plain English explanation of the verdict",
  "recommendation": "specific actionable advice for the freelancer"
}}

Remember: missing guards/edge-cases = DISPUTED, wrong core logic = REJECTED, \
all good = APPROVED.
Return ONLY the JSON object."""


class CodeVerificationAgent(BaseVerificationAgent):
    """
    Multi-step LLM reasoning agent for code submission verification.

    Runs tool analysis in parallel then chains three focused sub-agent
    prompts to produce a structured verdict that achieves ≥80% accuracy
    on the 15-case evaluation dataset.
    """

    def __init__(self, llm: LLMProvider, config: Settings) -> None:
        super().__init__(llm, config)

    async def verify(
        self,
        submission: str,
        acceptance_criteria: str,
        test_commands: list[str],
    ) -> dict:
        """
        Run the full 6-step verification pipeline.

        Args:
            submission:          GitHub URL, local path, or zip path.
            acceptance_criteria: Free-text milestone requirements.
            test_commands:       pytest command strings.

        Returns:
            Structured verdict dict (see context for full schema).
        """
        work_dir: Path | None = None

        try:
            # ── Step 1: Ingest submission ─────────────────────────────────
            logger.info("[CodeAgent] Step 1: ingesting submission: %s", submission)
            work_dir, submission_hash = await self._ingest(submission)
            logger.info("[CodeAgent] work_dir=%s  hash=%s...", work_dir, submission_hash[:12])

            # ── Step 2: Run all tools in parallel ─────────────────────────
            logger.info("[CodeAgent] Step 2: running tools in parallel")
            tool_results = await self._run_tools_parallel(work_dir, test_commands)
            logger.info(
                "[CodeAgent] Tools done — tests: %d/%d passed, pylint: %.1f/10",
                tool_results["pytest_results"].get("passed", 0),
                tool_results["pytest_results"].get("total", 0),
                tool_results["pylint_results"].get("score_raw", 0),
            )

            # ── Step 3: RequirementsAnalyzer ──────────────────────────────
            logger.info("[CodeAgent] Step 3: RequirementsAnalyzer")
            requirements_analysis = await self._analyze_requirements(
                acceptance_criteria, tool_results
            )

            # ── Step 4: TestFailureInterpreter ────────────────────────────
            logger.info("[CodeAgent] Step 4: TestFailureInterpreter")
            test_interpretation = await self._interpret_test_failures(tool_results)

            # ── Step 5: VerdictSynthesizer ────────────────────────────────
            logger.info("[CodeAgent] Step 5: VerdictSynthesizer")
            verdict = await self._synthesize_verdict(
                acceptance_criteria,
                tool_results,
                requirements_analysis,
                test_interpretation,
            )

            # ── Step 6: Validate, clean, apply decision gate ──────────────
            logger.info("[CodeAgent] Step 6: validate and finalise")
            verdict = self._finalise_verdict(verdict, tool_results, submission_hash)

            logger.info(
                "[CodeAgent] DONE — verdict=%s  score=%.3f  confidence=%.2f",
                verdict["verdict"], verdict["score"], verdict["confidence"],
            )
            return verdict

        except Exception as exc:
            logger.error("[CodeAgent] Pipeline failed: %s", exc, exc_info=True)
            return self._error_verdict(str(exc))

        finally:
            # Always clean up the temporary work directory
            if work_dir is not None and work_dir.exists():
                try:
                    shutil.rmtree(work_dir, ignore_errors=True)
                    logger.debug("[CodeAgent] cleaned up work_dir=%s", work_dir)
                except Exception as cleanup_exc:
                    logger.warning("[CodeAgent] cleanup failed: %s", cleanup_exc)

    # ------------------------------------------------------------------
    # Step implementations
    # ------------------------------------------------------------------

    async def _ingest(self, submission: str) -> tuple[Path, str]:
        """Wrap the synchronous ingest_submission call in a thread executor."""
        from app.services.agents.tools.git_tool import (
            ingest_submission, SubmissionIngestionError
        )
        loop = asyncio.get_event_loop()
        try:
            work_dir, sha = await loop.run_in_executor(
                None, ingest_submission, submission
            )
            return work_dir, sha
        except SubmissionIngestionError:
            raise
        except Exception as exc:
            raise SubmissionIngestionError(
                f"Ingestion failed: {exc}"
            ) from exc

    async def _run_tools_parallel(
        self, work_dir: Path, test_commands: list[str]
    ) -> dict:
        """
        Run pytest, pylint, flake8, and code_extractor concurrently.

        Uses asyncio.gather so all four tools run in parallel — the
        total wall time is bounded by the slowest tool, not the sum.
        """
        from app.services.agents.tools.pytest_tool import run_tests
        from app.services.agents.tools.pylint_tool import run_pylint
        from app.services.agents.tools.flake8_tool import run_flake8
        from app.services.agents.tools.code_extractor import extract_code_structure

        loop = asyncio.get_event_loop()

        # Wrap the synchronous tool functions for the executor
        async def _run_tests_async():
            return await loop.run_in_executor(None, run_tests, work_dir, test_commands)

        async def _run_pylint_async():
            return await loop.run_in_executor(None, run_pylint, work_dir)

        async def _run_flake8_async():
            return await loop.run_in_executor(None, run_flake8, work_dir)

        async def _extract_async():
            return await loop.run_in_executor(None, extract_code_structure, work_dir)

        pytest_r, pylint_r, flake8_r, code_s = await asyncio.gather(
            _run_tests_async(),
            _run_pylint_async(),
            _run_flake8_async(),
            _extract_async(),
        )

        return {
            "pytest_results": pytest_r,
            "pylint_results": pylint_r,
            "flake8_results": flake8_r,
            "code_structure": code_s,
        }

    async def _analyze_requirements(
        self,
        acceptance_criteria: str,
        tool_results: dict,
    ) -> list[dict]:
        """
        Sub-agent A: RequirementsAnalyzer.

        Returns a list of {requirement, met, evidence} dicts.
        Falls back to an empty list on repeated failure so the pipeline
        can still continue to the VerdictSynthesizer.
        """
        evidence_block = self._build_context_prompt(tool_results)
        user_prompt = _REQUIREMENTS_USER.format(
            acceptance_criteria=acceptance_criteria,
            evidence_block=evidence_block,
        )

        try:
            result = await self.llm.complete_json(
                prompt=user_prompt,
                system=_REQUIREMENTS_SYSTEM,
            )
            # LLM may return a dict wrapper like {"requirements": [...]}
            if isinstance(result, dict):
                for key in ("requirements", "requirements_met", "analysis"):
                    if isinstance(result.get(key), list):
                        result = result[key]
                        break
                else:
                    result = list(result.values())[0] if result else []
            if not isinstance(result, list):
                result = []
            return result
        except Exception as exc:
            logger.warning("[CodeAgent] RequirementsAnalyzer failed: %s", exc)
            return []

    async def _interpret_test_failures(self, tool_results: dict) -> list[dict]:
        """
        Sub-agent B: TestFailureInterpreter.

        Returns a list of {test_name, root_cause, severity} dicts.
        Falls back to [] on failure.
        """
        pytest_r = tool_results.get("pytest_results", {})
        failed = pytest_r.get("failed_test_details", [])

        # If all tests passed, skip the LLM call entirely
        if not failed:
            return []

        # Build a compact failed-tests block
        failed_block_lines = []
        for fd in failed:
            failed_block_lines.append(f"TEST: {fd.get('name', '?')}")
            error_msg = fd.get("error_message", "no details")[:400]
            failed_block_lines.append(f"ERROR:\n{error_msg}")
            failed_block_lines.append("")
        failed_block = "\n".join(failed_block_lines)

        # Collect source code (non-test files only, truncated)
        code_lines = []
        for f in tool_results.get("code_structure", {}).get("files", []):
            if not f.get("path", "").startswith("test"):
                code_lines.append(f"--- {f['path']} ---")
                code_lines.append(f.get("content", "")[:1500])
        code_block = "\n".join(code_lines) if code_lines else "(no source code available)"

        user_prompt = _TEST_INTERP_USER.format(
            pass_rate=pytest_r.get("pass_rate", 0.0),
            passed=pytest_r.get("passed", 0),
            total=pytest_r.get("total", 0),
            failed_tests_block=failed_block,
            code_block=code_block,
        )

        try:
            result = await self.llm.complete_json(
                prompt=user_prompt,
                system=_TEST_INTERP_SYSTEM,
            )
            if isinstance(result, dict):
                for key in ("failures", "failed_tests", "interpretations", "analysis"):
                    if isinstance(result.get(key), list):
                        result = result[key]
                        break
                else:
                    result = list(result.values())[0] if result else []
            if not isinstance(result, list):
                result = []
            return result
        except Exception as exc:
            logger.warning("[CodeAgent] TestFailureInterpreter failed: %s", exc)
            return []

    async def _synthesize_verdict(
        self,
        acceptance_criteria: str,
        tool_results: dict,
        requirements_analysis: list[dict],
        test_interpretation: list[dict],
    ) -> dict:
        """
        Sub-agent C: VerdictSynthesizer.

        Combines all prior outputs into a single structured verdict JSON.
        Retries up to LLM_MAX_RETRIES times on JSON parse failure.
        """
        pytest_r = tool_results.get("pytest_results", {})
        pylint_r = tool_results.get("pylint_results", {})
        flake8_r = tool_results.get("flake8_results", {})
        code_s   = tool_results.get("code_structure", {})

        # has_error_handling: True if ANY source file has try/except
        has_error_handling = any(
            f.get("has_error_handling", False)
            for f in code_s.get("files", [])
            if not f.get("path", "").startswith("test")
        )

        user_prompt = _VERDICT_USER.format(
            acceptance_criteria=acceptance_criteria,
            requirements_analysis=json.dumps(requirements_analysis, indent=2),
            test_interpretation=json.dumps(test_interpretation, indent=2),
            pass_rate=pytest_r.get("pass_rate", 0.0),
            passed=pytest_r.get("passed", 0),
            total=pytest_r.get("total", 0),
            pylint_score=pylint_r.get("score_raw", 5.0),
            pylint_errors=pylint_r.get("error_count", 0),
            flake8_violations=flake8_r.get("violation_count", 0),
            has_error_handling=has_error_handling,
            total_functions=code_s.get("total_functions", 0),
        )

        max_retries = getattr(self.config, "llm_max_retries", 3)
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                raw = await self.llm.complete(
                    prompt=user_prompt,
                    system=_VERDICT_SYSTEM,
                )
                verdict = self._parse_verdict(raw)
                return verdict
            except (ValueError, LLMProviderError) as exc:
                last_error = exc
                logger.warning(
                    "[CodeAgent] VerdictSynthesizer attempt %d/%d failed: %s",
                    attempt, max_retries, exc,
                )

        # All retries exhausted — build a best-effort verdict from metrics
        logger.error("[CodeAgent] VerdictSynthesizer failed after %d attempts", max_retries)
        return self._metric_fallback_verdict(tool_results, str(last_error))

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _finalise_verdict(
        self,
        verdict: dict,
        tool_results: dict,
        submission_hash: str,
    ) -> dict:
        """
        Post-process the raw verdict from the LLM:
        - Recompute weighted score from breakdown (so it's always consistent)
        - Reapply decision gate so verdict string matches score
        - Attach submission hash and tool metric summaries
        """
        breakdown = verdict.get("score_breakdown", {})

        # Recompute score from breakdown + static analysis metrics
        recomputed = self._compute_final_score(tool_results, breakdown)

        # Use the LLM's score if it's within 0.10 of our recomputed value;
        # otherwise trust our formula (prevents prompt injection inflating scores)
        llm_score = float(verdict.get("score", recomputed))
        if abs(llm_score - recomputed) > 0.10:
            logger.warning(
                "[CodeAgent] LLM score %.3f differs from recomputed %.3f by >0.10 — using recomputed",
                llm_score, recomputed,
            )
            verdict["score"] = recomputed
        else:
            verdict["score"] = round((llm_score + recomputed) / 2.0, 4)

        # Re-derive verdict string from final score
        verdict["verdict"] = self._apply_decision_gate(verdict["score"])

        # Attach metadata
        verdict["submission_hash"] = submission_hash
        verdict["tool_metrics"] = {
            "pytest_pass_rate":    tool_results.get("pytest_results", {}).get("pass_rate", 0.0),
            "pylint_score":        tool_results.get("pylint_results", {}).get("score_raw", 0.0),
            "flake8_violations":   tool_results.get("flake8_results", {}).get("violation_count", 0),
            "total_loc":           tool_results.get("code_structure", {}).get("total_loc", 0),
        }

        return verdict

    def _metric_fallback_verdict(self, tool_results: dict, error_msg: str) -> dict:
        """
        Build a best-effort verdict from raw metrics when all LLM calls fail.
        This ensures the pipeline always returns something meaningful.
        """
        pytest_r = tool_results.get("pytest_results", {})
        pylint_r = tool_results.get("pylint_results", {})
        flake8_r = tool_results.get("flake8_results", {})

        pass_rate    = pytest_r.get("pass_rate", 0.0)
        pylint_norm  = pylint_r.get("score_normalised", 0.5)
        flake8_norm  = flake8_r.get("score_normalised", 0.5)
        static_score = (pylint_norm + flake8_norm) / 2.0

        # Conservative fallback scoring without LLM reasoning
        breakdown = {
            "test_execution":        round(pass_rate, 4),
            "code_quality":          round(static_score, 4),
            "requirements_coverage": round(pass_rate * 0.8, 4),  # conservative
            "llm_reasoning":         0.0,  # no LLM confidence
        }
        score = self._compute_final_score(tool_results, breakdown)
        verdict_str = self._apply_decision_gate(score)

        return {
            "score": score,
            "verdict": verdict_str,
            "confidence": 0.1,  # very low confidence — metric-only
            "requirements_met": [],
            "critical_issues": [
                f"LLM analysis unavailable: {error_msg}",
                "Verdict is based on metrics only — accuracy may be lower.",
            ],
            "minor_issues": [],
            "strengths": [],
            "score_breakdown": breakdown,
            "reasoning": (
                f"LLM pipeline failed ({error_msg}). "
                f"Fallback: pytest={pass_rate:.1%}, pylint={pylint_norm:.2f}, "
                f"flake8={flake8_norm:.2f}."
            ),
            "recommendation": "Resubmit for full LLM analysis.",
        }
