"""
app/api/endpoints/generate_tests.py

POST /generate-tests

Accepts an SRS document + project directory path, runs the SRSTestGenAgent,
and returns the generated pytest test code.

The test file is also written directly to the project directory so it can
immediately be used with POST /llm-verify.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, Request, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class GenerateTestsResponse(BaseModel):
    test_file: str = Field(description="Absolute path to the generated test file")
    tests_generated: int = Field(description="Number of test functions written")
    import_name: str = Field(description="Module name the tests import from")
    test_code: str = Field(description="Full content of the generated test file")
    warnings: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Endpoint — JSON body (SRS as text)
# ---------------------------------------------------------------------------

@router.post(
    "/generate-tests",
    response_model=GenerateTestsResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate pytest tests from an SRS document",
    description=(
        "Reads the SRS at srs_path, scans the project at project_dir, "
        "and writes a complete pytest test file. "
        "Also accepts image paths for vision-capable models (qwen3.5 etc)."
    ),
)
async def generate_tests(
    request: Request,
    project_dir: str = Form(
        ...,
        description="Absolute path to the project directory containing source files",
        example="/home/sk/escrow-platform/backend/ai-verification/tests/fixtures/sample_submissions/project_1",
    ),
    srs_path: str = Form(
        ...,
        description="Absolute path to the SRS document (.md, .txt, .png, .jpg)",
        example="/home/sk/projects/my_project/srs.md",
    ),
    output_filename: str = Form(
        default="test_submission.py",
        description="Name for the generated test file",
    ),
    srs_image_paths: str = Form(
        default="",
        description=(
            "Comma-separated paths to additional SRS images (diagrams, screenshots). "
            "Used with vision models like qwen3.5."
        ),
    ),
) -> GenerateTestsResponse:

    # ── Rate limiting ─────────────────────────────────────────────────
    rate_limiter = request.app.state.rate_limiter
    client_ip = request.client.host if request.client else "unknown"
    allowed = await rate_limiter.is_allowed(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit exceeded", "code": "RATE_LIMIT_EXCEEDED"},
        )

    # ── Validate paths ────────────────────────────────────────────────
    project_path = Path(project_dir)
    srs_file_path = Path(srs_path)

    if not project_path.exists():
        return JSONResponse(
            status_code=400,
            content={
                "error": f"project_dir not found: {project_dir}",
                "code": "PROJECT_NOT_FOUND",
            },
        )
    if not srs_file_path.exists():
        return JSONResponse(
            status_code=400,
            content={
                "error": f"srs_path not found: {srs_path}",
                "code": "SRS_NOT_FOUND",
            },
        )

    # Parse extra image paths
    extra_images: list[Path] = []
    if srs_image_paths.strip():
        for p in srs_image_paths.split(","):
            p = p.strip()
            if p:
                img_path = Path(p)
                if img_path.exists():
                    extra_images.append(img_path)
                else:
                    logger.warning("[generate_tests] image not found: %s", p)

    # ── Run agent ─────────────────────────────────────────────────────
    llm_provider = request.app.state.llm_provider
    config = _get_settings()

    from app.services.agents.test_gen_agent import SRSTestGenAgent

    agent = SRSTestGenAgent(llm=llm_provider, config=config)

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: asyncio.run(
                agent.generate(
                    project_dir=project_path,
                    srs_path=srs_file_path,
                    output_filename=output_filename,
                    srs_images=extra_images if extra_images else None,
                )
            ),
        )
    except Exception as exc:
        logger.exception("[generate_tests] agent failed")
        return JSONResponse(
            status_code=500,
            content={
                "error": str(exc),
                "code": "GENERATION_FAILED",
            },
        )

    return GenerateTestsResponse(
        test_file=result["test_file"],
        tests_generated=result["tests_generated"],
        import_name=result["import_name"],
        test_code=result["test_code"],
        warnings=result["warnings"],
        acceptance_criteria=result["requirements"].get("acceptance_criteria", []),
    )


def _get_settings():
    from app.core.config import get_settings
    return get_settings()
