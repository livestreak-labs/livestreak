# FlowStream Contracts — Setup Status

## What was set up

- **6 Solidity contracts** in `src/`: Vault, FlowToken, ProtocolLP, Steward, AgentRegistry, ObserverRegistry
- **17 passing tests** in `test/FlowStream.t.sol` (plus MockUSDC in `test/mocks/`)
- **Deploy script** in `script/Deploy.s.sol` — deploys all contracts in dependency order and wires them together
- **TypeScript deployment tooling** in `deploy/` — matches xylkstream pattern:
  - `deploy/main.ts` — orchestrator that runs forge script and captures deployed addresses
  - `deploy/chains.ts` — Arc testnet (chain ID 5042002) and localhost chain configs
  - `deploy/utils.ts` — manifest parser and state read/write helpers
  - `deploy/output/` — JSON output of deployed addresses per chain
- **foundry.toml** — Solidity 0.8.20, Shanghai EVM, optimizer enabled (200 runs), via_ir
- **package.json** — npm scripts for build, test, and deployment

## How to build and test

```bash
# Build
forge build
# or
npm run build

# Test (all 17 tests)
forge test
# or
npm run test

# Verbose test output
npm run test:v
```

## How to deploy

```bash
# Install TypeScript dependencies (first time)
npm install

# Dry run against Arc testnet (no broadcast)
PRIVATE_KEY=0x... npm run deploy:dry

# Deploy to Arc testnet
PRIVATE_KEY=0x... npm run deploy:arc

# Deploy to local Anvil (start anvil first: `anvil`)
PRIVATE_KEY=0x... npm run deploy:local

# Custom deployment
PRIVATE_KEY=0x... npx tsx deploy/main.ts --name arc-testnet --rpc https://custom-rpc.example.com --broadcast
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | Yes | Deployer private key (hex with 0x prefix) |
| `USDC_ADDRESS` | No | Override USDC contract address (defaults to Arc Testnet: `0x3600000000000000000000000000000000000000`) |
| `ARC_TESTNET_RPC_URL` | No | Arc testnet RPC URL (for `foundry.toml` rpc_endpoints) |

## Arc Testnet details

- Chain ID: 5042002
- RPC: `https://rpc.testnet.arc.network`
- USDC: `0x3600000000000000000000000000000000000000` (6 decimals as ERC-20, 18 as native gas)
- Faucet: https://faucet.circle.com

## Deployed addresses

After deployment, addresses are saved to `deploy/output/<chain-name>.json`.
