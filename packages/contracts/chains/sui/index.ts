export { loadDeployment, listDeployments, DEFAULT_SUI_DEPLOYMENT } from "./addresses.js";
export { MODULES, target } from "./package.js";
export type { LiveStreakModule } from "./package.js";
export { LiveStreakSuiClient, SIDE_YES, SIDE_NO, USDC_ONE } from "./client.js";
export type { BoardView, VaultResolutionView } from "./client.js";
export type {
  SuiDeployment,
  SuiDeploymentName,
  SuiDeployOutput,
  SuiObjectIds,
} from "./types.js";
export {
  CYCLE_SECS,
  OUTCOME_YES,
  OUTCOME_NO,
  RATE,
  SUI_CLOCK_OBJECT_ID,
} from "./types.js";

export const chain = "sui" as const;
