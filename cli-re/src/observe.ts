import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  builtInStatsRegistry,
  fileOutputHandler,
  footballContentPack,
  makeInMemoryHostProviderClient,
  makeBroadcastSession,
  type AcquireDriver,
  type HostPolicyResult
} from "@flowstream-re/sdk-stats";
import {
  browserBindingFlagsPresent,
  browserBindingDeliveryNotReadyError,
  browserBindingReadinessPayload,
  browserBindingReadinessPayloadWithDelivery,
  deliverBrowserBindingToSdk,
  resolveBrowserBindingPlan,
  type BrowserBindingAdapterRuntime,
  type BrowserBindingDeliveryProof,
  type BrowserBindingKind,
  type BrowserBindingPlan
} from "./browser-binding.js";
import { formatCliError } from "./cli-error.js";

type AcquireKind = "file" | "webcapture";

interface ViewportValue {
  readonly width: number;
  readonly height: number;
}

interface CropValue {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ObserveCliOptions {
  readonly acquire?: AcquireKind;
  readonly source?: string;
  readonly content?: "football";
  readonly output?: string;
  readonly sampleFps?: number;
  readonly captureFps?: number;
  readonly viewport?: string;
  readonly crop?: string;
  readonly browserKind?: BrowserBindingKind;
  readonly browserEndpoint?: string;
  readonly browserPageName?: string;
  readonly debug?: boolean;
}

export type ObserveRequest =
  | { readonly _tag: "shell" }
  | { readonly _tag: "invalid"; readonly errors: readonly string[] }
  | {
      readonly _tag: "fileDebug";
      readonly source: string;
      readonly outputUri: string;
      readonly outputPath: string;
      readonly sampleFps?: number;
    }
  | {
      readonly _tag: "webCapture";
      readonly source: string;
      readonly output:
        | { readonly mode: "file"; readonly uri: string; readonly path: string }
        | { readonly mode: "local"; readonly uri: "local" }
        | { readonly mode: "forwarder"; readonly uri: "forwarder" };
      readonly captureFps: number;
      readonly viewport?: ViewportValue;
      readonly crop?: CropValue;
      readonly browserBinding?: BrowserBindingPlan;
      readonly debug?: true;
    };

const observeExample =
  "flowstream-re observe --acquire file --source fixtures/match.mp4 --content football --output file://out/match.mp4";
const webCaptureExample =
  "flowstream-re observe --acquire webcapture --source https://example.com/live --content football --output local --capture-fps 5 --debug --viewport 1280x720 --crop 0,0,1280,720";

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

export const observeCommandOptions = {
  acquire: Options.choice("acquire", ["file", "webcapture"] as const).pipe(
    Options.optional,
    Options.withDescription("Acquire driver to use. File and WebCapture expose separate scoped flags.")
  ),
  source: Options.text("source").pipe(
    Options.optional,
    Options.withDescription("File path for --acquire file or URL for --acquire webcapture.")
  ),
  content: Options.choice("content", ["football"] as const).pipe(
    Options.optional,
    Options.withDescription("Content pack to prepare for observation.")
  ),
  output: Options.text("output").pipe(
    Options.optional,
    Options.withDescription("Output shape. File accepts file:// paths; WebCapture accepts file://, local, or forwarder.")
  ),
  sampleFps: Options.float("sample-fps").pipe(
    Options.optional,
    Options.withDescription("File-only sampling rate in frames per second.")
  ),
  captureFps: Options.float("capture-fps").pipe(
    Options.optional,
    Options.withDescription("WebCapture-only monotonic browser capture cadence in frames per second.")
  ),
  viewport: Options.text("viewport").pipe(
    Options.optional,
    Options.withDescription("WebCapture-only viewport as WIDTHxHEIGHT, JSON, or width=1280,height=720.")
  ),
  crop: Options.text("crop").pipe(
    Options.optional,
    Options.withDescription("WebCapture-only crop as X,Y,W,H, JSON, or x=0,y=0,width=1280,height=720.")
  ),
  browserKind: Options.choice("browser-kind", ["auto", "playwright", "puppeteer", "cdp"] as const).pipe(
    Options.optional,
    Options.withDescription(
      "WebCapture-only browser binding kind. cdp plans an external CDP endpoint; auto/playwright/puppeteer plan a caller-provided page adapter."
    )
  ),
  browserEndpoint: Options.text("browser-endpoint").pipe(
    Options.optional,
    Options.withDescription("WebCapture-only external browser endpoint, currently scoped to --browser-kind cdp.")
  ),
  browserPageName: Options.text("browser-page-name").pipe(
    Options.optional,
    Options.withDescription("WebCapture-only label for the caller/CDP page used in readiness output.")
  ),
  debug: Options.boolean("debug").pipe(
    Options.withDescription("Observe debug mode. File acquisition is always debug; WebCapture local debug is explicit.")
  )
};

export const normalizeObserveOptions = (options: {
  readonly acquire: Option.Option<AcquireKind>;
  readonly source: Option.Option<string>;
  readonly content: Option.Option<"football">;
  readonly output: Option.Option<string>;
  readonly sampleFps: Option.Option<number>;
  readonly captureFps: Option.Option<number>;
  readonly viewport: Option.Option<string>;
  readonly crop: Option.Option<string>;
  readonly browserKind: Option.Option<BrowserBindingKind>;
  readonly browserEndpoint: Option.Option<string>;
  readonly browserPageName: Option.Option<string>;
  readonly debug: boolean;
}): ObserveCliOptions => ({
  acquire: optionValue(options.acquire),
  source: optionValue(options.source),
  content: optionValue(options.content),
  output: optionValue(options.output),
  sampleFps: optionValue(options.sampleFps),
  captureFps: optionValue(options.captureFps),
  viewport: optionValue(options.viewport),
  crop: optionValue(options.crop),
  browserKind: optionValue(options.browserKind),
  browserEndpoint: optionValue(options.browserEndpoint),
  browserPageName: optionValue(options.browserPageName),
  debug: options.debug
});

const hasObserveInput = (options: ObserveCliOptions): boolean =>
  options.acquire !== undefined ||
  options.source !== undefined ||
  options.content !== undefined ||
  options.output !== undefined ||
  options.sampleFps !== undefined ||
  options.captureFps !== undefined ||
  options.viewport !== undefined ||
  options.crop !== undefined ||
  browserBindingFlagsPresent(options) ||
  options.debug === true;

const fileOutputPath = (uri: string): string | undefined =>
  uri.startsWith("file://") && uri.length > "file://".length
    ? uri.slice("file://".length)
    : undefined;

const isCacheOutput = (value: string): boolean =>
  value === "cache" || value.startsWith("cache://");

const parseJsonRecord = (value: string): Record<string, unknown> | undefined => {
  if (!value.trim().startsWith("{")) return undefined;

  const parsed: unknown = JSON.parse(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined;
};

const integerFromUnknown = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return undefined;
};

const parseKeyedIntegers = (value: string): Record<string, number> => {
  const result: Record<string, number> = {};
  const matches = value.matchAll(/\b(x|y|w|h|width|height)\b\s*[:=]\s*(-?\d+)/gi);

  for (const match of matches) {
    result[match[1]!.toLowerCase()] = Number(match[2]);
  }

  return result;
};

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;
const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const parseViewport = (
  value: string | undefined
): { readonly value?: ViewportValue; readonly error?: string } => {
  if (value === undefined) return {};

  const trimmed = value.trim();
  try {
    const json = parseJsonRecord(trimmed);
    if (json !== undefined) {
      const width = integerFromUnknown(json.width ?? json.w);
      const height = integerFromUnknown(json.height ?? json.h);
      if (width !== undefined && height !== undefined && isPositiveInteger(width) && isPositiveInteger(height)) {
        return { value: { width, height } };
      }
      return { error: "--viewport must contain positive integer width and height." };
    }
  } catch (cause) {
    return {
      error: `--viewport JSON could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  const dimensions = trimmed.match(/^(\d+)x(\d+)$/i);
  if (dimensions !== null) {
    return {
      value: {
        width: Number(dimensions[1]),
        height: Number(dimensions[2])
      }
    };
  }

  const keyed = parseKeyedIntegers(trimmed);
  const width = keyed.width ?? keyed.w;
  const height = keyed.height ?? keyed.h;
  if (width !== undefined && height !== undefined && isPositiveInteger(width) && isPositiveInteger(height)) {
    return { value: { width, height } };
  }

  return { error: "--viewport must be WIDTHxHEIGHT, JSON, or width=1280,height=720." };
};

const parseCrop = (
  value: string | undefined
): { readonly value?: CropValue; readonly error?: string } => {
  if (value === undefined) return {};

  const trimmed = value.trim();
  try {
    const json = parseJsonRecord(trimmed);
    if (json !== undefined) {
      const x = integerFromUnknown(json.x);
      const y = integerFromUnknown(json.y);
      const width = integerFromUnknown(json.width ?? json.w);
      const height = integerFromUnknown(json.height ?? json.h);
      if (
        x !== undefined &&
        y !== undefined &&
        width !== undefined &&
        height !== undefined &&
        isNonNegativeInteger(x) &&
        isNonNegativeInteger(y) &&
        isPositiveInteger(width) &&
        isPositiveInteger(height)
      ) {
        return { value: { x, y, width, height } };
      }
      return { error: "--crop must contain non-negative integer x/y and positive integer width/height." };
    }
  } catch (cause) {
    return {
      error: `--crop JSON could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`
    };
  }

  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length === 4 && parts.every((part) => /^-?\d+$/.test(part))) {
    const [x, y, width, height] = parts.map((part) => Number(part)) as [number, number, number, number];
    if (
      isNonNegativeInteger(x) &&
      isNonNegativeInteger(y) &&
      isPositiveInteger(width) &&
      isPositiveInteger(height)
    ) {
      return { value: { x, y, width, height } };
    }
  }

  const keyed = parseKeyedIntegers(trimmed);
  const x = keyed.x;
  const y = keyed.y;
  const width = keyed.width ?? keyed.w;
  const height = keyed.height ?? keyed.h;
  if (
    x !== undefined &&
    y !== undefined &&
    width !== undefined &&
    height !== undefined &&
    isNonNegativeInteger(x) &&
    isNonNegativeInteger(y) &&
    isPositiveInteger(width) &&
    isPositiveInteger(height)
  ) {
    return { value: { x, y, width, height } };
  }

  return { error: "--crop must be X,Y,W,H, JSON, or x=0,y=0,width=1280,height=720." };
};

const resolveFileObserveRequest = (options: ObserveCliOptions): ObserveRequest => {
  const errors: string[] = [];
  const outputPath = options.output === undefined ? undefined : fileOutputPath(options.output);

  if (options.source === undefined || options.source.trim() === "") {
    errors.push("M1 observe requires --source <path> for file acquisition.");
  }

  if (options.content !== "football") {
    errors.push("M1 observe accepts --content football.");
  }

  if (options.output === undefined) {
    errors.push("M1 observe requires --output file://<path>.");
  } else if (isCacheOutput(options.output)) {
    errors.push("FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode.");
  } else if (outputPath === undefined || outputPath.trim() === "") {
    errors.push("M1 observe accepts only debug file output URIs such as file://out/match.mp4.");
  }

  if (
    options.sampleFps !== undefined &&
    (!Number.isFinite(options.sampleFps) || options.sampleFps <= 0)
  ) {
    errors.push("--sample-fps must be a positive number when provided.");
  }

  if (options.captureFps !== undefined) {
    errors.push("--capture-fps is scoped to --acquire webcapture.");
  }

  if (options.viewport !== undefined) {
    errors.push("--viewport is scoped to --acquire webcapture.");
  }

  if (options.crop !== undefined) {
    errors.push("--crop is scoped to --acquire webcapture.");
  }

  if (browserBindingFlagsPresent(options)) {
    errors.push("--browser-kind, --browser-endpoint, and --browser-page-name are scoped to --acquire webcapture.");
  }

  if (errors.length > 0 || outputPath === undefined || options.source === undefined) {
    return { _tag: "invalid", errors };
  }

  return {
    _tag: "fileDebug",
    source: options.source,
    outputUri: options.output!,
    outputPath,
    sampleFps: options.sampleFps
  };
};

const resolveWebCaptureObserveRequest = (options: ObserveCliOptions): ObserveRequest => {
  const errors: string[] = [];
  const outputPath = options.output === undefined ? undefined : fileOutputPath(options.output);
  const viewport = parseViewport(options.viewport);
  const crop = parseCrop(options.crop);
  const browserBinding = resolveBrowserBindingPlan(options);

  if (options.source === undefined || options.source.trim() === "") {
    errors.push("WebCapture observe requires --source <url>.");
  }

  if (options.content !== "football") {
    errors.push("WebCapture observe accepts --content football.");
  }

  if (options.output === undefined) {
    errors.push("WebCapture observe requires --output file://<path>, --output local, or --output forwarder.");
  } else if (isCacheOutput(options.output)) {
    errors.push("FlowStream observe rejects --output cache; cache is host policy/evidence, not an output mode.");
  } else if (
    options.output !== "local" &&
    options.output !== "forwarder" &&
    (outputPath === undefined || outputPath.trim() === "")
  ) {
    errors.push(
      "WebCapture observe accepts only forwarder, local, or debug file output URIs such as file://out/webcapture.json."
    );
  }

  if (options.output === "forwarder" && options.debug === true) {
    errors.push("--debug is scoped to WebCapture local output; forwarder is never debug.");
  }

  if (options.sampleFps !== undefined) {
    errors.push("--sample-fps is scoped to --acquire file.");
  }

  if (options.captureFps === undefined) {
    errors.push("WebCapture observe requires --capture-fps <fps>.");
  } else if (!Number.isFinite(options.captureFps) || options.captureFps <= 0) {
    errors.push("--capture-fps must be a positive number when provided.");
  }

  if (viewport.error !== undefined) {
    errors.push(viewport.error);
  }

  if (crop.error !== undefined) {
    errors.push(crop.error);
  }

  errors.push(...browserBinding.errors);

  if (
    viewport.value !== undefined &&
    crop.value !== undefined &&
    (crop.value.x + crop.value.width > viewport.value.width ||
      crop.value.y + crop.value.height > viewport.value.height)
  ) {
    errors.push("--crop must fit inside --viewport.");
  }

  if (errors.length > 0 || options.source === undefined || options.output === undefined || options.captureFps === undefined) {
    return { _tag: "invalid", errors };
  }

  return {
    _tag: "webCapture",
    source: options.source,
    output: options.output === "local"
      ? { mode: "local", uri: "local" }
      : options.output === "forwarder"
        ? { mode: "forwarder", uri: "forwarder" }
        : { mode: "file", uri: options.output, path: outputPath! },
    captureFps: options.captureFps,
    viewport: viewport.value,
    crop: crop.value,
    ...(browserBinding.plan?.configured === true ? { browserBinding: browserBinding.plan } : {}),
    ...(options.debug === true ? { debug: true as const } : {})
  };
};

export const resolveObserveRequest = (options: ObserveCliOptions): ObserveRequest => {
  if (!hasObserveInput(options)) return { _tag: "shell" };

  if (options.acquire === "file") return resolveFileObserveRequest(options);
  if (options.acquire === "webcapture") return resolveWebCaptureObserveRequest(options);

  return {
    _tag: "invalid",
    errors: ["observe accepts --acquire file or --acquire webcapture."]
  };
};

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

type FileAcquireConfig = {
  readonly path: string;
  readonly sampleFps?: number;
};

const hasDriverMethods = (entry: unknown): entry is AcquireDriver<unknown> =>
  typeof entry === "object" &&
  entry !== null &&
  "validate" in entry &&
  typeof entry.validate === "function" &&
  "create" in entry &&
  typeof entry.create === "function";

const getFileAcquireDriver = (): AcquireDriver<FileAcquireConfig> | undefined => {
  const entry = builtInStatsRegistry.acquireDrivers.find(
    (item) => item.descriptor.id === "file"
  );

  return hasDriverMethods(entry)
    ? (entry as AcquireDriver<FileAcquireConfig>)
    : undefined;
};

const runFileDebugObserve = (
  request: Extract<ObserveRequest, { readonly _tag: "fileDebug" }>
) =>
  Effect.gen(function* () {
    const fileAcquireDriver = getFileAcquireDriver();

    if (fileAcquireDriver === undefined) {
      yield* printJson({
        ok: true,
        command: "observe",
        status: "scaffold",
        message:
          "Accepted the local file debug broadcast arguments, but the FileSource worker is not exposed by the stats SDK registry yet.",
        mode: "file-debug-broadcast",
        scaffold: {
          mediaStarted: false,
          reason:
            "The CLI does not fabricate media success. It will compose makeBroadcastSession once the public file acquire worker is available."
        },
        input: {
          acquire: "file",
          source: request.source,
          content: "football",
          sampleFps: request.sampleFps ?? null
        },
        output: {
          uri: request.outputUri,
          path: request.outputPath,
          mode: "file"
        }
      });
      return;
    }

    const session = yield* makeBroadcastSession({
      owner: "cli-re",
      debug: true,
      acquire: {
        driver: fileAcquireDriver,
        config: {
          path: request.source,
          ...(request.sampleFps === undefined ? {} : { sampleFps: request.sampleFps })
        }
      },
      content: {
        pack: footballContentPack,
        config: {}
      },
      output: {
        handler: fileOutputHandler,
        config: {
          path: request.outputPath
        }
      }
    });

    const prepared = yield* session.prepare;
    const health = yield* session.health;
    const stopped = yield* session.stop;

    yield* printJson({
      ok: true,
      command: "observe",
      status: "scaffold",
      message:
        "Composed a local file debug broadcast session through the stats SDK and finalized the scaffold probe. No media artifact was claimed or written by the CLI.",
      mode: "file-debug-broadcast",
      scaffold: {
        mediaStarted: false,
        reason:
          "The CLI shell composes file/football/file built-ins and stops before reporting media success until FileSource, football processing, and FileOutput are integrated end-to-end."
      },
      session: {
        id: session.id,
        runtime: stopped,
        preparedRuntime: prepared,
        descriptor: session.descriptor
      },
      input: {
        acquire: "file",
        source: request.source,
        content: "football",
        sampleFps: request.sampleFps ?? null
      },
      output: {
        uri: request.outputUri,
        path: request.outputPath,
        mode: "file"
      },
      health
    });
  }).pipe(
    Effect.catchAll((error) =>
      printJson({
        ok: false,
        command: "observe",
        status: "sdk-error",
        message: "The observe command reached the stats SDK, but session preparation failed.",
        error: formatCliError(error)
      })
    )
  );

const observeHostBinding = {
  selectedProvider: null,
  loggedIn: false,
  configBound: false,
  message:
    "No host login or provider config is bound in this CLI; observe live output readiness is a local scaffold only."
} as const;

const observeOwnership = {
  cli: "Parses observe arguments and displays readiness JSON only.",
  hostProviderClient: "SDK HostProviderClient owns host policy evaluation, enforcement, endpoint manifests, and cache receipts.",
  outputHandlers:
    "SDK forwarder/local output handlers own attachment behavior once a real HostProviderClient is bound.",
  runtimeStore: "SDK RuntimeStore owns durable session lifecycle later; this observe CLI does not query or mutate it.",
  steward: "Not involved; host is not steward."
} as const;

export type ObserveReadinessKind = "file-debug" | "local-debug" | "host-required";

export const observeReadinessKind = (request: ObserveRequest): ObserveReadinessKind | undefined => {
  if (request._tag === "fileDebug") return "file-debug";
  if (request._tag !== "webCapture") return undefined;
  if (request.output.mode === "file") return "file-debug";
  if (request.output.mode === "local" && request.debug === true) return "local-debug";
  return "host-required";
};

const observeModeExplanation = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>
): string => {
  if (request.output.mode === "local" && request.debug === true) {
    return "WebCapture local --debug is an explicit local debug readiness path; host/cache may be skipped.";
  }

  if (request.output.mode === "local") {
    return "WebCapture local without --debug requires a selected host provider for local host-cache policy.";
  }

  if (request.output.mode === "forwarder") {
    return "WebCapture forwarder requires host live forwarding plus host cache evidence from a selected provider.";
  }

  return "WebCapture file output is a debug readiness path.";
};

const browserBindingPlanFor = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>
): BrowserBindingPlan => request.browserBinding ?? resolveBrowserBindingPlan({}).plan!;

const defaultBrowserViewport = {
  width: 1280,
  height: 720
} as const;

export const evaluateObserveHostPolicyPreview = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>
) =>
  Effect.gen(function* () {
    const client = yield* makeInMemoryHostProviderClient({
      hostId: "observe-preview-in-memory-host",
      cloudflareLike: true
    });

    return yield* client.evaluatePolicy({
      outputMode: request.output.mode,
      debug: request.output.mode === "local" && request.debug === true,
      contentId: "football",
      observer: "observe-cli-preview"
    });
  });

export const webCapturePolicyReadinessPayload = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>,
  policy: HostPolicyResult | null
) => {
  const localDebug = request.output.mode === "local" && request.debug === true;
  const hostRequired = request.output.mode === "forwarder" || (request.output.mode === "local" && !localDebug);
  const browserBinding = browserBindingPlanFor(request);

  return {
    ok: !hostRequired,
    command: "observe",
    status: localDebug ? "local-debug-readiness" : "host-required-readiness",
    message: localDebug
      ? "WebCapture local debug readiness parsed. No host cache, endpoint manifest, session, or media output was requested."
      : "WebCapture live output readiness parsed, but a selected host provider is required before this can become a real session.",
    mode: "webcapture-readiness",
    binding: observeHostBinding,
    browserBinding: browserBindingReadinessPayload(browserBinding),
    ownership: observeOwnership,
    input: {
      acquire: "webcapture",
      source: request.source,
      content: "football",
      captureFps: request.captureFps,
      viewport: request.viewport ?? null,
      crop: request.crop ?? null,
      debug: localDebug
    },
    output: {
      mode: request.output.mode,
      uri: request.output.uri,
      debug: localDebug,
      hostRequired
    },
    readiness: {
      browserStarted: false,
      captureStarted: false,
      browserBindingConfigured: browserBinding.configured,
      browserPageAdapterDeliveredToSdk: false,
      framesDelivered: false,
      mediaForwardingClaimed: false,
      selectedHostProviderRequired: hostRequired,
      selectedHostProviderBound: false,
      endpointManifestIssued: false,
      hostCacheReceiptIssued: false,
      runtimeStoreTouched: false
    },
    modeExplanation: observeModeExplanation(request),
    hostPolicyPreview: policy === null
      ? {
          skipped: true,
          reason: "local --debug can skip host/cache; no in-memory provider shape preview was needed."
        }
      : {
          skipped: false,
          label:
            "Provider-agnostic in-memory shape preview only; this is not host login, provider config, a session, a manifest, or a cache receipt.",
          owner: "HostProviderClient",
          issuedBy: "makeInMemoryHostProviderClient",
          sdkPolicy: {
            descriptor: policy.descriptor,
            outputMode: policy.outputMode,
            cache: policy.cache,
            live: policy.live,
            blockReasons: policy.blockReasons,
            constraints: policy.constraints
          }
        },
    limitations: [
      "No real host is bound.",
      "Browser launch and page adapters are CLI/caller owned, not sdk-stats owned.",
      "No endpoint manifest/cache receipt was issued.",
      "No browser page adapter was delivered to sdk-stats.",
      "No WebCapture frames were delivered.",
      "No media forwarding is claimed.",
      "No forwarder/local output handler attach was called from the CLI.",
      "RuntimeStore integration is later SDK-owned work.",
      "Cache is host policy/evidence, not an output mode."
    ]
  };
};

const runWebCapturePolicyReadiness = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>
) => {
  if (request.output.mode === "local" && request.debug === true) {
    return printJson(webCapturePolicyReadinessPayload(request, null));
  }

  return evaluateObserveHostPolicyPreview(request).pipe(
    Effect.map((policy) => webCapturePolicyReadinessPayload(request, policy)),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "observe",
        status: "sdk-error",
        message: "Observe host-policy readiness preview failed before a scaffold could be reported.",
        binding: observeHostBinding,
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );
};

export const webCaptureBrowserReadinessPayload = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>,
  delivery?: BrowserBindingDeliveryProof,
  deliveryError?: unknown,
  adapterFactoryInjected = delivery?.adapterFactoryInjected ?? false
) => {
  const browserBinding = browserBindingPlanFor(request);
  const binding = {
    ...browserBindingReadinessPayloadWithDelivery(browserBinding, delivery),
    adapterFactoryInjected
  };
  const error = deliveryError ?? (
    browserBinding.configured && delivery === undefined
      ? browserBindingDeliveryNotReadyError(browserBinding)
      : undefined
  );
  const delivered = delivery?.pageAdapterDeliveredToSdk === true;
  const errorPayload = error === undefined ? undefined : browserBindingErrorPayload(error);

  return {
    ok: delivered,
    command: "observe",
    status: delivered
      ? "browser-page-adapter-delivered"
      : browserBinding.configured
        ? "browser-binding-not-ready"
        : "missing-browser-binding",
    message: delivered
      ? "WebCapture browser binding delivered an injected page adapter through sdk-stats. No browser launch or media-frame delivery was claimed."
      : browserBinding.configured
        ? "WebCapture browser binding parsed, but an injected CLI page factory must succeed before observe can claim adapter delivery."
        : "WebCapture observe needs a CLI/caller browser binding before a browser page adapter can be delivered to sdk-stats.",
    mode: "webcapture-readiness",
    browserBinding: binding,
    ownership: {
      ...observeOwnership,
      browser:
        "Browser launch/control and page adapter construction are CLI/caller owned; sdk-stats only consumes an injected BrowserCaptureAdapter."
    },
    input: {
      acquire: "webcapture",
      source: request.source,
      content: "football",
      captureFps: request.captureFps,
      viewport: request.viewport ?? null,
      crop: request.crop ?? null,
      debug: request.debug === true
    },
    output: request.output,
    readiness: {
      browserBindingConfigured: browserBinding.configured,
      browserStarted: false,
      browserLaunchClaimed: false,
      captureStarted: false,
      browserPageAdapterDeliveredToSdk: delivered,
      framesDelivered: delivery?.framesDelivered ?? false,
      mediaForwardingClaimed: false,
      runtimeStoreTouched: false
    },
    ...(errorPayload === undefined ? {} : { error: errorPayload }),
    limitations: [
      "No browser dependency was installed by sdk-stats.",
      delivered
        ? "No browser launch was attempted by this readiness scaffold; the page came from an injected external binding."
        : "No browser launch or hidden CDP connection was attempted by this readiness scaffold.",
      delivered
        ? "The page adapter was opened only as a delivery proof; no WebCapture frame stream was consumed."
        : "No browser page adapter was delivered to sdk-stats.",
      "No WebCapture frames were delivered.",
      "Source FPS remains source-owned captureFps."
    ]
  };
};

const stringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== "object" || value === null || !(property in value)) return undefined;

  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === "string" ? propertyValue : undefined;
};

const browserBindingErrorPayload = (error: unknown) => ({
  ...formatCliError(error),
  readinessCode: stringProperty(error, "readinessCode"),
  bridgeCode: stringProperty(error, "bridgeCode"),
  adapterKind: stringProperty(error, "adapterKind"),
  requiredMethod: stringProperty(error, "requiredMethod"),
  method: stringProperty(error, "method")
});

export const evaluateWebCaptureBrowserReadinessPayload = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>,
  runtime: BrowserBindingAdapterRuntime = {}
) => {
  const browserBinding = browserBindingPlanFor(request);

  if (!browserBinding.configured) {
    return Effect.succeed(webCaptureBrowserReadinessPayload(request));
  }

  return deliverBrowserBindingToSdk(
    browserBinding,
    {
      url: request.source,
      viewport: request.viewport ?? defaultBrowserViewport,
      interactive: false,
      debug: request.debug
    },
    runtime
  ).pipe(
    Effect.map((delivery) => webCaptureBrowserReadinessPayload(request, delivery)),
    Effect.catchAll((error) =>
      Effect.succeed(
        webCaptureBrowserReadinessPayload(
          request,
          undefined,
          error,
          browserBinding.mode === "external-cdp" && runtime.externalCdpPage !== undefined
        )
      )
    )
  );
};

const runWebCaptureObserve = (
  request: Extract<ObserveRequest, { readonly _tag: "webCapture" }>
) =>
  Effect.gen(function* () {
    if (request.output.mode === "local" || request.output.mode === "forwarder") {
      yield* runWebCapturePolicyReadiness(request);
      return;
    }

    const payload = yield* evaluateWebCaptureBrowserReadinessPayload(request);
    yield* printJson(payload);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const formatted = formatCliError(error);

        yield* printJson({
          ok: false,
          command: "observe",
          status: "sdk-error",
          message:
            "WebCapture observe parsed successfully, but the CLI browser readiness scaffold failed before any browser adapter could be delivered to sdk-stats.",
          mode: "webcapture-readiness",
          scaffold: {
            browserStarted: false,
            captureStarted: false
          },
          error: formatted
        });
      })
    )
  );

export const observeRegistryHelp = (): string => {
  const acquireSections = builtInStatsRegistry.acquireDrivers.map((driver) => {
    const flags = driver.descriptor.flags.map((flag) => `  --${flag.name}: ${flag.help}`).join("\n");
    const commands = driver.descriptor.commands.map((command) => `  ${command.scope}: ${command.help}`).join("\n");

    return [
      `${driver.descriptor.displayName} (${driver.descriptor.id})`,
      driver.descriptor.summary ?? "",
      "Flags:",
      flags.length > 0 ? flags : "  none",
      "Controls:",
      commands.length > 0 ? commands : "  none"
    ].filter((line) => line.length > 0).join("\n");
  });

  return `OBSERVE ACQUIRE REGISTRY

${acquireSections.join("\n\n")}`;
};

export const runObserve = (
  options: ObserveCliOptions,
  shell: Effect.Effect<void>
): Effect.Effect<void> => {
  const request = resolveObserveRequest(options);

  switch (request._tag) {
    case "shell":
      return shell;
    case "invalid":
      return printJson({
        ok: false,
        command: "observe",
        status: "invalid-args",
        message: "observe accepts separate file debug and WebCapture readiness argument shapes.",
        errors: request.errors,
        examples: {
          file: observeExample,
          webcapture: webCaptureExample
        }
      });
    case "fileDebug":
      return runFileDebugObserve(request);
    case "webCapture":
      return runWebCaptureObserve(request);
  }
};
