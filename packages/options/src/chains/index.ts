// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import { validateOptionsChainConfig } from "./config.js";
import { createEvmOptionsChain } from "./evm/index.js";
import { createSuiOptionsChain } from "./sui/index.js";
import type { OptionsChain, OptionsChainConfig } from "./types.js";

export type { OptionsContractAddresses } from "./evm/addresses.js";
export { validateOptionsChainConfig } from "./config.js";
export type {
  ApproveNftInput,
  ClaimLossLvstInput,
  FundStreamInput,
  LaneWriteInput,
  OptionsChain,
  OptionsChainConfig,
  OptionsReader,
  OptionsWriter,
  SetApprovalForAllInput,
  SetLanesInput,
  StakeLvstInput,
  StopAllFundingInput,
  StopFundingInput,
  TransferNftInput,
  TxId,
  UnstakeLvstInput,
  WithdrawInput,
  WithdrawManyInput
} from "./types.js";
export { asTxId } from "./types.js";

export const createOptionsChain = (config: OptionsChainConfig): OptionsChain => {
  const validated = validateOptionsChainConfig(config);
  const walletInit = validated.walletInit;

  switch (walletInit.chain) {
    case "evm": {
      return createEvmOptionsChain({ ...validated, walletInit });
    }
    case "sui": {
      void walletInit;
      return createSuiOptionsChain();
    }
    default: {
      return unreachableChain(walletInit);
    }
  }
};

// --- helpers ---

const unreachableChain = (walletInit: WalletInit): never => {
  throw new LiveStreakConfigError({
    message: `Unsupported wallet chain for options: ${String(walletInit.chain)}`
  });
};
