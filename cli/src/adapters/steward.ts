// Steward resolution edge. The keynote loop SETTLES only once a steward resolves a vault, and the
// CLI's steward identity is the operator/dev key. Resolution lands on the steward registry's
// `resolveVault(vaultId, outcome)` — there is no options/steward *bridge* action for it today (the
// options bridge only carries post-resolution settlement: withdraw / claimLossLvst), so the CLI
// drives it through the operator AA wallet, mirroring the existing goLive/setEnded edge in
// adapters/onchain.ts. Dispatch is per-chain (EVM today; Sui pending the CLI Sui operator leg — see
// scope-e2e-agent.md §A/§F). Outcome encoding matches the on-chain `Vault.Outcome` enum on BOTH
// chains: { Pending: 0, Yes: 1, No: 2 } (EVM Vault.sol) === { OUTCOME_YES: 1, OUTCOME_NO: 2 } (Sui).

import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";
import { pollUntilUserOperationIncluded, type WalletAccountEvmErc4337 } from "@livestreak/wallet";
import { encodeFunctionData } from "viem";

export type VaultOutcome = "yes" | "no";

/** On-chain `Vault.Outcome` enum values (shared EVM + Sui). */
export const OUTCOME_SOLIDITY = { pending: 0, yes: 1, no: 2 } as const;

/** Parse a `<outcome>` CLI argument into the canonical winning side. */
export const parseOutcomeArg = (value: string): VaultOutcome => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "no") {
    return normalized;
  }
  throw new Error(`outcome must be "yes" or "no", got "${value}"`);
};

/** Map a winning side to its `Vault.Outcome` enum value (yes -> 1, no -> 2). */
export const outcomeToSolidityValue = (outcome: VaultOutcome): number =>
  outcome === "yes" ? OUTCOME_SOLIDITY.yes : OUTCOME_SOLIDITY.no;

/** ABI-encode the steward registry `resolveVault(bytes32 vaultId, Vault.Outcome outcome)` call. */
export const encodeResolveVaultCall = (
  vaultId: `0x${string}`,
  outcome: VaultOutcome
): `0x${string}` =>
  encodeFunctionData({
    abi: stewardRegistryAbi,
    functionName: "resolveVault",
    args: [vaultId, outcomeToSolidityValue(outcome)]
  });

export interface ResolveVaultEvmInput {
  /** Operator/dev AA wallet — the steward identity on EVM. */
  readonly account: WalletAccountEvmErc4337;
  /** Steward registry contract address (from livestreak.json options.stewardRegistry). */
  readonly stewardRegistry: `0x${string}`;
  readonly vaultId: `0x${string}`;
  readonly outcome: VaultOutcome;
}

/**
 * Resolve a vault on EVM by sending `resolveVault` to the steward registry via the operator AA
 * wallet, then waiting for the userOp to land. Returns the userOp hash.
 */
export const resolveVaultEvm = async (input: ResolveVaultEvmInput): Promise<string> => {
  const data = encodeResolveVaultCall(input.vaultId, input.outcome);

  const sendResult = await input.account.sendTransaction({
    to: input.stewardRegistry,
    data,
    value: 0n
  });

  const readOnly = await input.account.toReadOnlyAccount();
  await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
  return sendResult.hash;
};
