import { addDelegateKey, createAccount } from "@mysten-incubation/memwal/account";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { RelayerDeploymentConfig } from "./relayer-config.js";

// --- exports ---

export interface MemWalGrantDelegateInput {
  readonly suiPrivateKey: string;
  readonly accountId: string;
  readonly delegatePublicKeyHex: string;
  readonly label: string;
  readonly deployment: RelayerDeploymentConfig;
}

export interface MemWalGrantDelegateResult {
  readonly suiAddress: string;
  readonly digest: string;
}

export interface MemWalAccountOperations {
  readonly createHostAccount: (input: {
    readonly suiPrivateKey: string;
    readonly deployment: RelayerDeploymentConfig;
    readonly registryId: string;
  }) => Promise<{ readonly accountId: string }>;
  readonly grantDelegate: (input: MemWalGrantDelegateInput) => Promise<MemWalGrantDelegateResult>;
}

export const createMemWalAccountOperations = (): MemWalAccountOperations => ({
  async createHostAccount({ suiPrivateKey, deployment, registryId }) {
    const suiClient = new SuiJsonRpcClient({
      url: deployment.suiRpcUrl,
      network: deployment.network
    });
    const result = await createAccount({
      packageId: deployment.packageId,
      registryId,
      suiPrivateKey,
      suiClient,
      suiNetwork: deployment.network
    });

    if (result.accountId.length === 0) {
      throw new Error("MemWal createAccount returned an empty accountId");
    }

    return { accountId: result.accountId };
  },

  async grantDelegate({ suiPrivateKey, accountId, delegatePublicKeyHex, label, deployment }) {
    const suiClient = new SuiJsonRpcClient({
      url: deployment.suiRpcUrl,
      network: deployment.network
    });
    const result = await addDelegateKey({
      packageId: deployment.packageId,
      accountId,
      publicKey: normalizePublicKeyHex(delegatePublicKeyHex),
      label,
      suiPrivateKey,
      suiClient,
      suiNetwork: deployment.network
    });

    return {
      suiAddress: result.suiAddress,
      digest: result.digest
    };
  }
});

// --- helpers ---

const normalizePublicKeyHex = (value: string): string => value.replace(/^0x/iu, "");
