import { LiveStreakCapabilityError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import type { CapabilityGrant, CapabilityScope } from "../src/bridge/scope.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  createOptionsBridge
} from "../src/bridge/index.js";
import { asMarketId } from "../src/model/ids.js";
import { createOptionsRuntime } from "../src/runtime/index.js";
import {
  createFakeChainConfig,
  createFakeChainWriter,
  createFakeOptionsReader,
  fixtureSeed,
  fixtureUser
} from "./helpers/fake-chain.js";

const trustedCaller = { id: "trusted-local", trusted: true as const };

const grantedCaller = {
  id: "granted-user",
  grants: [
    createCapabilityGrant({
      id: "grant-1",
      holder: "granted-user",
      scopes: [
        bridgeBoardReadScope,
        bridgeControlsReadScope,
        bridgeBoardSubscribeScope,
        bridgeActionScope
      ]
    })
  ]
};

const deniedCaller = { id: "denied-user", grants: [] };

const runtime = () =>
  createOptionsRuntime({
    config: {
      runtimeId: "bridge_runtime",
      user: fixtureUser(),
      marketIds: [asMarketId("market_01")],
      defaultMarketId: asMarketId("market_01")
    },
    chainConfig: createFakeChainConfig(fixtureSeed()),
    chain: { reader: createFakeOptionsReader(fixtureSeed()), writer: createFakeChainWriter() }
  });

describe("options bridge", () => {
  it("readBoard requires authorization", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));

    await expect(bridge.readBoard(deniedCaller)).rejects.toBeInstanceOf(LiveStreakCapabilityError);

    const board = await bridge.readBoard(trustedCaller);
    expect(board.panel.account).toBe(fixtureUser());
    expect(board.revision).toBeGreaterThan(0);
  });

  it("readControls projects action flags", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));

    const controls = await bridge.readControls(grantedCaller);
    expect(controls.account).toBe(fixtureUser());
    expect(controls.actions.canFund).toBe(true);
  });

  it("callAction dispatches writer operations and returns TxId", async () => {
    const writer = createFakeChainWriter();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_write",
        user: fixtureUser(),
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: { reader: createFakeOptionsReader(fixtureSeed()), writer }
    });
    const bridge = createOptionsBridge({ runtime: rt });

    const txId = await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "claimDividends",
      args: {}
    });

    expect(txId).toBeTruthy();
    expect(writer.requests[0]?.action).toBe("claimDividends");
  });

  it("subscribeBoard notifies on refresh", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    const boards: number[] = [];

    const unsubscribe = bridge.subscribeBoard(grantedCaller, (board) => {
      boards.push(board.revision);
    });

    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));
    unsubscribe();

    expect(boards.length).toBeGreaterThan(0);
  });

  it("watch forwards memory updates", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    const seen: unknown[] = [];

    const unsubscribe = bridge.watch(grantedCaller, "session:key", (value) => {
      seen.push(value);
    });

    rt.set("session:key", { ok: true });
    unsubscribe();

    expect(seen).toEqual([{ ok: true }]);
  });
});

function createCapabilityGrant(input: {
  id: string;
  holder: string;
  scopes: readonly CapabilityScope[];
}): CapabilityGrant {
  return {
    id: input.id,
    sessionId: input.id,
    holder: input.holder,
    scopes: input.scopes,
    revoked: false
  };
}
