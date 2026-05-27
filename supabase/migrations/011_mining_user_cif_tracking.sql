-- ═══════════════════════════════════════════════════════════════
--  WATT: per-leg mint tracking (user wallet vs CIF), net credited balance
--  Run in Supabase SQL Editor after 010_wifi_config_insert.sql
--  Safe if 006 was skipped: adds user_amount / cif_amount when missing.
-- ═══════════════════════════════════════════════════════════════

-- Columns from 006 that may be missing on older databases
ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS device_id TEXT;

UPDATE public.mining_events
SET device_id = 'esp32_001'
WHERE device_id IS NULL OR trim(device_id) = '';

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS user_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS cif_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS cif_tx_hash TEXT;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Gross WATT for the mint (1 kWh = 1 WATT before 85/15 split)
ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS watt_gross NUMERIC;

UPDATE public.mining_events
SET watt_gross = COALESCE(watt_gross, watt_earned, kwh)::numeric;

-- Estimate 85/15 split on old rows that never stored leg amounts
-- (cast to numeric — PostgreSQL ROUND does not accept double precision)
UPDATE public.mining_events
SET
  user_amount = ROUND(
    (COALESCE(watt_gross, watt_earned, kwh) * 0.85)::numeric,
    6
  ),
  cif_amount = ROUND(
    (COALESCE(watt_gross, watt_earned, kwh) * 0.15)::numeric,
    6
  )
WHERE COALESCE(user_amount, 0) = 0
  AND COALESCE(watt_gross, watt_earned, kwh) > 0;

-- Per-transfer leg status (matches one on-chain tx each)
ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS user_tx_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS cif_tx_status TEXT NOT NULL DEFAULT 'pending';

-- Backfill leg status from existing rows
UPDATE public.mining_events
SET user_tx_status = CASE
  WHEN LOWER(status) = 'failed' THEN 'failed'
  WHEN tx_hash IS NOT NULL AND LENGTH(trim(tx_hash)) > 0 THEN 'confirmed'
  WHEN LOWER(status) IN ('confirmed', 'completed', 'success') THEN 'confirmed'
  WHEN LOWER(status) = 'processing' THEN 'pending'
  ELSE 'pending'
END
WHERE user_tx_status = 'pending';

UPDATE public.mining_events
SET cif_tx_status = CASE
  WHEN LOWER(status) = 'failed' THEN 'failed'
  WHEN cif_tx_hash IS NOT NULL AND LENGTH(trim(cif_tx_hash)) > 0 THEN 'confirmed'
  WHEN COALESCE(cif_amount, 0) > 0 AND tx_hash IS NOT NULL THEN 'failed'
  WHEN COALESCE(cif_amount, 0) = 0 AND tx_hash IS NOT NULL THEN 'skipped'
  ELSE 'pending'
END
WHERE cif_tx_status = 'pending';

-- Net WATT credited to user wallet (85% legs only), not gross
UPDATE public.waitlist_users u
SET credited_watt = COALESCE((
  SELECT SUM(m.user_amount)
  FROM public.mining_events m
  WHERE m.user_id = u.id
    AND m.user_tx_status = 'confirmed'
    AND m.user_amount > 0
), 0);

COMMENT ON COLUMN public.mining_events.watt_gross IS
  'Gross WATT for mint (1 kWh = 1 WATT). user_amount + cif_amount ≈ watt_gross.';
COMMENT ON COLUMN public.mining_events.user_amount IS
  'WATT transferred to producer wallet (~85% of watt_gross).';
COMMENT ON COLUMN public.mining_events.cif_amount IS
  'WATT transferred to CIF wallet (~15% of watt_gross).';
COMMENT ON COLUMN public.mining_events.tx_hash IS
  'On-chain tx hash for user_amount transfer to producer wallet.';
COMMENT ON COLUMN public.mining_events.cif_tx_hash IS
  'On-chain tx hash for cif_amount transfer to CIF_WALLET_ADDRESS.';

-- ── Events list (user + CIF legs) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_mining_events(
  p_user_id BIGINT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  events_json JSON;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', m.id,
        'kwh', m.kwh,
        'watt_earned', m.watt_earned,
        'watt_gross', COALESCE(m.watt_gross, m.watt_earned),
        'user_amount', m.user_amount,
        'cif_amount', m.cif_amount,
        'status', m.status,
        'user_tx_status', m.user_tx_status,
        'cif_tx_status', m.cif_tx_status,
        'tx_hash', m.tx_hash,
        'cif_tx_hash', m.cif_tx_hash,
        'created_at', m.created_at
      )
      ORDER BY m.created_at DESC
    ),
    '[]'::json
  )
  INTO events_json
  FROM public.mining_events m
  WHERE m.user_id = p_user_id
    AND m.created_at >= p_from
    AND m.created_at <= p_to;

  RETURN json_build_object('success', true, 'events', events_json);
END;
$$;

-- ── Summary: user received vs CIF from this user's energy ───────────────────
CREATE OR REPLACE FUNCTION public.get_user_mining_summary(
  p_user_id BIGINT,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT
    COALESCE(SUM(kwh), 0) AS total_kwh,
    COALESCE(SUM(COALESCE(watt_gross, watt_earned)), 0) AS total_watt_gross,
    COALESCE(SUM(user_amount) FILTER (WHERE user_tx_status = 'confirmed'), 0)
      AS total_user_watt,
    COALESCE(SUM(cif_amount) FILTER (WHERE cif_tx_status = 'confirmed'), 0)
      AS total_cif_amount,
    COUNT(*) FILTER (WHERE user_tx_status = 'confirmed') AS count_confirmed,
    COUNT(*) FILTER (
      WHERE user_tx_status IN ('pending', 'processing')
        OR (LOWER(status) = 'processing' AND user_tx_status = 'pending')
    ) AS count_pending,
    COUNT(*) FILTER (WHERE user_tx_status = 'failed' OR LOWER(status) = 'failed')
      AS count_failed
  INTO s
  FROM public.mining_events
  WHERE user_id = p_user_id
    AND created_at >= p_from
    AND created_at <= p_to;

  RETURN json_build_object(
    'success', true,
    'total_kwh', s.total_kwh,
    'total_watt_gross', s.total_watt_gross,
    'total_watt_earned', s.total_user_watt,
    'total_user_watt', s.total_user_watt,
    'total_cif_amount', s.total_cif_amount,
    'count_confirmed', s.count_confirmed,
    'count_pending', s.count_pending,
    'count_failed', s.count_failed
  );
END;
$$;

-- Profile: net user balance + lifetime CIF from this user's mints
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
  v_cif_contributed NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT
    id,
    wallet_address,
    COALESCE(pending_watt, 0) AS pending_watt,
    COALESCE(credited_watt, 0) AS credited_watt,
    referral_code,
    referral_link
  INTO u
  FROM public.waitlist_users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(SUM(cif_amount), 0)
  INTO v_cif_contributed
  FROM public.mining_events
  WHERE user_id = p_user_id
    AND cif_tx_status = 'confirmed';

  RETURN json_build_object(
    'success', true,
    'id', u.id,
    'wallet_address', u.wallet_address,
    'pending_watt', u.pending_watt,
    'credited_watt', u.credited_watt,
    'lifetime_cif_contributed', v_cif_contributed,
    'referral_code', u.referral_code,
    'referral_link', u.referral_link
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_profile(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_profile(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_profile(BIGINT) TO authenticated;
