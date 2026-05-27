# WATT Protocol — Base Sepolia testnet runbook

## Architecture

```
meter-firmware (ESP32)  → Supabase.sensor_readings
watt-minter/energy-worker → watt-minter → legacy $WATT on Base Sepolia
meter-app (Flutter)     → Supabase RPCs + mining_events
server                  → waitlist + /api/producer/*
network-dashboard       → public :3001, ops :3002
```

## Contract (legacy MVP)

| Item | Value |
|------|--------|
| Network | Base Sepolia |
| Chain ID | `84532` |
| Token | `0xf07ce10cE718fEe22dFEe06B4048B734bC95b954` |
| Model | ~1B WATT pre-minted to deployer; **transfer** on verified kWh |
| Reward | 1 kWh = 1 WATT gross → **85%** producer, **15%** CIF (`CIF_SPLIT_MODE=gross`) |

## Start order

1. **Supabase** — Run SQL migrations in order:
   - `server/supabase/migrations/001` through `013_reconcile_confirmed_mints.sql`
   - WiFi: `meter-firmware/scripts/wifi_config.example.sql` (edit SSID/password in SQL Editor only)

2. **watt-minter** — clone [Watt-Protocol/watt-minter](https://github.com/Watt-Protocol/watt-minter), `cp .env.example .env`, then:
   ```bash
   npm install
   npm start
   ```
   Verify: `curl http://localhost:4001/health` → `chainId: 84532`

3. **energy-worker** — same repo, subfolder:
   ```bash
   cd energy-worker && cp .env.example .env
   npm install
   npm start
   ```
   Or from minter root: `npm run start:worker`

4. **meter-firmware** — `cp .env.example .env`, flash:
   ```bash
   pio run -t upload
   ```

5. **meter-app** — set wallet in Settings; login user id `2` / device `esp32_001`

6. **server** (optional) — `npm run dev` on port 3000

7. **network-dashboard** — copy `.env.example` to `.env`:
   ```bash
   npm install
   npm run start:public   # :3001
   npm run start:ops      # :3002 (Basic auth)
   ```

## Environment matrix

| Service | Key variables |
|---------|----------------|
| watt-minter | `RPC_URL`, `CONTRACT_ADDRESS`, `MINTER_PRIVATE_KEY`, `CIF_WALLET_ADDRESS`, `CIF_SPLIT_MODE=gross`, `INTERNAL_SECRET` |
| energy-worker | `SUPABASE_*`, `WATT_MINTER_URL`, `WATT_MINTER_SECRET`, `POLL_MS=15000` |
| server | `SUPABASE_*`, `WATT_MINTER_URL`, `WATT_MINTER_SECRET` (must match minter secret) |
| meter-app | `SUPABASE_*`, `APP_USER_ID=2`, `CHAIN_ID=84532` |
| meter-firmware | `SUPABASE_*`, `DEVICE_ID`, `SUPABASE_USER_ID=2` |

## Production hosting

| Service | URL |
|---------|-----|
| Website + API | https://wattprotocol.io (Vercel root: **server** repo) |
| watt-minter | https://watt-minter.onrender.com |

**Vercel:** set `WATT_MINTER_URL` and `WATT_MINTER_SECRET`.  
**Render:** run minter + energy-worker (two services or one host with both processes).

## Repositories

| Repo | Role |
|------|------|
| [server](https://github.com/Watt-Protocol/server) | This repo — API + migrations |
| [watt-minter](https://github.com/Watt-Protocol/watt-minter) | Payouts + energy-worker |
| [meter-app](https://github.com/Watt-Protocol/meter-app) | Flutter |
| [meter-firmware](https://github.com/Watt-Protocol/meter-firmware) | ESP32 |
| [contracts](https://github.com/Watt-Protocol/contracts) | Solidity |
| [network-dashboard](https://github.com/Watt-Protocol/network-dashboard) | Stats UI |

## Security

Never commit `.env` or WiFi passwords. See [SECURITY.md](../SECURITY.md).
