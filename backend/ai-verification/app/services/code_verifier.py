"""
app/services/code_verifier.py
══════════════════════════════════════════════════════════════════════════════
Core code verification engine.

Evaluates a submitted Python code repository against milestone acceptance
criteria and returns a normalised quality score (0.0–1.0) with a full
explainability bundle.

Pipeline
────────
  Step 1  Submission ingestion   — clone / unzip, hash, validate
  Step 2  Sandboxed test run     — pytest via subprocess, parse results
  Step 3  Static analysis        — pylint + flake8 via subprocess
  Step 4  Score calculation      — weighted average of sub-scores
  Step 5  Verdict determination  — APPROVED / DISPUTED / REJECTED
  Step 6  Explainability bundle  — structured result dict

Usage
─────
    from app.services.code_verifier import CodeVerifier

    verifier = CodeVerifier()
    result = verifier.verify(
        submission="https://github.com/user/repo",
        test_commands=["pytest tests/"],
        thresholds={"approval": 0.75, "ambiguity_low": 0.45},
    )
    print(result["verdict"])   # "APPROVED" | "DISPUTED" | "REJECTED"
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ── Custom exceptions ────────────────────────────────────────────────────────

class VerificationError(Exception):
    """Base class for all verifier failures."""


class SubmissionIngestionError(VerificationError):
    """Raised when the repo cannot be cloned / extracted."""


class NoTestsFoundError(VerificationError):
    """Raised when no pytest-compatible tests are found in the submission."""


class NoPythonFilesError(VerificationError):
    """Raised when the submission contains no Python source files."""


class SuiteTimeoutError(VerificationError):
    """Raised when the test suite exceeds the allowed wall-clock time."""

# Alias so callers can also use the intuitive name without pytest collecting it
TestTimeoutError = SuiteTimeoutError


class EmptySubmissionError(VerificationError):
    """Raised when the submission directory is empty after ingestion."""


# ── Configuration dataclass ──────────────────────────────────────────────────

@dataclass
class VerifierConfig:
    """
    All tuneable parameters in one place.
    Values are overridden by the thresholds dict passed to verify().
    """
    # Score weights — must sum to 1.0
    weight_test_pass: float = 0.60
    weight_pylint:    float = 0.25
    weight_flake8:    float = 0.15

    # Verdict thresholds
    approval_threshold: float = 0.75
    ambiguity_band_low: float = 0.45

    # Execution limits
    test_timeout_seconds: int = 60
    max_flake8_violations: int = 100   # denominator for normalisation

    # Paths
    python_executable: str = sys.executable


# ── Individual result data classes ──────────────────────────────────────────

@dataclass
class IndividualTest:
    name: str
    status: str          # "PASSED" | "FAILED" | "ERROR" | "SKIPPED"
    duration_seconds: float = 0.0
    error_message: str = ""


@dataclass
class TestResults:
    total: int = 0
    passed: int = 0
    failed: int = 0
    errored: int = 0
    skipped: int = 0
    pass_rate: float = 0.0
    individual_tests: list[IndividualTest] = field(default_factory=list)
    raw_output: str = ""


@dataclass
class StaticAnalysisResults:
    pylint_raw_score: float = 0.0   # X out of 10
    pylint_score: float = 0.0       # normalised 0.0–1.0
    pylint_output: str = ""
    flake8_violations: int = 0
    flake8_score: float = 1.0       # normalised 0.0–1.0
    flake8_output: str = ""


# ── Main verifier class ──────────────────────────────────────────────────────

class CodeVerifier:
    """
    Stateless verification engine.  Instantiate once (e.g. at app startup)
    and call verify() for each job.  Each call operates in its own
    isolated temporary directory which is cleaned up on completion.
    """

    def __init__(self, config: VerifierConfig | None = None) -> None:
        self.config = config or VerifierConfig()

    # ══════════════════════════════════════════════════════════════════════════
    #  Public entry point
    # ══════════════════════════════════════════════════════════════════════════

    def verify(
        self,
        submission: str,
        test_commands: list[str] | None = None,
        thresholds: dict[str, float] | None = None,
    ) -> dict[str, Any]:
        """
        Run the full verification pipeline on a submission.

        Parameters
        ----------
        submission : str
            Either a GitHub HTTPS URL  ("https://github.com/user/repo")
            or a local path to a .zip file ("/tmp/submission.zip").
        test_commands : list[str], optional
            pytest commands to execute, e.g. ["pytest tests/", "pytest tests/unit/"].
            Defaults to ["pytest"] which discovers all tests automatically.
        thresholds : dict, optional
            Override scoring thresholds:
              {"approval": 0.75, "ambiguity_low": 0.45,
               "weight_test": 0.60, "weight_pylint": 0.25, "weight_flake8": 0.15}

        Returns
        -------
        dict
            Full explainability bundle (see Step 6 below).

        Raises
        ------
        SubmissionIngestionError  — repo not found / clone failed / bad zip
        EmptySubmissionError      — submission directory is empty
        NoPythonFilesError        — no .py files found
        NoTestsFoundError         — no tests/ directory or test_*.py files
        TestTimeoutError          — test suite exceeded timeout
        """
        start_time = time.monotonic()
        test_commands = test_commands or ["pytest"]
        self._apply_threshold_overrides(thresholds)

        work_dir: Path | None = None
        try:
            # ── Step 1 — Ingest submission ───────────────────────────────────
            work_dir, submission_hash = self._ingest_submission(submission)

            # ── Step 2 — Run tests ───────────────────────────────────────────
            test_results = self._run_tests(work_dir, test_commands)

            # ── Step 3 — Static analysis ─────────────────────────────────────
            static_results = self._run_static_analysis(work_dir)

            # ── Step 4 — Score calculation ───────────────────────────────────
            final_score, breakdown = self._calculate_score(
                test_results.pass_rate,
                static_results.pylint_score,
                static_results.flake8_score,
            )

            # ── Step 5 — Verdict ─────────────────────────────────────────────
            verdict = self._determine_verdict(final_score)

            elapsed = round(time.monotonic() - start_time, 3)
            logger.info(
                "verification_complete",
                extra={
                    "score": final_score,
                    "verdict": verdict,
                    "elapsed_s": elapsed,
                    "hash": submission_hash[:12] + "...",
                },
            )

            # ── Step 6 — Explainability bundle ───────────────────────────────
            return self._build_result(
                final_score=final_score,
                verdict=verdict,
                test_results=test_results,
                static_results=static_results,
                breakdown=breakdown,
                submission_hash=submission_hash,
                elapsed=elapsed,
            )

        finally:
            if work_dir and work_dir.exists():
                shutil.rmtree(work_dir, ignore_errors=True)

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 1 — Submission ingestion
    # ══════════════════════════════════════════════════════════════════════════

    def _ingest_submission(self, submission: str) -> tuple[Path, str]:
        """
        Clone or unzip the submission into a temporary directory.

        Returns (work_dir, sha256_hash_of_all_py_files).
        """
        work_dir = Path(tempfile.mkdtemp(prefix="ai_verify_"))
        logger.info("ingesting_submission", extra={"source": submission, "work_dir": str(work_dir)})

        try:
            if submission.startswith(("https://github.com", "http://github.com", "git@github.com")):
                self._clone_github_repo(submission, work_dir)
            elif submission.lower().endswith(".zip"):
                self._extract_zip(submission, work_dir)
            else:
                # Treat as a local directory path (useful for tests)
                src = Path(submission)
                if not src.exists():
                    raise SubmissionIngestionError(
                        f"Submission path does not exist: {submission}"
                    )
                shutil.copytree(src, work_dir / "submission")
                work_dir = work_dir / "submission"
        except VerificationError:
            raise
        except Exception as exc:
            raise SubmissionIngestionError(
                f"Failed to ingest submission '{submission}': {exc}"
            ) from exc

        self._validate_submission(work_dir)
        submission_hash = self._compute_submission_hash(work_dir)
        return work_dir, submission_hash

    def _clone_github_repo(self, url: str, target: Path) -> None:
        """Clone a GitHub repository via gitpython."""
        try:
            import git  # gitpython — optional at import time
        except ImportError as exc:
            raise SubmissionIngestionError(
                "gitpython is not installed. Run: pip install gitpython"
            ) from exc

        logger.info("cloning_repo", extra={"url": url})
        try:
            git.Repo.clone_from(url, target, depth=1, timeout=60)
        except git.exc.GitCommandError as exc:
            raise SubmissionIngestionError(
                f"Git clone failed for '{url}': {exc}"
            ) from exc
        except Exception as exc:
            raise SubmissionIngestionError(
                f"Unexpected error cloning '{url}': {exc}"
            ) from exc

    def _extract_zip(self, zip_path: str, target: Path) -> None:
        """Extract a zip archive into target/."""
        path = Path(zip_path)
        if not path.exists():
            raise SubmissionIngestionError(f"Zip file not found: {zip_path}")
        if not zipfile.is_zipfile(path):
            raise SubmissionIngestionError(f"File is not a valid zip archive: {zip_path}")

        with zipfile.ZipFile(path, "r") as zf:
            # Security: reject paths with directory traversal
            for member in zf.namelist():
                if ".." in member or member.startswith("/"):
                    raise SubmissionIngestionError(
                        f"Unsafe path in zip archive: {member}"
                    )
            zf.extractall(target)

    def _validate_submission(self, work_dir: Path) -> None:
        """Raise descriptive errors if the submission is unusable."""
        all_files = list(work_dir.rglob("*"))
        if not all_files:
            raise EmptySubmissionError(
                "Submission directory is empty after extraction."
            )

        py_files = [f for f in all_files if f.suffix == ".py" and f.is_file()]
        if not py_files:
            raise NoPythonFilesError(
                f"No Python (.py) files found in submission at '{work_dir}'. "
                "Only Python code repositories are supported in this prototype."
            )

        # Check for test files: test_*.py  |  *_test.py  |  any .py under a tests/ dir
        test_files = [
            f for f in py_files
            if f.name.startswith("test_")
            or f.name.endswith("_test.py")
            or any(part.lower() in ("tests", "test") for part in f.parts)
        ]
        if not test_files:
            raise NoTestsFoundError(
                "No test files found (expected test_*.py files or a tests/ directory). "
                "The submission must include a test suite."
            )

        logger.info(
            "submission_validated",
            extra={"py_files": len(py_files), "test_files": len(test_files)},
        )

    def _compute_submission_hash(self, work_dir: Path) -> str:
        """
        Compute a SHA-256 hash over the content of all .py files,
        sorted by path for determinism.  Used as tamper-evidence stored
        on-chain via EvidenceRegistry.
        """
        hasher = hashlib.sha256()
        py_files = sorted(work_dir.rglob("*.py"))

        for py_file in py_files:
            # Include the relative path so renames are detectable
            rel_path = py_file.relative_to(work_dir)
            hasher.update(str(rel_path).encode("utf-8"))
            hasher.update(py_file.read_bytes())

        digest = hasher.hexdigest()
        logger.info("submission_hash_computed", extra={"hash_prefix": digest[:16]})
        return digest

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 2 — Sandboxed test execution
    # ══════════════════════════════════════════════════════════════════════════

    def _run_tests(self, work_dir: Path, test_commands: list[str]) -> TestResults:
        """
        Execute every test command in the list, merge results, and return
        a unified TestResults.  Each command runs with a fresh subprocess
        in work_dir.
        """
        all_individual: list[IndividualTest] = []
        all_raw_outputs: list[str] = []
        total = passed = failed = errored = skipped = 0

        for command in test_commands:
            logger.info("running_test_command", extra={"cmd": command})
            result = self._execute_pytest(work_dir, command)
            all_raw_outputs.append(f"$ {command}\n{result.raw_output}")

            total   += result.total
            passed  += result.passed
            failed  += result.failed
            errored += result.errored
            skipped += result.skipped
            all_individual.extend(result.individual_tests)

        # Deduplicate tests that appear in multiple commands
        seen: set[str] = set()
        deduped: list[IndividualTest] = []
        for t in all_individual:
            if t.name not in seen:
                seen.add(t.name)
                deduped.append(t)

        # Recount after dedup
        if deduped:
            total   = len(deduped)
            passed  = sum(1 for t in deduped if t.status == "PASSED")
            failed  = sum(1 for t in deduped if t.status == "FAILED")
            errored = sum(1 for t in deduped if t.status == "ERROR")
            skipped = sum(1 for t in deduped if t.status == "SKIPPED")

        pass_rate = round(passed / total, 4) if total > 0 else 0.0

        return TestResults(
            total=total,
            passed=passed,
            failed=failed,
            errored=errored,
            skipped=skipped,
            pass_rate=pass_rate,
            individual_tests=deduped,
            raw_output="\n\n".join(all_raw_outputs),
        )

    def _execute_pytest(self, work_dir: Path, command: str) -> TestResults:
        """
        Run a single pytest command via subprocess.

        Uses --tb=short --no-header -v for machine-parseable output and
        -p no:cacheprovider to avoid writing .pytest_cache in the work_dir.
        """
        # Build the full command — always call our own Python interpreter so
        # the correct environment (with pytest installed) is used.
        parts = command.strip().split()
        if parts[0] == "pytest":
            parts[0] = self.config.python_executable
            parts.insert(1, "-m")
            parts.insert(2, "pytest")

        # Force flags that make output parseable
        extra_flags = ["--tb=short", "--no-header", "-v", "-p", "no:cacheprovider"]
        # Avoid duplicating flags the caller already provided
        for flag in extra_flags:
            if flag not in parts:
                parts.append(flag)

        try:
            proc = subprocess.run(
                parts,
                capture_output=True,
                text=True,
                cwd=str(work_dir),
                timeout=self.config.test_timeout_seconds,
                env={**os.environ, "PYTHONPATH": str(work_dir)},
            )
        except subprocess.TimeoutExpired as exc:
            raise TestTimeoutError(
                f"Test suite exceeded {self.config.test_timeout_seconds}s timeout "
                f"while running '{command}'"
            ) from exc
        except FileNotFoundError as exc:
            raise VerificationError(
                f"pytest executable not found when running '{command}': {exc}"
            ) from exc

        combined_output = proc.stdout + ("\n" + proc.stderr if proc.stderr.strip() else "")
        return self._parse_pytest_output(combined_output)

    def _parse_pytest_output(self, output: str) -> TestResults:
        """
        Parse verbose pytest output (-v) into structured TestResults.

        Recognises lines like:
            tests/test_calc.py::test_add PASSED            [ 25%]
            tests/test_calc.py::test_div_zero FAILED       [ 50%]
            tests/test_calc.py::test_import_err ERROR      [ 75%]
            tests/test_calc.py::test_big_num SKIPPED       [100%]

        And summary lines like:
            5 passed, 2 failed, 1 error in 0.42s
            3 passed in 1.23s
            no tests ran
        """
        individual: list[IndividualTest] = []
        error_sections: dict[str, str] = {}

        # ── 1. Parse individual test lines ───────────────────────────────────
        # Pattern covers both short node IDs and full paths
        test_line_re = re.compile(
            r"^(?P<nodeid>\S+::\S+)\s+"
            r"(?P<status>PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)"
            r"(?:\s+\[[\s\d]+%\])?",
            re.MULTILINE,
        )
        for match in test_line_re.finditer(output):
            individual.append(
                IndividualTest(
                    name=match.group("nodeid"),
                    status=match.group("status").upper(),
                )
            )

        # ── 2. Collect FAILED / ERROR messages from short traceback ──────────
        # Sections between "FAILURES" / "ERRORS" headers and the next header
        failure_block_re = re.compile(
            r"_{3,}\s+(?P<name>\S+::\S+)\s+_{3,}\n(?P<body>.*?)(?=\n_{3,}|\nE\s|\Z)",
            re.DOTALL,
        )
        for match in failure_block_re.finditer(output):
            # Grab just the assertion / error lines (lines starting with E)
            e_lines = [
                ln.lstrip("E").strip()
                for ln in match.group("body").splitlines()
                if ln.strip().startswith("E ")
            ]
            error_sections[match.group("name")] = "; ".join(e_lines[:3])  # first 3 lines

        # Attach error messages to the appropriate individual test
        for t in individual:
            if t.status in ("FAILED", "ERROR") and t.name in error_sections:
                t.error_message = error_sections[t.name]

        # ── 3. Parse summary line ─────────────────────────────────────────────
        # e.g.  "5 passed, 2 failed, 1 error in 0.42s"
        summary_re = re.compile(
            r"(?:(?P<passed>\d+)\s+passed)?[,\s]*"
            r"(?:(?P<failed>\d+)\s+failed)?[,\s]*"
            r"(?:(?P<error>\d+)\s+error(?:s)?)?[,\s]*"
            r"(?:(?P<skipped>\d+)\s+(?:skipped|warning))?",
            re.IGNORECASE,
        )

        # Find the last "short test summary" or "=== N passed" line
        summary_line = ""
        for line in reversed(output.splitlines()):
            if re.search(r"\d+\s+(?:passed|failed|error)", line):
                summary_line = line
                break

        passed = failed = errored = skipped = 0
        if summary_line:
            m = summary_re.search(summary_line)
            if m:
                passed  = int(m.group("passed")  or 0)
                failed  = int(m.group("failed")  or 0)
                errored = int(m.group("error")   or 0)
                skipped = int(m.group("skipped") or 0)

        # Fall back to counting parsed individual results if summary parsing failed
        if passed + failed + errored + skipped == 0 and individual:
            passed  = sum(1 for t in individual if t.status == "PASSED")
            failed  = sum(1 for t in individual if t.status == "FAILED")
            errored = sum(1 for t in individual if t.status == "ERROR")
            skipped = sum(1 for t in individual if t.status == "SKIPPED")

        total = passed + failed + errored
        pass_rate = round(passed / total, 4) if total > 0 else 0.0

        return TestResults(
            total=total,
            passed=passed,
            failed=failed,
            errored=errored,
            skipped=skipped,
            pass_rate=pass_rate,
            individual_tests=individual,
            raw_output=output,
        )

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 3 — Static analysis
    # ══════════════════════════════════════════════════════════════════════════

    def _run_static_analysis(self, work_dir: Path) -> StaticAnalysisResults:
        """Run pylint and flake8, normalise scores, merge into one result."""
        pylint_raw, pylint_norm, pylint_out = self._run_pylint(work_dir)
        violations, flake8_norm, flake8_out = self._run_flake8(work_dir)

        return StaticAnalysisResults(
            pylint_raw_score=pylint_raw,
            pylint_score=pylint_norm,
            pylint_output=pylint_out,
            flake8_violations=violations,
            flake8_score=flake8_norm,
            flake8_output=flake8_out,
        )

    def _run_pylint(self, work_dir: Path) -> tuple[float, float, str]:
        """
        Run pylint and extract the global score.

        pylint exits with non-zero on warnings — we always read stdout.
        Returns (raw_score_out_of_10, normalised_0_to_1, raw_output).
        """
        py_files = [str(p) for p in work_dir.rglob("*.py")
                    if not any(part.startswith(".") for part in p.parts)]
        if not py_files:
            return 0.0, 0.0, "No Python files to analyse."

        try:
            proc = subprocess.run(
                [
                    self.config.python_executable, "-m", "pylint",
                    "--output-format=text",
                    "--score=yes",
                    "--disable=C0114,C0115,C0116",  # ignore missing docstrings in submissions
                    *py_files,
                ],
                capture_output=True,
                text=True,
                cwd=str(work_dir),
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            logger.warning("pylint_timeout")
            return 5.0, 0.5, "pylint timed out — defaulting to 5.0/10"
        except FileNotFoundError:
            logger.warning("pylint_not_found")
            return 5.0, 0.5, "pylint not installed — defaulting to 5.0/10"

        output = proc.stdout + proc.stderr

        # pylint prints:  "Your code has been rated at 8.50/10 (previous run: …)"
        score_match = re.search(
            r"Your code has been rated at\s+(-?\d+\.?\d*)/10",
            output,
        )
        if score_match:
            raw = max(0.0, float(score_match.group(1)))  # clamp negatives to 0
        else:
            logger.warning("pylint_score_not_found_in_output")
            raw = 5.0  # neutral default

        normalised = round(raw / 10.0, 4)
        logger.info("pylint_score", extra={"raw": raw, "normalised": normalised})
        return raw, normalised, output

    def _run_flake8(self, work_dir: Path) -> tuple[int, float, str]:
        """
        Run flake8 and count style violations.

        Returns (violation_count, normalised_0_to_1, raw_output).
        Normalisation: 1.0 - min(violations / max_violations, 1.0)
        """
        try:
            proc = subprocess.run(
                [
                    self.config.python_executable, "-m", "flake8",
                    "--max-line-length=120",
                    "--extend-ignore=E501",   # ignore very long lines (generous for submissions)
                    str(work_dir),
                ],
                capture_output=True,
                text=True,
                cwd=str(work_dir),
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            logger.warning("flake8_timeout")
            return 0, 1.0, "flake8 timed out — defaulting to 0 violations"
        except FileNotFoundError:
            logger.warning("flake8_not_found")
            return 0, 1.0, "flake8 not installed — defaulting to 0 violations"

        output = proc.stdout.strip()
        violations = len(output.splitlines()) if output else 0
        normalised = round(
            1.0 - min(violations / self.config.max_flake8_violations, 1.0), 4
        )
        logger.info("flake8_violations", extra={"count": violations, "score": normalised})
        return violations, normalised, output

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 4 — Score calculation
    # ══════════════════════════════════════════════════════════════════════════

    def _calculate_score(
        self,
        test_pass_rate: float,
        pylint_score: float,
        flake8_score: float,
    ) -> tuple[float, dict[str, float]]:
        """
        Weighted average of the three sub-scores.

        Returns (final_score, breakdown_dict).
        """
        cfg = self.config
        test_contribution   = round(test_pass_rate * cfg.weight_test_pass, 4)
        pylint_contribution = round(pylint_score    * cfg.weight_pylint,    4)
        flake8_contribution = round(flake8_score    * cfg.weight_flake8,    4)
        final_score = round(
            test_contribution + pylint_contribution + flake8_contribution, 4
        )

        breakdown = {
            "test_contribution":   test_contribution,
            "pylint_contribution": pylint_contribution,
            "flake8_contribution": flake8_contribution,
            "weights": {
                "test_pass":  cfg.weight_test_pass,
                "pylint":     cfg.weight_pylint,
                "flake8":     cfg.weight_flake8,
            },
        }
        logger.info(
            "score_calculated",
            extra={"final": final_score, "breakdown": breakdown},
        )
        return final_score, breakdown

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 5 — Verdict determination
    # ══════════════════════════════════════════════════════════════════════════

    def _determine_verdict(self, score: float) -> str:
        """
        Apply the decision gate.

        ≥ approval_threshold          → APPROVED  (oracle releases payment)
        ambiguity_low ≤ score < thr   → DISPUTED  (jury triggered)
        < ambiguity_low               → REJECTED  (submission rejected)
        """
        if score >= self.config.approval_threshold:
            return "APPROVED"
        if score >= self.config.ambiguity_band_low:
            return "DISPUTED"
        return "REJECTED"

    # ══════════════════════════════════════════════════════════════════════════
    #  Step 6 — Explainability bundle
    # ══════════════════════════════════════════════════════════════════════════

    def _build_result(
        self,
        final_score: float,
        verdict: str,
        test_results: TestResults,
        static_results: StaticAnalysisResults,
        breakdown: dict[str, Any],
        submission_hash: str,
        elapsed: float,
    ) -> dict[str, Any]:
        """
        Assemble the full explainability bundle consumed by the React
        AI Verification results page and the oracle bridge.
        """
        passed_tests = [
            t.name for t in test_results.individual_tests if t.status == "PASSED"
        ]
        failed_tests = [
            {"name": t.name, "status": t.status, "error": t.error_message}
            for t in test_results.individual_tests
            if t.status in ("FAILED", "ERROR")
        ]

        return {
            # ── Top-level decision ────────────────────────────────────────────
            "final_score": final_score,
            "verdict": verdict,

            # ── Test results ──────────────────────────────────────────────────
            "test_results": {
                "total":    test_results.total,
                "passed":   test_results.passed,
                "failed":   test_results.failed,
                "errored":  test_results.errored,
                "skipped":  test_results.skipped,
                "pass_rate": test_results.pass_rate,
                "individual_tests": [
                    {
                        "name":     t.name,
                        "status":   t.status,
                        "duration": t.duration_seconds,
                        "error":    t.error_message,
                    }
                    for t in test_results.individual_tests
                ],
            },

            # ── Static analysis ───────────────────────────────────────────────
            "static_analysis": {
                "pylint_raw_score":  static_results.pylint_raw_score,
                "pylint_score":      static_results.pylint_score,
                "flake8_violations": static_results.flake8_violations,
                "flake8_score":      static_results.flake8_score,
            },

            # ── Score breakdown (for React explainability panel) ──────────────
            "weighted_breakdown": breakdown,

            # ── Convenience lists for the frontend verdict cards ──────────────
            "passed_tests": passed_tests,
            "failed_tests": failed_tests,

            # ── Provenance & audit ────────────────────────────────────────────
            "submission_hash": submission_hash,
            "execution_time_seconds": elapsed,
            "timestamp": datetime.now(timezone.utc).isoformat(),

            # ── Raw tool output (for admin debug panel) ───────────────────────
            "raw_output": {
                "pytest":  test_results.raw_output[:4000],   # truncate for storage
                "pylint":  static_results.pylint_output[:2000],
                "flake8":  static_results.flake8_output[:2000],
            },
        }

    # ══════════════════════════════════════════════════════════════════════════
    #  Helpers
    # ══════════════════════════════════════════════════════════════════════════

    def _apply_threshold_overrides(self, thresholds: dict[str, float] | None) -> None:
        """Allow per-job threshold overrides without mutating the shared config."""
        if not thresholds:
            return
        if "approval" in thresholds:
            self.config.approval_threshold = thresholds["approval"]
        if "ambiguity_low" in thresholds:
            self.config.ambiguity_band_low = thresholds["ambiguity_low"]
        if "weight_test" in thresholds:
            self.config.weight_test_pass = thresholds["weight_test"]
        if "weight_pylint" in thresholds:
            self.config.weight_pylint = thresholds["weight_pylint"]
        if "weight_flake8" in thresholds:
            self.config.weight_flake8 = thresholds["weight_flake8"]
