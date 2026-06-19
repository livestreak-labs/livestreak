import localhost from "../../evm/deploy/output/localhost.json" with { type: "json" };

import type { EvmDeployOutput, EvmDeployedContracts } from "../types.js";

export {
  callerAbi,
  dripsStreamingAbi,
  iDripsAbi,
  liveStreakPaymasterAbi,
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  protocolAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi,
  vaultDriverAbi
} from "../../evm/generated/contracts.js";

const flattenScopes = (output: EvmDeployOutput): EvmDeployedContracts => ({
  ...(output.scopes.aa?.contracts ?? {}),
  ...(output.scopes.streaming?.contracts ?? {}),
  ...(output.scopes.protocol?.contracts ?? {}),
  ...(output.scopes.wire?.contracts ?? {}),
  ...(output.scopes.paymaster?.contracts ?? {})
});

/** Known localhost deploy snapshot (regenerate via `npm run deploy` in evm/). */
export const localhostAddresses = {
  chain: localhost.chain,
  chainId: localhost.chainId,
  rpc: localhost.rpc,
  contracts: flattenScopes(localhost as EvmDeployOutput)
} as const;

/** Deploy outputs keyed by chain name (`localhost`, …). */
export const addressesByChain = {
  localhost: localhostAddresses
} as const;

export const chain = "evm" as const;
