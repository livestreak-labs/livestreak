import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { FlowStreamConfigError } from "@flowstream-re/core";
import { webCaptureAcquireDriver } from "@flowstream-re/sdk-stats";
import { formatCliError } from "../src/cli-error.js";
import {
  evaluateObserveHostPolicyPreview,
  evaluateWebCaptureBrowserReadinessPayload,
  observeReadinessKind,
  resolveObserveRequest,
  webCaptureBrowserReadinessPayload,
  webCapturePolicyReadinessPayload
} from "../src/observe.js";
import {
  browserBindingReadinessPayload,
  resolveBrowserBindingPlan
} from "../src/browser-binding.js";

describe("observe CLI options", () => {
  it("preserves the observe shell when no observe flags are provided", () => {
    expect(resolveObserveRequest({})).toEqual({ _tag: "shell" });
  });

  it("accepts the M1 local file debug broadcast shape", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "file://out/match.mp4",
      sampleFps: 2
    });

    expect(request).toEqual({
      _tag: "fileDebug",
      source: "fixtures/match.mp4",
      outputUri: "file://out/match.mp4",
      outputPath: "out/match.mp4",
      sampleFps: 2
    });
  });

  it("rejects incomplete file debug requests without treating cache as an output", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      content: "football",
      output: "cache://local"
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain("M1 observe requires --source <path> for file acquisition.");
      expect(request.errors).toContain(
        "FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode."
      );
    }
  });

  it("rejects cache output even when the file debug request is otherwise complete", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "cache://local"
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toEqual([
        "FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode."
      ]);
    }
  });

  it("accepts file debug observe with --debug as an explicit no-op", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "file://out/match.mp4",
      debug: true
    });

    expect(request).toEqual({
      _tag: "fileDebug",
      source: "fixtures/match.mp4",
      outputUri: "file://out/match.mp4",
      outputPath: "out/match.mp4",
      sampleFps: undefined
    });
    expect(observeReadinessKind(request)).toBe("file-debug");
  });

  it("parses WebCapture local --debug as local debug readiness", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "local",
      captureFps: 5,
      debug: true
    });

    expect(request).toEqual({
      _tag: "webCapture",
      source: "https://example.com/live",
      output: {
        mode: "local",
        uri: "local"
      },
      captureFps: 5,
      debug: true
    });
    expect(observeReadinessKind(request)).toBe("local-debug");
    if (request._tag === "webCapture") {
      expect(webCapturePolicyReadinessPayload(request, null)).toMatchObject({
        ok: true,
        status: "local-debug-readiness",
        readiness: {
          selectedHostProviderRequired: false,
          selectedHostProviderBound: false,
          endpointManifestIssued: false,
          hostCacheReceiptIssued: false
        },
        hostPolicyPreview: {
          skipped: true
        }
      });
    }
  });

  it("parses WebCapture local without debug as host-required readiness", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "local",
      captureFps: 5
    });

    expect(request).toEqual({
      _tag: "webCapture",
      source: "https://example.com/live",
      output: {
        mode: "local",
        uri: "local"
      },
      captureFps: 5
    });
    expect(observeReadinessKind(request)).toBe("host-required");
  });

  it("parses WebCapture forwarder as host-required readiness", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "forwarder",
      captureFps: 5
    });

    expect(request).toEqual({
      _tag: "webCapture",
      source: "https://example.com/live",
      output: {
        mode: "forwarder",
        uri: "forwarder"
      },
      captureFps: 5
    });
    expect(observeReadinessKind(request)).toBe("host-required");
  });

  it("normalizes a CLI-owned external CDP browser binding plan", () => {
    const binding = resolveBrowserBindingPlan({
      browserKind: "cdp",
      browserEndpoint: "http://127.0.0.1:9222",
      browserPageName: "scoreboard"
    });

    expect(binding.errors).toEqual([]);
    expect(binding.plan).toEqual({
      configured: true,
      mode: "external-cdp",
      kind: "cdp",
      endpoint: "http://127.0.0.1:9222",
      pageName: "scoreboard",
      adapterOwner: "cli",
      message:
        "Browser binding is a CLI-owned readiness plan only; no browser was launched and no page adapter was delivered to sdk-stats."
    });
    expect(browserBindingReadinessPayload(binding.plan!)).toMatchObject({
      configured: true,
      mode: "external-cdp",
      kind: "cdp",
      endpoint: "http://127.0.0.1:9222",
      sdkStatsOwnsBrowserDependencies: false,
      browserLaunchClaimed: false,
      pageAdapterDeliveredToSdk: false,
      framesDelivered: false
    });
  });

  it("normalizes a caller-provided browser page adapter readiness plan", () => {
    const binding = resolveBrowserBindingPlan({
      browserKind: "playwright",
      browserPageName: "caller-page"
    });

    expect(binding.errors).toEqual([]);
    expect(binding.plan).toMatchObject({
      configured: true,
      mode: "caller-page-adapter",
      kind: "playwright",
      pageName: "caller-page",
      adapterOwner: "caller"
    });
  });

  it("rejects incomplete browser binding flags with CLI ownership guidance", () => {
    expect(resolveBrowserBindingPlan({
      browserEndpoint: "http://127.0.0.1:9222"
    })).toEqual({
      errors: ["--browser-kind is required when configuring a WebCapture browser binding."]
    });

    expect(resolveBrowserBindingPlan({
      browserKind: "cdp"
    })).toEqual({
      errors: ["--browser-endpoint is required when --browser-kind cdp."]
    });
  });

  it("parses WebCapture viewport and crop text forms", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "file://out/webcapture.json",
      captureFps: 10,
      viewport: "1280x720",
      crop: "10,20,640,360"
    });

    expect(request).toEqual({
      _tag: "webCapture",
      source: "https://example.com/live",
      output: {
        mode: "file",
        uri: "file://out/webcapture.json",
        path: "out/webcapture.json"
      },
      captureFps: 10,
      viewport: {
        width: 1280,
        height: 720
      },
      crop: {
        x: 10,
        y: 20,
        width: 640,
        height: 360
      }
    });
  });

  it("parses WebCapture viewport and crop JSON/keyed forms", () => {
    const jsonRequest = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "local",
      captureFps: 8,
      viewport: "{\"width\":1920,\"height\":1080}",
      crop: "{\"x\":100,\"y\":50,\"width\":800,\"height\":450}"
    });
    const keyedRequest = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "local",
      captureFps: 8,
      viewport: "width=1920,height=1080",
      crop: "x=100,y=50,width=800,height=450"
    });

    expect(jsonRequest).toEqual(keyedRequest);
    expect(jsonRequest).toMatchObject({
      _tag: "webCapture",
      viewport: {
        width: 1920,
        height: 1080
      },
      crop: {
        x: 100,
        y: 50,
        width: 800,
        height: 450
      }
    });
  });

  it("rejects file-only flags on WebCapture", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "local",
      sampleFps: 2,
      captureFps: 5
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain("--sample-fps is scoped to --acquire file.");
    }
  });

  it("rejects WebCapture-only flags on file acquisition", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "file://out/match.mp4",
      captureFps: 5,
      viewport: "1280x720",
      crop: "0,0,1280,720"
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain("--capture-fps is scoped to --acquire webcapture.");
      expect(request.errors).toContain("--viewport is scoped to --acquire webcapture.");
      expect(request.errors).toContain("--crop is scoped to --acquire webcapture.");
    }
  });

  it("rejects browser binding flags on file acquisition", () => {
    const request = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "file://out/match.mp4",
      browserKind: "cdp",
      browserEndpoint: "http://127.0.0.1:9222"
    });

    expect(request).toEqual({
      _tag: "invalid",
      errors: ["--browser-kind, --browser-endpoint, and --browser-page-name are scoped to --acquire webcapture."]
    });
  });

  it("rejects cache output for WebCapture", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "cache://local",
      captureFps: 5
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toEqual([
        "FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode."
      ]);
    }
  });

  it("rejects literal cache output for WebCapture with a FlowStream policy message", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "cache",
      captureFps: 5
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toEqual([
        "FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode."
      ]);
    }
  });

  it("rejects local and forwarder outputs for file acquisition", () => {
    const local = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "local"
    });
    const forwarder = resolveObserveRequest({
      acquire: "file",
      source: "fixtures/match.mp4",
      content: "football",
      output: "forwarder"
    });

    expect(local).toEqual({
      _tag: "invalid",
      errors: ["M1 observe accepts only debug file output URIs such as file://out/match.mp4."]
    });
    expect(forwarder).toEqual(local);
  });

  it("reports honest forwarder scaffold JSON without host binding or media claims", async () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "forwarder",
      captureFps: 5
    });

    expect(request._tag).toBe("webCapture");
    if (request._tag === "webCapture") {
      const policy = await Effect.runPromise(evaluateObserveHostPolicyPreview(request));
      const payload = webCapturePolicyReadinessPayload(request, policy);

      expect(payload).toMatchObject({
        ok: false,
        status: "host-required-readiness",
        binding: {
          selectedProvider: null,
          loggedIn: false,
          configBound: false
        },
        ownership: {
          hostProviderClient: expect.stringContaining("HostProviderClient"),
          outputHandlers: expect.stringContaining("forwarder/local output handlers"),
          runtimeStore: expect.stringContaining("RuntimeStore")
        },
        readiness: {
          selectedHostProviderRequired: true,
          selectedHostProviderBound: false,
          endpointManifestIssued: false,
          hostCacheReceiptIssued: false,
          browserBindingConfigured: false,
          framesDelivered: false,
          mediaForwardingClaimed: false
        },
        browserBinding: {
          configured: false,
          sdkStatsOwnsBrowserDependencies: false,
          browserStarted: false,
          pageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        hostPolicyPreview: {
          label: expect.stringContaining("Provider-agnostic in-memory shape preview only")
        }
      });
      expect(payload.limitations).toEqual(expect.arrayContaining([
        "No real host is bound.",
        "No endpoint manifest/cache receipt was issued.",
        "No media forwarding is claimed."
      ]));
    }
  });

  it("reports missing browser binding readiness for WebCapture file observe", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "file://out/webcapture.json",
      captureFps: 5
    });

    expect(request._tag).toBe("webCapture");
    if (request._tag === "webCapture") {
      expect(webCaptureBrowserReadinessPayload(request)).toMatchObject({
        ok: false,
        status: "missing-browser-binding",
        message: expect.stringContaining("CLI/caller browser binding"),
        browserBinding: {
          configured: false,
          mode: "missing",
          sdkStatsOwnsBrowserDependencies: false,
          browserStarted: false,
          pageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        readiness: {
          browserBindingConfigured: false,
          browserStarted: false,
          captureStarted: false,
          browserPageAdapterDeliveredToSdk: false,
          framesDelivered: false,
          mediaForwardingClaimed: false
        }
      });
    }
  });

  it("reports a configured CDP browser binding plan as not ready without an injected adapter", () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "file://out/webcapture.json",
      captureFps: 5,
      browserKind: "cdp",
      browserEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
      browserPageName: "main"
    });

    expect(request._tag).toBe("webCapture");
    if (request._tag === "webCapture") {
      expect(request.browserBinding).toMatchObject({
        configured: true,
        mode: "external-cdp",
        kind: "cdp",
        endpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
        pageName: "main"
      });
      expect(webCaptureBrowserReadinessPayload(request)).toMatchObject({
        ok: false,
        status: "browser-binding-not-ready",
        browserBinding: {
          configured: true,
          mode: "external-cdp",
          kind: "cdp",
          endpoint: "ws://127.0.0.1:9222/devtools/browser/abc",
          pageName: "main",
          sdkStatsOwnsBrowserDependencies: false,
          browserLaunchClaimed: false,
          pageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        readiness: {
          browserBindingConfigured: true,
          browserStarted: false,
          browserLaunchClaimed: false,
          captureStarted: false,
          browserPageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        error: {
          tag: "FlowStreamCapabilityError",
          message: "WebCapture browser binding requires an injected CLI page factory",
          retryable: false,
          details: expect.stringContaining("no injected external CDP/page factory was provided")
        }
      });
    }
  });

  it("delivers an injected external CDP page adapter through the SDK boundary without claiming frames", async () => {
    const calls: Array<{ readonly method: string; readonly params: unknown }> = [];
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "file://out/webcapture.json",
      captureFps: 5,
      browserKind: "cdp",
      browserEndpoint: "ws://127.0.0.1:9222/devtools/page/main",
      browserPageName: "main"
    });

    expect(request._tag).toBe("webCapture");
    if (request._tag === "webCapture") {
      const send = vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params });
        return {};
      });
      const payload = await Effect.runPromise(
        evaluateWebCaptureBrowserReadinessPayload(request, {
          externalCdpPage: ({ endpoint, pageName }) => {
            expect(endpoint).toBe("ws://127.0.0.1:9222/devtools/page/main");
            expect(pageName).toBe("main");
            return Effect.succeed({ send });
          }
        })
      );

      expect(calls).toEqual([
        {
          method: "Emulation.setDeviceMetricsOverride",
          params: {
            width: 1280,
            height: 720,
            deviceScaleFactor: 1,
            mobile: false
          }
        },
        {
          method: "Page.navigate",
          params: { url: "https://example.com/live" }
        }
      ]);
      expect(payload).toMatchObject({
        ok: true,
        status: "browser-page-adapter-delivered",
        browserBinding: {
          configured: true,
          mode: "external-cdp",
          kind: "cdp",
          endpoint: "ws://127.0.0.1:9222/devtools/page/main",
          pageName: "main",
          adapterFactoryInjected: true,
          sdkStatsOwnsBrowserDependencies: false,
          browserLaunchClaimed: false,
          browserStarted: false,
          pageAdapterDeliveredToSdk: true,
          framesDelivered: false
        },
        readiness: {
          browserBindingConfigured: true,
          browserStarted: false,
          browserLaunchClaimed: false,
          captureStarted: false,
          browserPageAdapterDeliveredToSdk: true,
          framesDelivered: false,
          mediaForwardingClaimed: false
        }
      });
      expect(payload).not.toHaveProperty("error");
    }
  });

  it("reports failed injected adapter delivery as typed error JSON", async () => {
    const request = resolveObserveRequest({
      acquire: "webcapture",
      source: "https://example.com/live",
      content: "football",
      output: "file://out/webcapture.json",
      captureFps: 5,
      browserKind: "cdp",
      browserEndpoint: "ws://127.0.0.1:9222/devtools/page/main"
    });

    expect(request._tag).toBe("webCapture");
    if (request._tag === "webCapture") {
      const payload = await Effect.runPromise(
        evaluateWebCaptureBrowserReadinessPayload(request, {
          externalCdpPage: () =>
            Effect.succeed({
              send: vi.fn(async (method: string) => {
                if (method === "Page.navigate") {
                  throw new Error("target closed");
                }
                return {};
              })
            })
        })
      );

      expect(payload).toMatchObject({
        ok: false,
        status: "browser-binding-not-ready",
        browserBinding: {
          configured: true,
          adapterFactoryInjected: true,
          pageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        readiness: {
          browserBindingConfigured: true,
          browserPageAdapterDeliveredToSdk: false,
          framesDelivered: false
        },
        error: {
          tag: "FlowStreamRuntimeError",
          message: "WebCapture browser page call failed",
          retryable: false,
          details: "Browser page adapter cdp failed while calling send.",
          bridgeCode: "browser-call-failed",
          adapterKind: "cdp",
          method: "send"
        }
      });
    }
  });

  it("surfaces SDK missing browser adapter details for WebCapture", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* webCaptureAcquireDriver.validate({
          url: "https://example.com/live",
          captureFps: 5
        });
        return yield* Effect.scoped(webCaptureAcquireDriver.create(config));
      }).pipe(Effect.flip)
    );

    expect(formatCliError(error)).toEqual({
      tag: "FlowStreamRuntimeError",
      message: "WebCapture requires an injected browser capture adapter",
      retryable: false,
      details: "Provide a BrowserCaptureAdapter backed by Playwright, Puppeteer, or a host browser bridge.",
      docsPath: undefined
    });
  });

  it("formats typed SDK errors with details, retryability, and docs path", () => {
    const error = new FlowStreamConfigError({
      message: "Football content pack assets are not ready",
      metadata: {
        details: "assetRoot=/tmp/weights ready=0/3 missing=3",
        retryable: true,
        docsPath: "context/v2/06-implementation-roadmap.md#m2-football-pack-assets-and-python-cv"
      }
    });

    expect(formatCliError(error)).toEqual({
      tag: "FlowStreamConfigError",
      message: "Football content pack assets are not ready",
      retryable: true,
      details: "assetRoot=/tmp/weights ready=0/3 missing=3",
      docsPath:
        "context/v2/06-implementation-roadmap.md#m2-football-pack-assets-and-python-cv"
    });
  });
});
