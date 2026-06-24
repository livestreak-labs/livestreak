import {
  bridgeActionScope,
  createActionPlanSink,
  createStewardBridge,
  createStewardContractExecutor,
  createStewardRuntime,
  createStewardRuntimeBootstrap,
  projectStewardDescriptors,
  stewardChainConfigFromPackageInit,
  type BridgeCaller,
  type CallActionEnvelope
} from "@livestreak/steward";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import type { ConsoleEdge } from "../gateway/console/edge.js";

const noopFacts = async () => [] as readonly unknown[];
const noopMemorySink = { remember: () => {} };

export interface CreateStewardConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
}

export const createStewardConsoleEdge = (input: CreateStewardConsoleEdgeInput): ConsoleEdge => {
  const runtimeConfig = createStewardRuntimeBootstrap(input.packageInit, {
    runtimeId: "cli-steward-remote",
    stewardId: input.packageInit.wallet.operatorAddress
  }).runtimeConfig;

  // Real on-chain executor (EVM Safe userOp / Sui PTB resolve_vault), chain-dispatched from the
  // session wallet — replaces the old noop action sink so the steward console actually resolves.
  const executor = createStewardContractExecutor(stewardChainConfigFromPackageInit(input.packageInit));
  const actionPlanSink = createActionPlanSink({
    contract: executor,
    host: { runHostAction: () => {} }
  });

  const runtime = createStewardRuntime({
    config: runtimeConfig,
    contractFactSource: { readFacts: noopFacts },
    hostFactSource: { readFacts: noopFacts },
    observeFactSource: { readFacts: noopFacts },
    memoryFactSource: { readFacts: noopFacts },
    memorySink: noopMemorySink,
    actionPlanSink
  });
  const bridge = createStewardBridge({ runtime });

  return {
    package: "steward",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      const snapshot = runtime.readSnapshot();
      return projectStewardDescriptors(snapshot);
    },

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const bridgeEnvelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      };
      const txId = await bridge.callAction(remoteCaller, bridgeEnvelope);
      return { txId: String(txId) };
    },

    subscribeBoard: (listener) =>
      bridge.subscribeBoard({ id: "remote-console", trusted: true }, (board) => {
        listener(board);
      }),

    readBoard: async () => bridge.readBoard({ id: "remote-console", trusted: true })
  };
};
