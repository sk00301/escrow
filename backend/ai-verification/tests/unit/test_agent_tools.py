"""
tests/unit/test_agent_tools.py

Unit tests for the agent tool layer.

All tests use tmp_path fixtures with real Python files written to disk.
CodeVerifier methods are mocked so the tool logic is tested in isolation.
The code_extractor tests run against real AST parsing — no mocking needed.

Run:
    pytest tests/unit/test_agent_tools.py -v
"""

from __future__ import annotations

import ast
import textwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


# ===========================================================================
# Fixtures — reusable Python source snippets
# ===========================================================================

CALC_SOURCE = textwrap.dedent("""\
    \"\"\"Simple calculator module.\"\"\"

    def add(a: float, b: float) -> float:
        \"\"\"Return a + b.\"\"\"
        return a + b

    def subtract(a: float, b: float) -> float:
        \"\"\"Return a - b.\"\"\"
        return a - b

    def multiply(a: float, b: float) -> float:
        return a * b

    def divide(a: float, b: float) -> float:
        \"\"\"Return a / b, raising ZeroDivisionError if b is zero.\"\"\"
        if b == 0:
            raise ZeroDivisionError("Cannot divide by zero")
        return a / b
""")

CALC_NO_GUARD_SOURCE = textwrap.dedent("""\
    def add(a, b):
        return a + b

    def divide(a, b):
        return a / b  # no guard!
""")

CLASS_SOURCE = textwrap.dedent("""\
    class BankAccount:
        \"\"\"A simple bank account.\"\"\"

        def __init__(self, balance: float = 0.0) -> None:
            self.balance = balance

        def deposit(self, amount: float) -> None:
            if amount <= 0:
                raise ValueError("Deposit amount must be positive")
            self.balance += amount

        def withdraw(self, amount: float) -> None:
            if amount > self.balance:
                raise ValueError("Insufficient funds")
            self.balance -= amount

    def helper():
        pass
""")

ERROR_HANDLING_SOURCE = textwrap.dedent("""\
    def safe_divide(a, b):
        try:
            return a / b
        except ZeroDivisionError:
            return None
""")

NO_ERROR_HANDLING_SOURCE = textwrap.dedent("""\
    def divide(a, b):
        return a / b
""")

IMPORTS_SOURCE = textwrap.dedent("""\
    import os
    import sys
    from pathlib import Path
    from typing import Optional, List
    import json

    def main():
        pass
""")


# ===========================================================================
# 1. code_extractor — pure AST, no mocking needed
# ===========================================================================

class TestCodeExtractor:

    def _write(self, tmp_path: Path, filename: str, content: str) -> Path:
        p = tmp_path / filename
        p.write_text(content)
        return p

    def test_extracts_functions_from_calc(self, tmp_path):
        self._write(tmp_path, "calc.py", CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)

        assert result["total_functions"] == 4
        names = [f["name"] for f in result["files"][0]["functions"]]
        assert "add" in names
        assert "divide" in names

    def test_function_has_docstring_detected(self, tmp_path):
        self._write(tmp_path, "calc.py", CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        funcs = {f["name"]: f for f in result["files"][0]["functions"]}

        assert funcs["add"]["has_docstring"] is True
        assert funcs["multiply"]["has_docstring"] is False  # no docstring

    def test_function_type_hints_detected(self, tmp_path):
        self._write(tmp_path, "calc.py", CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        funcs = {f["name"]: f for f in result["files"][0]["functions"]}

        assert funcs["add"]["has_type_hints"] is True
        assert funcs["multiply"]["has_type_hints"] is True   # has -> float return hint

    def test_function_args_captured(self, tmp_path):
        self._write(tmp_path, "calc.py", CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        funcs = {f["name"]: f for f in result["files"][0]["functions"]}

        assert funcs["add"]["args"] == ["a", "b"]
        assert funcs["divide"]["args"] == ["a", "b"]

    def test_raises_detected_in_function(self, tmp_path):
        self._write(tmp_path, "calc.py", CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        funcs = {f["name"]: f for f in result["files"][0]["functions"]}

        assert "ZeroDivisionError" in funcs["divide"]["raises"]
        assert funcs["add"]["raises"] == []

    def test_extracts_class_with_methods(self, tmp_path):
        self._write(tmp_path, "bank.py", CLASS_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)

        assert result["total_classes"] == 1
        cls = result["files"][0]["classes"][0]
        assert cls["name"] == "BankAccount"
        assert "deposit" in cls["methods"]
        assert "withdraw" in cls["methods"]

    def test_has_error_handling_true(self, tmp_path):
        self._write(tmp_path, "safe.py", ERROR_HANDLING_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)

        assert result["files"][0]["has_error_handling"] is True

    def test_has_error_handling_false(self, tmp_path):
        self._write(tmp_path, "unsafe.py", NO_ERROR_HANDLING_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)

        assert result["files"][0]["has_error_handling"] is False

    def test_has_error_handling_detected_in_class_methods(self, tmp_path):
        source = textwrap.dedent("""\
            class Foo:
                def bar(self):
                    try:
                        pass
                    except Exception:
                        pass
        """)
        self._write(tmp_path, "foo.py", source)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        assert result["files"][0]["has_error_handling"] is True

    def test_imports_extracted(self, tmp_path):
        self._write(tmp_path, "main.py", IMPORTS_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        imports = result["files"][0]["imports"]

        assert "os" in imports
        assert "sys" in imports
        assert any("Path" in i for i in imports)

    def test_loc_counts_non_blank_non_comment(self, tmp_path):
        source = textwrap.dedent("""\
            # This is a comment
            
            def foo():
                x = 1  # inline comment
                return x
        """)
        self._write(tmp_path, "foo.py", source)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        # Lines: "def foo():", "x = 1  # inline comment", "return x" = 3
        assert result["files"][0]["loc"] == 3

    def test_has_tests_detected(self, tmp_path):
        test_dir = tmp_path / "tests"
        test_dir.mkdir()
        (test_dir / "test_calc.py").write_text("def test_add(): assert 1+1==2")

        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        assert result["has_tests"] is True

    def test_has_tests_false_when_no_test_files(self, tmp_path):
        (tmp_path / "calc.py").write_text(CALC_SOURCE)
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        assert result["has_tests"] is False

    def test_content_truncated_to_max_chars(self, tmp_path, monkeypatch):
        monkeypatch.setenv("LLM_CONTEXT_MAX_CHARS", "50")
        long_source = "x = 1\n" * 200  # much longer than 50 chars
        (tmp_path / "long.py").write_text(long_source)

        from app.services.agents.tools import code_extractor
        # Reload to pick up env var (it reads at call time so no reload needed)
        result = code_extractor.extract_code_structure(tmp_path)
        assert len(result["files"][0]["content"]) == 50

    def test_multiple_files_aggregated(self, tmp_path):
        (tmp_path / "a.py").write_text("def foo(): pass\ndef bar(): pass")
        (tmp_path / "b.py").write_text("def baz(): pass")
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        assert result["total_functions"] == 3
        assert len(result["files"]) == 2

    def test_syntax_error_file_handled_gracefully(self, tmp_path):
        (tmp_path / "broken.py").write_text("def foo(:\n    pass")
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        # Should not raise — should return file entry with parse_error
        assert len(result["files"]) == 1
        assert "parse_error" in result["files"][0]

    def test_skips_pycache_directory(self, tmp_path):
        cache_dir = tmp_path / "__pycache__"
        cache_dir.mkdir()
        (cache_dir / "cached.py").write_text("def cached(): pass")
        (tmp_path / "real.py").write_text("def real(): pass")

        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        paths = [f["path"] for f in result["files"]]
        assert all("__pycache__" not in p for p in paths)
        assert any("real.py" in p for p in paths)

    def test_total_loc_sums_across_files(self, tmp_path):
        (tmp_path / "a.py").write_text("x = 1\ny = 2\n")   # 2 LOC
        (tmp_path / "b.py").write_text("z = 3\n")           # 1 LOC
        from app.services.agents.tools.code_extractor import extract_code_structure
        result = extract_code_structure(tmp_path)
        assert result["total_loc"] == 3


# ===========================================================================
# 2. pytest_tool — mocked CodeVerifier
# ===========================================================================

class TestPytestTool:
    """Tests for run_tests() with mocked CodeVerifier._run_tests()."""

    def _make_test_results(
        self,
        total=5, passed=4, failed=1,
        pass_rate=0.8,
        output="",
        test_details=None,
    ):
        return SimpleNamespace(
            total=total,
            passed=passed,
            failed=failed,
            pass_rate=pass_rate,
            output=output,
            test_details=test_details or [],
        )

    @pytest.fixture
    def mock_verifier(self):
        with patch("app.services.code_verifier.CodeVerifier") as MockClass:
            instance = MockClass.return_value
            yield instance

    def test_basic_counts_returned(self, tmp_path, mock_verifier):
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=10, passed=8, failed=2, pass_rate=0.8
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        assert result["total"] == 10
        assert result["passed"] == 8
        assert result["failed"] == 2
        assert result["pass_rate"] == 0.8

    def test_failed_details_from_structured_test_details(self, tmp_path, mock_verifier):
        """When CodeVerifier returns structured test_details, use them."""
        details = [
            {"name": "test_divide_by_zero", "status": "FAILED",
             "error_message": "ZeroDivisionError: division by zero"},
            {"name": "test_add", "status": "PASSED", "error_message": ""},
        ]
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=2, passed=1, failed=1, pass_rate=0.5,
            test_details=details,
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        assert len(result["failed_test_details"]) == 1
        assert result["failed_test_details"][0]["name"] == "test_divide_by_zero"
        assert "ZeroDivisionError" in result["failed_test_details"][0]["error_message"]

    def test_failed_details_include_error_messages_from_output(self, tmp_path, mock_verifier):
        """When no structured details, parse raw pytest output for error messages."""
        raw_output = textwrap.dedent("""\
            ============================= FAILURES ==============================
            _________________ test_divide_by_zero _________________
            
                def test_divide_by_zero():
            >       result = divide(10, 0)
            
            tests/test_calc.py:15: in test_divide_by_zero
            E   ZeroDivisionError: division by zero
            
            ========================= short test summary info ===================
            FAILED tests/test_calc.py::test_divide_by_zero - ZeroDivisionError: division by zero
            1 failed, 3 passed in 0.12s
        """)
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=4, passed=3, failed=1, pass_rate=0.75,
            output=raw_output,
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        assert len(result["failed_test_details"]) == 1
        detail = result["failed_test_details"][0]
        assert "test_divide_by_zero" in detail["name"]
        # The error message should contain meaningful content, not just the name
        assert len(detail["error_message"]) > 0

    def test_raw_summary_is_last_20_lines(self, tmp_path, mock_verifier):
        lines = [f"line {i}" for i in range(50)]
        output = "\n".join(lines)
        mock_verifier._run_tests.return_value = self._make_test_results(output=output)

        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        summary_lines = result["raw_summary"].splitlines()
        assert len(summary_lines) == 20
        assert summary_lines[0] == "line 30"
        assert summary_lines[-1] == "line 49"

    def test_errored_count_is_total_minus_passed_minus_failed(self, tmp_path, mock_verifier):
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=10, passed=6, failed=3, pass_rate=0.6
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])
        assert result["errored"] == 1  # 10 - 6 - 3 = 1

    def test_passed_tests_extracted(self, tmp_path, mock_verifier):
        details = [
            {"name": "test_add", "status": "PASSED"},
            {"name": "test_sub", "status": "PASSED"},
            {"name": "test_div", "status": "FAILED", "error_message": "err"},
        ]
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=3, passed=2, failed=1, pass_rate=0.667,
            test_details=details,
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        assert "test_add" in result["passed_tests"]
        assert "test_sub" in result["passed_tests"]
        assert "test_div" not in result["passed_tests"]

    def test_exception_from_verifier_returns_error_result(self, tmp_path, mock_verifier):
        mock_verifier._run_tests.side_effect = RuntimeError("pytest not found")
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])

        assert result["total"] == 0
        assert result["errored"] == 1
        assert "pytest not found" in result["failed_test_details"][0]["error_message"]

    def test_pass_rate_rounded_to_4_decimals(self, tmp_path, mock_verifier):
        mock_verifier._run_tests.return_value = self._make_test_results(
            total=3, passed=1, failed=2, pass_rate=1/3
        )
        from app.services.agents.tools.pytest_tool import run_tests
        result = run_tests(tmp_path, ["pytest tests/"])
        assert result["pass_rate"] == round(1/3, 4)


# ===========================================================================
# 3. pylint_tool — mocked CodeVerifier
# ===========================================================================

class TestPylintTool:

    PYLINT_OUTPUT = textwrap.dedent("""\
        calc.py:5:0: E1101: Module 'os' has no 'environ2' member (no-member)
        calc.py:10:4: W0611: Unused import sys (unused-import)
        calc.py:15:0: C0114: Missing module docstring (missing-module-docstring)
        calc.py:20:4: W0612: Unused variable 'x' (unused-variable)
        calc.py:25:0: E0401: Unable to import 'nonexistent' (import-error)
        calc.py:30:0: C0116: Missing function or method docstring (missing-function-docstring)
        calc.py:35:4: W1514: Using open without explicitly specifying an encoding (unspecified-encoding)
        calc.py:40:0: R0201: Method could be a function (no-self-use)
        calc.py:1:0: C0301: Line too long (101/100) (line-too-long)
        calc.py:45:4: E1120: No value for argument 'b' in function call (no-value-for-argument)
    """)

    @pytest.fixture
    def mock_verifier(self):
        with patch("app.services.code_verifier.CodeVerifier") as MockClass:
            yield MockClass.return_value

    def test_score_returned(self, tmp_path, mock_verifier):
        mock_verifier._run_pylint.return_value = (7.5, 0.75, self.PYLINT_OUTPUT)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)

        assert result["score_raw"] == 7.5
        assert result["score_normalised"] == 0.75

    def test_top_issues_sorted_by_severity(self, tmp_path, mock_verifier):
        """Errors (E) must appear before warnings (W) before conventions (C)."""
        mock_verifier._run_pylint.return_value = (5.0, 0.5, self.PYLINT_OUTPUT)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)

        codes = [issue["code"][0] for issue in result["top_issues"]]
        # All E's should come before any W, all W's before any C
        seen_w = seen_c = False
        for c in codes:
            if c == "W":
                seen_w = True
            if c == "C":
                seen_c = True
            if c == "E":
                assert not seen_w, "E appeared after W — not sorted by severity"
                assert not seen_c, "E appeared after C — not sorted by severity"
            if c == "W":
                assert not seen_c, "W appeared after C — not sorted by severity"

    def test_top_issues_capped_at_10(self, tmp_path, mock_verifier):
        # Generate 20 issues
        many_issues = "\n".join(
            f"calc.py:{i}:0: W0611: Unused import x{i} (unused-import)"
            for i in range(1, 21)
        )
        mock_verifier._run_pylint.return_value = (3.0, 0.3, many_issues)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)
        assert len(result["top_issues"]) == 10

    def test_error_count_correct(self, tmp_path, mock_verifier):
        mock_verifier._run_pylint.return_value = (5.0, 0.5, self.PYLINT_OUTPUT)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)
        # E1101, E0401, E1120 = 3 errors
        assert result["error_count"] == 3

    def test_warning_count_correct(self, tmp_path, mock_verifier):
        mock_verifier._run_pylint.return_value = (5.0, 0.5, self.PYLINT_OUTPUT)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)
        # W0611, W0612, W1514 = 3 warnings
        assert result["warning_count"] == 3

    def test_issue_fields_present(self, tmp_path, mock_verifier):
        mock_verifier._run_pylint.return_value = (5.0, 0.5, self.PYLINT_OUTPUT)
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)
        for issue in result["top_issues"]:
            assert "code" in issue
            assert "message" in issue
            assert "line" in issue
            assert "file" in issue

    def test_exception_returns_error_result(self, tmp_path, mock_verifier):
        mock_verifier._run_pylint.side_effect = RuntimeError("pylint not found")
        from app.services.agents.tools.pylint_tool import run_pylint
        result = run_pylint(tmp_path)
        assert result["score_raw"] == 0.0
        assert result["error_count"] == 1


# ===========================================================================
# 4. flake8_tool — mocked CodeVerifier
# ===========================================================================

class TestFlake8Tool:

    FLAKE8_OUTPUT = textwrap.dedent("""\
        calc.py:1:1: F401 'os' imported but unused
        calc.py:5:80: E501 line too long (105 > 79 characters)
        calc.py:10:1: W291 trailing whitespace
        calc.py:15:1: E302 expected 2 blank lines, found 1
        calc.py:20:5: F821 undefined name 'undefined_var'
        calc.py:25:1: C901 'complex_function' is too complex (11)
        calc.py:30:1: W503 line break before binary operator
        calc.py:35:1: E711 comparison to None (use 'is' or 'is not')
    """)

    @pytest.fixture
    def mock_verifier(self):
        with patch("app.services.code_verifier.CodeVerifier") as MockClass:
            yield MockClass.return_value

    def test_violation_count_returned(self, tmp_path, mock_verifier):
        mock_verifier._run_flake8.return_value = (8, 0.2, self.FLAKE8_OUTPUT)
        from app.services.agents.tools.flake8_tool import run_flake8
        result = run_flake8(tmp_path)
        assert result["violation_count"] == 8

    def test_score_normalised_returned(self, tmp_path, mock_verifier):
        mock_verifier._run_flake8.return_value = (8, 0.2, self.FLAKE8_OUTPUT)
        from app.services.agents.tools.flake8_tool import run_flake8
        result = run_flake8(tmp_path)
        assert result["score_normalised"] == 0.2

    def test_top_violations_capped_at_15(self, tmp_path, mock_verifier):
        many_violations = "\n".join(
            f"calc.py:{i}:1: E501 line too long" for i in range(1, 25)
        )
        mock_verifier._run_flake8.return_value = (24, 0.0, many_violations)
        from app.services.agents.tools.flake8_tool import run_flake8
        result = run_flake8(tmp_path)
        assert len(result["top_violations"]) == 15

    def test_categories_counted_correctly(self, tmp_path, mock_verifier):
        mock_verifier._run_flake8.return_value = (8, 0.2, self.FLAKE8_OUTPUT)
        from app.services.agents.tools.flake8_tool import run_flake8
        result = run_flake8(tmp_path)
        cats = result["categories"]
        # E501, E302, E711 = 3 E-codes
        assert cats["E"] == 3
        # W291, W503 = 2 W-codes
        assert cats["W"] == 2
        # C901 = 1 C-code
        assert cats["C"] == 1
        # F401, F821 = 2 F-codes
        assert cats["F"] == 2

    def test_exception_returns_error_result(self, tmp_path, mock_verifier):
        mock_verifier._run_flake8.side_effect = RuntimeError("flake8 not installed")
        from app.services.agents.tools.flake8_tool import run_flake8
        result = run_flake8(tmp_path)
        assert result["violation_count"] == 0
        assert "flake8 not installed" in result["top_violations"][0]


# ===========================================================================
# 5. git_tool — mocked CodeVerifier
# ===========================================================================

class TestGitTool:

    @pytest.fixture
    def mock_verifier(self):
        with patch("app.services.code_verifier.CodeVerifier") as MockClass:
            yield MockClass.return_value

    def test_returns_path_and_hash(self, tmp_path, mock_verifier):
        mock_verifier._ingest_submission.return_value = (
            tmp_path, "abc123def456" * 3
        )
        from app.services.agents.tools.git_tool import ingest_submission
        work_dir, sha = ingest_submission("/some/path")

        assert isinstance(work_dir, Path)
        assert work_dir == tmp_path
        assert isinstance(sha, str)

    def test_raises_on_file_not_found(self, tmp_path, mock_verifier):
        mock_verifier._ingest_submission.side_effect = FileNotFoundError("not found")
        from app.services.agents.tools.git_tool import ingest_submission, SubmissionIngestionError
        with pytest.raises(SubmissionIngestionError, match="not found"):
            ingest_submission("/nonexistent/path")

    def test_raises_on_invalid_format(self, tmp_path, mock_verifier):
        mock_verifier._ingest_submission.side_effect = ValueError("bad format")
        from app.services.agents.tools.git_tool import ingest_submission, SubmissionIngestionError
        with pytest.raises(SubmissionIngestionError, match="Invalid submission format"):
            ingest_submission("not_a_valid_submission")

    def test_raises_when_work_dir_does_not_exist(self, mock_verifier):
        mock_verifier._ingest_submission.return_value = (
            Path("/nonexistent/work_dir"), "abc123"
        )
        from app.services.agents.tools.git_tool import ingest_submission, SubmissionIngestionError
        with pytest.raises(SubmissionIngestionError, match="non-existent work directory"):
            ingest_submission("/some/path")

    def test_generic_exception_wrapped(self, tmp_path, mock_verifier):
        mock_verifier._ingest_submission.side_effect = RuntimeError("git clone failed")
        from app.services.agents.tools.git_tool import ingest_submission, SubmissionIngestionError
        with pytest.raises(SubmissionIngestionError, match="git clone failed"):
            ingest_submission("https://github.com/user/repo")


# ===========================================================================
# 6. __init__.py exports
# ===========================================================================

class TestToolsPackageExports:

    def test_all_tools_importable_from_package(self):
        from app.services.agents.tools import (
            run_tests,
            run_pylint,
            run_flake8,
            extract_code_structure,
            ingest_submission,
            SubmissionIngestionError,
        )
        assert callable(run_tests)
        assert callable(run_pylint)
        assert callable(run_flake8)
        assert callable(extract_code_structure)
        assert callable(ingest_submission)
        assert issubclass(SubmissionIngestionError, Exception)
