import type { HostModuleToken, HostProviderDescriptor, MemoryTrustModel } from "@livestreak/host";
import type { OutputMode, SuiWalletInitConfig } from "@livestreak/schema";

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
  readonly memoryRelayerUrl: string | null;
  readonly memoryRegistryId: string | null;
  readonly memorySuiOwnerPrivateKey: string | null;
  readonly memoryOwnerSeed: string | null;
  readonly memorySuiWallet: SuiWalletInitConfig | null;
  readonly memoryTrustModel: MemoryTrustModel;
  readonly livekitApiKey: string | undefined;
}

const defaultMemoryRelayerUrl = "https://relayer.memory.walrus.xyz";

export const isMemoryHostConfigured = (config: HostServerConfig): boolean =>
  config.memoryRelayerUrl !== null &&
  config.memoryRegistryId !== null &&
  (config.memorySuiOwnerPrivateKey !== null ||
    (config.memoryOwnerSeed !== null && config.memorySuiWallet !== null));

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
  memoryRelayerUrl: readOptionalEnv("LIVESTREAK_MEMORY_RELAYER_URL") ?? defaultMemoryRelayerUrl,
  memoryRegistryId: readOptionalEnv("LIVESTREAK_MEMORY_REGISTRY_ID"),
  memorySuiOwnerPrivateKey: readOptionalEnv("LIVESTREAK_MEMORY_SUI_OWNER_KEY"),
  memoryOwnerSeed: readOptionalEnv("LIVESTREAK_MEMORY_OWNER_SEED"),
  memorySuiWallet: readMemorySuiWallet(),
  memoryTrustModel: "plaintext-relayer",
  livekitApiKey: process.env.LIVEKIT_API_KEY
});

export const toHostProviderDescriptor = (config: HostServerConfig): HostProviderDescriptor => {
  const simulcastAvailable = config.livekitApiKey !== undefined && config.livekitApiKey.length > 0;
  const advertisedOutputs = config.supportedOutputs.filter(
    (mode) => mode !== "simulcast" || simulcastAvailable
  );

  return {
    version: "0.1.0",
    hostId: config.hostId,
    baseUrl: config.baseUrl,
    modules: [...config.enabledModules],
    supportedOutputs: [...advertisedOutputs],
    media: { simulcastAvailable },
    memory: {
      relayerUrl: config.memoryRelayerUrl,
      namespaceTemplate: "market:{marketId}",
      trustModel: config.memoryTrustModel
    },
    termsVersion: config.termsVersion
  };
};

export const isModuleEnabled = (
  config: HostServerConfig,
  token: HostModuleToken
): boolean => config.enabledModules.includes(token);

// --- helpers ---

const readOptionalEnv = (key: string): string | null => {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? null : value;
};

const readMemorySuiWallet = (): SuiWalletInitConfig | null => {
  const rpcUrl = readOptionalEnv("LIVESTREAK_MEMORY_SUI_RPC_URL");
  if (rpcUrl === null) {
    return null;
  }

  const retriesRaw = process.env.LIVESTREAK_MEMORY_SUI_RPC_RETRIES;
  const retries =
    retriesRaw === undefined || retriesRaw.length === 0
      ? undefined
      : Number.parseInt(retriesRaw, 10);

  return {
    rpcUrl,
    ...(retries === undefined || Number.isNaN(retries) ? {} : { retries })
  };
};
