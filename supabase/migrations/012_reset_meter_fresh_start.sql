-- ═══════════════════════════════════════════════════════════════
--  WATT: reset meter + minting data for a clean start
--  Run in Supabase SQL Editor when you want to clear old readings/mints.
-- ═══════════════════════════════════════════════════════════════

-- Optional: reset one user + device (typical dev setup)
-- SELECT reset_watt_meter_fresh_start(2, 'esp32_001');

-- Or reset ALL users/devices:
-- SELECT reset_watt_meter_fresh_start(NULL, NULL);

CREATE OR REPLACE FUNCTION public.reset_watt_meter_fresh_start(
  p_user_id BIGINT DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_readings_deleted BIGINT := 0;
  v_mining_deleted   BIGINT := 0;
  v_meters_reset     BIGINT := 0;
  v_users_reset      BIGINT := 0;
BEGIN
  -- Sensor readings
  IF p_device_id IS NOT NULL AND length(trim(p_device_id)) > 0 THEN
    DELETE FROM public.sensor_readings
    WHERE device_id = trim(p_device_id);
    GET DIAGNOSTICS v_readings_deleted = ROW_COUNT;
  ELSE
    DELETE FROM public.sensor_readings;
    GET DIAGNOSTICS v_readings_deleted = ROW_COUNT;
  END IF;

  -- Mining / mint audit log
  IF p_user_id IS NOT NULL THEN
    DELETE FROM public.mining_events
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_mining_deleted = ROW_COUNT;
  ELSE
    DELETE FROM public.mining_events;
    GET DIAGNOSTICS v_mining_deleted = ROW_COUNT;
  END IF;

  -- Energy worker cursor (start counting kWh from next reading)
  IF p_device_id IS NOT NULL AND length(trim(p_device_id)) > 0 THEN
    UPDATE public.meter_energy_state
    SET
      last_energy_kwh = 0,
      pending_kwh     = 0,
      last_reading_id = NULL,
      updated_at      = NOW()
    WHERE device_id = trim(p_device_id);
    GET DIAGNOSTICS v_meters_reset = ROW_COUNT;
  ELSE
    UPDATE public.meter_energy_state
    SET
      last_energy_kwh = 0,
      pending_kwh     = 0,
      last_reading_id = NULL,
      updated_at      = NOW();
    GET DIAGNOSTICS v_meters_reset = ROW_COUNT;
  END IF;

  -- User reward balances (net WATT + fractional kWh pending)
  IF p_user_id IS NOT NULL THEN
    UPDATE public.waitlist_users
    SET
      pending_watt     = 0,
      credited_watt    = 0,
      last_energy_kwh  = NULL
    WHERE id = p_user_id;
    GET DIAGNOSTICS v_users_reset = ROW_COUNT;
  ELSE
    UPDATE public.waitlist_users
    SET
      pending_watt     = 0,
      credited_watt    = 0,
      last_energy_kwh  = NULL;
    GET DIAGNOSTICS v_users_reset = ROW_COUNT;
  END IF;

  RETURN json_build_object(
    'success', true,
    'readings_deleted', v_readings_deleted,
    'mining_events_deleted', v_mining_deleted,
    'meter_energy_state_reset', v_meters_reset,
    'waitlist_users_reset', v_users_reset,
    'hint', 'Restart energy-worker after reset so payouts use a fresh baseline.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_watt_meter_fresh_start(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_watt_meter_fresh_start(BIGINT, TEXT) TO service_role;
-- Dev: allow anon if you run resets from SQL editor as postgres (already superuser)
