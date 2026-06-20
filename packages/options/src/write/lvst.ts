// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { OptionsContractAddresses } from "../chains/addresses.js";
import type { OptionsChainWriter } from "../chains/types.js";
import type { OptionsContractAbis } from "../read/reader.js";

export type StakeLvstInput = {
  readonly amount: bigint;
};

export type UnstakeLvstInput = {
  readonly amount: bigint;
};

type LvstWriteDeps = {
  readonly writer: OptionsChainWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "Treasury">;
};

export const stakeLvst = async (deps: LvstWriteDeps, input: StakeLvstInput): Promise<string> => {
  const amount = requirePositiveBigInt(input.amount, "amount");

  return deps.writer.write({
    address: deps.addresses.treasury,
    abi: deps.abis.Treasury,
    functionName: "stakeLvst",
    args: [amount]
  });
};

export const unstakeLvst = async (deps: LvstWriteDeps, input: UnstakeLvstInput): Promise<string> => {
  const amount = requirePositiveBigInt(input.amount, "amount");

  return deps.writer.write({
    address: deps.addresses.treasury,
    abi: deps.abis.Treasury,
    functionName: "unstakeLvst",
    args: [amount]
  });
};

export const claimDividends = async (deps: LvstWriteDeps): Promise<string> =>
  deps.writer.write({
    address: deps.addresses.treasury,
    abi: deps.abis.Treasury,
    functionName: "claimDividends",
    args: []
  });

// --- helpers ---

const requirePositiveBigInt = (value: bigint, field: string): bigint => {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new LiveStreakConfigError({
      message: `Options write requires ${field} to be a bigint > 0`,
      metadata: { details: String(value) }
    });
  }

  return value;
};
