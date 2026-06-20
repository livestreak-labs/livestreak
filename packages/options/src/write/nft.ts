// --- exports ---

import type { TokenId, UserAddress } from "../model/ids.js";
import type { OptionsContractAddresses } from "../chains/addresses.js";
import type { OptionsChainWriter } from "../chains/types.js";
import type { OptionsContractAbis } from "../read/context.js";
import { validateTokenIdForContracts, validateUserAddress } from "../read/decode/validation.js";

export type TransferNftInput = {
  readonly from: UserAddress;
  readonly to: UserAddress;
  readonly tokenId: TokenId;
};

export type ApproveNftInput = {
  readonly operator: UserAddress;
  readonly tokenId: TokenId;
};

export type SetApprovalForAllInput = {
  readonly operator: UserAddress;
  readonly approved: boolean;
};

type NftWriteDeps = {
  readonly writer: OptionsChainWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver">;
};

export const transferNft = async (deps: NftWriteDeps, input: TransferNftInput): Promise<string> => {
  const from = validateUserAddress(input.from, "from");
  const to = validateUserAddress(input.to, "to");
  const tokenId = validateTokenIdForContracts(input.tokenId);

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "transferFrom",
    args: [from as `0x${string}`, to as `0x${string}`, tokenId]
  });
};

export const approveNft = async (deps: NftWriteDeps, input: ApproveNftInput): Promise<string> => {
  const operator = validateUserAddress(input.operator, "operator");
  const tokenId = validateTokenIdForContracts(input.tokenId);

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "approve",
    args: [operator as `0x${string}`, tokenId]
  });
};

export const setApprovalForAll = async (
  deps: NftWriteDeps,
  input: SetApprovalForAllInput
): Promise<string> => {
  const operator = validateUserAddress(input.operator, "operator");

  return deps.writer.write({
    address: deps.addresses.marketDriver,
    abi: deps.abis.MarketDriver,
    functionName: "setApprovalForAll",
    args: [operator as `0x${string}`, input.approved]
  });
};
