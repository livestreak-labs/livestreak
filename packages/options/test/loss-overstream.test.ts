import { describe, expect, it } from "vitest";

import {
  computeOverstreamClaimable,
  lossBasisToLvst,
  lvstToNumber
} from "../src/model/units.js";
import { enrichLane, mapLane, type RawLane, type RawPosition } from "../src/chains/evm/decode.js";
import { enrichSuiLane } from "../src/chains/sui/decode.js";
import { asTokenId } from "../src/model/ids.js";

// LVST loss-claimable was projected mis-scaled on EVM/Sui (and previously Solana): the vault returns the
// USDC loss BASIS, but the panel scales by the chain's LVST decimals — so the basis rendered ~1e5–1e12×
// too small (live: 0.007 shown where the claim minted 718). The readers now convert basis → LVST with the
// on-chain formula (basis × mintRate / USDC_ONE) so the preview equals the mint. mintRate carries the
// chain's LVST decimals, so the single formula is correct on every chain.
describe("lossBasisToLvst — loss preview equals the on-chain mint", () => {
  const LOSS_BASIS = 7_180_000n; // 7.18 USDC lost (6-dec) — the live scenario

  it("EVM (18-dec LVST): 7.18 USDC × mintRate 100 → 718 whole LVST", () => {
    const mintRate = 100n * 10n ** 18n; // 100 whole LVST per whole USDC, in 18-dec base units
    const lvst = lossBasisToLvst(LOSS_BASIS, mintRate);
    expect(lvst).toBe(718n * 10n ** 18n);
    expect(lvstToNumber(lvst, 18)).toBeCloseTo(718, 6);
  });

  it("Solana/Sui (9-dec LVST): 7.18 USDC × mintRate 100 → 718 whole LVST", () => {
    const mintRate = 100n * 10n ** 9n; // 100 whole LVST per whole USDC, in 9-dec base units
    const lvst = lossBasisToLvst(LOSS_BASIS, mintRate);
    expect(lvst).toBe(718n * 10n ** 9n);
    expect(lvstToNumber(lvst, 9)).toBeCloseTo(718, 6);
  });

  it("the OLD bug: rendering the raw basis as 9-dec LVST gave ~0.007 (regression guard)", () => {
    // Before the fix the reader returned the basis and the projection scaled by 9 → the observed 0.007.
    expect(lvstToNumber(LOSS_BASIS, 9)).toBeCloseTo(0.00718, 6);
    // After: convert first, then scale — 718, not 0.007.
    expect(lvstToNumber(lossBasisToLvst(LOSS_BASIS, 100n * 10n ** 9n), 9)).toBeCloseTo(718, 6);
  });

  it("zero basis → zero LVST", () => {
    expect(lossBasisToLvst(0n, 100n * 10n ** 18n)).toBe(0n);
  });
});

// Overstream = USDC that streamed out of a lane AFTER its vault resolved (committedRate × (min(maxEnd,
// now) − resolvedAt)) — the exact pay_overage entitlement, refundable via withdraw. Was computed only on
// Solana; the shared helper now feeds all three chains.
describe("computeOverstreamClaimable — post-resolution refundable stream", () => {
  const RATE = 10_000n; // 0.60 USDC/min = 0.01 USDC/s = 10_000 base units/s

  it("streams past resolution: rate × (now − resolvedAt)", () => {
    // resolved at t=1000, now=1100, deposit runs to 2000 → 100s of overstream = $1.00
    expect(computeOverstreamClaimable(RATE, 2000, 1000, 1100)).toBe(RATE * 100n);
  });

  it("caps at maxEnd (the deposit ran dry before now)", () => {
    // resolved at 1000, maxEnd 1050, now 1100 → only 50s streamed past resolution
    expect(computeOverstreamClaimable(RATE, 1050, 1000, 1100)).toBe(RATE * 50n);
  });

  it("open vault (resolvedAt 0) → 0", () => {
    expect(computeOverstreamClaimable(RATE, 2000, 0, 1100)).toBe(0n);
  });

  it("deposit ended before resolution → 0 (never overstreamed)", () => {
    expect(computeOverstreamClaimable(RATE, 900, 1000, 1100)).toBe(0n);
  });

  it("no rate → 0", () => {
    expect(computeOverstreamClaimable(0n, 2000, 1000, 1100)).toBe(0n);
  });

  it("no maxEnd cap (maxEnd 0 = uncapped) uses now", () => {
    expect(computeOverstreamClaimable(RATE, 0, 1000, 1100)).toBe(RATE * 100n);
  });
});

// The reader enrichers must carry overstreamClaimable through to the lane so the projection can surface
// the settlement-card Overstream row on every chain (undefined when not provided keeps open lanes clean).
describe("enrichLane / enrichSuiLane — overstream passthrough", () => {
  const tokenId = asTokenId(9n);
  const rawLane: RawLane = { vaultId: `0x${"cd".repeat(32)}`, side: 1, rate: 10_000n };
  const position: RawPosition = {
    rate: 10_000n,
    gPaid: 0n,
    sharesAccrued: 0n,
    maxEnd: 2000,
    depleted: false
  };

  it("EVM enrichLane attaches overstreamClaimable when given", () => {
    const lane = enrichLane(mapLane(tokenId, rawLane, position), 0n, 500n, "no", 1_000_000n);
    expect(lane.overstreamClaimable).toBe(1_000_000n);
    expect(lane.lossClaimable).toBe(500n);
  });

  it("EVM enrichLane omits overstreamClaimable when not given (open lane)", () => {
    const lane = enrichLane(mapLane(tokenId, rawLane, position), 0n, 0n, undefined);
    expect(lane.overstreamClaimable).toBeUndefined();
  });

  it("Sui enrichSuiLane attaches overstreamClaimable when given", () => {
    const base = mapLane(tokenId, rawLane, position); // shape-compatible OptionsLane
    const lane = enrichSuiLane(base, 0n, 500n, "no", 2_000_000n);
    expect(lane.overstreamClaimable).toBe(2_000_000n);
  });
});
