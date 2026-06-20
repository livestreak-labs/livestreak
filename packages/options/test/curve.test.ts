import { describe, expect, it } from "vitest";

import { BASE_PRICE, CURVE_K, SHARE_SCALE, priceOf, sharesPerUsdc } from "../src/model/curve.js";

describe("bonding curve", () => {
  it("priceOf returns base price at zero pool", () => {
    expect(priceOf(0n)).toBe(BASE_PRICE);
  });

  it("priceOf scales linearly with pool over CURVE_K", () => {
    expect(priceOf(CURVE_K)).toBe(BASE_PRICE * 2n);
    expect(priceOf(CURVE_K * 2n)).toBe(BASE_PRICE * 3n);
  });

  it("sharesPerUsdc inverts price at SHARE_SCALE", () => {
    const pool = 100_000_000n;
    const price = priceOf(pool);

    expect(sharesPerUsdc(pool)).toBe(SHARE_SCALE / price);
  });

  it("sharesPerUsdc at zero pool uses base price", () => {
    expect(sharesPerUsdc(0n)).toBe(SHARE_SCALE / BASE_PRICE);
  });
});
