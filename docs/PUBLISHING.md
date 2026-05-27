# Publishing the six repositories

Each folder under the local `WattProtocol/` workspace is an independent git repository.

| Local folder | GitHub remote |
|--------------|---------------|
| `server/` | `git@github.com:Watt-Protocol/server.git` |
| `watt-minter/` | `git@github.com:Watt-Protocol/watt-minter.git` |
| `meter-app/` | `git@github.com:Watt-Protocol/meter-app.git` |
| `meter-firmware/` | `git@github.com:Watt-Protocol/meter-firmware.git` |
| `contracts/` | `git@github.com:Watt-Protocol/contracts.git` |
| `network-dashboard/` | `git@github.com:Watt-Protocol/network-dashboard.git` |

## Push each repo

```bash
cd server   # repeat for each folder
git init -b main
git add -A
git commit -m "Open-source release."
git remote add origin git@github.com:Watt-Protocol/server.git
git push -u origin main
```

## Hosting

| Service | Repository | Root directory |
|---------|------------|----------------|
| Vercel (website) | server | `/` |
| Render (minter) | watt-minter | `/` |
| Render (worker) | watt-minter | `energy-worker/` or `npm run start:worker` |

## Legacy monorepo

If `Watt-Protocol/watt-protocol` exists, archive it and point README to the six repos above.
