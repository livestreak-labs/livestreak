// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { OptionsChain } from "./types.js";

export const createSuiOptionsChain = (): OptionsChain => {
  throw new LiveStreakConfigError({
    message: "Sui options chain is not supported: no Sui options contracts exist yet"
  });
};
