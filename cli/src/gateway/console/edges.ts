// Gateway composition root: builds every package edge over one settings/wallet/runId context and
// cross-wires package surfaces (observe board + options vault reads feed steward's fact ports).

import { Effect } from "effect";
import { openObserveConsoleRuntime, type ObserveRuntime } from "@livestreak/observe";
import { asUserAddress, asVaultId, createOptionsChain, optionsChainConfigFromPackageInit } from "@livestreak/options";
import type { ContractVaultReader, ObserveBoardReader } from "@livestreak/steward";
import type { SessionWallet, SettingsDoc } from "@livestreak/schema";
import { createBookmakerEdge } from "../../adapters/bookmaker-edge.js";
import { createObserveConsoleEdge } from "../../adapters/observe-edge.js";
import { createStewardConsoleEdge } from "../../adapters/steward-edge.js";
import { createOptionsConsoleEdge } from "../../adapters/options-edge.js";
import { chainSettingsFor } from "../../prefs/settings.js";
import {
  loadIdempotencyPersistencePort,
  loadObserveBoardsPort,
  loadPausedLanesPort
} from "../state/runtime-persistence.js";
import { buildPackageInits } from "./init.js";
import type { ConsoleEdge } from "./edge.js";

export const createConsoleEdges = async (input: {
  readonly settings: SettingsDoc;
  readonly sessionWallet: SessionWallet;
  readonly runId: string;
}): Promise<ConsoleEdge[]> => {
  const inits = buildPackageInits(input.settings, input.sessionWallet, input.runId);
  const rpc = chainSettingsFor(input.settings).rpc;
  const userAddress = asUserAddress(input.sessionWallet.operatorAddress as `0x${string}`);
  const usdc = (inits.bookmaker.contracts.usdc ?? "") as `0x${string}`;

  // File-backed runtime state (survives a gateway restart): pending-userOp recovery, paused lanes,
  // and the observe console board (configured cells restore; active run status resets honestly).
  const [pausedLanes, idempotencyPersistence, observeBoards] = await Promise.all([
    loadPausedLanesPort(),
    loadIdempotencyPersistencePort(),
    loadObserveBoardsPort()
  ]);

  const observeRuntime = (
    await Effect.runPromise(
      openObserveConsoleRuntime({
        sessionInit: inits.observe,
        runId: input.runId,
        boardPersistence: observeBoards
      })
    )
  ).runtime;

  return [
    createOptionsConsoleEdge({
      packageInit: inits.options,
      readRpcUrl: rpc,
      userAddress,
      pausedLanes
    }),
    createBookmakerEdge({
      packageInit: inits.bookmaker,
      readRpcUrl: rpc,
      userAddress: input.sessionWallet.operatorAddress,
      usdcAddress: usdc,
      idempotencyPersistence
    }),
    createObserveConsoleEdge({
      packageInit: inits.observe,
      runId: input.runId,
      runtime: observeRuntime,
      hostBaseUrl: input.settings.host.url
    }),
    createStewardConsoleEdge({
      packageInit: inits.steward,
      contractVaultReader: buildStewardVaultReader(inits.options, rpc),
      observeBoardReader: buildStewardBoardReader(observeRuntime, input.runId)
    })
  ];
};

// --- steward fact readers (gateway composition: packages own the reads, steward owns the facts) ---

const buildStewardBoardReader = (runtime: ObserveRuntime, runId: string): ObserveBoardReader => ({
  readBoard: async () => {
    try {
      return await Effect.runPromise(runtime.readBoard(runId));
    } catch {
      return null;
    }
  }
});

const buildStewardVaultReader = (
  optionsInit: Parameters<typeof optionsChainConfigFromPackageInit>[0],
  readRpcUrl: string
): ContractVaultReader => {
  const reader = createOptionsChain(
    optionsChainConfigFromPackageInit(optionsInit, { readRpcUrl })
  ).reader;
  return {
    chain: optionsInit.chain.startsWith("eip155") ? "evm" : "sui",
    readVaultFacts: async (subject) => {
      if (subject.vaultId === undefined) {
        return [];
      }
      const vault = await reader.readVault(asVaultId(subject.vaultId));
      return [
        { key: "vault.status", value: vault.status },
        { key: "vault.outcome", value: vault.outcome },
        { key: "vault.pools", value: vault.pools },
        { key: "vault.steward", value: vault.steward }
      ];
    }
  };
};
