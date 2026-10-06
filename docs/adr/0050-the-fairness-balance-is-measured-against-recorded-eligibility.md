# ADR-0050: El saldo de equidad se mide contra la elegibilidad registrada

**Date:** 2026-10-06 · **Status:** Accepted

## Context

Solver v3 balances each person's share of the voice seats over the three months before a run
(the fairness ledger, spec `docs/superpowers/specs/2026-10-05-solver-v3-c2-ledger-and-record-design.md`).
A share needs a denominator: who was eligible for each role on each service. Nothing recorded it.
The pool checkboxes live in one overwritten singleton (`solverConfig`), so the derived history of
ADR-0042 counted seats with no denominator and read an occasional leader as owed Sundays
(ADR-0046); the «sin Lead en …» panel judges last month against today's pool. Judging the past
against today's rules is the same failure in another form.

## Decision

- **Eligibility is stored, once per month; seats stay derived.** One `fairnessMonth` document per
  calendar month (`fairnessMonth.YYYY-MM`) snapshots, per worship member with `voz`, the six voice
  role keys as `in`/`out`/`exact`, the exact rules resolved for that month, «Mes por medio» (the
  setting, never the state), «Exenta», per-date blocks (unavailable, rule-excluded) and the presence
  rules. It never stores a seat, a share, a balance or a cadence state: seats are read from the role
  documents, as ADR-0042 decided.
- **The id is dotted, so the record is private** (parent A2): Sanity serves no id containing a dot
  to an unauthenticated read. The consequence is a rule for every reader: a read without the read
  token answers «no record» with no error, so the ledger reader checks `SANITY_API_READ_TOKEN`
  before any read and the write executor refuses a read client without the token, the `published`
  perspective and `useCdn: false`. Missing the token fails closed; it can never pass for an empty
  past. (Precedent that dotted ids read under the published perspective with the token: the
  `roleTarget.*` locks, read through `operationalClient` by `roleWriteOps.ts`.)
- **One write executor** (`executeFairnessMonthWrites`, `app/utils/fairnessMonthWriteRequest.ts`)
  issues every mutation, for the PUT (`fairnessMonthCommit.ts`, actor `route`) and for C4's
  consented reconstruction script (actor `reconstruction`). Create is a plain create (the id
  collision is the mutex); replace is one `ifRevisionId` patch that sets every field and unsets the
  rest; `createOrReplace` is never used. Because its client is injected, the protected-read audit
  gained an executor rule: declaring or calling it is a `protected-write` site.
- **Freezing services and record binding** (parent A5, A6). A month's freezing services are its
  stored weekend services and its counted specials. A record exists → a create; a record exists and
  the month has no freezing service → it may be replaced; it has one → the record is frozen (the
  PUT refuses `month_has_services`) and BINDS: the record is what that month was solved with. A
  create never depends on freezing services (A27).
- **Past months are written only by reconstruction**, which touches only intact records it wrote
  and is the only actor that deletes (a revision-asserting no-op patch and the delete in one
  transaction). The route refuses a past month.
- **Exact arithmetic, one rounding each.** Shares are BigInt rationals; each wire figure is rounded
  once to hundredths (half away from zero) and the wire balance is `share − received`, both in
  hundredths; each display tenth is rounded once from the same exact value, never from the
  hundredths (A17, A39).
- **One seat per person per service** (LG-4): a holder's second voice seat at one service is set
  aside `second_seat` before every other rule, exactly as the v3 request carries only the kept seat.

## Rejected

- **Reading eligibility live from `solverConfig`** — judges a past month against today's pools and
  rules: the failure this record exists to end.
- **Storing seats or balances in the record** — a second copy of what the role documents already
  say, which drifts the first time a past service is edited.
- **A root (undotted) id** — the record holds members' unavailable dates; an undotted id is served
  to anyone who asks the dataset.
- **`createOrReplace` for a replace** — it cannot assert a revision and would silently discard a
  concurrent admin's record (L3).
- **Rounding the exact balance on its own** — at an exact half it disagrees with `share − received`
  (0.125 among eight: −87, not −88), and the two suites of the golden fixture must agree to the
  hundredth.

## Consequences

- **Residual race, accepted.** The freezing-services read and the commit are not atomic: a service
  created (or a special toggled to counted) between them lets a replace land on a month that just
  froze. The `ifRevisionId` still guarantees the replaced record is the one read, and the window is
  milliseconds. Likewise an `unchanged` answer can carry a revision a concurrent replace just
  superseded; the panel re-reads the GET on any 409, so the next attempt asserts the new one.
- **No repair path for a malformed or route-written record** in the app or in C4's script: the GET
  fails closed on a malformed record, and repairing one is a separate consented script reviewed on
  its own.
- **Engine gate.** The PUT answers `engine_not_v3` unless the effective engine is v3; until C7's
  flip that means only the `preview` branch deployment or a local server with `OWT_SOLVER_ENGINE=v3`
  (docs/SECRETS.md) — and both write the PRODUCTION dataset, stamped `preview`/`local`.
- Every amendment to an existing ADR (ADR-0042's «amended under v3» included) is C7's, at the flip
  (parent A31). This record amends none.
