import type { OptionsFunctionView } from '@livestreak/options'

export function findOptionsFunction(
  functions: readonly OptionsFunctionView[],
  name: string,
  match?: (fn: OptionsFunctionView) => boolean,
): OptionsFunctionView | undefined {
  return functions.find(fn => fn.name === name && (match ? match(fn) : true))
}

export function findFundFunction(
  functions: readonly OptionsFunctionView[],
  vaultId: string,
  side: 'yes' | 'no',
): OptionsFunctionView | undefined {
  return findOptionsFunction(functions, 'fund', fn =>
    fn.target?.kind === 'vault'
    && fn.target.vaultId === vaultId
    && fn.target.side === side)
}

export function findStopFundingFunction(
  functions: readonly OptionsFunctionView[],
  vaultId: string,
): OptionsFunctionView | undefined {
  return findOptionsFunction(functions, 'stopFunding', fn =>
    fn.target?.kind === 'vault' && fn.target.vaultId === vaultId)
}
