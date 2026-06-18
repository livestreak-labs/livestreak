# @livestreak/wallet — TODO

See [architecture.md](./architecture.md) and [flow.md](./flow.md).

## Done (verified 2026-06-18)

- [x] Multichain unification: EVM ERC-4337 + Sui quarried into one package over the shared
      `@tetherto/wdk-wallet` base (both pin `1.0.0-beta.7`).
- [x] Rack layout: vendored JS under `src/vendor/<chain>/` (untouched), TS facade in `src/` + `src/chains/`.
- [x] Unified export: `createWalletManager(chain, seed, config)` default; per-chain classes named; `ConfigurationError` on unknown chain.
- [x] Golden vectors (offline, deterministic): EVM (owner EOA, Safe address, signature) + Sui (address, Ed25519 signature) — `node:test`, **8/8 green** including the export-surface + negative-path test.
- [x] `IWalletAccount` type-satisfaction proof for both chains (`test/types/iwallet-account.ts`, checked by `npm run check`).
- [x] `check` / `build` / `lint` / `test` all green. Package importable; sodium deduped to `sodium-universal`.
- [x] Test runner fixed: was `vitest` (looking for `*.test.ts`) silently running nothing; now `node --test` runs the `.mjs` vectors with zero transform.

## Blocked / cross-package (inbox)

- [ ] **App migration (consumer break, by design):** `app/src/hooks/useStealthWallet.ts:71` imports
      the package **default** as a constructor (`const { default: WalletManagerEvmErc4337 } = await import(...)`).
      The default is now `createWalletManager`. Switch to `createWalletManager('evm', seed, cfg)` or the
      named `WalletManagerEvmErc4337`. Caught by `tsc`/lint. (App is interim; options SDK is the intended owner.)
- [ ] **Schema Sui config:** `@livestreak/schema` `WalletInitConfig` mirrors the EVM wdkConfig only.
      A `SuiWalletInitConfig` is needed so the app can map schema → Sui config at the edge — file to schema.
- [ ] **Browser-bundle pre-check:** confirm `@livestreak/wallet` (bare-runtime + sodium-universal) bundles
      in the `app/` build; `app/vite.config.ts` currently aliases `sodium-javascript`. If it won't bundle,
      that's an app/vite slice, not a wallet change.

## Maintenance loop

The golden vectors are the **oracle**. Any re-vendor of the WDK glue (diff against npm upstream) must
keep EVM + Sui vectors byte-identical, or the crypto changed. The vendored `src/vendor/**` is the diff
target — never hand-edit it; drop in the new upstream `.js` and re-run the vectors.
