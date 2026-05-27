-- ═══════════════════════════════════════════════════════════════
--  WATT meter-app: mining_events history + summary RPCs
--  Run in Supabase SQL Editor after 003_user_meters.sql
-- ═══════════════════════════════════════════════════════════════

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
        'status', m.status,
        'tx_hash', m.tx_hash,
        'cif_tx_hash', m.cif_tx_hash,
        'cif_amount', m.cif_amount,
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
    COALESCE(SUM(watt_earned), 0) AS total_watt_earned,
    COALESCE(SUM(cif_amount), 0) AS total_cif_amount,
    COUNT(*) FILTER (
      WHERE LOWER(status) = 'pending' AND tx_hash IS NULL
    ) AS count_pending,
    COUNT(*) FILTER (
      WHERE tx_hash IS NOT NULL
        OR LOWER(status) IN ('confirmed', 'completed', 'success')
    ) AS count_confirmed
  INTO s
  FROM public.mining_events
  WHERE user_id = p_user_id
    AND created_at >= p_from
    AND created_at <= p_to;

  RETURN json_build_object(
    'success', true,
    'total_kwh', s.total_kwh,
    'total_watt_earned', s.total_watt_earned,
    'total_cif_amount', s.total_cif_amount,
    'count_pending', s.count_pending,
    'count_confirmed', s.count_confirmed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_mining_events(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_mining_summary(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
