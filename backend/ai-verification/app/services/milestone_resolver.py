"""
app/services/milestone_resolver.py
══════════════════════════════════════════════════════════════════════════════
Parses the  ## Milestone Deliverables  section of a SRS markdown document
and returns a list of MilestoneScope objects ready for the verification
pipeline.

The section follows this structure (one block per milestone):

    ## 9. Milestone Deliverables

    ### Milestone 1 — Core scaffold
    **Due:** 2026-07-01
    **Required functions:** add, subtract
    **Required keywords:** basic arithmetic, input validation
    **Test scope:** pytest tests/unit/m1/
    **Acceptance criteria:** Implement add(a,b) and subtract(a,b) …

    ### Milestone 2 — Advanced operations
    …

Usage
─────
    from app.services.milestone_resolver import MilestoneResolver

    resolver = MilestoneResolver()

    # Parse a full SRS string — returns all milestones
    scopes = resolver.parse(srs_text)

    # Get only milestone 1
    scope = resolver.get(srs_text, milestone_number=1)
    # Returns None when the milestone is not defined in the SRS

Fallback behaviour
──────────────────
    If the SRS contains no  ## Milestone Deliverables  section, parse()
    returns an empty list.  Callers MUST check for this and either raise
    a 422 (strict mode) or fall back to full-SRS verification.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from app.models.schemas import MilestoneScope

logger = logging.getLogger(__name__)

# ── Regex patterns ────────────────────────────────────────────────────────────

# Matches the top-level deliverables section (heading level 2, any numbering)
_SECTION_RE = re.compile(
    r"^#{1,3}\s+(?:\d+\.)?\s*Milestone\s+Deliverables\b",
    re.IGNORECASE | re.MULTILINE,
)

# Matches an individual milestone subsection heading
# e.g. "### Milestone 1 — Core scaffold"  or  "## Milestone 3"
_MILESTONE_HEADING_RE = re.compile(
    r"^#{2,4}\s+Milestone\s+(\d+)(?:\s*[—\-–]\s*(.+))?$",
    re.IGNORECASE | re.MULTILINE,
)

# ── Field extractors — each captures the value after the bold label ───────────
# Handles both:
#   **Required functions:** value   (colon inside bold — common markdown style)
#   **Required functions**: value   (colon outside bold)
#   **Required functions** : value  (colon with space)
_FIELD_PATTERNS: dict[str, re.Pattern] = {
    "required_functions": re.compile(
        r"\*\*Required\s+functions?:?\*\*\s*:?\s*(.+)", re.IGNORECASE
    ),
    "required_keywords": re.compile(
        r"\*\*Required\s+keywords?:?\*\*\s*:?\s*(.+)", re.IGNORECASE
    ),
    "test_scope": re.compile(
        r"\*\*Test\s+scope:?\*\*\s*:?\s*(.+)", re.IGNORECASE
    ),
    "acceptance_criteria": re.compile(
        r"\*\*Acceptance\s+criteria:?\*\*\s*:?\s*(.+)", re.IGNORECASE
    ),
    "weight_test": re.compile(
        r"\*\*Weight\s+test(?:s)?:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
    "weight_pylint": re.compile(
        r"\*\*Weight\s+pylint:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
    "weight_flake8": re.compile(
        r"\*\*Weight\s+flake8:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
    "weight_similarity": re.compile(
        r"\*\*Weight\s+similarity:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
    "weight_keywords": re.compile(
        r"\*\*Weight\s+keywords:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
    "weight_structure": re.compile(
        r"\*\*Weight\s+structure:?\*\*\s*:?\s*([\d.]+)", re.IGNORECASE
    ),
}


# ── Helper functions ──────────────────────────────────────────────────────────

def _split_csv(raw: str) -> list[str]:
    """Split a comma-separated string into a stripped, non-empty list."""
    return [item.strip() for item in raw.split(",") if item.strip()]


def _split_pytest_commands(raw: str) -> list[str]:
    """
    Split test scope into individual pytest commands.

    Handles both comma-separated and semicolon-separated lists.
    Each item is normalised to start with 'pytest'.
    """
    raw = raw.strip()
    # Support both comma and semicolon delimiters
    parts = re.split(r"[,;]", raw)
    commands: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Ensure every command starts with pytest
        if not part.startswith("pytest"):
            part = f"pytest {part}"
        commands.append(part)
    return commands or ["pytest"]


def _normalise_weights(overrides: dict[str, float]) -> dict[str, float]:
    """
    Normalise weight overrides so they sum to 1.0.

    If the sum is already 1.0 (±0.01) the dict is returned unchanged.
    If not, every weight is scaled proportionally and a warning is logged.
    This prevents a malformed SRS from breaking a verification job.
    """
    if not overrides:
        return overrides
    total = sum(overrides.values())
    if abs(total - 1.0) < 0.01:
        return overrides
    if total == 0:
        logger.warning("milestone_resolver: weight overrides all zero, ignoring")
        return {}
    logger.warning(
        "milestone_resolver: weight overrides sum to %.3f (expected 1.0) — normalising",
        total,
    )
    return {k: round(v / total, 6) for k, v in overrides.items()}


# ── Main resolver class ───────────────────────────────────────────────────────

class MilestoneResolver:
    """
    Stateless SRS parser.  Instantiate once and call parse() / get()
    for each SRS document — no mutable state between calls.
    """

    # ── Public API ────────────────────────────────────────────────────────────

    def parse(self, srs_text: str) -> list[MilestoneScope]:
        """
        Parse all milestone blocks from a SRS markdown string.

        Parameters
        ----------
        srs_text : str
            Full contents of the SRS document.

        Returns
        -------
        list[MilestoneScope]
            One item per defined milestone, ordered by milestone_number.
            Returns an empty list if no  ## Milestone Deliverables  section
            is found (caller must handle this as a fallback condition).
        """
        section_text = self._extract_deliverables_section(srs_text)
        if section_text is None:
            logger.info("milestone_resolver: no 'Milestone Deliverables' section found in SRS")
            return []

        milestone_blocks = self._split_into_milestone_blocks(section_text)
        scopes: list[MilestoneScope] = []

        for number, label, block_text in milestone_blocks:
            try:
                scope = self._parse_block(number, label, block_text)
                scopes.append(scope)
                logger.info(
                    "milestone_resolver: parsed milestone %d ('%s') — "
                    "%d functions, %d keywords, %d test commands",
                    number,
                    label,
                    len(scope.required_functions),
                    len(scope.required_keywords),
                    len(scope.test_scope),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "milestone_resolver: skipping milestone %d — parse error: %s",
                    number,
                    exc,
                )

        scopes.sort(key=lambda s: s.milestone_number)
        return scopes

    def get(self, srs_text: str, milestone_number: int) -> MilestoneScope | None:
        """
        Return the scope for a specific milestone number, or None if not found.

        Parameters
        ----------
        srs_text : str
            Full contents of the SRS document.
        milestone_number : int
            1-based milestone number to look up.

        Returns
        -------
        MilestoneScope | None
        """
        scopes = self.parse(srs_text)
        for scope in scopes:
            if scope.milestone_number == milestone_number:
                return scope
        logger.info(
            "milestone_resolver: milestone %d not found in SRS "
            "(available: %s)",
            milestone_number,
            [s.milestone_number for s in scopes] or "none",
        )
        return None

    # ── Private helpers ───────────────────────────────────────────────────────

    def _extract_deliverables_section(self, srs_text: str) -> str | None:
        """
        Find and return the text block that starts at the
        '## Milestone Deliverables' heading and ends at the next
        same-or-higher-level heading (or end of document).

        Returns None if the section is not present.
        """
        match = _SECTION_RE.search(srs_text)
        if not match:
            return None

        section_start = match.start()
        heading_prefix = match.group(0).lstrip().split()[0]  # e.g. "##" or "###"
        heading_level = len(heading_prefix)

        # Build a pattern that matches any heading at the SAME or HIGHER level
        # that is NOT a milestone sub-heading (those are one level deeper)
        next_section_re = re.compile(
            r"^#{1,%d}\s+(?!Milestone\s+\d)" % heading_level,
            re.MULTILINE,
        )

        # Search AFTER the current heading line ends
        rest_start = srs_text.index("\n", section_start) + 1
        next_section = next_section_re.search(srs_text, rest_start)

        section_end = next_section.start() if next_section else len(srs_text)
        return srs_text[section_start:section_end]

    def _split_into_milestone_blocks(
        self, section_text: str
    ) -> list[tuple[int, str, str]]:
        """
        Split the deliverables section into individual milestone blocks.

        Returns a list of (milestone_number, label, block_text) tuples.
        """
        headings = list(_MILESTONE_HEADING_RE.finditer(section_text))
        if not headings:
            return []

        blocks: list[tuple[int, str, str]] = []
        for i, heading_match in enumerate(headings):
            number = int(heading_match.group(1))
            label  = (heading_match.group(2) or f"Milestone {number}").strip()

            block_start = heading_match.end()
            block_end   = headings[i + 1].start() if i + 1 < len(headings) else len(section_text)
            block_text  = section_text[block_start:block_end].strip()

            blocks.append((number, label, block_text))

        return blocks

    def _parse_block(self, number: int, label: str, block_text: str) -> MilestoneScope:
        """
        Extract all fields from a single milestone block and build a
        MilestoneScope.  Missing optional fields get safe defaults.
        """
        # ── Required functions ────────────────────────────────────────────────
        m = _FIELD_PATTERNS["required_functions"].search(block_text)
        required_functions = _split_csv(m.group(1)) if m else []

        # ── Required keywords ─────────────────────────────────────────────────
        m = _FIELD_PATTERNS["required_keywords"].search(block_text)
        required_keywords = _split_csv(m.group(1)) if m else []

        # ── Test scope ────────────────────────────────────────────────────────
        m = _FIELD_PATTERNS["test_scope"].search(block_text)
        test_scope = _split_pytest_commands(m.group(1)) if m else ["pytest"]

        # ── Acceptance criteria ───────────────────────────────────────────────
        # Grab everything after the field label to end of line; also capture
        # subsequent continuation lines (not starting with **)
        m = _FIELD_PATTERNS["acceptance_criteria"].search(block_text)
        if m:
            # The label value starts on the same line; there may be more lines
            criteria_start = m.start(1)
            # Collect continuation lines until next **Field** or end of block
            remainder = block_text[criteria_start:]
            continuation_re = re.compile(r"\n(?!\s*\*\*|\s*#{2,}|\s*$)")
            lines = [m.group(1).strip()]
            for line_match in re.finditer(r"\n(.+)", remainder):
                line = line_match.group(1).strip()
                if re.match(r"\*\*\w", line) or re.match(r"#{2,}", line):
                    break
                if line:
                    lines.append(line)
            acceptance_criteria = " ".join(lines).strip()
        else:
            acceptance_criteria = f"Complete all deliverables for Milestone {number}: {label}"

        # ── Weight overrides (optional) ───────────────────────────────────────
        weight_overrides: dict[str, float] = {}
        for weight_key in ("weight_test", "weight_pylint", "weight_flake8",
                           "weight_similarity", "weight_keywords", "weight_structure"):
            wm = _FIELD_PATTERNS[weight_key].search(block_text)
            if wm:
                try:
                    weight_overrides[weight_key] = float(wm.group(1))
                except ValueError:
                    pass

        weight_overrides = _normalise_weights(weight_overrides)

        return MilestoneScope(
            milestone_number    = number,
            label               = label,
            required_functions  = required_functions,
            required_keywords   = required_keywords,
            test_scope          = test_scope,
            acceptance_criteria = acceptance_criteria,
            weight_overrides    = weight_overrides,
        )
