# @flowstream-re2/observe — TODO

See [architecture.md](./architecture.md) for runtime model and phased delivery. See [repo TODO](../../../../TODO.md) for global engineering rules.

**Mode:** keep stable; integration edges first, new big internals later.

---

## Stability

- [ ] Do not start new big internals before dependent package boundaries are written and contracts/bookmaker/steward surfaces are clearer.
- [ ] Final observe audit only after CLI / host / contracts integration points are clearer.

---

## Integration edges (priority)

- [ ] **Market registration edge plan:** observe exposes `observeRunId`, manifest URI, watch/WebRTC refs, subject metadata; CLI / gateway / contracts perform the actual `registerMarket` write (bookmaker does not create markets).
- [ ] Document bridge/read-model fields bookmaker and host need from a live run (manifest, evidence refs, subjectRef).
- [ ] **Host output transport plan:** forwarder / simulcast / local output should use host descriptor and endpoint manifest, not ad hoc URLs.

---

## Future pipeline slices (after integration)

- [ ] IPTV capture under `pipeline/capture/iptv/`
- [ ] Football process pack under `pipeline/process/football/`
- [ ] Simulcast / host sink under `pipeline/publish/sinks/simulcast/`

---

## Engineering (when touching observe)

- [ ] Keep `#index.js` public-edge contract tests green
- [ ] Keep architecture guards: Effect purity, forbidden imports, no empty files
- [ ] Match `AGENTS.md` file shape and dependency order

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../../TODO.md#hardening-loop-every-slice).

- [ ] check / build / test for `packages-re2/observe`
- [ ] Stale-term + forbidden-import + empty-file + no `Effect.run*` in `src/`
- [ ] Negative-path test for every new public API
- [ ] Update this `docs/TODO.md`
