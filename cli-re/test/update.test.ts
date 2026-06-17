import { describe, expect, it } from "vitest";
import { updatePlanPayload, updateShellPayload } from "../src/update.js";

describe("CLI software update scaffold", () => {
  it("treats bare update as software update apply scaffold", () => {
    const payload = updateShellPayload();

    expect(payload.command).toBe("update");
    expect(payload.status).toBe("scaffold");
    expect(payload.softwareUpdateOnly).toBe(true);
    expect(payload.operation).toMatchObject({
      attempted: false,
      mutation: false
    });
  });

  it("prints check plans without querying a package provider", () => {
    const payload = updatePlanPayload("check");

    expect(payload).toMatchObject({
      ok: true,
      command: "update check",
      status: "scaffold",
      currentVersion: null,
      latestVersion: null,
      updateAvailable: null,
      packageManager: {
        bound: false,
        checked: false,
        applied: false
      }
    });
  });

  it("prints apply plans without mutating files", () => {
    const payload = updatePlanPayload("apply");

    expect(payload.command).toBe("update apply");
    expect(payload.operation).toMatchObject({
      attempted: false,
      mutation: false
    });
    expect(payload.packageManager.applied).toBe(false);
  });

  it("keeps software update separate from assets and models", () => {
    const serialized = JSON.stringify(updatePlanPayload("check"));

    expect(serialized).toContain("asset/content/model repair");
    expect(serialized).toContain("football weights");
    expect(serialized).not.toContain("assets repair football");
  });
});
