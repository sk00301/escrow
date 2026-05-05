"""
backend/governance/main.py
══════════════════════════════════════════════════════════════════════
Governance microservice — off-chain voting with on-chain wallet identity.

Responsibilities
────────────────
  • Proposal CRUD
  • Vote casting (1 per wallet per proposal, eligibility gated)
  • Wallet eligibility check (reads Sepolia RPC, caches result 10 min)
  • Background scheduler — resolves expired proposals every 5 minutes

Nothing here touches AI, job queues, or the verification pipeline.
Start alongside ai-verification on a separate port:

    uvicorn main:app --port 8001 --reload

Frontend env var:
    NEXT_PUBLIC_GOVERNANCE_URL=http://localhost:8001
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.db.database import create_tables, async_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger   = logging.getLogger(__name__)
settings = get_settings()


# ── Background scheduler ──────────────────────────────────────────────────────

async def _scheduler_loop() -> None:
    from app.api.endpoints.governance import resolve_expired_proposals
    while True:
        await asyncio.sleep(300)   # every 5 minutes
        try:
            async with async_session() as db:
                n = await resolve_expired_proposals(db)
                if n:
                    logger.info("scheduler | resolved %d proposal(s)", n)
        except Exception as exc:
            logger.warning("scheduler_error | %s", exc)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("governance_service_starting | env=%s port=%d", settings.app_env, settings.port)
    await create_tables()
    task = asyncio.create_task(_scheduler_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("governance_service_stopped")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Aegistra Governance",
    description = "Off-chain voting with on-chain wallet identity",
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["http://localhost:3000"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

from app.api.endpoints.governance import router
app.include_router(router)
