# @livestreak/options — architecture

Consumer SDK for LiveStreak prediction markets on EVM. The package maps on-chain
`MarketDriver` / `Vault` / `Treasury` state into typed snapshots and UI panels.

## NFT-lane account model

Positions are keyed by **ERC-721 token id**, not `(user, vault, side)`.

```text
owner (EOA) ──owns──▶ MarketDriver NFT (tokenId)
                         └── lanes[]: { vaultId, side, rate, … }
```

| Rule | Meaning |
| --- | --- |
| One side per vault per NFT | Each lane picks YES **or** NO for a vault |
| Multi-vault exposure | Add lanes on the same NFT, or hold multiple NFTs |
| Multi-NFT holders | `MarketDriver.tokensOfOwner(owner)` lists all token ids |
| Vault reads use `tokenId` | `getPosition`, `claimable`, `lossClaimable`, `pendingShares` take `tokenId` as the account arg |

There is no “hold both sides on one lane” product path. Opposing exposure requires
separate NFTs (or separate vault lanes on different sides across NFTs).

## Layering

```text
chains/         wallet-direct connection edge (dispatch on walletInit.chain)
model/          pure domain types + model/math/ (curve, accrual, pnl)
read/           decode + per-family reads → snapshots (consumes chains.reader)
write/          validated write blueprints → chains.writer (encode + AA send)
panel/          UI projection (bigint → string, action flags)
runtime/        polling loop at the app edge (builds chain via createOptionsChain)
```

Dependency order: `chains` → `model` → `read` / `write` → `panel` / `runtime`.

### Package layout

```text
options/src/
  index.ts
  chains/           index.ts types.ts config.ts addresses.ts evm.ts sui.ts
  model/            entities + snapshot + stream.ts
    math/           curve.ts accrual.ts pnl.ts
  read/
    decode/         mapping validation errors sides
    market.ts       readMarket · listMarketVaults · readStreamState
    vault.ts        readVault · readVaultShareTotals · readBoard · …
    nft.ts          listOwnerTokens · readNft · readNftBalance · …
    claims.ts       readClaimable · readWinningSide · readClaimsView · …
    lvst.ts         readLvstAccount · readUsdcAddress
    reader.ts       thin OptionsReadTransport shim (createOptionsReader)
    snapshot.ts aggregation.ts pnl.ts stream.ts transport.ts
  write/            funding claim lvst nft
  panel/
  runtime/
```

### Purity

- `model/`, `model/math/`, `panel/`, `read/snapshot.ts` — vanilla TypeScript, no `Effect.run*`.
- `write/` validates inputs then calls `chains.writer.write` (encode + send + poll receipt).
- ABIs import **only** from `@livestreak/contracts/evm/abis` (under `chains/evm` and `read/context`).

### Chain boundary

```text
app / CLI
  ├── createOptionsChain(chainConfig)   → chains/{evm|sui}
  │     EVM reads:  viem publicClient.readContract (RPC from config)
  │     EVM writes: createWalletManager → sendTransaction (AA userOp) → poll receipt
  └── createOptionsRuntime({ config, chainConfig })  → poll + panel refresh
```

`createOptionsChain` dispatches on `walletInit.chain` (`evm` | `sui` stub). There are **no**
injected `ContractReader` / `ContractWriter` ports and no `createContractsOptions*Transport`
factories.

EVM writes mirror `observe/src/market/chains/evm.ts`: `createWalletManager` → `getAccount()` →
`encodeFunctionData` → `account.sendTransaction({ to, data, value: 0n })` → poll userOp receipt.

EVM reads use a viem **public client** — RPC from `readRpcUrl` when set, else
`EvmWalletInitConfig.provider`.

## On-chain roles

| Contract | Role in this SDK |
| --- | --- |
| `MarketRegistry` | Markets, vault index per market, `streamState` |
| `MarketDriver` | NFT mint, `tokensOfOwner`, `laneAt`, `setLanes`, funding controls |
| `Vault` | Pools, positions, bonding board, claims, resolution |
| `StewardRegistry` | Hot / dispute overlay on vault reads |
| `Treasury` | LVST staking + dividend reads |
| `LvstToken` | LVST balance |
| `DripsStreaming` | Per-NFT USDC stream balance (`streamsState`) |

Side enum on-chain: `yes = 0`, `no = 1`.

## Read surface

`OptionsReadTransport` is the in-package read seam. `createOptionsReader({ chain, addresses })`
composes per-family read functions over `chain.reader`.

### Core reads (R1)

- Markets: `readMarket`, `listMarketVaults`, `readStreamState` (raw `MarketRegistry.streamState`)
- Vaults: `readVault`, `readVaultShareTotals`
- NFTs: `listOwnerTokens`, `readNft` (lanes from `laneAt` + `getPosition`)
- LVST: `readLvstAccount`

### Claim previews (R2)

| Method | On-chain | Notes |
| --- | --- | --- |
| `readClaimable(tokenId, vaultId, side)` | `Vault.claimable` | Winner payout preview |
| `readLossClaimable(tokenId, vaultId, side)` | `Vault.lossClaimable` | Loser USDC basis for LVST |
| `readWinningSide(vaultId)` | `Vault.winningSide` | **Only after** `status === resolved` |
| `readPot(vaultId)` | `Vault.pot` | Non-zero after collection |
| `readCollected(vaultId)` | `Vault.collected` | |
| `readAccountVaultIds(tokenId)` | `Vault.getAccountVaultIds` | All funded vaults for token |

`readNft` enriches each lane with `claimable`, `lossClaimable`, and `won`
(`side === winningSide` when resolved). `readVaultSnapshot` adds `winningSide`,
`pot`, and `collected` for resolved vaults.

⚠️ **Never call `winningSide` on open vaults** — it reverts. The reader reads
`getVault` first and returns `undefined` unless status is `resolved`.

### Live ln() ticker (R2)

Bonding curve constants (display layer): `BASE_PRICE = 100_000`,
`CURVE_K = 10_000_000_000`, `SHARE_SCALE = 1_000_000`, `WAD = 1e18`.

| Method | On-chain |
| --- | --- |
| `readBoard(vaultId, side)` | `getBoard` → pool, sideRate, g, lastAdvance |
| `readSharePrice(vaultId, side)` | `getSharePrice` |
| `readPendingShares(vaultId, side, tokenId)` | `pendingShares` |

`projectShares` advances `g` locally via `segMath` (`Math.log` display estimate).
`projectStreamAccrual` builds `OptionsStreamAccrualView`:

- `pendingShares` — projected or frozen `pendingShares`
- `valueUSDC` — `pendingShares × (yesTotal + noTotal) / sideShareTotal`
- `sharesPerSec` — finite difference over 1s (zero when frozen)
- `sharePriceNow` — `priceOf(board.pool)`

Freezes when the lane is depleted, past `maxEndMs`, or past `resolvedAtMs`.
Re-anchors on every fresh `readPendingShares` RPC read.

## Snapshots and panel

```text
readUserOptionsSnapshot(transport, user, marketId?)
  → OptionsUserOptionsSnapshot
  → projectOptionsPanel(snapshot)
  → OptionsPanel
```

Lane panel fields (R2): `claimableUSDC`, `lossClaimableLVST`, `won`,
`canClaimWin`, `canClaimLoss`.

## Write surface

NFT-lane writes only (no vault/market creation in this package). Each function validates
inputs, builds `{ address, abi, functionName, args }`, and calls `chain.writer.write`:

- `fundStream`, `setLanes`, `stopFunding`, `stopAllFunding`
- `withdraw`, `withdrawMany`
- `claimLossLvst`
- `stakeLvst`, `unstakeLvst`, `claimDividends`
- NFT: `transferNft`, `approveNft`, `setApprovalForAll`

## Tests

- Unit: `model/math/` curve, accrual projector, panel projection, decode mapping
- Guards: no `Effect.run*` in `src/`, ABI import path, `winningSide` guard
- Fakes: `test/helpers/fake-chain.ts` stubs `chain.reader.read` (faked `readContract`) and
  captures `chain.writer.write` payloads; `createOptionsReader` composes over the fake chain

## R3 — aggregation + app-integration (complete)

### Drips + USDC reads

`OptionsContractAddresses` includes `dripsStreaming`. `readUsdcAddress()` caches
`MarketDriver.USDC()`. `readNftBalance(tokenId)` calls
`DripsStreaming.streamsState(tokenId, usdc)` and maps tuple index **3** (`balance`,
`uint128`) as `remainingUSDC`.

### Session PnL

`readSessionPnl(transport, user, investedUSDC?)` → `OptionsSessionPnlView`:

| Field | Fold |
| --- | --- |
| `returnedUSDC` | Σ `claimable(tokenId, vault, winningSide)` on resolved vaults |
| `lossBasisUSDC` | Σ `lossClaimable(tokenId, vault, losingSide)` |
| `remainingUSDC` | Σ `readNftBalance(tokenId)` across `tokensOfOwner` |
| `investedUSDC?` | Caller-supplied only — never invented |
| `netPnlUSDC?` | `returned + remaining − invested` when invested is supplied |

### Claims view

`readClaimsView(transport, user)` → `OptionsClaimsView` spanning all NFTs via
`tokensOfOwner` → `getAccountVaultIds` + lane enrichment. Reuses R2 claim reads.

### Runtime memory

`OptionsRuntime.set(key, value)` / `get(key)` — in-memory map on the store (reconstructable).
`onChange(cb)` fires on `set` **and** snapshot refresh; returns unsubscribe. `subscribeSnapshots`
remains snapshot-only.

### Panel (R3 flags)

- LVST: `canStake`, `canUnstake`, `canClaimDividends` (unchanged logic, explicit tests)
- Market: `totals.totalPooledUSDC` = Σ `(yesTotal + noTotal)` over market vaults
- NFT: `owner`, `approved`, `isOperator` from `ownerOf` / `getApproved` / `isApprovedForAll`

**Next step (app package):** wire `/stream` mock hooks to `chainConfig` + `createOptionsRuntime`.
