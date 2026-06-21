// Browser-safe subset of @livestreak/contracts/sui — avoids node:fs re-exports in the barrel.
export { MODULES, target } from '../../../packages/contracts/dist/chains/sui/package.js'
export { localnetDeployment } from '../../../packages/contracts/dist/chains/sui/deployments/localnet.js'

export const chain = 'sui' as const
