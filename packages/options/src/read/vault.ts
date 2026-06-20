// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { TokenId, VaultId } from "../model/ids.js";
import type { OptionsBoardState } from "../model/math/accrual.js";
import type { OptionsVault } from "../model/vault.js";
import type { OptionsVaultShareTotals, OptionsVaultSide } from "../model/vault.js";
import { contractsReadFailed, contractsReadNotFound } from "./decode/errors.js";
import {
  mapBoard,
  mapVault,
  mapVaultShareTotals,
  type RawBoard,
  type RawDisputeState,
  type RawHotState,
  type RawVaultData,
  type RawVaultPools
} from "./decode/mapping.js";
import { sideToSolidityValue } from "./decode/sides.js";
import { validateTokenIdForContracts, validateVaultIdForContracts } from "./decode/validation.js";
import type { ReaderContext } from "./context.js";
import { call } from "./context.js";

export const readVault = async (ctx: ReaderContext, vaultId: VaultId): Promise<OptionsVault> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const data = await call<RawVaultData>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getVault", [
      vaultBytes
    ]);

    if (!data.exists) {
      throw contractsReadNotFound("vault", vaultId);
    }

    const pools = await call<RawVaultPools>(
      ctx,
      ctx.addresses.vault,
      ctx.abis.Vault,
      "getVaultPools",
      [vaultBytes]
    );

    const hot = await call<RawHotState>(
      ctx,
      ctx.addresses.stewardRegistry,
      ctx.abis.StewardRegistry,
      "vaultHotState",
      [vaultBytes]
    );

    const dispute = await call<RawDisputeState>(
      ctx,
      ctx.addresses.stewardRegistry,
      ctx.abis.StewardRegistry,
      "disputeState",
      [vaultBytes]
    );

    return mapVault(data, pools, hot, dispute);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("vault", error);
  }
};

export const readVaultPools = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<RawVaultPools> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);
  return call<RawVaultPools>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getVaultPools", [
    vaultBytes
  ]);
};

export const readVaultShareTotals = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultShareTotals> => {
  const poolsRaw = await readVaultPools(ctx, vaultId);
  return mapVaultShareTotals(poolsRaw);
};

export const readBoard = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<OptionsBoardState> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const board = await call<RawBoard>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getBoard", [
      vaultBytes,
      sideToSolidityValue(side)
    ]);

    return mapBoard(board);
  } catch (error) {
    throw contractsReadFailed("board", error);
  }
};

export const readSharePrice = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "getSharePrice", [
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("share price", error);
  }
};

export const readPendingShares = async (
  ctx: ReaderContext,
  vaultId: VaultId,
  side: OptionsVaultSide,
  tokenId: TokenId
): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);
  const id = validateTokenIdForContracts(tokenId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "pendingShares", [
      vaultBytes,
      sideToSolidityValue(side),
      id
    ]);
  } catch (error) {
    throw contractsReadFailed("pending shares", error);
  }
};
