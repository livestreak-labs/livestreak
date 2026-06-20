// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { TxId } from "../chains/types.js";
import { authorizeBridgeCaller } from "./scope.js";
import type {
  BookmakerBridge,
  BridgeCaller,
  CallActionEnvelope,
  CreateBookmakerBridgeInput
} from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export type {
  BookmakerBridge,
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateBookmakerBridgeInput
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";

export const createBookmakerBridge = (input: CreateBookmakerBridgeInput): BookmakerBridge => {
  const { runtime } = input;

  return {
    runtime,

    readBoard: async (caller) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope, runtime.readSnapshot().updatedAtMs);
      return runtime.readPanel();
    },

    readControls: async (caller) => {
      authorizeBridgeCaller(caller, bridgeControlsReadScope, runtime.readSnapshot().updatedAtMs);
      const panel = runtime.readPanel();
      return {
        runtimeId: panel.runtimeId,
        marketContext: panel.marketContext,
        ...(panel.watchSource === undefined ? {} : { watchSource: panel.watchSource }),
        ...(panel.latestDetection === undefined ? {} : { latestDetection: panel.latestDetection }),
        ...(panel.currentDraft === undefined ? {} : { currentDraft: panel.currentDraft }),
        ...(panel.lastDecision === undefined ? {} : { lastDecision: panel.lastDecision }),
        pendingWriteIntents: panel.writeIntents,
        completedVaultCreations: panel.completedVaultCreations,
        ...(panel.lastError === undefined ? {} : { lastError: panel.lastError }),
        updatedAtMs: panel.updatedAtMs
      };
    },

    callAction: async (caller, envelope) => {
      authorizeBridgeCaller(caller, bridgeActionScope, runtime.readSnapshot().updatedAtMs);

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Bookmaker bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope }
        });
      }

      return dispatchWriterAction(runtime, envelope.action, envelope.args);
    },

    subscribeBoard: (caller, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope, runtime.readSnapshot().updatedAtMs);
      return runtime.subscribeSnapshots(() => {
        listener(runtime.readPanel());
      });
    }
  };
};

// --- helpers ---

const dispatchWriterAction = async (
  runtime: CreateBookmakerBridgeInput["runtime"],
  action: string,
  args: unknown
): Promise<TxId> => {
  if (action !== "createVault") {
    throw new LiveStreakConfigError({
      message: `Unsupported bookmaker bridge action: ${action}`,
      metadata: { details: action }
    });
  }

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new LiveStreakConfigError({
      message: "createVault bridge action requires object args",
      metadata: { details: String(args) }
    });
  }

  const input = args as Record<string, unknown>;
  const result = await runtime.chain.writer.createVault({
    marketId: String(input.marketId),
    question: String(input.question),
    creatorSide: input.creatorSide === "no" ? "no" : "yes",
    creatorStake: input.creatorStake as bigint,
    seedRate: input.seedRate as bigint
  });

  return result.txId;
};
