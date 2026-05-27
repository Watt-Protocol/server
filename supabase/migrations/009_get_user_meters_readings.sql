-- Match app online threshold (60s) and count latest reading by device_id only.
-- Firmware rows with NULL/wrong user_id still show last_seen on My Meters.

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
          AND lr.last_reading_at > (NOW() - INTERVAL '60 seconds')
        THEN TRUE
        ELSE FALSE
      END AS is_online
    FROM public.user_meters um
    LEFT JOIN LATERAL (
      SELECT sr.created_at AS last_reading_at
      FROM public.sensor_readings sr
      WHERE sr.device_id = um.device_id
      ORDER BY sr.created_at DESC
      LIMIT 1
    ) lr ON TRUE
    WHERE um.user_id = p_user_id
    ORDER BY um.created_at ASC
  ) t;

  RETURN json_build_object('success', true, 'meters', result);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_meters(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_meters(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_meters(BIGINT) TO authenticated;
