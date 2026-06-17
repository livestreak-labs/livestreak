# @flowstream-re2/bookmaker — TODO

See [architecture.md](./architecture.md). See [repo TODO](../../../../TODO.md).

**Role:** vault origination under observer-registered `marketId`. Does not create markets. Does not depend on `@flowstream-re2/options`.

---

## Slice A — model + validators (current base)

- [ ] Pure validators: `BookmakerMarketContext`, `BookmakerWatchSource`, `VaultDraft`, `Detection`, `SimilarityResult`
- [ ] `BookmakerDecision` skip reasons typed
- [ ] Tests for invalid drafts and policy inputs

---

## Slice B — detection + draft

- [ ] `PatternDetector` interface
- [ ] Port confidence evaluation ideas from `packages-re/sdk-bookmaker`
- [ ] `buildVaultDraft(detection, marketContext)`
- [ ] `detectOpportunity(observations, strategy, marketContext)`

---

## Slice C — similarity + decision

- [ ] `chooseVaultAction(draft, similarity, policy)` — join | create | skip
- [ ] Host client shape for `findSimilar({ marketId, vaultDraft })`
- [ ] Fake host client for tests first
- [ ] No global cross-market similarity

---

## Slice D — write plan

- [ ] `planBookmakerWrite(decision, contracts)` using `@flowstream-re2/contracts` only
- [ ] No direct ABI fragments
- [ ] `createVault(marketId, ...)` and optional join path

---

## Slice E — runtime / Bridge (later)

- [ ] Long-running agent loop only when observation subscription exists
- [ ] `BookmakerRuntime`, panel projection, Bridge edge
- [ ] AA execute via injected transport + host bundler

---

## Explicit non-goals

- [ ] No `registerMarket` / market creation
- [ ] No user funding streams (options)
- [ ] No steward approval gate in v0
- [ ] No auto-merge / vault collapse on-chain

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../../TODO.md#hardening-loop-every-slice).

- [ ] check / build / test for `packages-re2/bookmaker`
- [ ] Pure-layer tests for validators/decision policy; no `Effect.run*` in `src/` except tests
- [ ] Negative-path test for every new public API
- [ ] Update this `docs/TODO.md`
