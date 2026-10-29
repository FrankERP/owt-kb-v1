# Availability conflicts: find them, fix drafts, propose for published services (plan)

**Status:** DRAFT, not reviewed. Review approval is not authorization to implement; the build
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
member's availability save triggers that writer). Only the writer slice (§4–§6) owns the contract;
the UI (§7) consumes it.

**Out of scope:** re-running the v3 solver over a month (§3 says why); the Tony «Coro + Batería on
2026-11-01» question (another thread); a dedicated email switch for this alert (§6.3).

---

## 1. What changes for Frank

1. Someone marks a day they already serve on. Within seconds (the member's save), or at the latest
   the same evening (the daily cron), or whenever Frank presses «Revisar ahora» (all three: §5.3):
   - **Draft service:** the app replaces that person in that seat with the best eligible person and
     records it. Nobody on the team is emailed (drafts send nothing, as today). Frank gets one email
     listing the change («Cambié a Tony por Ana en Coro — borrador del dom 3 ene»). Drafts exist
     between an Auto confirm and the publish; today (2026-10-29) every Nov/Dec service is published.
   - **Published service:** nothing is written to the service. The app records a proposal («Tony no
     puede el dom 29 nov (Coro). Propuesta: Ana») and emails Frank once.
   - **No eligible person:** recorded as «sin reemplazo» and emailed once; nothing is written.
2. In `/admin` › Disponibilidad › Conflictos, each conflict shows its proposal with «Aplicar»,
   «Elegir otro» (the next eligible people) and «Mantener» (a deliberate keep: never proposed or
   changed again). A conflict the app could not check («sin revisar», §5.2 step 3) says so. A
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
  `instrumentFill.ts` fill with `eligible` (and `!undeclared` for instruments), ordered by `load`.
  The MCP editor builds the seat's `windowRoles` as `savedWindowFor(...)` minus on-board services
  plus `cellsToParticipantRoles(board.cells, board.columns, members)` (`serviceEditor.ts:824`).
- **Solver v3** assigns only `Lead | BGV | Choir` (`v3Wire.ts:13`); a stored service enters a solve
  with every seat pinned (`v3SolveRequest.ts:259`).
- **Admin email precedent.** `serviceThreadNotify.ts:102` and `proposalNotify.ts`: `sendEmail`
  serially, `getAllowlist`/`isEmailAllowed`, `wantsNotification(prefs, "proposals")`,
  `EMAIL_REDIRECT_TO` on Preview (prefix `[→ address]`). Admin audience `ADMIN_RECIPIENTS_QUERY`
  (`proposalNotifyQueries.ts:34`).
- **Cron.** Vercel Hobby allows one daily cron: `/api/cron/service-reminders` at `0 1 * * *`
  (19:00 CDMX), `maxDuration = 60`, `CRON_SECRET`-gated, excluded from `proxy.ts`. The 5-minute
  trigger lives in GitHub Actions for the outbox only (`.github/workflows/flush-notifications.yml`).

## 3. Decisions

- **D1. One seat at a time, not a month re-solve.** Re-running v3 would (a) cover only voices,
  leaving instrument and FOH conflicts unsolved, (b) need a new «free this pinned seat» mode in the
  Cloud Function contract and checker, and (c) be free to move other people, each move an email after
  publishing. Replacing one seat changes exactly two people. The fairness cost is one seat, and the
  ledger counts seats from roles, so the next Auto sees it (no `fairnessMonth` write: records hold
  eligibility, not seats).
- **D2. The pick is the filler's.** Candidates = `serverPickCandidates` (`editorBoard.ts:162`,
  which runs `rankCandidates` with the column, its Sunday spine and the rules from
  `columnRuleInputs`, and answers `null` rather than judge with one missing → «sin revisar») for that
  seat on the board with the absent person removed, with `windowRoles` built as
  `serviceEditor.ts:824` builds them, filtered on `eligible ∧ ¬alreadyAssigned ∧ (instrument ⇒ ¬undeclared)`
  and on the worship audience (as the MCP editor filters, `serviceEditor.ts:831`), in `rankCandidates`'
  own order (rank, then `load`, then name). `¬alreadyAssigned` is stricter than the planner's C2: an
  automatic pick never seats someone who already serves that service in any other seat. The proposal
  doc told Frank «el saldo de equidad»; the ledger only measures voice lines, so D2 is the one order
  that also covers instruments and FOH, and the same one «Llenar especiales» uses. The thread reply
  says so.
- **D3. Every candidate passes three gates before it is used, else the next one (at most 8):**
  (a) `judgeTarget` on the service target is `ok` with `added.length === 0` (no new rule finding in
  the service); (b) the month check (§4.3) shows no rule instance or missed protection that the
  REMOVAL alone did not already cause; (c) worship-night song leads: if the absent person is a
  `songs[].leads` member of a worship night (ADR-0036; read from `sources.snapshot.roles` as
  `serviceEditor.ts`'s `songLeadLines` does), the conflict is never auto-applied and never
  proposed («sin reemplazo: dirige canciones»). If no candidate passes: «sin reemplazo».
- **D4. Drafts auto, published propose.** A draft is `published == false` as stored
  (`coalesce(published, true)` in `adminRolesQuery`). Only services the board marks `editable`
  (approved, serializable, today or later) are touched. Past services are never read for action.
- **D5. Auto at most once per conflict.** Conflict identity = `(roleId, memberId, date)`. If the
  same identity reappears after the app (or an «Aplicar») removed that person, someone put them back
  on purpose: the conflict becomes `kept` (no write, no proposal, no email), shown as «Mantenido».
  The full lifecycle is the table in §5.1: `auto`, `applied` and `kept` are never ended by the
  person's absence, so this rule always has its record to read.
- **D6. Horizon.** Services dated from CDMX today through the last day of the month after next (an
  Auto plans up to two months ahead, so its drafts fall inside). One board per month; months without
  a conflict or an open record are not opened.
- **D7. Who triggers what.** The member's save scopes the sweep to THAT member (a member can only
  cause their own removal). Only members in the worship pool (`adminMembersQuery`'s
  `WORSHIP_MEMBER_GROQ_FILTER`) are seen; a seated person outside it is not detected, as in today's
  readiness blocker, which reads the same pool. The cron and «Revisar ahora» sweep everyone. All three call one function.
- **D8. Reproposal on read.** The UI shows the proposal recomputed on a fresh read (the email shows
  what was true when sent). «Aplicar» re-runs D2–D3 on a fresh read for the chosen candidate and
  refuses if it no longer passes or if the role `_rev` differs from the one the screen showed.

## 4. The pure core — `app/utils/availabilityConflicts.ts` (no I/O, no `"use client"` import)

### 4.1 Finding conflicts

`findBoardConflicts(board, members, todayIso)` → for each `editable` column with
`date >= todayIso`: the seated members (all five seat kinds, from `board.cells`) passed through
`computeAvailabilityConflicts`, one entry per `(roleId, memberId)` with every seat they hold there
(`{ rowId }[]`), the date and the column's `published`. `memberId` scope filter optional.

### 4.2 Proposing a replacement

`proposeReplacement({ board, roleId, memberId, members, config, windowRoles, todayIso, exclude, gate })`
→ `{ kind: "replace", target, seats: { rowId, from, to }[] } | { kind: "none", reason }`. For each
seat the member holds in that service, in board row order: remove them from the cell, take
`serverPickCandidates` for that cell (D2; `null` → `none`, `unchecked`), and use the first candidate
that passes D2's filters, D3(a) on the target built so far and the month gate `gate` (§4.3) —
at most 8 tried per seat. A person chosen for one seat is `alreadyAssigned` for the next.
`target = columnTarget(boardAfter, roleId, todayIso)`. `exclude` lets «Elegir otro» skip people.
Deterministic for the same inputs.

### 4.3 The month gate

`monthCheck` (`monthCheck.ts:197`) gains three additive result fields, computed from what it already
builds: `instances: BrokenInstance[]`, `missed: MissedProtection[]` (the core verdict) and
`judged: boolean` (= the ledger was given AND the request built; the existing `checked` also needs the
fair-share read, which the gate does not use). Existing callers ignore them.

The gate is pure: given the month's ONE ledger read (§5.2 step 3), it builds the month-check input
exactly as `runStoredMonthCheck` does (`serviceEditor.ts:731`: `months: [month]`, the record's entry,
`storedRoles` = the roles read minus the board's editable ones, `savedWindow` minus on-board
services) with `fairShare: null`, and calls `monthCheck` twice: `removedOnly` (absent person out,
seat empty) and `withCandidate`. Reject when either is not `judged` («sin revisar»), when
`withCandidate` has an instance key `(family, rule, scope)` or a missed key `(code, person, scope)`
that `removedOnly` lacks, or when a count instance in both has a `<=`/`==` rule and a larger
`observed`. `entryFromRecord` moves unchanged from `serviceEditor.ts` to
`app/mcp/monthProposals/storedEntries.ts`, imported by both. A month with no eligibility record
cannot build (the synthetic ledger has no horizon entry, `monthCheck.ts:97–107`), so every pick there
is `none`/`unchecked` — surfaced, never silent (§5.2 step 3). The month check judges only voice
seats; instrument and FOH picks rest on D2 and D3(a), as the planner's own pick does.

## 5. The writer — `app/utils/availabilityFixCommit.ts` (`server-only`)

### 5.1 The record — `availabilityConflict`, and its transitions

Id `availabilityConflict.<sha256(roleId|memberId|date) hex, 32 chars>` (dotted → private). Fields:
`roleId`, `memberId`, `date`, `serviceKind`, `published` (as last seen), `status`, `seats[] { _key,
rowId, from, to? }`, `baseRev?` (the role `_rev` a `pending` write asserted), `reason?`
(`no_candidate | song_lead | unchecked | write_refused`), `refusedCode?`, `eventSeq` (integer), `notifiedSeq` (integer), `firstSeenAt`,
`updatedAt`, `appliedBy?`, `trigger`. Never deleted by this slice.

Each sweep observes, per identity, **C** = «the person is seated in that service and that date is in
their `unavailableDates`» on its fresh read (§5.2 step 1), and **S** = the service still exists and is
`editable`. Every write to a record is `ifRevisionId` on the revision this sweep read (created with
`createIfNotExists`); a lost race drops that record's step for this sweep, never retried in-sweep.

| Status now | C and S | Not C, or not S |
|---|---|---|
| (no record) or `gone` | draft with a pick → `pending` + the write (§5.2 step 4; its event is counted when it becomes `auto`); published, or no pick → `proposed` or `none`, **new event** (`eventSeq += 1`) | nothing |
| `pending` | resolve by the stored seats (below) | resolve by the stored seats |
| `proposed`, `none` | recompute. Same status → update `seats`/`reason`/`published` in place (no new event). `none` ↔ `proposed` → the new status, **new event** (a proposal that now exists is news). The service became a draft and has a pick → as (no record): `pending` + the write | `gone` |
| `auto`, `applied` | someone seated the person again on purpose → `kept` (no write, no event) | unchanged (terminal; listed 30 days) |
| `kept` | unchanged (no write, no event) | unchanged |

**Resolving `pending`** reads the stored role as this sweep's fresh read shows it: if every `from`
is absent from its row and every `to` is seated in its row → `auto` (**new event**; the `pending`
step did not count one). Else if not C or not S (the person left the service some other way, or it is
gone) → `gone`. Else, if the attempt recorded a known refusal other than `stale_revision`
(`refusedCode`, §5.2 step 4) → `none` with `reason: write_refused` (**new event**: the writer will
keep refusing, so Frank must look). Else (stale, thrown, unknown) → a fresh attempt in this sweep, as
(no record). So a write whose outcome is unknown — a lost response, a thrown commit, a function killed
after the commit — is settled by the next sweep from what is stored, and the change is never left
without its record.

**Notification is per event:** a record needs an email while `notifiedSeq < eventSeq` and its status
is `auto`, `proposed` or `none`. The email step claims it by `patch(id).ifRevisionId(rev).set({
notifiedSeq: eventSeq })` BEFORE sending; only claimed records go in the email. A send that fails after
the claim is logged (fixed tag) and not retried; the UI still shows the event.

### 5.2 `sweepAvailabilityConflicts({ trigger, memberId?, deadlineMs })`

1. Read `loadV3PlanSources()`; any failed or unready source → `{ ok: false }`, write nothing. Read
   the records `*[_type == "availabilityConflict" && date >= $today]` through `operationalClient`.
2. Horizon (D6): one `storedMonthBoard` per month that holds a conflict or a non-terminal record.
   `findBoardConflicts` (scoped to `memberId` when given) gives C per identity; S from the board.
   Then the table above, per identity.
3. Per month that needs a pick: read the ledger ONCE (`loadV3Ledger([month])`). A failed READ is
   transient: that month's identities are left exactly as they are (no record written, no event,
   logged) and the next sweep retries. A month that reads but cannot be judged (no eligibility record,
   §4.3) is structural: its picks are `none` with `reason: unchecked`, an event, so Frank hears it.
   `proposeReplacement` + the month gate (§4.3) over that one ledger. One service with two absent
   people gets one target built sequentially (§4.2).
4. **Draft with a replacement:** write the record `pending` (`seats`, `baseRev = column.rev`) FIRST;
   if that write fails, do not touch the role. Then `parseEditRequest({ ...target, rev: column.rev })`
   → `editRole(roleId, parsed, { notices: "inline" })`, awaited. `ok` → record `auto` (new event)
   in this sweep. Refused (`ok: false`) → patch the `pending` record's `refusedCode` with the
   writer's code; thrown → leave it as is. Either way the next sweep resolves it (§5.1).
   No new write STARTS after `deadlineMs − 15 s`.
5. **Published with a replacement:** record `proposed` (no role write). **No replacement:** `none`.
6. Email (§6) the claimed records. Return `{ ok, auto, proposed, none, kept, gone, pending }` by id.
   Logs carry fixed tags and counts, never names or ids.

### 5.3 Triggers

- `PATCH /api/me/availability`: after a successful commit, inside `after()`: the dates ADDED by this
  save (new minus the `current` it read) → one GROQ for the future services seating this member on
  those dates (`assignedMemberRefsQuery`-style over the five seats) and one for their records. Only if
  some (service, date) has no record or a `gone` one → `sweep({ trigger: "member", memberId,
  deadlineMs: now + 50 s })`. The PATCH's contract and response are unchanged; the route gets
  `maxDuration = 60` and the `withVerificationRunContext` wrapper (it now reaches a delivery-capable
  module). A sweep failure is logged and never reaches the response.
- `/api/cron/service-reminders`: after `sweepOutbox`, in its own try,
  `sweep({ trigger: "cron", deadlineMs: routeStart + 55 s })`.
- `POST /api/admin/availability-conflicts/sweep`: `requireActiveManager`, not `content-editor`, not
  `session.user.isImpersonating` (as `/api/admin/chat`); `trigger: "manual"`, `deadlineMs: now + 50 s`;
  answers the report. `maxDuration = 60`, `withVerificationRunContext`.
- Not triggered: the Kids manager's availability writer and Studio edits. Their conflicts are found by
  the 19:00 cron or «Revisar ahora» — not «en cuanto», and the thread reply says so.

### 5.4 `applyAvailabilityFix({ roleId, rev, memberId, replacements, actor })` and «Mantener»

«Aplicar»/«Elegir otro»: fresh `loadV3PlanSources`; C must hold; the column's `rev` must equal `rev`
(else `409 stale`); each chosen replacement passes D2–D3 on the fresh board with one ledger read;
then record `pending` (as §5.2 step 4) and `editRole(roleId, parsed, { notices: "deferred" })` (as
the PATCH route); `ok` → `applied` with `appliedBy` (no email: Frank did it); refused → `409`/`400`
with the writer's code, record left `pending` for the sweep to settle. Route `POST
/api/admin/availability-conflicts/apply`, same guard as the sweep. «Mantener»: `POST .../keep` →
record `kept` (`ifRevisionId`, no role write).

## 6. The email

### 6.1 Content

One email per sweep that has new events, subject «Conflictos de disponibilidad (N)». Sections:
«Cambié en borradores» (person → replacement, seat, service label), «Propuestas para servicios
publicados» (same, with «Aplicar en la app»), «Sin reemplazo» (person, seat, reason). Link
`${appBaseUrl()}/admin?tab=availability` (the tab param `AdminPanel.tsx` already reads). Built with `shell`/`td`/`C` (the light email palette),
labels from `serviceLabel`.

### 6.2 Audience

A NEW query (the shared `ADMIN_RECIPIENTS_QUERY` is left alone: it has no ministry or `disabled`
filter, FrankERP/owt-kb-v1#8): `*[_type == "teamMembers" && role in ["super-admin","admin"] &&
disabled != true && <WORSHIP_AUDIENCE_GROQ_FILTER>]{ _id, email, notifPrefs }`, then an email, the
allowlist (`getAllowlist`/`isEmailAllowed`) and `wantsNotification(prefs, "proposals")` — the admins'
«Propuestas» switch, which the setlist-proposal admin email (`proposalNotify.ts:112`) honours.
Serial sends (ADR-0013). Preview: `EMAIL_REDIRECT_TO` with the `[→ address]` subject prefix.

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

- `serviceCommitCallers.test.ts`: `roleEditCommit` gains `app/utils/availabilityFixCommit.ts`; a new
  row `availabilityFixCommit` → the three admin routes, the availability PATCH and the cron route.
- `__fixtures__/deliveryCapableImports.ts`: add `availabilityFixCommit`; the four routes that import
  it wrap their handlers in `withVerificationRunContext` (the cron route already does).
- `protectedReadAudit.ts`: add `availabilityConflict` to `PROTECTED_TYPES` (dotted ids: an untokened
  read answers «nothing» with no error, the `fairnessMonth` lesson) and register
  `availabilityFixCommit.ts` in `PROTECTED_RUNTIME_WRITERS` as its one writer; the test's writer count
  moves accordingly.
- `routeMatcher` unchanged (`/api/admin/*` stays behind `proxy.ts`).
- Studio: `sanity/schemas/availabilityConflict.ts`, read-only fields, registered with the others.
- ADR-0078 «Availability conflicts are fixed one seat at a time; drafts automatically» (D1, D2, D5,
  the `pending` protocol).
- `docs/NOTIFICATIONS.md` (the new admin email), `CLAUDE.md` + `project-rules.md` (the writer joins
  the admin write paths list), `docs/UTILITIES_AND_COMPONENTS.md`.

## 9. Tests

Pure core (vitest, fixtures in the style of the MCP editor tests): conflict finding over all five
seat kinds; past and non-editable services ignored; D2 filters (unavailable, alreadyAssigned,
undeclared instrument, non-worship, C2, C4) and order; `serverPickCandidates` `null` → unchecked; two
seats of one person; two absent people in one service; D3(a) rejects a rule finding; the month gate
rejects a new cap/pair/protection and a grown `<=` count, accepts a removal-only one, and rejects all
when not `judged`; worship-night song lead → none.

Writer (mocked clients and deps, as the `serviceEditor` tests mock theirs), one test per row of the
§5.1 table, plus: draft → `pending` written BEFORE `editRole`, `editRole` once with the column rev
and `inline`; `editRole` throws after committing (the stored role shows the change) → the next sweep
marks `auto` and emails once; `editRole` refuses `integrity_conflict` → next sweep `none`
/`write_refused`, one email; `stale_revision` → next sweep re-attempts; `auto` then the admin
re-seats the person → `kept`, no write, no email; `proposed` → date removed → `gone` → date added
again → `proposed`, one more email; a `pending` write that fails → no `editRole`; failed sources →
nothing written; two concurrent sweeps on one event → one email (claim); the member scope never
touches another member; the deadline stops new writes. Routes: 403 for content-editor and
impersonation, 409 on a stale `rev`, the availability PATCH answers the same with the sweep throwing.

## 10. Rollback

A PR reverting the triggers (§5.3) stops every automatic write; records are inert. Each auto change
is a normal role edit, named in its record (`seats.from`/`to`) and reversible by hand.

## 11. Release

Before merging to `main`: list the conflicts the first production sweep would act on (read-only MCP
reads) and show Frank. Today (2026-10-29) that is two published services (2026-11-29, 2026-12-27):
the first cron would only PROPOSE, and email him once. Deploy the Studio schema with the release
(`sanity schema deploy`; the Content Lake itself accepts the type without it). Then the CLAUDE.md
order: gates → one code review → preview → verify alias → PR → merge → prod alias.
