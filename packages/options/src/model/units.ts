// --- exports ---

import type { ContractChain } from "../chains/types.js";
import { SHARE_SCALE } from "./math/curve.js";

// USDC and protocol shares are 6-decimal on every chain. LVST decimals are chain-LOCAL (contracts D2):
// EVM = 18, Sui/Solana = 9. The board normalizes with these so no consumer carries a decimals table.
const USDC_SCALE = 1_000_000;
const LVST_DECIMALS: Record<ContractChain, number> = { evm: 18, sui: 9, solana: 9 };

export const lvstDecimalsForChain = (chain: ContractChain): number => LVST_DECIMALS[chain];

/** One whole USDC in base units (6-dec) — the denominator for the loss-mint curve and overstream math. */
export const USDC_ONE_UNITS = 1_000_000n;

/** USDC loss basis → LVST base units, via the protocol's cumulative-pot mint rate: (basis × mintRate) /
 *  USDC_ONE. Every chain's Treasury mints losses by this exact formula (EVM Treasury._mintLoss, Sui
 *  mint_loss_lvst, Solana treasury.rs), so each reader converts the vault's raw USDC loss to LVST HERE —
 *  the panel then scales by the chain's LVST decimals. Keeps the loss preview equal to what claim mints. */
export const lossBasisToLvst = (basisUsdc: bigint, mintRate: bigint): bigint =>
  (basisUsdc * mintRate) / USDC_ONE_UNITS;

/** Overstream: USDC that streamed out of a lane AFTER its vault resolved — committedRate × (min(maxEnd,
 *  now) − resolvedAt), the exact pay_overage entitlement. A stream only stops when the user stops it, so
 *  everything that flows past resolution is theirs to reclaim (via withdraw). 0 on an open vault or a
 *  pre-resolution end; the committed rate keeps a depleted-but-unstopped lane showing its owed refund.
 *  All times in seconds. Chain-agnostic: every reader fills the lane's `overstreamClaimable` with this. */
export const computeOverstreamClaimable = (
  committedRate: bigint,
  maxEndSec: number,
  resolvedAtSec: number,
  nowSec: number
): bigint => {
  if (committedRate <= 0n || resolvedAtSec <= 0) return 0n;
  const overEnd = maxEndSec > 0 ? Math.min(maxEndSec, nowSec) : nowSec;
  return overEnd > resolvedAtSec ? committedRate * BigInt(overEnd - resolvedAtSec) : 0n;
};

/** USDC base units → whole USDC. */
export const usdcToNumber = (raw: bigint): number => Number(raw) / USDC_SCALE;

/** Protocol shares (1e6) → whole shares. */
export const sharesToNumber = (raw: bigint): number => Number(raw) / Number(SHARE_SCALE);

/** LVST base units → whole LVST, at the chain's decimals. */
export const lvstToNumber = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** Stream rate in USDC base units/sec → USDC/min. */
export const rateToPerMinUSDC = (ratePerSecRaw: bigint): number => (Number(ratePerSecRaw) * 60) / USDC_SCALE;

/** USDC/min → stream rate in USDC base units/sec (floored at 1 — the contract rejects rate 0). */
export const perMinUSDCToRate = (usdPerMin: number): bigint =>
  BigInt(Math.max(1, Math.round((usdPerMin * USDC_SCALE) / 60)));

/** Whole USDC → base units. */
export const usdcToRaw = (usd: number): bigint => BigInt(Math.round(usd * USDC_SCALE));
