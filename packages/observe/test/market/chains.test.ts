import { describe, expect, it, vi } from "vitest";
import { Effect, Exit } from "effect";
import { keccak256, encodeAbiParameters } from "viem";
import { assertUserOperationSucceeded, computeMarketId } from "#market/chains/evm.js";
import { createMarketRegistrar } from "#market/chains/index.js";
import { testPlaceholderDeriveStreamId } from "#market/types.js";
import type { ObserveRunMarketConfig } from "#market/types.js";

const GOLDEN_OBSERVER = "0x00000000000000000000000000000000000000aa" as const;
const GOLDEN_STREAM_ID =
  "0x00000000000000000000000000000000000000000000000000000000000000bb" as const;
const GOLDEN_MARKET_ID = keccak256(
  encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [GOLDEN_OBSERVER, GOLDEN_STREAM_ID]
  )
);

const evmWalletMocks = vi.hoisted(() => {
  const observer = "0x00000000000000000000000000000000000000cc" as const;
  const readOnly = {
    getAddress: vi.fn(async () => observer),
    getUserOperationReceipt: vi.fn(async () => ({
      success: true,
      logs: [],
      userOpHash: "0xuserop",
      sender: observer
    }))
  };
  const account = {
    sendTransaction: vi.fn(async () => ({ hash: "0xuserop", fee: 0n })),
    toReadOnlyAccount: vi.fn(async () => readOnly)
  };

  return { observer, readOnly, account };
});

vi.mock("@livestreak/wallet", () => ({
  createWalletManager: () => ({
    getAccount: async () => evmWalletMocks.account
  })
}));

import { createEvmMarketRegistrar } from "#market/chains/evm.js";

const minimalEvmConfig = (deriveStreamId = testPlaceholderDeriveStreamId): ObserveRunMarketConfig => ({
  walletInit: {
    chain: "evm",
    seedSource: "raw",
    config: {
      chainId: 1,
      provider: "https://example.invalid",
      bundlerUrl: "https://example.invalid",
      isSponsored: true,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  },
  seed: "test-seed",
  marketRegistryAddress: "0x0000000000000000000000000000000000000001",
  title: "Local market",
  deriveStreamId
});

describe("market chain seam", () => {
  it("computeMarketId matches MarketRegistry.computeMarketId golden vector", () => {
    expect(computeMarketId(GOLDEN_OBSERVER, GOLDEN_STREAM_ID)).toBe(GOLDEN_MARKET_ID);
  });

  it("assertUserOperationSucceeded reads only success (ignores empty logs)", async () => {
    const exit = await Effect.runPromiseExit(
      assertUserOperationSucceeded({
        success: true,
        logs: [],
        userOpHash: "0xdead",
        sender: GOLDEN_OBSERVER
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("assertUserOperationSucceeded fails when success is false", async () => {
    const exit = await Effect.runPromiseExit(
      assertUserOperationSucceeded({
        success: false,
        logs: [{ address: "0x1", topics: [], data: "0x" }],
        userOpHash: "0xdead",
        sender: GOLDEN_OBSERVER
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("reverted");
    }
  });

  it("registers with locally computed marketId when receipt logs are empty", async () => {
    const streamId = testPlaceholderDeriveStreamId("run_local_market_id");
    const expectedMarketId = computeMarketId(evmWalletMocks.observer, streamId);

    const registrar = createEvmMarketRegistrar(minimalEvmConfig());
    const exit = await Effect.runPromiseExit(
      registrar.registerMarket({
        runId: "run_local_market_id",
        title: "Local market",
        streamId
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.marketId).toBe(expectedMarketId);
      expect(exit.value.streamId).toBe(streamId);
      expect(evmWalletMocks.readOnly.getUserOperationReceipt).toHaveBeenCalledWith("0xuserop");
    }
  });

  it("returns typed not-supported for sui wallet chain", async () => {
    const config: ObserveRunMarketConfig = {
      walletInit: {
        chain: "sui",
        seedSource: "raw",
        config: { rpcUrl: "https://example.invalid" }
      },
      seed: "test-seed",
      marketRegistryAddress: "0x0000000000000000000000000000000000000001",
      title: "Sui stream",
      deriveStreamId: testPlaceholderDeriveStreamId
    };

    const registrar = await Effect.runPromise(createMarketRegistrar(config));
    const exit = await Effect.runPromiseExit(
      registrar.registerMarket({
        runId: "run_sui",
        title: config.title,
        streamId: testPlaceholderDeriveStreamId("run_sui")
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("not supported");
    }
  });
});
