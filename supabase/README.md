# Supabase schema

Canonical PostgreSQL migrations for WATT Protocol. Apply in numeric order via Supabase SQL Editor.

**Repository:** [Watt-Protocol/server](https://github.com/Watt-Protocol/server) · **Path:** `supabase/migrations/`

## Consumers

| Repository | Usage |
|------------|--------|
| [meter-firmware](https://github.com/Watt-Protocol/meter-firmware) | Inserts `sensor_readings` |
| [watt-minter](https://github.com/Watt-Protocol/watt-minter) (`energy-worker/`) | Payouts, `mining_events` |
| [meter-app](https://github.com/Watt-Protocol/meter-app) | Dashboard RPCs |
| [network-dashboard](https://github.com/Watt-Protocol/network-dashboard) | Aggregated stats |

See [docs/SUPABASE.md](../docs/SUPABASE.md).
