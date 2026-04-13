"""
app/api/router.py
──────────────────
Central APIRouter that imports and mounts every endpoint module.
main.py includes this single router — adding new endpoints means
editing only this file and creating the endpoint module.
"""

from fastapi import APIRouter

from app.api.endpoints import health, jobs, result, verify

api_router = APIRouter()

api_router.include_router(health.router,  tags=["System"])
api_router.include_router(verify.router,  tags=["Verification"])
api_router.include_router(result.router,  tags=["Verification"])
api_router.include_router(jobs.router,    tags=["Admin"])
