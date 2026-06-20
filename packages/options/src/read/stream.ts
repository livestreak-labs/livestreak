// --- exports ---

import type { MarketId, OptionsStreamState } from "../model/index.js";
import type { OptionsReadTransport } from "./transport.js";

export const readStreamState = async (
  transport: OptionsReadTransport,
  marketId: MarketId
): Promise<OptionsStreamState> => transport.readStreamState(marketId);
