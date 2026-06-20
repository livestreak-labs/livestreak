import { describe, expect, it, vi } from "vitest";
import { createMemoryBindingStore } from "#memory/binding-store.js";
import type { MemWalAccountOperations } from "#memory/memwal-ops.js";
import type { HostServerConfig } from "#descriptor/config.js";

const memoryConfig = (): HostServerConfig => ({
  hostId: "host_dev",
  baseUrl: "http://127.0.0.1:8787",
  bindHost: "127.0.0.1",
  bindPort: 8787,
  startedAtMs: 0,
  accountTier: "dev",
  enabledModules: ["memory"],
  supportedOutputs: ["local"],
  cacheQuotaBytes: 1_000,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 3600,
  memoryRelayerUrl: "https://relayer.memwal.ai",
  memoryRegistryId: "0xregistry",
  memorySuiOwnerPrivateKey: "suiprivkey1qqtest",
  memoryOwnerSeed: null,
  memorySuiWallet: null,
  memoryTrustModel: "plaintext-relayer",
  livekitApiKey: undefined
});

const createMockOps = (): MemWalAccountOperations => {
  let hostAccountId: string | null = null;

  return {
    createHostAccount: vi.fn(async () => {
      if (hostAccountId === null) {
        hostAccountId = "0xaccount_host";
      }

      return { accountId: hostAccountId };
    }),
    grantDelegate: vi.fn(async ({ delegatePublicKeyHex }) => ({
      suiAddress: `0x${delegatePublicKeyHex.slice(0, 8)}`,
      digest: "digest_test"
    }))
  };
};

const testDeployment = {
  packageId: "0xpackage",
  network: "mainnet" as const,
  suiRpcUrl: "https://fullnode.mainnet.sui.io:443"
};

describe("memory binding store", () => {
  it("provisions a market binding once and reuses the host account id", async () => {
    const ops = createMockOps();
    const store = createMemoryBindingStore({
      config: memoryConfig(),
      ops,
      deployment: testDeployment
    });

    const first = await store.provision("mkt_a");
    const second = await store.provision("mkt_a");

    expect(first.memWalAccountId).toBe("0xaccount_host");
    expect(second).toEqual(first);
    expect(ops.createHostAccount).toHaveBeenCalledTimes(1);
  });

  it("grants a delegate and tracks authorization", async () => {
    const ops = createMockOps();
    const store = createMemoryBindingStore({
      config: memoryConfig(),
      ops,
      deployment: testDeployment
    });
    const delegate = "a".repeat(64);

    await store.grantDelegate("mkt_a", delegate);

    const binding = await store.provision("mkt_a");
    expect(store.hasDelegate(binding.memWalAccountId, delegate)).toBe(true);
    expect(ops.grantDelegate).toHaveBeenCalledTimes(1);

    await store.grantDelegate("mkt_a", delegate);
    expect(ops.grantDelegate).toHaveBeenCalledTimes(1);
  });

  it("does not mark an unknown delegate as granted", async () => {
    const store = createMemoryBindingStore({
      config: memoryConfig(),
      ops: createMockOps(),
      deployment: testDeployment
    });
    const binding = await store.provision("mkt_a");

    expect(store.hasDelegate(binding.memWalAccountId, "b".repeat(64))).toBe(false);
  });
});
