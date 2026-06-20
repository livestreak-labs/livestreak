import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asVaultId } from "../../src/model/ids.js";
import { validateOptionsContractAddresses } from "../../src/read/decode/validation.js";
import {
  fundStream,
  setLanes,
  stopAllFunding,
  stopFunding
} from "../../src/write/funding.js";
import {
  createFakeChainWriter,
  DEFAULT_FAKE_ADDRESSES,
  type FakeChainWriter
} from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);

const writeDeps = (writer: FakeChainWriter = createFakeChainWriter()) => ({
  writer,
  addresses: DEFAULT_FAKE_ADDRESSES,
  abis: { MarketDriver: marketDriverAbi }
});

describe("write funding", () => {
  it("fundStream encodes tokenId, vault, side, rate, and deposit", async () => {
    const writer = createFakeChainWriter();

    await fundStream(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      rate: 13_333n,
      deposit: 1_000_000n
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "fund",
      args: [TOKEN_ID, VAULT_ID, 0, 13_333n, 1_000_000n]
    });
  });

  it("fundStream encodes no side as 1", async () => {
    const writer = createFakeChainWriter();

    await fundStream(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no",
      rate: 1n,
      deposit: 1n
    });

    expect(writer.requests[0]?.args).toEqual([TOKEN_ID, VAULT_ID, 1, 1n, 1n]);
  });

  it("setLanes encodes lanes and addDeposit", async () => {
    const writer = createFakeChainWriter();

    await setLanes(writeDeps(writer), {
      tokenId: TOKEN_ID,
      addDeposit: 500_000n,
      lanes: [
        { vaultId: VAULT_ID, side: "yes", rate: 10_000n },
        { vaultId: VAULT_ID, side: "no", rate: 5_000n }
      ]
    });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "setLanes",
      args: [
        TOKEN_ID,
        [
          { vaultId: VAULT_ID, side: 0, rate: 10_000n },
          { vaultId: VAULT_ID, side: 1, rate: 5_000n }
        ],
        500_000n
      ]
    });
  });

  it("stopFunding encodes tokenId, vault, and side", async () => {
    const writer = createFakeChainWriter();

    await stopFunding(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no"
    });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "stop",
      args: [TOKEN_ID, VAULT_ID, 1]
    });
  });

  it("stopAllFunding encodes tokenId only", async () => {
    const writer = createFakeChainWriter();

    await stopAllFunding(writeDeps(writer), { tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "stopAll",
      args: [TOKEN_ID]
    });
  });

  it("rejects invalid vaultId before write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      fundStream(writeDeps(writer), {
        tokenId: TOKEN_ID,
        vaultId: asVaultId("not_bytes32"),
        side: "yes",
        rate: 1n,
        deposit: 1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid tokenId before write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      stopAllFunding(writeDeps(writer), { tokenId: asTokenId(-1n) })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects zero rate before fundStream write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      fundStream(writeDeps(writer), {
        tokenId: TOKEN_ID,
        vaultId: VAULT_ID,
        side: "yes",
        rate: 0n,
        deposit: 1n
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid addresses at validation", () => {
    expect(() =>
      validateOptionsContractAddresses({
        ...DEFAULT_FAKE_ADDRESSES,
        marketDriver: "bad" as `0x${string}`
      })
    ).toThrow(LiveStreakConfigError);
  });
});
