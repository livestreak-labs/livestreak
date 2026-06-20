import { LiveStreakConfigError } from "@livestreak/core";
import { marketDriverAbi, treasuryAbi } from "@livestreak/contracts/evm/abis";
import { describe, expect, it } from "vitest";

import { asTokenId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import { claimLossLvst, withdraw, withdrawMany } from "../../src/write/claim.js";
import {
  createFakeChainWriter,
  DEFAULT_FAKE_ADDRESSES,
  type FakeChainWriter
} from "../helpers/fake-chain.js";

const TOKEN_ID = asTokenId(42n);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);
const VAULT_ID_B = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000bb"
);
const TO = asUserAddress("0x00000000000000000000000000000000000000dd");

const writeDeps = (writer: FakeChainWriter = createFakeChainWriter()) => ({
  writer,
  addresses: DEFAULT_FAKE_ADDRESSES,
  abis: { MarketDriver: marketDriverAbi, Treasury: treasuryAbi }
});

describe("write claim", () => {
  it("withdraw encodes tokenId, vault, and recipient", async () => {
    const writer = createFakeChainWriter();

    await withdraw(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "withdraw",
      args: [TOKEN_ID, VAULT_ID, TO]
    });
  });

  it("withdrawMany encodes tokenId, vault list, and recipient", async () => {
    const writer = createFakeChainWriter();

    await withdrawMany(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultIds: [VAULT_ID, VAULT_ID_B],
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "withdraw",
      args: [TOKEN_ID, [VAULT_ID, VAULT_ID_B], TO]
    });
  });

  it("claimLossLvst encodes tokenId, vault, side, and recipient", async () => {
    const writer = createFakeChainWriter();

    await claimLossLvst(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "yes",
      to: TO
    });

    expect(writer.requests[0]).toEqual({
      address: DEFAULT_FAKE_ADDRESSES.marketDriver,
      abi: marketDriverAbi,
      functionName: "claimLossLvst",
      args: [TOKEN_ID, VAULT_ID, 0, TO]
    });
  });

  it("claimLossLvst encodes no side as 1", async () => {
    const writer = createFakeChainWriter();

    await claimLossLvst(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      side: "no",
      to: TO
    });

    expect(writer.requests[0]?.args).toEqual([TOKEN_ID, VAULT_ID, 1, TO]);
  });

  it("rejects invalid vaultId before withdraw write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      withdraw(writeDeps(writer), {
        tokenId: TOKEN_ID,
        vaultId: asVaultId("short"),
        to: TO
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("rejects invalid tokenId before claimLossLvst write", async () => {
    const writer = createFakeChainWriter();

    await expect(
      claimLossLvst(writeDeps(writer), {
        tokenId: asTokenId(-1n),
        vaultId: VAULT_ID,
        side: "yes",
        to: TO
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(writer.requests).toHaveLength(0);
  });

  it("returns userOp hash from chain writer", async () => {
    const writer = createFakeChainWriter();

    const hash = await withdraw(writeDeps(writer), {
      tokenId: TOKEN_ID,
      vaultId: VAULT_ID,
      to: TO
    });

    expect(hash).toBe("0xfake_user_op_hash");
  });
});
