# CoinFlow Explorer — Radiant Blockchain

A self-hosted web tool for tracing and visualising coin movement on the [Radiant (RXD)](https://radiantblockchain.org) blockchain. Connect it to an ElectrumX server or your own Radiant full node and explore transaction graphs, wallet clusters, and exchange/pool activity.

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
- One of three chain data backends:
  - **RXinDexer REST** (recommended) — the node's REST API; paginated history with
    no size ceiling, so busy exchange/pool wallets still trace and cluster
  - **ElectrumX** — any Radiant ElectrumX server; fast, but refuses very large
    address histories
  - **Native RPC** — a radiantd build carrying the address/spent index patches, with
    `txindex=1`, `addressindex=1`, `spentindex=1` enabled

## Setup

```bash
pnpm install
```

Create `.env.local` in the project root (see `.env.local.example`).

For correct Open Graph / social share URLs in production, set the public site URL:

```env
NEXT_PUBLIC_SITE_URL=https://your-domain.example
```

For the RXinDexer REST backend:

```env
RADIANT_BACKEND=rest
RADIANT_REST_URL=http://127.0.0.1:8000
```

For the ElectrumX backend:

```env
RADIANT_BACKEND=electrumx
RADIANT_ELECTRUM_HOST=127.0.0.1
RADIANT_ELECTRUM_PORT=50010
RADIANT_ELECTRUM_TLS=false
```

For the native RPC backend (radiantd with index patches):

```env
RADIANT_BACKEND=rpc
RADIANT_RPC_URL=http://127.0.0.1:7332
RADIANT_RPC_USER=your_rpc_username
RADIANT_RPC_PASS=your_rpc_password
```

RPC credentials must match the `rpcuser` / `rpcpassword` in your `radiant.conf`.
All three backends serve identical response shapes, so switching between them is
purely a configuration change.

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
  "lastUpdated": "2026-01-01",
  "exchanges": {
    "CoinEx": { "name": "CoinEx", "confidence": 0.95, "addresses": ["1..."] }
  },
  "mining_pools": {
    "ExamplePool": { "name": "ExamplePool", "confidence": 0.9, "addresses": ["1..."] }
  },
  "services": {}
}
```

### Populating the pool list automatically

`pnpm scan-pools` scans recent coinbase transactions via your ElectrumX server,
decodes the pool tags miners embed in coinbase scripts, and rewrites the
`mining_pools` section (manually added pools are preserved). Curated
address → pool identities live in `scripts/pool-names.json` and take
precedence over decoded tags.

```bash
pnpm scan-pools                    # last 20000 blocks
pnpm scan-pools -- --blocks 50000  # deeper history
pnpm scan-pools -- --dry-run       # preview without writing
```

### Identifying exchange wallets

Given one verified withdrawal transaction (exchange → user), the sending
addresses on its inputs are the exchange's hot wallet. `expand-cluster.mjs`
seeds from that transaction and grows the operator's address set via the
common-input heuristic:

```bash
node scripts/expand-cluster.mjs --from-tx <withdrawal-txid> --merge <ExchangeName>
node scripts/expand-cluster.mjs 1SomeSeedAddress --hops 4 --max-addrs 500
```

`--merge NAME` unions the result into `exchanges[NAME]` at 0.95 confidence.
Run each exchange separately so clusters never bleed together.

## Systemd service

See [`radiant-coinflow.service`](radiant-coinflow.service) for a ready-to-use unit file.

## Tech stack

| Layer | Library |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS, shadcn/ui |
| Graph | ReactFlow + Dagre layout |
| Export | html-to-image + jsPDF |
| Theming | next-themes |
| Chain data | RXinDexer REST, ElectrumX, or Radiant Core JSON-RPC (proxied via `/api/rpc`) |
