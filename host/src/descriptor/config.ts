import type {
  HostModuleToken,
  HostProviderDescriptor,
  MemoryNetwork,
  MemoryTrustModel
} from "@livestreak/host";
import type { OutputMode } from "@livestreak/schema";
import {
  bootstrapMemoryNetwork,
  memoryNetworkProfiles,
  parseMemoryNetwork,
  profileRelayerUrl,
  type ResolvedMemoryNetwork
} from "../memory/network-profile.js";

// --- exports ---

export interface HostServerConfig {
  readonly hostId: string;
  readonly baseUrl: string;
  readonly bindHost: string;
  readonly bindPort: number;
  readonly startedAtMs: number;
  readonly accountTier: string;
  readonly termsVersion?: string;
  readonly enabledModules: readonly HostModuleToken[];
  readonly supportedOutputs: readonly OutputMode[];
  readonly cacheQuotaBytes: number;
  readonly cacheRetentionDays: number;
  readonly cacheReceipts: "none" | "optional" | "required";
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
  readonly memoryNetwork: MemoryNetwork | null;
  readonly memoryRelayerUrlOverride: string | null;
  readonly memoryRegistryIdOverride: string | null;
  readonly memorySuiOwnerPrivateKey: string | null;
  readonly memoryOwnerSeed: string | null;
  readonly memoryTrustModel: MemoryTrustModel;
  readonly resolvedMemoryNetwork: ResolvedMemoryNetwork | null;
  readonly livekitApiKey: string | undefined;
}

export const isMemoryHostConfigured = (config: HostServerConfig): boolean =>
  config.memoryNetwork !== null &&
  (config.memorySuiOwnerPrivateKey !== null || config.memoryOwnerSeed !== null);

export const isMemoryBootstrapped = (config: HostServerConfig): boolean =>
  isMemoryHostConfigured(config) && config.resolvedMemoryNetwork !== null;

const allModules: readonly HostModuleToken[] = [
  "aa",
  "media",
  "memory",
  "discovery",
  "runtime",
  "tenancy"
];

export const defaultHostServerConfig = (): HostServerConfig => ({
  hostId: process.env.LIVESTREAK_HOST_ID ?? "host_dev",
  baseUrl: process.env.LIVESTREAK_HOST_BASE_URL ?? "http://127.0.0.1:8787",
  bindHost: process.env.LIVESTREAK_HOST_BIND_HOST ?? "127.0.0.1",
  bindPort: Number.parseInt(process.env.LIVESTREAK_HOST_BIND_PORT ?? "8787", 10),
  startedAtMs: Date.now(),
  accountTier: "dev",
  termsVersion: "dev-terms",
  enabledModules: [...allModules],
  supportedOutputs: ["file", "local", "simulcast"],
  cacheQuotaBytes: 1024 * 1024 * 1024,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 6 * 60 * 60,
  memoryNetwork: parseMemoryNetwork(readOptionalEnv("LIVESTREAK_MEMORY_NETWORK")),
  memoryRelayerUrlOverride: readOptionalEnv("LIVESTREAK_MEMORY_RELAYER_URL_OVERRIDE"),
  memoryRegistryIdOverride: readOptionalEnv("LIVESTREAK_MEMORY_REGISTRY_ID_OVERRIDE"),
  memorySuiOwnerPrivateKey:
    readOptionalEnv("LIVESTREAK_MEMORY_OWNER_KEY") ??
    readOptionalEnv("LIVESTREAK_MEMORY_SUI_OWNER_KEY"),
  memoryOwnerSeed: readOptionalEnv("LIVESTREAK_MEMORY_OWNER_SEED"),
  memoryTrustModel: "plaintext-relayer",
  resolvedMemoryNetwork: null,
  livekitApiKey: process.env.LIVEKIT_API_KEY
});

export const toHostProviderDescriptor = (config: HostServerConfig): HostProviderDescriptor => {
  const simulcastAvailable = config.livekitApiKey !== undefined && config.livekitApiKey.length > 0;
  const advertisedOutputs = config.supportedOutputs.filter(
    (mode) => mode !== "simulcast" || simulcastAvailable
  );

  const relayerUrl = profileRelayerUrl(config);

  return {
    version: "0.1.0",
    hostId: config.hostId,
    baseUrl: config.baseUrl,
    modules: [...config.enabledModules],
    supportedOutputs: [...advertisedOutputs],
    media: { simulcastAvailable },
    memory: {
      relayerUrl,
      namespaceTemplate: "market:{marketId}",
      trustModel: config.memoryTrustModel,
      network: config.memoryNetwork
    },
    termsVersion: config.termsVersion
  };
};

export const isModuleEnabled = (
  config: HostServerConfig,
  token: HostModuleToken
): boolean => config.enabledModules.includes(token);

export const bootstrapHostServerConfig = async (
  config: HostServerConfig = defaultHostServerConfig(),
  fetchImpl: typeof fetch = fetch
): Promise<HostServerConfig> => bootstrapMemoryNetwork(config, fetchImpl);

// --- helpers ---

const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? null : value;
};

export const memoryProfileFor = (network: MemoryNetwork) => memoryNetworkProfiles[network];
