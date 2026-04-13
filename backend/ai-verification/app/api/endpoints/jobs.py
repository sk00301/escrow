"""
app/api/endpoints/jobs.py
──────────────────────────
GET /jobs — paginated admin list of all jobs.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.core.job_store import JobStore
from app.models.schemas import Job, JobStatus

router = APIRouter()


@router.get(
    "/jobs",
    response_model=list[Job],
    summary="List all verification jobs (admin)",
    tags=["Admin"],
)
async def list_jobs(
    request: Request,
    status: JobStatus | None = Query(
        default=None,
        description="Filter by job status",
    ),
    limit: int  = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0,  ge=0),
) -> list[Job]:
    """
    Return a paginated list of all jobs, most-recent first.

    Intended for the Admin / Governance panel in the React frontend.
    In production this endpoint should be protected by an API key.
    """
    store: JobStore = request.app.state.job_store
    return await store.list_all(
        status_filter=status,
        limit=limit,
        offset=offset,
    )
