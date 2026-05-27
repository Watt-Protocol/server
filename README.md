# WATT Protocol — Server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Public website, waitlist/producer API, and **canonical Supabase migrations** (`supabase/migrations/`).

## Quick start

```bash
cp .env.example .env
npm install
npm run dev    # http://localhost:3000
```

## Documentation

- [Testnet runbook](docs/TESTNET.md)
- [Operations](docs/OPERATIONS.md)
- [Supabase](docs/SUPABASE.md)

## Related repositories

| Repo | Role |
|------|------|
| [watt-minter](https://github.com/Watt-Protocol/watt-minter) | Payouts + energy-worker |
| [meter-app](https://github.com/Watt-Protocol/meter-app) | Flutter dashboard |
| [meter-firmware](https://github.com/Watt-Protocol/meter-firmware) | ESP32 telemetry |
| [contracts](https://github.com/Watt-Protocol/contracts) | Solidity on Base |
| [network-dashboard](https://github.com/Watt-Protocol/network-dashboard) | Network stats UI |

## Deploy

Vercel: set repository root to this project. Include `WATT_MINTER_URL` and `WATT_MINTER_SECRET` in environment variables.
