// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
// Multichain-hygiene: build + send Solana txns VIA @livestreak/wallet (the single @solana/* owner).
import {
  address,
  buildLivestreakTransaction,
  buildResolveIx,
  createSolanaRpc,
  createWalletManager,
  findMarketStewardPda,
  type Address,
  type Instruction,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";

import type { StewardContractCall } from "../model/action-plan.js";
import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { validateStewardSolanaAddresses, type StewardChainConfig } from "./types.js";

// The steward domain outcome enum (YES = 1, NO = 2) maps onto the engine's side enum
// (SIDE_YES = 0, SIDE_NO = 1) — a simple `outcome - 1`, validated so a bad outcome aborts
// at the boundary instead of tripping the on-chain `valid_side` guard.
const outcomeToWinningSide = (outcome: number): number => {
  if (outcome !== 1 && outcome !== 2) {
    throw new LiveStreakConfigError({
      message: `Steward Solana resolve requires outcome YES(1) or NO(2)`,
      metadata: { details: String(outcome) }
    });
  }
  return outcome - 1;
};

type SolanaAccount = {
  getAddress(): Promise<string>;
  sendTransaction(tx: ReturnType<typeof buildLivestreakTransaction>): Promise<{ hash: string }>;
};

export const createSolanaStewardExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana steward executor requires walletInit.chain === solana"
    });
  }
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const addresses = validateStewardSolanaAddresses(config.addresses);
  const programId = address(addresses.programId);

  // The RPC target the wallet itself uses — reused only to check the per-market steward override
  // PDA's existence before resolving (the builder needs to know whether to pass an override).
  const rpcTarget = pickRpcTarget(solanaConfig);
  const rpc = rpcTarget === undefined ? undefined : createSolanaRpc(rpcTarget);

  // OPT.rederive: derive the wallet account ONCE per executor (deterministic), reuse across calls.
  let accountPromise: Promise<SolanaAccount> | undefined;
  const getAccount = () =>
    (accountPromise ??= createWalletManager("solana", config.seed, solanaConfig).getAccount() as Promise<SolanaAccount>);

  return {
    chain: "solana",
    executeContractCall: async (call: StewardContractCall): Promise<{ readonly txId: string }> => {
      // Only `resolve` has an on-chain Solana target. `triggerHot` has no counterpart — the program
      // has no hot-governance instruction — so it is surfaced clearly rather than silently no-op'd,
      // mirroring the Sui/EVM taxonomy for kinds without a settled target.
      if (!(call.contract === "vault" && call.functionName === "resolve")) {
        throw new LiveStreakConfigError({
          message: `Steward Solana executor does not support ${call.contract}.${call.functionName} yet`
        });
      }

      const [vaultId, outcome] = call.args;
      const account = await getAccount();
      const steward = address(await account.getAddress());
      const marketSteward = await resolveMarketStewardOverride(rpc, programId, addresses.marketId);

      const ix: Instruction = await buildResolveIx({
        programId,
        marketId: addresses.marketId,
        steward,
        vaultId,
        winningSide: outcomeToWinningSide(outcome),
        ...(marketSteward === undefined ? {} : { marketSteward })
      });

      try {
        const { hash } = await account.sendTransaction(buildLivestreakTransaction([ix]));
        return { txId: hash };
      } catch (error) {
        throw new LiveStreakRuntimeError({
          message: `Steward Solana ${call.functionName} failed: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
  };
};

// --- helpers ---

// The vendored account reads its RPC from `provider` (preferred) or the `rpcUrl` alias; either may
// be a failover list — the first entry is enough for a read.
const pickRpcTarget = (config: LiveStreakSolanaWalletConfig): string | undefined => {
  const raw = (config as { provider?: string | string[]; rpcUrl?: string | string[] });
  const target = raw.provider ?? raw.rpcUrl;
  return Array.isArray(target) ? target[0] : target;
};

// Anchor's optional-account convention: pass the override PDA only when it EXISTS on-chain,
// otherwise omit it (the builder fills the slot with the program id = `None`, and the program
// falls back to the registry default steward). Absent an RPC we cannot check — omit and let the
// on-chain steward-equality guard be the backstop.
const resolveMarketStewardOverride = async (
  rpc: ReturnType<typeof createSolanaRpc> | undefined,
  programId: Address,
  marketId: string
): Promise<Address | undefined> => {
  if (!rpc) return undefined;
  const [pda] = await findMarketStewardPda(programId, marketId);
  const { value } = await rpc.getAccountInfo(pda, { encoding: "base64" }).send();
  return value === null ? undefined : pda;
};
