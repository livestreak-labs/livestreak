import { createWalletManager } from "@livestreak/wallet";
import { encodeSuiPrivateKey } from "@mysten/sui/cryptography";
import type { HostServerConfig } from "../descriptor/config.js";

// --- exports ---

export const resolveMemoryOwnerSuiPrivateKey = async (
  config: Pick<HostServerConfig, "memorySuiOwnerPrivateKey" | "memoryOwnerSeed">,
  suiRpcUrl: string
): Promise<string | null> => {
  if (config.memorySuiOwnerPrivateKey !== null) {
    return config.memorySuiOwnerPrivateKey;
  }

  if (config.memoryOwnerSeed === null) {
    return null;
  }

  const manager = createWalletManager("sui", config.memoryOwnerSeed, {
    rpcUrl: suiRpcUrl
  });
  const account = await manager.getAccount(0);
  const privateKey = account.keyPair.privateKey;

  if (privateKey === null) {
    throw new Error("memory_owner_key_unavailable");
  }

  return encodeSuiPrivateKey(privateKey, "ED25519");
};
