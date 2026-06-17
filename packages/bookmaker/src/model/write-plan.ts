import type { BookmakerDecision } from "./decision.js";

// --- exports ---

export interface BookmakerWritePlan {
  readonly decision: BookmakerDecision;
  readonly calls: readonly BookmakerContractCall[];
}

export interface BookmakerContractCall {
  readonly contract: "vault" | "vaultFactory" | "agentRegistry";
  readonly functionName: string;
  readonly args: readonly unknown[];
}
