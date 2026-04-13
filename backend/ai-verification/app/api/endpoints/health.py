"""
app/api/endpoints/health.py
────────────────────────────
GET /health — liveness probe + runtime statistics.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.core.config import get_settings
from app.models.schemas import HealthResponse

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
    tags=["System"],
)
async def health_check(request: Request) -> HealthResponse:
    """
    Lightweight liveness probe.

    Returns uptime, version, and live job counters.
    Called by Docker / Kubernetes health checks — always fast,
    no external dependencies touched.
    """
    settings     = get_settings()
    start_time   = request.app.state.start_time
    job_store    = request.app.state.job_store

    return HealthResponse(
        status="healthy",
        version=settings.app_version,
        uptime_seconds=round(time.monotonic() - start_time, 2),
        jobs_processed=job_store.jobs_processed,
        jobs_pending=job_store.jobs_pending,
    )
