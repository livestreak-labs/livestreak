import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import type { HostProviderFetch, HostProviderFetchResponse } from "@flowstream-re/sdk-stats";
import {
  configureHostProvider,
  evaluateHostPolicyPreview,
  hostInvalidPayload,
  hostConstraintsScaffoldPayload,
  hostPolicyPreviewPayload,
  loginHostProvider,
  makeMemoryHostConfigStore,
  parseHostPolicyRequest,
  readHostReadiness,
  readHostConstraintsPreview
} from "../src/host.js";

const hostDescriptor = {
  version: "0.1.0",
  hostId: "fake-provider",
  baseUrl: "https://fake-provider.example",
  capabilities: ["webrtc_forwarding", "host_cache", "endpoint_manifests"],
  supportedOutputs: ["forwarder", "local", "file"],
  termsVersion: "2026-06"
} as const;

const hostConstraint = {
  id: "fake-provider-auth",
  summary: "Fake provider requires API key auth.",
  appliesTo: ["http"]
} as const;

const jsonResponse = (body: unknown, status = 200, statusText = "OK"): HostProviderFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  json: async () => body
});

describe("host CLI scaffold", () => {
  it("accepts policy preview args for forwarder, local, and file", () => {
    for (const output of ["forwarder", "local", "file"] as const) {
      expect(
        parseHostPolicyRequest({
          output,
          content: "football",
          observer: "observer_1",
          debug: output === "file",
          expectedDurationSeconds: 120,
          expectedCacheBytes: 4096
        })
      ).toMatchObject({
        _tag: "preview",
        output,
        content: "football",
        observer: "observer_1"
      });
    }
  });

  it("rejects cache output", () => {
    const request = parseHostPolicyRequest({
      output: "cache",
      content: "football",
      observer: "observer_1",
      debug: false
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain(
        "host policy rejects --output cache; cache is host policy/evidence, not an output mode."
      );
      expect(hostInvalidPayload("policy", request.errors)).toMatchObject({
        ok: false,
        command: "host policy",
        status: "invalid"
      });
    }
  });

  it("reports local debug preview can skip host cache", async () => {
    const request = parseHostPolicyRequest({
      output: "local",
      content: "football",
      observer: "observer_1",
      debug: true
    });

    expect(request._tag).toBe("preview");
    if (request._tag === "preview") {
      const policy = await Effect.runPromise(evaluateHostPolicyPreview(request));
      const payload = hostPolicyPreviewPayload(request, policy);

      expect(payload.status).toBe("preview");
      expect(payload.preview).toBe(true);
      expect(payload.sdkPolicy.cache.maySkip).toBe(true);
      expect(payload.sdkPolicy.cache.required).toBe(false);
      expect(payload.message).toContain("Local policy preview only");
    }
  });

  it("reports local non-debug preview requires host cache", async () => {
    const request = parseHostPolicyRequest({
      output: "local",
      content: "football",
      observer: "observer_1",
      debug: false
    });

    expect(request._tag).toBe("preview");
    if (request._tag === "preview") {
      const policy = await Effect.runPromise(evaluateHostPolicyPreview(request));
      const payload = hostPolicyPreviewPayload(request, policy);

      expect(payload.sdkPolicy.cache.required).toBe(true);
      expect(payload.sdkPolicy.cache.maySkip).toBe(false);
      expect(payload.modeExplanation).toContain("requires host cache");
    }
  });

  it("constraints scaffold includes the SDK WHIP/WHEP paired-only note", async () => {
    const constraints = await Effect.runPromise(readHostConstraintsPreview());
    const payload = hostConstraintsScaffoldPayload(constraints);
    const serialized = JSON.stringify(payload);

    expect(serialized).toContain("Cloudflare-like WebRTC providers require paired WHIP/WHEP media graphs.");
    expect(serialized).toContain("No mixed WHIP-to-HLS/DASH or mixed protocol egress is modeled by this provider.");
  });

  it("configures a selected HTTP provider without provider login or steward claims", async () => {
    const store = makeMemoryHostConfigStore();
    const payload = await Effect.runPromise(
      configureHostProvider(
        store,
        {
          provider: "http",
          url: "https://fake-provider.example/api/",
          apiKey: "secret-key"
        },
        1_700_000_000_000
      )
    );
    const saved = await Effect.runPromise(store.read);

    expect(payload).toMatchObject({
      ok: true,
      command: "host configure",
      status: "configured",
      readiness: {
        canCreateHttpClient: true,
        productionSteward: false,
        cacheOutputMode: false
      }
    });
    expect(payload.binding.selectedProvider.auth.apiKey).toBe("configured");
    expect(JSON.stringify(payload)).not.toContain("secret-key");
    expect(saved?.selectedProvider).toMatchObject({
      provider: "http",
      baseUrl: "https://fake-provider.example/api",
      apiKey: "secret-key"
    });
  });

  it("fails provider config with a typed user error when auth is missing", async () => {
    const result = await Effect.runPromise(
      Effect.either(
        configureHostProvider(makeMemoryHostConfigStore(), {
          provider: "http",
          url: "https://fake-provider.example"
        })
      )
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("FlowStreamConfigError");
      expect(result.left.message).toContain("requires apiKey or bearerToken");
    }
  });

  it("logs in through the selected HTTP provider and stores readiness evidence", async () => {
    const calls: string[] = [];
    const fetch: HostProviderFetch = async (input, init) => {
      calls.push(`${init.method} ${new URL(input).pathname} ${init.headers["x-api-key"] ?? ""}`);

      if (init.method === "GET" && new URL(input).pathname === "/api/describe") {
        return jsonResponse(hostDescriptor);
      }

      if (init.method === "GET" && new URL(input).pathname === "/api/constraints") {
        return jsonResponse([hostConstraint]);
      }

      return jsonResponse({ error: "not found" }, 404, "Not Found");
    };
    const store = makeMemoryHostConfigStore();
    const payload = await Effect.runPromise(
      loginHostProvider(
        { fetch, store },
        {
          provider: "http",
          url: "https://fake-provider.example/api/",
          apiKey: "secret-key"
        },
        1_700_000_000_001
      )
    );
    const saved = await Effect.runPromise(store.read);

    expect(calls).toEqual([
      "GET /api/describe secret-key",
      "GET /api/constraints secret-key"
    ]);
    expect(payload).toMatchObject({
      ok: true,
      command: "host login",
      status: "logged-in",
      provider: {
        hostId: "fake-provider"
      },
      readiness: {
        canCreateHttpClient: true,
        productionSteward: false,
        cacheOutputMode: false
      }
    });
    expect(payload.readiness.requiredCapabilities).toMatchObject({
      webrtc_forwarding: true,
      host_cache: true,
      endpoint_manifests: true
    });
    expect(saved?.descriptor?.hostId).toBe("fake-provider");
  });

  it("reports readiness JSON for missing config and provider failures", async () => {
    const missing = await Effect.runPromise(
      readHostReadiness({
        fetch: async () => jsonResponse(hostDescriptor),
        store: makeMemoryHostConfigStore()
      })
    );

    expect(missing).toMatchObject({
      ok: false,
      command: "host readiness",
      status: "not-configured"
    });

    const store = makeMemoryHostConfigStore({
      version: "0.1.0",
      selectedProvider: {
        provider: "http",
        baseUrl: "https://fake-provider.example",
        bearerToken: "token"
      },
      updatedAtMs: 1_700_000_000_002
    });
    const failed = await Effect.runPromise(
      readHostReadiness({
        store,
        fetch: async () => jsonResponse({ error: "unauthorized" }, 401, "Unauthorized")
      })
    );

    expect(failed).toMatchObject({
      ok: false,
      command: "host readiness",
      status: "not-ready",
      readiness: {
        canCreateHttpClient: true,
        productionSteward: false,
        cacheOutputMode: false
      },
      error: {
        tag: "FlowStreamRuntimeError"
      }
    });
  });
});
