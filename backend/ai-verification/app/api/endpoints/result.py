"""
app/api/endpoints/result.py
────────────────────────────
GET /result/{job_id} — poll for the result of a verification job.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.core.job_store import JobStore
from app.models.schemas import Job, JobStatus

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/result/{job_id}",
    response_model=Job,
    summary="Get verification job result",
    responses={
        200: {"description": "Job record (check `status` field)"},
        404: {"description": "No job with that ID exists"},
    },
)
async def get_result(job_id: str, request: Request) -> Job:
    """
    Return the full job record for `job_id`.

    **Polling pattern (JavaScript):**
    ```javascript
    const poll = async (jobId) => {
      while (true) {
        const res  = await fetch(`/result/${jobId}`);
        const job  = await res.json();
        if (job.status === "COMPLETED" || job.status === "FAILED") return job;
        await new Promise(r => setTimeout(r, 3000));   // wait 3 s
      }
    };
    ```

    **Status transitions:**

    | Status      | Meaning                                             |
    |-------------|-----------------------------------------------------|
    | `PENDING`   | Job queued, worker not yet started                  |
    | `RUNNING`   | Pipeline is actively evaluating the submission      |
    | `COMPLETED` | Done — check `verdict` and `score`                  |
    | `FAILED`    | Unrecoverable error — check `error_code` / `error_message` |

    **Verdict values (only meaningful when `status == COMPLETED`):**

    | Verdict    | Score range  | On-chain action          |
    |------------|--------------|--------------------------|
    | `APPROVED` | ≥ threshold  | Oracle releases payment  |
    | `DISPUTED` | ambiguity band | Jury vote triggered    |
    | `REJECTED` | < ambiguity low | Submission rejected   |
    """
    store: JobStore = request.app.state.job_store
    job = await store.get(job_id)

    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": f"No verification job found with id '{job_id}'",
                "code": "JOB_NOT_FOUND",
                "job_id": job_id,
            },
        )

    return job
