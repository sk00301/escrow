"""
app/services/agents/tools/git_tool.py

Thin wrapper around CodeVerifier._ingest_submission() that handles all
submission types (GitHub URL, local path, zip file) and returns a clean
(work_dir, sha256_hash) tuple.

Raises SubmissionIngestionError with a human-readable message so the agent
can surface the problem without leaking internal stack traces.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class SubmissionIngestionError(Exception):
    """Raised when a submission cannot be ingested for any reason."""


def ingest_submission(submission: str) -> tuple[Path, str]:
    """
    Ingest a submission from any supported source and return the working
    directory path and its SHA-256 content hash.

    Supported submission types (auto-detected by CodeVerifier):
        - GitHub URL:   "https://github.com/user/repo"
        - Local path:   "/abs/path/to/project"  or  "./relative/path"
        - Zip file:     "/path/to/submission.zip"

    Args:
        submission: The submission identifier string.

    Returns:
        (work_dir, sha256_hash) where work_dir is a Path to the extracted
        source code and sha256_hash is a hex string of the content hash.

    Raises:
        SubmissionIngestionError: With a clear human-readable message if
            ingestion fails for any reason.
    """
    from app.services.code_verifier import CodeVerifier

    verifier = CodeVerifier()

    logger.debug("[git_tool] ingesting submission: %s", submission)

    try:
        work_dir, submission_hash = verifier._ingest_submission(submission)
    except FileNotFoundError as exc:
        raise SubmissionIngestionError(
            f"Submission path not found: '{submission}'. "
            "Check that the path exists and is accessible."
        ) from exc
    except PermissionError as exc:
        raise SubmissionIngestionError(
            f"Permission denied accessing submission: '{submission}'."
        ) from exc
    except ValueError as exc:
        raise SubmissionIngestionError(
            f"Invalid submission format: {exc}. "
            "Expected a GitHub URL, local directory path, or .zip file path."
        ) from exc
    except Exception as exc:
        # Catch-all: wrap any unexpected error with context
        raise SubmissionIngestionError(
            f"Failed to ingest submission '{submission}': {type(exc).__name__}: {exc}"
        ) from exc

    if not isinstance(work_dir, Path):
        work_dir = Path(work_dir)

    if not work_dir.exists():
        raise SubmissionIngestionError(
            f"Ingestion returned a non-existent work directory: '{work_dir}'. "
            "The submission may have failed to extract."
        )

    logger.info(
        "[git_tool] ingested '%s' -> work_dir=%s  hash=%s",
        submission, work_dir, submission_hash[:12] + "...",
    )
    return work_dir, str(submission_hash)
