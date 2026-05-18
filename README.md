# CoinFlow Explorer — Avian Network

A self-hosted web tool for tracing and visualising coin movement on the [Avian (AVN)](https://avn.network) blockchain. Connect it to your own Avian Core full node and explore transaction graphs, wallet clusters, and exchange/pool activity.

## Features

- **Address lookup** — browse all outputs for an address (paginated unspent + recent spent)
- **Forward tracing** — follow where coins went from a UTXO, depth-first
- **Backward tracing** — find where coins came from, walking inputs up the chain
- **Interactive graph** — ReactFlow-powered DAG with pan, zoom, minimap, and PNG/PDF export
- **Wallet clustering** — groups addresses by common-input and address-reuse heuristics
- **Known entities** — labels exchange, mining pool, and service addresses from a local JSON file
- **Dark / light theme** — follows system preference

## Requirements

- Node.js 20+ and [pnpm](https://pnpm.io)
- An Avian Core full node with the following flags enabled:

```
txindex=1
addressindex=1
spentindex=1
timestampindex=1
```

## Setup

```bash
git clone https://github.com/AvianNetwork/avian-coinflow
cd avian-coinflow
pnpm install
```

Create `.env.local` in the project root:

```env
AVIAN_RPC_URL=http://127.0.0.1:7896
AVIAN_RPC_USER=your_rpc_username
AVIAN_RPC_PASS=your_rpc_password
```

These credentials must match the `rpcuser` / `rpcpassword` in your `avian.conf`.

## Development

```bash
pnpm dev
```

The app is available at `http://localhost:3000`.

## Production build

```bash
pnpm build
pnpm start          # listens on port 3000 by default
PORT=8080 pnpm start  # custom port
```

## Exchange / pool address list

Known addresses are read from `public/data/exchange-addresses.json` at startup. The file format is:

```json
{
  "version": 1,
  "lastUpdated": "2025-01-01",
  "exchanges": {
    "XeggeX": { "name": "XeggeX", "confidence": 0.95, "addresses": ["R..."] }
  },
  "mining_pools": {
    "Blockminerz": { "name": "Blockminerz", "confidence": 0.9, "addresses": ["R..."] }
  },
  "services": {}
}
```

## Systemd service

See [`avian-coinflow.service`](avian-coinflow.service) for a ready-to-use unit file.

## Tech stack

| Layer | Library |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS, shadcn/ui |
| Graph | ReactFlow + Dagre layout |
| Export | html-to-image + jsPDF |
| Theming | next-themes |
| RPC | Avian Core JSON-RPC (proxied via `/api/rpc`) |
