import { LiveStreakConfigError } from "@livestreak/core";
import { treasuryAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { claimDividends, stakeLvst, unstakeLvst } from "../../src/write/lvst.js";
import {
  createFakeChainWriter,
  DEFAULT_FAKE_ADDRESSES,
  type FakeChainWriter
} from "../helpers/fake-chain.js";

const writeDeps = (writer: FakeChainWriter = createFakeChainWriter()) => ({
  writer,
  addresses: DEFAULT_FAKE_ADDRESSES,
  abis: { Treasury: treasuryAbi }
});

describe("write lvst", () => {
  it("stakeLvst calls treasury stakeLvst with amount", async () => {
    const writer = createFakeChainWriter();
    const amount = 250_000_000_000_000_000n;

    await stakeLvst(writeDeps(writer), { amount });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "stakeLvst",
      args: [amount]
    });
  });

  it("unstakeLvst calls treasury unstakeLvst with amount", async () => {
    const writer = createFakeChainWriter();
    const amount = 100_000_000_000_000_000n;

    await unstakeLvst(writeDeps(writer), { amount });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "unstakeLvst",
      args: [amount]
    });
  });

  it("claimDividends calls treasury claimDividends with no args", async () => {
    const writer = createFakeChainWriter();

    await claimDividends(writeDeps(writer));

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.treasury,
      abi: treasuryAbi,
      functionName: "claimDividends",
      args: []
    });
  });

  it("rejects zero stake amount before write", async () => {
    const writer = createFakeChainWriter();

    await expect(stakeLvst(writeDeps(writer), { amount: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects zero unstake amount before write", async () => {
    const writer = createFakeChainWriter();

    await expect(unstakeLvst(writeDeps(writer), { amount: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );

    expect(writer.requests).toHaveLength(0);
  });
});
