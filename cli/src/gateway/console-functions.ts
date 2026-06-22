// Project a package's FunctionDescriptor[] into the Remote Bridge Console catalog.
//
// Two steps: (1) NORMALIZE each write function's package-internal scope (e.g. options'
// `options:vault:fund`) to the uniform console scope `bridge:action:<name>` so console authz is
// package-agnostic; (2) FILTER to the functions the session's scopes authorize, using the canonical
// depth-guarded matcher. The host re-filters server-side too (defense in depth), but normalizing +
// filtering here keeps the wire payload minimal and the console honest.

import {
  bridgeActionScope,
  scopeMatchesGrant,
  type CapabilityScope,
  type FunctionDescriptor
} from "@livestreak/schema";

export const consoleScopeForFunction = (fn: FunctionDescriptor): CapabilityScope =>
  `${bridgeActionScope}:${fn.name}` as CapabilityScope;

export const projectConsoleFunctions = (
  raw: readonly FunctionDescriptor[],
  sessionScopes: readonly CapabilityScope[]
): readonly FunctionDescriptor[] =>
  raw
    .map((fn) => ({ ...fn, scope: consoleScopeForFunction(fn) }))
    .filter((fn) => sessionScopes.some((granted) => scopeMatchesGrant(granted, fn.scope)));
