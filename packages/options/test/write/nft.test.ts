import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asUserAddress } from "../../src/model/ids.js";
import { approveNft, setApprovalForAll, transferNft } from "../../src/write/nft.js";
import {
  createFakeChainWriter,
  DEFAULT_FAKE_ADDRESSES,
  type FakeChainWriter
} from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const FROM = asUserAddress("0x0000000000000000000000000000000000000001");
const TO = asUserAddress("0x0000000000000000000000000000000000000002");
const OPERATOR = asUserAddress("0x0000000000000000000000000000000000000003");

const writeDeps = (writer: FakeChainWriter = createFakeChainWriter()) => ({
  writer,
  addresses: DEFAULT_FAKE_ADDRESSES,
  abis: { MarketDriver: marketDriverAbi }
});

describe("write nft", () => {
  it("transferNft encodes from, to, and tokenId", async () => {
    const writer = createFakeChainWriter();

    await transferNft(writeDeps(writer), { from: FROM, to: TO, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "transferFrom",
      args: [FROM, TO, TOKEN_ID]
    });
  });

  it("approveNft encodes operator and tokenId", async () => {
    const writer = createFakeChainWriter();

    await approveNft(writeDeps(writer), { operator: OPERATOR, tokenId: TOKEN_ID });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "approve",
      args: [OPERATOR, TOKEN_ID]
    });
  });

  it("setApprovalForAll encodes operator and approved flag", async () => {
    const writer = createFakeChainWriter();

    await setApprovalForAll(writeDeps(writer), { operator: OPERATOR, approved: true });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "setApprovalForAll",
      args: [OPERATOR, true]
    });
  });

  it("rejects invalid tokenId before transfer write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      transferNft(writeDeps(writer), {
        from: FROM,
        to: TO,
        tokenId: asTokenId(-1n)
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid operator before approve write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      approveNft(writeDeps(writer), {
        operator: asUserAddress("bad"),
        tokenId: TOKEN_ID
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });
});
