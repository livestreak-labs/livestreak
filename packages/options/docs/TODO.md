# @livestreak/options — TODO (re-derived from the shipped protocol)

See [architecture.md](./architecture.md) — **but note architecture.md is now partly wrong** (it
describes account+vault+side positions with simultaneous YES+NO hedging; the shipped protocol is
NFT-lane-centric with one-side-per-vault). architecture.md must be rewritten — see Blocker **B2**.

Source of truth for the real protocol shape: `packages/contracts/chains/evm/deploy/e2e.ts`
(full anvil regression) and `packages/contracts/chains/evm/generated/abis.ts` (`evmAbis`).

**Role:** browser-safe consumer workflow. No market/vault creation. No `Effect.run*` in `src/`.
Implementation prompt: `context/temp-convo/prompts/options.md` (Slice R1 — retarget to green).

---

## 0. Blockers (status)

> The two cross-package blockers are **resolved + peer-verified** (see
> `context/temp-convo/options/inbox/from-contracts__abis-and-enumeration-done.md`). B2/B3 are
> options-side rewrites confirmed by the shipped contracts + user steers. B5 is options-side.
> **Nothing gates the retarget anymore.**

### B1 — ✅ RESOLVED (contracts shipped the browser-safe entry). Now a pure options-side migration.
contracts shipped a fs-free subpath **`@livestreak/contracts/evm/abis`** — peer-verified: exports the
12 flat `*Abi` consts + `abis` map + `EvmContractAbi`/`EvmContract` types; built
`dist/chains/evm/abis-entry.js` pulls no `node:` / `addresses` / `contract`. (Do NOT import ABIs from
`./evm` — its barrel still drags `node:fs` via `addresses.ts`.)
- Remaining = **options-side**: drop the dead `@flowstream/contracts` dep + the hand-rolled
  `read/contracts/addresses.ts`; import ABIs/types from `@livestreak/contracts/evm/abis`; keep
  addresses injected at the app edge.
- (was: `npm run check` → 4× `TS2305` on `flowTokenAbi`/`vaultFundingAbi`; resolve threw `MODULE_NOT_FOUND`.)

### B2 — The position model is wrong: NFT lanes, not account+vault+side. (Confirmed; options-side rewrite.)
- Reality (e2e.ts): a position is an **ERC-721 token** on `MarketDriver` (one NFT per holder per
  market). One NFT holds up to `MAX_LANES` (= **10**) **lanes**; each lane = `(vaultId, side, rate)`
  with **exactly one side per vault**. You **cannot** stream YES and NO on the same vault at once —
  edge #9 "fund vault already has a lane reverts". Hedge = sequential side-flip via `setLanes`;
  abandoned-side shares survive (edges #16/#17). Stream >10 lanes by owning **multiple NFTs**.
- options models `OptionsUserVaultPosition.positions.{yes,no}` (both sides), `readUserVaultPosition`,
  and per-side funding keyed on `(user,vault,side)` — none of which match. architecture.md's "hold
  both sides" hedging language is false. Rewrite model/read/write/panel around `tokenId → lanes`.

### B3 — Funding + token-staking contracts are not what options assumes. (Confirmed; options-side rewrite.)
- **Funding:** no `VaultFunding` / `setFundingRate` / `fundingRate` / `fundingActive`. Funding is
  `MarketDriver.fund(tokenId, vaultId, side, rate, deposit)` + `setLanes(tokenId, lanes[], topUp)`,
  streamed via Drips. Per-NFT **shared balance**: `stop`/`stopAll` refund unspent; `setLanes` tops up.
  "Rate 0 = stop" is NOT the mechanism — `stop` / `stopAll` / `setLanes([])` are.
- **Token:** no `FlowToken` with `skeleton*`/`claimLossFlow`. `LvstToken` is a bare ERC-20
  (`balanceOf`). Staking/dividends/loss-mint live on **`Treasury`** (`stakeLvst`/`unstakeLvst`/
  `claimDividends`/`lvstStaked`/`lvstPendingDividends`/`mintRate`). Loss claim is
  `MarketDriver.claimLossLvst(tokenId, vaultId, side, to)`. options' `write/funding.ts`,
  `write/lvst.ts`, `read/contracts/transport.ts` all target the dead surface — repoint.

### B4 — ✅ RESOLVED on-chain. `MarketDriver` is now `ERC721Enumerable` → use `tokensOfOwner`.
contracts shipped (peer-verified in `MarketDriver.sol:31/:105` + regenerated `marketDriverAbi`):
`tokensOfOwner(address owner) → uint256[]` (+ `tokenOfOwnerByIndex` / `tokenByIndex` / `totalSupply`),
covering **transferred-in** NFTs too. → **Drop the client-side salt-probing plan**: a single
`tokensOfOwner(owner)` read enumerates a user's NFTs (then `marketIdOf` + `getAccountVaultIds` per
token). Contracts' answers: `mint()` kept (enumeration is mint-path-agnostic), `mintWithSalt` stays the
recommended deterministic mint; **B4-Q3 deferred** — live streamed-so-far / remaining is NOT a Vault
view, read **Drips `streamsState` / `balanceAt`** for it (covers the #4 PnL basis). Unblocks #5
(multi-NFT) and #7 (transfer).

### B5 — Live position worth + "cost of next share": SOLVED options-side (no contract gap).
- "What your next $1 buys" = `SHARE_SCALE / Vault.getSharePrice(vaultId, side)` (returns
  `BondingBoard.price(pool)` directly; `SHARE_SCALE = 1e6`).
- Live shares = `Vault.pendingShares(vaultId, side, tokenId)`; tick locally between RPC reads by
  porting `BondingBoard.segMath` (single-`lnWad` closed form) over `getBoard` + `getPosition`.
- Estimated USD worth = `pendingShares × (yesTotal+noTotal) / sideShareTotal` from `getVaultPools`
  (same formula as `claimable`). An estimate is fine for a live ticker.
→ port the curve into `model/curve.ts`. **NOT a contract change.**

> ⚠️ **Footgun:** arg order is inconsistent — `pendingShares(vaultId, side, tokenId)` vs
> `claimable(tokenId, vaultId, side)` vs `lossClaimable(tokenId, vaultId, side)` vs
> `getPosition(vaultId, side, tokenId)`. And `account` in every Vault position read **is the
> `tokenId`**, not an address. Do not transpose.

---

## 1. Foundational realignment (the R1 slice)

> **R1 + R2 ✅ LANDED & verified** — `check`/`build` green; 14 files / 113 tests pass (re-run independently).
> R1 = the NFT-lane core. R2 = claim previews (`claimable`/`lossClaimable`/`winningSide` [guarded]/
> `pot`), the board/share-price reads, the live ln() ticker (`OptionsStreamAccrualView`), and the
> architecture.md rewrite. **Still open → R3:** session PnL view, exhaustive claim-JSON aggregate,
> runtime memory/callback facade, transfer-panel read flags (`ownerOf`/`getApproved`/`isApprovedForAll`),
> stake grey-out flag, market total-pool aggregation.

- [x] Rewrite `docs/architecture.md` to the NFT-lane model: `tokenId → lanes`, one-side-per-vault,
      multi-NFT, and each contract's role (MarketRegistry / VaultDriver / MarketDriver / Vault /
      StewardRegistry / Treasury / LvstToken). Delete the "hold both sides" hedging language.
- [x] `model/`: add `TokenId` brand to `ids.ts`; replace `position.ts` with `lane.ts`
      (`{ tokenId, vaultId, side, rate, sharesAccrued, maxEndMs?, depleted }`) and `nft.ts`
      (`{ tokenId, owner, marketId, laneCount, lanes }`); `market.ts` +`creator`; `vault.ts` pools via
      `getVaultPools` + `shareTotals`; `curve.ts` (port `price` only this slice); reshape `snapshot.ts`.
- [x] `read/contracts/addresses.ts`: new set `{ marketRegistry, vault, marketDriver, stewardRegistry,
      treasury, lvstToken }` (+ `dripsStreaming`/`vaultDriver` only if read). Drop `bookmakerRegistry`,
      `vaultFactory`, `vaultFunding`, `flowToken`.
- [x] `read/contracts/transport.ts`: import ABIs (`abis` map / flat `*Abi`) from
      **`@livestreak/contracts/evm/abis`** (browser-safe; never `./evm`). Wire the real reads.
- [x] Writes: **keep the injected `ContractWriter`** — options is browser-safe; do NOT import
      `@livestreak/wallet` in `src/` (Node/sodium). Wallet wiring stays at the **app/CLI edge**
      (standing order). Writers route to `MarketDriver` (fund/setLanes/stop/stopAll/withdraw/
      claimLossLvst/transferFrom/approve/setApprovalForAll) + `Treasury`
      (stakeLvst/unstakeLvst/claimDividends). `createVault` stays out (bookmaker + VaultDriver own it).

---

## 2. Reads the panel/UI actually needs (map to real functions)

- [x] **Vault detail** = `Vault.getVault(vaultId)` `{id,marketId,question,creator,status,outcome,
      resolvedAt,exists}` **+** `Vault.getVaultPools(vaultId)` `[yesTotal,noTotal,yesShareTotal,
      noShareTotal]`. Pools moved OFF `getVault` → must call `getVaultPools`.
- [x] **Per-side board** = `Vault.getBoard(vaultId, side)` `[pool, sideRate, g, lastAdvance]` for live
      odds + the bonding-curve state behind share price.
- [x] **Steward overlay** = `StewardRegistry.vaultHotState` / `disputeState`. ✅ shapes already match
      options' `RawHotState`/`RawDisputeState` — keep.
- [x] **Market index** = `MarketRegistry.getMarket` / `getVaultIds` / `marketCount` / `marketIdAt` /
      `computeMarketId(observer, streamId)`. **`getMarket` now returns `MarketData {id, title,
      streamId, creator, createdAt, exists}`** — the new **`creator`** is absent from options'
      `RawMarketData` + `OptionsMarket`; add it to the market model + `mapMarket`. (`registerMarket`
      takes `streamId`; identity = `computeMarketId(observer, streamId)`.)
- [x] **Lane / position** = `Vault.getPosition(vaultId, side, tokenId)`, `pendingShares(vaultId, side,
      tokenId)`, `MarketDriver.tokensOfOwner` / `laneCount` / `laneAt`, `Vault.getAccountVaultIds(tokenId)`.
- [x] **Claim previews** = `Vault.claimable(tokenId, vaultId, side)` (winner; 0 pre-resolution),
      `lossClaimable(tokenId, vaultId, side)` (loser basis), `winningSide(vaultId)`, `pot(vaultId)`.

---

## 3. User-steered scope (concrete TODOs)

- [x] **#1 Real-time stream worth (ln curve).** `OptionsStreamAccrualView`: `pendingShares` +
      `getSharePrice`/`getBoard`; tick client-side each second. *(Unblocked — see B5.)*
- [ ] **#2 Walk `/stream` + exhaustive claim JSON.** Page is mock today (`StreamLayout` →
      `useVaults`/`useFlow`/`mockPositions`). Produce a view that knows **all the vaults a user is
      active in** (`tokensOfOwner` → `getAccountVaultIds`) and, per vault: **win** →
      `withdraw(tokenId, vaultId, redirect)` (green), **loss** → `claimLossLvst(tokenId, vaultId,
      side, to)` (red). Authoritative action flags (`canClaimWin`/`canClaimLoss`/disabled-reason).
- [ ] **#2b Runtime memory + callback API.** Extend `OptionsRuntime` (`subscribeSnapshots` exists)
      with a keyed `set(key,value)` / `onChange(cb)` facade so the app can persist "vaults I'm working
      on" without durable storage. Reconstructable.
- [ ] **#3 Total pool in a market.** `sum over getVaultIds(marketId) of getVaultPools().yesTotal +
      noTotal`. Feeds `StreamBar.totalPooled`. *(Available — repoint pools to `getVaultPools`.)*
- [ ] **#4 Session PnL from the user's flow.** Aggregate across the user's NFTs/lanes: `streamed −
      refunded + returned (withdraw/claimable) + loss-LVST basis` →
      `OptionsSessionPnlView { streamedUSDC, returnedUSDC, refundedUSDC, lossLvst, netPnlUSDC }`.
      *(Unblocked — `tokensOfOwner` for all NFTs; live streamed-so-far via Drips `streamsState`/`balanceAt`.)*
- [ ] **#5 Stream >10 lanes via multiple NFTs.** Model a user owning **N NFTs per market**, each ≤10
      lanes; aggregate lane list + per-NFT `MAX_LANES`. *(Unblocked — enumerate via `tokensOfOwner`.)*
- [x] **#6 One side per vault (no simultaneous YES+NO).** Enforce in model + panel; "hedge" =
      `setLanes` side-flip, not a second lane. Remove the `positions.{yes,no}` shape.
- [x] **#7 NFT controls position + transfer.** Expose `transferNft` (`transferFrom`), `approveNft`
      (`approve`), `setApprovalForAll`; reads `ownerOf`/`getApproved`/`isApprovedForAll`. Redirect
      rule: `withdraw(tokenId, vault, payee)` — **only the owner** can redirect (e2e edge #41). *(Available.)*

---

## 4. UI surfaces to back (oracle: `VaultCard`, `BalanceBar`, `useFlow`)

- [x] **Claim win/loss buttons (green/red).** `VaultCard` `WinState`(payout) / `LossState`
      (`flowReceived` + Stake) → `withdraw` (win) + `claimLossLvst` (loss). `payout` from `claimable`;
      `flowReceived` = `lossClaimable × mintRate`.
- [ ] **Stake button (grey-out state).** `BalanceBar`/`useFlow` want `{ balance, staked,
      pendingDividends, totalEarned, apy }` + `stake/unstake/claimDividends` →
      `Treasury.stakeLvst/unstakeLvst/claimDividends` + reads `lvstStaked`/`lvstPendingDividends` +
      `lvstToken.balanceOf`. `canStake = unstaked > 0`; `canClaimDividends = pendingDividends > 0`.
      (`useFlow` still points at `contracts.flowToken`/`FLOW_TOKEN_ABI` — app edge also needs the
      LVST/Treasury repoint; raise to app via inbox.)
- [x] **Cost of newer shares per streamed funds.** Expose `sharePriceNow` / `sharesPerUsdcNow` from
      `getSharePrice`/`getBoard`. *(Available — `getSharePrice` returns `price(pool)` directly; see B5.)*
- [ ] **NFT transfer panel.** "Each market = a stream; the NFT is per-market" → list the user's NFTs
      with transfer/approve actions (see #7). *(Unblocked — list via `tokensOfOwner`.)*

---

## 5. Live ticker (was Slice 6) — now groundable

- [x] `OptionsStreamAccrualView`: `pendingShares` now, `$ value now`, `shares/sec` (falls as pool
      grows). Client tick mirrors the contract curve between reads. Read-only, reconstructable.
      *(Unblocked — see B5; `$ value` = `pendingShares × pot_est / sideShareTotal`.)*

---

## 6. What is already ALIGNED — keep, do not churn

- ✅ Side enum: Solidity `enum Side { Yes, No }` = 0/1, matches `sideToSolidityValue` (yes→0, no→1).
- ✅ `StewardRegistry.vaultHotState` / `disputeState` shapes == options' `RawHotState`/`RawDisputeState`.
- ✅ `MarketRegistry` read surface (`getMarket`/`getVaultIds`/`marketCount`/`marketIdAt`).
- ✅ Parimutuel odds math + panel projection *pattern* (shapes change; approach stays).
- ✅ Runtime store/copy/config-validation hardening — reusable as-is once model types settle.
- ✅ Injected `ContractReader`/`ContractWriter` boundary — options stays browser-safe; wallet at the
  app/CLI edge. Do NOT migrate options to a direct `@livestreak/wallet` import.

---

## 7. Verification (R1)

```
cd packages/options && npm run check && npm run build && npm test
grep -RInE "from \"effect\"|Effect\\." packages/options/src || true                              # none
grep -RInE "@flowstream/|vaultFundingAbi|flowTokenAbi|skeleton|setFundingRate" packages/options/src || true  # none
grep -RInE "@livestreak/contracts/evm\"" packages/options/src || true                            # none (must be /evm/abis)
find packages/options/src packages/options/test -type f -empty                                    # none
```
