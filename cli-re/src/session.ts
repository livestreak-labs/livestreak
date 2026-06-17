import { Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

export type SessionLifecycleCommand = "prepare" | "start" | "pause" | "resume" | "stop";
export type SessionReadCommand = "inspect" | "health";

export interface SessionIdOptions {
  readonly id?: string;
}

export interface SessionControlOptions extends SessionIdOptions {
  readonly expectedVersion?: number | string;
  readonly capability?: string;
}

export type SessionControlRequest =
  | { readonly _tag: "invalid"; readonly errors: readonly string[] }
  | {
      readonly _tag: "control";
      readonly command: SessionLifecycleCommand;
      readonly sessionId: string;
      readonly expectedVersion: number;
      readonly capabilityGrantId: string;
      readonly requiredScope: `session:${SessionLifecycleCommand}`;
    };

const sdkOwner = {
  runtimeStore: "RuntimeStore",
  capabilityGrantStore: "CapabilityGrantStore"
} as const;

const storeBinding = {
  daemon: false,
  runtimeStoreBound: false,
  capabilityGrantStoreBound: false,
  message:
    "No long-lived FlowStream daemon or host-owned RuntimeStore/CapabilityGrantStore binding exists in this CLI yet."
} as const;

const nextReadIntegrationStep =
  "Bind this CLI command to a host-owned RuntimeStore and return the SDK snapshot instead of this scaffold.";

const nextControlIntegrationStep = (command: SessionLifecycleCommand) =>
  `Require CapabilityGrantStore.require(capabilityGrantId, "session:${command}") before calling RuntimeStore.${command}(sessionId, { expectedVersion }).`;

const optionValue = <A>(value: Option.Option<A>): A | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (item) => item
  });

const parseExpectedVersion = (value: number | string | undefined): number | undefined => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  return undefined;
};

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

const scopeFor = (command: SessionLifecycleCommand): `session:${SessionLifecycleCommand}` =>
  `session:${command}`;

export const sessionCommandOptions = {
  id: Options.text("id").pipe(
    Options.optional,
    Options.withDescription("Runtime session id owned by the SDK RuntimeStore.")
  )
};

export const sessionControlCommandOptions = {
  id: Options.text("id").pipe(
    Options.optional,
    Options.withDescription("Runtime session id owned by the SDK RuntimeStore.")
  ),
  expectedVersion: Options.integer("expected-version").pipe(
    Options.optional,
    Options.withDescription("Optimistic RuntimeStore session snapshot version.")
  ),
  capability: Options.text("capability").pipe(
    Options.optional,
    Options.withDescription("CapabilityGrant id to validate against the lifecycle scope.")
  )
};

export const normalizeSessionIdOptions = (options: {
  readonly id: Option.Option<string>;
}): SessionIdOptions => ({
  id: optionValue(options.id)
});

export const normalizeSessionControlOptions = (options: {
  readonly id: Option.Option<string>;
  readonly expectedVersion: Option.Option<number>;
  readonly capability: Option.Option<string>;
}): SessionControlOptions => ({
  id: optionValue(options.id),
  expectedVersion: optionValue(options.expectedVersion),
  capability: optionValue(options.capability)
});

export const parseSessionControlRequest = (
  command: SessionLifecycleCommand,
  options: SessionControlOptions
): SessionControlRequest => {
  const errors: string[] = [];
  const sessionId = nonEmpty(options.id);
  const capabilityGrantId = nonEmpty(options.capability);
  const expectedVersion = parseExpectedVersion(options.expectedVersion);

  if (sessionId === undefined) {
    errors.push(`session ${command} requires --id <sessionId>.`);
  }

  if (capabilityGrantId === undefined) {
    errors.push(`session ${command} requires --capability <grantId>.`);
  }

  if (options.expectedVersion === undefined) {
    errors.push(`session ${command} requires --expected-version <n>.`);
  } else if (expectedVersion === undefined) {
    errors.push("--expected-version must be a non-negative safe integer.");
  }

  return errors.length > 0
    ? { _tag: "invalid", errors }
    : {
        _tag: "control",
        command,
        sessionId: sessionId!,
        expectedVersion: expectedVersion!,
        capabilityGrantId: capabilityGrantId!,
        requiredScope: scopeFor(command)
      };
};

export const sessionShellPayload = () => ({
  ok: true,
  command: "session",
  status: "scaffold",
  message:
    "session is the local CLI control plane shell for SDK-owned RuntimeStore sessions and CapabilityGrantStore grants.",
  sdkOwner,
  storeBinding,
  commands: [
    "session list",
    "session inspect --id <sessionId>",
    "session health --id <sessionId>",
    "session prepare --id <sessionId> --expected-version <n> --capability <grantId>",
    "session start --id <sessionId> --expected-version <n> --capability <grantId>",
    "session pause --id <sessionId> --expected-version <n> --capability <grantId>",
    "session resume --id <sessionId> --expected-version <n> --capability <grantId>",
    "session stop --id <sessionId> --expected-version <n> --capability <grantId>"
  ],
  nextIntegrationStep:
    "Attach this surface to the host process that owns RuntimeStore and CapabilityGrantStore; until then no session is queried or mutated."
});

export const sessionListScaffoldPayload = () => ({
  ok: true,
  command: "session list",
  status: "scaffold",
  sdkOwner,
  storeBinding,
  acceptedArgs: {},
  requiredCapabilityScopes: ["session:list"],
  sessions: [],
  result:
    "No daemon/store binding is available, so the CLI did not query RuntimeStore and did not fabricate stored sessions.",
  nextIntegrationStep: nextReadIntegrationStep
});

export const sessionInspectScaffoldPayload = (options: SessionIdOptions) => ({
  ok: true,
  command: "session inspect",
  status: "scaffold",
  sdkOwner,
  storeBinding,
  acceptedArgs: {
    sessionId: options.id
  },
  requiredCapabilityScopes: ["session:inspect"],
  lookup: {
    attempted: false,
    session: null
  },
  result:
    "No daemon/store binding is available, so the CLI did not query RuntimeStore for this session id.",
  nextIntegrationStep: nextReadIntegrationStep
});

export const sessionHealthScaffoldPayload = (options: SessionIdOptions) => ({
  ok: true,
  command: "session health",
  status: "scaffold",
  sdkOwner,
  storeBinding,
  acceptedArgs: {
    sessionId: options.id
  },
  requiredCapabilityScopes: ["session:health"],
  health: {
    attempted: false,
    session: null
  },
  result:
    "No daemon/store binding is available, so the CLI did not query RuntimeStore session health.",
  nextIntegrationStep: nextReadIntegrationStep
});

export const sessionControlScaffoldPayload = (request: Exclude<SessionControlRequest, { readonly _tag: "invalid" }>) => ({
  ok: true,
  command: `session ${request.command}`,
  status: "scaffold",
  sdkOwner,
  storeBinding,
  acceptedArgs: {
    sessionId: request.sessionId,
    expectedVersion: request.expectedVersion,
    capabilityGrantId: request.capabilityGrantId
  },
  requiredCapabilityScopes: [request.requiredScope],
  operation: {
    attempted: false,
    mutation: false,
    target: `RuntimeStore.${request.command}`
  },
  result:
    "No daemon/store binding is available, so the CLI validated only the command shape and did not mutate a session.",
  nextIntegrationStep: nextControlIntegrationStep(request.command)
});

export const sessionInvalidPayload = (
  command: SessionLifecycleCommand,
  errors: readonly string[]
) => ({
  ok: false,
  command: `session ${command}`,
  status: "invalid",
  errors
});

export const sessionReadInvalidPayload = (
  command: SessionReadCommand,
  errors: readonly string[]
) => ({
  ok: false,
  command: `session ${command}`,
  status: "invalid",
  errors
});

const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

export const runSessionShell = (): Effect.Effect<void> => printJson(sessionShellPayload());

export const runSessionList = (): Effect.Effect<void> =>
  printJson(sessionListScaffoldPayload());

export const runSessionInspect = (options: SessionIdOptions): Effect.Effect<void> =>
  nonEmpty(options.id) === undefined
    ? printJson(sessionReadInvalidPayload("inspect", ["session inspect requires --id <sessionId>."]))
    : printJson(sessionInspectScaffoldPayload(options));

export const runSessionHealth = (options: SessionIdOptions): Effect.Effect<void> =>
  nonEmpty(options.id) === undefined
    ? printJson(sessionReadInvalidPayload("health", ["session health requires --id <sessionId>."]))
    : printJson(sessionHealthScaffoldPayload(options));

export const runSessionControl = (
  command: SessionLifecycleCommand,
  options: SessionControlOptions
): Effect.Effect<void> => {
  const request = parseSessionControlRequest(command, options);
  return request._tag === "invalid"
    ? printJson(sessionInvalidPayload(command, request.errors))
    : printJson(sessionControlScaffoldPayload(request));
};

export const sessionHelp = (version: string) => `FlowStream RE CLI v${version}

USAGE

$ flowstream-re session
$ flowstream-re session list
$ flowstream-re session inspect --id <sessionId>
$ flowstream-re session health --id <sessionId>
$ flowstream-re session prepare --id <sessionId> --expected-version <n> --capability <grantId>
$ flowstream-re session start --id <sessionId> --expected-version <n> --capability <grantId>
$ flowstream-re session pause --id <sessionId> --expected-version <n> --capability <grantId>
$ flowstream-re session resume --id <sessionId> --expected-version <n> --capability <grantId>
$ flowstream-re session stop --id <sessionId> --expected-version <n> --capability <grantId>

DESCRIPTION

session is the local control plane shell over SDK-owned RuntimeStore sessions and CapabilityGrantStore grants.

SCAFFOLD STATUS

- No long-lived daemon is bound yet.
- The CLI parses command shape and prints honest JSON scaffolds.
- RuntimeStore and CapabilityGrantStore remain the workflow owners.

SOURCE-SCOPED CONTROLS

Crop, FPS, content, and output controls are discovered from the active session registry/source descriptors; they are not generic session flags.
`;
