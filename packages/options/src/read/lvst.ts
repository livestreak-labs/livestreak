// --- exports ---

import type { UserAddress } from "../model/ids.js";
import type { LvstAccount } from "../model/lvst.js";
import { contractsReadFailed } from "./decode/errors.js";
import { mapLvstAccount } from "./decode/mapping.js";
import { validateContractAddress, validateUserAddress } from "./decode/validation.js";
import type { ReaderContext } from "./context.js";
import { call } from "./context.js";

export const readUsdcAddress = async (ctx: ReaderContext): Promise<`0x${string}`> => {
  if (ctx.usdcAddress !== undefined) {
    return ctx.usdcAddress;
  }

  try {
    const address = await call<`0x${string}`>(
      ctx,
      ctx.addresses.marketDriver,
      ctx.abis.MarketDriver,
      "USDC",
      []
    );
    ctx.usdcAddress = validateContractAddress(address, "USDC");
    return ctx.usdcAddress;
  } catch (error) {
    throw contractsReadFailed("USDC address", error);
  }
};

export const readLvstAccount = async (
  ctx: ReaderContext,
  user: UserAddress
): Promise<LvstAccount> => {
  const account = validateUserAddress(user);

  try {
    const balance = await call<bigint>(
      ctx,
      ctx.addresses.lvstToken,
      ctx.abis.LvstToken,
      "balanceOf",
      [account as `0x${string}`]
    );

    const staked = await call<bigint>(
      ctx,
      ctx.addresses.treasury,
      ctx.abis.Treasury,
      "lvstStaked",
      [account as `0x${string}`]
    );

    const pendingDividends = await call<bigint>(
      ctx,
      ctx.addresses.treasury,
      ctx.abis.Treasury,
      "lvstPendingDividends",
      [account as `0x${string}`]
    );

    return mapLvstAccount(account, balance, staked, pendingDividends);
  } catch (error) {
    throw contractsReadFailed("LVST account", error);
  }
};
