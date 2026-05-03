"""app/api/router.py"""

from fastapi import APIRouter

from app.api.endpoints import health, jobs, result, verify
from app.api.endpoints import llm_verify
from app.api.endpoints import text_verify
from app.api.endpoints import generate_tests
from app.api.endpoints import ipfs

api_router = APIRouter()

api_router.include_router(health.router,          tags=["System"])
api_router.include_router(verify.router,          tags=["Verification"])
api_router.include_router(llm_verify.router,      tags=["LLM Verification"])
api_router.include_router(text_verify.router,     tags=["Text Verification"])
api_router.include_router(generate_tests.router,  tags=["Test Generation"])
api_router.include_router(result.router,          tags=["Verification"])
api_router.include_router(jobs.router,            tags=["Admin"])
api_router.include_router(ipfs.router,            tags=["IPFS"])
