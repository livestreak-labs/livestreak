import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import { projectConsoleFunctions } from "../src/gateway/console-functions.js";

const raw: readonly FunctionDescriptor[] = [
  { name: "fund", label: "Fund", scope: "options:vault:fund", disabled: false },
  { name: "withdraw", label: "Withdraw", scope: "options:vault:withdraw", disabled: false }
];

describe("projectConsoleFunctions", () => {
  it("normalizes package scopes to bridge:action:<name> and filters by session scopes", () => {
    const out = projectConsoleFunctions(raw, ["bridge:action:fund"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("fund");
    // scope normalized away from the package-internal `options:vault:fund`.
    expect(out[0]!.scope).toBe("bridge:action:fund");
  });

  it("a bridge:action:* grant authorizes every action", () => {
    const out = projectConsoleFunctions(raw, ["bridge:action:*"]);
    expect(out.map((f) => f.name)).toEqual(["fund", "withdraw"]);
  });

  it("no matching scope yields no functions", () => {
    expect(projectConsoleFunctions(raw, ["bridge:board:read"])).toHaveLength(0);
  });
});
