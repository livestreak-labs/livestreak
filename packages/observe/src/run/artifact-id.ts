import { Effect } from "effect";
import { FlowStreamConfigError } from "@flowstream-re2/core";

const artifactIdRequiredMessage = "artifactId must be a non-empty string";

export const validateArtifactIdInput = (
  artifactId: unknown
): Effect.Effect<string, FlowStreamConfigError> => {
  if (typeof artifactId !== "string") {
    return Effect.fail(
      new FlowStreamConfigError({
        message: artifactIdRequiredMessage
      })
    );
  }

  const trimmed = artifactId.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      new FlowStreamConfigError({
        message: artifactIdRequiredMessage
      })
    );
  }

  return Effect.succeed(trimmed);
};
