import { createAaRouteDeps, type CreateAaRouteDepsOptions } from "../aa/routes.js";
import { defaultHostServerConfig, type HostServerConfig } from "../descriptor/config.js";
import { createDiscoveryStore } from "../discovery/store.js";
import { createEvidenceStore } from "../media/evidence-store.js";
import { createManifestStore } from "../media/manifest.js";
import { createSessionStore } from "../media/session-store.js";
import { createMemoryBindingStore } from "../memory/binding-store.js";
import { createMemWalAccountOperations } from "../memory/memwal-ops.js";

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

export const createHostRouteDeps = (
  config: HostServerConfig = defaultHostServerConfig(),
  aaOptions: CreateAaRouteDepsOptions = {}
): HostRouteDeps => ({
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
    bindings: createMemoryBindingStore({
      config,
      ops: createMemWalAccountOperations()
    })
  },
  aa: createAaRouteDeps(config, aaOptions)
});
