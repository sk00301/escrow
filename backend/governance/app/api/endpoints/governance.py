"""
app/api/endpoints/governance.py
════════════════════════════════════════════════════════════════════════════════
Governance module — off-chain voting with on-chain wallet identity.

Routes (all under /api/governance)
────────────────────────────────────
    GET  /proposals                — list proposals (paginated, filterable)
    GET  /proposals/{id}           — single proposal detail
    POST /proposals                — create a proposal
    POST /proposals/{id}/vote      — cast a vote
    GET  /proposals/{id}/votes     — all votes on a proposal (audit trail)
    GET  /eligibility/{wallet}     — check vote/propose eligibility
    GET  /wallet/{wallet}/votes    — all votes cast by a wallet
    GET  /stats                    — platform governance stats

Auth strategy
─────────────
No JWT. The frontend asks MetaMask to sign a short message containing the
action + relevant ID + a unix timestamp. The backend recovers the signer
address from the ECDSA signature (via eth_account) and compares to the
submitted wallet address. If they match, the request is authentic.

Signature message formats
─────────────────────────
    Create proposal : "Aegistra governance: create proposal '{title}' at {ts}"
    Cast vote       : "Aegistra governance: vote {for|against} on {proposal_id} at {ts}"

Eligibility
───────────
A wallet must have at least 1 completed milestone on the EscrowContract
(state == 7 released OR state == 6 resolved) where it is either the client
or the freelancer. Results are cached in wallet_eligibility_cache for
ELIGIBILITY_CACHE_TTL_SECONDS (default 600 = 10 min).
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update, distinct
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings, Settings
from app.db.database import get_db
from app.models.governance import (
    CastVoteRequest,
    CreateProposalRequest,
    EligibilityResponse,
    GovernanceProposal,
    GovernanceVote,
    PaginatedProposalsResponse,
    ProposalResponse,
    StatsResponse,
    VoteResponse,
    WalletEligibilityCache,
    proposal_to_response,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/governance", tags=["Governance"])

# ── Constants ─────────────────────────────────────────────────────────────────

ELIGIBILITY_CACHE_TTL_SECONDS = 600     # 10 minutes
SIGNATURE_MAX_AGE_SECONDS     = 300     # 5 minutes — replay-attack window


# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════


def _verify_signature(wallet: str, message_text: str, signature: str) -> None:
    """
    Recover the signer from an EIP-191 personal_sign signature and compare
    it to the supplied wallet address.  Raises HTTP 401 on mismatch.
    """
    try:
        msg        = encode_defunct(text=message_text)
        recovered  = Account.recover_message(msg, signature=signature)
        if recovered.lower() != wallet.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": "Signature does not match wallet address.", "code": "SIGNATURE_MISMATCH"},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("signature_verification_error | %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Could not verify signature.", "code": "INVALID_SIGNATURE"},
        ) from exc


def _check_timestamp_freshness(timestamp: int) -> None:
    """Reject requests where the signed timestamp is older than SIGNATURE_MAX_AGE_SECONDS."""
    now = int(datetime.now(timezone.utc).timestamp())
    if abs(now - timestamp) > SIGNATURE_MAX_AGE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "Signed timestamp is too old or too far in the future.", "code": "STALE_TIMESTAMP"},
        )


async def _fetch_eligibility_from_chain(wallet: str, settings: Settings) -> int:
    """
    Call the Sepolia RPC to count completed milestones for *wallet*.
    Returns the count of milestones where wallet is client or freelancer
    and the state is released (7) or resolved (6).

    Falls back to 0 on any RPC error rather than crashing the request.
    """
    rpc_url          = settings.alchemy_rpc_url
    escrow_address   = settings.escrow_contract_address

    if not rpc_url or not escrow_address:
        logger.warning("eligibility_rpc_skip | ALCHEMY_RPC_URL or ESCROW_CONTRACT_ADDRESS not set")
        return 0

    try:
        from web3 import Web3
        from web3.middleware import ExtraDataToPOAMiddleware

        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 10}))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        # Minimal ABI — only the functions we call
        abi = [
            {"inputs": [],                              "name": "milestoneCount",     "outputs": [{"type": "uint256"}], "type": "function", "stateMutability": "view"},
            {"inputs": [{"name": "milestoneId", "type": "uint256"}], "name": "getMilestone", "outputs": [{"components": [
                {"name": "client",      "type": "address"},
                {"name": "freelancer",  "type": "address"},
                {"name": "milestoneHash","type": "bytes32"},
                {"name": "amount",      "type": "uint256"},
                {"name": "deadline",    "type": "uint256"},
                {"name": "state",       "type": "uint8"},
                {"name": "evidenceHash","type": "bytes32"},
                {"name": "ipfsCID",     "type": "string"},
                {"name": "score",       "type": "uint256"},
                {"name": "verdict",     "type": "string"},
                {"name": "createdAt",   "type": "uint256"},
                {"name": "fundedAt",    "type": "uint256"},
                {"name": "submittedAt", "type": "uint256"},
                {"name": "resolvedAt",  "type": "uint256"},
            ], "type": "tuple"}], "type": "function", "stateMutability": "view"},
        ]

        contract   = w3.eth.contract(address=Web3.to_checksum_address(escrow_address), abi=abi)
        total      = contract.functions.milestoneCount().call()
        wallet_lc  = wallet.lower()
        completed  = 0

        # Run blocking web3 calls in the thread pool to stay async-friendly
        loop = asyncio.get_event_loop()

        def _scan() -> int:
            count = 0
            for mid in range(total):
                try:
                    m = contract.functions.getMilestone(mid).call()
                    # m is a tuple; state is index 5
                    client_addr     = m[0].lower()
                    freelancer_addr = m[1].lower()
                    state           = m[5]   # 6 = resolved, 7 = released
                    if (client_addr == wallet_lc or freelancer_addr == wallet_lc) and state in (6, 7):
                        count += 1
                except Exception:
                    pass   # skip unreadable milestones
            return count

        completed = await loop.run_in_executor(None, _scan)
        logger.info("eligibility_chain_check | wallet=%s completed=%d total_milestones=%d", wallet[:8], completed, total)
        return completed

    except Exception as exc:
        logger.warning("eligibility_rpc_error | wallet=%s error=%s", wallet[:8], exc)
        return 0


async def _get_or_refresh_eligibility(
    wallet: str, db: AsyncSession, settings: Settings, force_refresh: bool = False
) -> WalletEligibilityCache:
    """
    Return a WalletEligibilityCache row, refreshing from chain if stale (> 10 min).
    """
    now     = datetime.now(timezone.utc)
    wallet  = wallet.lower()

    row = await db.get(WalletEligibilityCache, wallet)

    if row is not None and not force_refresh:
        last = row.last_checked_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        age = (now - last).total_seconds()
        if age < ELIGIBILITY_CACHE_TTL_SECONDS:
            return row   # cache hit — return immediately

    # Cache miss or stale — fetch from chain
    completed = await _fetch_eligibility_from_chain(wallet, settings)
    eligible  = completed >= 1

    if row is None:
        row = WalletEligibilityCache(
            wallet          = wallet,
            completed_txns  = completed,
            is_eligible     = eligible,
            last_checked_at = now,
        )
        db.add(row)
    else:
        row.completed_txns  = completed
        row.is_eligible     = eligible
        row.last_checked_at = now
        db.add(row)

    await db.flush()
    return row


# ═══════════════════════════════════════════════════════════════════════════════
#  Background scheduler — resolves expired proposals
#  Called by main.py lifespan background task every 5 minutes.
# ═══════════════════════════════════════════════════════════════════════════════


async def resolve_expired_proposals(db: AsyncSession) -> int:
    """
    Close all active proposals whose voting period has ended.
    Returns the number of proposals resolved.

    Resolution logic
    ────────────────
      passed   ← total_votes >= quorum  AND  votes_for > votes_against
      rejected ← otherwise
    """
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(GovernanceProposal).where(
            GovernanceProposal.status == "active",
            GovernanceProposal.voting_ends_at < now,
        )
    )
    expired = result.scalars().all()

    resolved_count = 0
    for proposal in expired:
        total = (proposal.votes_for or 0) + (proposal.votes_against or 0)
        met_quorum = total >= (proposal.quorum or 10)
        majority   = (proposal.votes_for or 0) > (proposal.votes_against or 0)

        proposal.status      = "passed" if (met_quorum and majority) else "rejected"
        proposal.resolved_at = now
        db.add(proposal)
        resolved_count += 1
        logger.info(
            "proposal_resolved | id=%s status=%s votes=%d/%d quorum=%d",
            str(proposal.id)[:8], proposal.status, proposal.votes_for, proposal.votes_against, proposal.quorum,
        )

    if resolved_count:
        await db.commit()
        logger.info("scheduler_resolved_proposals | count=%d", resolved_count)

    return resolved_count


# ═══════════════════════════════════════════════════════════════════════════════
#  Routes
# ═══════════════════════════════════════════════════════════════════════════════


# ── GET /api/governance/stats ──────────────────────────────────────────────────

@router.get("/stats", response_model=StatsResponse, summary="Platform governance statistics")
async def get_stats(db: AsyncSession = Depends(get_db)) -> StatsResponse:
    counts_q = await db.execute(
        select(GovernanceProposal.status, func.count().label("n"))
        .group_by(GovernanceProposal.status)
    )
    counts   = {row.status: row.n for row in counts_q}

    total_votes_q  = await db.execute(select(func.count()).select_from(GovernanceVote))
    total_votes    = total_votes_q.scalar_one_or_none() or 0

    unique_voters_q = await db.execute(
        select(func.count(distinct(GovernanceVote.voter_wallet)))
    )
    unique_voters   = unique_voters_q.scalar_one_or_none() or 0

    return StatsResponse(
        total_proposals  = sum(counts.values()),
        active           = counts.get("active",   0),
        passed           = counts.get("passed",   0),
        rejected         = counts.get("rejected", 0),
        total_votes_cast = total_votes,
        unique_voters    = unique_voters,
    )


# ── GET /api/governance/proposals ─────────────────────────────────────────────

@router.get("/proposals", response_model=PaginatedProposalsResponse, summary="List proposals")
async def list_proposals(
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(active|passed|rejected)$"),
    page:          int           = Query(1,    ge=1),
    limit:         int           = Query(20,   ge=1, le=100),
    db:            AsyncSession  = Depends(get_db),
) -> PaginatedProposalsResponse:
    query = select(GovernanceProposal)
    if status_filter:
        query = query.where(GovernanceProposal.status == status_filter)
    query = query.order_by(GovernanceProposal.created_at.desc())

    # Total count
    count_q = select(func.count()).select_from(query.subquery())
    total   = (await db.execute(count_q)).scalar_one_or_none() or 0

    # Page
    rows = (await db.execute(query.offset((page - 1) * limit).limit(limit))).scalars().all()

    return PaginatedProposalsResponse(
        proposals = [proposal_to_response(p) for p in rows],
        total     = total,
        page      = page,
        limit     = limit,
        pages     = max(1, math.ceil(total / limit)),
    )


# ── GET /api/governance/proposals/{proposal_id} ────────────────────────────────

@router.get("/proposals/{proposal_id}", response_model=ProposalResponse, summary="Get a single proposal")
async def get_proposal(proposal_id: str, db: AsyncSession = Depends(get_db)) -> ProposalResponse:
    proposal = await db.get(GovernanceProposal, proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail={"error": "Proposal not found.", "code": "NOT_FOUND"})
    return proposal_to_response(proposal)


# ── POST /api/governance/proposals ────────────────────────────────────────────

@router.post(
    "/proposals",
    response_model=ProposalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a governance proposal",
)
async def create_proposal(
    body:     CreateProposalRequest,
    db:       AsyncSession = Depends(get_db),
    settings: Settings     = Depends(get_settings),
) -> ProposalResponse:
    # 1. Timestamp freshness — prevents replay attacks
    _check_timestamp_freshness(body.timestamp)

    # 2. Signature verification
    msg = f"Aegistra governance: create proposal '{body.title}' at {body.timestamp}"
    _verify_signature(body.wallet, msg, body.signature)

    # 3. Eligibility
    cache = await _get_or_refresh_eligibility(body.wallet, db, settings)
    if not cache.is_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "You must complete at least one transaction on Aegistra before creating a proposal.",
                "code":  "NOT_ELIGIBLE",
                "completed_txns": cache.completed_txns,
            },
        )

    # 4. Max active proposals per wallet
    active_count_q = await db.execute(
        select(func.count()).where(
            GovernanceProposal.proposer_wallet == body.wallet.lower(),
            GovernanceProposal.status == "active",
        )
    )
    active_count = active_count_q.scalar_one_or_none() or 0
    max_active   = settings.governance_max_active_proposals

    if active_count >= max_active:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": f"You already have {active_count} active proposal(s). Maximum is {max_active}.",
                "code":  "TOO_MANY_ACTIVE_PROPOSALS",
            },
        )

    # 5. Create
    voting_days = settings.governance_voting_days
    proposal = GovernanceProposal(
        title           = body.title,
        description     = body.description,
        category        = body.category or "General",
        proposer_wallet = body.wallet.lower(),
        status          = "active",
        quorum          = settings.governance_quorum,
        voting_ends_at  = datetime.now(timezone.utc) + timedelta(days=voting_days),
    )
    db.add(proposal)
    await db.flush()   # assigns the id without committing

    logger.info("proposal_created | id=%s wallet=%s title='%s'", str(proposal.id)[:8], body.wallet[:8], body.title[:30])
    return proposal_to_response(proposal)


# ── POST /api/governance/proposals/{proposal_id}/vote ─────────────────────────

@router.post(
    "/proposals/{proposal_id}/vote",
    response_model=VoteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Cast a vote on a proposal",
)
async def cast_vote(
    proposal_id: str,
    body:        CastVoteRequest,
    db:          AsyncSession = Depends(get_db),
    settings:    Settings     = Depends(get_settings),
) -> VoteResponse:
    # 1. Timestamp freshness
    _check_timestamp_freshness(body.timestamp)

    # 2. Signature verification
    msg = f"Aegistra governance: vote {body.vote} on {proposal_id} at {body.timestamp}"
    _verify_signature(body.wallet, msg, body.signature)

    # 3. Load proposal
    proposal = await db.get(GovernanceProposal, proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail={"error": "Proposal not found.", "code": "NOT_FOUND"})

    # 4. Proposal must be active and within voting window
    if proposal.status != "active":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "This proposal is no longer active.", "code": "PROPOSAL_CLOSED"},
        )
    now = datetime.now(timezone.utc)
    ends = proposal.voting_ends_at
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    if now > ends:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "The voting period for this proposal has ended.", "code": "VOTING_ENDED"},
        )

    # 5. Proposer cannot vote on their own proposal
    if body.wallet.lower() == proposal.proposer_wallet.lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "You cannot vote on your own proposal.", "code": "SELF_VOTE_FORBIDDEN"},
        )

    # 6. Eligibility
    cache = await _get_or_refresh_eligibility(body.wallet, db, settings)
    if not cache.is_eligible:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "You must complete at least one transaction on Aegistra before voting.",
                "code":  "NOT_ELIGIBLE",
                "completed_txns": cache.completed_txns,
            },
        )

    # 7. Insert vote + atomically increment counter
    vote_row = GovernanceVote(
        proposal_id  = proposal_id,
        voter_wallet = body.wallet.lower(),
        vote         = body.vote,
        voted_at     = now,
        signature    = body.signature,
    )
    db.add(vote_row)

    if body.vote == "for":
        proposal.votes_for = (proposal.votes_for or 0) + 1
    else:
        proposal.votes_against = (proposal.votes_against or 0) + 1
    db.add(proposal)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "You have already voted on this proposal.", "code": "ALREADY_VOTED"},
        )

    logger.info(
        "vote_cast | proposal=%s wallet=%s vote=%s",
        proposal_id[:8], body.wallet[:8], body.vote,
    )

    return VoteResponse(
        id           = str(vote_row.id),
        proposal_id  = proposal_id,
        voter_wallet = vote_row.voter_wallet,
        vote         = vote_row.vote,
        voted_at     = vote_row.voted_at,
    )


# ── GET /api/governance/proposals/{proposal_id}/votes ─────────────────────────

@router.get(
    "/proposals/{proposal_id}/votes",
    response_model=list[VoteResponse],
    summary="List all votes on a proposal (public audit trail)",
)
async def list_proposal_votes(
    proposal_id: str,
    db:          AsyncSession = Depends(get_db),
) -> list[VoteResponse]:
    proposal = await db.get(GovernanceProposal, proposal_id)
    if not proposal:
        raise HTTPException(status_code=404, detail={"error": "Proposal not found.", "code": "NOT_FOUND"})

    result = await db.execute(
        select(GovernanceVote)
        .where(GovernanceVote.proposal_id == proposal_id)
        .order_by(GovernanceVote.voted_at.asc())
    )
    votes = result.scalars().all()

    return [
        VoteResponse(
            id           = str(v.id),
            proposal_id  = v.proposal_id,
            voter_wallet = v.voter_wallet,
            vote         = v.vote,
            voted_at     = v.voted_at,
        )
        for v in votes
    ]


# ── GET /api/governance/eligibility/{wallet} ───────────────────────────────────

@router.get(
    "/eligibility/{wallet}",
    response_model=EligibilityResponse,
    summary="Check if a wallet is eligible to vote or propose",
)
async def check_eligibility(
    wallet:   str,
    refresh:  bool        = Query(False, description="Force a live RPC refresh (bypasses cache)"),
    db:       AsyncSession = Depends(get_db),
    settings: Settings    = Depends(get_settings),
) -> EligibilityResponse:
    if not wallet.startswith("0x") or len(wallet) != 42:
        raise HTTPException(status_code=400, detail={"error": "Invalid wallet address.", "code": "INVALID_WALLET"})

    # Check if we already have a fresh cache entry
    existing = await db.get(WalletEligibilityCache, wallet.lower())
    was_cached = False
    if existing and not refresh:
        last = existing.last_checked_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - last).total_seconds()
        if age < ELIGIBILITY_CACHE_TTL_SECONDS:
            was_cached = True

    cache = await _get_or_refresh_eligibility(wallet, db, settings, force_refresh=refresh)

    reason = (
        "Eligible: at least one completed transaction found."
        if cache.is_eligible
        else f"Not eligible: {cache.completed_txns} completed transaction(s) found. You need at least 1."
    )

    return EligibilityResponse(
        wallet         = wallet.lower(),
        eligible       = cache.is_eligible,
        completed_txns = cache.completed_txns,
        reason         = reason,
        cached         = was_cached,
    )


# ── GET /api/governance/wallet/{wallet}/votes ──────────────────────────────────

@router.get(
    "/wallet/{wallet}/votes",
    response_model=list[VoteResponse],
    summary="All votes cast by a specific wallet",
)
async def get_wallet_votes(
    wallet: str,
    db:     AsyncSession = Depends(get_db),
) -> list[VoteResponse]:
    result = await db.execute(
        select(GovernanceVote)
        .where(GovernanceVote.voter_wallet == wallet.lower())
        .order_by(GovernanceVote.voted_at.desc())
    )
    votes = result.scalars().all()

    return [
        VoteResponse(
            id           = str(v.id),
            proposal_id  = v.proposal_id,
            voter_wallet = v.voter_wallet,
            vote         = v.vote,
            voted_at     = v.voted_at,
        )
        for v in votes
    ]
