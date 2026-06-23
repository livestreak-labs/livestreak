# LiveStreak

Live video prediction markets, settled on-chain. Any live stream — football, esports, debates —
becomes a surface for real-time binary options: CV agents watch the stream, generate prediction
options, and stake their own capital; viewers stream USDC onto YES/NO sides via floating
"Niko-Niko" cards over the video. The loss-to-ownership token is **$LVST**.

**Chains:** Sui (Move, sponsored transactions) and EVM (Foundry, ERC-4337 Safe).  
**Storage:** **Walrus** — stream VOD, market stream metadata, and steward durable memory (via host).

## Deployments

### Sui testnet

Live on Sui testnet. Canonical addresses: [`packages/contracts/chains/sui/deployments/testnet.json`](packages/contracts/chains/sui/deployments/testnet.json)

| | |
| --- | --- |
| **RPC** | `https://fullnode.testnet.sui.io:443` |
| **Package** | [`0x405f99…49200e`](https://suiscan.xyz/testnet/object/0x405f99daf3690baf6211783e1492c86c4c600ed1d0a0e6aadcd7b992d149200e) |

Redeploy: `cd packages/contracts && npm run deploy:sui -- --name testnet`

### EVM

| Environment | Snapshot |
| --- | --- |
| **Localhost** | [`packages/contracts/chains/evm/deployments/localhost.json`](packages/contracts/chains/evm/deployments/localhost.json) |
| **Public testnet** | Not deployed |

Contract details and imports: [`packages/contracts/README.md`](packages/contracts/README.md)

## Run locally

**Prereqs:** Node 22+, Sui CLI (optional). Foundry for the EVM leg.

```shell
./dev.sh              # Sui localnet + anvil + deploy + host + app (default)
WITH_SUI=0 ./dev.sh   # EVM only
```

| Service | URL |
| --- | --- |
| App | `http://localhost:3000` |
| Host | `http://127.0.0.1:8787` |
| Sui localnet | `http://127.0.0.1:9000` |
| EVM (Anvil) | `http://127.0.0.1:8545` |

**Remote console** (operator controls packages from the browser; seed stays in the CLI):

```shell
cd cli && npm run build
node dist/main.js settings init
LIVESTREAK_PASSWORD='<password>' node dist/main.js remote open \
  --scopes 'bridge:action:*,bridge:board:read' --ttl 30m
```

Open the printed URL, enter the pairing password. Tabs: **Observe · Options · Bookmaker · Steward**.

## Repository layout

| Path | What it is |
| --- | --- |
| `app/` | React SPA — discovery, stream viewer, position console, remote bridge console |
| `host/` | Server edge: sessions, **Walrus** content + memory store, stream catalog, AA bundler/paymaster proxy, remote WSS relay |
| `cli/` | Operator gateway — `settings`, `auth`, `keystore`, `remote` (board-first package console) |
| `packages/observe` | Video pipeline (capture → process → publish), run lifecycle, control bus; registers markets with **Walrus**-backed stream pointers on go-live |
| `packages/options` | Consumer SDK — read markets/vaults/positions, runtime, fund/claim writes |
| `packages/bookmaker` | Vault origination under a market: detect → draft → similarity → create/join |
| `packages/steward` | Accountability workflow: facts → rules → decisions → action plans; durable recall via host **Walrus** memory |
| `packages/contracts` | Sui Move + Solidity (Foundry) + typed deployment snapshots |
| `packages/schema` | Shared wire types — descriptors, remote protocol, settings, wallet init |
| `packages/wallet` | ERC-4337 Safe wallet SDK |
| `packages/host` | Shared host/Walrus descriptor types (imported by app + host server) |

## Build & test

```shell
npm install && npm run build && npm run test
```

Sui contracts: `cd packages/contracts/chains/sui && sui move test --build-env testnet`  
EVM contracts: `cd packages/contracts/chains/evm && forge test`
