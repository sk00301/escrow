"""
app/services/agents/test_gen_agent.py

SRSTestGenAgent — reads an SRS document and generates a complete pytest
test suite for the described project.

Pipeline
────────
Step 1  Parse SRS
          - Text/Markdown SRS → send directly to LLM
          - Image SRS (PNG/JPG) → send via vision API
          - Mixed (markdown + images) → both together
        Output: structured requirements JSON

Step 2  Scan project files
          - Uses code_extractor to find actual function/class signatures
          - Aligns requirements to real function names

Step 3  Generate tests
          - For each requirement → generate pytest test functions
          - Includes happy path, edge cases, boundary values, error cases
          - Uses actual function signatures from the project

Step 4  Validate and save
          - Syntax-check generated tests with ast.parse
          - Write to <project_dir>/test_submission.py
          - Return the test code + summary
"""

from __future__ import annotations

import ast
import logging
import os
from pathlib import Path

from app.core.config import Settings
from app.services.llm.provider import LLMProvider, LLMProviderError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_PARSE_SRS_SYSTEM = """You are a software requirements analyst.
Your job is to read an SRS document and extract a structured list of
requirements that a pytest test suite must verify.

For each function or class described, extract:
- The function/class name
- Its parameters and types
- What it returns
- What exceptions it raises and when
- Boundary values that must be tested
- Edge cases mentioned

Return ONLY valid JSON. No prose, no markdown fences."""

_PARSE_SRS_USER = """Read the following SRS document and extract all testable requirements.

SRS DOCUMENT:
{srs_content}

Return a JSON object with this structure:
{{
  "module_name": "the python module/file name (e.g. calculator.py)",
  "import_name": "the import name without .py (e.g. calculator or submission)",
  "functions": [
    {{
      "name": "function_name",
      "params": ["param1: type", "param2: type"],
      "returns": "return type and description",
      "raises": [
        {{"exception": "ValueError", "when": "when b is zero"}}
      ],
      "happy_path_examples": [
        {{"inputs": [3, 4], "expected": 7}},
        {{"inputs": [0, 0], "expected": 0}}
      ],
      "boundary_values": [
        {{"input": -1, "expected": "raises ValueError"}},
        {{"input": 0, "expected": 0}}
      ],
      "edge_cases": ["handles empty list", "works with floats"]
    }}
  ],
  "classes": [
    {{
      "name": "ClassName",
      "constructor_params": ["owner: str", "balance: float = 0.0"],
      "constructor_raises": [{{"exception": "ValueError", "when": "balance < 0"}}],
      "methods": [
        {{
          "name": "method_name",
          "params": ["amount: float"],
          "returns": "float",
          "raises": [{{"exception": "ValueError", "when": "amount <= 0"}}],
          "examples": [{{"inputs": [50.0], "expected": 50.0}}]
        }}
      ]
    }}
  ],
  "acceptance_criteria": ["list", "of", "must-have", "requirements"]
}}"""

_SCAN_AND_GEN_SYSTEM = """You are a senior Python test engineer.
Your job is to write a comprehensive pytest test suite based on requirements
and actual source code.

Rules:
- Import from the module using the import_name provided
- Write clear, descriptive test function names: test_<what>_<condition>
- Every requirement gets at least one test
- Every boundary value gets its own test
- Every exception case gets its own test using pytest.raises
- Group related tests in classes
- Add a brief comment above each test explaining what it verifies
- Tests must be completely self-contained — no external dependencies
- Use pytest.approx() for float comparisons
- Return ONLY the raw Python test code, no explanation, no markdown fences"""

_GEN_TESTS_USER = """Write a complete pytest test suite based on these requirements and source code.

REQUIREMENTS (extracted from SRS):
{requirements_json}

ACTUAL SOURCE CODE (scan of the project):
{source_code}

IMPORTANT:
- Import using: from {import_name} import ...
- The source code shows the actual function signatures — use them exactly
- Generate tests for EVERY function and method listed
- Include: happy path, boundary values, error cases, edge cases
- Use descriptive names like test_divide_raises_value_error_when_divisor_is_zero

Write the complete test file content now. Start with imports, then test classes/functions."""


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class SRSTestGenAgent:
    """
    Generates a pytest test suite from an SRS document + project source code.

    Usage
    ─────
        agent = SRSTestGenAgent(llm=provider, config=settings)
        result = await agent.generate(
            project_dir=Path("./my_project"),
            srs_path=Path("./my_project/srs.md"),
            output_filename="test_submission.py",
        )
        print(result["test_file"])        # path to generated test file
        print(result["tests_generated"])  # number of test functions
    """

    def __init__(self, llm: LLMProvider, config: Settings) -> None:
        self.llm = llm
        self.config = config

    async def generate(
        self,
        project_dir: Path,
        srs_path: Path,
        output_filename: str = "test_submission.py",
        srs_images: list[Path] | None = None,
    ) -> dict:
        """
        Full pipeline: SRS → requirements → tests → save.

        Args:
            project_dir:      Directory containing the project's Python files.
            srs_path:         Path to the SRS document (markdown, txt, or image).
            output_filename:  Name for the generated test file.
            srs_images:       Optional list of image paths (diagrams, screenshots)
                              to send alongside a text SRS.

        Returns:
            {
                "test_file":        str path to the generated test file,
                "test_code":        str the full test code,
                "tests_generated":  int number of test functions,
                "requirements":     dict the extracted requirements,
                "import_name":      str what the tests import from,
                "warnings":         [str] any issues found,
            }
        """
        warnings: list[str] = []

        # ── Step 1: Parse SRS ─────────────────────────────────────────
        logger.info("[TestGenAgent] Step 1: parsing SRS at %s", srs_path)
        requirements = await self._parse_srs(srs_path, srs_images, warnings)
        logger.info(
            "[TestGenAgent] extracted %d functions, %d classes",
            len(requirements.get("functions", [])),
            len(requirements.get("classes", [])),
        )

        # ── Step 2: Scan project source code ──────────────────────────
        logger.info("[TestGenAgent] Step 2: scanning project at %s", project_dir)
        source_code = self._scan_project(project_dir, warnings)

        # Determine import name: prefer what SRS says, fall back to scanning
        import_name = requirements.get("import_name") or self._detect_import_name(project_dir, warnings)
        requirements["import_name"] = import_name
        logger.info("[TestGenAgent] import_name=%s", import_name)

        # ── Step 3: Generate tests ────────────────────────────────────
        logger.info("[TestGenAgent] Step 3: generating tests")
        test_code = await self._generate_tests(requirements, source_code, import_name)

        # ── Step 4: Validate and save ─────────────────────────────────
        logger.info("[TestGenAgent] Step 4: validating and saving")
        test_code = self._validate_and_fix(test_code, warnings)
        tests_count = _count_test_functions(test_code)

        output_path = project_dir / output_filename
        output_path.write_text(test_code, encoding="utf-8")
        logger.info(
            "[TestGenAgent] saved %d tests to %s", tests_count, output_path
        )

        return {
            "test_file": str(output_path),
            "test_code": test_code,
            "tests_generated": tests_count,
            "requirements": requirements,
            "import_name": import_name,
            "warnings": warnings,
        }

    # ------------------------------------------------------------------
    # Step implementations
    # ------------------------------------------------------------------

    async def _parse_srs(
        self,
        srs_path: Path,
        extra_images: list[Path] | None,
        warnings: list[str],
    ) -> dict:
        """Read the SRS and extract structured requirements."""
        suffix = srs_path.suffix.lower()
        image_suffixes = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}

        # Collect all images to send
        images: list[Path] = []
        srs_text: str = ""

        if suffix in image_suffixes:
            # SRS is itself an image
            images.append(srs_path)
            srs_text = "[SRS provided as image — see attached]"
        elif suffix in {".md", ".txt", ".rst", ""}:
            srs_text = srs_path.read_text(encoding="utf-8", errors="replace")
        else:
            warnings.append(f"Unknown SRS format: {suffix} — treating as text")
            srs_text = srs_path.read_text(encoding="utf-8", errors="replace")

        if extra_images:
            images.extend(extra_images)

        prompt = _PARSE_SRS_USER.format(srs_content=srs_text)

        try:
            if images:
                # Use vision-capable call
                if hasattr(self.llm, "complete_json_with_images"):
                    result = await self.llm.complete_json_with_images(
                        prompt=prompt,
                        images=images,
                        system=_PARSE_SRS_SYSTEM,
                    )
                else:
                    warnings.append(
                        "LLM provider does not support vision — images ignored"
                    )
                    result = await self.llm.complete_json(
                        prompt=prompt, system=_PARSE_SRS_SYSTEM
                    )
            else:
                result = await self.llm.complete_json(
                    prompt=prompt, system=_PARSE_SRS_SYSTEM
                )
        except Exception as exc:
            warnings.append(f"SRS parsing failed: {exc}")
            logger.warning("[TestGenAgent] SRS parse error: %s", exc)
            result = {"functions": [], "classes": [], "acceptance_criteria": []}

        return result

    def _scan_project(self, project_dir: Path, warnings: list[str]) -> str:
        """
        Scan all Python files in the project and return their content.
        Skips test files and __pycache__.
        """
        from app.services.agents.tools.code_extractor import extract_code_structure

        try:
            structure = extract_code_structure(project_dir)
        except Exception as exc:
            warnings.append(f"Code scan failed: {exc}")
            return "(could not scan project files)"

        lines: list[str] = []
        max_chars = int(os.environ.get("LLM_CONTEXT_MAX_CHARS", "8000"))

        for f in structure.get("files", []):
            # Skip test files — we're generating them
            if "test" in f["path"].lower():
                continue
            lines.append(f"\n--- {f['path']} ---")
            lines.append(f.get("content", "")[:max_chars // max(1, len(structure["files"]))])

        if not lines:
            warnings.append("No Python source files found in project directory")
            return "(no Python files found)"

        return "\n".join(lines)

    def _detect_import_name(self, project_dir: Path, warnings: list[str]) -> str:
        """
        Guess the module import name by looking at Python files.
        Prefers 'submission' > single .py file name > 'submission'.
        """
        py_files = [
            f for f in project_dir.glob("*.py")
            if not f.name.startswith("test_")
            and f.name != "conftest.py"
            and f.name != "__init__.py"
        ]

        if not py_files:
            # Check src/ subdirectory
            src_dir = project_dir / "src"
            if src_dir.exists():
                py_files = [
                    f for f in src_dir.glob("*.py")
                    if not f.name.startswith("test_")
                ]

        if not py_files:
            warnings.append("No source Python files found — defaulting import to 'submission'")
            return "submission"

        # Prefer submission.py if it exists
        for f in py_files:
            if f.stem == "submission":
                return "submission"

        # Otherwise use the first non-test .py file
        return py_files[0].stem

    async def _generate_tests(
        self,
        requirements: dict,
        source_code: str,
        import_name: str,
    ) -> str:
        """Send requirements + source to LLM and get back test code."""
        import json as _json

        prompt = _GEN_TESTS_USER.format(
            requirements_json=_json.dumps(requirements, indent=2)[:4000],
            source_code=source_code[:4000],
            import_name=import_name,
        )

        max_retries = int(os.environ.get("LLM_MAX_RETRIES", "3"))
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                raw = await self.llm.complete(
                    prompt=prompt,
                    system=_SCAN_AND_GEN_SYSTEM,
                )
                # Strip markdown fences if present
                code = LLMProvider.strip_markdown_fences(raw)
                # Strip ```python fences
                if code.startswith("python\n"):
                    code = code[len("python\n"):]
                # Validate it's parseable Python
                ast.parse(code)
                return code
            except SyntaxError as exc:
                last_error = exc
                logger.warning(
                    "[TestGenAgent] generate attempt %d/%d syntax error: %s",
                    attempt, max_retries, exc,
                )
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "[TestGenAgent] generate attempt %d/%d error: %s",
                    attempt, max_retries, exc,
                )

        # All retries failed — return a minimal valid test file
        logger.error("[TestGenAgent] all generate attempts failed: %s", last_error)
        return _fallback_test_code(import_name, requirements, str(last_error))

    def _validate_and_fix(self, test_code: str, warnings: list[str]) -> str:
        """
        Check the generated test code compiles.
        If not, wrap the broken code in a comment and add a placeholder test.
        """
        try:
            ast.parse(test_code)
            return test_code
        except SyntaxError as exc:
            warnings.append(f"Generated code had syntax error: {exc} — see comments in file")
            return (
                f"# AUTO-GENERATED TEST FILE — SYNTAX ERROR DETECTED\n"
                f"# Error: {exc}\n"
                f"# Original code follows as comments:\n"
                + "\n".join(f"# {line}" for line in test_code.splitlines())
                + "\n\nimport pytest\n\ndef test_placeholder():\n"
                "    \"\"\"Placeholder — fix syntax errors above\"\"\"\n"
                "    pass\n"
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _count_test_functions(code: str) -> int:
    """Count functions starting with 'test_' in the code."""
    try:
        tree = ast.parse(code)
        return sum(
            1 for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name.startswith("test_")
        )
    except SyntaxError:
        return 0


def _fallback_test_code(
    import_name: str,
    requirements: dict,
    error: str,
) -> str:
    """Minimal test file when LLM generation completely fails."""
    functions = requirements.get("functions", [])
    lines = [
        f"# Test file generated by SRSTestGenAgent",
        f"# LLM generation failed: {error}",
        f"# Minimal placeholder tests generated from requirements",
        "",
        "import pytest",
        f"from {import_name} import *",
        "",
    ]
    for fn in functions:
        name = fn.get("name", "unknown")
        lines.append(f"def test_{name}_exists():")
        lines.append(f'    """Verify {name} is importable and callable."""')
        lines.append(f"    assert callable({name})")
        lines.append("")
    if not functions:
        lines += [
            "def test_placeholder():",
            '    """Placeholder test — update with actual tests."""',
            "    pass",
        ]
    return "\n".join(lines)
