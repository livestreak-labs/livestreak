import { describe, expect, it } from "vitest";
import {
  FlowStreamCapabilityError,
  FlowStreamCommandError,
  FlowStreamConfigError,
  FlowStreamNotImplementedError,
  FlowStreamRegistryError,
  FlowStreamRuntimeError,
  isFlowStreamError,
  serializeFlowStreamError,
  serializeUnknownError,
  toCliError
} from "../src/errors.js";

describe("serializeFlowStreamError", () => {
  it("maps config errors", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamConfigError({ message: "Invalid pause settings" })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamConfigError",
      shortName: "config",
      title: "Configuration error",
      message: "Invalid pause settings",
      description:
        "The request could not be accepted because configuration or input was invalid.",
      retryable: false
    });
    expect(serialized.context).toBeUndefined();
  });

  it("maps runtime errors", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamRuntimeError({ message: "Worker failed during capture pump" })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamRuntimeError",
      shortName: "runtime",
      title: "Runtime error",
      message: "Worker failed during capture pump"
    });
    expect(serialized.context).toBeUndefined();
  });

  it("maps capability errors with requiredScope context", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamCapabilityError({
        message: "No capability grant authorizes system:pause:setPresentation",
        requiredScope: "system:pause:setPresentation"
      })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamCapabilityError",
      shortName: "capability",
      title: "Permission denied",
      context: { requiredScope: "system:pause:setPresentation" }
    });
  });

  it("maps registry errors with registryId context", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamRegistryError({
        message: "Unknown capture driver",
        registryId: "browser"
      })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamRegistryError",
      shortName: "registry",
      context: { registryId: "browser" }
    });
  });

  it("maps command errors with commandScope context", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamCommandError({
        message: "Command rejected",
        commandScope: "capture:browser:setCrop"
      })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamCommandError",
      shortName: "command",
      context: { commandScope: "capture:browser:setCrop" }
    });
  });

  it("maps not-implemented errors with component context", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamNotImplementedError({
        component: "observe.gateway",
        message: "Gateway transport is not implemented"
      })
    );

    expect(serialized).toMatchObject({
      tag: "FlowStreamNotImplementedError",
      shortName: "not-implemented",
      context: { component: "observe.gateway" }
    });
  });

  it("preserves metadata details, documentationPath, and retryable", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamConfigError({
        message: "Bad input",
        metadata: {
          details: "whilePaused must be hold or slate",
          documentationPath: "/docs/pause",
          retryable: true
        }
      })
    );

    expect(serialized.details).toBe("whilePaused must be hold or slate");
    expect(serialized.documentationPath).toBe("/docs/pause");
    expect(serialized.retryable).toBe(true);
  });

  it("does not serialize metadata.cause", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamRuntimeError({
        message: "Wrapped failure",
        metadata: {
          cause: { secret: "internal" },
          details: "surface detail"
        }
      })
    );

    expect(serialized.details).toBe("surface detail");
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
    expect(JSON.stringify(serialized)).not.toContain("internal");
  });

  it("does not carry metadata.cause through sanitized metadata path", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const serialized = serializeFlowStreamError(
      new FlowStreamConfigError({
        message: "metadata sanitized",
        metadata: {
          cause: circular,
          details: "visible detail"
        }
      })
    );

    expect(serialized).toMatchObject({
      message: "metadata sanitized",
      details: "visible detail"
    });
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("omits context when capability error has no requiredScope", () => {
    const serialized = serializeFlowStreamError(
      new FlowStreamCapabilityError({ message: "Permission denied" })
    );

    expect(serialized.context).toBeUndefined();
  });

  it("is JSON-safe even when metadata.cause is circular", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const serialized = serializeFlowStreamError(
      new FlowStreamConfigError({
        message: "Invalid config",
        metadata: {
          cause: circular,
          details: "still serializable"
        }
      })
    );

    expect(() => JSON.stringify(serialized)).not.toThrow();
    expect(JSON.parse(JSON.stringify(serialized))).toMatchObject({
      shortName: "config",
      details: "still serializable"
    });
  });

  it("keeps toCliError as a compatibility alias", () => {
    const error = new FlowStreamConfigError({ message: "alias check" });
    expect(toCliError(error)).toEqual(serializeFlowStreamError(error));
  });
});

describe("isFlowStreamError", () => {
  it("returns true for each FlowStream error class", () => {
    expect(isFlowStreamError(new FlowStreamConfigError({ message: "config" }))).toBe(true);
    expect(isFlowStreamError(new FlowStreamRuntimeError({ message: "runtime" }))).toBe(true);
    expect(
      isFlowStreamError(
        new FlowStreamCapabilityError({
          message: "capability",
          requiredScope: "bridge:board:read"
        })
      )
    ).toBe(true);
    expect(
      isFlowStreamError(
        new FlowStreamRegistryError({ message: "registry", registryId: "browser" })
      )
    ).toBe(true);
    expect(
      isFlowStreamError(
        new FlowStreamCommandError({ message: "command", commandScope: "system:run:stop" })
      )
    ).toBe(true);
    expect(
      isFlowStreamError(
        new FlowStreamNotImplementedError({ component: "gateway", message: "not implemented" })
      )
    ).toBe(true);
  });

  it("returns false for primitive, null, array, plain object, and Error", () => {
    expect(isFlowStreamError(null)).toBe(false);
    expect(isFlowStreamError(undefined)).toBe(false);
    expect(isFlowStreamError("FlowStreamConfigError")).toBe(false);
    expect(isFlowStreamError(42)).toBe(false);
    expect(isFlowStreamError([])).toBe(false);
    expect(isFlowStreamError({ message: "plain" })).toBe(false);
    expect(isFlowStreamError(new Error("native"))).toBe(false);
  });

  it("returns true for cross-boundary objects with a valid _tag and message", () => {
    const value = { _tag: "FlowStreamConfigError", message: "external" };
    expect(isFlowStreamError(value)).toBe(true);
    expect(serializeFlowStreamError(value as FlowStreamConfigError)).toMatchObject({
      tag: "FlowStreamConfigError",
      shortName: "config",
      message: "external"
    });
  });

  it("returns false for objects with unknown _tag values", () => {
    expect(isFlowStreamError({ _tag: "FlowStreamMysteryError", message: "nope" })).toBe(false);
  });

  it("returns false for structurally incomplete or malformed errors", () => {
    expect(isFlowStreamError({ _tag: "FlowStreamConfigError" })).toBe(false);
    expect(isFlowStreamError({ _tag: "FlowStreamCommandError", message: "x" })).toBe(false);
    expect(
      isFlowStreamError({ _tag: "FlowStreamCommandError", message: "x", commandScope: 123 })
    ).toBe(false);
    expect(isFlowStreamError({ _tag: "FlowStreamNotImplementedError", message: "x" })).toBe(false);
    expect(
      isFlowStreamError({ _tag: "FlowStreamCapabilityError", message: "x", requiredScope: 123 })
    ).toBe(false);
    expect(
      isFlowStreamError({ _tag: "FlowStreamRegistryError", message: "x", registryId: 123 })
    ).toBe(false);
    expect(
      isFlowStreamError({ _tag: "FlowStreamConfigError", message: "x", metadata: [] })
    ).toBe(false);
    expect(
      isFlowStreamError({
        _tag: "FlowStreamConfigError",
        message: "x",
        metadata: { retryable: "yes" }
      })
    ).toBe(false);
  });
});

describe("serializeFlowStreamError defensive behavior", () => {
  it("does not emit undefined message or malformed context for bad casts", () => {
    const command = serializeFlowStreamError({
      _tag: "FlowStreamCommandError"
    } as FlowStreamCommandError);

    expect(command.message).toBe("FlowStream failed");
    expect(command.context).toBeUndefined();
    expect(JSON.stringify(command)).not.toContain("undefined");

    const notImplemented = serializeFlowStreamError({
      _tag: "FlowStreamNotImplementedError",
      message: "missing component"
    } as FlowStreamNotImplementedError);

    expect(notImplemented.message).toBe("missing component");
    expect(notImplemented.context).toBeUndefined();
    expect(JSON.stringify(notImplemented)).not.toContain("undefined");
  });

  it("ignores malformed metadata fields without throwing", () => {
    const serialized = serializeFlowStreamError({
      _tag: "FlowStreamConfigError",
      message: "bad metadata cast",
      metadata: { details: 123, retryable: "yes" }
    } as unknown as FlowStreamConfigError);

    expect(serialized.message).toBe("bad metadata cast");
    expect(serialized.details).toBeUndefined();
    expect(serialized.retryable).toBe(false);
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it("trims bad-cast FlowStream messages and falls back on whitespace-only values", () => {
    expect(
      serializeFlowStreamError({
        _tag: "FlowStreamConfigError",
        message: "  bad  "
      } as FlowStreamConfigError).message
    ).toBe("bad");

    expect(
      serializeFlowStreamError({
        _tag: "FlowStreamConfigError",
        message: "   "
      } as FlowStreamConfigError).message
    ).toBe("FlowStream failed");
  });
});

describe("serializeUnknownError", () => {
  it("delegates FlowStream errors to serializeFlowStreamError", () => {
    const error = new FlowStreamConfigError({ message: "Invalid config" });
    expect(serializeUnknownError(error)).toEqual(serializeFlowStreamError(error));
  });

  it("serializes native Error values without stack traces", () => {
    const error = new Error("boom");
    error.stack = "secret stack trace";

    const serialized = serializeUnknownError(error);

    expect(serialized).toEqual({
      tag: "UnknownError",
      shortName: "unknown",
      title: "Unknown error",
      message: "boom",
      description: "An unexpected error occurred.",
      retryable: false
    });
    expect(JSON.stringify(serialized)).not.toContain("stack");
    expect(JSON.stringify(serialized)).not.toContain("secret");
  });

  it("serializes string errors", () => {
    expect(serializeUnknownError("network timeout")).toMatchObject({
      tag: "UnknownError",
      message: "network timeout"
    });
    expect(serializeUnknownError(" timeout ").message).toBe("timeout");
    expect(serializeUnknownError("   ").message).toBe("Unknown error");
  });

  it("trims native Error messages and falls back on whitespace-only values", () => {
    expect(serializeUnknownError(new Error(" boom ")).message).toBe("boom");
    expect(serializeUnknownError(new Error("   ")).message).toBe("Unknown error");
  });

  it("falls back for null, undefined, and plain objects", () => {
    expect(serializeUnknownError(null).message).toBe("Unknown error");
    expect(serializeUnknownError(undefined).message).toBe("Unknown error");
    expect(serializeUnknownError({ secret: "value" }).message).toBe("Unknown error");
    expect(JSON.stringify(serializeUnknownError({ secret: "value" }))).not.toContain("secret");
  });

  it("does not serialize cause fields from native errors", () => {
    const error = new Error("wrapped", { cause: { secret: "internal" } });
    const serialized = serializeUnknownError(error);

    expect(serialized.message).toBe("wrapped");
    expect(JSON.stringify(serialized)).not.toContain("internal");
    expect(Object.hasOwn(serialized, "cause")).toBe(false);
  });
});
