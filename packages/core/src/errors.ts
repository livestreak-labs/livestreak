import { Data } from "effect";

export interface ErrorMetadata {
  readonly details?: string;
  readonly cause?: unknown;
  readonly retryable?: boolean;
  readonly documentationPath?: string;
}

type SanitizedErrorMetadata = Pick<
  ErrorMetadata,
  "details" | "retryable" | "documentationPath"
>;

export class FlowStreamConfigError extends Data.TaggedError("FlowStreamConfigError")<{
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class FlowStreamRuntimeError extends Data.TaggedError("FlowStreamRuntimeError")<{
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class FlowStreamCapabilityError extends Data.TaggedError("FlowStreamCapabilityError")<{
  readonly message: string;
  readonly requiredScope?: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class FlowStreamRegistryError extends Data.TaggedError("FlowStreamRegistryError")<{
  readonly message: string;
  readonly registryId?: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class FlowStreamCommandError extends Data.TaggedError("FlowStreamCommandError")<{
  readonly message: string;
  readonly commandScope: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class FlowStreamNotImplementedError extends Data.TaggedError("FlowStreamNotImplementedError")<{
  readonly component: string;
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export type FlowStreamError =
  | FlowStreamConfigError
  | FlowStreamRuntimeError
  | FlowStreamCapabilityError
  | FlowStreamRegistryError
  | FlowStreamCommandError
  | FlowStreamNotImplementedError;

const flowStreamErrorTags = [
  "FlowStreamConfigError",
  "FlowStreamRuntimeError",
  "FlowStreamCapabilityError",
  "FlowStreamRegistryError",
  "FlowStreamCommandError",
  "FlowStreamNotImplementedError"
] as const satisfies readonly FlowStreamError["_tag"][];

export type FlowStreamErrorTag = (typeof flowStreamErrorTags)[number];

const flowStreamErrorTagSet = new Set<string>(flowStreamErrorTags);

export const isFlowStreamError = (value: unknown): value is FlowStreamError => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.message !== "string") {
    return false;
  }

  if (isValidErrorMetadata(value.metadata) === false) {
    return false;
  }

  const tag = value._tag;
  if (typeof tag !== "string" || flowStreamErrorTagSet.has(tag) === false) {
    return false;
  }

  switch (tag) {
    case "FlowStreamConfigError":
    case "FlowStreamRuntimeError":
      return true;
    case "FlowStreamCapabilityError":
      return isOptionalString(value.requiredScope);
    case "FlowStreamRegistryError":
      return isOptionalString(value.registryId);
    case "FlowStreamCommandError":
      return typeof value.commandScope === "string";
    case "FlowStreamNotImplementedError":
      return typeof value.component === "string";
    default:
      return false;
  }
};

export type FlowStreamErrorShortName =
  | "config"
  | "runtime"
  | "capability"
  | "registry"
  | "command"
  | "not-implemented";

export interface SerializedFlowStreamError {
  readonly tag: FlowStreamErrorTag;
  readonly shortName: FlowStreamErrorShortName;
  readonly title: string;
  readonly message: string;
  readonly description: string;
  readonly retryable: boolean;
  readonly details?: string;
  readonly documentationPath?: string;
  readonly context?: {
    readonly requiredScope?: string;
    readonly registryId?: string;
    readonly commandScope?: string;
    readonly component?: string;
  };
}

export interface SerializedUnknownError {
  readonly tag: "UnknownError";
  readonly shortName: "unknown";
  readonly title: "Unknown error";
  readonly message: string;
  readonly description: string;
  readonly retryable: false;
}

export type SerializedError = SerializedFlowStreamError | SerializedUnknownError;

export const serializeUnknownError = (error: unknown): SerializedError => {
  if (isFlowStreamError(error)) {
    return serializeFlowStreamError(error);
  }

  return {
    tag: "UnknownError",
    shortName: "unknown",
    title: "Unknown error",
    message: unknownErrorMessage(error),
    description: "An unexpected error occurred.",
    retryable: false
  };
};

export const serializeFlowStreamError = (error: FlowStreamError): SerializedFlowStreamError => {
  const metadata = metadataFromError(error);
  const base = serializedBase(error, metadata);

  switch (error._tag) {
    case "FlowStreamConfigError":
      return {
        ...base,
        shortName: "config",
        title: "Configuration error",
        description:
          "The request could not be accepted because configuration or input was invalid."
      };
    case "FlowStreamRuntimeError":
      return {
        ...base,
        shortName: "runtime",
        title: "Runtime error",
        description: "The operation failed while the system was running."
      };
    case "FlowStreamCapabilityError": {
      const requiredScope = stringField(error, "requiredScope");
      return {
        ...base,
        shortName: "capability",
        title: "Permission denied",
        description: "The caller is not authorized to perform this operation.",
        ...contextField(requiredScope === undefined ? undefined : { requiredScope })
      };
    }
    case "FlowStreamRegistryError": {
      const registryId = stringField(error, "registryId");
      return {
        ...base,
        shortName: "registry",
        title: "Registry error",
        description: "A requested registry entry could not be resolved or used.",
        ...contextField(registryId === undefined ? undefined : { registryId })
      };
    }
    case "FlowStreamCommandError": {
      const commandScope = stringField(error, "commandScope");
      return {
        ...base,
        shortName: "command",
        title: "Command error",
        description: "The command could not be executed.",
        ...contextField(
          commandScope === undefined ? undefined : { commandScope }
        )
      };
    }
    case "FlowStreamNotImplementedError": {
      const component = stringField(error, "component");
      return {
        ...base,
        shortName: "not-implemented",
        title: "Not implemented",
        description: "The requested component or operation has not been implemented.",
        ...contextField(component === undefined ? undefined : { component })
      };
    }
  }
};

/** @deprecated Use {@link serializeFlowStreamError} — canonical typed error JSON for CLI, web, and Gateway. */
export const toCliError = serializeFlowStreamError;

// --- helpers ---

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isValidErrorMetadata = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  if ("details" in value && value.details !== undefined && typeof value.details !== "string") {
    return false;
  }

  if ("retryable" in value && value.retryable !== undefined && typeof value.retryable !== "boolean") {
    return false;
  }

  if (
    "documentationPath" in value &&
    value.documentationPath !== undefined &&
    typeof value.documentationPath !== "string"
  ) {
    return false;
  }

  return true;
};

const metadataFromError = (error: FlowStreamError): SanitizedErrorMetadata | undefined => {
  if (!("metadata" in error)) {
    return undefined;
  }

  const metadata = error.metadata;
  if (!isValidErrorMetadata(metadata) || !isRecord(metadata)) {
    return undefined;
  }

  return {
    ...(typeof metadata.details === "string" ? { details: metadata.details } : {}),
    ...(typeof metadata.retryable === "boolean" ? { retryable: metadata.retryable } : {}),
    ...(typeof metadata.documentationPath === "string"
      ? { documentationPath: metadata.documentationPath }
      : {})
  };
};

const messageFromError = (error: FlowStreamError): string => {
  if (typeof error.message !== "string") {
    return "FlowStream failed";
  }

  const trimmed = error.message.trim();
  return trimmed.length > 0 ? trimmed : "FlowStream failed";
};

const unknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Unknown error";
};

const stringField = (error: FlowStreamError, field: string): string | undefined => {
  const record = error as unknown as Record<string, unknown>;
  if (!(field in record)) {
    return undefined;
  }

  const value = record[field];
  return typeof value === "string" ? value : undefined;
};

const retryableFromMetadata = (metadata: SanitizedErrorMetadata | undefined): boolean =>
  metadata?.retryable === true;

const serializedBase = (
  error: FlowStreamError,
  metadata: SanitizedErrorMetadata | undefined
): Pick<
  SerializedFlowStreamError,
  "tag" | "message" | "retryable" | "details" | "documentationPath"
> => ({
  tag: error._tag,
  message: messageFromError(error),
  retryable: retryableFromMetadata(metadata),
  ...(typeof metadata?.details === "string" ? { details: metadata.details } : {}),
  ...(typeof metadata?.documentationPath === "string"
    ? { documentationPath: metadata.documentationPath }
    : {})
});

const contextField = (
  context: SerializedFlowStreamError["context"]
): Pick<SerializedFlowStreamError, "context"> | Record<string, never> =>
  context === undefined ? {} : { context };
