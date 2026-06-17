# Host — TODO

See [architecture.md](./architecture.md). Types: planned `packages-re2/host`. Server: top-level `host/`. See [repo TODO](../../TODO.md).

---

## Type package (`packages-re2/host`)

- [ ] Scaffold protocol/type-only package per architecture file list
- [ ] Descriptor, policy, session, manifest, cache, account, AA, forum types
- [ ] No server, fetch client, or `Effect.run*` in type package

---

## Dev server (`host/`)

### Slice 1 — skeleton

- [ ] `src/server/http.ts`, `routes.ts` — localhost bind, JSON errors
- [ ] `GET /health`, `GET /descriptor`

### Slice 2 — sessions + manifests + policy

- [ ] `POST /policy/evaluate`
- [ ] `POST /sessions`, `GET /sessions/:sessionId/manifest`
- [ ] `POST /sessions/:sessionId/cache-receipts`
- [ ] In-memory stores only; open endpoints

### Slice 3 — bookmaker similarity

- [ ] `findSimilar({ marketId, vaultDraft })` route + types
- [ ] Index markets and vaults under `marketId` for vault-scoped similarity (no global merge)

### Slice 4 — forum + AA stub

- [ ] Forum thread/message CRUD routes
- [ ] `GET /aa/descriptor`
- [ ] `POST /aa/bundler/:chain` — proxy to Alto (quarry: xylkstream bundler route)
- [ ] `POST /aa/paymaster` — dev/open first

### Later (documented aspiration)

- [ ] API keys, multi-tenant accounts, quota enforcement
- [ ] Durable cache storage, audit logs, endpoint signing
- [ ] WebRTC/SFU/TURN provider binding
- [ ] Production AA relayer / session-key service
- [ ] Abuse controls

---

## Engineering

- [ ] v0 open/dev-only; auth and tenancy documented but not blocking slice 1
- [ ] Side effects at server edge only
- [ ] Local `docs/TODO.md` updates after each slice

---

## Hardening (every slice)

Run after touching host. Full checklist: [repo TODO § Hardening loop](../../TODO.md#hardening-loop-every-slice).

- [ ] check / build / test for touched `host/` or `packages-re2/host` code
- [ ] Route handler negative-path tests for new endpoints
- [ ] Update this `docs/TODO.md`
