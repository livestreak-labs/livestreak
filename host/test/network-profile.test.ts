import { describe, expect, it, vi } from "vitest";
import type { HostServerConfig } from "#descriptor/config.js";
import {
  MemoryNetworkMismatchError,
  memoryNetworkProfiles,
  resolveMemoryNetwork
} from "#memory/network-profile.js";

const baseConfig = (): HostServerConfig => ({
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
  memoryNetwork: "testnet",
  memoryRelayerUrlOverride: null,
  memoryRegistryIdOverride: null,
  memorySuiOwnerPrivateKey: "suiprivkey1qqtest",
  memoryOwnerSeed: null,
  memoryTrustModel: "plaintext-relayer",
  resolvedMemoryNetwork: null,
  livekitApiKey: undefined
});

const mockFetch = (network: "mainnet" | "testnet") =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      packageId: "0xpackage",
      network,
      suiRpcUrl:
        network === "mainnet"
          ? "https://fullnode.mainnet.sui.io:443"
          : "https://fullnode.testnet.sui.io:443"
    })
  })) as unknown as typeof fetch;

describe("resolveMemoryNetwork", () => {
  it("resolves when selector matches relayer /config network", async () => {
    const resolved = await resolveMemoryNetwork(baseConfig(), mockFetch("testnet"));

    expect(resolved).toEqual({
      network: "testnet",
      relayerUrl: memoryNetworkProfiles.testnet.relayerUrl,
      registryId: memoryNetworkProfiles.testnet.registryId,
      packageId: "0xpackage",
      suiRpcUrl: "https://fullnode.testnet.sui.io:443"
    });
  });

  it("throws memory_network_mismatch when selector disagrees with relayer /config", async () => {
    await expect(resolveMemoryNetwork(baseConfig(), mockFetch("mainnet"))).rejects.toBeInstanceOf(
      MemoryNetworkMismatchError
    );

    try {
      await resolveMemoryNetwork(baseConfig(), mockFetch("mainnet"));
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryNetworkMismatchError);
      if (error instanceof MemoryNetworkMismatchError) {
        expect(error.code).toBe("memory_network_mismatch");
        expect(error.selectedNetwork).toBe("testnet");
        expect(error.relayerNetwork).toBe("mainnet");
      }
    }
  });

  it("throws memory_network_mismatch for relayer-url override whose /config disagrees", async () => {
    const config = {
      ...baseConfig(),
      memoryRelayerUrlOverride: "https://override.example"
    };

    await expect(resolveMemoryNetwork(config, mockFetch("mainnet"))).rejects.toBeInstanceOf(
      MemoryNetworkMismatchError
    );
  });

  it("uses registryId from /config when present", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        packageId: "0xpackage",
        network: "testnet",
        suiRpcUrl: "https://fullnode.testnet.sui.io:443",
        registryId: "0xfromconfig"
      })
    })) as unknown as typeof fetch;

    const resolved = await resolveMemoryNetwork(baseConfig(), fetchImpl);
    expect(resolved.registryId).toBe("0xfromconfig");
  });
});
