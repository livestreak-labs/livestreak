import type { BookmakerDecision } from "./decision.js";
import type { BookmakerMarketContext } from "./market-context.js";
import type { SimilarityCandidate } from "./similarity.js";
import type { Detection, VaultDraft } from "./vault-draft.js";
import type { BookmakerWatchSource } from "./watch-source.js";
import type { BookmakerWritePlan } from "./write-plan.js";

// --- exports ---

export interface BookmakerPanelView {
  readonly runtimeId: string;
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly latestDetection?: Detection;
  readonly currentDraft?: VaultDraft;
  readonly similarityCandidates: readonly SimilarityCandidate[];
  readonly lastDecision?: BookmakerDecision;
  readonly pendingWritePlan?: BookmakerWritePlan;
  readonly completedWritePlans: readonly BookmakerWritePlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}
