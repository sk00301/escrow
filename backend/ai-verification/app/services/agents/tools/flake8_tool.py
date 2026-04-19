"""
app/services/agents/tools/flake8_tool.py

Thin wrapper around CodeVerifier._run_flake8() that returns a clean structured
dict suitable for embedding directly into LLM prompts.

Only the first 15 violations are forwarded to the LLM.  The full count is
still reported so the LLM knows the scale of the problem.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# flake8 output line: path/to/file.py:line:col: EXXX message
_FLAKE8_LINE = re.compile(
    r"^[^:]+:\d+:\d+:\s*(?P<code>[A-Z]\d+)\s"
)


def run_flake8(work_dir: Path) -> dict:
    """
    Run flake8 on the submission and return a structured dict for LLM use.

    Calls CodeVerifier._run_flake8() — does NOT reimplement linting.

    Args:
        work_dir: Path to the extracted submission directory.

    Returns:
        {
            "violation_count":  int,
            "score_normalised": float,   # 0.0 – 1.0
            "top_violations":   [str],   # first 15 raw violation lines
            "categories": {
                "E": int,   # PEP-8 errors
                "W": int,   # warnings
                "C": int,   # McCabe complexity
                "F": int,   # pyflakes (undefined names, unused imports, etc.)
            }
        }
    """
    from app.services.code_verifier import CodeVerifier

    verifier = CodeVerifier()

    try:
        violation_count, norm_score, output = verifier._run_flake8(work_dir)
    except Exception as exc:
        logger.error("[flake8_tool] _run_flake8 raised: %s", exc)
        return _error_result(str(exc))

    violation_lines = [ln for ln in output.splitlines() if ln.strip()]
    top_violations = violation_lines[:15]
    categories = _count_categories(violation_lines)

    result = {
        "violation_count": int(violation_count),
        "score_normalised": round(float(norm_score), 4),
        "top_violations": top_violations,
        "categories": categories,
    }

    logger.debug(
        "[flake8_tool] %d violations (E=%d W=%d C=%d F=%d) in %s",
        violation_count,
        categories["E"], categories["W"], categories["C"], categories["F"],
        work_dir,
    )
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _count_categories(lines: list[str]) -> dict[str, int]:
    """Count violations by first letter of their code."""
    counts: dict[str, int] = {"E": 0, "W": 0, "C": 0, "F": 0}
    for line in lines:
        m = _FLAKE8_LINE.match(line.strip())
        if m:
            prefix = m.group("code")[0]
            if prefix in counts:
                counts[prefix] += 1
            # Codes starting with other letters are counted under E as a catch-all
    return counts


def _error_result(message: str) -> dict:
    return {
        "violation_count": 0,
        "score_normalised": 0.0,
        "top_violations": [f"Tool error: {message}"],
        "categories": {"E": 0, "W": 0, "C": 0, "F": 0},
    }
