# FlowStream Host Architecture

This document is for the developer who arrives with no conversation history and needs to move. It explains the architecture we want, why the folders exist, what should not be built, and how a running host process serves CLI, observe output workflows, steward forum storage, and account-abstraction execution support.

The short version: **`packages-re2/host` is shared language** — protocol types, request/response shapes, descriptors, and tiny constants. **`host/` is the server implementation** — HTTP routes, in-memory or durable stores, bundler/paymaster proxying, and provider integrations. Real functions live only in top-level `host/`. Every other package depends on stable host shapes from `packages-re2/host`.

Top-level `host/` is a server-side provider for FlowStream at the same level as `app/` and `cli-re2/`. It is not an npm package implementation target.

## Vocabulary

Use these terms in code and docs:

| Correct term | Meaning |
| --- | --- |
| `HostProvider` | A running host server instance identified by `hostId` and `baseUrl`. |
| Host descriptor | Public identity document: version, capabilities, supported outputs, terms. Served at `GET /descriptor`. |
| Host policy | Output/cache/quota rules evaluated before a session is created. Request/result types live in `packages-re2/host`; evaluation logic lives in `host/`. |
| Host session | A hosted output context created after policy passes. Carries `sessionId`, observer/content linkage, and manifest generation inputs. |
| Endpoint manifest | Signed bundle of watch/WebRTC/state/telemetry/archive/control endpoints for one session. Types in `packages-re2/host`; generation and storage in `host/manifests/`. |
| Cache receipt | Evidence reference submitted after hosted cache work. Types in `packages-re2/host`; acceptance and storage in `host/cache/`. |
| Account descriptor | Tenant/account/api-key metadata shape. Types only in the package; enforcement in `host/tenants/` (later). |
| AA descriptor | Account-abstraction capability document: EntryPoint, Safe modules, bundler endpoint, paymaster endpoint, sponsorship flags. Types in `packages-re2/host`; routes in `host/aa/`. |
| Bundler endpoint | Host-owned JSON-RPC proxy for UserOperation calls, for example `POST /aa/bundler/:chain`. In dev it forwards to local Alto. Types live in `packages-re2/host`; proxy logic lives in `host/aa/`. |
| Paymaster endpoint | Host-owned sponsorship/signing surface for AA flows. v0 may be open/dev-only; production adds tenant/auth/quota. |
| Forum thread | Steward discussion record stored by the host. Types in `packages-re2/host`; CRUD in `host/forum/`. |
| WebRTC forwarding | Server-side route/shape for simulcast/live handoff. Route stub in `host/webrtc/` first; real SFU/TURN provider later. |

Do not use these as host architecture terms:

| Wrong term | Replacement |
| --- | --- |
| Host Bridge | HTTP routes — host is an HTTP/provider server, not an observe-style Bridge |
| Host scope / capability grant | API key or session auth (later) — not observe `CapabilityScope` |
| Host client in `packages-re2/host` | Client implementations belong at the edge (`cli-re2`, `app`) or a future thin client package, not the type package |
| CLI-owned bundler | Host AA bundler endpoint; CLI/app consume the host descriptor and send UserOps there |
| `session` (observe run) | Observe `ObserveRun` — host `session` is a hosted-output session, a different domain |

## Package Split

```text
packages-re2/host = shared language
host/              = server implementation
```

That is the boundary. Keep it clean.

| Location | Owns | Does not own |
| --- | --- | --- |
| `packages-re2/host` | Types, descriptors, request/result shapes, pure validators/decoders, tiny enums/constants | Server, fetch client, auth implementation, storage, WebRTC implementation, bundler process |
| `host/` | HTTP server, route handlers, stores, bundler/paymaster proxying, provider wiring, dev defaults | Observe pipeline, observe Bridge/scope, CLI preference storage, wallet derivation/signing, domain logic for options/bookmaker/steward agents |

Observe produces media and observations. Host distributes and persists them when output mode requires a server. CLI/gateway authenticates with the host (later), stores user preferences locally, and passes selected host details into package workflows as normal config.

### `host/` owns

- HTTP dev server (first slice) and future production host provider
- Endpoint manifest generation and session storage
- Cache receipt intake
- Host policy evaluation for hosted outputs
- Steward forum/thread storage API
- WebRTC forwarding routes (stub first, provider later)
- AA capability descriptor
- AA bundler JSON-RPC proxy to Alto or another bundler provider
- Paymaster sponsorship/signing endpoint (open/dev first, tenant/auth later)

### `host/` does not own

- Video pipeline (see `packages-re2/observe/`)
- Package protocol type ownership (see `packages-re2/host/`)
- CLI/user preference storage
- Observe, options, bookmaker, or steward agent domain logic
- Gateway/CLI authentication UX
- WDK wallet derivation and client-side signing
- Authorization scopes (observe `scope/`)
- Observe Bridge or capability grants

## Reference Shape — `packages-re2/host`

Protocol/type-only package. No meaningful behavior.

```text
packages-re2/host/src/
  index.ts          re-exports only
  descriptor.ts     host identity, version, supported features
  policy.ts         output/cache/quota policy request + response types
  session.ts        create session request/result
  manifest.ts       endpoint manifest + signed manifest shapes
  cache.ts          cache receipt/evidence reference types
  account.ts        account/tenant/api-key descriptor types
  aa.ts             account abstraction descriptor, bundler, paymaster request/result types
  forum.ts          steward forum/thread/message record types
```

Rules for the type package:

- `index.ts` re-exports only — no logic.
- Vanilla pure TypeScript or Effect `Schema` at the boundary — no `Effect.run*` in library code.
- No server imports, no `fetch`, no filesystem, no database drivers.
- Tiny constants and enums are fine (`HostCapability`, receipt status literals, endpoint kinds).
- Validation helpers (`validateCreateSessionRequest`, `decodeCacheReceipt`) are pure and belong here.
- HTTP path strings and status-code mapping do **not** belong here — those are server concerns in `host/`.

### Public API (`packages-re2/host/src/index.ts`)

External callers (CLI, app, tests, `host/` server) should import host shapes from the package root.

**Root exports should include:**

- **Descriptor** — `HostProviderDescriptor`, `HostCapability`, supported output modes.
- **Policy** — `HostPolicyRequest`, `HostPolicyResult`, `HostPolicyDescriptor`, evaluation status, block reason unions.
- **Session** — `HostCreateSessionRequest`, `HostSessionResult`, session draft/summary types.
- **Manifest** — `EndpointManifest`, `EndpointDescriptor`, `EndpointKind`, signed manifest envelope types.
- **Cache** — `HostCacheReceipt`, submission request/result, receipt status literals.
- **Account** — tenant/account/api-key descriptor types (no enforcement).
- **AA** — capability descriptor, supported operation kinds, bundler proxy request/result envelopes, paymaster sponsorship request/result envelopes.
- **Forum** — thread, message, and list/summary record types.

**Not in the type package:**

- HTTP server, route tables, middleware.
- `HostProviderClient`, `createHttpHostProviderClient`, or any fetch-based client.
- In-memory stores, databases, object storage.
- WebRTC/SFU/TURN provider bindings.
- Bundler process management, Alto provider wiring, paymaster private key handling.
- API-key verification, quota enforcement, audit log writers.
- Observe Bridge, scope grants, or panel projection.

When porting from `-re`, lift shapes from `packages-re/schema/src/host.ts`, `manifest.ts`, and related steward evidence references into the files above. Drop client and provider implementation from the package.

## Reference Shape — `host/`

Runnable dev server and future production host provider.

```text
host/
  src/
    server/
      http.ts         listen/bind, request dispatch, error JSON
      routes.ts       route table registration
    descriptor/
      routes.ts       GET /descriptor, GET /health
    sessions/
      store.ts        in-memory session registry (first slice)
      routes.ts       POST /sessions, GET /sessions/:sessionId/manifest
    manifests/
      store.ts        manifest generation + lookup
      routes.ts       manifest sub-routes if split from sessions
    cache/
      store.ts        receipt acceptance + lookup
      routes.ts       POST /sessions/:sessionId/cache-receipts
    webrtc/
      routes.ts       forwarding endpoint shape (stub first)
      forwarding.ts   provider adapter seam (stub first)
    forum/
      store.ts        thread/message in-memory store
      routes.ts       forum CRUD routes
    aa/
      routes.ts       GET /aa/descriptor
      bundler.ts      POST /aa/bundler/:chain JSON-RPC proxy to Alto/provider
      paymaster.ts    POST /aa/paymaster sponsorship/signing endpoint
      config.ts       chain -> bundler/paymaster provider config
    tenants/
      store.ts        placeholder for multi-tenant state (later)
  docs/
    architecture.md   this file
```

Composition rule inside `host/`:

```text
server/ composes feature routes and shared error handling.
feature folders own their stores/routes and do not import server internals.
```

Implementation order:

1. `descriptor/`, `aa/` — descriptor + dev bundler/paymaster proxy
2. `sessions/`, `manifests/`, `cache/` — core hosted-output flow
3. `forum/` — steward storage API
4. `webrtc/` — forwarding shape, then provider binding
5. `server/` — HTTP shell that wires the feature routes together

Each feature folder owns its store and routes. Cross-cutting auth, quota, and audit attach at `server/` middleware in later slices — not inside `packages-re2/host`.

## Top-Level Model

```text
CLI / APP / OBSERVE OUTPUT WORKFLOW
  reads HostProviderDescriptor
  POST /policy/evaluate (optional pre-check)
  POST /sessions
  GET  /sessions/:sessionId/manifest
  POST /sessions/:sessionId/cache-receipts
  uses manifest endpoints for watch / webrtc / telemetry (later)
  POST /forum/threads ... steward UI (later)

HOST HTTP SERVER (host/)
  descriptor/     public host identity
  sessions/       session lifecycle + manifest attachment
  manifests/      endpoint bundle generation
  cache/          receipt intake
  forum/          durable discussion records (in-memory first)
  aa/             capability advertisement + bundler/paymaster proxy
  webrtc/         forwarding route shape (stub first)
  tenants/        account boundary (later)

TYPE PACKAGE (packages-re2/host)
  shared request/response + record shapes only
```

The host does **not** own observe run lifecycle, control bus, board, or capability grants. It is an HTTP/provider server. Later auth can be API-key or session based at the HTTP edge; that is not observe `scope/`.

## First Server Slice — Routes

Keep the first implementation brutally simple:

```text
GET  /health
GET  /descriptor
POST /policy/evaluate
POST /sessions
GET  /sessions/:sessionId/manifest
POST /sessions/:sessionId/cache-receipts
POST /forum/threads
GET  /forum/threads/:threadId
POST /forum/threads/:threadId/messages
GET  /aa/descriptor
POST /aa/bundler/:chain
POST /aa/paymaster
```

### Route behavior (slice 1)

| Route | First-slice behavior |
| --- | --- |
| `GET /health` | `{ ok: true }` plus optional `hostId`, version, uptime |
| `GET /descriptor` | Returns `HostProviderDescriptor` from server config |
| `POST /policy/evaluate` | In-memory rules: supported output mode, cache intent, rough quota checks; returns `HostPolicyResult` |
| `POST /sessions` | Creates session after policy pass; stores draft in memory; returns session summary |
| `GET /sessions/:sessionId/manifest` | Generates `EndpointManifest` with dev placeholder endpoint URLs |
| `POST /sessions/:sessionId/cache-receipts` | Accepts receipt submission; stores in memory; returns status |
| `POST /forum/threads` | Creates thread record; returns thread id |
| `GET /forum/threads/:threadId` | Returns thread + messages |
| `POST /forum/threads/:threadId/messages` | Appends message; returns message record |
| `GET /aa/descriptor` | Capability document: EntryPoint, Safe module addresses, bundler URL, paymaster URL, sponsorship flags |
| `POST /aa/bundler/:chain` | JSON-RPC proxy to configured bundler provider (dev quarry: Xylkstream Alto proxy) |
| `POST /aa/paymaster` | Paymaster sponsorship/signing endpoint; v0 may be open/dev-only but must be isolated under `host/aa/` |

WebRTC forwarding: expose route shape and response types in slice 1; bind to a real provider in a later slice.

## What The First Implementation Should Do

- **In-memory stores only** — sessions, manifests, cache receipts, forum threads/messages.
- **Open endpoints** — no serious auth in slice 1.
- **Bind to localhost by default** — e.g. `127.0.0.1:8787`; document env override.
- **Generate endpoint manifests** — dev URLs are fine; signature can be a deterministic dev stub until real signing lands.
- **Accept cache receipt submissions** — validate shape via `packages-re2/host`; persist in memory.
- **Create forum threads and messages** — validate shape; persist in memory.
- **Expose AA capability descriptor** — advertise EntryPoint/Safe/paymaster/bundler details.
- **Proxy AA bundler requests** — forward UserOperation JSON-RPC to the configured chain bundler.
- **Expose paymaster route** — dev sponsorship/signing route first; production auth/quota later.
- **WebRTC forwarding** — return typed placeholder responses from `host/webrtc/routes.ts`; implement `forwarding.ts` against a real SFU/TURN provider later.

Error responses should use the same JSON error shape as other FlowStream edges (`@flowstream-re2/core` serialization where applicable). Do not invent a parallel error format per route.

## Future Host Production Responsibilities

Document and plan for these explicitly. They are **not** slice 1:

```text
Future host production responsibilities:
  api keys
  multi-tenant accounts
  quota enforcement
  cache storage
  audit logs
  endpoint signing
  WebRTC/SFU/TURN provider integration
  AA bundler/paymaster production hardening
  abuse controls
```

| Concern | Target home |
| --- | --- |
| API keys | `host/tenants/` + `server/` auth middleware |
| Multi-tenant accounts | `host/tenants/store.ts` + `packages-re2/host/account.ts` |
| Quota enforcement | policy evaluation + tenant store; not in the type package |
| Cache storage | `host/cache/store.ts` backed by object storage |
| Audit logs | `host/server/` middleware + durable log sink |
| Endpoint signing | `host/manifests/store.ts` with real key material |
| WebRTC/SFU/TURN | `host/webrtc/forwarding.ts` provider adapter |
| AA bundler proxy | `host/aa/bundler.ts` forwarding to Alto/provider |
| AA paymaster | `host/aa/paymaster.ts` sponsorship/signing; private key in host env |
| Abuse controls | rate limits, receipt spam checks, forum moderation hooks |

## Boundary With Observe

Host and observe solve different problems:

| Concern | Owner |
| --- | --- |
| Video capture, process, publish | `packages-re2/observe` |
| Run lifecycle, control bus, board | `packages-re2/observe` |
| Capability grants, bridge panel | `packages-re2/observe` (`scope/`, `bridge/`) |
| Hosted output distribution, manifests, cache receipts | `host/` |
| Steward forum persistence API | `host/` |
| Shared host protocol types | `packages-re2/host` |

Host does **not** need observe-style `Bridge` or `scope`. It is an HTTP/provider server. CLI may call both observe Bridge (local) and host HTTP (remote) in one workflow; they must not share authorization models.

Simulcast or forwarder output modes in observe hand off to host manifest endpoints — observe does not implement CDN edge delivery or hosted cache storage.

## Policy And Session Flow

Expected first-slice flow:

```text
1. Client loads GET /descriptor (optional) to discover capabilities.
2. Client POST /policy/evaluate with output mode, cache intent, duration hints.
3. Server returns HostPolicyResult with pass/warning/blocked status.
4. Client POST /sessions with sessionId, observer, contentId, policy context.
5. Server validates request shapes from packages-re2/host.
6. Server re-evaluates or trusts prior policy (document choice in implementation).
7. Server stores session draft in memory.
8. Client GET /sessions/:sessionId/manifest.
9. Server generates EndpointManifest with endpoint descriptors.
10. Client uses manifest URLs for watch/webrtc/state (provider binding later).
11. After cache work, client POST /sessions/:sessionId/cache-receipts.
12. Server stores receipt and returns acceptance status.
```

Policy evaluation in slice 1 can be synchronous and in-process. No external policy engine required.

## Manifest Shape

Manifest types live in `packages-re2/host`. Generation lives in `host/manifests/`.

```jsonc
{
  "version": "0.1.0",
  "manifestId": "man_01...",
  "sessionId": "ses_01...",
  "observer": "obs_01...",
  "contentId": "cnt_01...",
  "hostId": "host_dev",
  "endpoints": [
    { "kind": "watch", "url": "http://127.0.0.1:8787/dev/watch/...", "expiresAtMs": null },
    { "kind": "webrtc", "url": "http://127.0.0.1:8787/dev/webrtc/...", "expiresAtMs": null }
  ],
  "hostPolicyStatus": "pass",
  "cacheReceiptRefs": [],
  "issuedAtMs": 1730000000000,
  "expiresAtMs": 1730003600000,
  "signature": "dev-stub-signature"
}
```

Endpoint kinds: `watch`, `webrtc`, `state`, `telemetry`, `archive`, `control`. Slice 1 may emit placeholder URLs; kinds and shapes must match the type package.

## Forum Shape

Forum record types live in `packages-re2/host`. Storage and routes live in `host/forum/`.

Slice 1 forum is a simple thread/message store:

- `POST /forum/threads` — create thread with title, steward/observe references as typed fields.
- `GET /forum/threads/:threadId` — thread metadata + messages.
- `POST /forum/threads/:threadId/messages` — append message body + author reference.

No moderation, search, or pagination in slice 1 unless trivially added to the store interface.

## What Good Code Looks Like

Good code keeps ownership obvious:

- `packages-re2/host/*.ts` — pure types and validators only.
- `host/src/server/http.ts` — listen, dispatch, shared error envelope.
- `host/src/server/routes.ts` — registers feature routers; no business logic.
- `host/src/sessions/store.ts` — session draft lifecycle; no HTTP types leaking into the package.
- `host/src/manifests/store.ts` — manifest generation from session state.
- `host/src/cache/store.ts` — receipt intake and lookup.
- `host/src/forum/store.ts` — thread/message persistence interface (memory first).

Good code follows these rules:

- Types cross package boundaries only through `packages-re2/host`.
- Route handlers are thin: decode body → call store → encode response.
- Stores are swappable behind small interfaces for later Postgres/S3 replacements.
- Side effects run at the server edge only.
- Dev defaults are explicit (`hostId`, `baseUrl`, bind address).
- Tests hit stores and route handlers with injected memory implementations.

## What Should Not Be Built

Do not put server code in `packages-re2/host`.

Do not put observe Bridge, scope, or panel projection in `host/`.

Do not put a fetch client in `packages-re2/host` — clients live at CLI/app edge or a dedicated client module outside the type package.

Do not block slice 1 on WebRTC SFU or multi-tenant auth. For AA, ship the dev route shape and proxy boundary early; production sponsorship policy can harden later.

Do not copy `packages-re/sdk-stats/src/host/provider.ts` wholesale into `host/` — port shapes into `packages-re2/host`, reimplement server routes cleanly.

Do not use observe `session` naming for host run handles — host `sessionId` is hosted-output context only.

Do not add global singleton stores hidden inside route files — inject stores from `server/http.ts` bootstrap.

## First Build Slice

Recommended delivery order:

### Step A — type package only (do first if one step at a time)

```text
packages-re2/host/
  descriptor.ts, policy.ts, session.ts, manifest.ts,
  cache.ts, account.ts, aa.ts, forum.ts, index.ts
```

Acceptance: other packages can depend on stable shapes; vitest validates encode/decode round-trips.

### Step B — dev server skeleton

```text
host/src/server/http.ts
host/src/server/routes.ts
host/src/descriptor/routes.ts
```

Acceptance: `GET /health`, `GET /descriptor`, localhost bind, JSON errors.

### Step C — policy + sessions + manifests

```text
host/src/sessions/store.ts + routes.ts
host/src/manifests/store.ts
POST /policy/evaluate
POST /sessions
GET  /sessions/:sessionId/manifest
```

Acceptance: in-memory session → generated manifest with typed endpoints.

### Step D — cache + forum + AA edge

```text
host/src/cache/
host/src/forum/
host/src/aa/routes.ts
host/src/aa/bundler.ts
host/src/aa/paymaster.ts
```

Acceptance: receipt submission stored; forum CRUD works; AA descriptor returns typed doc; bundler route proxies JSON-RPC to configured provider; paymaster route has a clear dev implementation or typed "not configured" error.

### Step E — WebRTC route shape

```text
host/src/webrtc/routes.ts
host/src/webrtc/forwarding.ts (stub)
```

Acceptance: typed placeholder forwarding response; no real media yet.

The goal is **Host Type Package + Host Dev Server Skeleton** — not a production CDN.

## Phased Delivery

### Slice 1 — dev server (current target)

```text
packages-re2/host type package
in-memory stores
open endpoints
localhost bind
manifest generation (dev signatures)
cache receipt intake
forum CRUD
AA descriptor
AA bundler proxy route
AA paymaster route shape
webrtc route stub
```

### Slice 2 — auth and tenants

```text
API key middleware
tenant/account store
quota fields enforced in policy evaluation
structured audit log events
```

### Slice 3 — real providers

```text
object storage for cache
real endpoint signing
WebRTC/SFU/TURN provider adapter
CDN/watch URL generation
```

### Slice 4 — production AA and abuse

```text
bundler provider hardening
paymaster sponsorship policy
rate limits and receipt spam controls
forum moderation hooks
```

When a feature is documented above but not built in the current phase, keep the types in `packages-re2/host` so vocabulary stays stable. Gate behavior in the server with clear errors — do not silently ignore unsupported fields.

## Relationship To Existing Instructions

This file is the **source of truth for host architecture**: type package vs server split, folder layout, first HTTP slice, and boundaries with observe.

| Document | Role |
| --- | --- |
| `host/docs/architecture.md` (this file) | Host runtime model, ownership boundaries, phased delivery |
| `packages-re2/observe/docs/architecture.md` | Observe runtime — complementary, not a template for host internals |
| `AGENTS.md` (repo root) | Observe package style; host server runs Effects at the edge per purity rules |

### How the layers fit together

```text
packages-re2/host (types)
  -> cli-re2 / app (clients, config)
  -> host/ (HTTP server, stores, providers)
  -> observe output workflows (manifest endpoints, cache receipts)
  -> AA execution support (bundler/paymaster endpoints)
```

Observe Bridge stays local to observe. Host HTTP stays remote provider. Shared vocabulary crosses only through `packages-re2/host` and normal workflow config.

### Relationship to `-re`

`-re` (`packages-re/schema`, `packages-re/sdk-stats/src/host`) is a quarry, not a layout template.

Useful to port:

- `HostProviderDescriptor`, policy, cache receipt shapes from `packages-re/schema/src/host.ts`
- `EndpointManifest` from `packages-re/schema/src/manifest.ts`
- Policy evaluation **ideas** from `packages-re/sdk-stats/src/host/provider.ts`
- Bundler proxy route shape from `xylkstream/apps/server/src/interfaces/api/routes/bundler.ts`
- Paymaster signer/provider boundary from `xylkstream/apps/server/src/interfaces/api/routes/paymaster.ts` and `apps/contracts/src/aa/XylkPaymaster.sol`

Do not port:

- `HostProviderClient` / `createHttpHostProviderClient` into `packages-re2/host`
- Monolithic provider module as the server layout
- Observe session/kernel naming into host routes

When porting a shape, place it in the `packages-re2/host` file listed in this document and implement server behavior fresh under `host/src/`.
