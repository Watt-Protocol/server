-- ═══════════════════════════════════════════════════════════════
--  WATT MVP: energy ledger, mining_events, wifi_config
--  Run in Supabase SQL Editor after 005_user_profile_referral.sql
--
--  Safe if mining_events already exists (older DB without device_id):
--  patches columns before creating indexes.
-- ═══════════════════════════════════════════════════════════════

-- waitlist_users: wallet + off-chain reward accounting
ALTER TABLE public.waitlist_users
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

ALTER TABLE public.waitlist_users
  ADD COLUMN IF NOT EXISTS pending_watt NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.waitlist_users
  ADD COLUMN IF NOT EXISTS credited_watt NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.waitlist_users
  ADD COLUMN IF NOT EXISTS last_energy_kwh NUMERIC;

-- Per-device energy cursor for the energy worker
CREATE TABLE IF NOT EXISTS public.meter_energy_state (
  device_id         TEXT PRIMARY KEY,
  user_id           BIGINT REFERENCES public.waitlist_users (id) ON DELETE SET NULL,
  last_energy_kwh   NUMERIC NOT NULL DEFAULT 0,
  pending_kwh       NUMERIC NOT NULL DEFAULT 0,
  last_reading_id   BIGINT,
  paused            BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meter_energy_state_user_id
  ON public.meter_energy_state (user_id);

-- Mint / transfer audit log (app + energy-worker)
CREATE TABLE IF NOT EXISTS public.mining_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES public.waitlist_users (id) ON DELETE CASCADE,
  device_id     TEXT,
  kwh           NUMERIC,
  watt_earned   NUMERIC,
  user_amount   NUMERIC NOT NULL DEFAULT 0,
  cif_amount    NUMERIC NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  tx_hash       TEXT,
  cif_tx_hash   TEXT,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Patch legacy mining_events (table existed before device_id was added)
ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS device_id TEXT;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS kwh NUMERIC;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS watt_earned NUMERIC;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS user_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS cif_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS tx_hash TEXT;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS cif_tx_hash TEXT;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE public.mining_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.mining_events
SET device_id = 'esp32_001'
WHERE device_id IS NULL OR trim(device_id) = '';

UPDATE public.mining_events
SET kwh = COALESCE(kwh, watt_earned, 0)
WHERE kwh IS NULL;

UPDATE public.mining_events
SET watt_earned = COALESCE(watt_earned, kwh, 0)
WHERE watt_earned IS NULL;

CREATE INDEX IF NOT EXISTS idx_mining_events_user_created
  ON public.mining_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mining_events_device_created
  ON public.mining_events (device_id, created_at DESC);

-- Link meter to waitlist user for energy-worker (change user_id if not 2)
INSERT INTO public.meter_energy_state (device_id, user_id, last_energy_kwh, pending_kwh)
VALUES ('esp32_001', 2, 0, 0)
ON CONFLICT (device_id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  updated_at = NOW();

-- WiFi credentials for ESP32 (latest id wins in firmware)
CREATE TABLE IF NOT EXISTS public.wifi_config (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ssid     TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.wifi_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_wifi_config ON public.wifi_config;
CREATE POLICY anon_select_wifi_config
  ON public.wifi_config FOR SELECT
  TO anon
  USING (true);

-- RPC: update wallet for waitlist user (meter-app settings)
CREATE OR REPLACE FUNCTION public.update_user_wallet(
  p_user_id BIGINT,
  p_wallet_address TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invalid_user');
  END IF;

  IF p_wallet_address IS NULL OR trim(p_wallet_address) = '' THEN
    UPDATE public.waitlist_users
    SET wallet_address = NULL
    WHERE id = p_user_id;
  ELSE
    UPDATE public.waitlist_users
    SET wallet_address = lower(trim(p_wallet_address))
    WHERE id = p_user_id;
  END IF;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_user_wallet(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_wallet(BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_user_wallet(BIGINT, TEXT) TO authenticated;
