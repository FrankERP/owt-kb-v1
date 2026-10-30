# Availability conflicts: find them, propose a replacement, apply with one click (plan)

**Status:** APPROVED at revision 10 (digest `78d5fa24…`, commit 0cc5dae; two consecutive fresh approvals, rounds 10–11 — see the review log beside this plan). §12 lists the changes made after that approval, which are NOT reviewed. PROPOSALS ONLY. Revisions 1–7 (seven review rounds) planned an
automatic writer for drafts; every round from 5 to 7 found a defect in how automatic draft writes and
proposals share one sweep. Frank chose (2026-10-30 13:54Z, decision card «Solo propuestas por
ahora») to drop the automatic writes: the sweep never changes a service, drafts included. This
revision starts a new review cycle on that simpler design (Frank: «revisa ese plan más simple y
construye»). Review approval is not authorization to deploy; the build follows the release order in
CLAUDE.md.

**Requirement (Frank, 2026-10-29, verbatim, thread «Resolver conflictos de disponibilidad
automáticamente»):**

> «Podemos hacer que el solver resuelva conflictos de disponibilidad de forma automática ? A veces
> mandamos el rol y las personas cambian su disponibilidad después. Me gustaría que el solver pudiera
> resolver esos conflictos de forma automática. Idealmente, que revise de forma regular, pero si no
> está bien que sea una invocación manual desde la página»

then, after the proposal doc:

> «Que los borradores se cambien en automático, pero que el solver haga una propuesta y me notifique.
> Debo de poder ver la propuesta en la app y recibir un correo en cuanto la tenga. Aunque sea un
> proceso automatizado, debo de poder correrlo cuando yo quiera»

and, on 2026-10-30, choosing «Solo propuestas por ahora»: «Nunca cambia servicios solo; propone, te
avisa por correo y aplicas con un clic». Automatic draft changes are deferred until the proposals
prove good (a later plan).

Read as: a conflict in ANY service (draft or published) gets a proposed replacement that Frank sees
in the app and is emailed about as soon as it exists; he applies it with one click; the check runs on
its own and also on demand; nothing changes a service without a person's click.

**Risk tier: critical**, from the ladder: a new production/server writer (an automated sweep that
writes its own `availabilityConflict` records and sends an admin email, triggered by a member's
availability save — a mutation trust boundary) and a new admin write path into role documents
(«Aplicar», through the unchanged `editRole`). The sweep itself writes no role document. Only the
writer slice (§4–§6) owns the contract; the UI (§7) consumes it.

**Out of scope:** any automatic role write (deferred, see above); re-running the v3 solver over a
month (§3 D1); the Tony «Coro + Batería on 2026-11-01» question (another thread); a dedicated email
switch for this alert (§6.3).

---

## 1. What changes for Frank

1. Someone marks a day they already serve on. Within seconds (the member's save), or within about
   15 minutes (the scheduled check, which rides the email flush's 5-minute Cloud Scheduler tick), or
   whenever Frank presses «Revisar ahora» (all three: §5.4), the app records a proposal («Tony no
   puede el dom 29 nov (Coro). Propuesta: Ana») — or «sin reemplazo» when nobody passes — and emails
   Frank once. The service is NOT changed, draft or published.
2. In `/admin` › Disponibilidad › Conflictos, each conflict shows its proposal (recomputed on a fresh
   read) with «Aplicar», «Elegir otro» (the next eligible people) and «Mantener» (Frank's deliberate
   keep: not proposed or emailed again while that conflict lasts; if the person later clears the date
   and marks it again, that is a new conflict and Frank hears about it). A conflict the app could not check («sin revisar», §4.3)
   says so. «Revisar ahora» runs the whole check on demand. Conflicts applied in the last 30 days are
   listed below.
3. «Aplicar» writes through `/admin`'s own role edit writer, so the existing notices go out exactly as
   for a hand edit: on a published service «Ya no participas» to the person removed and the
   assignment notice to the person added; on a draft nothing, as today.

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
  dangling refs and lock conflicts, queues the role notices from the PRE-commit seats, commits ONE
  transaction (`roleEditCommit.ts:285-345`; a Content Lake conflict is `stale_revision`, any other
  failure throws) and revalidates. Callers are pinned (`serviceCommitCallers.test.ts`: the PATCH
  route and `app/mcp/tools/serviceEditor.ts`). A draft edit sends nothing: the queue and the push are
  null for an unpublished role (`serviceMutationSideEffects.ts:345, 522-582`; `outboxClassify.ts:73`;
  `docs/NOTIFICATIONS.md` «Who hears about a setlist»). This plan does NOT change `editRole`.
- **The saved-month judge the MCP editor uses** (ADR-0066): `loadV3PlanSources()`
  (`v3MonthPlanReads.ts:75`, roles + members + rules + snapshot, fails closed on any read),
  `storedMonthBoard({ month, adminRoles, summary, todayIso })` (one board per calendar month;
  `editable` = approved, serializable, not past; `coherent` false on any raw Studio draft or a rev
  skew, `storedRoleReadModel.ts:263-305`), `columnTarget` / `withTarget` / `diffTargets`
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
  previous weekend, `instrumentFill.ts:173-216`). The MCP editor builds the seat's `windowRoles` as
  `savedWindowFor(...)` minus on-board services plus `cellsToParticipantRoles(board.cells,
  board.columns, members)` (`serviceEditor.ts:824`).
- **Solver v3** assigns only `Lead | BGV | Choir` (`v3Wire.ts:13`); a stored service enters a solve
  with every seat pinned (`v3SolveRequest.ts:259`).
- **Admin email precedent.** `proposalNotify.ts:103-112`: `sendEmail` serially,
  `getAllowlist`/`isEmailAllowed`, `wantsNotification(prefs, "proposals")`; `EMAIL_REDIRECT_TO` on
  Preview (prefix `[→ address]`, as `serviceThreadNotify.ts:113-125` does). The shared
  `ADMIN_RECIPIENTS_QUERY` (`proposalNotifyQueries.ts:34`) has no ministry or `disabled` filter (#8).
- **Guarded creates** in this repo use `create`, never `createIfNotExists` («a concurrent creation
  must be TOLD», `setlistSaveCommit.ts:225`).
- **Cron.** Vercel Hobby allows one daily cron (`/api/cron/service-reminders`, `0 1 * * *`). The
  sub-daily trigger is a Google Cloud Scheduler job (`flush-notification-outbox`, every 5 min,
  `CRON_SECRET` header, 90 s deadline, no retries) calling `/api/cron/flush-notifications`
  (`maxDuration = 60`, a drain loop of at most `DRAIN_BUDGET_MS` 55 s that usually ends at once on an
  empty outbox), ADR-0032. The GitHub Actions `schedule` it replaced was measured at a 3.3% delivery
  rate and stays only as a rarely-firing backup caller of the same route. The flush's silence is
  alarmed by the daily cron (`reportOutboxLiveness`). A second Scheduler job would need `CRON_SECRET`
  copied out of the first, which `docs/SECRETS.md` forbids («rotate, never copy»). `/api/cron/*` is
  excluded from `proxy.ts` and each route checks `CRON_SECRET`.
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
  (instrument ⇒ ¬undeclared)` and on the worship audience (`serviceEditor.ts:831`). Ordered as
  the fillers order it: a VOICE seat by `orderByEffectiveLoad(pool, fairnessByMemberId(config,
  members))` (`localFill.ts`, so Frank's `exempt`/`slack` settings hold) — the local filler's order,
  which today fills only specials; weekend voices are filled by v3, which a one-seat pick cannot call
  (D1), so for a weekend voice this is a deliberate choice of the closest local order, not parity
  with v3; an INSTRUMENT seat by
  `orderForFill(pool, seatCounts(board cells), instrumentalistsOn(board cells, previous weekend
  column))` (`instrumentFill.ts`; the two helpers become exports, unchanged) — only on the rows and
  columns `fillInstruments` itself fills (a canonical-label instrument row, `instrumentFill.ts:146-148`,
  on a weekend column); any other instrument seat, and every FOH seat, which no filler fills, in
  `rankCandidates`' order. `¬alreadyAssigned` is stricter than the planner's C2: a proposal never
  names someone who already serves that service in any other seat. The proposal doc told Frank «el
  saldo de equidad»; the ledger only measures voice lines, so the fillers' orders are the ones that
  also cover instruments; the thread reply says so.
- **D3. Every candidate passes four gates before it is proposed, else the next one (at most 8 per
  seat):** (0) a WEEKEND VOICE seat only: the candidate is on that month's v3 eligibility for the
  role (`request.people[p].eligibility[service]` in the request the gate already builds, §4.3), so a
  proposal never names someone the solver could not have seated (the month check itself does not
  test it, `monthCheckCore.ts:14-17`); (a) `judgeTarget` on the service target is `ok` with
  `added.length === 0` (no new rule finding in the service); (b) the month gate (§4.3); (c)
  worship-night song leads: if the absent person is a `songs[].leads` member of a worship night
  (ADR-0036; read from `sources.snapshot.roles` as `serviceEditor.ts`'s `songLeadLines` does), there
  is no pick: `none`, `reason: song_lead`. If no candidate passes: `none`, `reason: no_candidate`.
- **D4. Drafts and published alike: propose, never write.** The sweep writes only its own records
  and sends only the admin email. The one role write is «Aplicar» (§5.5), a person's click. Only
  services the board marks `editable` (approved, serializable) AND dated today or later (CDMX) get a
  pick — `editable` itself does not test the date (`storedMonthBoard.ts:66-69`), so the sweep and
  «Aplicar» both check `date >= today` themselves; past services are never read for action.
- **D5. Each judgement is independent, and «Aplicar» re-judges.** Every identity is judged against
  the SAME read of its month (the stored board), never against another proposal of the same sweep.
  Two proposals can therefore name the same person (for two seats of one service, or past a monthly
  cap across two services); that is safe because nothing is written until «Aplicar», which re-runs
  D2–D3 on a fresh read (D8): applying the first makes the second refuse and the screen shows its
  recomputed proposal. This removes the shared working board, whose interactions with automatic
  writes were the defect class of rounds 5–7.
- **D6. Identity and «Mantener».** Conflict identity = `(roleId, memberId, date)`. `kept` is set ONLY
  by Frank's «Mantener» and is the one status that silences an identity — for as long as the
  conflict lasts: once it ends (not C: the date cleared, the person unseated, the service moved or
  deleted) a `kept` record becomes `gone` like any other, and a later conflict on the same identity
  is a NEW event («las personas cambian su disponibilidad después» is exactly that case). If the
  person is seated there again after an applied fix (copying instruments, a hand pick — the picker never refuses an
  unavailable person, `pickJudge.ts:78-80`), it is a NEW conflict event: proposed (or `none`) and
  emailed.
- **D7. Horizon.** Services dated from CDMX today through the last day of the month after next (an
  Auto plans up to two months ahead, so its drafts fall inside).
- **D8. Reproposal on read.** The UI shows the proposal recomputed on a fresh read (the email shows
  what was true when sent). «Aplicar» re-runs D2–D3 on a fresh read for the chosen candidates and
  refuses if one no longer passes or if the role `_rev` differs from the one the screen showed.
- **D9. Who triggers what.** The member's save scopes the sweep to THAT member's identities (a member
  can only cause their own conflict); the table (§5.2) is applied to nothing else. The scheduled
  check and «Revisar ahora» sweep everyone. All call one function. `loadV3PlanSources` reads EVERY
  member (`adminMembersQuery(true)` binds `$all`, `ministries.ts:130`), so detection sees everyone
  seated; candidates are filtered to worship (D2).
- **D10. Only Production acts on its own.** The automatic parts — record writes, email claims and
  sends — run only where `fairnessRecordEnvironment(process.env) === "production"`. Elsewhere (Preview
  shares the real dataset; local) the sweep runs DRY: it computes and answers its report, writes
  nothing, sends nothing. «Aplicar» and «Mantener» are a person's own click and work on Preview like
  every other admin button there — on the REAL dataset: a «Mantener» pressed on dev silences that
  conflict in production too (the ADR and `docs/NOTIFICATIONS.md` say so).

## 4. The pure core — `app/utils/availabilityConflicts.ts` (no I/O, no `"use client"` import)

### 4.1 Finding conflicts

`findBoardConflicts(board, members, todayIso)` → for EVERY column with `date >= todayIso` (editable
or not; `editable` is reported per entry): the seated members (all five seat kinds, from
`board.cells`) passed through `computeAvailabilityConflicts`, one entry per `(roleId, memberId)` with
every seat they hold there (`{ rowId }[]`), the date and the column's `published`. `memberId` scope
filter optional.

### 4.2 Proposing a replacement

`proposeReplacement({ board, roleId, memberId, members, config, windowRoles, todayIso, exclude, gate })`
→ `{ kind: "replace", target, seats: { rowId, from, to }[] } | { kind: "none", reason }`. ALL OR
NOTHING: `replace` only when EVERY seat the person holds there has a candidate (`to` always set); if
any one seat has none, the answer is `none` — a proposal never half-covers the person. For each seat
the member holds in that service, in board row order: remove them from the cell, build the D2 pool and
order for that cell (`null` → `none`, `unchecked`), and use the first candidate that passes D3(0),
D3(a) on the target built so far and `gate` (§4.3), at most 8 tried per seat. A person chosen for one
seat is `alreadyAssigned` for the next. `target = columnTarget(boardAfter, roleId, todayIso)`, where
`boardAfter` is `board` with THIS identity's seats changed and nothing else. `exclude` lets «Elegir
otro» skip people. Pure and deterministic for the same inputs. `board` is always the stored board as
read (D5).

### 4.3 The month gate

`monthCheck` (`monthCheck.ts:197`) is NOT changed: its whole `MonthCheck` result is serialized into
four MCP answers (`serviceEditor.ts:909,1038`, `proposalEditor.ts:566,694`), where members cross the
wire as tokens only (ADR-0062), and the raw verdict carries member ids (`MissedProtection.person`)
and solver rule ids. Instead `monthCheck.ts` gains a SEPARATE pure export
`monthCheckVerdict(input: MonthCheckInput)` → `{ judged: boolean, instances: BrokenInstance[],
missed: MissedProtection[], eligibility, ruleIds }` (`eligibility` = the built request's
`people[p].eligibility`, which D3(0) reads, so the request is built once per judgement; `ruleIds` =
the request's rule-id table), built by the same internal steps `monthCheck` uses (one shared
helper, so the two cannot drift); `judged` = a ledger was given AND the request built (the existing
`checked` also needs the fair-share read, which the gate does not use). Only the availability gate
calls it; its result never reaches an MCP answer, a log or the email. A test asserts the four MCP
answers' shapes are unchanged and name no member id.

The gate applies to VOICE seats only (the month check judges only voices, `monthCheck.ts:263-270`);
an instrument or FOH pick rests on D2 and D3(a), as the planner's own pick does. For a voice seat,
given the month's ONE ledger read (§5.3 step 3), it builds the month-check input exactly as
`runStoredMonthCheck` does (`serviceEditor.ts:731`: `months: [month]`, the record's entry,
`storedRoles` = the roles read minus the board's editable ones, `savedWindow` minus on-board
services) with `fairShare: null`, and runs `monthCheck` on `removedOnly` (absent person out, seat
empty) and on `withCandidate`, both through `monthCheckVerdict`. Presence rule ids are ordinals over the
people sent (`v3RuleIds.ts:7-13`), so a candidate who enters the request only in `withCandidate` can
shift them: when the two builds' `ruleIds` tables differ, the candidate is rejected (fail closed).
Reject also when either is not `judged`, when `withCandidate` has an
instance key `(family, rule, scope)` or a missed key `(code, person, scope)` that `removedOnly`
lacks, or when a count instance in both has a `<=`/`==` rule and a larger `observed`. When no voice
candidate can be judged because the month cannot build (no eligibility record: the synthetic ledger
has no horizon entry, `monthCheck.ts:97-107`), the seat's answer is `none`, `reason: unchecked` —
surfaced in the UI and the email, never silent. `entryFromRecord` moves unchanged from
`serviceEditor.ts` to `app/mcp/monthProposals/storedEntries.ts`, imported by both.

## 5. The writer — `app/utils/availabilityFixCommit.ts` (`server-only`)

### 5.1 The record — `availabilityConflict`

Id `availabilityConflict.<sha256(roleId|memberId|date) hex, 32 chars>` (dotted → private). Fields:
`roleId`, `memberId`, `date`, `serviceKind`, `published` (as last seen), `status`
(`proposed | none | applied | kept | gone`), `seats[] { _key, rowId, from, to? }`, `reason?`
(`no_candidate | song_lead | unchecked`), `eventSeq` and `notifiedSeq` (integers), `firstSeenAt`,
`updatedAt`, `checkedAt` (set by a sweep that judged it, only on a write it makes anyway or at most
every 6 h), `appliedBy?`, `trigger`. Never deleted.

**Every record write is guarded:** a new record by `create` (a concurrent creation fails the call —
never `createIfNotExists`); an existing one by `patch(id).ifRevisionId(<rev this sweep read>)`. A
failed guard means another sweep or click got there first: this sweep drops that identity's step and
the next one re-reads. A record write is one single-document mutation; nothing else rides with it.

### 5.2 Transitions

Each sweep first requires a JUDGEABLE read: every source ready (§5.3 step 1), the inventory
`coherent` and the engine `v3`. Otherwise the sweep makes NO transition at all — every record stays
as it is — and answers why (`sources`, `incoherent`, `engine`); the UI says «No se pudo revisar» with
that reason (computed by the GET from its own fresh read, §7 — a blocked sweep writes nothing),
and every such run logs one fixed-tag line (`[availability-sweep] blocked <reason>`),
visible in the production logs. So a transient state can never end a conflict or re-announce it.

On a judgeable read, per identity in its scope: **C** = «the service exists, its CURRENT date equals
the identity's `date`, the person is seated in it, and that date is in their `unavailableDates`», taken from the ROLES READ (`adminRoles`, all five
seat paths, `computeAvailabilityConflicts`) — not from the board, which leaves out a role it cannot
translate (`translateStoredRole` → `null`, `storedRoleReadModel.ts:151,159`); **E** = the service is a
board column and `editable`. A role in scope with no board column is therefore C-not-E (`unchecked`),
never «not C». A service moved to another date makes the old identity «not C» (→ `gone`); the new
date is a new identity. «Pick» = `proposeReplacement` answered `replace` (only computed when E). Not C is the
ONLY evidence that a conflict ended: the service was deleted, the person left it, or they cleared the
date.

| Status now | C and E | C, not E | not C |
|---|---|---|---|
| no record, `gone` | `proposed` (pick) or `none`, **new event** | `none`, `reason: unchecked`, **new event** | nothing |
| `proposed`, `none` | same status → update `seats`/`reason`/`published` in place, no event, and only when one of them differs from the stored record (no write, no `_rev` churn, when nothing changed). `none` ↔ `proposed` → the new status, **new event** | `none`/`unchecked` in place (a `proposed` becomes it with a **new event**) | `gone` |
| `applied` | the person is back: `proposed` (pick) or `none`, **new event** | the person is back: `none`/`unchecked`, **new event** | unchanged (listed 30 days) |
| `kept` | unchanged | unchanged | `gone` (the kept conflict ended; a later C is a new event) |

`applied` is written only by «Aplicar» (§5.5) and does not count an event (Frank did it). «New
event» = `eventSeq += 1` in the same write. A sweep whose read of the ledger FAILS (a transient read
error, not an unbuildable month) leaves that month's identities untouched and logs it.

**Notification is per event:** a record is due while `notifiedSeq < eventSeq` and its status is
`proposed` or `none`. The email step claims each due record with
`patch(id).ifRevisionId(rev).set({ notifiedSeq: eventSeq })` BEFORE sending; only claimed records go
in the email, so two concurrent sweeps never send one event twice. The claim is made whether or not
any admin will receive it (an empty audience still settles the event), so a due record never loops —
EXCEPT when delivery is blocked (`isDeliveryBlocked()`, `deliveryFirewall.ts:191`): then nothing is
claimed, as `outboxSweep` refuses to claim (`outboxSweep.ts:751-759`), and the events stay due. A
send that fails after the claim is logged (fixed tag) and not retried; the record and the UI still
show it. A record that left `proposed`/`none` before its claim (applied, kept, gone) is not due and
is not emailed.

### 5.3 `sweepAvailabilityConflicts({ trigger, memberId?, deadlineMs, mode })`

`mode` is `"act"` only when D10 holds, else `"dry"`. The sweep never calls a role writer (the module
imports `editRole` for «Aplicar» only, §5.5); it writes only `availabilityConflict` documents (a test
asserts the sweep never calls `editRole`).

1. Without `SANITY_API_READ_TOKEN` the module refuses before any read (`{ ok: false, reason:
   "no_token" }`): the ids are private and an untokened read answers «no records» with no error (as
   `fairnessLedgerRead.ts:123` refuses). Read the records `*[_type == "availabilityConflict" && date
   >= $today]` through `operationalClient` (inside this module: the one reader and writer of the
   type) FIRST, then `loadV3PlanSources()`; any failed or unready source → `{ ok: false }`, nothing
   written. The order matters: «Aplicar» writes the role before its record (§5.5), so a record read
   before the roles can only be OLDER than the roles it is judged with; any record «Aplicar» wrote
   after that read has a new revision, and this sweep's `ifRevisionId` write on it fails and drops
   the step (no spurious «back» event for a conflict already applied).
2. One `storedMonthBoard` per horizon month (D7) that holds a conflict (`findBoardConflicts`, scoped
   to `memberId` when given) or a `proposed`/`none` record in scope. Any board not `coherent`, or the
   engine not `v3` (`resolveSolverEngine`, as `openMonth` refuses) → stop: no transition (§5.2). C and
   E per identity.
3. Per month that needs a pick: ONE `loadV3Ledger([month])`. Each identity (earliest date first) is
   judged by `proposeReplacement` on that month's stored board as read (D5).
4. Apply §5.2 per identity in that order: one guarded record write each. No new identity is judged
   after `deadlineMs − 15 s`; what is left waits for the next sweep.
5. Always run, on every sweep that got past step 2, whether or not step 4 changed anything; it starts
   only while at least 10 s remain before `deadlineMs` (every `deadlineMs` is at most 50 s after the
   invocation began, under `maxDuration = 60`, so a claimed email has headroom to send); otherwise
   the due records wait for the next tick unclaimed. It logs «claimed N» (fixed tag) before sending,
   so a platform kill between claim and send leaves a trace. Re-read the records (fresh revisions) and email (§6) the ones claimed
   from that read.
6. Answer `{ ok, mode, proposed, none, kept, gone, skipped }` with ids; `"dry"` answers what `"act"`
   would have done. Logs carry fixed tags and counts, never names or ids.

### 5.4 Triggers

- **The member's save.** `PATCH /api/me/availability`, after a successful commit, inside `after()`:
  the dates ADDED by this save (new minus the `current` it read) go to `memberTick({ memberId,
  addedDates })` (exported by `availabilityFixCommit.ts`, which owns every read of the type): one read
  through `operationalClient` for the services on those dates seating this member
  (`assignedSeatsByRoleQuery`, filtered on the service day as `coalesce(week, date)` — weekend roles
  store `week`, specials `date`, `serviceReadQueries.ts:583`; a test pins the GROQ string) and one for
  their records; only if some (service, date) has no record
  or one in `gone`/`applied` (D6's «back») → `sweep({ trigger: "member", memberId, deadlineMs: now +
  50 s })`. The PATCH's contract and response are unchanged; the route gets `maxDuration = 60` and
  `withVerificationRunContext`. A sweep failure is logged, never answered.
- **The scheduled check rides layer 1's tick.** `/api/cron/flush-notifications` keeps its drain, its
  response and its status code exactly as they are. After the response, in `after()` and in its own
  try/catch, it calls `availabilityTick({ startedAt })` (exported by `availabilityFixCommit.ts`),
  which returns at once unless the 5-minute bucket `floor(now / 300 s) % 3 === 0` (every third Cloud
  Scheduler tick, ~15 min; a GitHub backup call in the same bucket is harmless, the writes are
  guarded) and at least 40 s remain before its deadline (`startedAt + 50 s − now ≥ 40 s`; a long drain skips
  the tick, the next one is 15 min away). It then runs a cheap PRE-CHECK — the horizon's seats per
  service (one read through `operationalClient` with a NEW builder `assignedSeatsByRoleQuery(roleFilter)`
  in `notifyTargets.ts`, built from the same private `ASSIGNED_SEAT_PATHS` as
  `assignedMemberRefsQuery` so the five paths cannot drift), the members' `unavailableDates` and the
  records — and opens the full sweep (`trigger: "cron"`, `deadlineMs: startedAt + 50 s`) only when:
  a conflict has no record or a `gone`/`applied` one; a `proposed`/`none`/`kept` record's conflict
  is no longer seen; a `proposed`/`none` record's `checkedAt` is more than 6 h old (a `none` may have a
  candidate now and so become a `proposed` event; the age stops an unfixable one from reopening a
  sweep every tick); or ANY record is due (`notifiedSeq < eventSeq` in `proposed`/`none`: an email a
  previous run left unsent). No new Scheduler job, secret or workflow; the tick inherits the flush's
  liveness alarm (if the flush stops, the daily cron already says so). This also covers the Kids
  manager's availability writer, Studio edits, hand picks and copied instruments, which have no
  trigger of their own.
- **Kill switch.** `availabilityTick` and `memberTick` return at once when
  `AVAILABILITY_SWEEP_DISABLED=1` (a new env var with its `docs/SECRETS.md` entry: Production only,
  no secret value, set with `vercel env add` and a redeploy), so the sweep and its emails can be
  stopped without a code release; «Revisar ahora» then answers dry.
- **«Revisar ahora».** `POST /api/admin/availability-conflicts/sweep`: «the admin guard» =
  `requireActiveManager`, not
  `content-editor`, not `session.user.isImpersonating` (as `/api/admin/chat`); `trigger: "manual"`,
  `deadlineMs: now + 50 s`; answers the report. `maxDuration = 60`, `withVerificationRunContext`.

### 5.5 «Aplicar» / «Elegir otro» and «Mantener»

`applyAvailabilityFix({ roleId, rev, memberId, replacements, actor })`:

1. Fresh `loadV3PlanSources`, the month board (`coherent`, engine `v3`, the column `editable` and
   dated today or later in CDMX — a screen left open past midnight — else `409` «vuelve a revisar»); C must hold (else `409`); the column's `rev` must equal `rev` (else
   `409`); `replacements` must cover EVERY seat the person holds there (all or nothing, as §4.2; else
   `400`); each chosen replacement passes D2–D3 on the fresh board (one ledger read), else `409` with
   the refusal. «Elegir otro» is the same call with a candidate from the alternatives list.
2. `parseEditRequest({ ...target, rev })`, then `editRole(roleId, parsed, { notices: "deferred" })`
   — the existing writer, unchanged, exactly as `/admin`'s PATCH calls it. Refused → its status and
   code; nothing else is written.
3. On `ok`: the record → `applied` (`appliedBy`, `seats` with `to`, no event): `create` when the
   conflict had no record yet, else a patch under the revision read in step 1. This is bookkeeping
   only: if it fails (a concurrent sweep moved the record, or a throw), the answer is still `ok` with
   `recorded: false` and a fixed-tag log; the role write stands, and the next sweep sees «not C» and
   records `gone`, so the conflict leaves the open list either way (it then misses the 30-day
   «aplicados» list, the one cost).

Route `POST /api/admin/availability-conflicts/apply`, the admin guard (§5.4). «Mantener»: `POST .../keep
{ recordId?, roleId, memberId, date, rev? }` → `kept` under `ifRevisionId` (by `create` when the
conflict has no record yet). `GET /api/admin/availability-conflicts` (§7) reads through this module
too. All four routes use the admin guard.

## 6. The email

### 6.1 Content

One email per sweep that claimed events, subject «Conflictos de disponibilidad (N)». Sections:
«Propuestas» (person → replacement, seat, service label, «borrador» or «publicado», «Aplicar en la
app») and «Sin reemplazo» (person, seat, reason; «no se pudo revisar» for `unchecked`). Link
`${appBaseUrl()}/admin?tab=availability` (the tab param `AdminPanel.tsx` already reads). Built with
`shell`/`td`/`C` (the light email palette), labels from `serviceLabel`.

### 6.2 Audience

A NEW query (the shared `ADMIN_RECIPIENTS_QUERY` is left alone: it has no ministry or `disabled`
filter, FrankERP/owt-kb-v1#8): `*[_type == "teamMembers" && role in ["super-admin","admin"] &&
disabled != true && <WORSHIP_AUDIENCE_GROQ_FILTER>]{ _id, email, notifPrefs }`, then an email, the
allowlist (`getAllowlist`/`isEmailAllowed`) and `wantsNotification(prefs, "proposals")` — the admins'
«Propuestas» switch, which the setlist-proposal admin email (`proposalNotify.ts:112`) honours. Serial
sends (ADR-0013). Only Production sends (D10); `EMAIL_REDIRECT_TO` is still honoured, as by every
sender, in case that ever changes.

### 6.3 Not done

No new `NotifyKind`: a dedicated switch touches the member form, `/me` and four tests for one admin
email. Follow-up if Frank wants to turn this one off alone.

## 7. UI (standard; consumes §5)

`GET /api/admin/availability-conflicts` (the admin guard, §5.4) → open conflicts with their recomputed proposal and up to 3
alternatives (D8), records `applied` in the last 30 days, `kept`, and — when its OWN fresh read is not
judgeable (§5.2: `sources`, `incoherent`, `engine`) — that reason as «No se pudo revisar», instead of
proposals (nothing stores a blocked sweep's reason). `AvailabilityPanel`'s «Conflictos» view renders them (house `Button`,
`Menu`, hairline rows) with «Aplicar», «Elegir otro», «Mantener» and a header «Revisar ahora». Every
handler: try/catch/finally, `res.ok`, loading reset, 409 → reload with «El servicio cambió; vuelve a
revisar».

## 8. Guards and docs (same delivery)

- `roleEditCommit.ts`: unchanged.
- `serviceCommitCallers.test.ts`: `roleEditCommit` gains `app/utils/availabilityFixCommit.ts` (its
  `applyAvailabilityFix` only); a new row `availabilityFixCommit` → the four admin routes (GET, sweep,
  apply, keep), the availability PATCH and `/api/cron/flush-notifications`.
- `__fixtures__/deliveryCapableImports.ts`: add `availabilityFixCommit`; every route importing it is
  wrapped in `withVerificationRunContext`.
- `protectedReadAudit.ts`: add `availabilityConflict` to `PROTECTED_TYPES` (dotted ids: an untokened
  read answers «nothing» with no error, the `fairnessMonth` lesson) and register
  `availabilityFixCommit.ts` in `PROTECTED_RUNTIME_WRITERS` as its one reader-writer; the test's
  writer count moves accordingly. No other runtime module reads or writes the type (the Studio schema
  only declares it).
- `draftGatingCoverage.test.ts`: the new role reads in `availabilityFixCommit.ts` (the pre-check,
  `memberTick`) deliberately include drafts (a draft service's conflict is proposed too, D4); they
  join the test's documented exemptions with that reason.
- `monthCheck.ts`: `monthCheckVerdict` (§4.3); `MonthCheck` unchanged.
- `instrumentFill.ts`: export `seatCounts` and `instrumentalistsOn`, unchanged.
- `notifyTargets.ts`: `assignedSeatsByRoleQuery(roleFilter)` beside `assignedMemberRefsQuery`, over
  the same `ASSIGNED_SEAT_PATHS` (a test asserts both name the five paths).
- `deliveryFirewallTransports.test.ts`: the new admin email joins its «invokes EVERY trigger» list.
- The «`applyAvailabilityFix` only» importer rule for `editRole` cannot be pinned by
  `serviceCommitCallers.test.ts` (it pins whole modules); a unit test asserts the sweep path never
  calls `editRole` instead.
- `docs/SECRETS.md`: `AVAILABILITY_SWEEP_DISABLED` (§5.4 kill switch).
- Studio: `sanity/schemas/availabilityConflict.ts`, read-only fields, registered with the others.
- `/api/cron/flush-notifications/route.ts`: the `after()` call to `availabilityTick` (§5.4), its
  response untouched; `docs/NOTIFICATIONS.md` §layer 1 says the tick rides it.
- ADR-0078 «Availability conflicts are proposed one seat at a time; a person applies them» (D1, D2,
  D4, D5, D10), including the accepted costs: two proposals may name the same person (D5; «Aplicar»
  re-judges); an email that fails after its claim is not retried (the record and the UI keep it); a
  lost record write after «Aplicar» shows the conflict as gone rather than applied; the month gate,
  like the MCP editor's, judges one month at a time, so a protection spanning a month boundary
  (consecutive Sundays on Nov 29 / Dec 6) is not seen; and why automatic draft writes were deferred
  (rounds 5–7, Frank's choice of 2026-10-30).
- `docs/NOTIFICATIONS.md` (the new admin email), `CLAUDE.md` + `project-rules.md` (the writer joins
  the admin write paths list), `docs/UTILITIES_AND_COMPONENTS.md`.

## 9. Tests

Pure core (vitest, fixtures in the style of the MCP editor tests): conflict finding over all five
seat kinds; past and non-editable services ignored; D2 filters (unavailable, alreadyAssigned,
undeclared instrument, non-worship, C2, C4); D2 ORDER — a `slack` member ranks by `load + N`, an
`exempt` one at the median, an instrumentalist who played the previous weekend after one who did
not; `serverPickCandidates` `null` → `unchecked`; two seats of one person (the second sees the first
pick as `alreadyAssigned`); a person in Lead + Bass whose Bass has no candidate → `none`, no Lead
proposal either; two absent people in one service judged independently on the same board (D5); a
weekend voice candidate outside the month's v3 eligibility is skipped; D3(a) rejects a rule finding;
the month gate rejects a new cap/pair/protection and a grown `<=` count, accepts a removal-only one,
rejects when not `judged`, and is not applied to an instrument seat; worship-night song lead →
`none`; a role with an FOH item missing its person (untranslatable) → `unchecked`.

Writer (mocked clients and deps, as the `serviceEditor` tests mock theirs): one test per cell of the
§5.2 table; the sweep never calls `editRole` (draft and published); `applied` then the person
re-seated → `proposed`, one email; `proposed` → date removed → `gone` → date re-added → `proposed`,
one more email; `kept` stays silent while C holds; `kept` → date cleared → `gone` → date re-marked →
`proposed`, one email; two concurrent sweeps on one new identity → one `create` wins,
the other drops (one email); a failed ledger read leaves the month untouched; an incoherent inventory,
an unready source or engine `v2` makes no transition (every record unchanged, nothing sent); a
conflict on a non-editable service → `none`/`unchecked`, never `gone`; `"dry"` mode writes and sends
nothing and answers what `"act"` would do; the member scope never touches another member's record;
the deadline stops new judgements; «Aplicar» committing between the sweep's records read and its
roles read → the sweep's record write fails its guard, no event, no email; a service moved to another
date → the old identity `gone`; a record left due by a failed or cut step 5 is emailed by the NEXT
tick (the pre-check opens the sweep for it); delivery blocked → no claim, events stay due; no read
token → refused before any read; the kill switch stops both ticks; an unchanged `proposed`/`none` is
not re-written. `availabilityTick`: skips outside its bucket and with < 40 s left; the pre-check opens
the sweep for each case §5.4 names and not otherwise; the flush route's response and status are
byte-identical with the tick throwing.

`applyAvailabilityFix`: a stale `rev` → 409 and no write; a replacement that no longer passes on the
fresh read (e.g. the other proposal for the same person was applied first) → 409, no write; a partial
`replacements` → 400; `ok` → `editRole` called once with `notices: "deferred"`, then the record
`applied`; the record write failing → still `ok`, `recorded: false`, and the next sweep records
`gone`. Routes: 403 for content-editor and impersonation; the flush route still 401 without
`CRON_SECRET` and its tick registered only after that check; the availability PATCH answers the same
when the sweep throws.

## 10. Rollback

A PR removing the triggers (§5.4) stops every automatic write and email; records are inert. The
kill switch (§5.4) does the same without a release. Every role change is a person's «Aplicar», a
normal role edit named in its record (`seats.from`/`to`) and reversible by hand.

## 11. Release

Before the merge to `preview`, list the conflicts the first production sweep would propose (read-only
MCP reads) and show Frank. Today (2026-10-29) that is two published services (2026-11-29,
2026-12-27, both Mkz in Lead + Bass): the first scheduled check would only propose and email him once.
Also read-only, before the merge: that Frank is in the email audience (super-admin or admin, in
worship, not disabled, email allowlisted, `wantsNotification(notifPrefs, "proposals")` true — i.e. `notifPrefs.emailProposals`, falling
back to `notifPrefs.email`, `notifyPrefs.ts:11-29`; not the push field `proposals`), that the role inventory
is coherent (no lingering raw Studio draft), and that Nov and Dec have fairness records (else every
voice proposal is «sin revisar»); report each to Frank, together with what the first sweep would propose — today's two known
conflicts are Mkz in Lead + Bass, and with all-or-nothing they come out «sin reemplazo» if no
bassist passes. On dev the sweep is dry (D10): «Revisar ahora» shows what it would do. Deploy the Studio schema with
the release (`sanity schema deploy`; the Content Lake accepts the type without it). Then the CLAUDE.md
order: gates → one code review → preview → verify alias → PR → merge → prod alias → the first ticks
checked in the production logs (the tick logs one fixed line per run: skipped / pre-check clear /
swept).

## 12. Post-approval changes (UN-REVIEWED — outside the approved digest)

Adopted from the approving rounds' non-blocking notes; the code review of the implementation covers
them.

1. **Month gate, grown caps.** A missed protection with the same key `(code, person, scope)` in both
   builds whose `count` grows (`sunday_cap_exceeded`/`saturday_cap_exceeded`,
   `monthCheckCore.ts:226`) rejects the candidate, as a grown `<=`/`==` count does.
2. **Identities come from the roles read**, not the boards: the sweep enumerates C from `adminRoles`
   (all five seat paths) plus the records in scope, then builds the boards for the months that need a
   pick. A `kept`/`proposed`/`none` record in a month with no board still reaches «not C» → `gone`.
3. **Second voice seat.** For a person with two voice seats, the second seat's `removedOnly` starts
   from the board that already holds the first seat's pick.
4. **Member trigger.** `memberTick` also acts on dates REMOVED by the save that have a
   `kept`/`proposed`/`none` record (so a quick clear and re-mark is not missed), and its `deadlineMs`
   is computed from the request's start (`startedAt + 50 s`), as the cron tick's is.
5. **Email step.** The audience is read BEFORE any claim (a failed audience read claims nothing).
   A member-scoped sweep claims only the records in its own scope; other due records wait for the
   tick. The audience query also excludes the system accounts (`service-account-*`,
   `member-dev-verify`), as the setlist audience does (`outboxSweep.ts:242`).
6. **«Deshacer»** on a `kept` conflict in the panel (back to the sweep's judgement: the record goes
   to `none` with no event, and the next sweep re-judges it).
7. **Wording.** Presence rule ids are ordinals over rule keys (which include the keys the people
   sent carry). The tick does NOT inherit an alarm for a blocked sweep: `reportOutboxLiveness` fires
   on stale outbox items only. A sweep blocked for a long time (a lingering raw Studio draft, the
   engine on v2) is visible only in the panel («No se pudo revisar») and the logs — an accepted cost
   recorded in ADR-0078, told to Frank.
