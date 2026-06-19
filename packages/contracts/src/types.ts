import type { Address } from "viem";

export type ContractChain = "evm" | "sui" | "solana";

export type EvmDeployScope = {
  readonly status: string;
  readonly contracts?: Readonly<Record<string, Address>>;
};

export type EvmDeployOutput = {
  readonly chain: string;
  readonly chainId: number;
  readonly rpc: string;
  readonly scopes: Readonly<Record<string, EvmDeployScope>>;
};

/** Flattened contract addresses from a deploy output file (scope merge order: aa → streaming → protocol → wire → paymaster). */
export type EvmDeployedContracts = Readonly<Record<string, Address>>;

export type EvmChainAddresses = {
  readonly chain: string;
  readonly chainId: number;
  readonly rpc: string;
  readonly contracts: EvmDeployedContracts;
};
