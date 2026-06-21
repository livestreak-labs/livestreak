import type { StewardPanelView } from "../../model/panel.js";
import type { StewardSubjectKind } from "../../model/subject.js";

// --- exports ---

export interface StewardStateSnapshot {
  readonly runtimeId: string;
  readonly revision: number;
  readonly watchedSubjects: readonly import("../../model/subject.js").StewardSubject[];
  readonly latestFindings: readonly import("../../model/finding.js").StewardFinding[];
  readonly latestDecisions?: readonly import("../../model/decision.js").StewardDecision[];
  readonly pendingActionPlans?: readonly import("../../model/action-plan.js").StewardActionPlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}

export type StewardPanelInput = StewardStateSnapshot | StewardPanelView;

export interface StewardFunctionTarget {
  readonly kind: "subject" | "vault" | "steward" | "global";
  readonly subjectId?: string;
  readonly subjectKind?: StewardSubjectKind;
  readonly vaultId?: string;
  readonly stewardId?: string;
  readonly findingId?: string;
}

export interface StewardFunctionView {
  readonly name: string;
  readonly scope: string;
  readonly label: string;
  readonly input?: string;
  readonly target?: StewardFunctionTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export interface StewardControlsView {
  readonly runtimeId: string;
  readonly revision: number;
  readonly functions: readonly StewardFunctionView[];
}
