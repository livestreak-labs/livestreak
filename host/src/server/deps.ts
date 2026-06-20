import { createAaRouteDeps, type CreateAaRouteDepsOptions } from "../aa/routes.js";
import { defaultHostServerConfig, type HostServerConfig } from "../descriptor/config.js";
import { createDiscoveryStore } from "../discovery/store.js";
import { createEvidenceStore } from "../media/evidence-store.js";
import { createManifestStore } from "../media/manifest.js";
import { createSessionStore } from "../media/session-store.js";
import { createContentStore } from "../walrus/content/content-store.js";
import { createMemoryBindingStore } from "../walrus/memory/binding-store.js";
import { createMemWalAccountOperations } from "../walrus/memory/memwal-ops.js";
import { resolveMemoryOwnerSuiPrivateKey } from "../walrus/memory/owner-key.js";
import type { ResolvedWalrus } from "../walrus/network.js";

// --- exports ---

export interface HostRouteDeps {
  readonly config: HostServerConfig;
  readonly media: MediaRouteDeps;
  readonly discovery: DiscoveryRouteDeps;
  readonly walrus: WalrusRouteDeps;
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

export interface WalrusRouteDeps {
  readonly memory: MemoryRouteDeps;
  readonly content: ContentRouteDeps;
}

export interface MemoryRouteDeps {
  readonly bindings: ReturnType<typeof createMemoryBindingStore>;
}

export interface ContentRouteDeps {
  readonly store: ReturnType<typeof createContentStore>;
}

export interface CreateHostRouteDepsOptions extends CreateAaRouteDepsOptions {
  readonly walrusResolved?: ResolvedWalrus;
  readonly memoryOps?: ReturnType<typeof createMemWalAccountOperations>;
}

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  options: CreateHostRouteDepsOptions = {}
): HostRouteDeps => {
  const resolved = options.walrusResolved ?? config.resolvedWalrus;
  const ops = options.memoryOps ?? createMemWalAccountOperations();

  const disabledWalrus: ResolvedWalrus = {
    network: "mainnet",
    sui: {
      rpcUrl: "https://fullnode.mainnet.sui.io:443",
      packageId: "0x0",
      registryId: "0x0"
    },
    memory: { relayerUrl: "http://walrus-disabled.invalid" },
    blob: {
      publisherUrl: "http://walrus-disabled.invalid",
      aggregatorUrl: "http://walrus-disabled.invalid"
    }
  };

  const active = resolved ?? disabledWalrus;

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
    walrus: {
      memory: {
        bindings:
          resolved === null
            ? createMemoryBindingStore({
                resolved: active,
                resolveOwnerKey: async () => {
                  throw new Error("walrus_not_bootstrapped");
                },
                ops
              })
            : createMemoryBindingStore({
                resolved: active,
                resolveOwnerKey: async () => {
                  const key = await resolveMemoryOwnerSuiPrivateKey(config, active.sui.rpcUrl);
                  if (key === null) {
                    throw new Error("memory_owner_not_configured");
                  }

                  return key;
                },
                ops
              })
      },
      content: {
        store: createContentStore({
          resolved: active,
          ephemeralEpochs: config.walrusContentEphemeralEpochs,
          lockedEpochs: config.walrusContentLockedEpochs
        })
      }
    },
    aa: createAaRouteDeps(config, options)
  };
};
