import type { FlowStreamConfigError } from "@flowstream-re2/core";
import { Effect } from "effect";
import { parseObserveRunConfig } from "./parse.js";
import type { ObserveRunConfig } from "./types.js";

export type { ObserveRunConfigValidationResult } from "./parse.js";

export const validateObserveRunConfig = (
  input: unknown
): Effect.Effect<ObserveRunConfig, FlowStreamConfigError> => {
  const result = parseObserveRunConfig(input);
  return result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
};
