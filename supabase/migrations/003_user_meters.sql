-- ═══════════════════════════════════════════════════════════════
--  WATT meter-app: user_meters table + list/add RPCs
--  Run in Supabase SQL Editor after 002_user_profile_rpc.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_meters (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.waitlist_users (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  location    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_meters_user_device_key UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_user_meters_user_id ON public.user_meters (user_id);
CREATE INDEX IF NOT EXISTS idx_user_meters_device_id ON public.user_meters (device_id);

ALTER TABLE public.user_meters ENABLE ROW LEVEL SECURITY;

-- Seed default meter for waitlist user 2 (matches firmware DEVICE_ID)
INSERT INTO public.user_meters (user_id, label, device_id, location)
VALUES (2, 'Home', 'esp32_001', 'Kitchen')
ON CONFLICT (user_id, device_id) DO NOTHING;

-- List meters for a user with latest reading timestamp from sensor_readings
CREATE OR REPLACE FUNCTION public.get_user_meters(p_user_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO result
  FROM (
    SELECT
      um.id,
      um.user_id,
      um.label,
      um.device_id,
      um.location,
      um.created_at,
      lr.last_reading_at,
      CASE
        WHEN lr.last_reading_at IS NOT NULL
          AND lr.last_reading_at > (NOW() - INTERVAL '30 seconds')
        THEN TRUE
        ELSE FALSE
      END AS is_online
    FROM public.user_meters um
    LEFT JOIN LATERAL (
      SELECT sr.created_at AS last_reading_at
      FROM public.sensor_readings sr
      WHERE sr.device_id = um.device_id
        AND sr.user_id = um.user_id
      ORDER BY sr.created_at DESC
      LIMIT 1
    ) lr ON TRUE
    WHERE um.user_id = p_user_id
    ORDER BY um.created_at ASC
  ) t;

  RETURN json_build_object('success', true, 'meters', result);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_user_meter(
  p_user_id BIGINT,
  p_label TEXT,
  p_device_id TEXT,
  p_location TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.user_meters;
BEGIN
  IF p_user_id IS NULL OR p_label IS NULL OR trim(p_label) = ''
     OR p_device_id IS NULL OR trim(p_device_id) = '' THEN
    RETURN json_build_object('success', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO public.user_meters (user_id, label, device_id, location)
  VALUES (
    p_user_id,
    trim(p_label),
    trim(p_device_id),
    NULLIF(trim(COALESCE(p_location, '')), '')
  )
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    label = EXCLUDED.label,
    location = COALESCE(EXCLUDED.location, public.user_meters.location)
  RETURNING * INTO row;

  RETURN json_build_object(
    'success', true,
    'id', row.id,
    'label', row.label,
    'device_id', row.device_id,
    'location', row.location
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_meters(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_meters(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_meters(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.add_user_meter(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_user_meter(BIGINT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.add_user_meter(BIGINT, TEXT, TEXT, TEXT) TO authenticated;
