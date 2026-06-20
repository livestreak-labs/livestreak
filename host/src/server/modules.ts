import { LiveStreakConfigError } from "@livestreak/core";
import { handleAaDescriptor, handleBundlerRpc, handlePaymasterRpc } from "../aa/routes.js";
import { handleDescriptor, handleHealth } from "../descriptor/routes.js";
import { isModuleEnabled } from "../descriptor/config.js";
import { handleFindSimilar, handleIndexVault } from "../discovery/routes.js";
import { handleContentBlobResolve, handleContentBlobStore } from "../walrus/content/routes.js";
import { handleMemoryAccess } from "../walrus/memory/routes.js";
import {
  handleCacheReceipt,
  handleCreateSession,
  handleGetManifest
} from "../media/routes.js";
import { handlePolicyEvaluate } from "../media/policy/routes.js";
import type { HostRouteDeps } from "./deps.js";
import { jsonFailure, jsonSuccess } from "./response.js";
import type { HostModuleRegistration } from "./registry.js";
import type { RouteDefinition } from "./types.js";

// --- exports ---

export const createHostModules = (deps: HostRouteDeps): HostModuleRegistration[] => [
  {
    token: "aa",
    enabled: isModuleEnabled(deps.config, "aa"),
    routes: aaRoutes()
  },
  {
    token: "media",
    enabled: isModuleEnabled(deps.config, "media"),
    routes: mediaRoutes()
  },
  {
    token: "walrus_memory",
    enabled: isModuleEnabled(deps.config, "walrus_memory"),
    routes: walrusMemoryRoutes()
  },
  {
    token: "walrus_content",
    enabled: isModuleEnabled(deps.config, "walrus_content"),
    routes: walrusContentRoutes()
  },
  {
    token: "discovery",
    enabled: isModuleEnabled(deps.config, "discovery"),
    routes: discoveryRoutes()
  },
  {
    token: "runtime",
    enabled: isModuleEnabled(deps.config, "runtime"),
    routes: stubRoutes("runtime", "TEE agent hosting is not enabled")
  },
  {
    token: "tenancy",
    enabled: isModuleEnabled(deps.config, "tenancy"),
    routes: stubRoutes("tenancy", "Tenancy is not enabled")
  }
];

export const descriptorRoutes = (): RouteDefinition[] => [
  {
    method: "GET",
    pattern: /^\/health$/u,
    handler: ({ deps }) => jsonSuccess(200, handleHealth({ config: deps.config }))
  },
  {
    method: "GET",
    pattern: /^\/descriptor$/u,
    handler: ({ deps }) => jsonSuccess(200, handleDescriptor({ config: deps.config }))
  },
  {
    method: "GET",
    pattern: /^\/aa\/descriptor$/u,
    handler: ({ deps }) => jsonSuccess(200, handleAaDescriptor(deps.aa))
  }
];

// --- helpers ---

const policyEvaluatorState = (deps: HostRouteDeps) => ({
  quotaRemainingBytes: deps.media.evidence.getQuotaRemainingBytes()
});

const aaRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/aa\/bundler\/(?<chain>[^/]+)$/u,
    handler: ({ params, body }) => handleBundlerRpc(params.chain, body)
  },
  {
    method: "POST",
    pattern: /^\/aa\/paymaster\/(?<chain>[^/]+)$/u,
    handler: ({ params, body, deps: routeDeps }) =>
      handlePaymasterRpc(params.chain, body, routeDeps.aa)
  }
];

const mediaRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/media\/policy\/evaluate$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handlePolicyEvaluate(body, {
        config: routeDeps.config,
        state: policyEvaluatorState(routeDeps)
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/media\/sessions$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleCreateSession(body, {
        ...routeDeps.media,
        config: routeDeps.config
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/media\/sessions\/(?<sessionId>[^/]+)\/manifest$/u,
    handler: ({ params, deps: routeDeps }) => {
      const result = handleGetManifest(params.sessionId, routeDeps.media);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/media\/sessions\/(?<sessionId>[^/]+)\/cache-receipts$/u,
    handler: ({ params, body, deps: routeDeps }) => {
      const result = handleCacheReceipt(params.sessionId, body, {
        ...routeDeps.media,
        config: routeDeps.config
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  }
];

const discoveryRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/discovery\/vaults$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handleIndexVault(body, routeDeps.discovery);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(201, result.result);
    }
  },
  {
    method: "POST",
    pattern: /^\/discovery\/find$/u,
    handler: ({ body, deps: routeDeps }) => {
      const result = handleFindSimilar(body, routeDeps.discovery);

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(200, result.result);
    }
  }
];

const walrusMemoryRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/memory\/access$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleMemoryAccess(body, {
        config: routeDeps.config,
        bindings: routeDeps.walrus.memory.bindings
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  }
];

const walrusContentRoutes = (): RouteDefinition[] => [
  {
    method: "POST",
    pattern: /^\/content\/blobs$/u,
    handler: async ({ body, deps: routeDeps }) => {
      const result = await handleContentBlobStore(body, {
        config: routeDeps.config,
        store: routeDeps.walrus.content.store
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  },
  {
    method: "GET",
    pattern: /^\/content\/blobs\/(?<scheme>[^/]+)\/(?<id>[^/]+)$/u,
    handler: async ({ params, deps: routeDeps }) => {
      const scheme = params.scheme ?? "";
      const id = params.id ?? "";
      const result = await handleContentBlobResolve(scheme, id, {
        config: routeDeps.config,
        store: routeDeps.walrus.content.store
      });

      if (!result.ok) {
        return jsonFailure(result.status, result.error);
      }

      return jsonSuccess(result.status, result.result);
    }
  }
];

const stubRoutes = (module: string, message: string): RouteDefinition[] => [
  {
    method: "POST",
    pattern: new RegExp(`^\\/${module}\\/.*$`, "u"),
    handler: () =>
      jsonFailure(
        501,
        new LiveStreakConfigError({
          message,
          metadata: { retryable: false }
        })
      )
  }
];
