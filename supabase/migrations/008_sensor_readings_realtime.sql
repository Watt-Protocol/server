-- Enable Supabase Realtime for sensor_readings (app append-only sync)
-- Dashboard → Database → Replication → ensure sensor_readings is enabled if this fails

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sensor_readings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication missing — enable Realtime for sensor_readings in the dashboard';
END;
$$;
