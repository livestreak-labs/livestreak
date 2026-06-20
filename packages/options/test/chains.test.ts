import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { createOptionsChain } from "../src/chains/index.js";
import { createSuiOptionsChain } from "../src/chains/sui.js";
import { DEFAULT_FAKE_ADDRESSES } from "./helpers/fake-chain.js";

const evmChainConfig = {
  walletInit: {
    chain: "evm" as const,
    seedSource: "raw" as const,
    config: {
      chainId: 31_337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      isSponsored: false,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  },
  seed: "test-seed",
  addresses: DEFAULT_FAKE_ADDRESSES
};

describe("createOptionsChain", () => {
  it("dispatches evm walletInit to an evm chain with reader and writer", () => {
    const chain = createOptionsChain(evmChainConfig);

    expect(chain.reader).toBeTypeOf("object");
    expect(chain.writer).toBeTypeOf("object");
    expect(chain.reader.read).toBeTypeOf("function");
    expect(chain.writer.write).toBeTypeOf("function");
  });

  it("dispatches sui walletInit to a stub that throws LiveStreakConfigError", () => {
    expect(() =>
      createOptionsChain({
        walletInit: {
          chain: "sui",
          seedSource: "raw",
          config: { rpcUrl: "https://fullnode.testnet.sui.io:443" }
        },
        seed: "test-seed",
        addresses: DEFAULT_FAKE_ADDRESSES
      })
    ).toThrow(LiveStreakConfigError);

    expect(() => createSuiOptionsChain()).toThrow(LiveStreakConfigError);
  });

  it("rejects unknown wallet chains", () => {
    expect(() =>
      createOptionsChain({
        walletInit: {
          chain: "nope",
          seedSource: "raw",
          config: {}
        },
        seed: "test-seed",
        addresses: DEFAULT_FAKE_ADDRESSES
      } as never)
    ).toThrow(LiveStreakConfigError);
  });
});
