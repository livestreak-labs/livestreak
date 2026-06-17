# @flowstream-re2/options — TODO

See [architecture.md](./architecture.md). Depends on `@flowstream-re2/contracts` reads/writes (later slice). See [repo TODO](../../../../TODO.md).

**Role:** browser-safe consumer workflow. No market/vault creation. No `Effect.run*` in library `src/`.

---

## Slice 1 — model + read + panel (current)

- [x] `model/*` — market, vault, position, funding, flow account, snapshot aggregates
- [x] `read/*` — `OptionsReadTransport`, `readMarketSnapshot`, `readVaultSnapshot`, `readUserOptionsSnapshot`
- [x] `panel/*` — `OptionsPanel`, `projectOptionsPanel`
- [x] Fake transport test helper under `test/helpers/fake-transport.ts`
- [x] Pure tests: pool totals, sides, resolved claim/loss, panel projection
- [x] Bigint in model snapshots; string amounts in panel
- [x] Architecture + public export guards

**Follow-ups discovered in slice 1:**

- [ ] `model/resolved.ts` + `OptionsResolvedVaultView` split (architecture doc) — live `OptionsVaultPanel` currently carries resolved fields when status is resolved
- [ ] `model/odds.ts` bonding-curve odds — panel uses simple parimutuel pool ratios for v0
- [ ] `readProtocolSummary` only when transport implements it; empty-market `readUserOptionsSnapshot` without `marketId` returns FLOW-only shell

---

## Slice 2 — real chain reads

- [ ] Wire `@flowstream-re2/contracts` decoders behind `OptionsReadTransport`
- [ ] `listMarkets` helper when protocol summary / registry read exists
- [ ] No real chain required in tests — keep fake transport

---

## Slice 3 — runtime + polling

- [ ] `runtime/config.ts`, `store.ts`, `poll.ts`, `runtime.ts`
- [ ] In-memory snapshot store; inject viem/public read transport
- [ ] No wallet secrets stored

---

## Slice 4 — writes (injected transport)

- [ ] `write/funding.ts` — `setFundingRate`, `stopFundingStream`
- [ ] `write/claim.ts` — `claimVault`, `releaseVault`
- [ ] `write/flow.ts` — `claimLossFlow`, `claimAndStakeLossFlow`, stake/unstake, `claimFlowDividends`
- [ ] Write plans via `@flowstream-re2/contracts` encoders only

---

## Slice 5 — bridge (later)

- [ ] `bridge/` callable edge when CLI/UI gateway needs it
- [ ] Action hints on panel (`canStreamYes`, `canClaim`, etc.) — read-only flags deferred until write slice

---

## Reads must cover

- [x] Markets, vaults, vault pools
- [x] User YES and NO positions (separate)
- [x] Funding rates per side
- [x] FLOW balance, staked, pending dividends, loss claims
- [ ] Resolved vault list helper (`listResolvedVaults`) — deferred; single-vault resolved projection works via transport data

---

## Tests & guards

- [x] Fake transport tests for public read APIs
- [x] Negative-path tests for missing market/vault/FLOW account
- [x] Public export contract test
- [x] Architecture guards (Effect purity, forbidden imports, empty files)
- [x] No dependency on bookmaker; no vault creation exports

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../../TODO.md#hardening-loop-every-slice).

- [x] check / build / test for `packages-re2/options`
- [x] Browser-safe import scan; no `Effect.run*` in `src/`
- [x] Negative-path test for every new public API
- [x] Update this `docs/TODO.md`
