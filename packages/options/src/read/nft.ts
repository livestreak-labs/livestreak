// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { asMarketId, asTokenId, asVaultId } from "../model/ids.js";
import type { TokenId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsNft } from "../model/nft.js";
import type { OptionsVaultSide } from "../model/vault.js";
import {
  readClaimable,
  readLossClaimable,
  readWinningSide
} from "./claims.js";
import { contractsReadFailed } from "./decode/errors.js";
import {
  bytes32ToHex,
  enrichLane,
  mapApprovedAddress,
  mapLane,
  mapNft,
  mapStreamsStateBalance,
  type RawLane,
  type RawPosition,
  type RawStreamsState
} from "./decode/mapping.js";
import { validateTokenIdForContracts, validateUserAddress } from "./decode/validation.js";
import type { ReaderContext } from "./context.js";
import { call } from "./context.js";
import { readUsdcAddress } from "./lvst.js";

export const listOwnerTokens = async (
  ctx: ReaderContext,
  owner: UserAddress
): Promise<readonly TokenId[]> => {
  const account = validateUserAddress(owner);

  try {
    const tokenIds = await call<readonly bigint[]>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "tokensOfOwner",
      [account as `0x${string}`]
    );

    return tokenIds.map((id) => asTokenId(id));
  } catch (error) {
    throw contractsReadFailed("owner tokens", error);
  }
};

export const readNft = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  owner: UserAddress
): Promise<OptionsNft> => {
  const id = validateTokenIdForContracts(tokenId);
  const account = validateUserAddress(owner);

  try {
    const marketIdRaw = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "marketIdOf",
      [id]
    );

    const laneCount = await call<bigint>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "laneCount",
      [id]
    );

    const count = Number(laneCount);
    const lanes = [];
    const winningSideByVault = new Map<string, OptionsVaultSide | undefined>();

    for (let index = 0; index < count; index += 1) {
      const lane = await call<RawLane>(
        ctx,
        ctx.addresses.marketDriver,
        ctx.abis.MarketDriver,
        "laneAt",
        [id, BigInt(index)]
      );

      const vaultBytes = lane.vaultId;
      const vaultId = asVaultId(bytes32ToHex(vaultBytes));
      const position = await call<RawPosition>(
        ctx,
        ctx.addresses.vault,
        ctx.abis.Vault,
        "getPosition",
        [vaultBytes, lane.side, id]
      );

      const mapped = mapLane(asTokenId(id), lane, position);
      let winningSide = winningSideByVault.get(vaultId);

      if (!winningSideByVault.has(vaultId)) {
        winningSide = await readWinningSide(ctx, vaultId);
        winningSideByVault.set(vaultId, winningSide);
      }

      const claimable = await readClaimable(ctx, asTokenId(id), vaultId, mapped.side);
      const lossClaimable = await readLossClaimable(ctx, asTokenId(id), vaultId, mapped.side);

      lanes.push(enrichLane(mapped, claimable, lossClaimable, winningSide));
    }

    return mapNft(
      asTokenId(id),
      account,
      asMarketId(bytes32ToHex(marketIdRaw)),
      count,
      lanes,
      await readTransferFlags(ctx, id)
    );
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("nft", error);
  }
};

export const readNftBalance = async (ctx: ReaderContext, tokenId: TokenId): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const usdc = await readUsdcAddress(ctx);
    const state = await call<RawStreamsState>(
      ctx,
      ctx.addresses.dripsStreaming,
      ctx.abis.DripsStreaming,
      "streamsState",
      [id, usdc]
    );

    return mapStreamsStateBalance(state);
  } catch (error) {
    throw contractsReadFailed("NFT balance", error);
  }
};

export const readOwnerOf = async (ctx: ReaderContext, tokenId: TokenId): Promise<UserAddress> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const owner = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "ownerOf",
      [id]
    );

    return validateUserAddress(owner, "ownerOf");
  } catch (error) {
    throw contractsReadFailed("ownerOf", error);
  }
};

export const readApproved = async (
  ctx: ReaderContext,
  tokenId: TokenId
): Promise<UserAddress | undefined> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const approved = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "getApproved",
      [id]
    );

    return mapApprovedAddress(approved);
  } catch (error) {
    throw contractsReadFailed("getApproved", error);
  }
};

export const readIsApprovedForAll = async (
  ctx: ReaderContext,
  owner: UserAddress,
  operator: UserAddress
): Promise<boolean> => {
  const account = validateUserAddress(owner);
  const approvedOperator = validateUserAddress(operator, "operator");

  try {
    return await call<boolean>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "isApprovedForAll",
      [account as `0x${string}`, approvedOperator as `0x${string}`]
    );
  } catch (error) {
    throw contractsReadFailed("isApprovedForAll", error);
  }
};

// --- helpers ---

const readTransferFlags = async (
  ctx: ReaderContext,
  tokenId: bigint
): Promise<{ readonly approved?: UserAddress; readonly isOperator?: boolean }> => {
  const [approved, ownerOnChain] = await Promise.all([
    readApproved(ctx, asTokenId(tokenId)),
    readOwnerOf(ctx, asTokenId(tokenId))
  ]);

  const isOperator =
    ctx.transferOperator === undefined
      ? undefined
      : await readIsApprovedForAll(ctx, ownerOnChain, ctx.transferOperator);

  if (approved === undefined && isOperator === undefined) {
    return {};
  }

  return {
    ...(approved === undefined ? {} : { approved }),
    ...(isOperator === undefined ? {} : { isOperator })
  };
};
