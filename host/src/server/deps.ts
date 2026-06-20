import { createAaRouteDeps, type CreateAaRouteDepsOptions } from "../aa/routes.js";
import { defaultHostServerConfig, type HostServerConfig } from "../descriptor/config.js";
import { createDiscoveryStore } from "../discovery/store.js";
import { createEvidenceStore } from "../media/evidence-store.js";
import { createManifestStore } from "../media/manifest.js";
import { createSessionStore } from "../media/session-store.js";
import { createMemoryBindingStore } from "../memory/binding-store.js";
import { createMemWalAccountOperations } from "../memory/memwal-ops.js";
import { resolveMemoryOwnerSuiPrivateKey } from "../memory/owner-key.js";
import type { ResolvedMemoryNetwork } from "../memory/network-profile.js";

// --- exports ---

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly media: MediaRouteDeps;
  readonly discovery: DiscoveryRouteDeps;
  readonly memory: MemoryRouteDeps;
  readonly aa: ReturnType<typeof createAaRouteDeps>;
}

export interface MediaRouteDeps {
  readonly sessions: ReturnType<typeof createSessionStore>;
  readonly manifests: ReturnType<typeof createManifestStore>;
  readonly evidence: ReturnType<typeof createEvidenceStore>;
}

export interface DiscoveryRouteDeps {
  readonly store: ReturnType<typeof createDiscoveryStore>;
}

export interface MemoryRouteDeps {
  readonly bindings: ReturnType<typeof createMemoryBindingStore>;
}

export interface CreateHostRouteDepsOptions extends CreateAaRouteDepsOptions {
  readonly memoryResolved?: ResolvedMemoryNetwork;
  readonly memoryOps?: ReturnType<typeof createMemWalAccountOperations>;
}

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {}
): HostRouteDeps => {
  const resolved = options.memoryResolved ?? config.resolvedMemoryNetwork;
  const ops = options.memoryOps ?? createMemWalAccountOperations();

  return {
    config,
    media: {
      sessions: createSessionStore(),
      manifests: createManifestStore(),
      evidence: createEvidenceStore(config.cacheQuotaBytes)
    },
    discovery: {
      store: createDiscoveryStore()
    },
    memory: {
      bindings:
        resolved === null
          ? createMemoryBindingStore({
              resolved: {
                network: "mainnet",
                relayerUrl: "http://memory-disabled.invalid",
                registryId: "0x0",
                packageId: "0x0",
                suiRpcUrl: "https://fullnode.mainnet.sui.io:443"
              },
              resolveOwnerKey: async () => {
                throw new Error("memory_not_bootstrapped");
              },
              ops
            })
          : createMemoryBindingStore({
              resolved,
              resolveOwnerKey: async () => {
                const key = await resolveMemoryOwnerSuiPrivateKey(config, resolved.suiRpcUrl);
                if (key === null) {
                  throw new Error("memory_owner_not_configured");
                }

                return key;
              },
              ops
            })
    },
    aa: createAaRouteDeps(config, options)
  };
};
