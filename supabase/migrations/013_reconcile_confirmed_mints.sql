-- Backfill mining_events that minted on-chain but still show pending in the app.
-- Run after 011. Safe to re-run.

UPDATE public.mining_events
SET
  status = 'confirmed',
  user_tx_status = 'confirmed',
  watt_gross = COALESCE(watt_gross, watt_earned, kwh),
  user_amount = CASE
    WHEN COALESCE(user_amount, 0) > 0 THEN user_amount
    ELSE ROUND((COALESCE(watt_gross, watt_earned, kwh) * 0.85)::numeric, 6)
  END,
  cif_amount = CASE
    WHEN COALESCE(cif_amount, 0) > 0 THEN cif_amount
    ELSE ROUND((COALESCE(watt_gross, watt_earned, kwh) * 0.15)::numeric, 6)
  END,
  cif_tx_status = CASE
    WHEN cif_tx_hash IS NOT NULL AND length(trim(cif_tx_hash)) > 0 THEN 'confirmed'
    WHEN COALESCE(cif_amount, 0) > 0 THEN COALESCE(cif_tx_status, 'failed')
    ELSE 'skipped'
  END
WHERE tx_hash IS NOT NULL
  AND length(trim(tx_hash)) > 0
  AND (
    user_tx_status IS DISTINCT FROM 'confirmed'
    OR lower(status) IN ('pending', 'processing', 'credited')
  );

UPDATE public.mining_events
SET
  user_tx_status = 'confirmed',
  watt_gross = COALESCE(watt_gross, watt_earned, kwh),
  user_amount = CASE
    WHEN COALESCE(user_amount, 0) > 0 THEN user_amount
    ELSE ROUND((COALESCE(watt_gross, watt_earned, kwh) * 0.85)::numeric, 6)
  END,
  cif_amount = CASE
    WHEN COALESCE(cif_amount, 0) > 0 THEN cif_amount
    ELSE ROUND((COALESCE(watt_gross, watt_earned, kwh) * 0.15)::numeric, 6)
  END
WHERE lower(status) IN ('confirmed', 'completed', 'success', 'credited')
  AND user_tx_status IS DISTINCT FROM 'confirmed';

UPDATE public.waitlist_users u
SET credited_watt = COALESCE((
  SELECT SUM(m.user_amount)
  FROM public.mining_events m
  WHERE m.user_id = u.id
    AND m.user_tx_status = 'confirmed'
    AND m.user_amount > 0
), 0);
