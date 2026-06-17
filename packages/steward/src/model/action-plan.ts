import type { StewardDecision } from "./decision.js";

// --- exports ---

export interface StewardActionPlan {
  readonly decision: StewardDecision;
  readonly contractCalls: readonly StewardContractCall[];
  readonly hostActions: readonly StewardHostAction[];
}

export interface StewardContractCall {
  readonly contract: "vault" | "stewardRegistry" | "agentRegistry";
  readonly functionName: string;
  readonly args: readonly unknown[];
}

export interface StewardHostAction {
  readonly kind: "openThread" | "appendMessage" | "annotate";
  readonly payload: unknown;
}
