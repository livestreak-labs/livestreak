// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { TokenId, UserAddress, VaultId } from "../model/ids.js";
import type { OptionsClaimsView } from "../model/claims.js";
import { projectClaimsView } from "../model/claims.js";
import type { OptionsVaultSide } from "../model/vault.js";
import { gatherUserVaultClaims } from "./aggregation.js";
import { contractsReadFailed } from "./decode/errors.js";
import { mapVaultIds } from "./decode/mapping.js";
import { sideFromSolidityValue, sideToSolidityValue } from "./decode/sides.js";
import { validateTokenIdForContracts, validateVaultIdForContracts } from "./decode/validation.js";
import type { ReaderContext } from "./context.js";
import { call } from "./context.js";
import type { OptionsReadTransport } from "./transport.js";
import { readVault } from "./vault.js";

export const readClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "claimable", [
      id,
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("claimable", error);
  }
};

export const readLossClaimable = async (
  ctx: ReaderContext,
  tokenId: TokenId,
  vaultId: VaultId,
  side: OptionsVaultSide
): Promise<bigint> => {
  const id = validateTokenIdForContracts(tokenId);
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "lossClaimable", [
      id,
      vaultBytes,
      sideToSolidityValue(side)
    ]);
  } catch (error) {
    throw contractsReadFailed("loss claimable", error);
  }
};

export const readPot = async (ctx: ReaderContext, vaultId: VaultId): Promise<bigint> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<bigint>(ctx, ctx.addresses.vault, ctx.abis.Vault, "pot", [vaultBytes]);
  } catch (error) {
    throw contractsReadFailed("pot", error);
  }
};

export const readCollected = async (ctx: ReaderContext, vaultId: VaultId): Promise<boolean> => {
  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    return await call<boolean>(ctx, ctx.addresses.vault, ctx.abis.Vault, "collected", [vaultBytes]);
  } catch (error) {
    throw contractsReadFailed("collected", error);
  }
};

export const readAccountVaultIds = async (
  ctx: ReaderContext,
  tokenId: TokenId
): Promise<readonly VaultId[]> => {
  const id = validateTokenIdForContracts(tokenId);

  try {
    const vaultIds = await call<readonly `0x${string}`[]>(
      ctx,
      ctx.addresses.vault,
      ctx.abis.Vault,
      "getAccountVaultIds",
      [id]
    );

    return mapVaultIds(vaultIds);
  } catch (error) {
    throw contractsReadFailed("account vault ids", error);
  }
};

export const readWinningSide = async (
  ctx: ReaderContext,
  vaultId: VaultId
): Promise<OptionsVaultSide | undefined> => {
  const vault = await readVault(ctx, vaultId);

  if (vault.status !== "resolved") {
    return undefined;
  }

  const vaultBytes = validateVaultIdForContracts(vaultId);

  try {
    const side = await call<number>(ctx, ctx.addresses.vault, ctx.abis.Vault, "winningSide", [
      vaultBytes
    ]);

    return sideFromSolidityValue(side);
  } catch (error) {
    throw contractsReadFailed("winning side", error);
  }
};

export const readClaimsView = async (
  transport: OptionsReadTransport,
  user: UserAddress
): Promise<OptionsClaimsView> => {
  const rows = await gatherUserVaultClaims(transport, user);
  return projectClaimsView(user, rows);
};
