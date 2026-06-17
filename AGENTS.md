# @flowstream-re2/observe

Video observe pipeline: capture → process → publish, with run lifecycle, scope checks, and bridge panel projection.

## Layout

```
src/
  index.ts                 re-exports only
  builtins.ts              registry wiring
  pipeline/
    capture/               frames in (file/, browser/, iptv/)
    process/               content transforms (football/ + cv/)
    publish/               frames out (file/, local/, simulcast/)
  run/                     ObserveRun lifecycle + RunStore
  bridge/                  local callable API + panel projection
  scope/                   authorization grants + scope evaluation
```

## Dependency order (bottom → top)

1. `pipeline/capture`
2. `pipeline/publish`
3. `pipeline/process`
4. `builtins`
5. `run`
6. `scope`
7. `bridge`

Each layer may import from layers below, not above.

## Purity rule (Effect)

**Pure** = does not execute side effects when called.

| Kind | Pattern | Use for |
| --- | --- | --- |
| Vanilla pure | plain TS functions | `validate*`, descriptors, `hasScope`, `evaluateCommand`, `projectRunControls`, protocol encode/decode |
| Effect blueprint | returns `Effect`, never runs it | `create*`, `makeObserveRun`, lifecycle (`prepare`, `start`, …) |
| Execution | `Effect.runPromise`, `NodeRuntime.runMain` | **edge only** — `cli-re2`, tests, `host/` |

Functions that return `Effect` are still pure. Side effects run only at the application edge.

### Do

- Keep synchronous deterministic logic as vanilla TS
- Wrap sync side effects in `Effect.sync`
- Wrap async I/O in `Effect.tryPromise`
- Inject environment via `Context.Tag` at boundaries (`Ffmpeg`, `PythonWorker`, `BrowserCapture`, `HostClient`)
- Keep `scope/` and `bridge/panel/` vanilla — no Effect unless strictly necessary

### Do not

- Call `Effect.run*` inside library code
- Wrap trivial pure math/parsing in Effect
- Put I/O in `scope/` or `bridge/panel/`

## File shape

Every implementation file:

```ts
// --- exports ---

export const validateFileCapture = ...
export const createFileCapture = ...

// --- helpers ---

const parseSampleFps = ...
```

- Top: public API (vanilla pure + Effect blueprints)
- Bottom: private helpers
- Section dividers only — no inline comments
- `index.ts`: re-exports only, no logic

## Pipeline stages

| Stage | Role |
| --- | --- |
| `capture` | acquire frames (file, browser, iptv) |
| `process` | content-specific transform + render (football, python cv) |
| `publish` | output (file, local preview, simulcast) |

No top-level `visual/`. Rendering lives inside content packs (`process/football/render.ts`).

## Run

- `run/run.ts` — `makeObserveRun`
- `run/kernel.ts` — state machine (prepare / start / pause / resume / stop / health)
- `run/store.ts` — active runs registry

Not `session` — that name is reserved for bridge auth.

## Scope vs bridge panel

| Folder | Owns |
| --- | --- |
| `scope/` | authorization — grants, scopes, command allow/deny |
| `bridge/panel/` | projection — what bridge/UI renders (enabled actions, state cards, reasons) |

Authentication lives in `cli-re2/bridge/`, not here.

## Python

Football CV lives in `pipeline/process/football/cv/`. Copied from original `packages/sdk-stats`. Use `requirements.txt` + venv at package root.

## Tests

- Vanilla exports: direct call, plain asserts
- Effect blueprints: `Effect.runPromise` with fakes via `Effect.provide`

## Build slices

1. `capture/file` + `publish/file` + `run`
2. `process/football` + python cv
3. `builtins` + registry commands
4. `scope` + `bridge/panel`
5. `capture/browser` + `publish/simulcast`
