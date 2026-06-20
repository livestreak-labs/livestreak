// --- exports ---

export const BASE_PRICE = 100_000n;
export const CURVE_K = 10_000_000_000n;
export const SHARE_SCALE = 1_000_000n;

export const priceOf = (pool: bigint): bigint =>
  BASE_PRICE + (BASE_PRICE * pool) / CURVE_K;

export const sharesPerUsdc = (pool: bigint): bigint => {
  const price = priceOf(pool);
  if (price === 0n) {
    return 0n;
  }

  return SHARE_SCALE / price;
};
