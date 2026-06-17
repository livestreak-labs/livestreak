import { Options } from "@effect/cli";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Console, Effect, Option } from "effect";
import { FlowStreamConfigError, type FlowStreamError } from "@flowstream-re/core";
import {
  makeHttpHostProviderClient,
  makeInMemoryHostProviderClient,
  type HostPolicyResult,
  type HostProviderFetch,
  type HostProviderFetchRequest,
  type HostProviderFetchResponse,
  type SelectedHttpHostProviderConfig
} from "@flowstream-re/sdk-stats";
import type {
  HostProviderDescriptor,
  HostCapability
} from "@flowstream-re/schema";
import { formatCliError } from "./cli-error.js";

export type HostPolicyOutput = "forwarder" | "local" | "file";
export type HostPolicyContent = "football";

export interface HostPolicyCliOptions {
  readonly output?: string;
  readonly content?: string;
  readonly observer?: string;
  readonly debug: boolean;
  readonly expectedDurationSeconds?: number;
  readonly expectedCacheBytes?: number;
}

export interface HostProviderCliOptions {
  readonly provider?: string;
  readonly url?: string;
  readonly apiKey?: string;
  readonly bearerToken?: string;
  readonly configPath?: string;
}

export interface PersistedHostProviderConfig {
  readonly version: "0.1.0";
  readonly selectedProvider: SelectedHttpHostProviderConfig;
  readonly descriptor?: HostProviderDescriptor;
  readonly updatedAtMs: number;
}

export interface HostProviderConfigStore {
  readonly read: Effect.Effect<PersistedHostProviderConfig | null, FlowStreamConfigError>;
  readonly write: (config: PersistedHostProviderConfig) => Effect.Effect<void, FlowStreamConfigError>;
}

export interface HostProviderFileSystem {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<void>;
}

export interface HostProviderRuntime {
  readonly fetch: HostProviderFetch;
  readonly store: HostProviderConfigStore;
}

export type HostPolicyRequest =
  | { readonly _tag: "invalid"; readonly errors: readonly string[] }
  | {
      readonly _tag: "preview";
      readonly output: HostPolicyOutput;
      readonly content: HostPolicyContent;
      readonly observer: string;
      readonly debug: boolean;
      readonly expectedDurationSeconds?: number;
      readonly expectedCacheBytes?: number;
    };

const acceptedOutputs = ["forwarder", "local", "file"] as const;
const acceptedProviders = ["http"] as const;
const configVersion = "0.1.0" as const;
const defaultHostConfigPath = () => join(homedir(), ".flowstream-re", "host.json");

const hostBinding = {
  selectedProvider: null,
  loggedIn: false,
  configBound: false,
  message:
    "No host login or provider config is bound in this CLI; policy output is a local preview scaffold only."
} as const;

const policyOwner = {
  cli: "Parses arguments and displays SDK policy previews.",
  sdk: "Owns host policy behavior through HostProviderClient.",
  host: "Supplies real provider config, endpoint manifests, cache receipts, and live forwarding evidence when bound.",
  steward: "Not involved; host is not steward."
} as const;

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

const userConfigError = (message: string, details: string): FlowStreamConfigError =>
  new FlowStreamConfigError({
    message,
    metadata: {
      details,
      retryable: false
    }
  });

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const safeNonNegativeInteger = (value: number | undefined): boolean =>
  value === undefined || (Number.isSafeInteger(value) && value >= 0);

const parseOutput = (value: string | undefined): HostPolicyOutput | undefined =>
  acceptedOutputs.includes(value as HostPolicyOutput)
    ? (value as HostPolicyOutput)
    : undefined;

const modeExplanation = (output: HostPolicyOutput, debug: boolean): string => {
  if (output === "local" && debug) {
    return "local --debug may skip host cache because it is a debug/local preview path.";
  }

  if (output === "local") {
    return "local without --debug requires host cache and live policy evidence from a selected provider.";
  }

  if (output === "file") {
    return "file is debug/demo output; it is not a hosted cache output mode.";
  }

  return "forwarder requires live forwarding plus host cache evidence from a selected provider.";
};

export const hostPolicyOptions = {
  output: Options.text("output").pipe(
    Options.withDescription("Hosted output shape to preview. Accepted: forwarder, local, file. cache is rejected as policy/evidence.")
  ),
  content: Options.choice("content", ["football"] as const).pipe(
    Options.withDescription("Content pack for the policy preview.")
  ),
  observer: Options.text("observer").pipe(
    Options.withDescription("Observer id for the host policy preview.")
  ),
  debug: Options.boolean("debug").pipe(
    Options.withDescription("Preview debug policy allowances.")
  ),
  expectedDurationSeconds: Options.integer("expected-duration").pipe(
    Options.optional,
    Options.withDescription("Expected live duration in seconds.")
  ),
  expectedCacheBytes: Options.integer("expected-cache-bytes").pipe(
    Options.optional,
    Options.withDescription("Expected host cache bytes.")
  )
};

export const hostProviderOptions = {
  provider: Options.choice("provider", acceptedProviders).pipe(
    Options.withDescription("Host provider binding to configure. Current production binding: http.")
  ),
  url: Options.text("url").pipe(
    Options.withDescription("HTTP host provider base URL.")
  ),
  apiKey: Options.text("api-key").pipe(
    Options.optional,
    Options.withDescription("HTTP host provider API key.")
  ),
  bearerToken: Options.text("bearer-token").pipe(
    Options.optional,
    Options.withDescription("HTTP host provider bearer token.")
  ),
  configPath: Options.text("config-path").pipe(
    Options.optional,
    Options.withDescription("Host provider config JSON path.")
  )
};

export const hostReadinessOptions = {
  configPath: Options.text("config-path").pipe(
    Options.optional,
    Options.withDescription("Host provider config JSON path.")
  )
};

export const normalizeHostPolicyOptions = (options: {
  readonly output: string;
  readonly content: HostPolicyContent;
  readonly observer: string;
  readonly debug: boolean;
  readonly expectedDurationSeconds: Option.Option<number>;
  readonly expectedCacheBytes: Option.Option<number>;
}): HostPolicyCliOptions => ({
  output: options.output,
  content: options.content,
  observer: options.observer,
  debug: options.debug,
  expectedDurationSeconds: optionValue(options.expectedDurationSeconds),
  expectedCacheBytes: optionValue(options.expectedCacheBytes)
});

export const normalizeHostProviderOptions = (options: {
  readonly provider: "http";
  readonly url: string;
  readonly apiKey: Option.Option<string>;
  readonly bearerToken: Option.Option<string>;
  readonly configPath: Option.Option<string>;
}): HostProviderCliOptions => ({
  provider: options.provider,
  url: options.url,
  apiKey: optionValue(options.apiKey),
  bearerToken: optionValue(options.bearerToken),
  configPath: optionValue(options.configPath)
});

export const normalizeHostReadinessOptions = (options: {
  readonly configPath: Option.Option<string>;
}): Pick<HostProviderCliOptions, "configPath"> => ({
  configPath: optionValue(options.configPath)
});

export const parseHostPolicyRequest = (
  options: HostPolicyCliOptions
): HostPolicyRequest => {
  const errors: string[] = [];
  const output = parseOutput(options.output);
  const content = options.content === "football" ? "football" : undefined;
  const observer = nonEmpty(options.observer);

  if (output === undefined) {
    errors.push(
      options.output === "cache"
        ? "host policy rejects --output cache; cache is host policy/evidence, not an output mode."
        : "host policy requires --output forwarder|local|file."
    );
  }

  if (content === undefined) {
    errors.push("host policy requires --content football.");
  }

  if (observer === undefined) {
    errors.push("host policy requires --observer <id>.");
  }

  if (!safeNonNegativeInteger(options.expectedDurationSeconds)) {
    errors.push("--expected-duration must be a non-negative safe integer.");
  }

  if (!safeNonNegativeInteger(options.expectedCacheBytes)) {
    errors.push("--expected-cache-bytes must be a non-negative safe integer.");
  }

  return errors.length > 0
    ? { _tag: "invalid", errors }
    : {
        _tag: "preview",
        output: output!,
        content: content!,
        observer: observer!,
        debug: options.debug,
        expectedDurationSeconds: options.expectedDurationSeconds,
        expectedCacheBytes: options.expectedCacheBytes
      };
};

const selectedProviderView = (config: SelectedHttpHostProviderConfig) => ({
  provider: config.provider,
  baseUrl: config.baseUrl,
  auth: {
    apiKey: config.apiKey === undefined ? "missing" : "configured",
    bearerToken: config.bearerToken === undefined ? "missing" : "configured"
  }
});

const requiredCapabilityStatus = (
  descriptor: HostProviderDescriptor
): Record<HostCapability, boolean> => ({
  webrtc_forwarding: descriptor.capabilities.includes("webrtc_forwarding"),
  host_cache: descriptor.capabilities.includes("host_cache"),
  endpoint_manifests: descriptor.capabilities.includes("endpoint_manifests"),
  thumbnails: descriptor.capabilities.includes("thumbnails"),
  audit_logs: descriptor.capabilities.includes("audit_logs"),
  key_rotation: descriptor.capabilities.includes("key_rotation")
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || isString(value);

const isSelectedHttpConfig = (value: unknown): value is SelectedHttpHostProviderConfig =>
  isObject(value) &&
  value.provider === "http" &&
  isString(value.baseUrl) &&
  isOptionalString(value.apiKey) &&
  isOptionalString(value.bearerToken);

const isPersistedHostProviderConfig = (value: unknown): value is PersistedHostProviderConfig =>
  isObject(value) &&
  value.version === configVersion &&
  isSelectedHttpConfig(value.selectedProvider) &&
  typeof value.updatedAtMs === "number" &&
  Number.isFinite(value.updatedAtMs);

const parseProviderConfig = (
  options: HostProviderCliOptions
): Effect.Effect<SelectedHttpHostProviderConfig, FlowStreamConfigError> =>
  Effect.gen(function* () {
    const provider = nonEmpty(options.provider) ?? "http";
    const baseUrl = nonEmpty(options.url);
    const apiKey = nonEmpty(options.apiKey);
    const bearerToken = nonEmpty(options.bearerToken);

    if (provider !== "http") {
      return yield* Effect.fail(
        userConfigError("host provider config supports only --provider http", provider)
      );
    }

    if (baseUrl === undefined) {
      return yield* Effect.fail(
        userConfigError("host provider config requires --url <http-url>", "url")
      );
    }

    return {
      provider: "http",
      baseUrl,
      apiKey,
      bearerToken
    };
  });

const normalizeProviderBaseUrl = (baseUrl: string): Effect.Effect<string, FlowStreamConfigError> =>
  Effect.try({
    try: () => new URL(baseUrl),
    catch: (cause) => userConfigError("host provider config requires a valid --url", String(cause))
  }).pipe(
    Effect.flatMap((url) => {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return Effect.fail(userConfigError("host provider --url must use http or https", baseUrl));
      }

      url.pathname = url.pathname.replace(/\/+$/, "");
      url.search = "";
      url.hash = "";

      return Effect.succeed(url.toString().replace(/\/$/, ""));
    })
  );

const validateProviderAuth = (
  apiKey: string | undefined,
  bearerToken: string | undefined
): Effect.Effect<void, FlowStreamConfigError> => {
  if (apiKey === undefined && bearerToken === undefined) {
    return Effect.fail(
      userConfigError("HTTP host provider config requires apiKey or bearerToken", "auth")
    );
  }

  return Effect.void;
};

const validateSelectedProviderConfig = (
  config: SelectedHttpHostProviderConfig
): Effect.Effect<SelectedHttpHostProviderConfig, FlowStreamConfigError> =>
  Effect.gen(function* () {
    const baseUrl = yield* normalizeProviderBaseUrl(config.baseUrl);
    yield* validateProviderAuth(config.apiKey, config.bearerToken);

    return {
      provider: "http",
      baseUrl,
      apiKey: config.apiKey,
      bearerToken: config.bearerToken
    };
  });

const persistedConfig = (
  selectedProvider: SelectedHttpHostProviderConfig,
  descriptor: HostProviderDescriptor | undefined,
  nowMs: number
): PersistedHostProviderConfig => ({
  version: configVersion,
  selectedProvider,
  descriptor,
  updatedAtMs: nowMs
});

export const makeMemoryHostConfigStore = (
  initial: PersistedHostProviderConfig | null = null
): HostProviderConfigStore => {
  let current = initial;

  return {
    read: Effect.sync(() => current),
    write: (config) =>
      Effect.sync(() => {
        current = config;
      })
  };
};

export const makeFileHostConfigStore = (
  path: string,
  fs: HostProviderFileSystem
): HostProviderConfigStore => ({
  read: Effect.tryPromise({
    try: async () => {
      try {
        const data = await fs.readFile(path);
        const parsed: unknown = JSON.parse(data);

        if (!isPersistedHostProviderConfig(parsed)) {
          throw userConfigError("Host provider config file is invalid", path);
        }

        return parsed;
      } catch (error) {
        if ((error as { readonly code?: string }).code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },
    catch: (cause) =>
      cause instanceof FlowStreamConfigError
        ? cause
        : userConfigError("Could not read host provider config", String(cause))
  }),
  write: (config) =>
    Effect.tryPromise({
      try: async () => {
        await fs.mkdir(dirname(path));
        await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
      },
      catch: (cause) => userConfigError("Could not write host provider config", String(cause))
    })
});

const nodeHostFileSystem: HostProviderFileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, data) => writeFile(path, data, "utf8"),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined)
};

const globalFetchProvider: HostProviderFetch = async (
  input: string,
  init: HostProviderFetchRequest
): Promise<HostProviderFetchResponse> => {
  if (globalThis.fetch === undefined) {
    throw userConfigError("HTTP fetch is unavailable in this CLI runtime", "fetch");
  }

  const response = await globalThis.fetch(input, {
    method: init.method,
    headers: init.headers,
    body: init.body
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json()
  };
};

const hostRuntime = (configPath: string | undefined): HostProviderRuntime => ({
  fetch: globalFetchProvider,
  store: makeFileHostConfigStore(configPath ?? defaultHostConfigPath(), nodeHostFileSystem)
});

export const hostConfigurePayload = (config: PersistedHostProviderConfig) => ({
  ok: true,
  command: "host configure",
  status: "configured",
  message:
    "Selected host provider config was saved. No provider login was attempted and no steward server is implied.",
  binding: {
    selectedProvider: selectedProviderView(config.selectedProvider),
    configBound: true,
    loggedIn: false,
    updatedAtMs: config.updatedAtMs
  },
  readiness: {
    canCreateHttpClient: true,
    productionSteward: false,
    cacheOutputMode: false
  },
  ownership: policyOwner,
  next: ["host login --provider http --url <url> --api-key <key>", "host readiness"]
});

export const hostLoginPayload = (
  config: PersistedHostProviderConfig,
  descriptor: HostProviderDescriptor,
  constraints: readonly unknown[]
) => ({
  ok: true,
  command: "host login",
  status: "logged-in",
  message:
    "Selected host provider responded through HostProviderClient. Host evidence is provider-owned; steward behavior is not configured here.",
  binding: {
    selectedProvider: selectedProviderView(config.selectedProvider),
    configBound: true,
    loggedIn: true,
    updatedAtMs: config.updatedAtMs
  },
  provider: descriptor,
  constraints,
  readiness: {
    canCreateHttpClient: true,
    requiredCapabilities: requiredCapabilityStatus(descriptor),
    productionSteward: false,
    cacheOutputMode: false
  },
  ownership: policyOwner
});

export const hostReadinessPayload = (
  config: PersistedHostProviderConfig | null,
  descriptor: HostProviderDescriptor | null,
  constraints: readonly unknown[],
  error: ReturnType<typeof formatCliError> | null
) => ({
  ok: config !== null && descriptor !== null && error === null,
  command: "host readiness",
  status: config === null ? "not-configured" : descriptor === null ? "not-ready" : "ready",
  message:
    config === null
      ? "No selected host provider config is saved; non-debug local and forwarder sessions still require a host."
      : descriptor === null
        ? "Selected host provider config exists but could not create a ready HTTP client."
        : "Selected host provider config can create the HTTP HostProviderClient and read provider readiness JSON.",
  binding:
    config === null
      ? hostBinding
      : {
          selectedProvider: selectedProviderView(config.selectedProvider),
          configBound: true,
          loggedIn: descriptor !== null,
          updatedAtMs: config.updatedAtMs
        },
  provider: descriptor,
  constraints,
  readiness: {
    canCreateHttpClient: config !== null,
    requiredCapabilities: descriptor === null ? null : requiredCapabilityStatus(descriptor),
    productionSteward: false,
    cacheOutputMode: false
  },
  ownership: policyOwner,
  error
});

export const configureHostProvider = (
  store: HostProviderConfigStore,
  options: HostProviderCliOptions,
  nowMs = Date.now()
): Effect.Effect<ReturnType<typeof hostConfigurePayload>, FlowStreamError> =>
  Effect.gen(function* () {
    const config = yield* parseProviderConfig(options);
    const selectedProvider = yield* validateSelectedProviderConfig(config);
    const saved = persistedConfig(selectedProvider, undefined, nowMs);
    yield* store.write(saved);

    return hostConfigurePayload(saved);
  });

export const loginHostProvider = (
  runtime: HostProviderRuntime,
  options: HostProviderCliOptions,
  nowMs = Date.now()
): Effect.Effect<ReturnType<typeof hostLoginPayload>, FlowStreamError> =>
  Effect.gen(function* () {
    const config = yield* parseProviderConfig(options);
    const selectedProvider = yield* validateSelectedProviderConfig(config);
    const client = yield* makeHttpHostProviderClient({
      baseUrl: selectedProvider.baseUrl,
      apiKey: selectedProvider.apiKey,
      bearerToken: selectedProvider.bearerToken,
      fetch: runtime.fetch
    });
    const descriptor = yield* client.describe;
    const constraints = yield* client.constraints;
    const saved = persistedConfig(selectedProvider, descriptor, nowMs);
    yield* runtime.store.write(saved);

    return hostLoginPayload(saved, descriptor, constraints);
  });

export const readHostReadiness = (
  runtime: HostProviderRuntime
): Effect.Effect<ReturnType<typeof hostReadinessPayload>, FlowStreamError> =>
  Effect.gen(function* () {
    const saved = yield* runtime.store.read;

    if (saved === null) {
      return hostReadinessPayload(null, null, [], null);
    }

    const selectedProvider = yield* validateSelectedProviderConfig(saved.selectedProvider);
    const client = yield* makeHttpHostProviderClient({
      baseUrl: selectedProvider.baseUrl,
      apiKey: selectedProvider.apiKey,
      bearerToken: selectedProvider.bearerToken,
      fetch: runtime.fetch
    });
    const readiness = yield* Effect.either(
      Effect.all([client.describe, client.constraints])
    );

    if (readiness._tag === "Left") {
      return hostReadinessPayload(saved, null, [], formatCliError(readiness.left));
    }

    const [descriptor, constraints] = readiness.right;
    return hostReadinessPayload(saved, descriptor, constraints, null);
  });

export const hostShellPayload = () => ({
  ok: true,
  command: "host",
  status: "scaffold",
  message:
    "A selected host provider is required for non-debug live/cache sessions; this CLI shell only parses and displays host policy state.",
  binding: hostBinding,
  ownership: policyOwner,
  commands: [
    "host configure --provider http --url <url> (--api-key <key>|--bearer-token <token>)",
    "host login --provider http --url <url> (--api-key <key>|--bearer-token <token>)",
    "host readiness",
    "host describe",
    "host constraints",
    "host policy --output forwarder|local|file --content football --observer <id> [--debug]",
    "host network --mode hosted|local-dev|lan|degraded [--provider cloudflare|generic]"
  ],
  outputModes: {
    accepted: acceptedOutputs,
    rejected: ["cache"],
    cache:
      "Host cache is policy/evidence supplied by a provider; it is not an output mode."
  }
});

export const hostDescribeScaffoldPayload = () => ({
  ok: true,
  command: "host describe",
  status: "scaffold",
  message:
    "No host login or provider config is bound, so this describes the HostProviderClient interface expectations instead of a real provider account.",
  binding: hostBinding,
  ownership: policyOwner,
  providerInterface: {
    describe: "Provider descriptor: host id, base URL, capabilities, outputs, and terms version.",
    constraints: "Provider-specific constraints such as protocol pairing rules.",
    evaluatePolicy: "Preview whether the requested output shape needs live forwarding or host cache.",
    enforcePolicy: "SDK-owned enforcement path for a bound provider.",
    createSession: "SDK-owned endpoint manifest draft creation for a bound provider.",
    submitCacheReceipt: "SDK-owned cache evidence submission for a bound provider."
  },
  selectedProvider: null
});

export const hostConstraintsScaffoldPayload = (
  constraints: readonly unknown[]
) => ({
  ok: true,
  command: "host constraints",
  status: "scaffold",
  message:
    "No real host provider is selected; constraints shown here are SDK-accessible provider-model notes for display only.",
  binding: hostBinding,
  constraints,
  providerAgnosticNotes: [
    "local --debug may skip host cache.",
    "local without --debug requires host cache.",
    "file is debug/demo output.",
    "forwarder requires live forwarding plus cache evidence."
  ]
});

export const hostPolicyPreviewPayload = (
  request: Extract<HostPolicyRequest, { readonly _tag: "preview" }>,
  policy: HostPolicyResult
) => ({
  ok: policy.descriptor.evaluation.status !== "blocked",
  command: "host policy",
  status: "preview",
  preview: true,
  message:
    "Local policy preview only. No host login/config is bound, no session was created, and no endpoint manifest or cache receipt was issued.",
  binding: hostBinding,
  ownership: policyOwner,
  acceptedArgs: {
    output: request.output,
    content: request.content,
    observer: request.observer,
    debug: request.debug,
    expectedDurationSeconds: request.expectedDurationSeconds,
    expectedCacheBytes: request.expectedCacheBytes
  },
  modeExplanation: modeExplanation(request.output, request.debug),
  sdkPolicy: {
    descriptor: policy.descriptor,
    outputMode: policy.outputMode,
    cache: policy.cache,
    live: policy.live,
    blockReasons: policy.blockReasons,
    constraints: policy.constraints
  },
  limitations: [
    "This is backed by makeInMemoryHostProviderClient for shape evaluation only.",
    "It is provider-agnostic and does not prove Cloudflare, R2, S3, Walrus, IPFS, or any storage adapter is configured.",
    "Cache is policy/evidence, not an output mode."
  ]
});

export const hostInvalidPayload = (
  command: "policy",
  errors: readonly string[]
) => ({
  ok: false,
  command: `host ${command}`,
  status: "invalid",
  errors
});

export const evaluateHostPolicyPreview = (
  request: Extract<HostPolicyRequest, { readonly _tag: "preview" }>
) =>
  Effect.gen(function* () {
    const client = yield* makeInMemoryHostProviderClient({
      hostId: "preview-in-memory-host",
      cloudflareLike: true
    });

    return yield* client.evaluatePolicy({
      outputMode: request.output,
      debug: request.debug,
      contentId: request.content,
      observer: request.observer,
      expectedDurationSeconds: request.expectedDurationSeconds,
      expectedCacheBytes: request.expectedCacheBytes
    });
  });

export const readHostConstraintsPreview = () =>
  Effect.gen(function* () {
    const client = yield* makeInMemoryHostProviderClient({
      hostId: "preview-in-memory-host",
      cloudflareLike: true
    });

    return yield* client.constraints;
  });

export const runHostShell = () => printJson(hostShellPayload());

export const runHostDescribe = () => printJson(hostDescribeScaffoldPayload());

export const runHostConstraints = () =>
  readHostConstraintsPreview().pipe(
    Effect.map(hostConstraintsScaffoldPayload),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "host constraints",
        status: "sdk-error",
        message: "Host constraints scaffold could not read SDK-accessible provider notes.",
        binding: hostBinding,
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

export const runHostPolicy = (options: HostPolicyCliOptions) => {
  const request = parseHostPolicyRequest(options);

  if (request._tag === "invalid") {
    return printJson(hostInvalidPayload("policy", request.errors));
  }

  return evaluateHostPolicyPreview(request).pipe(
    Effect.map((policy) => hostPolicyPreviewPayload(request, policy)),
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "host policy",
        status: "sdk-error",
        message: "Host policy preview failed before a scaffold could be reported.",
        binding: hostBinding,
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );
};

export const runHostConfigure = (options: HostProviderCliOptions) =>
  configureHostProvider(hostRuntime(options.configPath).store, options).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "host configure",
        status: "user-error",
        message: "Host provider config was not saved.",
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

export const runHostLogin = (options: HostProviderCliOptions) =>
  loginHostProvider(hostRuntime(options.configPath), options).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false,
        command: "host login",
        status: "user-error",
        message: "Host provider login failed before a provider binding could be saved.",
        error: formatCliError(error)
      })
    ),
    Effect.flatMap(printJson)
  );

export const runHostReadiness = (options: Pick<HostProviderCliOptions, "configPath">) =>
  readHostReadiness(hostRuntime(options.configPath)).pipe(
    Effect.catchAll((error) =>
      Effect.succeed(
        hostReadinessPayload(null, null, [], formatCliError(error))
      )
    ),
    Effect.flatMap(printJson)
  );

export const hostHelp = (version: string): string => `FlowStream RE CLI v${version}

USAGE

$ flowstream-re host
$ flowstream-re host configure --provider http --url <url> (--api-key <key>|--bearer-token <token>) [--config-path <path>]
$ flowstream-re host login --provider http --url <url> (--api-key <key>|--bearer-token <token>) [--config-path <path>]
$ flowstream-re host readiness [--config-path <path>]
$ flowstream-re host describe
$ flowstream-re host constraints
$ flowstream-re host policy --output forwarder|local|file --content football --observer <id> [--debug] [--expected-duration <seconds>] [--expected-cache-bytes <bytes>]
$ flowstream-re host network --mode hosted|local-dev|lan|degraded [--provider cloudflare|generic]

DESCRIPTION

Inspect host policy readiness. CLI parses and displays only; SDK HostProviderClient owns behavior.

IMPORTANT

- A selected host provider is required for non-debug live/cache sessions.
- host configure validates and saves selected provider config without network login.
- host login validates selected provider config, calls the provider through HostProviderClient, and saves readiness evidence.
- local --debug may skip host cache.
- local without --debug requires host cache.
- file is debug/demo output.
- forwarder requires live forwarding plus cache evidence.
- cache is host policy/evidence, not an output mode.
- network defaults should be outbound-only hosted HTTPS/TLS 443; locked networks such as CGNAT, corporate blocks, UDP blocks, and captive networks require provider relay/fallback handling.
- host network is a scaffold only: it does not probe TURN/SFU, automate browsers, log in to providers, or open ports.
- host is not steward.
`;
