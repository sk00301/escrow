"""
app/db/database.py
══════════════════════════════════════════════════════════════════════
Async SQLAlchemy engine and session factory.

Usage
─────
    # Dependency injection in an endpoint:
    async def my_route(db: AsyncSession = Depends(get_db)):
        result = await db.execute(select(MyModel))

    # Direct call (e.g. from the scheduler):
    async with async_session() as db:
        result = await db.execute(select(MyModel))

Database URL
────────────
    Dev  (SQLite)     : sqlite+aiosqlite:///./governance.db
    Prod (PostgreSQL) : postgresql+asyncpg://user:pass@host:5432/dbname

Both are set via GOVERNANCE_DATABASE_URL (falls back to DATABASE_URL) in .env.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Engine ────────────────────────────────────────────────────────────────────
_db_url = settings.database_url

# SQLite needs check_same_thread disabled; PostgreSQL ignores it.
_connect_args: dict = {}
if _db_url.startswith("sqlite"):
    _connect_args = {"check_same_thread": False}

engine = create_async_engine(
    _db_url,
    echo=settings.app_env == "development",
    pool_pre_ping=True,          # detect stale connections
    connect_args=_connect_args,
)

async_session: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)

# ── Base class for ORM models ─────────────────────────────────────────────────


class Base(DeclarativeBase):
    pass


# ── FastAPI dependency ────────────────────────────────────────────────────────


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a session; roll back on error, always close."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Table creation helper (called from main.py lifespan) ─────────────────────


async def create_tables() -> None:
    """
    Create all tables defined in ORM models.
    Safe to call multiple times (CREATE TABLE IF NOT EXISTS under the hood).
    For PostgreSQL in production, prefer the raw SQL migration file instead.
    """
    # Import models here so Base.metadata knows about them before create_all
    from app.models.governance import GovernanceProposal, GovernanceVote, WalletEligibilityCache  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("db_tables_created | url=%s", _db_url.split("@")[-1])  # hide credentials
