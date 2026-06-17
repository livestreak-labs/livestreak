import { describe, expect, it } from "vitest";
import * as Public from "../src/index.js";

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];

describe("options public exports", () => {
  it("exports model types and helpers", () => {
    expect(publicExport("OptionsVaultSide")).toBeUndefined();
    expect(publicExport("validateOptionsVaultSide")).toBeTypeOf("function");
    expect(publicExport("totalVaultPool")).toBeTypeOf("function");
    expect(publicExport("asMarketId")).toBeTypeOf("function");
  });

  it("exports read transport type surface and read helpers", () => {
    expect(publicExport("readMarketSnapshot")).toBeTypeOf("function");
    expect(publicExport("readVaultSnapshot")).toBeTypeOf("function");
    expect(publicExport("readUserOptionsSnapshot")).toBeTypeOf("function");
  });

  it("exports panel projection", () => {
    expect(publicExport("projectOptionsPanel")).toBeTypeOf("function");
  });

  it("does not export fake test helpers or internal stores", () => {
    expect(publicExport("createFakeOptionsReadTransport")).toBeUndefined();
    expect(publicExport("FakeTransportInMemory")).toBeUndefined();
    expect(publicExport("createOptionsRuntime")).toBeUndefined();
    expect(publicExport("OptionsRuntime")).toBeUndefined();
  });

  it("does not export vault or market creation APIs", () => {
    expect(publicExport("createVault")).toBeUndefined();
    expect(publicExport("createMarket")).toBeUndefined();
    expect(publicExport("registerMarket")).toBeUndefined();
  });
});
