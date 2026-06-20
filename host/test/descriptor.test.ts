import { describe, expect, it } from "vitest";
import { handleDescriptor } from "#descriptor/routes.js";
import { defaultHostServerConfig } from "../src/descriptor/config.js";
import { memoryNetworkProfiles } from "../src/memory/network-profile.js";

describe("host descriptor", () => {
  it("advertises module tokens and memory bridge without internal ids", () => {
    const config = {
      ...defaultHostServerConfig(),
      memoryNetwork: "mainnet" as const,
      livekitApiKey: undefined
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.modules).toEqual(
      expect.arrayContaining(["aa", "media", "memory", "discovery"])
    );
    expect(descriptor.media.simulcastAvailable).toBe(false);
    expect(descriptor.supportedOutputs).not.toContain("simulcast");
    expect(descriptor.memory).toEqual({
      relayerUrl: memoryNetworkProfiles.mainnet.relayerUrl,
      namespaceTemplate: "market:{marketId}",
      trustModel: "plaintext-relayer",
      network: "mainnet"
    });
    expect(JSON.stringify(descriptor)).not.toContain("accountId");
    expect(JSON.stringify(descriptor)).not.toContain("memWalAccountId");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_KEY");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_SEED");
  });

  it("advertises null memory when network selector is absent", () => {
    const config = {
      ...defaultHostServerConfig(),
      memoryNetwork: null,
      livekitApiKey: undefined
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.memory).toEqual({
      relayerUrl: null,
      namespaceTemplate: "market:{marketId}",
      trustModel: "plaintext-relayer",
      network: null
    });
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
