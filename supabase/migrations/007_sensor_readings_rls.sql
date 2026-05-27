-- ═══════════════════════════════════════════════════════════════
--  sensor_readings: allow ESP32 (anon) INSERT and app (anon) SELECT
--  Run after 006_mvp_energy_mining.sql if reads/inserts return empty or fail
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_select_sensor_readings ON public.sensor_readings;
CREATE POLICY anon_select_sensor_readings
  ON public.sensor_readings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS anon_insert_sensor_readings ON public.sensor_readings;
CREATE POLICY anon_insert_sensor_readings
  ON public.sensor_readings FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
