# FlowStream re2 — Master TODO

Sectional coordination scaffold for the rewrite.

**Authority split**

| Layer | Owns |
| --- | --- |
| **Root `TODO.md` (this file)** | Global engineering discipline, repo-wide delivery order, hardening loop, doc inventory |
| **Local `docs/TODO.md`** | **Authoritative for package-specific sequencing** — what to build next in that folder, slice checklists, blocked-until gates |

When root and a local TODO disagree on *order inside a package*, follow the **local** file. When unsure about cross-package order or global rules, follow **root**.

Each local `docs/TODO.md` should sit beside `architecture.md` in the same `docs/` folder (or say **architecture pending**). Run a **doc inventory pass** when folders are added or go untracked: every `docs/TODO.md` must have a sibling `architecture.md`, or explicitly state architecture is pending.

**Architecture sources of truth**

| Area | Doc |
| --- | --- |
| Observe | [packages-re2/observe/docs/architecture.md](packages-re2/observe/docs/architecture.md) |
| Contracts | [packages-re2/contracts/docs/architecture.md](packages-re2/contracts/docs/architecture.md) |
| Host | [host/docs/architecture.md](host/docs/architecture.md) |
| Options | [packages-re2/options/docs/architecture.md](packages-re2/options/docs/architecture.md) |
| Bookmaker | [packages-re2/bookmaker/docs/architecture.md](packages-re2/bookmaker/docs/architecture.md) |
| Steward | [packages-re2/steward/docs/architecture.md](packages-re2/steward/docs/architecture.md) |

**Delivery order (high level)**

```text
contracts architecture locked
bookmaker + steward architecture locked
contracts implementation
bookmaker / steward / options implementation
host implementation
cli/gateway
observe integration edges (market registration, host output transport)
```

---

## Global engineering TODO

- [ ] Copy the observe discipline into every package: Effect blueprints only in libraries, no `Effect.run*` outside tests / CLI / host / app edges.
- [ ] Add package-local aliases like observe uses: `#model/*`, `#runtime/*`, `#bridge/*`, `#test/*`, and root `#index.js` tests where public API is being verified.
- [ ] Copy observe lint guards: no empty files, no forbidden upward imports, no hidden Node APIs in browser-safe packages, no broad root barrels leaking internals.
- [ ] Standardize package shape: `src/index.ts` re-exports only; implementation files export public items at top, helpers at bottom.
- [ ] Add public export tests for every package once APIs exist.
- [ ] Add architecture guards per package: forbidden imports, stale terms, no `Effect.run*`, no empty files.
- [ ] **Doc inventory pass:** every `docs/TODO.md` has sibling `architecture.md` or says "architecture pending."
- [ ] Effect browser answer: Effect core is suitable for browser-safe packages when side effects are injected. Official docs describe Effect as TypeScript for sync/async programs; `@effect/platform` is platform-independent across Node, Deno, Bun, and browsers. Keep browser-safe packages free of Node-only services unless provided by target-specific layers.
  - [Effect intro](https://effect.website/docs/getting-started/introduction/)
  - [Effect Platform](https://effect.website/docs/platform/introduction/)

---

## Local TODO index

| Package / area | Local TODO |
| --- | --- |
| Observe | [packages-re2/observe/docs/TODO.md](packages-re2/observe/docs/TODO.md) |
| Contracts | [packages-re2/contracts/docs/TODO.md](packages-re2/contracts/docs/TODO.md) |
| Host | [host/docs/TODO.md](host/docs/TODO.md) |
| Options | [packages-re2/options/docs/TODO.md](packages-re2/options/docs/TODO.md) |
| Bookmaker | [packages-re2/bookmaker/docs/TODO.md](packages-re2/bookmaker/docs/TODO.md) |
| Steward | [packages-re2/steward/docs/TODO.md](packages-re2/steward/docs/TODO.md) |
| Schema | [packages-re2/schema/docs/TODO.md](packages-re2/schema/docs/TODO.md) *(architecture pending)* |
| CLI / Gateway | [cli-re2/docs/TODO.md](cli-re2/docs/TODO.md) *(architecture pending)* |

---

## Hardening loop (every slice)

**Local `docs/TODO.md` files link here.** Run after touching any package:

- [ ] `npm run check` / `npm run build` / `npm run test` for touched package
- [ ] Stale-term scans
- [ ] No `Effect.run*` in `src/`
- [ ] Empty-file scan
- [ ] Forbidden-import scan
- [ ] At least one negative-path test for every new public API
- [ ] Revisit **local** `docs/TODO.md` — it is authoritative for that package's next steps
