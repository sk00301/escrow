"""
app/services/agents/tools/pylint_tool.py

Thin wrapper around CodeVerifier._run_pylint() that returns a clean structured
dict suitable for embedding directly into LLM prompts.

Only the top 10 most severe issues are forwarded to the LLM to keep prompt
size manageable.  Severity order: E (error) > W (warning) > C (convention)
> R (refactor) > I (informational).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Pylint message-code prefix → severity rank (lower = more severe)
_SEVERITY_RANK: dict[str, int] = {
    "E": 0,   # Error
    "F": 0,   # Fatal (treat same as Error)
    "W": 1,   # Warning
    "C": 2,   # Convention
    "R": 3,   # Refactor
    "I": 4,   # Informational
}

# Regex to parse a pylint output line:
# path/to/file.py:line:col: E1234: message (symbol)
_PYLINT_LINE = re.compile(
    r"^(?P<file>[^:]+):(?P<line>\d+):\d+:\s*"
    r"(?P<code>[A-Z]\d{4}):\s*(?P<message>.+?)(?:\s+\([^)]+\))?$"
)


def run_pylint(work_dir: Path) -> dict:
    """
    Run pylint on the submission and return a structured dict for LLM use.

    Calls CodeVerifier._run_pylint() — does NOT reimplement linting.

    Args:
        work_dir: Path to the extracted submission directory.

    Returns:
        {
            "score_raw":        float,   # pylint score out of 10
            "score_normalised": float,   # 0.0 – 1.0
            "top_issues": [
                {"code": str, "message": str, "line": int, "file": str}
            ],  # top 10 most severe, sorted E > W > C > R
            "error_count":      int,
            "warning_count":    int,
            "convention_count": int,
        }
    """
    from app.services.code_verifier import CodeVerifier

    verifier = CodeVerifier()

    try:
        raw_score, norm_score, output = verifier._run_pylint(work_dir)
    except Exception as exc:
        logger.error("[pylint_tool] _run_pylint raised: %s", exc)
        return _error_result(str(exc))

    issues = _parse_issues(output)

    # Count by category
    error_count = sum(1 for i in issues if i["code"].startswith(("E", "F")))
    warning_count = sum(1 for i in issues if i["code"].startswith("W"))
    convention_count = sum(1 for i in issues if i["code"].startswith("C"))

    # Sort by severity rank, then by line number within same severity
    issues.sort(key=lambda i: (_SEVERITY_RANK.get(i["code"][0], 5), i["line"]))

    top_issues = issues[:10]

    result = {
        "score_raw": round(float(raw_score), 2),
        "score_normalised": round(float(norm_score), 4),
        "top_issues": top_issues,
        "error_count": error_count,
        "warning_count": warning_count,
        "convention_count": convention_count,
    }

    logger.debug(
        "[pylint_tool] score=%.2f/10 errors=%d warnings=%d in %s",
        raw_score, error_count, warning_count, work_dir,
    )
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_issues(output: str) -> list[dict]:
    """
    Parse pylint stdout into a list of issue dicts.

    Handles both the default text format and the --output-format=parseable
    format that CodeVerifier may use.
    """
    issues: list[dict] = []

    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue

        m = _PYLINT_LINE.match(line)
        if m:
            issues.append({
                "code": m.group("code"),
                "message": m.group("message").strip(),
                "line": int(m.group("line")),
                "file": m.group("file").strip(),
            })
            continue

        # Fallback: some pylint versions emit "file.py:line: [CODE] message"
        alt = re.match(
            r"^(?P<file>[^:]+):(?P<line>\d+):\s*\[(?P<code>[A-Z]\d{4})[^\]]*\]\s*(?P<message>.+)$",
            line,
        )
        if alt:
            issues.append({
                "code": alt.group("code"),
                "message": alt.group("message").strip(),
                "line": int(alt.group("line")),
                "file": alt.group("file").strip(),
            })

    return issues


def _error_result(message: str) -> dict:
    return {
        "score_raw": 0.0,
        "score_normalised": 0.0,
        "top_issues": [{"code": "E0000", "message": f"Tool error: {message}", "line": 0, "file": ""}],
        "error_count": 1,
        "warning_count": 0,
        "convention_count": 0,
    }
