"""
app/models/governance.py
════════════════════════════════════════════════════════════════════════════════
SQLAlchemy ORM models (database representation) and Pydantic schemas
(API request / response representation) for the governance module.

Three ORM models mirror the three SQL tables from 001_governance.sql:
    GovernanceProposal      → governance_proposals
    GovernanceVote          → governance_votes
    WalletEligibilityCache  → wallet_eligibility_cache

Pydantic schemas are kept in the same file to make the full data contract
visible at a glance.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship

from pydantic import BaseModel, Field, field_validator

from app.db.database import Base


# ═══════════════════════════════════════════════════════════════════════════════
#  SQLAlchemy ORM models
# ═══════════════════════════════════════════════════════════════════════════════


class GovernanceProposal(Base):
    __tablename__ = "governance_proposals"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title           = Column(Text,       nullable=False)
    description     = Column(Text,       nullable=False)
    category        = Column(String(60), nullable=False, default="General")
    proposer_wallet = Column(String(42), nullable=False, index=True)
    status          = Column(String(20), nullable=False, default="active", index=True)
    votes_for       = Column(Integer,    nullable=False, default=0)
    votes_against   = Column(Integer,    nullable=False, default=0)
    quorum          = Column(Integer,    nullable=False, default=10)
    voting_ends_at  = Column(DateTime(timezone=True), nullable=False)
    created_at      = Column(DateTime(timezone=True), nullable=False, default=func.now())
    resolved_at     = Column(DateTime(timezone=True), nullable=True)

    votes: list[GovernanceVote] = relationship(
        "GovernanceVote", back_populates="proposal", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("status IN ('active', 'passed', 'rejected')", name="ck_proposal_status"),
        CheckConstraint("votes_for >= 0",     name="ck_votes_for_positive"),
        CheckConstraint("votes_against >= 0", name="ck_votes_against_positive"),
        CheckConstraint("quorum > 0",         name="ck_quorum_positive"),
    )


class GovernanceVote(Base):
    __tablename__ = "governance_votes"

    id           = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    proposal_id  = Column(String(36), ForeignKey("governance_proposals.id", ondelete="CASCADE"), nullable=False, index=True)
    voter_wallet = Column(String(42), nullable=False, index=True)
    vote         = Column(String(10), nullable=False)   # 'for' | 'against'
    voted_at     = Column(DateTime(timezone=True), nullable=False, default=func.now())
    signature    = Column(Text, nullable=True)

    proposal: GovernanceProposal = relationship("GovernanceProposal", back_populates="votes")

    __table_args__ = (
        UniqueConstraint("proposal_id", "voter_wallet", name="uq_one_vote_per_wallet"),
        CheckConstraint("vote IN ('for', 'against')", name="ck_vote_direction"),
    )


class WalletEligibilityCache(Base):
    __tablename__ = "wallet_eligibility_cache"

    wallet          = Column(String(42), primary_key=True)
    completed_txns  = Column(Integer,    nullable=False, default=0)
    is_eligible     = Column(Boolean,    nullable=False, default=False)
    last_checked_at = Column(DateTime(timezone=True), nullable=False, default=func.now())


# ═══════════════════════════════════════════════════════════════════════════════
#  Pydantic request schemas
# ═══════════════════════════════════════════════════════════════════════════════


class CreateProposalRequest(BaseModel):
    title:       str = Field(..., min_length=5,  max_length=120)
    description: str = Field(..., min_length=20, max_length=2000)
    category:    str = Field(default="General",  max_length=60)
    wallet:      str = Field(..., description="Checksummed ETH wallet address (0x…)")
    signature:   str = Field(..., description="EIP-191 personal_sign of the proposal title")
    timestamp:   int = Field(..., description="Unix timestamp included in the signed message")

    @field_validator("wallet")
    @classmethod
    def wallet_must_be_hex(cls, v: str) -> str:
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError("wallet must be a valid 42-char hex address starting with 0x")
        return v.lower()


class CastVoteRequest(BaseModel):
    wallet:    str = Field(..., description="Voter's ETH wallet address")
    vote:      str = Field(..., pattern="^(for|against)$")
    signature: str = Field(..., description="EIP-191 personal_sign of the vote message")
    timestamp: int = Field(..., description="Unix timestamp included in the signed message")

    @field_validator("wallet")
    @classmethod
    def wallet_must_be_hex(cls, v: str) -> str:
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError("wallet must be a valid 42-char hex address starting with 0x")
        return v.lower()


# ═══════════════════════════════════════════════════════════════════════════════
#  Pydantic response schemas
# ═══════════════════════════════════════════════════════════════════════════════


class ProposalResponse(BaseModel):
    id:              str
    title:           str
    description:     str
    category:        str
    proposer_wallet: str
    status:          str
    votes_for:       int
    votes_against:   int
    quorum:          int
    voting_ends_at:  datetime
    created_at:      datetime
    resolved_at:     Optional[datetime]

    # Derived helpers consumed by the frontend
    total_votes:       int
    for_percentage:    float
    time_remaining:    str      # human-readable e.g. "3 days left"
    has_met_quorum:    bool

    model_config = {"from_attributes": True}


class VoteResponse(BaseModel):
    id:           str
    proposal_id:  str
    voter_wallet: str
    vote:         str
    voted_at:     datetime

    model_config = {"from_attributes": True}


class EligibilityResponse(BaseModel):
    wallet:         str
    eligible:       bool
    completed_txns: int
    reason:         str
    cached:         bool


class StatsResponse(BaseModel):
    total_proposals:  int
    active:           int
    passed:           int
    rejected:         int
    total_votes_cast: int
    unique_voters:    int


class PaginatedProposalsResponse(BaseModel):
    proposals: list[ProposalResponse]
    total:     int
    page:      int
    limit:     int
    pages:     int


# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════


def proposal_to_response(p: GovernanceProposal) -> ProposalResponse:
    """Convert an ORM GovernanceProposal to a ProposalResponse."""
    total = (p.votes_for or 0) + (p.votes_against or 0)
    for_pct = round((p.votes_for / total * 100), 1) if total > 0 else 50.0

    now = datetime.now(timezone.utc)
    end = p.voting_ends_at
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)

    diff = end - now
    days = diff.days
    if days < 0:
        time_str = "Ended"
    elif days == 0:
        hours = diff.seconds // 3600
        time_str = f"{hours}h left" if hours > 0 else "Ends soon"
    else:
        time_str = f"{days} day{'s' if days != 1 else ''} left"

    return ProposalResponse(
        id              = str(p.id),
        title           = p.title,
        description     = p.description,
        category        = p.category,
        proposer_wallet = p.proposer_wallet,
        status          = p.status,
        votes_for       = p.votes_for or 0,
        votes_against   = p.votes_against or 0,
        quorum          = p.quorum or 10,
        voting_ends_at  = p.voting_ends_at,
        created_at      = p.created_at,
        resolved_at     = p.resolved_at,
        total_votes     = total,
        for_percentage  = for_pct,
        time_remaining  = time_str,
        has_met_quorum  = total >= (p.quorum or 10),
    )
