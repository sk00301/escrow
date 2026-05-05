-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 001 — Governance tables
-- Run against PostgreSQL 14+.
-- For SQLite (dev) the CREATE TABLE statements are compatible; the
-- GENERATED ALWAYS column falls back to a regular boolean (see note below).
-- ═══════════════════════════════════════════════════════════════════════════════

-- pgcrypto gives us gen_random_uuid() — already available in Postgres 13+ as a
-- built-in, but the extension is a safe no-op if already installed.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── governance_proposals ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_proposals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT        NOT NULL CHECK (char_length(title)       BETWEEN 5 AND 120),
    description     TEXT        NOT NULL CHECK (char_length(description) BETWEEN 20 AND 2000),
    category        VARCHAR(60) NOT NULL DEFAULT 'General',
    proposer_wallet VARCHAR(42) NOT NULL,   -- checksummed ETH address
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'passed', 'rejected')),
    votes_for       INT         NOT NULL DEFAULT 0 CHECK (votes_for     >= 0),
    votes_against   INT         NOT NULL DEFAULT 0 CHECK (votes_against >= 0),
    quorum          INT         NOT NULL DEFAULT 10 CHECK (quorum > 0),
    voting_ends_at  TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ             -- set by the background scheduler
);

CREATE INDEX IF NOT EXISTS idx_proposals_status         ON governance_proposals (status);
CREATE INDEX IF NOT EXISTS idx_proposals_proposer       ON governance_proposals (proposer_wallet);
CREATE INDEX IF NOT EXISTS idx_proposals_voting_ends_at ON governance_proposals (voting_ends_at)
    WHERE status = 'active';


-- ── governance_votes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS governance_votes (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id  UUID        NOT NULL REFERENCES governance_proposals (id) ON DELETE CASCADE,
    voter_wallet VARCHAR(42) NOT NULL,      -- lower-cased ETH address for consistency
    vote         VARCHAR(10) NOT NULL CHECK (vote IN ('for', 'against')),
    voted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    signature    TEXT,                      -- EIP-191 personal_sign signature (optional audit)

    -- The database is the ultimate enforcer of "1 vote per wallet per proposal"
    UNIQUE (proposal_id, voter_wallet)
);

CREATE INDEX IF NOT EXISTS idx_votes_voter   ON governance_votes (voter_wallet);
CREATE INDEX IF NOT EXISTS idx_votes_proposal ON governance_votes (proposal_id);


-- ── wallet_eligibility_cache ──────────────────────────────────────────────────
-- Caches on-chain milestone counts to avoid an RPC call on every API request.
-- TTL is enforced by the application layer (10 minutes).

CREATE TABLE IF NOT EXISTS wallet_eligibility_cache (
    wallet          VARCHAR(42) PRIMARY KEY,
    completed_txns  INT         NOT NULL DEFAULT 0,
    -- Postgres 12+: generated column. SQLite will treat this as a plain boolean.
    is_eligible     BOOLEAN     NOT NULL DEFAULT FALSE,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
