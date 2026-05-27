-- ═══════════════════════════════════════════════════════════════
--  $WATT PROTOCOL — Database Migrations
--  Run these in the Supabase SQL Editor (one at a time if needed)
-- ═══════════════════════════════════════════════════════════════

-- 0. Base table (new projects). Skipped if the table already exists; incremental
--    ALTERs below still add any missing columns on older databases.
CREATE TABLE IF NOT EXISTS waitlist_users (
  id                      BIGSERIAL PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE,
  password_hash           TEXT,
  referral_code           TEXT NOT NULL UNIQUE,
  referral_link           TEXT NOT NULL,
  referred_by             TEXT,
  founding_member         BOOLEAN NOT NULL DEFAULT FALSE,
  referrals_count         INTEGER NOT NULL DEFAULT 0,
  signed_up_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_verified          BOOLEAN DEFAULT FALSE,
  verification_token      TEXT,
  verification_expires_at TIMESTAMPTZ,
  reset_token             TEXT,
  reset_token_expires_at  TIMESTAMPTZ,
  unsubscribed            BOOLEAN DEFAULT FALSE,
  country_code            TEXT,
  country_name            TEXT,
  signup_lat              DOUBLE PRECISION,
  signup_lng              DOUBLE PRECISION,
  status                  TEXT
);

-- 0b. Key/value settings (founding_member_threshold, founding_member_multiplier, roadmap JSON, etc.)
CREATE TABLE IF NOT EXISTS watt_config (
  key         TEXT PRIMARY KEY,
  value       TEXT        NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1. Add unsubscribed flag to waitlist_users
--    (safe to run multiple times — uses IF NOT EXISTS equivalent)
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN DEFAULT FALSE;

-- 2. Add email_verified flag for email verification flow
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- 3. Add verification_token for email verification
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS verification_token TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS reset_token TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- Referral leaderboard, waitlist position, admin “today” stats (server.js)
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS referrals_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Optional admin-editable field (PATCH /api/admin/users/:id)
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS status TEXT;

-- Core signup fields (older DBs may predate consolidated CREATE)
ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS referral_link TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS referred_by TEXT;

ALTER TABLE waitlist_users
  ADD COLUMN IF NOT EXISTS founding_member BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Add page_views table for built-in analytics
CREATE TABLE IF NOT EXISTS page_views (
  id         BIGSERIAL PRIMARY KEY,
  page       TEXT        NOT NULL,
  views      BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(page)
);

-- Grant service role access (if using RLS)
-- ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- 5. RPC function for atomic page view increment
CREATE OR REPLACE FUNCTION increment_page_view(p_page TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO page_views (page, views, updated_at)
  VALUES (p_page, 1, NOW())
  ON CONFLICT (page)
  DO UPDATE SET views = page_views.views + 1, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 6. Geographic data for heatmap (captured from IP at signup)
ALTER TABLE waitlist_users ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE waitlist_users ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE waitlist_users ADD COLUMN IF NOT EXISTS signup_lat   DOUBLE PRECISION;
ALTER TABLE waitlist_users ADD COLUMN IF NOT EXISTS signup_lng   DOUBLE PRECISION;

-- Index for fast aggregation by country
CREATE INDEX IF NOT EXISTS idx_waitlist_country ON waitlist_users(country_code);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id           BIGSERIAL PRIMARY KEY,
  role         TEXT        NOT NULL,
  user_id      BIGINT      NULL,
  admin_email  TEXT        NULL,
  token_hash   TEXT        NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  admin_email TEXT        NOT NULL,
  action      TEXT        NOT NULL,
  target_type TEXT        NULL,
  target_id   TEXT        NULL,
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ip_address  TEXT        NULL,
  user_agent  TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at DESC);

-- 7. Backfill existing users as verified (they signed up before verification was added)
--    IMPORTANT: Run this AFTER deploying the new server code, so existing users
--    can still access their dashboards.
UPDATE waitlist_users
  SET email_verified = TRUE
  WHERE (email_verified IS NULL OR email_verified = FALSE)
    AND verification_token IS NULL;
