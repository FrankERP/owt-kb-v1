# Spec C4: reconstructing the fairness records of past months (solver v3)

## Status

`DRAFT` · **Risk tier: CRITICAL** — it writes production data: `fairnessMonth` documents in the
production dataset that every later v3 solve, the «Equidad» panel and the DL floor read as the truth
about who was eligible in a past month. A wrong record silently creates or erases debt for real
people for three months. The parent's §11 table assigns this tier («production data»); CLAUDE.md
puts any production Sanity write behind a dry run and Frank's explicit consent.

Child **C4** of the approved parent
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (§6 L6; §11 row
C4; §13 «→ C4»). The parent wins on every conflict; where this spec found a defect or gap in it, the
section «Parent issues» says so and this spec follows the parent meanwhile.

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
  writer existed (Aug, Sep, Oct 2026 first; then every month confirmed under v2 before cutover) gets
  a `fairnessMonth` record with `source: "reconstructed"`, written **through C2's commit module**,
  after Frank has read a per-person table of exactly what will be written and what balances it
  implies, and consented to that table.
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
| Tipo decides pool fit: `voz` plus the pool subtype. v2 dedupes pools Sunday > Saturday > support. v2's role sets: Sun.Lead ← Sunday pool; Sat.Lead ← Sunday ∪ Saturday pools; Sun.BGV, Sat.BGV, Sun.Choir ← every pool | `app/components/admin/plannerModel.ts:805-811`, `:873-879`; `gcf/owt_solver_v2.py:642-648` | «Tipo today applied backward» is expressible as hypothetical pool ticks; the pool → role mapping belongs to C2's eligibility resolver (RES-1), not to this script |
| An earlier reconstruction attempt that marked everyone eligible from the first stored month showed two late joiners owed large, false debts and two Saturday-only singers owed Sundays; bounding each person by the first month they served fixed it | `evidence/d_persistence-ux.md` §0 («Why inference must be reviewed») | A join bound is required, and the result is reviewed per person, with balances, before any write |
| Raw served counts with no eligibility denominator read occasional leads as owed Sundays | ADR-0046 (`docs/adr/0046-auto-sends-no-fairness-history.md`) | Never infer eligibility from seats served (parent L6, §10) |
| The fixed-count lead's exact rule exists in today's config, but stored seats show months in which that person held fewer Sunday leads than the rule's value; no rule's start date is recoverable | `evidence/u_real-data.md` (b), (d) | Today's exact rules applied backward can be wrong for early months: every mismatch must be listed, and correctable by Frank |
| The cadence members' Sunday rhythm was managed by ticking and unticking pools; the stored seats only partly show it | `evidence/u_real-data.md` (c) | Their DL eligibility cannot be inferred from seats; the cadence **setting** is applied instead (parent F7, L4) |
| `unavailableDates` lives on the member, is written wholesale, past dates are never pruned automatically but a member may delete them, with no change log | `sanity/schemas/worshipTeam.ts:222-228`; `evidence/u_history-derivation.md` §3 | The availability snapshot is «as stored at reconstruction time», and the table says so |
| Every existing `*Commit.ts` module imports `server-only` and the server `writeClient`; a pure, `server-only`-free module is how a route and an `--apply` script share one validator | `app/utils/roleSwapCommit.ts:39-41`; `app/utils/solverConfigWriteRequest.ts:1-6`; `scripts/seed-solver-config.ts` header («npx tsx rather than bare node») | C2 must expose a neutral half the script can import; the script runs under `tsx` |
| Scripts that import `app/utils/*.ts` must run under `npx tsx --env-file=.env.local`; bare `node` fails at import with `ERR_MODULE_NOT_FOUND` | `scripts/requeue-role-notices.mjs:18-27`; `docs/NOTIFICATIONS.md:662` | Runtime decided below (Decision D1) |
| Production write scripts: dry run by default; read token for the dry run, write token for `--apply`; each document written under `ifRevisionId` of the revision read; a failed write may have landed, so re-run the dry run before any repair; `process.exitCode`, never `process.exit()` | `scripts/migrate-proposal-messages.mjs:41-47`, `:162-167`, `:194-200`, `:207-209` | The write protocol follows these, plus a plan binding (R15) |
| An operator script that holds member names refuses every input/output path inside the repository, any of its working trees, before reading or writing a file | `scripts/lib/solverHistoryDiffRun.ts:386-395`, `:221` | Same refusal for `--out` and `--overrides` |
| The protected-read audit is a static scan; operator scripts that read protected role types are listed by exact `file#module` with a reason and removal owner; the test pins the list and forbids globs | `app/utils/protectedReadAudit.ts:360-430`; `app/utils/__tests__/protectedReadAudit.test.ts:354-361`, `:491-504` | The script gets an exact `OPERATOR_TOOLING_ALLOWLIST` entry |
| The commit-module caller pin scans **`app/` only** | `app/utils/__tests__/serviceCommitCallers.test.ts:16` | A script caller of C2's writer is invisible to that pin as written (R20) |
| The weekend range read exists, deliberately unfiltered on `published`; there is no specials-in-range read | `app/utils/serviceReadQueries.ts:380-397` | The script reads through the same builders C2's ledger reader uses (C2 adds the specials read) |
| Worship membership: absent or empty `ministries` means worship | `app/ministries.ts:74-75` | Kids-only members never enter a record |
| The dry-run (read) and `--apply` (write) halves of `scripts/` are already covered by `SANITY_API_READ_TOKEN` and `SANITY_WRITE_TOKEN`, both in local `.env.local` | `docs/SECRETS.md:274-296` | No new secret or env var; no `docs/SECRETS.md` entry needed |
| Parent L3: «past» means before the current CDMX month; past months are written only by the reconstruction; the reconstruction may replace a record it wrote itself, under a revision check | parent §6 L3 | Month scope (R1) and the replace rule (R13) |

## Interfaces

C4 owns no data shape. It **consumes** C1's field, C2's record, writer and ledger, and C3's cadence
setting, and **provides** reconstructed records and an operator CLI. Where C2's or C3's spec names a
thing differently, their name wins; the capability listed here must exist, or C4 cannot be built.

### Consumes from C1

- `countsForFairness` (boolean) on `sunday_role`, `saturday_role`, `special_role`, read as
  `coalesce(countsForFairness, _type != "special_role")` (parent L1). Used for: which seats count
  toward a join month (R5) and the balance preview (R11). An uncounted service creates neither share
  nor received seats.

### Consumes from C2

1. **The record**, `_type: "fairnessMonth"` (C2 REC-1–REC-6), with the `_id` C2's REC-1 defines —
   currently `fairnessMonth-YYYY-MM` per the parent; C2's issue P1 proposes the dotted
   `fairnessMonth.YYYY-MM`. C4 never constructs the id (R2) and reads records by `month` through
   C2's builders, so it is indifferent to P1's outcome. C4 relies on these facts about its shape
   (parent L2), in C2's §7 types `RoleKey` (`"Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" |
   "Sun.Choir" | "Sat.Choir"`), `Status` (`"in" | "out" | "exact"`) and `LogicalRecord`:
   - `month`: `"YYYY-MM"`;
   - `source`: `"auto" | "manual" | "reconstructed"`, the last reserved for this script (C2 WR-14);
   - `contentHash`: deterministic over the record's **eligibility content only** (no timestamps,
     writer stamps, `_rev`, `_key`s or display names — C2 REC-6), **recomputable from the stored
     document** by an exported function, so «edited after reconstruction» is detectable as
     `recompute ≠ stored`;
   - per person (`people[]`, one item per member, `_key` derived from a hash of the member `_id`,
     never a raw id — REC-3): `roles`, a `Status` for each of the six role keys; `exactRules[]`
     `{ roles: RoleKey[], count }` (a role is `"exact"` iff exactly one rule covers it; `count` is
     resolved for the month, 1–31); `sundayCadence: "alternate"` or absent (= normal); `exempt`
     (boolean); `blocks[]` `{ date, unavailable, excludedRoles: RoleKey[] }`, one per date inside
     the month — the availability snapshot; a display `name` stored only as text;
   - `presence[]` as C2 REC-4 defines it (C4 passes it through from C2's resolver unchanged);
   - the stamps of C2 REC-2 — for this script's records: `engine: "v2"` and
     `environment: "local"`, as C2's Interfaces row for C4 states (R10).
2. **C2's neutral write-request module** (WR-8, WR-14; no `server-only`, no module-level client;
   the Sanity client is injected; C2 leaves its filename to its plan, precedent
   `app/utils/solverConfigWriteRequest.ts:1-6`), importable from a `tsx` script. It is **not**
   `app/utils/fairnessMonthCommit.ts`, which imports `server-only` and whose only caller is the
   route (C2 WR-1); the script never imports that file. C4 consumes from it:
   - the **eligibility resolver** `resolveMonthEligibility({ month, config, members })` (C2 §7,
     RES-1–RES-7) → `{ ok: true, body }` or `{ ok: false, issues }`, which applies today's
     restriction semantics (exclusions → `"out"`, `==` → `"exact"` with the month's count, «Exenta»
     → `exempt`, week exclusions and `unavailableDates` → `blocks[]`, the C3 cadence field →
     `sundayCadence`) — the same resolver «Registrar» and Auto's confirm use. C4 calls it with a
     `config` whose three pools are R4's hypothetical ticks and whose restrictions are today's;
     R5–R8 then only **narrow** the returned body (a role to `"out"`, an `exactRules` entry, an added
     `blocks[]` date, a cadence or `exempt` override), and the narrowed body is re-validated by the
     module's own validation (WR-4's limits and REC-3's consistency) before it is planned — so a
     reconstructed record cannot differ in shape from a live one;
   - the **`contentHash`** function;
   - a **guarded write in reconstruction mode** (C2's actor `reconstruction`, WR-14): create with a
     plain `create` (an `_id` collision is a refusal, never a silent loss); replace **only** when
     the stored record has `source: "reconstructed"` and an intact hash, under
     `ifRevisionId(<revision the caller names>)`; anything else refused with a machine-readable
     reason. C2's WR-14 today states the decision on `source` and `_rev` only, not the intact-hash
     check nor the mutation executor with an injected client — required C2 amendments (A1);
   - a **guarded delete in reconstruction mode** with the same three conditions (Parent issue
     PI-3; C2 does not yet provide it — WR-13 says only that the *app* never deletes records);
   - the **«stored services in month»** predicate the writer re-checks at write time (L3).
3. **`app/utils/fairnessLedger.ts`** (pure, neutral): the role → line map (F1, D14:
   `Sun.Lead`→`DL`, `Sat.Lead`→`SL`, `Sun.BGV`/`Sat.BGV`→`BGV`, Chorus→`CORO`, a counted special's
   Lead by weekday) and the balance computation (F2–F6) over in-memory records, role documents and
   members, in hundredths, positive = owed, each figure rounded once (C2 LG-13).
4. **The read builders** C2's ledger reader uses (neutral, in `serviceReadQueries.ts` or C2's own
   module): weekend **and special** role documents in a date range, every published state, canonical
   documents only; worship members with `memberType`, `ministries`, `unavailableDates`; the
   `fairnessMonth` records for a list of months; the `solverConfig` document. The script never
   writes its own GROQ for these.
5. **The display rule** of C2's panel (UI-4, §8): figures are the ledger's hundredths shown with
   **two decimals** in `es-MX`, never rounded a second time, and the saldo always in C2's words —
   «le deben {0.67}» / «{0.33} de más» / «al día» (0.00). If C2's implementation exports the
   formatter, the table uses it rather than a copy.

### Consumes from C3

- `solverConfig.restrictions[].sundayCadence?: "alternate"` (absent = «Normal»), keyed by the
  restriction's `person` name like every rule (C3 spec §7, item 1).
- C3's neutral resolver module `app/utils/sundayCadence.ts` (no `server-only`, no I/O; C3 spec §7,
  item 4): `cadenceMembers(config, roster) → { ids, refusals }` for the cadence setting, and
  `resolveRulePersonId(person, roster)` (exactly one match, else `unresolved` / `ambiguous`) for
  every other restriction the record applies (exclusions, `==`, «Exenta», week exclusions). The
  roster is the **unfiltered worship roster**, never a `voz`-filtered list or a pool. A non-empty
  `refusals`, or any restriction that does not resolve to exactly one member, refuses the run
  (parent L4; C3's obligation on C2's writer applies to this writer too).
- C3's guarantee that saving «Mes por medio» changes nothing v2 does (C3 spec §7, item 7) — the
  reason Frank can set it before C4's dry run (A2).

### Provides

- **To C2's reader, C5's requests and C6's panel (as data):** `fairnessMonth` records with
  `source: "reconstructed"` for the months Frank approved, each strictly before the CDMX month in
  which it was written. Nothing else is written, ever.
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
| **R1** | **Months.** The run covers exactly the `--months` list, oldest first. Every listed month must be **strictly before the current CDMX month** (today = `new Date().toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`), otherwise the whole run refuses (exit 2) before any read. A listed month with no stored services (weekend or special, any published state, by the C2 predicate) is skipped and reported «sin servicios guardados: no se reconstruye». A service belongs to the month of its stored `YYYY-MM-DD` (`week` for weekend roles, `date` for specials), never through a `Date` | Parent L3 («past» = before the current CDMX month; past months are written only by the reconstruction); a record for a month nobody served is meaningless; CDMX dates invariant | A run naming the current month refuses; one naming an empty month skips it; a 31-Oct Saturday counts in October |
| **R2** | **One writer.** Every create, replace and delete goes through C2's neutral write-request module (Interfaces 2). The script contains no Sanity mutation call of its own, never imports `app/utils/fairnessMonthCommit.ts` (C2 WR-1: its only caller is the route), and never hand-builds a record, an `_id`, a `_key` or a hash | Parent L6 «through C2's commit module (never a parallel writer)»; ADR-0043 | A static test finds no mutation method and no import of `fairnessMonthCommit` in the script or its `scripts/lib` modules; the records are byte-identical in shape to ones C2's module makes from the same body |
| **R3** | **Reads.** Canonical documents only (`drafts.**` excluded); every published state; through C2's read builders. Members: worship only (`ministries` absent, empty or containing `worship`); `disabled` does not matter (it removes app access, not schedulability). Any failed or malformed read aborts the run (exit 1) **before** any table or plan is written — never a partial table | A half-read table would be reviewed as if it were whole | A rejected read writes no file and prints no plan fingerprint |

### Inference (what each record says)

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R4** | **Base eligibility = Tipo today, as hypothetical pool ticks.** For every reconstructed month, the pool ticks in the `config` handed to C2's `resolveMonthEligibility` are: every worship member whose **current** Tipo fits the pool subtype (`voz` + `sunday_lead` / `saturday_lead` / `support`; C2's RES-1 does no cross-pool de-duplication, and none changes a status). C2's resolver then applies **today's** `solverConfig` restrictions (exclusions, `==`, «Exenta», week exclusions) and C3's cadence settings. A member with no Tipo, or `voz` alone, fits no pool and is `"out"` everywhere | The task's rule «Tipo today applied backward»; ADR-0029 (Tipo is the only eligibility axis); one resolver for live and reconstructed records | The fictitious fixture's statuses equal C2's resolver output for those ticks, before R5–R7 |
| **R5** | **Join bound per line — seats may only narrow.** For each person and line (`DL`, `SL`, `BGV`, `CORO`, by C2's role → line map), the **join month** is the calendar month of that person's earliest seat that counts to that line, over every stored counted service on record (any published state, all months, counted specials mapped by D14); a seat in an **uncounted** service never sets a join month. In every reconstructed month **before** the join month, every role of that line is `out` (reason «antes de su primer servicio en esta línea»). A person with no counted seat in a line is `out` for that line in every reconstructed month. A seat never makes anyone eligible: a seat held by someone whom R4 makes `out` stays `out` and is listed as an anomaly | Parent L6 and §10 forbid inferring eligibility from seats; the evidence shows that ignoring join months invents debt. Bounding the start is not granting. Per line, because the parent's DL floor starts each line at its first recorded eligibility (F10) | A fixture member first seated on BGV in September is `"out"` for BGV in August and `"in"` from September; a fixture member whom today's rules exclude from Saturday, but who held a Saturday seat, stays `out` and appears in the anomalies |
| **R6** | **Cadence members: setting applied, never inferred.** A person whose cadence setting is «Mes por medio» (from `solverConfig` via C3, or from the overrides file, R8) is recorded with `sundayCadence: "alternate"` in every reconstructed month, and her `Sun.Lead` status is **not** join-bounded: it is `"in"` in every reconstructed month where Tipo and today's rules allow it. Her `SL`, `BGV`, `CORO` lines follow R4–R5 like anyone's. The record stores the setting, never an on/off state (F7). A setting on someone whose `Sun.Lead` status is not `"in"` is not recorded and is listed as an anomaly | Parent F7, L2, L4; the stored seats cannot show the rhythm (evidence); without the setting, the cadence members would read as ordinary DL members in the lookback — the ADR-0046 false «owed» reborn | Fixture: a cadence member with a single Sunday in the window is `"in"` + `alternate` for `Sun.Lead` in all reconstructed months; her Sundays are set aside by C2's ledger (no DL debt in the preview) |
| **R7** | **Exact rules applied backward, mismatches surfaced.** Today's `==` rules apply in every reconstructed month from the line's join month (R5). For every month in which the seats the person actually held in that role differ from the rule's value, the table lists the mismatch as an anomaly («regla fija = N, tuvo M») so Frank can override it (R8) | No rule's start date is recoverable (evidence); a rule applied to months before it existed misstates them | A fixture member with `Sun.BGV == 1` who held 0 in one month produces exactly that anomaly line |
| **R8** | **Overrides — Frank's corrections.** An optional JSON file **outside the repository**, keyed by member `_id`, with a schema version. Per member it may set: a role status (`"in"` / `"out"`) or an exact rule in C2's shape (`{ roles: RoleKey[], count }`, making those roles `"exact"`) for one month or for every month of the run; `exempt`; the cadence setting («alternate» or «normal»); a join month per line (replacing the seat-derived one, earlier or later); **blocked dates** added to the month's `blocks[]` (all roles → `unavailable: true`, or named roles → `excludedRoles`), for a member who joined mid-month or who deleted a past unavailable date; a free-text note (printed in the private table, **never written to Sanity**). An override wins over every inferred value. The file is validated in full **before** any record is built: an unknown member `_id`, an unknown key or value, a malformed month, or a status or exact rule that C2's validation would refuse (WR-4, REC-3: a role covered by more than one rule, a count outside 1–31) makes the whole run refuse (exit 2). Entries for valid months outside `--months` are listed «no aplica a esta corrida» and ignored. Every overridden cell is marked in the table | Parent L6 («never overwrites a record Frank edited» — corrections are made here, then re-run); fail closed on typos | Each refusal case has a test; an overridden cell shows «corregido» in the table and in the planned record |
| **R9** | **Availability.** Each person's availability snapshot for the month is the member's stored `unavailableDates` falling in that month **as read at reconstruction time**, plus today's week exclusions resolved to that month's dates by C2's resolver (RES-4, as `blocks[].excludedRoles`), plus any blocked dates the overrides file adds (R8). Join bounds are monthly (R5); a join inside a month is expressed as blocked dates before the first seat, through the overrides file, so a mid-month newcomer accrues no share for weekends before she joined. The table header states «disponibilidad: lo guardado hoy, no lo que había entonces» | Parent L2 snapshots availability; past dates may have been deleted with no trail (evidence) | Fixture dates outside the month never enter it; a seat held on a blocked date is listed as an anomaly |
| **R10** | **Record stamps.** Every record the script writes carries C2's REC-2 stamps with: `source: "reconstructed"`; `engine: "v2"` (C2's Interfaces row for C4: «v2 for v2-solved months» — every month C4 targets was planned under v2, Outcome); `environment: "local"` (REC-2 derives it from `VERCEL_ENV`, unset in a local run — so it is never a Preview write, L3); `recordedBy` = the script's own marker (REC-2), never a fabricated member id | The panel's «reconstruido» chip and the replace rule (R14) both read `source` | Asserted on the planned records in the dry-run test |

### Review output

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R11** | **The per-person table, in Spanish, in a private file.** `--out` is required and is refused (exit 2, before any read) if it resolves — symlinks followed — inside the repository or any of its working trees; same for `--overrides`. The dry run writes there: (a) the **table** (Markdown); (b) the **plan** (JSON, R15). The table has, per month, one row per member in the record: name; per role the status, rendered `elegible` / `fuera` / `fija N` for `"in"` / `"out"` / `"exact"`, with its reason code and a «corregido» mark; join month per line; seats held that month per line (reference only); blocked dates in the month; «Exenta»; «Mes por medio». Then a **balance preview**: for the `--preview-run` month, each person's 3-month carried balance per line (`DL`, `SL`, `BGV`, `CORO`, presence sub-lines folded into BGV, Total = sum) computed by C2's `fairnessLedger.ts` over the **planned** records plus any existing records in that window, in hundredths rounded once (C2 LG-13) and shown exactly as the panel shows them (Interfaces 5: two decimals in `es-MX`, no second rounding, C2's words «le deben {0.67}» / «{0.33} de más» / «al día»). Then the **anomalies** (R13's list). Rows are sorted deterministically (month, then display name with `es` collation, then `_id`) | Frank reviews outcomes, not just inputs: the earlier failure was visible only as balances (evidence). Names stay out of the repository | The fictitious fixture's table matches a golden file; a newcomer shows «al día» before her join month |
| **R12** | **Stdout carries no member name.** Stdout prints: the resolved target (project · dataset · «DRY-RUN» / «APPLY» / «ROLLBACK») **before any read**; per month the planned action (R13) and counts (people, `in`/`out`/`exact` cells, overrides applied, anomalies); the plan fingerprint; the paths of the two private files | stdout reaches terminals, transcripts and logs; the private file is the only place names go | A test runs the fixture end to end and asserts no fixture name or alias appears on stdout or stderr |
| **R13** | **Anomalies are listed, never auto-resolved.** At least: a seat held by someone `out` for that role; a seat on a date in that person's blocked dates; a join month whose first seat is **not** on that month's first counted service of the line (the person may have joined mid-month: R8's blocked-date override is the fix); an `exact` value ≠ seats held (R7); a cadence setting on someone not `"in"` for `Sun.Lead` (R6); a Tipo-eligible member **not ticked in today's pool** (the inference may overstate them); a dangling seat reference; two documents of one type on one date; a restriction name that does not resolve to exactly one member (this one is a refusal, exit 2, printed by restriction `_key` and reason, never by name, and no table or plan is written) | Inference is lossy (evidence); Frank decides each case through the overrides file | Each anomaly type has a fixture case and appears in the table |

### Decision per month

Computed in the dry run, and re-checked by C2's writer at write time:

| Existing record for the month | Planned action | Table / stdout label |
|---|---|---|
| none, month has stored services | **create** (plain `create`; an `_id` collision at write time refuses that month) | «crear» |
| none, month has no stored services | skip | «sin servicios guardados» |
| `source: "reconstructed"`, hash intact, planned `contentHash` equal | **no-op** | «sin cambios» |
| `source: "reconstructed"`, hash intact, planned hash differs | **replace** under `ifRevisionId(<rev read in the dry run>)`; the table shows the per-person diff | «reemplazar» |
| `source: "reconstructed"`, hash **not** intact | refuse | «editado después de reconstruir: no se toca» |
| any other `source` | refuse | «no lo escribió la reconstrucción: no se toca» |

### Write protocol

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R14** | **Decision per month.** Each requested month gets exactly one action from «Decision per month» above; no other action exists | Parent L3, L6; d_skeptic-delivery H2 (a losing `createIfNotExists` writer gets silent success) | One test per row of the matrix |
| **R15** | **Consent attaches to bytes: the plan binding.** The dry run writes a plan file holding, per month: the action, the full planned record, its `contentHash`, and the existing record's `_rev`, `source` and stored hash (or «none»); plus a **fingerprint** over all of it. `--apply --plan <file>` re-derives everything from live data and the same overrides, and **refuses the whole run, writing nothing** (exit 2), if any planned hash, any existing `_rev`, or the fingerprint differs from the file. It then writes **only** the plan's create/replace actions | Frank consents to the table he read; a seat swap, a member edit or an overrides edit between the dry run and the apply must send him back to the table, not slip past it — the same discipline as CLAUDE.md's «auto-merge approves a COMMIT» | Mutating one seat, one `unavailableDates`, one override or one record `_rev` after the dry run makes `--apply` refuse with zero writes (fake client records no mutation) |
| **R16** | **Sequencing and partial failure.** Writes go month by month, oldest first, one guarded mutation per month (records are independent documents; no cross-record invariant needs one transaction). On the first failure the run stops, reports which months landed and which did not, and exits 1. The report says, as `scripts/migrate-proposal-messages.mjs:194-200` does: a failed write may have landed — **run the dry run again before any repair**; landed months then read «sin cambios» | A stop is safer than continuing past an unknown state; idempotency (R17) makes the re-run the repair | Fixture: the second month's write fails → first month landed, third not attempted, exit 1; a fresh dry run plans only the missing months |
| **R17** | **Idempotent.** Re-running the dry run after a successful apply plans zero writes («sin cambios» everywhere); re-applying an unchanged plan writes nothing. The planned records and the table are a deterministic function of the inputs (no clock, no randomness in content; the generation time is printed but excluded from every hash) | Parent L6 re-runs per month; the review must be reproducible | Two dry runs over the same inputs produce byte-identical plan files except the printed time |
| **R18** | **Rollback = delete only what it wrote.** `--rollback --months …` plans the deletion of each month's record **only** if it has `source: "reconstructed"` and an intact hash; any other record is refused and listed. Before planning, the full content of each record to delete is saved to the private `--out` directory. `--rollback --apply --plan <file>` is bound like R15 and deletes through C2's guarded delete under `ifRevisionId`. After a rollback, those months read «sin registro, no cuenta» (F3) | Parent §11 C4 rollback («Delete reconstructed records (dry-run first, consent)»); a record Frank or a v3 writer produced is not this script's to delete | Fixture: a reconstructed intact record is planned for deletion; a `source: "manual"` one and an edited one are refused; the backup file exists before the plan is written |
| **R19** | **Consent and runtime.** `--apply` and `--rollback --apply` run only after Frank's explicit consent in chat to **that plan file's fingerprint**, once per run (diagnosing ≠ consent; a consent never carries to a second plan). The script runs as `npx tsx --env-file=.env.local scripts/reconstruct-fairness-months.mjs …` (D1). It checks for its token **before constructing any client**: `SANITY_API_READ_TOKEN` for dry runs, `SANITY_WRITE_TOKEN` for applies. It introduces no environment variable | CLAUDE.md production-write rule; the script cannot verify consent itself, so the procedure is part of the contract | The plan's runbook (R21) states the consent step; a missing token exits 2 with no client constructed |

### Guards, docs, retirement

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| **R20** | **Visible to the guards.** (a) **Whenever the audit's scan flags the script or its `scripts/lib` core**, the flagged file is listed in `OPERATOR_TOOLING_ALLOWLIST` by exact `file#module` with a reason (reads protected role types and members' availability; writes only `fairnessMonth` through C2's module; dry run by default; `--apply` bound to a reviewed plan) and a `removalOwner` (R22), and `protectedReadAudit.test.ts`'s pinned list gains it — never a directory or glob. If the scan does not flag it (all reads through C2's builders), no entry is added: the suite refuses an unused exemption (`protectedReadAudit.test.ts:531-536`). The C4 plan proves which case holds. (b) The script never imports `fairnessMonthCommit.ts`, whose only caller is the route (C2 WR-1). Whatever pin covers the importers of C2's write-request module lists the script; because `serviceCommitCallers.test.ts` scans `app/` only (`:16`), that pin must reach `scripts/` for this module (the C4 plan decides how) | A new writer of production data must not be invisible to the audit or the caller pin | Both tests fail if the entry is removed or a second script imports the write-request module's reconstruction actor; a static test fails if the script imports `fairnessMonthCommit` |
| **R21** | **Docs in the same delivery.** `docs/SOLVER_AND_INFRA.md` (the `scripts/` toolbox section) gains a runbook: purpose, inputs, the consent step, the dry run → review → apply → second dry run sequence, rollback, the private paths, and the rule «names never enter the repository». The inference rules (R4–R9) are recorded in the fairness-record ADR (created by C2; C4 adds its reconstruction section), because they reject real alternatives (seats as eligibility; starting the ledger empty; everyone eligible from April). No `docs/SECRETS.md` change: the two tokens already cover both halves (`docs/SECRETS.md:274-296`) | CLAUDE.md «keep documentation current»; ADR bar | Docs reviewed in the C4 code review |
| **R22** | **Retirement.** Once C7 records that the last v2-confirmed month is reconstructed and the cutover's rollback window is closed, the script becomes a retired writer (`assertRetiredWriter` as its first statement, moved to `RETIRED_ONE_SHOT_WRITERS`). Owner: C7's checklist. Until then it stays live, because rollback needs it | Precedent `protectedReadAudit.ts:293-307`; an orphan production writer is a standing risk | C7's plan carries the step |
| **R23** | **The dry-run test, fictitious data.** A vitest suite drives the script's pure core and its CLI wiring with an **injected fake Sanity client** and a fictitious world (four to six people, three past months, weekend and special services, drafts, one cadence member, one exact rule, one presence pair, one newcomer, one excluded-but-seated member, blocked dates, one existing reconstructed record, one manual record, one edited record). It never touches Sanity, the network or `.env.local` | Precedent `scripts/__tests__/migrateProposalMessages.test.ts` (the one-shot writer is never executed; its rules are asserted) | See «Acceptance and verification» |

## Scope

### In scope

- `scripts/reconstruct-fairness-months.mjs` and its pure core under `scripts/lib/`.
- Its test suite (R23), its audit entry (R20), its runbook and ADR section (R21).
- Applying, **with Frank's consent**, the records for Aug, Sep and Oct 2026 (each once it is a past
  month, R1 and PI-1).

### Non-goals

- The record's shape, the writer's other modes (Auto confirm, «Registrar»), the ledger formula, the
  panel — C2.
- The cadence setting's storage and UI — C3. The toggle — C1.
- Running the re-runs for v2-confirmed months at cutover — C7 runs this script; C4 only provides it.
- Inferring eligibility from seats served (parent §10), or recovering past pool ticks from Sanity's
  document history (it starts 2026-09-29).
- Any write to role documents, members, or `solverConfig`.
- Writing the current or a future month (R1; those belong to the v3 writers, L3).
- Reconstructing months before the first stored service (April 2026 holds one service; it is only
  reconstructed if Frank lists it).

## Behavior and invariants

- **Required behaviour:** R1–R23.
- **Preserved:** CDMX dates (service month = stored date string); `saturdarSongs` untouched; the five
  member seats are read through C2's builders; canonical documents only; `_key` on every array item
  (minted by C2's module); no `revalidate*` call is needed (no ISR page reads `fairnessMonth`, and
  the script changes no content a page renders); v2 behaviour unchanged (records are inert under v2,
  parent §13).
- **Data:** the only documents this script can create, replace or delete are `fairnessMonth`
  records it wrote, of past months, through C2's module. It reads members' availability, which is
  why its outputs are private.
- **Security/privacy:** no member name in the repository, on stdout, or in Sanity beyond the
  display-name text C2's record stores; private files only under a path outside every working tree.
- **Interaction with the policy:** the DL join months this script records are the start of each
  pre-cutover member's DL line, so they decide where the DL floor's look-back begins (F10); the
  cadence setting it records makes the cadence members' Sundays set-asides in those months (F5, F7);
  a month it skips stays «sin registro, no cuenta» (F3).
- **Failure and recovery:** a failed read → nothing written, exit 1; a refused input → nothing
  read or written, exit 2; a partial apply → stop, report, re-run the dry run (R16); a bad record
  discovered later → correct the overrides file and re-run (replace, R14), or roll back (R18).

## Decisions

| ID | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Runtime | `npx tsx --env-file=.env.local`, keeping the `.mjs` name | It must import C2's TypeScript modules; bare `node` cannot resolve their extensionless imports (`scripts/requeue-role-notices.mjs:18-27`, `scripts/seed-solver-config.ts` header). The task text's «node --env-file» yields to that evidence | One more tool in the command line | Claude |
| D2 | Month scope | Strictly past months only; current/future refused | Parent L3 | October 2026 cannot be applied before 2026-11-01 (PI-1) | Parent |
| D3 | Join granularity | Per line (DL, SL, BGV, CORO) | The task's rule; F10 starts each line at its first record | A member who only ever sang Choir is `out` for BGV until she first holds a BGV seat — conservative (no debt), correctable by override | Claude |
| D4 | Cadence members' DL | Not join-bounded; setting applied | The task's rule; L6 forbids seat inference; their Sundays are set-asides anyway (F5, F7) | Relies on the setting being present (A2) | Claude |
| D5 | Where names go | Private table file only; stdout name-free | Public repository; transcripts and logs | Frank must open a file to review | Claude |
| D6 | Apply binding | Re-derive and refuse on any difference from the reviewed plan | Consent attaches to what was read | Any concurrent edit forces a new review | Claude |
| D7 | Write granularity | One guarded write per month, stop on first failure | Records are independent; idempotent re-run is the repair | A crash leaves some months recorded — visible, recoverable | Claude |
| D8 | Overrides identity | Member `_id` | Names change and collide; the record is keyed by id | Frank copies ids from the table | Claude |
| D9 | Unresolvable restriction name | Refuse the run | Parent L4; applying half a rule set would misstate someone silently | A stale rule blocks reconstruction until fixed in the rules panel | Parent |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| A1 — C2 ships the neutral write-request module with the resolver, the reconstruction write/delete modes (including the intact-hash check and the injected-client executor, not yet stated in C2's WR-14), a recomputable `contentHash`, the ledger and the read builders (Interfaces) | C4 cannot be built without a parallel writer | C2's spec review (C2 is reviewed before C4) | Stop; amend C2, not C4 |
| A2 — Frank sets «Mes por medio» on the cadence members (C3, inert under v2, U7) before the dry run, or lists them in the overrides file | The cadence members read as ordinary DL members in the lookback | The dry run prints how many cadence settings it found, and a loud warning on zero | Frank sets them or adds overrides; re-run the dry run |
| A3 — Today's Tipo is close to what held in Aug–Oct for most members | Wrong eligibility for someone whose Tipo changed | The «not ticked today» and «seat while out» anomalies; Frank's review | Overrides |
| A4 — Stored `unavailableDates` for Aug–Oct are still largely present | Someone shows owed for a date they had blocked | Blocked-date counts per person in the table; Frank's review | Overrides: add the blocked dates (R8), not `out` for the whole month |
| A5 — `.env.local` targets the production dataset when Frank intends it | Records land elsewhere | The target line printed before any read (R12) | Abort; fix the environment |

## Open questions (non-blocking, with defaults)

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1 — Does a seat in a **counted special** set a join month? | A camp set could start someone's line early | Yes: D14 makes it a seat of that line, and the ledger counts it | None material: specials default to uncounted (D14), so only toggled-on ones matter | Frank | No | C4 dry-run review | Yes |
| Q2 — Should a Tipo-eligible member who is not ticked in today's pool default to `out`? | Today's ticks may encode a deliberate exclusion Tipo does not | No: the task's rule is Tipo; the anomaly list (R13) names each case for an override | Frank reads more anomalies | Frank | No | C4 dry-run review | `"in"` + anomaly |
| Q3 — Engine value on reconstructed records (PI-6) — **closed**: C2's Interfaces row for C4 sets `engine: "v2"` for v2-solved months (REC-2's `engine: "v2" \| "v3"`); R10 follows it | — | — | — | C2 | No | Resolved in C2's spec | `"v2"` |

## Parent issues

- **PI-1 — «Aug–Oct 2026 first» vs L3's «past».** L3 defines past as «before the current CDMX
  month» and C4 writes only past months, so October 2026 can be reconstructed only from 2026-11-01.
  Today is 2026-10-05; the sequence (C0/C1/C3 → C2 → C4) likely lands C4 in November anyway.
  **Recommendation:** add to §11 row C4 «October applied on or after 2026-11-01»; do not widen L3.
  Followed meanwhile: R1.
- **PI-2 — v2-confirmed months that are not yet past at cutover.** L6 says the script is re-run
  «for every month confirmed under v2 before cutover», but such a month may be the current or a
  future month on cutover day. The first v3 run planning next month has the current month in its
  lookback, and C4 cannot write it. **Recommendation:** C7's checklist lists every v2-confirmed month
  and reconstructs each as soon as it becomes past; for the current month, «Registrar elegibilidad»
  under v3 (C2) is the writer, or the month reads «sin registro» (F3) and the panel says so.
- **PI-3 — L3 names no delete path.** §11 gives C4 «delete reconstructed records» as rollback, but
  L3 defines only create/replace, and «never a parallel writer» covers deletes too.
  **Recommendation:** L3 adds «and the reconstruction may delete a record it wrote itself, under the
  same checks», implemented in C2's module. Followed meanwhile: Interfaces 2, R18.
- **PI-4 — «never infers eligibility from seats served» vs the join bound.** The join bound reads
  seats. **Recommendation:** L6 reads «seats served may only delay the start of a line (its join
  month); they never make anyone eligible». Followed meanwhile: R5.
- **PI-5 — When the cadence setting is set.** §11 C7 puts «move the cadence members into the Sunday
  pool with «Mes por medio»» in the flip step, but C4 runs earlier and needs the setting (A2). U7,
  L4 and C3's v2-view guarantee (C3 spec §7, item 7) make it editable and inert under v2, so this is
  a wording gap, not a conflict. **Recommendation:** the C7 row says the setting may be saved before
  C4's dry run; the one-step flip concerns the pools and the constant. Followed meanwhile: A2 and
  the overrides file (R8) cover either order.
- **PI-6 — «The engine that wrote it» (L2) is undefined for a reconstructed record.** Filled at
  child level: C2's Interfaces row for C4 sets `engine: "v2"` for v2-solved months (Q3 closed, R10).
  **Recommendation:** the parent's L2 may adopt that wording; nothing in C4 waits on it.

## Acceptance and verification

All with fictitious data, an injected fake client, no network (R23), plus the repository's gates
(`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors).

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1 | Current/future month refused before any read; empty month skipped; month by stored date string | Unit + CLI tests |
| R2 | No mutation method and no `fairnessMonthCommit` import in the script or its lib; planned records equal C2's module output for the same body | Static scan test; equality test against C2's module |
| R3 | A failed read writes no file and prints no fingerprint; kids-only member absent; `drafts.**` ignored | Fake client that rejects / returns overlays |
| R4–R7 | Golden table for the fictitious world: newcomer `out` before her join month per line; excluded-but-seated member `out` + anomaly; cadence member `"in"` + `alternate` for `Sun.Lead` in all months, her lines otherwise bounded; exact-rule mismatch listed | Golden-file test |
| R8 | Overrides win and are marked; each invalid file refuses with exit 2 before any record is built; out-of-run months listed | Table-driven tests |
| R9 | Snapshot holds only the month's dates; seat on a blocked date listed | Unit test |
| R10 | `source: "reconstructed"`, `engine: "v2"`, `environment: "local"`, the script's `recordedBy` marker on every planned record | Assertion on the plan |
| R11 | `--out`/`--overrides` inside the repo (incl. via symlink and another worktree) refused; table and preview match golden (two decimals, C2's words); newcomer «al día» before joining; balances sum to zero per line per service | Path tests; golden file; ledger property check |
| R12 | No fixture name or alias on stdout/stderr in any mode | Captured-output test |
| R13 | Every anomaly type appears; unresolvable restriction name refuses, printed by `_key` | Fixture cases |
| R14 | One test per decision-matrix row | Fake client with seeded records |
| R15 | Any change after the dry run → `--apply` refuses, zero mutations | Fake client mutation log |
| R16 | Mid-run failure → stop, report, exit 1; next dry run plans only the rest | Fake client failing on the second write |
| R17 | Two dry runs → identical plans (time excluded); apply then dry run → zero writes | Determinism test |
| R18 | Only reconstructed + intact records deleted; backups written first; refusals listed | Fake client |
| R19 | Missing token → exit 2, no client constructed; consent step in the runbook | CLI test; doc review |
| R20 | Audit list pins the exact entry; the caller pin includes the script | `protectedReadAudit.test.ts`; caller-pin test |
| R21–R22 | Runbook and ADR section present; C7 plan carries retirement | Code review of the delivery |
| Production | For each applied month: Frank's consent to the fingerprint is in the chat; the post-apply dry run reports «sin cambios»; the C2 panel preview shows the months as «reconstruido» and Frank reads the balances as correct | Manual, recorded in the worklog and the C4 PR |

## Review handoff

- Review order: after the parent, C1, C3 and **C2** (whose spec must satisfy «Interfaces → Consumes
  from C2»); before C5–C7.
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
