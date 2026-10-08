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
  stored weekend services and its counted specials. No record → a create; a record exists and
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

## Reconstruction of past months (solver v3 C4)

Added by C4 (spec `docs/superpowers/specs/2026-10-05-solver-v3-c4-record-reconstruction-design.md`); parent
A31 makes this record the home of the reconstruction's rules, so C4 writes no ADR of its own. Nobody recorded
who was eligible in the months planned before v3, and a month without a record counts for nothing (F3).
`scripts/reconstruct-fairness-months.mjs` infers those records once; Frank reviews a private per-person table;
only the plan whose fingerprint he approved is written — through the one executor, actor `reconstruction`,
past months only, and only records the script itself wrote. Runbook: `docs/SOLVER_AND_INFRA.md`.

**Inference rules (R4–R9):**

- **Tipo today, applied backward, as hypothetical pool ticks (R4).** C2's resolver runs on today's
  `solverConfig` — every restriction, exact rule, week exclusion, presence rule and «Mes por medio» unchanged —
  with each of the three pools replaced by the members whose current Tipo fits it. Today's real ticks feed
  only two anomalies («not ticked today», «ticked today, never seated»).
- **Seats may only delay a line's start (R5, parent A21).** Per line (DL, SL, BGV, Coro), the join month is the
  month of the person's first kept seat — C2's record-free seat step — at a counted service; before it every
  role of the line is `out`. A seat never makes anyone eligible. A join bound that cuts an exact rule removes
  the rule whole for that month; a joined role it also covered becomes plainly `in`, and the table says so.
- **The cadence setting is applied, never inferred (R6).** A «Mes por medio» member's `Sun.Lead` is not
  join-bounded; the setting beside an exact `Sun.Lead` count refuses the run (in the rules: through the
  resolver; introduced by a correction: through the record validator).
- **Today's exact rules apply from the join month (R7)**, and every month whose seats held differ from the
  rule's count is listed.
- **Frank's corrections win (R8):** a file keyed by member `_id`, validated in full before any record is built;
  a correction replaces an exact rule whole (A38) and may add a worship member who has lost `voz`. It never
  edits the configuration the resolver reads (D11).
- **Availability is what is stored today (R9)**, plus today's week exclusions on weekend dates and the
  corrections' blocked dates.

**Rejected:**

- **Seats as eligibility** — reads occasional leads as owed (ADR-0046) and turns the record into a copy of the
  seats.
- **Starting the ledger empty** — every first v3 run would balance against nothing: the gap the program exists
  to close.
- **Everyone eligible from the first stored month (April 2026)** — an earlier attempt showed late joiners owing
  large, false debts and Saturday-only singers owing Sundays.
- **A second, correction-edited configuration for the resolver (D11)** — it would record rule sets the live
  solver refuses, and needs a reverse map from roles to patterns that does not exist.

**Consequences:** the inference is lossy, so every case it cannot settle is listed as an anomaly, never chosen
silently; consent attaches to bytes — the plan binds the bodies, the revisions read, the backups, the preview
figures and digests of every service and member input — so any edit between the dry run and the apply sends
Frank back to the table; after a seat edit, a date move, a «cuenta» change or an availability edit in a
reconstructed month the dry run must be re-run, because nothing else prompts it. The script retires at solver
v3 C7 Step 12.
