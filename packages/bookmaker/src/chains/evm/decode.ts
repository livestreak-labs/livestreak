// --- exports ---

import { LiveStreakRuntimeError } from "@livestreak/core";
import { parseEventLogs, type Abi, type Log } from "viem";

import { vaultDriverAbi } from "@livestreak/contracts/evm/abis";

import { asVaultId, type VaultId } from "../types.js";

export const parseVaultCreatedFromLogs = (
  logs: readonly unknown[],
  vaultDriverAddress: `0x${string}`
): VaultId => {
  const driverLogs = (logs as Log[]).filter(
    (log) => log.address?.toLowerCase() === vaultDriverAddress.toLowerCase()
  );

  const decoded = parseEventLogs({
    abi: vaultDriverAbi as Abi,
    logs: driverLogs,
    eventName: "VaultCreated"
  });

  const event = decoded[0] as { readonly args: { readonly vaultId: string } } | undefined;
  if (event === undefined) {
    throw new LiveStreakRuntimeError({
      message: "VaultCreated event not found in transaction receipt logs"
    });
  }

  const vaultId = event.args.vaultId;

  return asVaultId(vaultId);
};
