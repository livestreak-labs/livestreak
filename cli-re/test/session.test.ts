import { describe, expect, it } from "vitest";
import {
  parseSessionControlRequest,
  sessionControlScaffoldPayload,
  sessionHealthScaffoldPayload,
  sessionInspectScaffoldPayload,
  sessionListScaffoldPayload
} from "../src/session.js";

describe("session CLI scaffold", () => {
  it("accepts pause, resume, and stop control requests", () => {
    for (const command of ["pause", "resume", "stop"] as const) {
      expect(
        parseSessionControlRequest(command, {
          id: "session_match_1",
          capability: "cap_operator_1",
          expectedVersion: 4
        })
      ).toEqual({
        _tag: "control",
        command,
        sessionId: "session_match_1",
        expectedVersion: 4,
        capabilityGrantId: "cap_operator_1",
        requiredScope: `session:${command}`
      });
    }
  });

  it("rejects missing session id and capability grant id", () => {
    const request = parseSessionControlRequest("pause", {
      expectedVersion: 4
    });

    expect(request._tag).toBe("invalid");
    if (request._tag === "invalid") {
      expect(request.errors).toContain("session pause requires --id <sessionId>.");
      expect(request.errors).toContain("session pause requires --capability <grantId>.");
    }
  });

  it("rejects invalid expectedVersion values", () => {
    for (const expectedVersion of ["abc", "-1", "1.5", Number.NaN, 1.5]) {
      const request = parseSessionControlRequest("stop", {
        id: "session_match_1",
        capability: "cap_operator_1",
        expectedVersion
      });

      expect(request._tag).toBe("invalid");
      if (request._tag === "invalid") {
        expect(request.errors).toContain(
          "--expected-version must be a non-negative safe integer."
        );
      }
    }
  });

  it("builds pause scaffold output without raw source controls", () => {
    const request = parseSessionControlRequest("pause", {
      id: "session_match_1",
      capability: "cap_operator_1",
      expectedVersion: 4
    });

    expect(request._tag).toBe("control");
    if (request._tag === "control") {
      const payload = sessionControlScaffoldPayload(request);
      const serialized = JSON.stringify(payload).toLowerCase();

      expect(payload.requiredCapabilityScopes).toEqual(["session:pause"]);
      expect(payload.acceptedArgs.sessionId).toBe("session_match_1");
      expect(payload.acceptedArgs.capabilityGrantId).toBe("cap_operator_1");
      expect(payload.acceptedArgs.expectedVersion).toBe(4);
      expect(payload.operation).toMatchObject({
        attempted: false,
        mutation: false,
        target: "RuntimeStore.pause"
      });
      expect(serialized).not.toContain("crop");
      expect(serialized).not.toContain("fps");
      expect(serialized).not.toContain("content");
      expect(serialized).not.toContain("output");
    }
  });

  it("builds honest list scaffold output for the missing daemon/store binding", () => {
    const payload = sessionListScaffoldPayload();

    expect(payload.command).toBe("session list");
    expect(payload.storeBinding.daemon).toBe(false);
    expect(payload.storeBinding.runtimeStoreBound).toBe(false);
    expect(payload.storeBinding.capabilityGrantStoreBound).toBe(false);
    expect(payload.sessions).toEqual([]);
    expect(payload.result).toContain("did not query RuntimeStore");
    expect(payload.result).toContain("did not fabricate stored sessions");
  });

  it("builds honest inspect and health scaffolds for the missing daemon/store binding", () => {
    const inspect = sessionInspectScaffoldPayload({ id: "session_match_1" });
    const health = sessionHealthScaffoldPayload({ id: "session_match_1" });

    expect(inspect.command).toBe("session inspect");
    expect(inspect.acceptedArgs.sessionId).toBe("session_match_1");
    expect(inspect.lookup).toEqual({
      attempted: false,
      session: null
    });
    expect(inspect.result).toContain("did not query RuntimeStore");

    expect(health.command).toBe("session health");
    expect(health.acceptedArgs.sessionId).toBe("session_match_1");
    expect(health.health).toEqual({
      attempted: false,
      session: null
    });
    expect(health.result).toContain("did not query RuntimeStore session health");
  });
});
