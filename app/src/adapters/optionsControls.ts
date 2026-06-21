import type { OptionsFunctionView } from '@livestreak/options'

export function findOptionsFunction(
  functions: readonly OptionsFunctionView[],
  name: string,
  match?: (fn: OptionsFunctionView) => boolean,
): OptionsFunctionView | undefined {
  return functions.find(fn => fn.name === name && (match ? match(fn) : true))
}
