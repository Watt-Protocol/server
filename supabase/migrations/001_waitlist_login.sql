-- ═══════════════════════════════════════════════════════════════
--  WATT meter-app: waitlist login (no users table)
--  Run in Supabase SQL Editor (Dashboard → SQL → New query)
--
--  Dev login: waitlist_users.id = 2, password 123456 (hardcoded in RPC)
-- ═══════════════════════════════════════════════════════════════

-- If you previously ran 001_users_table.sql, clean up first:
-- DROP FUNCTION IF EXISTS public.login_app_user(TEXT, TEXT);
-- DROP TABLE IF EXISTS public.users;

CREATE OR REPLACE FUNCTION public.login_waitlist_user(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' OR p_password IS NULL OR p_password = '' THEN
    RETURN json_build_object('success', false, 'error', 'invalid_credentials');
  END IF;

  IF p_password <> '123456' THEN
    RETURN json_build_object('success', false, 'error', 'invalid_credentials');
  END IF;

  SELECT id, email INTO u
  FROM public.waitlist_users
  WHERE id = 2
    AND lower(email) = lower(trim(p_email))
    AND COALESCE(email_verified, FALSE) = TRUE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'invalid_credentials');
  END IF;

  RETURN json_build_object(
    'success', true,
    'id', u.id,
    'email', u.email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.login_waitlist_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.login_waitlist_user(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.login_waitlist_user(TEXT, TEXT) TO authenticated;

-- If login fails for id=2, ensure email is verified:
-- UPDATE public.waitlist_users SET email_verified = TRUE WHERE id = 2;
