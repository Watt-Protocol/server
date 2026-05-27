-- ═══════════════════════════════════════════════════════════════
--  WATT meter-app: extend get_user_profile with referral fields
--  Run in Supabase SQL Editor after 004_mining_events_rpc.sql
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
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

  RETURN json_build_object(
    'success', true,
    'id', u.id,
    'wallet_address', u.wallet_address,
    'pending_watt', u.pending_watt,
    'credited_watt', u.credited_watt,
    'referral_code', u.referral_code,
    'referral_link', u.referral_link
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_profile(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_profile(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_profile(BIGINT) TO authenticated;
