import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import { stewardRegistryAbi } from "@livestreak/contracts/evm/abis";
import {
  OUTCOME_SOLIDITY,
  encodeResolveVaultCall,
  outcomeToSolidityValue,
  parseOutcomeArg,
  resolveVaultEvm
} from "../src/adapters/steward.js";

const vaultId = `0x${"ab".repeat(32)}` as `0x${string}`;
const stewardRegistry = "0x0000000000000000000000000000000000000abc" as `0x${string}`;

// pollUntilUserOperationIncluded reaches out to a bundler; stub it so the runtime is mocked.
vi.mock("@livestreak/wallet", async (importActual) => {
  const actual = await importActual<typeof import("@livestreak/wallet")>();
  return { ...actual, pollUntilUserOperationIncluded: vi.fn(async () => undefined) };
});

describe("steward resolve — outcome parsing", () => {
  it("parses yes/no case-insensitively and rejects junk", () => {
    expect(parseOutcomeArg("yes")).toBe("yes");
    expect(parseOutcomeArg(" NO ")).toBe("no");
    expect(() => parseOutcomeArg("maybe")).toThrow(/yes.*no/i);
    expect(() => parseOutcomeArg("")).toThrow();
  });

  it("maps outcomes to the Vault.Outcome enum (yes=1, no=2)", () => {
    expect(outcomeToSolidityValue("yes")).toBe(OUTCOME_SOLIDITY.yes);
    expect(outcomeToSolidityValue("no")).toBe(OUTCOME_SOLIDITY.no);
    expect(OUTCOME_SOLIDITY).toEqual({ pending: 0, yes: 1, no: 2 });
  });
});

describe("steward resolve — calldata", () => {
  it("encodes resolveVault against the live steward registry ABI and round-trips", () => {
    const data = encodeResolveVaultCall(vaultId, "yes");
    const decoded = decodeFunctionData({ abi: stewardRegistryAbi, data });
    expect(decoded.functionName).toBe("resolveVault");
    expect(decoded.args?.[0]).toBe(vaultId);
    expect(decoded.args?.[1]).toBe(1);
  });

  it("encodes the losing outcome as 2", () => {
    const decoded = decodeFunctionData({
      abi: stewardRegistryAbi,
      data: encodeResolveVaultCall(vaultId, "no")
    });
    expect(decoded.args?.[1]).toBe(2);
  });
});

describe("steward resolve — EVM dispatch", () => {
  it("sends resolveVault to the steward registry via the operator wallet and returns the hash", async () => {
    const sendTransaction = vi.fn(async () => ({ hash: "0xdeadbeef" }));
    const account = {
      sendTransaction,
      toReadOnlyAccount: vi.fn(async () => ({}))
    } as never;

    const tx = await resolveVaultEvm({ account, stewardRegistry, vaultId, outcome: "yes" });

    expect(tx).toBe("0xdeadbeef");
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    const call = sendTransaction.mock.calls[0][0] as { to: string; data: string; value: bigint };
    expect(call.to).toBe(stewardRegistry);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: stewardRegistryAbi, data: call.data as `0x${string}` });
    expect(decoded.functionName).toBe("resolveVault");
    expect(decoded.args?.[1]).toBe(1);
  });
});
