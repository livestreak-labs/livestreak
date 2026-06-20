// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { asMarketId } from "../model/ids.js";
import type { MarketId, VaultId } from "../model/ids.js";
import type { OptionsMarket } from "../model/market.js";
import type { OptionsProtocolSummary } from "../model/snapshot.js";
import type { OptionsStreamState } from "../model/stream.js";
import { contractsReadFailed, contractsReadNotFound } from "./decode/errors.js";
import {
  bytes32ToHex,
  mapMarket,
  mapProtocolSummary,
  mapStreamState,
  mapVaultIds,
  type RawMarketData,
  type RawStreamState
} from "./decode/mapping.js";
import { validateMarketIdForContracts } from "./decode/validation.js";
import type { ReaderContext } from "./context.js";
import { call } from "./context.js";

export const readMarket = async (ctx: ReaderContext, marketId: MarketId): Promise<OptionsMarket> => {
  const marketBytes = validateMarketIdForContracts(marketId);

  try {
    const exists = await call<boolean>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "marketExists",
      [marketBytes]
    );

    if (!exists) {
      throw contractsReadNotFound("market", marketId);
    }

    const market = await call<RawMarketData>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "getMarket",
      [marketBytes]
    );

    const vaultIdsRaw = await call<readonly `0x${string}`[]>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "getVaultIds",
      [marketBytes]
    );

    return mapMarket(asMarketId(bytes32ToHex(market.id)), market, mapVaultIds(vaultIdsRaw));
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("market", error);
  }
};

export const readStreamState = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<OptionsStreamState> => {
  const marketBytes = validateMarketIdForContracts(marketId);

  try {
    const state = await call<RawStreamState>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "streamState",
      [marketBytes]
    );

    return mapStreamState(state);
  } catch (error) {
    if (error instanceof LiveStreakConfigError) {
      throw error;
    }

    throw contractsReadFailed("stream state", error);
  }
};

export const listMarketVaults = async (
  ctx: ReaderContext,
  marketId: MarketId
): Promise<readonly VaultId[]> => {
  const market = await readMarket(ctx, marketId);
  return market.vaultIds;
};

export const loadProtocolSummary = async (ctx: ReaderContext): Promise<OptionsProtocolSummary> => {
  try {
    const marketCount = await call<bigint>(
      ctx,
      ctx.addresses.marketRegistry,
      ctx.abis.MarketRegistry,
      "marketCount",
      []
    );

    let vaultCount = 0;
    const count = Number(marketCount);

    for (let index = 0; index < count; index += 1) {
      const marketId = await call<`0x${string}`>(
        ctx,
        ctx.addresses.marketRegistry,
        ctx.abis.MarketRegistry,
        "marketIdAt",
        [BigInt(index)]
      );
      const ids = await call<readonly `0x${string}`[]>(
        ctx,
        ctx.addresses.marketRegistry,
        ctx.abis.MarketRegistry,
        "getVaultIds",
        [marketId]
      );
      vaultCount += ids.length;
    }

    return mapProtocolSummary(marketCount, vaultCount);
  } catch (error) {
    throw contractsReadFailed("protocol summary", error);
  }
};
