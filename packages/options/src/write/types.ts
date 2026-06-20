// --- exports ---

import type { OptionsContractAddresses } from "../chains/addresses.js";
import type { OptionsChainWriter } from "../chains/types.js";
import type { OptionsContractAbis } from "../read/reader.js";

export type OptionsWriteDeps = {
  readonly writer: OptionsChainWriter;
  readonly addresses: OptionsContractAddresses;
  readonly abis: Pick<OptionsContractAbis, "MarketDriver" | "Treasury">;
};
