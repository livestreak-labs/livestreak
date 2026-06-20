import { describe, expect, it } from "vitest";
import { handleDescriptor } from "#descriptor/routes.js";
import { defaultHostServerConfig } from "../src/descriptor/config.js";

describe("host descriptor", () => {
  it("advertises module tokens and memory bridge without internal ids", () => {
    const config = {
      ...defaultHostServerConfig(),
      memoryRelayerUrl: "https://memwal.example",
      livekitApiKey: undefined
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.modules).toEqual(
      expect.arrayContaining(["aa", "media", "memory", "discovery"])
    );
    expect(descriptor.media.simulcastAvailable).toBe(false);
    expect(descriptor.supportedOutputs).not.toContain("simulcast");
    expect(descriptor.memory).toEqual({
      relayerUrl: "https://memwal.example",
      namespaceTemplate: "market:{marketId}",
      trustModel: "plaintext-relayer"
    });
    expect(JSON.stringify(descriptor)).not.toContain("accountId");
    expect(JSON.stringify(descriptor)).not.toContain("memWalAccountId");
  });

  it("advertises simulcast when LiveKit is configured", () => {
    const config = {
      ...defaultHostServerConfig(),
      livekitApiKey: "lk_test_key"
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.media.simulcastAvailable).toBe(true);
    expect(descriptor.supportedOutputs).toContain("simulcast");
  });
});
