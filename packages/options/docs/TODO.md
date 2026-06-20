# @livestreak/options — TODO

See [architecture.md](./architecture.md). Browser-safe consumer workflow — no market/vault creation,
no `Effect.run*`, no `@livestreak/wallet` in `src/`. ABIs from `@livestreak/contracts/evm/abis`;
addresses + transports (`ContractReader`/`ContractWriter`) injected at the app/CLI edge.

## ✅ Shipped & verified (R1–R3) — `check`/`build` green, 15 files / 120 tests

- **R1 — NFT-lane core** (committed `8d120aa`). Model keyed `tokenId → lanes` (one side per vault;
  multi-NFT via `tokensOfOwner`). Reads: `getVault` + `getVaultPools`, `getPosition`, steward
  hot/dispute, market index `+creator`. Writes → MarketDriver
  (`fund`/`setLanes`/`stop`/`stopAll`/`withdraw`/`claimLossLvst`/`transferFrom`/`approve`) + Treasury
  (`stakeLvst`/`unstakeLvst`/`claimDividends`).
- **R2 — read-views.** Claim previews (`claimable`/`lossClaimable`/`winningSide` [guarded]/`pot`); live
  ln() ticker (`OptionsStreamAccrualView`); panel win/loss amounts + flags; `architecture.md` rewritten.
- **R3 — aggregation.** Cross-NFT session PnL (`projectSessionPnl`; `invested` caller-supplied, never
  fabricated; Drips `streamsState[3]` = remaining balance); exhaustive `OptionsClaimsView`; runtime
  `set`/`get`/`onChange` in-memory API; stake grey-out flags + market total-pool + NFT transfer reads.

> R2 + R3 are in the working tree, **uncommitted** (R1 = `8d120aa`).

## ▢ Open

- [ ] **R4 — consumer media read** (queued from `from-observe__consumer-vod-read.md`; acked).
  Browser-safe `getStreamMedia(marketId) → { status, vodUrl? }`: read `MarketRegistry.streamState` →
  `(status, scheme, id, updatedAt, endedAt)`; on `Ended` → `vodUrl = gateway(scheme) + id` via a
  `scheme → gateway` constant (`0 walrus-testnet · 1 walrus-mainnet · 2 ipfs · 3 arweave`), `id`
  verbatim. Public aggregator (no host dep; host-proxy only if CORS). Reuse `PointerScheme` from
  `@livestreak/host`. No durable state. `Live` playback = phase-2.

## Next (not options)

App integration — wire `app/` `/stream` mock hooks (`useVaults`/`useFlow`) to `createOptionsRuntime`
+ a viem `ContractReader`/`ContractWriter` at the app edge. Separate app-package prompt.

## Invariants (keep)

Side enum `yes=0`/`no=1`; `account` in Vault reads is the **`tokenId`**; pools from `getVaultPools`
(not `getVault`); `winningSide` only behind a `status === "resolved"` guard; injected transports,
wallet at the app/CLI edge.

## Verify

```
cd packages/options && npm run check && npm run build && npm test
```
