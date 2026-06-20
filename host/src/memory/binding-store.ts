import type { MarketMemoryBinding } from "@livestreak/host";
import type { HostServerConfig } from "../descriptor/config.js";
import { isMemoryHostConfigured } from "../descriptor/config.js";
import type { MemWalAccountOperations } from "./memwal-ops.js";
import type { RelayerDeploymentConfig } from "./relayer-config.js";
import { fetchRelayerDeploymentConfig } from "./relayer-config.js";
import { resolveMemoryOwnerSuiPrivateKey } from "./owner-key.js";

// --- exports ---

export interface MemoryBindingStoreConfig {
  readonly config: HostServerConfig;
  readonly ops: MemWalAccountOperations;
  readonly deployment?: RelayerDeploymentConfig;
}

export interface MemoryBindingStore {
  readonly get: (marketId: string) => MarketMemoryBinding | undefined;
  readonly provision: (marketId: string) => Promise<MarketMemoryBinding>;
  readonly grantDelegate: (marketId: string, delegatePublicKeyHex: string) => Promise<void>;
  readonly hasDelegate: (accountId: string, delegatePublicKeyHex: string) => boolean;
}

export const createMemoryBindingStore = (
  storeConfig: MemoryBindingStoreConfig
): MemoryBindingStore => {
  const bindings = new Map<string, MarketMemoryBinding>();
  const delegatesByAccount = new Map<string, Set<string>>();
  let hostAccountId: string | null = null;
  let deploymentCache: RelayerDeploymentConfig | null = storeConfig.deployment ?? null;

  return {
    get(marketId) {
      return bindings.get(marketId);
    },

    async provision(marketId) {
      const existing = bindings.get(marketId);
      if (existing !== undefined) {
        return existing;
      }

      const accountId = await ensureHostAccountId(
        storeConfig,
        () => deploymentCache,
        (value) => {
          deploymentCache = value;
        },
        () => hostAccountId,
        (value) => {
          hostAccountId = value;
        }
      );

      const binding: MarketMemoryBinding = {
        marketId,
        memWalAccountId: accountId,
        namespace: `market:${marketId}`
      };
      bindings.set(marketId, binding);
      return binding;
    },

    async grantDelegate(marketId, delegatePublicKeyHex) {
      const binding = bindings.get(marketId) ?? (await this.provision(marketId));
      const normalized = normalizeHex(delegatePublicKeyHex);

      if (hasDelegate(delegatesByAccount, binding.memWalAccountId, normalized)) {
        return;
      }

      const ownerKey = await resolveOwnerKey(storeConfig.config);
      const deployment = await loadDeployment(
        storeConfig.config,
        () => deploymentCache,
        (value) => {
          deploymentCache = value;
        },
        storeConfig.deployment
      );

      await storeConfig.ops.grantDelegate({
        suiPrivateKey: ownerKey,
        accountId: binding.memWalAccountId,
        delegatePublicKeyHex: normalized,
        label: `market:${marketId}`,
        deployment
      });

      rememberDelegate(delegatesByAccount, binding.memWalAccountId, normalized);
    },

    hasDelegate(accountId, delegatePublicKeyHex) {
      return hasDelegate(delegatesByAccount, accountId, normalizeHex(delegatePublicKeyHex));
    }
  };
};

// --- helpers ---

const ensureHostAccountId = async (
  storeConfig: MemoryBindingStoreConfig,
  getDeploymentCache: () => RelayerDeploymentConfig | null,
  setDeploymentCache: (value: RelayerDeploymentConfig) => void,
  getHostAccountId: () => string | null,
  setHostAccountId: (value: string) => void
): Promise<string> => {
  const existing = getHostAccountId();
  if (existing !== null) {
    return existing;
  }

  const ownerKey = await resolveOwnerKey(storeConfig.config);
  const deployment = await loadDeployment(
    storeConfig.config,
    getDeploymentCache,
    setDeploymentCache,
    storeConfig.deployment
  );
  const registryId = requireRegistryId(storeConfig.config);
  const created = await storeConfig.ops.createHostAccount({
    suiPrivateKey: ownerKey,
    deployment,
    registryId
  });

  setHostAccountId(created.accountId);
  return created.accountId;
};

const loadDeployment = async (
  config: HostServerConfig,
  getCache: () => RelayerDeploymentConfig | null,
  setCache: (value: RelayerDeploymentConfig) => void,
  preset?: RelayerDeploymentConfig
) => {
  if (preset !== undefined) {
    return preset;
  }

  const cached = getCache();
  if (cached !== null) {
    return cached;
  }

  const deployment = await fetchRelayerDeploymentConfig(requireRelayerUrl(config));
  setCache(deployment);
  return deployment;
};

const resolveOwnerKey = async (config: HostServerConfig): Promise<string> => {
  const key = await resolveMemoryOwnerSuiPrivateKey(config);
  if (key === null) {
    throw new Error("memory_owner_not_configured");
  }

  return key;
};

const requireRelayerUrl = (config: HostServerConfig): string => {
  if (config.memoryRelayerUrl === null) {
    throw new Error("memory_relayer_not_configured");
  }

  return config.memoryRelayerUrl;
};

const requireRegistryId = (config: HostServerConfig): string => {
  if (config.memoryRegistryId === null) {
    throw new Error("memory_registry_not_configured");
  }

  return config.memoryRegistryId;
};

const normalizeHex = (value: string): string => value.trim().replace(/^0x/iu, "");

const hasDelegate = (
  delegatesByAccount: Map<string, Set<string>>,
  accountId: string,
  delegatePublicKeyHex: string
): boolean => delegatesByAccount.get(accountId)?.has(delegatePublicKeyHex) ?? false;

const rememberDelegate = (
  delegatesByAccount: Map<string, Set<string>>,
  accountId: string,
  delegatePublicKeyHex: string
): void => {
  const existing = delegatesByAccount.get(accountId) ?? new Set<string>();
  existing.add(delegatePublicKeyHex);
  delegatesByAccount.set(accountId, existing);
};

export const memoryBindingStoreReady = (config: HostServerConfig): boolean =>
  isMemoryHostConfigured(config);
