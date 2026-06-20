// --- exports ---

import type { TokenId, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";

export interface OptionsLane {
  readonly tokenId: TokenId;
  readonly vaultId: VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly sharesAccrued: bigint;
  readonly maxEndMs?: number;
  readonly depleted: boolean;
}
