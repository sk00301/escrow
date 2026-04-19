"""
app/services/agents/tools/pytest_tool.py

Thin wrapper around CodeVerifier._run_tests() that returns a clean structured
dict suitable for embedding directly into LLM prompts.

Critical design requirement: failed test details must include the actual error
messages (AssertionError text, exception tracebacks) so the LLM can reason
about WHY a test failed, not just that it failed.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Severity order used when the CodeVerifier returns a TestResults object
_SEVERITY_PATTERN = re.compile(
    r"FAILED\s+([\w/.\-]+::[\w\[\]]+)\s*-?\s*(.*)", re.MULTILINE
)
_PASSED_PATTERN = re.compile(r"PASSED\s+([\w/.\-]+::[\w\[\]]+)", re.MULTILINE)
_SHORT_TEST_ID = re.compile(r"([\w/.\-]+::[\w\[\]-]+)")


def run_tests(work_dir: Path, test_commands: list[str]) -> dict:
    """
    Run the test suite and return a structured dict for LLM consumption.

    Calls CodeVerifier._run_tests() under the hood — does NOT reimplement
    test execution.

    Args:
        work_dir:      Path to the extracted submission directory.
        test_commands: List of pytest command strings, e.g. ["pytest tests/"].

    Returns:
        {
            "total":               int,
            "passed":              int,
            "failed":              int,
            "errored":             int,
            "pass_rate":           float,   # 0.0 – 1.0
            "failed_test_details": [
                {"name": str, "error_message": str}
            ],
            "passed_tests":        [str],
            "raw_summary":         str,     # last 20 lines of pytest output
        }

    The "error_message" field in failed_test_details is what feeds the LLM's
    TestResultInterpreter — it contains the actual assertion / exception text.
    """
    # Import here so test mocking is straightforward
    from app.services.code_verifier import CodeVerifier

    verifier = CodeVerifier()

    try:
        test_results = verifier._run_tests(work_dir, test_commands)
    except Exception as exc:
        logger.error("[pytest_tool] _run_tests raised: %s", exc)
        return _error_result(str(exc))

    # CodeVerifier._run_tests returns a TestResults namedtuple/object.
    # Documented fields: total, passed, failed, pass_rate, test_details, output
    raw_output: str = _extract_output(test_results)
    raw_lines = raw_output.splitlines()
    raw_summary = "\n".join(raw_lines[-20:]) if len(raw_lines) > 20 else raw_output

    total = _safe_int(test_results, "total", 0)
    passed = _safe_int(test_results, "passed", 0)
    failed = _safe_int(test_results, "failed", 0)
    pass_rate = _safe_float(test_results, "pass_rate", 0.0)

    # Errored = tests that didn't even run (collection errors, import failures)
    errored = max(0, total - passed - failed)

    # --- Parse failed test details with error messages ---
    failed_test_details = _extract_failed_details(test_results, raw_output)

    # --- Parse passed test names ---
    passed_tests = _extract_passed_tests(test_results, raw_output)

    result = {
        "total": total,
        "passed": passed,
        "failed": failed,
        "errored": errored,
        "pass_rate": round(pass_rate, 4),
        "failed_test_details": failed_test_details,
        "passed_tests": passed_tests,
        "raw_summary": raw_summary,
    }

    logger.debug(
        "[pytest_tool] %d/%d passed (%.1f%%) in %s",
        passed, total, pass_rate * 100, work_dir,
    )
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_output(test_results) -> str:
    """Pull the raw stdout string from whatever TestResults shape is returned."""
    for attr in ("output", "stdout", "raw_output", "text"):
        val = getattr(test_results, attr, None)
        if val and isinstance(val, str):
            return val
    # Fallback: stringify the whole object
    return str(test_results)


def _safe_int(obj, attr: str, default: int) -> int:
    val = getattr(obj, attr, None)
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _safe_float(obj, attr: str, default: float) -> float:
    val = getattr(obj, attr, None)
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _extract_failed_details(test_results, raw_output: str) -> list[dict]:
    """
    Build the failed_test_details list.

    Strategy (in priority order):
    1. Use test_results.test_details if it provides structured failure info.
    2. Parse the raw pytest output for FAILED lines + associated tracebacks.
    """
    details: list[dict] = []

    # Strategy 1: structured test_details from CodeVerifier
    test_details = getattr(test_results, "test_details", None)
    if test_details and isinstance(test_details, (list, tuple)):
        for item in test_details:
            if isinstance(item, dict):
                status = item.get("status", item.get("outcome", "")).upper()
                if status in ("FAILED", "ERROR"):
                    details.append({
                        "name": item.get("name", item.get("nodeid", "unknown")),
                        "error_message": item.get(
                            "error_message",
                            item.get("longrepr", item.get("message", "No error details available")),
                        ),
                    })
            else:
                # Might be a namedtuple or simple object
                name = getattr(item, "name", getattr(item, "nodeid", "unknown"))
                status = str(getattr(item, "status", getattr(item, "outcome", ""))).upper()
                if status in ("FAILED", "ERROR"):
                    error_msg = getattr(
                        item, "error_message",
                        getattr(item, "longrepr", getattr(item, "message", "No error details available"))
                    )
                    details.append({"name": str(name), "error_message": str(error_msg)})
        if details:
            return details

    # Strategy 2: parse raw pytest output
    # Pytest output has sections like:
    #   FAILED tests/test_calc.py::test_divide_by_zero - assert 0 == ZeroDivisionError
    # And longer tracebacks in the "FAILURES" section
    details = _parse_failures_from_output(raw_output)
    return details


def _parse_failures_from_output(output: str) -> list[dict]:
    """
    Parse pytest's stdout to extract failed test names + error messages.

    Handles both the short summary line format and the full FAILURES section.
    """
    details: list[dict] = []
    lines = output.splitlines()

    # Build a map: test_name -> error_message from the FAILURES section
    # The FAILURES section looks like:
    #   _________________________ test_name _________________________
    #   ...traceback lines...
    #   AssertionError: ...
    failure_blocks: dict[str, str] = {}
    in_failures_section = False
    current_test: str | None = None
    current_lines: list[str] = []

    for line in lines:
        # Detect start of FAILURES section
        if re.match(r"={5,}\s*FAILURES\s*={5,}", line):
            in_failures_section = True
            continue
        # Detect end (next === section or short test summary)
        if in_failures_section and re.match(r"={5,}", line) and "FAILURES" not in line:
            if current_test and current_lines:
                failure_blocks[current_test] = "\n".join(current_lines).strip()
            in_failures_section = False
            current_test = None
            current_lines = []
            continue

        if in_failures_section:
            # Test separator line: ___ test_name ___
            sep_match = re.match(r"_{5,}\s+(.+?)\s+_{5,}", line)
            if sep_match:
                if current_test and current_lines:
                    failure_blocks[current_test] = "\n".join(current_lines).strip()
                current_test = sep_match.group(1).strip()
                current_lines = []
            elif current_test:
                current_lines.append(line)

    # Flush last block
    if current_test and current_lines:
        failure_blocks[current_test] = "\n".join(current_lines).strip()

    # Now parse the short test summary for FAILED lines
    # Format: FAILED tests/test_x.py::test_name - short reason
    for line in lines:
        m = re.match(r"FAILED\s+([\w/.\-]+::[\w\[\]-]+)\s*(?:-\s*(.*))?", line)
        if m:
            name = m.group(1).strip()
            short_reason = (m.group(2) or "").strip()

            # Look up the full traceback from the failures block
            # The failure block key might be just the test function name
            test_fn = name.split("::")[-1] if "::" in name else name
            full_error = (
                failure_blocks.get(name)
                or failure_blocks.get(test_fn)
                or short_reason
                or "No error details available"
            )

            # Trim to a useful length for LLM context
            if len(full_error) > 800:
                full_error = full_error[:800] + "\n... [truncated]"

            details.append({"name": name, "error_message": full_error})

    return details


def _extract_passed_tests(test_results, raw_output: str) -> list[str]:
    """Return list of passed test node IDs."""
    # Try structured test_details first
    test_details = getattr(test_results, "test_details", None)
    if test_details and isinstance(test_details, (list, tuple)):
        passed = []
        for item in test_details:
            if isinstance(item, dict):
                status = item.get("status", item.get("outcome", "")).upper()
                if status == "PASSED":
                    passed.append(item.get("name", item.get("nodeid", "unknown")))
            else:
                status = str(getattr(item, "status", getattr(item, "outcome", ""))).upper()
                if status == "PASSED":
                    passed.append(str(getattr(item, "name", getattr(item, "nodeid", "unknown"))))
        if passed:
            return passed

    # Fall back to parsing output
    passed = []
    for line in raw_output.splitlines():
        m = re.match(r"([\w/.\-]+::[\w\[\]-]+)\s+PASSED", line)
        if m:
            passed.append(m.group(1))
    return passed


def _error_result(message: str) -> dict:
    """Return a zeroed-out result dict when tool execution itself fails."""
    return {
        "total": 0,
        "passed": 0,
        "failed": 0,
        "errored": 1,
        "pass_rate": 0.0,
        "failed_test_details": [{"name": "tool_error", "error_message": message}],
        "passed_tests": [],
        "raw_summary": f"Tool execution failed: {message}",
    }
