# Spec C4: reconstructing the fairness records of past months (solver v3)

## Status

`DRAFT` · **Risk tier: CRITICAL** — it writes production data: `fairnessMonth` documents in the
production dataset that every later v3 solve, the «Equidad» panel and the DL floor read as the truth
about who was eligible in a past month. A wrong record silently creates or erases debt for real
people for three months. The parent's §11 table assigns this tier («production data»); CLAUDE.md
puts any production Sanity write behind a dry run and Frank's explicit consent.

Child **C4** of the approved parent
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (§6 L6; §11 row
C4; §13 «→ C4»), **aligned on 2026-10-05 to the parent's amendments A1–A26** (§3 «Amendments from
writing the children»). The parent wins on every conflict, and an amendment row wins over the older
wording of the clause it names. Where a sibling's text still predates an amendment (C2's display
precision and formatter export, at the time of this revision), this spec follows the amendment and lists the
sibling change under «Sibling changes this spec depends on». Remaining gaps in the parent are in
«Parent issues».

**Contracts, not prescriptions.** What must be true and what must never happen. Helper names, file
splits and loop shapes belong to the C4 implementation plan. Existing files are cited as evidence.

**Names.** This repository is public. No member name, alias or per-person number appears here or in
anything the script commits or prints to stdout. Examples use fictitious people («Ana Ejemplo»,
«Beto Ejemplo», «Carla Ejemplo», «Dani Ejemplo»). Members are described by policy role («the
cadence members», «the fixed-count lead»), as in the parent.

**This document authorizes nothing.** Not the implementation, not a dry run against production, not
an `--apply`.

## Original request

The parent's request, as the parent records it:

> Necesitamos arreglar en solver.
> Tiene que tomar en cuenta el historial, pero debe de considerar a personas "especiales" como el caso
> que te platique de [REDACTED: three member names] que solo dirigen un mes sí y un mes no.
> Y mantener el fariness en ventanas más grandes, siempre siendo claro y transparente con el admin al
> respecto.
> Lo que pasa es que mientras el equipo crece más, no caben todos para dirigir en un solo mes, pero
> quiero que sus participaciones sigan siendo parejas.
> Si es necesario construir un nuevo solver desde cero, estoy abierto a la posibilidad.
> Recuerda que debe de poder respetar los espacios asignados y necesitamos también que pueda llenar 2
> meses de jalón
>
> — and, mid-session: «Y la participación total también»

And the go-ahead for this child: «Aprobado, sigue con los specs de las entregas» — Frank, 2026-10-05.

## Outcome

- **Primary outcome.** Each lookback month that will feed a v3 solve and was planned before any v3
  writer existed gets a `fairnessMonth` record with `source: "reconstructed"`, written **through
  C2's one write executor** (parent A4), after Frank has read a per-person table of exactly what will
  be written and what balances it implies, and consented to that table. The months are August and
  September 2026 first; October 2026 on or after 2026-11-01 (it must be past — A21); then every month
  confirmed under v2 before cutover, **each as it becomes past** (A21; until then it reads «sin
  registro»).
- **Operator.** Frank reviews and consents; Claude (or Frank) runs the script from a checkout whose
  `.env.local` points at production.
- **Problem today.** Nobody recorded who was eligible in a past month. The pool ticks live in one
  overwritten singleton; its revision history starts 2026-09-29. Under parent F3 a lookback month
  with no record counts for nothing — so without this child, the first v3 runs would balance against
  an empty past, which is the very gap the program exists to close.
- **Success measure.** For each reconstructed month: Frank has signed off the table; the record that
  landed has the content hash the reviewed dry run printed; a second dry run reports «sin cambios»
  for every month and plans zero writes; the «Equidad» panel preview (C2) shows those months as
  «reconstruido» and Frank reads the resulting balances as correct.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| No per-month record of pool ticks exists anywhere. `solverConfig` is one document replaced whole on every «Guardar reglas»; its Sanity revision history starts 2026-09-29; before the document existed the rules lived in one browser's `localStorage` | `sanity/schemas/solverConfig.ts:8-13`; `scripts/seed-solver-config.ts` header (applied 2026-08-02); private `evidence/u_real-data.md` «What data exists», `u_history-derivation.md` §4 | Past eligibility can only be **inferred**, so it must be reviewed by Frank before it is written (parent L6) |
| Weekend role documents exist from 2026-04-26 only; specials exist too; October 2026 is mostly `published: false` | `evidence/u_real-data.md` «What data exists» | Seat evidence starts in April 2026; drafts count (parent D14, F3), so "has stored services" ignores `published` |
| Tipo decides pool fit: `voz` plus the pool subtype. v2 dedupes pools Sunday > Saturday > support. v2's role sets: Sun.Lead ← Sunday pool; Sat.Lead ← Sunday ∪ Saturday pools; Sun.BGV, Sat.BGV, Sun.Choir ← every pool | `app/components/admin/plannerModel.ts:805-811`, `:873-879`; `gcf/owt_solver_v2.py:642-648` | «Tipo today applied backward» is expressible as hypothetical pool ticks; the pool → role mapping belongs to C2's eligibility resolver (RES-1, parent A7), not to this script |
| An earlier reconstruction attempt that marked everyone eligible from the first stored month showed two late joiners owed large, false debts and two Saturday-only singers owed Sundays; bounding each person by the first month they served fixed it | `evidence/d_persistence-ux.md` §0 («Why inference must be reviewed») | A join bound is required, and the result is reviewed per person, with balances, before any write |
| Raw served counts with no eligibility denominator read occasional leads as owed Sundays | ADR-0046 (`docs/adr/0046-auto-sends-no-fairness-history.md`) | Never infer eligibility from seats served (parent L6, §10); seats may only delay a line's start (A21) |
| The fixed-count lead's exact rule exists in today's config, but stored seats show months in which that person held fewer Sunday leads than the rule's value; no rule's start date is recoverable | `evidence/u_real-data.md` (b), (d) | Today's exact rules applied backward can be wrong for early months: every mismatch must be listed, and correctable by Frank |
| The cadence members' Sunday rhythm was managed by ticking and unticking pools; the stored seats only partly show it | `evidence/u_real-data.md` (c) | Their DL eligibility cannot be inferred from seats; the cadence **setting** is applied instead (parent F7, L4) |
| `unavailableDates` lives on the member, is written wholesale, past dates are never pruned automatically but a member may delete them, with no change log | `sanity/schemas/worshipTeam.ts:222-228`; `evidence/u_history-derivation.md` §3 | The availability snapshot is «as stored at reconstruction time», and the table says so |
| `operationalClient` reads the `published` perspective with `SANITY_API_READ_TOKEN` **optional** («public published reads work without it»). Under A2 the record id is dotted (`fairnessMonth.YYYY-MM`), and a dotted id is private in Sanity, so a client without the token answers **zero records** for a month that has one — silently | `sanity/lib/operationalClient.ts:13-23`; parent A2; C2 §3 row «The dataset answers unauthenticated published reads» (Sanity «IDs and paths» docs, checked 2026-10-05) | A tokenless dry run would plan «crear» for recorded months and show Frank a false table. Every client the script builds carries a token, checked before construction (R3, R19) |
| Every existing `*Commit.ts` module imports `server-only` and the server `writeClient`; a pure, `server-only`-free module is how a route and an `--apply` script share one validator | `app/utils/roleSwapCommit.ts:39-41`; `app/utils/solverConfigWriteRequest.ts:1-6`; `scripts/seed-solver-config.ts` header («npx tsx rather than bare node») | C2's neutral write-request module, with its executor taking injected clients (A4, C2 WR-16), is what the script imports; the script runs under `tsx` |
| Scripts that import `app/utils/*.ts` must run under `npx tsx --env-file=.env.local`; bare `node` fails at import with `ERR_MODULE_NOT_FOUND` | `scripts/requeue-role-notices.mjs:18-27`; `docs/NOTIFICATIONS.md:662` | Runtime decided below (Decision D1) |
| Production write scripts: dry run by default; read token for the dry run, write token for `--apply`; each document written under `ifRevisionId` of the revision read; a failed write may have landed, so re-run the dry run before any repair; `process.exitCode`, never `process.exit()` | `scripts/migrate-proposal-messages.mjs:41-47`, `:162-167`, `:194-200`, `:207-209` | The write protocol follows these, plus a plan binding (R15). An apply needs **both** tokens: C2's executor re-reads each record through the injected **read** client before it mutates (C2 WR-16) |
| An operator script that holds member names refuses every input/output path inside the repository, any of its working trees, before reading or writing a file | `scripts/lib/solverHistoryDiffRun.ts:386-395`, `:221` | Same refusal for `--out` and `--overrides` |
| The protected-read audit is a static scan; operator scripts that read protected role types are listed by exact `file#module` with a reason and removal owner; the test pins the list and forbids globs | `app/utils/protectedReadAudit.ts:367` (`OPERATOR_TOOLING_ALLOWLIST`); `app/utils/__tests__/protectedReadAudit.test.ts:354-361`, `:491-504` | The script gets an exact `OPERATOR_TOOLING_ALLOWLIST` entry when the scan flags it (R20) |
| The commit-module caller pin scans **`app/` only** today (`git ls-files app`); it already pins named non-`*Commit` modules in `PINNED_BEYOND_COMMIT` | `app/utils/__tests__/serviceCommitCallers.test.ts:16`, `:54`, `:65-69` | A4 and C2 WR-16/GU-1 extend the scan to `scripts/` for the write-request module's row; C4 adds its script core to that row (R20) |
| The weekend range read exists, deliberately unfiltered on `published`; there is no specials-in-range read | `app/utils/serviceReadQueries.ts:380-397` | The script reads through the builders C2's reader uses (C2 RD-1 adds the specials read) |
| Worship membership: absent or empty `ministries` means worship | `app/ministries.ts:74-75` | Kids-only members never enter a record |
| C1's toggle: legacy documents carry no `countsForFairness`; the effective value is `coalesce(countsForFairness, _type != "special_role")`; **services of months before the current one cannot be toggled from any surface**, so lookback months read what was stored or their defaults | C1 spec §9 «C1 provides» and «Facts the consumers must hold» (`2026-10-05-solver-v3-c1-fairness-toggle-design.md:405-430`, read 2026-10-05); parent L1, A25 | Every special of Aug–Oct 2026 predates C1, so it is **uncounted** and stays so; a month's counted flags are frozen by the time C4 may write it (R1), which keeps R15/R17 stable |
| The dry-run (read) and `--apply` (write) halves of `scripts/` are already covered by `SANITY_API_READ_TOKEN` and `SANITY_WRITE_TOKEN`, both in local `.env.local` | `docs/SECRETS.md:274-296` | No new secret or env var; no `docs/SECRETS.md` entry owed by C4 (the note that the read token is needed to read `fairnessMonth` is C2's, A2) |
| Parent L3 and A4: «past» means before the current CDMX month; past months are written only by the reconstruction, which writes past months only and creates, replaces or deletes only records it wrote, under a revision check | parent §6 L3; §3 A4 | Month scope (R1) and the decision matrix (R14, R18) |

## Interfaces

C4 owns no data shape. It **consumes** C1's field, C2's record, executor, resolver and ledger, and
C3's cadence setting, and **provides** reconstructed records and an operator CLI. Shapes below are
copied from the owning sibling as read on 2026-10-05; where a sibling renames a thing, its name wins;
the capability listed here must exist, or C4 cannot be built.

### Consumes from C1

- `countsForFairness?: boolean` on `sunday_role`, `saturday_role`, `special_role`; effective value
  `coalesce(countsForFairness, _type != "special_role")` (parent L1), as C1's neutral
  `app/utils/countsForFairness.ts` exports it (`COUNTS_FOR_FAIRNESS_GROQ`,
  `countsForFairness(doc)`) and C2's read builders apply it. C4 writes no query of its own for it.
  Used for: which seats count toward a join month (R5), the per-service «cuenta» column of the table
  (R11 — C1 lists C4 as a consumer that prints it), and the balance preview (R11). An uncounted
  service creates neither share nor received seats.

### Consumes from C2

1. **The record**, `_type: "fairnessMonth"`, `_id: "fairnessMonth.YYYY-MM"` (parent A2 — the dotted
   id is private in Sanity). C4 never constructs the id (R2) and reads records by `month` through
   C2's builders. C4 relies on these facts about its shape (parent L2, A3; C2 REC-1–REC-7 and §7
   types `RoleKey` = `"Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir" | "Sat.Choir"`,
   `Status` = `"in" | "out" | "exact"`, `LogicalRecord`):
   - `month`: `"YYYY-MM"`;
   - `source`: `"auto" | "manual" | "reconstructed"`, the last written only by the reconstruction
     actor (C2 WR-14);
   - `contentHash`: over the record's **eligibility content only** (no `name`, `_key`s, stamps,
     `_rev` or timestamps — C2 REC-6), with two exported entry points over one serialization:
     `contentHashOfWrite(month, body)` and `contentHashOfStored(doc)`. A stored record is **intact**
     iff `contentHashOfStored(doc) === doc.contentHash`, which is how «edited after reconstruction»
     is detected;
   - per person (`people[]`, one item per member, `_key` derived from a hash of the member `_id` —
     REC-3): the six role statuses (`in` / `out` / `exact`, A3); `exactRules[]`
     `{ roles: RoleKey[], count }` (a role is `"exact"` iff exactly one rule covers it; `count`
     resolved for the month, 1–31); `sundayCadence: "alternate"` or absent (the setting, never the
     state — F7, A14), never together with an exact rule covering `Sun.Lead` (A11, C2 REC-3); `exempt`; `blocks[]` `{ date, unavailable, excludedRoles: RoleKey[] }`, one
     per date inside the month — the availability snapshot and the date-scoped rule exclusions
     (A3); a display `name` stored only as text;
   - `presence[]` (A3; C2 REC-4) — passed through from C2's resolver unchanged;
   - the stamps of C2 REC-2 — for this script's records: `source: "reconstructed"`, `engine: "v2"`
     (A4), `environment: "local"`, `recordedBy` the script's fixed marker (R10).
2. **C2's neutral write-request module** (no `server-only`, no module-level client, hashes with
   `node:crypto`; filename left to C2's plan, precedent `app/utils/solverConfigWriteRequest.ts:1-6`),
   importable from a `tsx` script. It is **not** `app/utils/fairnessMonthCommit.ts`, which imports
   `server-only` and whose only caller is the route (C2 WR-1); the script never imports that file.
   C4 consumes from it, by C2 §7's working names:
   - `resolveMonthEligibility({ month, config, members })` →
     `{ ok: true, body }` or `{ ok: false, issues, refusals: [{ person, reason: "unresolved" |
     "ambiguous" | "no_tipo" | "cadence_and_exact" }] }` (C2 RES-1–RES-7 and its §7 signature; the
     single v3 eligibility resolver, parent A7).
     `members` is the **unfiltered worship roster** (RES-5). It applies today's restriction
     semantics (exclusions → `"out"`, `==` → `"exact"` with the month's count, «Exenta» → `exempt`,
     week exclusions → `blocks[].excludedRoles` on weekend dates, `unavailableDates` →
     `blocks[].unavailable`, the C3 setting → `sundayCadence`), resolving every rule name through
     C3's exactly-one resolver. C4 calls it with a `config` whose three pools are R4's hypothetical
     ticks and whose restrictions and cadence settings are **today's, unaltered** — the overrides
     file never edits the `config`. **Order:** (i) the resolver runs per month on that `config`;
     any `ok: false` — every reason, `cadence_and_exact` included — refuses the run (exit 2) before
     any body is transformed, printed per R13, never by name; there is no body to correct, so no
     override can clear it and the fix is in `solverConfig` (the same rules refuse v3's Auto: C2
     §7's C6 row, «a resolver `ok: false` (including `cadence_and_exact`, A11) refuses Auto»; C3
     §6.12, «under v3 C6 refuses the request»). (ii) Only on `ok: true` do R5–R8
     **transform** the returned body: R5's join bounds only narrow it; R6–R8 set what the overrides
     file says (a status, an exact rule, `exempt`, the cadence setting, join months, blocked
     dates), which may also widen a cell. (iii) The transformed body goes through the validator
     below, which catches any contradiction an override introduced (A11's pair included);
   - `validateFairnessMonthWrite` (C2 WR-17; it takes the actor too, C2 §7): C4 passes every
     transformed body through it, as actor `reconstruction`, before planning it, and the executor
     re-runs it regardless — so a reconstructed record cannot differ in shape from a live one, and
     an invalid transformed body refuses the run (exit 2) with no plan written;
   - `contentHashOfWrite` / `contentHashOfStored` (above);
   - `executeFairnessMonthWrites({ clients: { read, write }, actor: "reconstruction", op: "write" |
     "delete", months, stamps: { recordedBy, now, currentMonth, environment, engine } })` — **the
     only mutation path for the type** (A4, C2 WR-16). It re-reads each month's record itself
     through the injected read client (published perspective, no CDN), runs the reconstruction
     actor's decision and mutates only through the injected write client. Write rows (C2 WR-14, in
     order): (1) month not before the current month → `not_past_month`; (2) intact record with an
     equal `contentHash` → `unchanged`; (3) no record, `expectedRev === null` → `created` (plain
     `create`; `already_exists` → `record_exists`); (4) no record, `expectedRev !== null` →
     `record_missing`; (5) record with `source !== "reconstructed"` → `not_reconstruction_owned`;
     (6) record not intact → `record_edited`; (7) `expectedRev !== record._rev` → `stale_revision`;
     (8) otherwise `replaced` under `ifRevisionId`. Delete rows: (D1) no record → `record_missing`;
     (D2) `source !== "reconstructed"` → `not_reconstruction_owned`; (D3) not intact →
     `record_edited`; (D4) `expectedRev !== record._rev` → `stale_revision`; otherwise `deleted`
     under `ifRevisionId(expectedRev)`. An invalid body → `invalid_body`. No stored-services, Tipo or
     engine restriction applies to this actor (WR-14). Any error the executor does not classify is
     thrown.
3. **`app/utils/fairnessLedger.ts`** (pure, neutral): the role → line map (F1, D14, A13:
   `Sun.Lead`→`DL`, `Sat.Lead`→`SL`, `Sun.BGV`/`Sat.BGV`→`BGV`, Chorus→`CORO`, a counted special's
   seats by day class) and the balance computation (F2–F6, C2 LG-1–LG-17) over in-memory records,
   role documents and members — exact rationals, each output figure rounded once to hundredths
   (LG-13).
4. **The read builders** C2's reader uses (C2 RD-1; neutral, in `serviceReadQueries.ts` or C2's own
   module): weekend **and special** role documents in a date range, every published state, canonical
   documents only, with the effective counted flag; worship members with `memberType`, `ministries`,
   `unavailableDates`; the `fairnessMonth` records for a list of months; the `solverConfig`
   document; and whether a month has **freezing services** (C2's term for A5's predicate: stored weekend services or counted specials). The script never writes its own GROQ for
   these, and runs them only through a client that carries a token (A2, R3).
5. **The single display formatter** (parent A17): each person-line figure is shown with **one
   decimal**, computed once from the exact value by C2's single formatter, `es-MX` with a decimal
   point, and the saldo always in C2's words — «le deben 0.8» / «0.3 de más» / «al día». The table
   imports that formatter; it never formats a number itself and never rounds an already-rounded
   hundredth. (C2's §7 does not yet export the formatter and its UI-4 still says two decimals —
   listed under «Sibling changes».)

### Consumes from C3

- `solverConfig.restrictions[].sundayCadence?: "alternate"` (absent = «Normal»; never `null` or
  another string), keyed by the restriction's `person` like every rule (C3 spec §7, item 1).
- C3's neutral resolver module `app/utils/sundayCadence.ts` (C3 spec §7, item 4), reached through
  C2's resolver (RES-7): `resolveRulePersonId(person, roster) → { ok: true; id } | { ok: false;
  reason: "unresolved" | "ambiguous"; matches }` and `cadenceMembers(config, roster) → { ids;
  refusals }`, over the **unfiltered worship roster** (`RosterMember = { _id, member_name, alias?,
  memberType? }`), never a `voz`-filtered list or a pool. Any refusal refuses the run (R13, D9).
- C3's v2-view guarantee (C3 spec §7, item 7; parent A8: v2's whole request and grid verdicts are
  identical with or without the setting) — the reason «Mes por medio» may be saved before C4's dry
  run (parent A22).

### Provides

- **To C2's reader, C5's requests and C6's panel (as data):** `fairnessMonth` records with
  `source: "reconstructed"` for the months Frank approved, each strictly before the CDMX month in
  which it was written. Nothing else is written, ever. A reconstructed record never binds a horizon
  month (A6), because Auto refuses a horizon containing a past month (A24).
- **To C7 (operator CLI)** — `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs`:
  - `--months YYYY-MM[,YYYY-MM…]` — required, no default;
  - `--out <dir>` — required; private directory outside the repository;
  - `--overrides <file>` — optional; private file outside the repository;
  - `--preview-run YYYY-MM` — optional; the run month whose 3-month lookback the balance preview
    shows (default: the month after the last requested month);
  - no write flag → dry run; `--apply --plan <file>` → writes exactly the reviewed plan;
  - `--rollback` → plans deletions (dry run); `--rollback --apply --plan <file>` → deletes exactly
    the reviewed plan;
  - exit codes: `0` done (dry run printed, or every planned write landed); `2` refused before any
    write; `1` failed or partial.

## Requirements

### Scope and inputs

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R1** | **Months.** The run covers exactly the `--months` list, oldest first. Every listed month must be **strictly before the current CDMX month** (today = `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`), otherwise the whole run refuses (exit 2) before any read — so October 2026 is accepted only on or after 2026-11-01 (A21). A listed month with **no stored weekend services and no counted specials** (A5's predicate — C2's «freezing services», any published state, read through C2's builders) is skipped and reported «sin servicios guardados: no se reconstruye». A service belongs to the month of its stored `YYYY-MM-DD` (`week` for weekend roles, `date` for specials), never through a `Date` | Parent L3, A4 («past» = before the current CDMX month; the reconstruction writes past months only), A21; a month with only uncounted specials contributes nothing to any line (LG-2), so its record would be meaningless — A5's predicate, not «any service», is the program's definition of a month with services | A run naming the current month refuses; one naming an empty month, or a month whose only service is an uncounted special, skips it; a 31-Oct Saturday counts in October |
| **R2** | **One writer.** Every create, replace and delete goes through `executeFairnessMonthWrites` with actor `reconstruction` (Interfaces 2; A4). The script contains no Sanity mutation call of its own, never imports `app/utils/fairnessMonthCommit.ts` (C2 WR-1), and never hand-builds a record, an `_id`, a `_key`, a stamp or a hash. It never sets `source` itself: the actor stamps `source: "reconstructed"` | Parent L6 «never a parallel writer»; A4; ADR-0043 | A static test finds no mutation method and no import of `fairnessMonthCommit` in the script or its `scripts/lib` modules; the fake client's mutation log shows only executor-issued mutations |
| **R3** | **Reads.** Canonical documents only (`drafts.**` excluded); every published state; through C2's read builders; **every client carries a token** — a dry run never constructs a client without `SANITY_API_READ_TOKEN` (A2: a tokenless read answers zero records and would look like «sin registro»). Members: worship only (`ministries` absent, empty or containing `worship`); `disabled` does not matter (it removes app access, not schedulability). Any failed or malformed read aborts the run (exit 1) **before** any table or plan is written — never a partial table. A month with no record is not a failure | A half-read or tokenless table would be reviewed as if it were whole; A2's «an unreadable record must never look like sin registro» | A rejected read writes no file and prints no plan fingerprint; a missing token exits 2 with no client constructed |

### Inference (what each record says)

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R4** | **Base eligibility = Tipo today, as hypothetical pool ticks.** For every reconstructed month, the pool ticks in the `config` handed to `resolveMonthEligibility` are: every worship member whose **current** Tipo fits the pool subtype (`voz` + `sunday_lead` / `saturday_lead` / `support`; C2's RES-1 does no cross-pool de-duplication, and none changes a status). The resolver then applies **today's** `solverConfig` restrictions (exclusions, `==`, «Exenta», week exclusions, presence) and C3's cadence settings. A member with no Tipo, or `voz` alone, fits no pool and is `"out"` everywhere | The rule «Tipo today applied backward»; ADR-0029 (Tipo is the only eligibility axis); one resolver for live and reconstructed records (A7) | The fictitious fixture's statuses equal C2's resolver output for those ticks, before R5–R8 |
| **R5** | **Join bound per line — seats may only delay a line's start.** For each person and line (`DL`, `SL`, `BGV`, `CORO`, by C2's role → line map), the **join month** is the calendar month of that person's earliest seat that counts to that line, over every stored **counted** service on record (any published state, all months; a counted special mapped by day class, D14/A13); a seat in an uncounted service never sets a join month. In every reconstructed month **before** the join month, every role of that line is `out` (reason «antes de su primer servicio en esta línea»). A person with no counted seat in a line is `out` for that line in every reconstructed month. A seat never makes anyone eligible: a seat held by someone whom R4 makes `out` stays `out` and is listed as an anomaly | Parent A21, verbatim: «Seats served may only delay the start of a line; they never make anyone eligible»; L6 and §10; the evidence shows that ignoring join months invents debt. Per line, because the DL floor starts each line at its first recorded eligibility (F10) | A fixture member first seated on BGV in September is `"out"` for BGV in August and `"in"` from September; a fixture member whom today's rules exclude from Saturday, but who held a Saturday seat, stays `out` and appears in the anomalies |
| **R6** | **Cadence members: setting applied, never inferred.** A person whose cadence setting is «Mes por medio» (from `solverConfig` via C3, or from the overrides file, R8) is recorded with `sundayCadence: "alternate"` in every reconstructed month, and her `Sun.Lead` status is **not** join-bounded: it is `"in"` in every reconstructed month where Tipo and today's rules allow it. Her `SL`, `BGV`, `CORO` lines follow R4–R5 like anyone's. The record stores the setting, never an `on` / `off` / `out` state (F7, A14). A setting on someone whose `Sun.Lead` status is `"out"` is not recorded and is listed as an anomaly; one whose status is `"exact"` is A11's pair, below — never silently dropped. **The setting together with an exact rule covering `Sun.Lead` refuses the run** (exit 2) before any plan is written, printed by member `_id` and month, never by name (A11), at whichever layer it first appears (Interfaces 2, order): **(a) in today's rules** — the resolver answers `ok: false` with `cadence_and_exact` (C2 RES-7), so there is no body and no override can clear it; Frank removes one of the two in `solverConfig`, which v3's Auto needs anyway (C2 §7's C6 row; C3 §6.12); **(b) introduced by the overrides file** — an «alternate» override on someone whose rules give an exact `Sun.Lead`, or an exact-rule override covering `Sun.Lead` on a cadence member — `validateFairnessMonthWrite` refuses the transformed body (C2 WR-4, WR-17); Frank corrects the overrides file (cadence «normal», or a different status or exact rule). C4 never picks one silently | Parent F7, L2, L4, A11, A14; the stored seats cannot show the rhythm (evidence); without the setting, the cadence members would read as ordinary DL members in the lookback — the ADR-0046 false «owed» reborn | Fixture: a cadence member with a single Sunday in the window is `"in"` + `alternate` for `Sun.Lead` in all reconstructed months; her Sundays are set aside by C2's ledger (no DL debt in the preview); a fixture member with both the setting and `Sun.Lead == 2` **in the rules** refuses the run with exit 2 and no plan, through the resolver's `cadence_and_exact`, and an override setting her cadence to «normal» does **not** clear it (only the rule fix does); a fixture member whose `Sun.Lead == 2` is in the rules and whose «alternate» comes **from the overrides file** refuses through the validator, and removing that override clears it |
| **R7** | **Exact rules applied backward, mismatches surfaced.** Today's `==` rules apply in every reconstructed month from the line's join month (R5), with the count resolved for that month by C2's resolver. For every month in which the seats the person actually held in that role differ from the rule's value, the table lists the mismatch as an anomaly («regla fija = N, tuvo M») so Frank can override it (R8) | No rule's start date is recoverable (evidence); a rule applied to months before it existed misstates them | A fixture member with `Sun.BGV == 1` who held 0 in one month produces exactly that anomaly line |
| **R8** | **Overrides — Frank's corrections.** An optional JSON file **outside the repository**, keyed by member `_id`, with a schema version. Per member it may set: a role status (`"in"` / `"out"`) or an exact rule in C2's shape (`{ roles: RoleKey[], count }`, making those roles `"exact"`) for one month or for every month of the run; `exempt`; the cadence setting («alternate» or «normal»); a join month per line (replacing the seat-derived one, earlier or later); **blocked dates** added to the month's `blocks[]` (all roles → `unavailable: true`, or named roles → `excludedRoles`), for a member who joined mid-month or who deleted a past unavailable date; a free-text note (printed in the private table, **never written to Sanity**). An override wins over every inferred value. The file is validated in full **before** any record is built: an unknown member `_id`, an unknown key or value, a malformed month, or a status or exact rule that `validateFairnessMonthWrite` would refuse (a role covered by more than one rule, a count outside 1–31) makes the whole run refuse (exit 2). A contradiction that exists only **between** an override and today's rules (A11's pair, R6 case b) cannot be seen in the file alone: it is caught by `validateFairnessMonthWrite` on the transformed body (Interfaces 2, order), still exit 2 and still before any plan is written. Overrides transform the resolver's body only; they never edit the `config` the resolver reads (D11). Entries for valid months outside `--months` are listed «no aplica a esta corrida» and ignored. Every overridden cell is marked in the table | Parent L6 («never overwrites a record Frank edited» — corrections are made here, then re-run); fail closed on typos | Each refusal case has a test; an overridden cell shows «corregido» in the table and in the planned record |
| **R9** | **Availability.** Each person's availability snapshot for the month is the member's stored `unavailableDates` falling in that month **as read at reconstruction time** (`blocks[].unavailable`, binding every service of that date), plus today's week exclusions resolved by C2's resolver to that month's **weekend** dates (`blocks[].excludedRoles`, binding weekend services only — A13), plus any blocked dates the overrides file adds (R8). Join bounds are monthly (R5); a join inside a month is expressed as blocked dates before the first seat, through the overrides file, so a mid-month newcomer accrues no share for weekends before she joined. The table header states «disponibilidad: lo guardado hoy, no lo que había entonces» | Parent L2 snapshots availability; A13 scopes date-scoped rule exclusions to weekend services; past dates may have been deleted with no trail (evidence) | Fixture dates outside the month never enter it; a week exclusion never lands on a special's date as a binding exclusion |
| **R10** | **Record stamps.** Every record the script writes carries C2's REC-2 stamps as the executor sets them for actor `reconstruction`: `source: "reconstructed"`; `engine: "v2"` (A4 — every month C4 targets was planned under v2); `environment: "local"` (REC-2 derives it from `VERCEL_ENV`, unset in a local run — so it is never a Preview write, L3); `recordedBy` the script's fixed marker, never a member id | The panel's «reconstruido» chip and the decision matrix (R14) both read `source` | Asserted on the planned records in the dry-run test |

### Review output

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R11** | **The per-person table, in Spanish, in a private file.** `--out` is required and is refused (exit 2, before any read) if it resolves — symlinks followed — inside the repository or any of its working trees; same for `--overrides`. The dry run writes there: (a) the **table** (Markdown); (b) the **plan** (JSON, R15). The table has, per month: the month's services (date, type, effective «cuenta» flag — C1); then one row per member in the record: name; per role the status, rendered `elegible` / `fuera` / `fija N` for `"in"` / `"out"` / `"exact"`, with its reason code and a «corregido» mark; join month per line; seats held that month per line (reference only); blocked dates in the month; «Exenta»; «Mes por medio». Then a **balance preview**: for the `--preview-run` month, each person's 3-month carried balance per line (`DL`, `SL`, `BGV` with presence sub-lines folded in, `CORO`, Total = sum) computed by `fairnessLedger.ts` over the **planned** records plus any existing records in that window, shown exactly as the panel shows them: **one decimal**, through C2's single formatter, saldo in C2's words (A17, Interfaces 5). Then the **anomalies** (R13). Rows are sorted deterministically (month, then display name with `es` collation, then `_id`) | Frank reviews outcomes, not just inputs: the earlier failure was visible only as balances (evidence). Names stay out of the repository | The fictitious fixture's table matches a golden file; a newcomer shows «al día» before her join month |
| **R12** | **Stdout carries no member name.** Stdout prints: the resolved target (project · dataset · «DRY-RUN» / «APPLY» / «ROLLBACK») **before any read**; per month the planned action (R14) and counts (people, `in`/`out`/`exact` cells, overrides applied, anomalies); the number of cadence settings found (with a loud warning on zero — A2 below); the plan fingerprint; the paths of the two private files | stdout reaches terminals, transcripts and logs; the private file is the only place names go | A test runs the fixture end to end and asserts no fixture name or alias appears on stdout or stderr |
| **R13** | **Anomalies are listed, never auto-resolved.** At least: a seat held by someone `out` for that role; a seat on a date where the holder is `unavailable` (any service), or rule-excluded for that role (weekend services only — A13); a join month whose first seat is **not** on that month's first counted service of the line (the person may have joined mid-month: R8's blocked-date override is the fix); an `exact` value ≠ seats held (R7); a cadence setting on someone not `"in"` for `Sun.Lead` (R6); a Tipo-eligible member **not ticked in today's pool** (the inference may overstate them); a dangling seat reference; two documents of one weekend type on one date (dropped by the ledger, C2 LG-1). Two cases are **not** anomalies but refusals (exit 2, no table or plan written): a restriction name that does not resolve to exactly one member, or that names a member with no Tipo — the resolver's `unresolved` / `ambiguous` / `no_tipo` — printed by restriction `_key` and reason, never by name (A7, L4); and the cadence-plus-exact pair of R6 (A11) — the resolver's `cadence_and_exact` when it is in the rules, the validator's refusal when an override introduced it — printed by member `_id` (the refusal's `person` resolved through C3's `resolveRulePersonId` over the same roster) and month. No override clears a resolver refusal (Interfaces 2, order) | Inference is lossy (evidence); Frank decides each case through the overrides file; A7/L4 refuse an unresolvable name | Each anomaly type has a fixture case and appears in the table |

### Decision per month

Computed in the dry run from the same rows, **in the same order**, as the executor's write decision
for actor `reconstruction` (C2 WR-14), which re-runs it at write time; C4 adds only the skip of R1.

| Existing record for the month (as read) | Planned action | Executor verdict | Table / stdout label |
|---|---|---|---|
| any, month not past | — (the run refused, R1) | `not_past_month` | — |
| none, month has no stored weekend services and no counted specials | skip (C4's own rule, R1) | — | «sin servicios guardados» |
| any `source`, intact, `contentHash` equal to the planned one | **no-op** (nothing sent) | `unchanged` | «sin cambios» |
| none | **create** with `expectedRev: null` | `created` (an `_id` collision at write time → `record_exists`, that month refused) | «crear» |
| `source` ≠ `"reconstructed"` (hash differs) | refuse | `not_reconstruction_owned` | «no lo escribió la reconstrucción: no se toca» |
| `"reconstructed"`, **not** intact | refuse | `record_edited` | «editado después de reconstruir: no se toca» |
| `"reconstructed"`, intact, planned hash differs | **replace** with `expectedRev` = the `_rev` read in the dry run; the table shows the per-person diff | `replaced` (a changed `_rev` → `stale_revision`) | «reemplazar» |

### Write protocol

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R14** | **Decision per month.** Each requested month gets exactly one row of «Decision per month» above; no other action exists. A record the executor would call `unchanged` is never sent, whatever its `source` (both sides write nothing) | Parent L3, L6, A4; C2 WR-14 is the writer's own copy of the same rows; d_skeptic-delivery H2 (a losing `createIfNotExists` writer gets silent success) | One test per row of the matrix, asserting both the planned action and the executor verdict against the fake client |
| **R15** | **Consent attaches to bytes: the plan binding.** The dry run writes a plan file holding, per month: the action, the full planned body, its `contentHash`, and the existing record's `_rev`, `source` and stored hash (or «none»); the content hash of the overrides file (or «none»); the **anomaly list** and the **balance-preview figures** (member id → line → hundredths) Frank reviewed; plus a **fingerprint** over all of it, excluding only the printed generation time. `--apply --plan <file>` re-derives everything from live data and the same overrides, and **refuses the whole run, writing nothing** (exit 2), if any part of the fingerprinted content differs from the file. It then hands the executor **only** the plan's create/replace actions, each with the `expectedRev` the plan recorded | Frank consents to the table he read; a seat swap, a member edit or an overrides edit between the dry run and the apply must send him back to the table, not slip past it — the same discipline as CLAUDE.md's «auto-merge approves a COMMIT». A seat edit in a past month can change the preview without changing any planned record, so the preview is bound too | Mutating one seat (even one that moves no join month), one `unavailableDates`, one override or one record `_rev` after the dry run makes `--apply` refuse with zero writes (fake client records no mutation) |
| **R16** | **Sequencing and partial failure.** Writes go month by month, oldest first, one guarded mutation per month (records are independent documents; no cross-record invariant needs one transaction — C2 WR-16 «reconstruction: one guarded mutation per month»). **No month is attempted after a month whose verdict is a refusal or a thrown error**: the run stops, reports which months landed and which did not, and exits 1. (Handing the executor one month per call satisfies this whatever the executor does with a list.) The report says, as `scripts/migrate-proposal-messages.mjs:194-200` does: a failed write may have landed — **run the dry run again before any repair**; landed months then read «sin cambios» | A stop is safer than continuing past an unknown state; idempotency (R17) makes the re-run the repair | Fixture: the second month's write fails → first month landed, third not attempted, exit 1; a fresh dry run plans only the missing months |
| **R17** | **Idempotent and deterministic.** Re-running the dry run after a successful apply plans zero writes («sin cambios» everywhere); re-applying an unchanged plan writes nothing. The planned bodies, the table and the plan are a deterministic function of the inputs. The clock enters **only** R1's past-month check and the executor's `now` / `currentMonth` stamps, never a planned body, a content hash or the fingerprint; the generation time is printed but excluded from every hash | Parent L6 re-runs per month; the review must be reproducible | Two dry runs over the same inputs produce byte-identical plan files except the printed time |
| **R18** | **Rollback = delete only what it wrote.** `--rollback --months …` plans the deletion of each month's record **only** if it has `source: "reconstructed"` and is intact (C2 WR-14 rows D1–D3); any other record is refused and listed. Before planning, the full content of each record to delete is saved to the private `--out` directory. `--rollback --apply --plan <file>` is bound like R15 and deletes through `executeFairnessMonthWrites` with `op: "delete"` and the `_rev` the plan recorded (row D4). After a rollback, those months read «sin registro, no cuenta» (F3) | Parent §11 C4 rollback («Delete reconstructed records (dry-run first, consent)»); A4; a record Frank or a v3 writer produced is not this script's to delete | Fixture: a reconstructed intact record is planned for deletion; a `source: "manual"` one and an edited one are refused; the backup file exists before the plan is written |
| **R19** | **Consent and runtime.** `--apply` and `--rollback --apply` run only after Frank's explicit consent in chat to **that plan file's fingerprint**, once per run (diagnosing ≠ consent; a consent never carries to a second plan). The script runs as `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs …` (D1). It checks for its tokens **before constructing any client**: a dry run needs `SANITY_API_READ_TOKEN`; an apply or rollback-apply needs it **and** `SANITY_WRITE_TOKEN` (the executor's injected read client must see the dotted record, A2; its write client mutates). It introduces no environment variable | CLAUDE.md production-write rule; A2; the script cannot verify consent itself, so the procedure is part of the contract | The plan's runbook (R21) states the consent step; a missing token exits 2 with no client constructed |

### Guards, docs, retirement

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R20** | **Visible to the guards.** (a) **Whenever the audit's scan flags the script or its `scripts/lib` core** (C2 REC-9: «C4 registers its own script»), the flagged file is listed in `OPERATOR_TOOLING_ALLOWLIST` by exact `file#module` with a reason (reads protected role types and members' availability; writes only `fairnessMonth` through C2's executor; dry run by default; `--apply` bound to a reviewed plan) and a `removalOwner` (R22), and `protectedReadAudit.test.ts`'s pinned list gains it — never a directory or glob. If the scan does not flag it (all reads and writes through C2's modules), no entry is added: the suite refuses an unused exemption (`protectedReadAudit.test.ts:531-536`). The C4 plan proves which case holds. (b) **The caller pin** is the write-request module's row in `PINNED_BEYOND_COMMIT`, whose scan covers `scripts/` as well as `app/` (A4; C2 WR-16, GU-1); C4 adds its script core to that row's exact importer list in its own change. The script never imports `fairnessMonthCommit.ts` | A new writer of production data must not be invisible to the audit or the caller pin (A4: «pinned like the commit modules and its pin scans `scripts/` too») | Both tests fail if the entry is removed or a second script imports the write-request module; a static test fails if the script imports `fairnessMonthCommit` |
| **R21** | **Docs in the same delivery.** `docs/SOLVER_AND_INFRA.md` (the `scripts/` toolbox section) gains a runbook: purpose, inputs, the token check, the consent step, the dry run → review → apply → second dry run sequence, rollback, the private paths, and the rule «names never enter the repository». The inference rules (R4–R9) are recorded in the fairness-record ADR (created by C2, GU-3; C4 adds its reconstruction section), because they reject real alternatives (seats as eligibility; starting the ledger empty; everyone eligible from April). No `docs/SECRETS.md` change by C4: the two tokens already cover both halves (`docs/SECRETS.md:274-296`), and the «needed to read `fairnessMonth`» note on the read token is C2's (A2) | CLAUDE.md «keep documentation current»; ADR bar | Docs reviewed in the C4 code review |
| **R22** | **Retirement.** Once C7 records that the last v2-confirmed month is reconstructed and the cutover's rollback window is closed, the script becomes a retired writer (`assertRetiredWriter` as its first statement, moved to `RETIRED_ONE_SHOT_WRITERS`). Owner: C7's checklist (C7 Step 12). Until then it stays live, because rollback needs it | Precedent `protectedReadAudit.ts:307` (`RETIRED_ONE_SHOT_WRITERS`); an orphan production writer is a standing risk | C7's plan carries the step |
| **R23** | **The dry-run test, fictitious data.** A vitest suite drives the script's pure core and its CLI wiring with **injected fake Sanity clients** (read and write) and a fictitious world (four to six people, three past months, weekend and special services — one counted, one uncounted —, drafts, one cadence member, one exact rule, one presence pair, one newcomer, one excluded-but-seated member, blocked dates and a week exclusion, one existing reconstructed record, one manual record, one edited record). It never touches Sanity, the network or `.env.local` | Precedent `scripts/__tests__/migrateProposalMessages.test.ts` (the one-shot writer is never executed; its rules are asserted) | See «Acceptance and verification» |

## Scope

### In scope

- `scripts/reconstruct-fairness-months.mjs` and its pure core under `scripts/lib/`.
- Its test suite (R23), its audit and caller-pin entries (R20), its runbook and ADR section (R21).
- Applying, **with Frank's consent**, the records for August and September 2026, and October 2026 on
  or after 2026-11-01 (R1, A21).

### Non-goals

- The record's shape, the executor, the writer's other actor (Auto confirm, «Registrar»), the ledger
  formula, the formatter, the panel — C2.
- The cadence setting's storage and UI — C3. The toggle — C1.
- Running the re-runs for v2-confirmed months at cutover — C7 runs this script as each month becomes
  past (C7 Step 10); C4 only provides it.
- Inferring eligibility from seats served (parent §10), or recovering past pool ticks from Sanity's
  document history (it starts 2026-09-29).
- Any write to role documents, members, or `solverConfig`; toggling any service's
  `countsForFairness` (no surface can for past months — A25).
- Writing the current or a future month (R1; those belong to the v3 writers, L3).
- Reconstructing months before the first stored service (April 2026 holds one service; it is only
  reconstructed if Frank lists it).

## Behavior and invariants

- **Required behaviour:** R1–R23.
- **Preserved:** CDMX dates (service month = stored date string); `saturdarSongs` untouched; the five
  member seats are read through C2's builders; canonical documents only; `_key` on every array item
  (minted by C2's module); no `revalidate*` call is needed (no ISR page reads `fairnessMonth`, C2
  WR-13, and the script changes no content a page renders); v2 behaviour unchanged (records are
  inert under v2, parent §13).
- **Data:** the only documents this script can create, replace or delete are `fairnessMonth`
  records it wrote, of past months, through C2's executor (A4). It reads members' availability,
  which is why its outputs are private.
- **Security/privacy:** no member name in the repository, on stdout, or in Sanity beyond the
  display-name text C2's record stores; the record's dotted id keeps it out of unauthenticated reads
  (A2); private files only under a path outside every working tree.
- **Interaction with the policy:** the DL join months this script records are the start of each
  pre-cutover member's DL line, so they decide where the DL floor's look-back begins (F10); the
  cadence setting it records makes the cadence members' Sundays set-asides in those months (F5, F7);
  a month it skips, or that is not yet past, stays «sin registro, no cuenta» (F3, A21).
- **Failure and recovery:** a failed read → nothing written, exit 1; a refused input or a missing
  token → nothing read or written, exit 2; a partial apply → stop, report, re-run the dry run (R16);
  a bad record discovered later → correct the overrides file and re-run (replace, R14), or roll back
  (R18).

## Decisions

| ID | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Runtime | `npx tsx --env-file=.env.local`, keeping the `.mjs` name | It must import C2's TypeScript modules; bare `node` cannot resolve their extensionless imports (`scripts/requeue-role-notices.mjs:18-27`, `scripts/seed-solver-config.ts` header). The task text's «node --env-file» yields to that evidence | One more tool in the command line | Claude |
| D2 | Month scope | Strictly past months only; current/future refused | Parent L3, A4, A21 | October 2026 cannot be applied before 2026-11-01; a v2-confirmed current month waits until it is past | Parent |
| D3 | Join granularity | Per line (DL, SL, BGV, CORO) | F10 starts each line at its first record; A21 lets seats delay a line's start | A member who only ever sang Choir is `out` for BGV until she first holds a BGV seat — conservative (no debt), correctable by override | Claude |
| D4 | Cadence members' DL | Not join-bounded; setting applied | L6 and A21 forbid seat inference of eligibility; their Sundays are set-asides anyway (F5, F7) | Relies on the setting being present (A2 below; parent A22) | Claude |
| D5 | Where names go | Private table file only; stdout name-free | Public repository; transcripts and logs | Frank must open a file to review | Claude |
| D6 | Apply binding | Re-derive and refuse on any difference from the reviewed plan, preview and anomalies included | Consent attaches to what was read | Any concurrent edit of a past month forces a new review | Claude |
| D7 | Write granularity | One guarded write per month, stop on first refusal or failure | Records are independent; idempotent re-run is the repair | A crash leaves some months recorded — visible, recoverable | Claude |
| D8 | Overrides identity | Member `_id` | Names change and collide; the record is keyed by id | Frank copies ids from the table | Claude |
| D9 | Unresolvable restriction name | Refuse the run | Parent L4, A7 (every rule name must match exactly one member); applying half a rule set would misstate someone silently | A stale rule blocks reconstruction until fixed in the rules panel | Parent |
| D10 | Skip predicate | A5's «no stored weekend services and no counted specials» | One definition of «a month with services» across the program; a month with only uncounted specials contributes nothing | A camp-only month gets no record — correct, since it has no line to balance | Claude |
| D11 | Override scope | Overrides transform the resolver's body only; the `config` handed to the resolver is today's, unaltered; a resolver `ok: false` (any reason, `cadence_and_exact` included) is terminal for the run | The same `solverConfig` refuses v3's Auto (A11; C2 §7's C6 row; C3 §6.12), so the rules must be fixed anyway; a second, override-edited config path would let the reconstruction record a rule set the live solver rejects, and would need a reverse map from resolved roles to patterns that does not exist (C2 RES-2 is one-way) | A contradictory rule set blocks reconstruction until fixed in the rules panel, as D9 | Claude |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| A1 — C2 ships what its §7 «To C4» row lists: `resolveMonthEligibility`, `validateFairnessMonthWrite`, `contentHashOfWrite` / `contentHashOfStored`, `executeFairnessMonthWrites` with actor `reconstruction` (write and delete rows of WR-14), the read builders of RD-1 with the stored-services count, the ledger, and the A17 formatter | C4 cannot be built without a parallel writer or a second formatter | C2's spec review (C2 is reviewed before C4) | Stop; amend C2, not C4 |
| A2 — Frank sets «Mes por medio» on the cadence members (C3, inert under v2 — A8, A22) before the dry run, or lists them in the overrides file | The cadence members read as ordinary DL members in the lookback | The dry run prints how many cadence settings it found, and a loud warning on zero (R12) | Frank sets them or adds overrides; re-run the dry run |
| A3 — Today's Tipo is close to what held in Aug–Oct for most members | Wrong eligibility for someone whose Tipo changed | The «not ticked today» and «seat while out» anomalies; Frank's review | Overrides |
| A4 — Stored `unavailableDates` for Aug–Oct are still largely present | Someone shows owed for a date they had blocked | Blocked-date counts per person in the table; Frank's review | Overrides: add the blocked dates (R8), not `out` for the whole month |
| A5 — `.env.local` targets the production dataset when Frank intends it | Records land elsewhere | The target line printed before any read (R12) | Abort; fix the environment |

## Open questions (non-blocking, with defaults)

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1 — Does a seat in a **counted special** set a join month? | A camp set could start someone's line early | Yes: D14 makes it a seat of that line, and the ledger counts it. **Moot for Aug–Oct 2026**: every special there predates C1, so it is uncounted and cannot be toggled (C1 §9, A25). Live only for specials created after C1 ships whose month later becomes past | None material | Frank | No | C4 dry-run review | Yes |
| Q2 — Should a Tipo-eligible member who is not ticked in today's pool default to `out`? | Today's ticks may encode a deliberate exclusion Tipo does not | No: the rule is Tipo; the anomaly list (R13) names each case for an override | Frank reads more anomalies | Frank | No | C4 dry-run review | `"in"` + anomaly |

## Parent issues

Open:

- **PI-7 — §13 «→ C4» still reads «Aug–Oct recorded».** A21 amends §11 C4 and L6 («October 2026's
  record is applied on or after 2026-11-01»), but §13's release state for C4 is unchanged. Before
  2026-11-01 C4's exit can only be August and September; October follows as a re-run of the same
  script (C7 Step 10's table). **Recommendation:** §13 «→ C4» release state reads «Aug–Sep recorded;
  Oct on or after 2026-11-01 (A21)». Followed meanwhile: Outcome, R1, Scope.

Resolved by the amendments (text removed; IDs kept so sibling citations still resolve):
PI-1 «October before 2026-11-01» → **A21**; PI-2 «v2-confirmed months not yet past at cutover» →
**A21**; PI-3 «L3 names no delete path» → **A4**; PI-4 «seats vs never inferring eligibility» →
**A21**; PI-5 «when the cadence setting is saved» → **A22**; PI-6 «engine of a reconstructed
record» → **A4**.

### Sibling changes this spec depends on (not made here)

| Sibling | Change | Why |
|---|---|---|
| C2 | REC-1 now carries `fairnessMonth.YYYY-MM`; P1 and its «Sibling changes» row for C4/C6 («only if P1 is adopted») still read as open — close them, and state that the executor's injected read client must carry the token (fail closed, as RD-2) | Parent A2; R3, R19 |
| C2 | UI-4, §9 («two decimals on screen») and §8's examples («le deben {0.67}»): one decimal from the exact value; **export the single formatter** in §7 so C4's table and C6's panel share it | Parent A17; Interfaces 5 |
| C2 | §7's «To C4» row still offers «the stored-services-in-month count»: name the RD-1 builder that answers C2's «freezing services» predicate (WR-7 now uses it) so C4's skip and the route's gate share one definition | Parent A5; R1, D10 |
| C2 | `FairnessMonthWrite.source` admits only `"auto" \| "manual"` (WR-4) while actor `reconstruction` stamps `"reconstructed"` (WR-14): state what a reconstruction body carries in `source` (omitted, or ignored and overwritten) so `validateFairnessMonthWrite` accepts C4's transformed body (WR-4 now says «absent» for actor `reconstruction`; this row can close) | R2 — C4 never sets `source` itself |
| C2 | WR-14's «C4 PI-6» citation now resolves to A4 | PI-6 resolved |
| C2 | WR-17 still says C4 «narrows» the resolver's body by its join bounds and overrides; §7's C4 row already says «transform» — align WR-17 to «transforms» (an override may widen a cell, R8) | Interfaces 2, R8 |
| C6 | S-6 (recommends two decimals for C4's R11) is superseded: one decimal through C2's formatter (A17); EQ-5's «two decimals» likewise | Parent A17 |

## Acceptance and verification

All with fictitious data, injected fake clients, no network (R23), plus the repository's gates
(`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors).

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1 | Current/future month refused before any read; month with no weekend service and no counted special skipped; month by stored date string | Unit + CLI tests |
| R2 | No mutation method and no `fairnessMonthCommit` import in the script or its lib; every mutation in the fake log issued by the executor; no `source` set by the script | Static scan test; fake-client mutation log |
| R3 | A failed read writes no file and prints no fingerprint; a missing read token exits 2 with no client constructed; kids-only member absent; `drafts.**` ignored | Fake client that rejects / returns overlays; CLI test |
| R4–R7 | Golden table for the fictitious world: newcomer `out` before her join month per line; excluded-but-seated member `out` + anomaly; cadence member `"in"` + `alternate` for `Sun.Lead` in all months, her lines otherwise bounded; cadence + exact refusal (A11) from the rules (resolver `cadence_and_exact`; a cadence «normal» override does not clear it) and from the overrides file (validator; removing the override clears it); exact-rule mismatch listed | Golden-file test |
| R8 | Overrides win and are marked; each invalid file refuses with exit 2 before any record is built; out-of-run months listed | Table-driven tests |
| R9 | Snapshot holds only the month's dates; week exclusions only on weekend dates | Unit test |
| R10 | `source: "reconstructed"`, `engine: "v2"`, `environment: "local"`, the script's `recordedBy` marker on every planned record | Assertion on the plan and the fake write log |
| R11 | `--out`/`--overrides` inside the repo (incl. via symlink and another worktree) refused; table and preview match golden (one decimal via C2's formatter, C2's words); services listed with their «cuenta» flag; newcomer «al día» before joining; exact balances sum to zero per line per service | Path tests; golden file; ledger property check |
| R12 | No fixture name or alias on stdout/stderr in any mode | Captured-output test |
| R13 | Every anomaly type appears; each resolver refusal reason (`unresolved`, `ambiguous`, `no_tipo`, `cadence_and_exact`) refuses with exit 2 and no file written, printed by `_key` or member `_id`, never by name; cadence + exact introduced by an override refuses through the validator | Fixture cases |
| R14 | One test per decision-matrix row: planned action and executor verdict agree | Fake clients with seeded records |
| R15 | Any change after the dry run (incl. a seat that moves no join month) → `--apply` refuses, zero mutations | Fake client mutation log |
| R16 | Mid-run failure → stop, report, exit 1; next dry run plans only the rest | Fake client failing on the second write |
| R17 | Two dry runs → identical plans (time excluded); apply then dry run → zero writes | Determinism test |
| R18 | Only reconstructed + intact records deleted; backups written first; refusals listed | Fake clients |
| R19 | Missing token (either, for an apply) → exit 2, no client constructed; consent step in the runbook | CLI test; doc review |
| R20 | Audit list pins the exact entry when flagged; the write-request module's caller-pin row lists the script core and its scan covers `scripts/` | `protectedReadAudit.test.ts`; `serviceCommitCallers.test.ts` |
| R21–R22 | Runbook and ADR section present; C7 plan carries retirement | Code review of the delivery |
| Production | For each applied month: Frank's consent to the fingerprint is in the chat; the post-apply dry run reports «sin cambios»; the C2 panel preview shows the months as «reconstruido» and Frank reads the balances as correct | Manual, recorded in the worklog and the C4 PR |

## Review handoff

- Review order: after the parent, C1, C3 and **C2** (whose spec must satisfy «Interfaces → Consumes
  from C2» and the C2 rows of «Sibling changes»); before C5–C7.
- Critical tier: adversarial plan review loop, two sequential fresh `APPROVED` verdicts on unchanged
  text; review log beside this file.
- Evidence: this file's Evidence table; private `owt-agent-logs/sdd/2026-10-05-solver-v3-fairness/`
  (`evidence/u_real-data.md`, `u_history-derivation.md`, `u_config-rules.md`,
  `d_persistence-ux.md`, `d_skeptic-delivery.md`) — they contain member data and stay out of this
  repository.
- Prior planning dialogue excluded from reviewers: yes.
- A material change here that touches L2/L3/L6 or C2's interface propagates to the parent and C2.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
