// --- exports ---

import type { TokenId, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";

export interface OptionsLane {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  /** On-chain lane rate, retained even when depleted (effective `rate` is 0 then). Lets a setLanes
   *  rebuild re-assert depleted lanes instead of dropping them — see runtime `existingLaneWrites`. */
  readonly committedRate: bigint;
  readonly gPaid: bigint;
  readonly sharesAccrued: bigint;
  readonly maxEndMs?: number;
  readonly depleted: boolean;
  readonly claimable?: bigint;
  /** LVST this losing lane is worth (basis × mintRate) — the EARNED amount, shown even after claiming.
   *  Pair with `lossClaimed` for the settled state; `canClaimLoss` gates the button on `!lossClaimed`. */
  readonly lossClaimable?: bigint;
  /** True once this loss has been claimed on-chain (the LVST was already minted). Keeps the earned amount
   *  visible as a "claimed" row instead of a re-clickable claim that would fail AlreadyClaimed. Some
   *  readers can't observe it (Sui has no claimed view yet) → undefined = treated as not-claimed. */
  readonly lossClaimed?: boolean;
  /** Overstream: raw USDC that streamed out of this lane AFTER the vault resolved (rate × (min(maxEnd,
   *  now) − resolvedAt)), refundable via withdraw. 0 on an open lane. Each chain reader fills it. */
  readonly overstreamClaimable?: bigint;
  readonly won?: boolean;
}
