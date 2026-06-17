# @flowstream-re2/steward — TODO

See [architecture.md](./architecture.md). See [repo TODO](../../../../TODO.md).

**Role:** accountability workflow — findings, decisions, action plans. TEE is input metadata, not infrastructure here.

---

## Slice A — model + validators (current base)

- [ ] Subject types: market, vault, observer, bookmaker, steward, evidence, resolution
- [ ] `Finding`, `Decision`, `ActionPlan` types
- [ ] Steward-of-stewards as role/ruleset in same package (no separate package)

---

## Slice B — rule evaluation (pure)

- [ ] `evaluateRules(subject, facts, ruleset) -> Finding[]`
- [ ] Facts from contracts reads + host annotations + observe evidence refs
- [ ] TEE attestation refs as optional input metadata on facts

---

## Slice C — decision policy (pure)

- [ ] `decideActions(findings, policy) -> Decision[]`
- [ ] Actions: ignore, annotate, openThread, triggerHot, challenge, resolve, proposePenalty, vetoSteward

---

## Slice D — action planner

- [ ] `planStewardActions(decisions, contracts, host) -> ActionPlan`
- [ ] Contract calls: hot, dispute, resolve, challenge, finalize, penalty hooks
- [ ] Host calls: forum thread/message, annotation records

---

## Slice E — runtime / Bridge (later)

- [ ] Monitoring loop when real subjects to watch exist
- [ ] Panel projection for CLI
- [ ] No market/vault creation, no user streaming

---

## Explicit non-goals

- [ ] No bookmaker creation approval gate in v0
- [ ] No forum storage (host)
- [ ] No TEE runtime in this package

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../../TODO.md#hardening-loop-every-slice).

- [ ] check / build / test for `packages-re2/steward`
- [ ] Pure rule/decision tests; no `Effect.run*` in `src/` except tests
- [ ] Negative-path test for every new public API
- [ ] Update this `docs/TODO.md`
