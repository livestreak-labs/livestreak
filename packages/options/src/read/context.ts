// --- exports ---

import {
  dripsStreamingAbi,
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi
} from "@livestreak/contracts/evm/abis";

import type { OptionsChain } from "../chains/types.js";
import type { OptionsContractAddresses } from "../chains/addresses.js";
import type { UserAddress } from "../model/ids.js";
import { validateOptionsContractAddresses, validateUserAddress } from "./decode/validation.js";

export type OptionsContractAbis = {
  readonly MarketRegistry: typeof marketRegistryAbi;
  readonly Vault: typeof vaultAbi;
  readonly MarketDriver: typeof marketDriverAbi;
  readonly StewardRegistry: typeof stewardRegistryAbi;
  readonly Treasury: typeof treasuryAbi;
  readonly LvstToken: typeof lvstTokenAbi;
  readonly DripsStreaming: typeof dripsStreamingAbi;
};

export const DEFAULT_ABIS: OptionsContractAbis = {
  MarketRegistry: marketRegistryAbi,
  Vault: vaultAbi,
  MarketDriver: marketDriverAbi,
  StewardRegistry: stewardRegistryAbi,
  Treasury: treasuryAbi,
  LvstToken: lvstTokenAbi,
  DripsStreaming: dripsStreamingAbi
};

export type ReaderContext = {
  readonly chain: OptionsChain;
  readonly addresses: OptionsContractAddresses;
  readonly abis: OptionsContractAbis;
  readonly transferOperator?: UserAddress;
  usdcAddress?: `0x${string}`;
};

export type OptionsReaderInput = {
  readonly chain: OptionsChain;
  readonly addresses: OptionsContractAddresses;
  readonly abis?: OptionsContractAbis;
  readonly includeProtocolSummary?: boolean;
  readonly transferOperator?: UserAddress;
};

export const createReaderContext = (input: OptionsReaderInput): ReaderContext => ({
  chain: input.chain,
  addresses: validateOptionsContractAddresses(input.addresses),
  abis: input.abis ?? DEFAULT_ABIS,
  ...(input.transferOperator === undefined
    ? {}
    : { transferOperator: validateUserAddress(input.transferOperator, "transferOperator") })
});

export const call = async <T>(
  ctx: ReaderContext,
  address: `0x${string}`,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[] = []
): Promise<T> =>
  (await ctx.chain.reader.read({ address, abi, functionName, args })) as T;
