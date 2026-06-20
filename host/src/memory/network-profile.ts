import type { MemoryNetwork } from "@livestreak/host";
import type { HostServerConfig } from "../descriptor/config.js";

// --- exports ---

export type { MemoryNetwork };

export interface MemoryNetworkProfile {
  readonly network: MemoryNetwork;
  readonly relayerUrl: string;
  readonly registryId: string;
}

export interface ResolvedMemoryNetwork {
  readonly network: MemoryNetwork;
  readonly relayerUrl: string;
  readonly registryId: string;
  readonly packageId: string;
  readonly suiRpcUrl: string;
}

export interface RelayerConfigResponse {
  readonly packageId: string;
  readonly network: MemoryNetwork;
  readonly suiRpcUrl: string;
  readonly registryId?: string;
}

export class MemoryNetworkMismatchError extends Error {
  readonly code = "memory_network_mismatch" as const;

  constructor(
    readonly selectedNetwork: MemoryNetwork,
    readonly relayerNetwork: MemoryNetwork,
    readonly relayerUrl: string
  ) {
    super(
      `memory_network_mismatch: selector=${selectedNetwork} relayer=${relayerNetwork} url=${relayerUrl}`
    );
    this.name = "MemoryNetworkMismatchError";
  }
}

export const memoryNetworkProfiles: Readonly<Record<MemoryNetwork, MemoryNetworkProfile>> = {
  mainnet: {
    network: "mainnet",
    relayerUrl: "https://relayer.memory.walrus.xyz",
    registryId: "0x0da982cefa26864ae834a8a0504b904233d49e20fcc17c373c8bed99c75a7edd"
  },
  testnet: {
    network: "testnet",
    relayerUrl: "https://relayer-staging.memory.walrus.xyz",
    registryId: "0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437"
  }
};

export const parseMemoryNetwork = (value: string | null): MemoryNetwork | null => {
  if (value === "mainnet" || value === "testnet") {
    return value;
  }

  return null;
};

export const profileRelayerUrl = (config: HostServerConfig): string | null => {
  if (config.memoryNetwork === null) {
    return null;
  }

  const profile = memoryNetworkProfiles[config.memoryNetwork];
  return config.memoryRelayerUrlOverride ?? profile.relayerUrl;
};

export const fetchRelayerConfig = async (
  relayerUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<RelayerConfigResponse> => {
  const base = relayerUrl.replace(/\/$/u, "");
  const response = await fetchImpl(`${base}/config`);

  if (!response.ok) {
    throw new Error(`MemWal relayer config fetch failed (${response.status})`);
  }

  const body = (await response.json()) as {
    packageId?: string;
    network?: string;
    suiRpcUrl?: string;
    registryId?: string;
  };

  if (
    body.packageId === undefined ||
    body.network === undefined ||
    body.suiRpcUrl === undefined
  ) {
    throw new Error("MemWal relayer /config missing packageId, network, or suiRpcUrl");
  }

  if (body.network !== "testnet" && body.network !== "mainnet") {
    throw new Error(`Unsupported MemWal relayer network: ${body.network}`);
  }

  return {
    packageId: body.packageId,
    network: body.network,
    suiRpcUrl: body.suiRpcUrl,
    ...(body.registryId === undefined ? {} : { registryId: body.registryId })
  };
};

export const resolveMemoryNetwork = async (
  config: HostServerConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedMemoryNetwork> => {
  if (config.memoryNetwork === null) {
    throw new Error("memory_network_not_selected");
  }

  const profile = memoryNetworkProfiles[config.memoryNetwork];
  const relayerUrl = config.memoryRelayerUrlOverride ?? profile.relayerUrl;
  const relayerConfig = await fetchRelayerConfig(relayerUrl, fetchImpl);

  if (relayerConfig.network !== config.memoryNetwork) {
    throw new MemoryNetworkMismatchError(
      config.memoryNetwork,
      relayerConfig.network,
      relayerUrl
    );
  }

  const registryId =
    config.memoryRegistryIdOverride ??
    relayerConfig.registryId ??
    profile.registryId;

  return {
    network: config.memoryNetwork,
    relayerUrl,
    registryId,
    packageId: relayerConfig.packageId,
    suiRpcUrl: relayerConfig.suiRpcUrl
  };
};

export const bootstrapMemoryNetwork = async (
  config: HostServerConfig,
  fetchImpl: typeof fetch = fetch
): Promise<HostServerConfig> => {
  if (config.memoryNetwork === null) {
    return { ...config, resolvedMemoryNetwork: null };
  }

  const resolved = await resolveMemoryNetwork(config, fetchImpl);
  return { ...config, resolvedMemoryNetwork: resolved };
};
