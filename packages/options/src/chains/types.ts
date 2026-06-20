// --- exports ---

import type { WalletInit } from "@livestreak/schema";

import type { UserAddress } from "../model/ids.js";
import type { OptionsContractAddresses } from "./addresses.js";

export type ChainReadRequest = {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

export type OptionsChainReader = {
  readonly read: (request: ChainReadRequest) => Promise<unknown>;
};

export type ChainWriteRequest = {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

export type OptionsChainWriter = {
  readonly write: (request: ChainWriteRequest) => Promise<string>;
};

export type OptionsChain = {
  readonly reader: OptionsChainReader;
  readonly writer: OptionsChainWriter;
};

export type OptionsChainConfig = {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: OptionsContractAddresses;
  readonly readRpcUrl?: string;
  readonly includeProtocolSummary?: boolean;
  readonly transferOperator?: UserAddress;
};
