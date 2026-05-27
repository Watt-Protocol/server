-- Allow the producer app to save a new Wi‑Fi network for the meter (latest row wins).

DROP POLICY IF EXISTS anon_insert_wifi_config ON public.wifi_config;
CREATE POLICY anon_insert_wifi_config
  ON public.wifi_config FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
