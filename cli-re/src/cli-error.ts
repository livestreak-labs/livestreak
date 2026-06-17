import { toCliError, type FlowStreamError } from "@flowstream-re/core";

const flowStreamErrorTags = new Set([
  "FlowStreamConfigError",
  "FlowStreamRuntimeError",
  "FlowStreamCapabilityError",
  "FlowStreamRegistryError",
  "FlowStreamCommandError",
  "FlowStreamNotImplementedError"
]);

const hasKey = <K extends string>(
  value: unknown,
  key: K
): value is Record<K, unknown> =>
  typeof value === "object" && value !== null && key in value;

const isFlowStreamError = (error: unknown): error is FlowStreamError =>
  hasKey(error, "_tag") && flowStreamErrorTags.has(String(error._tag));

const metadata = (error: unknown): Record<string, unknown> | undefined =>
  hasKey(error, "metadata") &&
  typeof error.metadata === "object" &&
  error.metadata !== null
    ? (error.metadata as Record<string, unknown>)
    : undefined;

export const formatCliError = (error: unknown) => {
  if (isFlowStreamError(error)) {
    return toCliError(error);
  }

  const meta = metadata(error);

  return {
    tag: hasKey(error, "_tag") ? String(error._tag) : "UnknownError",
    message: hasKey(error, "message")
      ? String(error.message)
      : "FlowStream observe failed",
    retryable:
      typeof meta?.retryable === "boolean" ? meta.retryable : false,
    details: typeof meta?.details === "string" ? meta.details : undefined,
    docsPath: typeof meta?.docsPath === "string" ? meta.docsPath : undefined
  };
};
