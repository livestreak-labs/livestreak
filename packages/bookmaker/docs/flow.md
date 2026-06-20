# Bookmaker flow — detect → draft → discovery → decide → execute

End-to-end vault origination inside `@livestreak/bookmaker`. Bookmaker holds the multichain wallet via `chains/` and executes `VaultDriver.createVault` in-package.

## Ideal path

```text
observation events
  → detectOpportunity (detection/)
  → buildVaultDraft (draft/) — derives seedRate = creatorStake / windowSeconds
  → findSimilar via POST /discovery/find (similarity/)
  → chooseVaultAction (decision/) — exact vaultKey join + fuzzy policy
  → originateVault (flows/) — idempotency store → chains.writer.createVault(intent)
  → VaultCreated event → vaultId
  → runtime.publishSnapshot + bridge panel projection
```

## Caller injects (never baked)

| Input | Used by |
| --- | --- |
| `walletInit` + `seed` | `createBookmakerChain` → `createWalletManager` |
| `addresses` (`vaultDriver`, `marketRegistry`, `vault`, `usdc`) | EVM reader/writer |
| `readRpcUrl` (optional) | EVM `marketExists` reads |
| `similarityClient` or `createHostDiscoveryClient(baseUrl)` | `findSimilar` |
| `idempotencyStore` (optional; runtime owns default) | `originateVault` at-most-once guard |
| `fundingToken`, `policy`, `marketContext`, `watchSource` | runtime + draft |
| `nowMs` | all pure stages (no `Date.now()` in `src/`) |

## Stage edge map

| Stage | Edge | Handled? |
| --- | --- | --- |
| Detection | No detectors / below confidence | Yes — `action: "skip"` |
| Detection | Malformed detector output | Yes — ignored / normalized |
| Draft | `windowSeconds <= 0` | Yes — no `seedRate`; `validateVaultDraftForCreate` fails |
| Draft | Missing stake | Yes — validation fails before execute |
| Similarity | Host 4xx/5xx | Partial — `createHostDiscoveryClient` throws `LiveStreakRuntimeError` |
| Similarity | Empty candidates | Yes — decision policy chooses create/join/skip |
| Similarity | Exact `vaultKey` match on candidate | Yes — `chooseVaultAction` joins |
| Similarity | `duplicateRisk: high` + `skip-on-high` | Yes — skip |
| Decision | Cross-market similarity result | Yes — skip `market_mismatch` |
| Decision | Steward warnings | Yes — skip |
| Execute | Retry / replay / concurrent duplicate create | Yes — `runtime/idempotency` store (same vault-defining key) |
| Execute | Unknown `marketId` on-chain | **UNHANDLED** — reverts at `VaultDriver.createVault` |
| Execute | Insufficient USDC balance | **UNHANDLED** — ERC20 transfer reverts |
| Execute | Insufficient allowance | Partial — writer auto-approves up to deposit |
| Execute | UserOp send / paymaster failure | Partial — classified `LiveStreakRuntimeError`; key released |
| Execute | UserOp included but receipt poll times out | **Residual risk** — reported as failure, key released; retry may double-create unless receipt is re-checked for the recorded userOp hash before re-sending |
| Execute | Receipt missing `VaultCreated` | Yes — `LiveStreakRuntimeError` |
| Execute | Sui chain | Yes — stub throws `LiveStreakConfigError` |
| Bridge | Missing scope | Yes — `LiveStreakCapabilityError` |
| Bridge | Trusted caller | Yes — short-circuit v0 |
| Runtime | Not deployed / wrong addresses | **UNHANDLED** — fails at RPC or revert |

## Idempotency layers

1. **Within-runtime (deterministic):** `idempotencyKeyFromDraft` hashes `marketId`, normalized `question`, `resolutionSource`, `resolutionWindow.expiresAtMs`, `creatorSide`. Bond size / rate excluded. `createIdempotencyStore().run(key, exec)` guarantees at-most-one chain call per key per store instance; concurrent callers share one in-flight promise.
2. **Cross-runtime (best-effort):** host similarity candidates may carry `vaultKey`; exact match → `joinVault` before fuzzy scoring.

## Multichain layout

```text
chains/     inward door — wallet + vaultDriver writes
flows/      orchestration — originateVault
runtime/    floating-gate state + idempotency store + subscriptions
bridge/     outward door — panel + scoped callAction
```

## Contract truth

`VaultDriver.createVault(marketId, question, seedSide, rate, deposit)` via `vaultDriverAbi` from `@livestreak/contracts`. `vaultId` is read from the `VaultCreated` event — never precomputed.

## Errors

All thrown errors in `src/` use `@livestreak/core` types (`LiveStreakConfigError`, `LiveStreakRuntimeError`, `LiveStreakCapabilityError`). No raw `Error` in library code.
