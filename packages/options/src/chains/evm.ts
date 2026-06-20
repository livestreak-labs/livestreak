// --- exports ---

import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";
import { createPublicClient, encodeFunctionData, http, type Abi } from "viem";

import type { OptionsChain, OptionsChainConfig, OptionsChainReader, OptionsChainWriter } from "./types.js";

export const createEvmOptionsChain = (config: OptionsChainConfig): OptionsChain => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM options chain requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const rpcUrl = config.readRpcUrl ?? String(evmConfig.provider);

  const publicClient = createPublicClient({
    transport: http(rpcUrl)
  });

  const reader: OptionsChainReader = {
    read: async (request) =>
      publicClient.readContract({
        address: request.address,
        abi: request.abi as Abi,
        functionName: request.functionName,
        args: request.args as readonly unknown[] | undefined
      })
  };

  const writer: OptionsChainWriter = {
    write: async (request) => {
      const manager = createWalletManager("evm", config.seed, evmConfig);
      const account = await manager.getAccount();
      const data = encodeFunctionData({
        abi: request.abi as Abi,
        functionName: request.functionName,
        args: request.args as readonly unknown[] | undefined
      });

      let sendResult: { hash: string };
      try {
        sendResult = await account.sendTransaction({
          to: request.address,
          data,
          value: 0n
        });
      } catch (error) {
        throw classifySendFailure(error);
      }

      const readOnly = await account.toReadOnlyAccount();
      await pollUntilUserOperationIncluded(readOnly, sendResult.hash);
      return sendResult.hash;
    }
  };

  return { reader, writer };
};

// --- helpers ---

const pollUntilUserOperationIncluded = async (
  readOnly: { getUserOperationReceipt: (hash: string) => Promise<unknown> },
  userOpHash: string,
  maxAttempts = 40,
  delayMs = 50
): Promise<void> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await readOnly.getUserOperationReceipt(userOpHash);

    if (receipt !== null && receipt !== undefined) {
      assertUserOperationSucceeded(receipt);
      return;
    }

    await sleep(delayMs);
  }

  throw receiptFailure(`Timed out waiting for UserOperation receipt for ${userOpHash}`);
};

const assertUserOperationSucceeded = (receipt: unknown): void => {
  if (!isRecord(receipt)) {
    throw receiptFailure("UserOperation receipt payload is not an object");
  }

  const success = readUserOperationSuccess(receipt);
  if (success === undefined) {
    throw receiptFailure("UserOperation receipt is missing success");
  }

  if (success === false) {
    throw receiptFailure("UserOperation included but reverted");
  }
};

const readUserOperationSuccess = (receipt: Record<string, unknown>): boolean | undefined => {
  const direct = receipt["success"];
  if (typeof direct === "boolean") {
    return direct;
  }

  return undefined;
};

const receiptFailure = (message: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message
  });

const classifySendFailure = (error: unknown): LiveStreakRuntimeError => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("paymaster") ||
    lower.includes("sponsor") ||
    lower.includes("validuntil") ||
    lower.includes("validafter")
  ) {
    return new LiveStreakRuntimeError({
      message: `Paymaster-side write failure: ${message}`
    });
  }

  return new LiveStreakRuntimeError({
    message: `UserOperation send failed: ${message}`
  });
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
