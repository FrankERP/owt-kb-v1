# Availability conflicts: find them, fix drafts, propose for published services (plan)

**Status:** DRAFT, revision 3 (rewritten after two review rounds hit the churn cap; a third round
needs Frank's go-ahead). Review approval is not authorization to implement; the build
follows the release order in CLAUDE.md.

**Requirement (Frank, 2026-10-29, verbatim, thread «Resolver conflictos de disponibilidad
automáticamente»):**

> «Podemos hacer que el solver resuelva conflictos de disponibilidad de forma automática ? A veces
> mandamos el rol y las personas cambian su disponibilidad después. Me gustaría que el solver pudiera
> resolver esos conflictos de forma automática. Idealmente, que revise de forma regular, pero si no
> está bien que sea una invocación manual desde la página»

and, after the proposal doc, choosing between «propuesta con un clic», «automático en borradores,
propuesta en publicados» and «todo automático»:

> «Que los borradores se cambien en automático, pero que el solver haga una propuesta y me notifique.
> Debo de poder ver la propuesta en la app y recibir un correo en cuanto la tenga. Aunque sea un
> proceso automatizado, debo de poder correrlo cuando yo quiera»

Read as: a conflict in a DRAFT service (`published == false`) is fixed automatically; a conflict in
a PUBLISHED service gets a proposed replacement that Frank sees in the app and is emailed about as
soon as it exists, and applies himself; the check runs on its own and also on demand.

**Risk tier: critical**, from the ladder: a new production/server writer (an automated sweep that
rewrites role documents with no human in the loop, on drafts) and a new mutation trust boundary (a
member's availability save triggers that writer), which also adds one option to the guarded role edit
writer (`editRole`, §5.1). Only the writer slice (§4–§6) owns the contract; the UI (§7) consumes it.

**Out of scope:** re-running the v3 solver over a month (§3 says why); the Tony «Coro + Batería on
2026-11-01» question (another thread); a dedicated email switch for this alert (§6.3).

---

## 1. What changes for Frank

1. Someone marks a day they already serve on. Within seconds (the member's save), or within about
   half an hour (a scheduled check), or whenever Frank presses «Revisar ahora» (all three: §5.4):
   - **Draft service:** the app replaces that person in that seat with the best eligible person and
     records it. Nobody on the team is emailed (drafts send nothing, as today). Frank gets one email
     listing the change («Cambié a Tony por Ana en Coro — borrador del dom 3 ene»). Drafts exist
     between an Auto confirm and the publish; today (2026-10-29) every Nov/Dec service is published.
   - **Published service:** nothing is written to the service. The app records a proposal («Tony no
     puede el dom 29 nov (Coro). Propuesta: Ana») and emails Frank once.
   - **No eligible person:** recorded as «sin reemplazo» and emailed once; nothing is written.
2. In `/admin` › Disponibilidad › Conflictos, each conflict shows its proposal with «Aplicar»,
   «Elegir otro» (the next eligible people) and «Mantener» (Frank's deliberate keep: never proposed
   or changed again). A conflict the app could not check («sin revisar», §4.3) says so. A
   «Cambios automáticos» list shows the drafts the app changed in the last 30 days.
   «Revisar ahora» runs the whole check on demand.
3. «Aplicar» writes through `/admin`'s own role PATCH writer, so the existing notices go out exactly
   as for a hand edit: «Ya no participas» to the person removed, the assignment notice to the person
   added (published services only, as today).

## 2. Evidence (`origin/main` 8a61f9f)

- **The conflict definition already exists.** `computeAvailabilityConflicts(members, serviceDate)`
  (`app/components/admin/serviceReadiness.ts:381`): a seated member whose `unavailableDates` holds
  the exact service day. It feeds the readiness blocker `availability_conflict`
  (`publishSelection.ts:180`) and the MCP swap (`swapAssignment.ts:473`). Production today: the
  Sunday 2026-11-29 (published) carries that blocker (`list_services` 2026-11, read 2026-10-29).
  `AvailabilityPanel.tsx:125` recomputes the same thing client-side for its «Conflictos» view (next
  14 services), and proposes nothing.
- **Availability writers.** `PATCH /api/me/availability` (the member, `ifRevisionId`-guarded,
  whole-array) and `/api/kids/members/[id]/availability` (the Kids manager). Neither notifies.
- **The edit writer.** `editRole(id, parsedEditRequest, { notices })`
  (`app/utils/roleEditCommit.ts:111`) asserts the observed role `_rev`, refuses drafts overlays,
  dangling refs and lock conflicts, queues the role notices from the PRE-commit seats and
  revalidates. Callers are pinned (`serviceCommitCallers.test.ts`: the PATCH route and
  `app/mcp/tools/serviceEditor.ts`). Notices for a draft are queued and never sent: the sweep
  classifies against live state and a setlist/role notice's audience is gated on the role being
  published (`docs/NOTIFICATIONS.md` «Who hears about a setlist»; the same gate the planner's draft
  edits rely on today).
- **The saved-month judge the MCP editor uses** (ADR-0066): `loadV3PlanSources()`
  (`v3MonthPlanReads.ts:75`, roles + members + rules + snapshot, fails closed on any read),
  `storedMonthBoard({ month, adminRoles, summary, todayIso })` (one board per calendar month;
  `editable` = approved, serializable, not past), `columnTarget` / `withTarget` / `diffTargets`
  (`storedMonthBoard.ts`), `judgeTarget` (`storedJudge.ts:96`: per-added-seat pick gate C1–C4 plus
  the service's rule findings as a diff against the stored baseline), and the month check
  (`monthCheck.ts:197`, caps / pairs / presence / protections over the v3 wire; called by
  `runStoredMonthCheck`, a private function of `serviceEditor.ts:731`).
- **The automatic pick already has a definition.** `rankCandidates` (`candidateRanking.ts`) gives
  `eligible = ¬blockedReason ∧ ¬ruleBlockedReason ∧ available` — «the FILLER's composite verdict»,
  explicitly the predicate for a loop, not for the manual picker — plus `undeclared` (instrument not
  declared) and `alreadyAssigned` (holds another seat on the service). `localFill.ts` and
  `instrumentFill.ts` fill with `eligible` (and `!undeclared` for instruments), but each in its own
  order: voices by `orderByEffectiveLoad(pool, fairnessByMemberId(config, members))` (the rules'
  `exempt`/`slack` settings; «never `RankedCandidate.load`», `localFill.ts:166-205`), instruments by
  `orderForFill(pool, counts, playedPrevious)` (fewest instrument seats this month, then not on the
  previous weekend, `instrumentFill.ts:173-216`).
  The MCP editor builds the seat's `windowRoles` as `savedWindowFor(...)` minus on-board services
  plus `cellsToParticipantRoles(board.cells, board.columns, members)` (`serviceEditor.ts:824`).
- **Solver v3** assigns only `Lead | BGV | Choir` (`v3Wire.ts:13`); a stored service enters a solve
  with every seat pinned (`v3SolveRequest.ts:259`).
- **Admin email precedent.** `proposalNotify.ts:103-112`: `sendEmail` serially,
  `getAllowlist`/`isEmailAllowed`, `wantsNotification(prefs, "proposals")`; `EMAIL_REDIRECT_TO` on
  Preview (prefix `[→ address]`, as `serviceThreadNotify.ts:113-125` does). The shared
  `ADMIN_RECIPIENTS_QUERY` (`proposalNotifyQueries.ts:34`) has no ministry or `disabled` filter (#8).
- **Atomic multi-document writes.** `editRole` builds ONE `writeClient.transaction()` (role patch
  under `ifRevisionId`, lock heartbeat/claim, special coordinator) and commits it once
  (`roleEditCommit.ts:285-345`); a Content Lake conflict is `stale_revision`, any other failure
  throws. Guarded creates in this repo use `create`, never `createIfNotExists` («a concurrent creation
  must be TOLD», `setlistSaveCommit.ts:225`).
- **Cron.** Vercel Hobby allows one daily cron: `/api/cron/service-reminders` at `0 1 * * *`,
  whose outbox sweep may use up to ~60 s (`SWEEP_DEADLINE_MS` 45 s + reserve, `outboxSweep.ts:108`).
  Sub-daily triggers live in GitHub Actions: `.github/workflows/flush-notifications.yml` curls
  `$APP_BASE_URL/api/cron/flush-notifications` with `CRON_SECRET` every 5 min and asserts HTTP 200.
  `/api/cron/*` is excluded from `proxy.ts` and each route checks `CRON_SECRET`.
- **Environment.** `fairnessRecordEnvironment(process.env)` answers `production | preview | local`
  (`solverDeployment.ts`); Preview writes to the real dataset (CLAUDE.md).

## 3. Decisions

- **D1. One seat at a time, not a month re-solve.** Re-running v3 would (a) cover only voices,
  leaving instrument and FOH conflicts unsolved, (b) need a new «free this pinned seat» mode in the
  Cloud Function contract and checker, and (c) be free to move other people, each move an email after
  publishing. Replacing one seat changes exactly two people. The fairness cost is one seat, and the
  ledger counts seats from roles, so the next Auto sees it (no `fairnessMonth` write: records hold
  eligibility, not seats).
- **D2. The pick is the fillers'.** The pool for a seat = `serverPickCandidates` (`editorBoard.ts:162`:
  `rankCandidates` with the column, its Sunday spine and the rules from `columnRuleInputs`; `null`
  when one is missing → «sin revisar») on the board with the absent person removed, `windowRoles`
  built as `serviceEditor.ts:824` builds them, filtered on `eligible ∧ ¬alreadyAssigned ∧
  (instrument ⇒ ¬undeclared)` and on the worship audience (`serviceEditor.ts:831`). Ordered exactly as
  the fillers order it: a VOICE seat by `orderByEffectiveLoad(pool, fairnessByMemberId(config,
  members))` (`localFill.ts`, so Frank's `exempt`/`slack` settings hold); an INSTRUMENT seat by
  `orderForFill(pool, seatCounts(board cells), instrumentalistsOn(board cells, previous weekend
  column))` (`instrumentFill.ts`; the two helpers become exports, unchanged); an FOH seat, which no
  filler fills, in `rankCandidates`' order. `¬alreadyAssigned` is stricter than the planner's C2: an
  automatic pick never seats someone who already serves that service in any other seat. The proposal
  doc told Frank «el saldo de equidad»; the ledger only measures voice lines, so the fillers' orders
  are the ones that also cover instruments; the thread reply says so.
- **D3. Every candidate passes three gates before it is used, else the next one (at most 8 per
  seat):** (a) `judgeTarget` on the service target is `ok` with `added.length === 0` (no new rule
  finding in the service); (b) the month gate (§4.3); (c) worship-night song leads: if the absent
  person is a `songs[].leads` member of a worship night (ADR-0036; read from
  `sources.snapshot.roles` as `serviceEditor.ts`'s `songLeadLines` does), there is no pick: `none`,
  `reason: song_lead`. If no candidate passes: `none`, `reason: no_candidate`.
- **D4. Drafts auto, published propose.** A draft is `published == false` as stored
  (`coalesce(published, true)` in `adminRolesQuery`). Only services the board marks `editable`
  (approved, serializable, today or later) are touched. Past services are never read for action.
- **D5. Never twice on its own, and «Mantener» only by hand.** Conflict identity = `(roleId,
  memberId, date)`. The app changes a given identity automatically at most ONCE, ever
  (`autoApplied: true` on its record is sticky). If the person is seated there again after an
  automatic or applied fix (copying instruments, a hand pick — the picker never refuses an
  unavailable person, `pickJudge.ts:78-80`), it is a NEW conflict event: proposed (or `none`) and
  emailed, on a draft too. `kept` is set ONLY by Frank's «Mantener» and is the one status that
  silences an identity.
- **D6. Horizon.** Services dated from CDMX today through the last day of the month after next (an
  Auto plans up to two months ahead, so its drafts fall inside).
- **D7. Who triggers what.** The member's save scopes the sweep to THAT member's identities (a member
  can only cause their own removal); the table (§5.2) is applied to nothing else. The scheduled
  check and «Revisar ahora» sweep everyone. All call one function. `loadV3PlanSources` reads EVERY
  member (`adminMembersQuery(true)` binds `$all`, `ministries.ts:130`), so detection sees everyone
  seated; candidates are filtered to worship (D2).
- **D8. Reproposal on read.** The UI shows the proposal recomputed on a fresh read (the email shows
  what was true when sent). «Aplicar» re-runs D2–D3 on a fresh read for the chosen candidate and
  refuses if it no longer passes or if the role `_rev` differs from the one the screen showed.
- **D9. Only Production acts on its own.** The automatic parts — draft writes, record writes, email
  claims and sends — run only where `fairnessRecordEnvironment(process.env) === "production"`.
  Elsewhere (Preview shares the real dataset; local) the sweep runs DRY: it computes and answers its
  report, writes nothing, sends nothing. «Aplicar» and «Mantener» are a person's own click and work
  on Preview like every other admin button there.
- **D10. One transaction for a change and its record.** Every role write this feature makes carries
  its record mutation in the SAME Content Lake transaction as the role patch (§5.1), so a lost
  response, a throw or a killed function leaves both written or neither. There is no intermediate
  state to recover.

## 4. The pure core — `app/utils/availabilityConflicts.ts` (no I/O, no `"use client"` import)

### 4.1 Finding conflicts

`findBoardConflicts(board, members, todayIso)` → for each `editable` column with
`date >= todayIso`: the seated members (all five seat kinds, from `board.cells`) passed through
`computeAvailabilityConflicts`, one entry per `(roleId, memberId)` with every seat they hold there
(`{ rowId }[]`), the date and the column's `published`. `memberId` scope filter optional.

### 4.2 Proposing a replacement

`proposeReplacement({ board, roleId, memberId, members, config, windowRoles, todayIso, exclude, gate })`
→ `{ kind: "replace", target, seats: { rowId, from, to }[] } | { kind: "none", reason }`. For each
seat the member holds in that service, in board row order: remove them from the cell, build the D2
pool and order for that cell (`null` → `none`, `unchecked`), and use the first candidate that passes
D3(a) on the target built so far and `gate` (§4.3), at most 8 tried per seat. A person chosen for one
seat is `alreadyAssigned` for the next. `target = columnTarget(boardAfter, roleId, todayIso)`.
`exclude` lets «Elegir otro» skip people. Pure and deterministic for the same inputs.

### 4.3 The month gate

`monthCheck` (`monthCheck.ts:197`) gains three additive result fields from what it already builds:
`instances: BrokenInstance[]` and `missed: MissedProtection[]` (the core verdict) and `judged:
boolean` (= a ledger was given AND the request built; the existing `checked` also needs the
fair-share read, which the gate does not use). Existing callers ignore them.

The gate applies to VOICE seats only (the month check judges only voices, `monthCheck.ts:263-270`);
an instrument or FOH pick rests on D2 and D3(a), as the planner's own pick does. For a voice seat,
given the month's ONE ledger read (§5.3 step 3), it builds the month-check input exactly as
`runStoredMonthCheck` does (`serviceEditor.ts:731`: `months: [month]`, the record's entry,
`storedRoles` = the roles read minus the board's editable ones, `savedWindow` minus on-board
services) with `fairShare: null`, and runs `monthCheck` on `removedOnly` (absent person out, seat
empty) and on `withCandidate`. Reject when either is not `judged`, when `withCandidate` has an
instance key `(family, rule, scope)` or a missed key `(code, person, scope)` that `removedOnly`
lacks, or when a count instance in both has a `<=`/`==` rule and a larger `observed`. When no voice
candidate can be judged because the month cannot build (no eligibility record: the synthetic ledger
has no horizon entry, `monthCheck.ts:97-107`), the seat's answer is `none`, `reason: unchecked` —
surfaced in the UI and the email, never silent. `entryFromRecord` moves unchanged from
`serviceEditor.ts` to `app/mcp/monthProposals/storedEntries.ts`, imported by both.

## 5. The writer — `app/utils/availabilityFixCommit.ts` (`server-only`)

### 5.1 The record — `availabilityConflict` — and the one transaction

Id `availabilityConflict.<sha256(roleId|memberId|date) hex, 32 chars>` (dotted → private). Fields:
`roleId`, `memberId`, `date`, `serviceKind`, `published` (as last seen), `status`
(`proposed | none | auto | applied | kept | gone`), `seats[] { _key, rowId, from, to? }`, `reason?`
(`no_candidate | song_lead | unchecked`), `autoApplied` (boolean, sticky, D5), `eventSeq` and
`notifiedSeq` (integers), `firstSeenAt`, `updatedAt`, `appliedBy?`, `trigger`. Never deleted.

**Every record write is guarded:** a new record by `create` (a concurrent creation fails the call —
never `createIfNotExists`); an existing one by `patch(id).ifRevisionId(<rev this sweep read>)`. A
failed guard means another sweep or click got there first: this sweep drops that identity's step and
the next one re-reads.

**The change and its record commit together (D10).** `editRole` gains ONE option,
`alongside?: RecordMutation` — a `{ create: doc }` or `{ patch: { id, ifRevisionId, set } }` it
appends to the transaction it already builds (`roleEditCommit.ts:285-345`) before its single
`commit()`. Nothing else in `editRole` changes; the existing callers pass nothing and behave as
today. A conflict on the record (another sweep created or moved it) fails the whole transaction as
`stale_revision`, so the role is not written either. Outcomes: `ok` → both written; `ok: false` →
neither; a throw (a lost response, a timeout) → unknown, and the next sweep's fresh read sees either
both (the record says `auto`/`applied` and the role shows the swap) or neither (the conflict is still
there, with its old record). The function being killed after the commit is the same case.

### 5.2 Transitions

Each sweep observes, per identity in its scope, **C** = «the person is seated in that service and the
date is in their `unavailableDates`» on its fresh read, and **S** = the service exists and is
`editable`. «Pick» = `proposeReplacement` answered `replace`.

| Status now | C and S | not C, or not S |
|---|---|---|
| no record, `gone` | draft ∧ pick ∧ ¬`autoApplied` → the role edit + record `auto` in one transaction (`autoApplied: true`). Otherwise → `proposed` (pick) or `none`. **New event** either way | nothing |
| `proposed`, `none` | draft ∧ pick ∧ ¬`autoApplied` → as above (`auto`, new event). Same status → update `seats`/`reason`/`published` in place, no event. `none` ↔ `proposed` → the new status, **new event** | `gone` |
| `auto`, `applied` | the person is back: → `proposed` (pick) or `none`, **new event**; never auto (`autoApplied` stays true) | unchanged (listed 30 days) |
| `kept` | unchanged | unchanged |

`applied` is written only by «Aplicar» (§5.5) and does not count an event (Frank did it).
«New event» = `eventSeq += 1` in the same write. A sweep whose read of the ledger FAILS (a transient
read error, not an unbuildable month) leaves that month's identities untouched and logs it.

**Notification is per event:** a record is due while `notifiedSeq < eventSeq` and its status is
`auto`, `proposed` or `none`. The email step claims each due record with
`patch(id).ifRevisionId(rev).set({ notifiedSeq: eventSeq })` BEFORE sending; only claimed records go in
the email, so two concurrent sweeps never send one event twice. A send that fails after the claim is
logged (fixed tag) and not retried; the record and the UI still show it.

### 5.3 `sweepAvailabilityConflicts({ trigger, memberId?, deadlineMs, mode })`

`mode` is `"act"` only when D9 holds, else `"dry"`.

1. Read `loadV3PlanSources()`; any failed or unready source → `{ ok: false }`, nothing written. Read
   the records `*[_type == "availabilityConflict" && date >= $today]` through `operationalClient`
   (inside this module: the one reader and writer of the type).
2. One `storedMonthBoard` per horizon month (D6) that holds a conflict (`findBoardConflicts`, scoped
   to `memberId` when given) or a `proposed`/`none` record in scope. C and S per identity.
3. Per month that needs a pick: ONE `loadV3Ledger([month])`, then `proposeReplacement` with the gate.
   One service with two absent people gets one target built sequentially (§4.2) and one write.
4. Apply §5.2 per identity, earliest date first. A role edit: `parseEditRequest({ ...target, rev:
   column.rev })` FIRST (a parse failure → `none`, `reason: no_candidate`, logged as `parse` — no
   write attempted), then `editRole(roleId, parsed, { notices: "inline", alongside })`, awaited.
   No new write starts after `deadlineMs − 15 s`; what is left waits for the next sweep.
5. Email (§6) the claimed records.
6. Answer `{ ok, mode, auto, proposed, none, kept, gone, skipped }` with ids; `"dry"` answers what
   `"act"` would have done. Logs carry fixed tags and counts, never names or ids.

### 5.4 Triggers

- **The member's save.** `PATCH /api/me/availability`, after a successful commit, inside `after()`:
  the dates ADDED by this save (new minus the `current` it read). One GROQ for the services on those
  dates seating this member (the five seat paths) and one for their records; only if some (service,
  date) has no record or one in `gone`/`auto`/`applied` (D5's «back») → `sweep({ trigger: "member",
  memberId, deadlineMs: now + 50 s })`. The PATCH's contract and response are unchanged; the route
  gets `maxDuration = 60` and `withVerificationRunContext`. A sweep failure is logged, never answered.
- **The scheduled check.** A NEW route `GET /api/cron/availability-conflicts` (`CRON_SECRET`, fail
  closed as `service-reminders`, `maxDuration = 60`, `withVerificationRunContext`; `/api/cron/*` is
  already outside `proxy.ts`, `routeMatcher.test.ts` unchanged), called by a NEW GitHub Actions
  workflow `.github/workflows/availability-conflicts.yml` every 30 min (`*/30 * * * *`, own
  concurrency group, the same `CRON_SECRET`/`APP_BASE_URL` secrets and HTTP-200 assertion as
  `flush-notifications.yml`). The route first runs a cheap pre-check — the horizon's seats and the
  members' `unavailableDates` (two reads) plus the records — and opens the full sweep only when some
  identity needs a step from §5.2. Kept out of the daily Vercel cron, whose outbox sweep owns its 60 s.
  This also covers the Kids manager's availability writer and Studio edits, which have no trigger of
  their own: within ~30 min (GitHub delays scheduled runs; the member trigger and the button do not
  depend on it).
- **«Revisar ahora».** `POST /api/admin/availability-conflicts/sweep`: `requireActiveManager`, not
  `content-editor`, not `session.user.isImpersonating` (as `/api/admin/chat`); `trigger: "manual"`,
  `deadlineMs: now + 50 s`; answers the report. `maxDuration = 60`, `withVerificationRunContext`.

### 5.5 «Aplicar» / «Elegir otro» and «Mantener»

`applyAvailabilityFix({ roleId, rev, memberId, replacements, actor })`: fresh `loadV3PlanSources`;
C must hold; the column's `rev` must equal `rev` (else `409`); each chosen replacement passes D2–D3
on the fresh board (one ledger read); then `editRole(roleId, parsed, { notices: "deferred",
alongside })` with the record → `applied` (`appliedBy`, no event) in the same transaction. Refused →
the writer's status and code. Route `POST /api/admin/availability-conflicts/apply`, the sweep's
guard. «Mantener»: `POST .../keep {recordId, rev}` → `kept` under `ifRevisionId` (a record is created
first, by `create`, when the conflict has none yet). `GET /api/admin/availability-conflicts` (§7)
reads through this module too.

## 6. The email

### 6.1 Content

One email per sweep that has new events, subject «Conflictos de disponibilidad (N)». Sections:
«Cambié en borradores» (person → replacement, seat, service label), «Propuestas para servicios
publicados» (same, with «Aplicar en la app»), «Sin reemplazo» (person, seat, reason, «no se pudo
revisar» for `unchecked`). Link `${appBaseUrl()}/admin?tab=availability` (the tab param
`AdminPanel.tsx` already reads). Built with `shell`/`td`/`C` (the light email palette), labels from
`serviceLabel`.

### 6.2 Audience

A NEW query (the shared `ADMIN_RECIPIENTS_QUERY` is left alone: it has no ministry or `disabled`
filter, FrankERP/owt-kb-v1#8): `*[_type == "teamMembers" && role in ["super-admin","admin"] &&
disabled != true && <WORSHIP_AUDIENCE_GROQ_FILTER>]{ _id, email, notifPrefs }`, then an email, the
allowlist (`getAllowlist`/`isEmailAllowed`) and `wantsNotification(prefs, "proposals")` — the admins'
«Propuestas» switch, which the setlist-proposal admin email (`proposalNotify.ts:112`) honours.
Serial sends (ADR-0013). Only Production sends (D9); `EMAIL_REDIRECT_TO` is still honoured, as by
every sender, in case that ever changes.

### 6.3 Not done

No new `NotifyKind`: a dedicated switch touches the member form, `/me` and four tests for one admin
email. Follow-up if Frank wants to turn this one off alone.

## 7. UI (standard; consumes §5)

`GET /api/admin/availability-conflicts` → open conflicts with their recomputed proposal and up to 3
alternatives (D8), records `auto`/`applied` of the last 30 days, `kept`. `AvailabilityPanel`'s
«Conflictos» view renders them (house `Button`, `Menu`, hairline rows) with «Aplicar», «Elegir
otro», «Mantener» and a header «Revisar ahora». Every handler: try/catch/finally, `res.ok`, loading
reset, 409 → reload with «El servicio cambió; vuelve a revisar».

## 8. Guards and docs (same delivery)

- `roleEditCommit.ts`: the `alongside` option (§5.1) and its header line; nothing else changes.
- `serviceCommitCallers.test.ts`: `roleEditCommit` gains `app/utils/availabilityFixCommit.ts`; a new
  row `availabilityFixCommit` → the four admin routes, the availability PATCH and the new cron route.
- `__fixtures__/deliveryCapableImports.ts`: add `availabilityFixCommit`; every route importing it is
  wrapped in `withVerificationRunContext`.
- `protectedReadAudit.ts`: add `availabilityConflict` to `PROTECTED_TYPES` (dotted ids: an untokened
  read answers «nothing» with no error, the `fairnessMonth` lesson) and register
  `availabilityFixCommit.ts` in `PROTECTED_RUNTIME_WRITERS` as its one reader-writer; the test's
  writer count moves accordingly. No other module names the type.
- `instrumentFill.ts`: export `seatCounts` and `instrumentalistsOn`, unchanged.
- Studio: `sanity/schemas/availabilityConflict.ts`, read-only fields, registered with the others.
- `.github/workflows/availability-conflicts.yml` (new) and `docs/CI.md` (one line: what it calls).
- ADR-0078 «Availability conflicts are fixed one seat at a time; drafts automatically, once» (D1,
  D2, D5, D9, D10).
- `docs/NOTIFICATIONS.md` (the new admin email), `CLAUDE.md` + `project-rules.md` (the writer joins
  the admin write paths list; `editRole`'s `alongside`), `docs/UTILITIES_AND_COMPONENTS.md`.

## 9. Tests

Pure core (vitest, fixtures in the style of the MCP editor tests): conflict finding over all five
seat kinds; past and non-editable services ignored; D2 filters (unavailable, alreadyAssigned,
undeclared instrument, non-worship, C2, C4); D2 ORDER — a `slack` member ranks by `load + N`, an
`exempt` one at the median, an instrumentalist who played the previous weekend after one who did
not; `serverPickCandidates` `null` → `unchecked`; two seats of one person; two absent people in one
service; D3(a) rejects a rule finding; the month gate rejects a new cap/pair/protection and a grown
`<=` count, accepts a removal-only one, rejects when not `judged`, and is not applied to an
instrument seat; worship-night song lead → `none`.

`editRole`: with `alongside` the record mutation is in the one committed transaction; a conflict on
it returns `stale_revision` and writes no role; without it, today's tests pass unchanged.

Writer (mocked clients and deps, as the `serviceEditor` tests mock theirs): one test per cell of the
§5.2 table; `auto` then the person re-seated → `proposed`, one email, no write (D5), on a draft too;
`proposed` → date removed → `gone` → date re-added → `proposed`, one more email; `kept` stays silent;
`editRole` throws after its commit (the mocked store shows both writes) → the next sweep reads `auto`
and does nothing more; two concurrent sweeps on one new identity → one `create` wins, the other drops
(no second role write, one email); a parse failure writes nothing; a failed ledger read leaves the
month untouched; `"dry"` mode writes and sends nothing and answers what `"act"` would do; the member
scope never touches another member's record; the deadline stops new writes. Routes: 403 for
content-editor and impersonation, 409 on a stale `rev`, the cron route 403 without `CRON_SECRET`, the
availability PATCH answers the same when the sweep throws.

## 10. Rollback

A PR removing the triggers (§5.4) stops every automatic write; records are inert, and the workflow
can also be disabled from the Actions tab at once. Each auto change is a normal role edit, named in
its record (`seats.from`/`to`) and reversible by hand.

## 11. Release

Before the merge to `preview`, list the conflicts the first production sweep would act on
(read-only MCP reads) and show Frank. Today (2026-10-29) that is two published services
(2026-11-29, 2026-12-27): the first scheduled check would only PROPOSE and email him once. On dev the
sweep is dry (D9): «Revisar ahora» shows what it would do. Deploy the Studio schema with the release
(`sanity schema deploy`; the Content Lake accepts the type without it). Then the CLAUDE.md order:
gates → one code review → preview → verify alias → PR → merge → prod alias → first scheduled run
checked in the Actions log.
