"""
app/services/agents/tools/code_extractor.py

Extracts structural information from Python source files using the AST module.
No LLM or subprocess calls — this is pure static analysis.

The output feeds the LLM's RequirementsAnalyzer sub-agent so it can reason
about what functions exist, whether they have docstrings, error handling, etc.
"""

from __future__ import annotations

import ast
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Python files to skip (test infrastructure, build artifacts, etc.)
_SKIP_DIRS = {
    ".git", "__pycache__", ".pytest_cache", "venv", ".venv",
    "node_modules", "dist", "build", ".eggs", "*.egg-info",
}
_MAX_FILE_SIZE_BYTES = 500_000  # skip files larger than 500 KB


def extract_code_structure(work_dir: Path) -> dict:
    """
    Walk *work_dir* and extract structural metadata from every Python file.

    Uses the stdlib `ast` module — no external dependencies.

    Args:
        work_dir: Path to the extracted submission directory.

    Returns:
        {
            "files": [
                {
                    "path":              str,    # relative path from work_dir
                    "loc":               int,    # lines of code (non-blank, non-comment)
                    "functions":         [...],
                    "classes":           [...],
                    "imports":           [str],
                    "has_error_handling": bool,
                    "content":           str,    # truncated to LLM_CONTEXT_MAX_CHARS
                }
            ],
            "total_loc":        int,
            "total_functions":  int,
            "total_classes":    int,
            "has_tests":        bool,
        }
    """
    max_chars = _context_max_chars()
    files_data: list[dict] = []

    py_files = _collect_python_files(work_dir)
    has_tests = False

    for py_path in sorted(py_files):
        rel_path = str(py_path.relative_to(work_dir))

        # Detect test files
        if _is_test_file(rel_path):
            has_tests = True

        try:
            content = py_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            logger.warning("[code_extractor] Cannot read %s: %s", py_path, exc)
            continue

        file_data = _analyse_file(rel_path, content, max_chars)
        files_data.append(file_data)

    total_loc = sum(f["loc"] for f in files_data)
    total_functions = sum(len(f["functions"]) for f in files_data)
    total_classes = sum(len(f["classes"]) for f in files_data)

    return {
        "files": files_data,
        "total_loc": total_loc,
        "total_functions": total_functions,
        "total_classes": total_classes,
        "has_tests": has_tests,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _collect_python_files(work_dir: Path) -> list[Path]:
    """Return all .py files under work_dir, skipping known non-source dirs."""
    result: list[Path] = []
    for root, dirs, files in os.walk(work_dir):
        # Prune skip dirs in-place so os.walk doesn't descend into them
        dirs[:] = [
            d for d in dirs
            if d not in _SKIP_DIRS and not d.endswith(".egg-info")
        ]
        for fname in files:
            if fname.endswith(".py"):
                fpath = Path(root) / fname
                if fpath.stat().st_size <= _MAX_FILE_SIZE_BYTES:
                    result.append(fpath)
    return result


def _is_test_file(rel_path: str) -> bool:
    parts = rel_path.replace("\\", "/").split("/")
    filename = parts[-1]
    return (
        filename.startswith("test_")
        or filename.endswith("_test.py")
        or any(p in ("tests", "test") for p in parts[:-1])
    )


def _analyse_file(rel_path: str, content: str, max_chars: int) -> dict:
    """Parse a single Python file and return its structural metadata."""
    loc = _count_loc(content)
    truncated_content = content[:max_chars] if len(content) > max_chars else content

    try:
        tree = ast.parse(content, filename=rel_path)
    except SyntaxError as exc:
        logger.warning("[code_extractor] SyntaxError in %s: %s", rel_path, exc)
        return {
            "path": rel_path,
            "loc": loc,
            "functions": [],
            "classes": [],
            "imports": [],
            "has_error_handling": False,
            "content": truncated_content,
            "parse_error": str(exc),
        }

    functions = _extract_functions(tree)
    classes = _extract_classes(tree)
    imports = _extract_imports(tree)
    has_error_handling = _has_try_except(tree)

    return {
        "path": rel_path,
        "loc": loc,
        "functions": functions,
        "classes": classes,
        "imports": imports,
        "has_error_handling": has_error_handling,
        "content": truncated_content,
    }


def _count_loc(content: str) -> int:
    """Count non-blank, non-comment lines."""
    count = 0
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            count += 1
    return count


def _extract_functions(tree: ast.AST) -> list[dict]:
    """
    Extract all top-level and method-level function definitions.

    Returns list of:
        {
            "name":           str,
            "args":           [str],    # parameter names (excluding self/cls)
            "has_docstring":  bool,
            "has_type_hints": bool,
            "raises":         [str],    # exception names in raise statements
        }
    """
    functions = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        # Argument names (skip self / cls)
        args = [
            arg.arg for arg in node.args.args
            if arg.arg not in ("self", "cls")
        ]
        # Also include *args and **kwargs
        if node.args.vararg:
            args.append(f"*{node.args.vararg.arg}")
        if node.args.kwarg:
            args.append(f"**{node.args.kwarg.arg}")

        # Docstring
        has_docstring = (
            bool(node.body)
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
            and isinstance(node.body[0].value.value, str)
        )

        # Type hints: any argument annotations or return annotation
        has_type_hints = (
            any(arg.annotation is not None for arg in node.args.args)
            or node.returns is not None
        )

        # Raise statements within this function only (not nested functions)
        raises = _collect_raises(node)

        functions.append({
            "name": node.name,
            "args": args,
            "has_docstring": has_docstring,
            "has_type_hints": has_type_hints,
            "raises": raises,
        })

    return functions


def _collect_raises(func_node: ast.FunctionDef) -> list[str]:
    """Collect exception type names raised directly in this function."""
    raises: list[str] = []
    for node in ast.walk(func_node):
        # Don't descend into nested function definitions
        if node is not func_node and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if isinstance(node, ast.Raise) and node.exc is not None:
            exc_name = _exc_name(node.exc)
            if exc_name and exc_name not in raises:
                raises.append(exc_name)
    return raises


def _exc_name(node: ast.expr) -> str | None:
    """Extract a readable exception name from a raise node's exc field."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Call):
        return _exc_name(node.func)
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _extract_classes(tree: ast.AST) -> list[dict]:
    """
    Extract class definitions.

    Returns list of:
        {"name": str, "methods": [str]}
    """
    classes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        methods = [
            n.name for n in ast.walk(node)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
            and n is not node   # exclude nested classes' methods
        ]
        classes.append({"name": node.name, "methods": methods})
    return classes


def _extract_imports(tree: ast.AST) -> list[str]:
    """Return a flat list of imported module/name strings."""
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                imports.append(f"{module}.{alias.name}" if module else alias.name)
    return imports


def _has_try_except(tree: ast.AST) -> bool:
    """Return True if the file contains any try/except block."""
    for node in ast.walk(tree):
        if isinstance(node, (ast.Try,)):
            if node.handlers:   # at least one except clause
                return True
    return False


def _context_max_chars() -> int:
    try:
        return int(os.environ.get("LLM_CONTEXT_MAX_CHARS", "8000"))
    except ValueError:
        return 8000
