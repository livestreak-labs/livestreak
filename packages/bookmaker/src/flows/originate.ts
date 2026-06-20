import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerDetectionEvaluation } from "../detection/types.js";
import type { BookmakerVaultPolicy } from "../decision/choose.js";
import { chooseVaultAction } from "../decision/choose.js";
import { buildVaultDraft } from "../draft/build.js";
import type { BookmakerDecision } from "../model/decision.js";
import type { Detection } from "../model/detection.js";
import type { VaultDraft } from "../model/vault-draft.js";
import { buildCreateVaultIntent } from "../model/write-intent.js";
import { idempotencyKeyFromDraft } from "../model/idempotency.js";
import type { SimilarityResult } from "../model/similarity.js";
import type { BookmakerChain, CreateVaultResult } from "../chains/types.js";
import type { BookmakerSimilarityClient } from "../similarity/client.js";
import { findSimilar } from "../similarity/find.js";
import type { IdempotencyStore } from "../runtime/idempotency.js";
import { createIdempotencyStore } from "../runtime/idempotency.js";
import { validateCreateVaultIntent } from "../validate/write-intent.js";
import { validateVaultDraftForCreate } from "../validate/vault-draft.js";

// --- exports ---

export interface OriginateVaultInput {
  readonly evaluation: BookmakerDetectionEvaluation;
  readonly marketContext: BookmakerMarketContext;
  readonly fundingToken: string;
  readonly policy: BookmakerVaultPolicy;
  readonly similarityClient: BookmakerSimilarityClient;
  readonly chain: BookmakerChain;
  readonly nowMs: number;
  readonly idempotencyStore?: IdempotencyStore;
}

export type OriginateVaultResult =
  | {
      readonly action: "skipped";
      readonly reason: string;
      readonly detection: Detection;
    }
  | {
      readonly action: "joined";
      readonly vaultId: string;
      readonly draft: VaultDraft;
      readonly detection: Detection;
    }
  | {
      readonly action: "created";
      readonly draft: VaultDraft;
      readonly detection: Detection;
      readonly intent: ReturnType<typeof buildCreateVaultIntent>;
      readonly result: CreateVaultResult;
      readonly idempotent: boolean;
      readonly idempotencyKey: string;
    };

export const originateVault = async (input: OriginateVaultInput): Promise<OriginateVaultResult> => {
  if (input.evaluation.action !== "detected") {
    throw new LiveStreakConfigError({
      message: "originateVault requires a detected evaluation"
    });
  }

  const detection = input.evaluation.detection;
  const draft = buildVaultDraft(detection, input.marketContext, {
    fundingToken: input.fundingToken,
    nowMs: input.nowMs
  });

  const similarity = await findSimilar(draft, input.similarityClient);
  const decision = chooseVaultAction(draft, similarity, {
    ...input.policy,
    detection
  });

  return finalizeOriginateDecision(input, detection, draft, similarity, decision);
};

// --- helpers ---

const finalizeOriginateDecision = async (
  input: OriginateVaultInput,
  detection: Detection,
  draft: VaultDraft,
  _similarity: SimilarityResult,
  decision: BookmakerDecision
): Promise<OriginateVaultResult> => {
  if (decision.action === "skip") {
    return {
      action: "skipped",
      reason: decision.reason,
      detection
    };
  }

  if (decision.action === "joinVault") {
    return {
      action: "joined",
      vaultId: decision.vaultId,
      draft,
      detection
    };
  }

  const draftValidated = validateVaultDraftForCreate(draft, input.nowMs);
  if (draftValidated.ok === false) {
    throw new LiveStreakConfigError({
      message: draftValidated.issues.join("; "),
      metadata: { details: JSON.stringify(draftValidated.issues) }
    });
  }

  const intent = buildCreateVaultIntent(draftValidated.value);
  const validated = validateCreateVaultIntent(intent, input.nowMs);
  if (validated.ok === false) {
    throw new LiveStreakConfigError({
      message: validated.issues.join("; "),
      metadata: { details: JSON.stringify(validated.issues) }
    });
  }

  const idempotencyKey = idempotencyKeyFromDraft(draftValidated.value);
  const idempotencyStore = input.idempotencyStore ?? createIdempotencyStore();
  const { result, idempotent } = await idempotencyStore.run(idempotencyKey, () =>
    input.chain.writer.createVault(validated.value)
  );

  return {
    action: "created",
    draft,
    detection,
    intent: validated.value,
    result,
    idempotent,
    idempotencyKey
  };
};
