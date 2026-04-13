"""
main.py
═══════════════════════════════════════════════════════════════════════════════
AI Verification Service — FastAPI application entry point.

Responsibilities
────────────────
  • App initialisation with CORS, lifespan, error middleware
  • Mount shared state (job store, rate limiter, start time) on app.state
  • Include the central API router
  • Register global exception handlers for consistent error responses

Run in development
──────────────────
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

Interactive docs
────────────────
    Swagger UI  →  http://localhost:8000/docs
    ReDoc       →  http://localhost:8000/redoc
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.core.job_store import JobStore
from app.core.rate_limiter import RateLimiter

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Everything before `yield` runs at startup.
    Everything after `yield` runs at shutdown.
    Attach shared singletons to app.state here so every endpoint can
    access them via  request.app.state.<name>  without importing globals.
    """
    logger.info(
        "service_starting | env=%s  approval_threshold=%.2f",
        settings.app_env,
        settings.approval_threshold,
    )

    app.state.start_time   = time.monotonic()
    app.state.job_store    = JobStore()
    app.state.rate_limiter = RateLimiter(
        max_calls=settings.rate_limit_max_per_minute,
        window_seconds=60,
    )

    yield   # ← application runs here

    logger.info("service_stopping")


# ── Application factory ───────────────────────────────────────────────────────

app = FastAPI(
    title="AI Verification Service",
    description=(
        "Automated milestone verification for the hybrid blockchain escrow platform. "
        "Evaluates code submissions via pytest, pylint, and flake8, then returns a "
        "normalised score (0.0–1.0) and APPROVED / DISPUTED / REJECTED verdict."
    ),
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,   # ["http://localhost:3000", ...]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

app.include_router(api_router)


# ══════════════════════════════════════════════════════════════════════════════
#  Error handlers
#  All errors are returned as:
#  { "error": "human message", "code": "SNAKE_CASE_CODE", "job_id": null|str }
# ══════════════════════════════════════════════════════════════════════════════

@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    FastAPI raises RequestValidationError when a Pydantic model rejects the
    incoming request body.  We convert it to our standard error envelope so
    the React frontend always gets the same shape.
    """
    # Flatten pydantic error list into a readable string
    errors = []
    for err in exc.errors():
        loc   = " → ".join(str(x) for x in err["loc"] if x != "body")
        msg   = err["msg"]
        errors.append(f"{loc}: {msg}" if loc else msg)

    # exc.errors() can contain non-serialisable objects (e.g. ValueError in ctx).
    safe_errors = [{k: str(v) for k, v in e.items()} for e in exc.errors()]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error":  "; ".join(errors),
            "code":   "VALIDATION_ERROR",
            "job_id": None,
            "detail": safe_errors,
        },
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={
            "error":  f"Route not found: {request.method} {request.url.path}",
            "code":   "NOT_FOUND",
            "job_id": None,
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_exception path=%s", request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error":  "An unexpected internal error occurred.",
            "code":   "INTERNAL_ERROR",
            "job_id": None,
            "detail": str(exc),
        },
    )
