# Server seat-clash guard — the role writers refuse a clash they would ADD

**Status:** APPROVED (rounds 6 and 7 on digest `c232751d…5450`, log beside this file); Frank's OK
2026-10-31 00:45Z; implemented on branch `claude/project-thread-bkkvpk`. §7 was added after that
approval and is un-reviewed; §8 records where the build differs from the text. Owner thread: «Corregir a Tony en coro y batería».
**Governs:** ADR-0078 (nobody sings and plays on one service unless marked) — this closes its
"server writers check no seats" consequence.

## 1. Requirement (Frank, 2026-10-29 / 2026-10-30)

> «revisa por qué este domingo … el solver puso a tony en coro y en batería al mismo tiempo,
> algo que no puede pasar» — then, on the decision card, «Nadie, salvo una lista».
> On the follow-up "the server does not check this clash when a saved service is edited (for
> example with a swap); fixing it needs its own plan": «Prepáralo».

So: a person may not hold two seats that `seatsClash` (`app/components/admin/seatModel.ts`)
says clash on ONE service, whichever path writes the roster — not only the planner's client
gate (C2 in `rankCandidates`).

## 2. What exists today (verified 2026-10-30)

- **Client side** refuses a clash where a SEAT is chosen: picker, drag (`moveGate.ts`, C2
  «never forceable», DD2), Auto's fillers (`instrumentFill.ts`, `v3Prefill.ts`), and the MCP
  judges (`storedJudge`, `serviceEditor`, `proposalEditor`) — all through `rankCandidates`'
  `blockedReason`. Not everywhere a seat changes, though:
  - the SOLVER choosing a voice does not see instrument cells already on the board, so a
    hand-placed drummer it puts in Coro reaches «Crear» with only the grid's ⚠ (ADR-0078,
    Rejected) — see D3b;
  - «Copiar a todo el mes» (`PlannerGrid.planCopyAcrossColumns`, `PlannerGrid.tsx:1650-1729`,
    offered on every instrument and FOH row, 1878-1883) replaces the row in every other column
    through `withUpdatedCell` with no `rankCandidates`/`seatsClash` check, and in «Editar mes»
    those columns are stored services, PATCHed by the next «Guardar» — see D5;
  - swap and copy-instruments (below) judge nothing.
  So no plan decision below rests on "this client path already went through C2".
- **Server side** checks referential integrity only. `editRole` says so in a comment
  (`roleEditCommit.ts:116-118`: «referential validation only; memberType remains UI guidance,
  not server policy»). Four protected writers change seats:

  | Writer (`app/utils/`) | Route / MCP caller | Before-state | After-state |
  |---|---|---|---|
  | `roleEditCommit.editRole` | `PATCH /api/admin/roles/[id]`; MCP `save_service_edits` (+ app twin), «Editar servicio» | `normalizeStoredSeats(role)` | `request.seats` |
  | `roleCreateCommit.createRole` | `POST /api/admin/roles`; MCP `apply_schedule`, `create_service`; Auto confirm | none | `request.seats` |
  | `roleSwapCommit.swapRoles` | `POST /api/admin/roles/swap` (MonthGenerator team and section swaps); MCP `swap_assignment` | per role, `normalizeStoredSeats(role)` | per role, `afterSeatsOf` / replacements (already computed, lines 251-312) |
  | `copyInstrumentsCommit.copyInstruments` | `POST …/copy-instruments`; MCP `copy_instruments` | target's stored seats | `afterSeats` (line 114) |

  The swap and copy UIs do not run C2 at all, so today a swap between two services can put a
  Coro singer on Drums on a service where they already sing, and the server writes it.
- Every other writer leaves seats alone: `roleDeleteCommit` (removes), `publishReadyCommit`,
  `roleUnpublishCommit`, `setlistSaveCommit`, `proposalReviewCommit` (songs only),
  `fairnessMonthCommit`, `serviceThreadCommit`, `kidsCommit`, `songSaveCommit`.
- **Production data** (GROQ over every `sunday_role`/`saturday_role`/`special_role`,
  2026-10-30): 18 rosters hold one person in a voice AND an instrument; 17 are Frank or Mkz
  (both `singsAndPlays: true` since 2026-10-30), the 18th is 2026-11-29 (Tony Coro + Drums, plus
  Mkz). No roster has a same-section duplicate (voice refs and instrument refs are each unique
  per roster), and no roster holds one person twice in FOH. The 2026-11-29 fix is a separate, consented write in this thread.

## 3. Decisions

### D1 — Refuse only clashes the write ADDS (diff), not every clash in the result

A write is refused when its after-state holds a clashing seat pair that its before-state did
not hold. A pair is `(memberId, seatIdA, seatIdB)` with the two seat ids sorted; seat ids are
built by ONE server function on both sides (`lead`, `bgv`, `coro`,
`instrumento:<normalizeSeatName(label)>`, `foh:<label>`), one entry per occurrence, so the
same person twice in one seat is the pair `(lead, lead)` and clashes (same category). These
match the planner's create-mode row ids; stored-mode grid rows keep `normalizeLabel` spellings
(`instrumentFill.ts:131-135`), which does not matter because the server never compares its ids
with the grid's — only before with after, through the same function. That function also
lowercases the label part of an instrument or FOH id (labels shown to people keep their case),
so a stored «drums» and a requested «Drums» are one seat and a grandfathered pair on it is not
read as added. Both sides are judged
with the member's CURRENT flag.

- **Why not "no clash in the result":** a roster that already holds a clash (today only
  2026-11-29; tomorrow any service of a member whose «Canta y toca a la vez» is unticked) would
  refuse EVERY unrelated edit — moving the date, fixing the console, even removing someone
  else — until somebody cleans it, and the admin would see a refusal about a seat they did not
  touch. The diff rule never blocks an edit that leaves the old pairs alone, and it still
  refuses each new one. Removing one side of an old clash is always allowed (it removes a pair).
- **Why not judge the flag at "before" time:** the flag has no history; the same current flag
  on both sides makes "already held" mean exactly "this write did not create it".
- Matches how the MCP judges stored edits: as diffs (`storedJudge.ts`, ADR-0066).
- **Per role, never across roles.** "Already held" means held on THIS service before the write.
  A team or section swap that carries an old clash from service B onto service A is refused:
  on A the pair is new. The alternative (a pair held on any involved role before is not new)
  would let a section swap create a fresh clash on B whenever the same person already had the
  same pair on A. Today the only old clash is 2026-11-29, which this thread fixes first.

### D2 — One pure function, one member read

- New `app/utils/seatClashGuard.ts` (pure, no I/O):
  `addedSeatClashes(before: NormalizedSeats | null, after: NormalizedSeats, singsAndPlays: ReadonlySet<string>): AddedClash[]`
  where `AddedClash = { memberId, seats: [SeatRef, SeatRef] }`, `SeatRef = { seatId, label }`.
  It builds each member's occurrence list per side and returns after-pairs absent from
  before-pairs, sorted for stable output. FOH stays out of every pair with a voice or an
  instrument, exactly as `seatsClash` says.
- **One pair enumerator, not two.** The pair loop that `PlannerGrid.categoryDuplicatesForColumn`
  (`PlannerGrid.tsx:558-590`) runs today moves to `seatModel.ts` as
  `clashingPairs(entries: {seatId, category}[], singsAndPlays: boolean): [number, number][]`
  (pure, beside `seatsClash`); the grid and `addedSeatClashes` both call it. `seatModel.ts` is
  pure and already imported by server code (`app/api/admin/members/*`), and `app/utils/`
  already imports other `app/components/admin` modules.
- The flag comes from the member read each writer ALREADY makes: `loadCanonicalMemberIds`
  (`roleWriteOps.ts:252`) over `CANONICAL_MEMBER_PROJECTION` (`serviceReadQueries.ts:63`).
  Add `singsAndPlays` to that projection and a sibling `loadCanonicalMembers(ids)` returning
  `Map<id, { singsAndPlays: boolean; name: string }>` (name = the trimmed alias, else the trimmed `member_name` — the same rule as
  `loadMemberNamesByIds` (`roleWriteOps.ts:199`), shared through one small helper so one person is
  never named two ways; for the
  message). `loadCanonicalMemberIds` stays as a wrapper over it (its fifth caller,
  `app/mcp/tools/editSetlist.ts`, is unchanged). No extra round trip.
- Only `singsAndPlays === true` counts as marked (same as `seatsClash`); absent = unmarked.

### D3 — Where each writer calls it: read-only stage, before ANY write

Each writer calls `addedSeatClashes` right after its dangling-reference refusal and before
anything that can write — `resolveOwnedCoordination` (legacy-lock bootstrap commits), the
special-identity coordinator, the occupancy inventory, the transaction:

- **editRole:** the member read stays where it is (before `loadRoleForWrite`, line 119-124,
  dangling refusal unchanged) and becomes `loadCanonicalMembers`; the guard runs after the
  stored-type checks (~line 170), before `loadTargetOccupancy` (192), `bootstrapLegacyLock`
  (233), `loadSpecialIdentityCoordinator` (252) and the transaction (287). Before =
  `normalizeStoredSeats(role)`.
- **createRole:** beside the dangling check (`roleCreateCommit.ts:116-123`), i.e. AFTER the
  exact-receipt replay branch (line ~110), so an idempotent replay of an already-committed
  create is never refused by a rule that did not exist when it committed. Before = `null`.
- **swapRoles:** after the dangling check (line 284-292), before `resolveOwnedCoordination`
  (line 295); judged per involved role on the LOADED roles plus the replacements/arrays the
  handler already built (`afterSeatsOf`, `replacementsOf`).
- **copyInstruments:** after the dangling check (line 120-125), before coordination; before =
  `normalizeStoredSeats(loadedTarget.target.role)`, after = `afterSeats`.

**The member read keeps its current id set in every writer** (so the dangling-reference refusal
keeps exactly its current scope). It already covers every person whose seats change: editRole
and createRole read every assignee of the request; swap reads `involvedPersonIds` (the moved
people: both seat occupants, a whole section, or both whole teams); copy reads the copied
instrument occupants. A pair can only be ADDED for a person whose seat list changed, and a
person absent from the read (unchanged seats) is judged unmarked on BOTH sides, so it adds
nothing.

Every transaction already asserts `ifRevisionId` on the very revisions loaded here, so the
before-state judged is the one overwritten; a concurrent edit fails the transaction (409) as
today. The flag itself is read outside the transaction: a «Canta y toca a la vez» untick that
lands between the read and the commit is not seen. Accepted: the flag is edited by hand, a few
times a year, and the client gate already judged the same roster.

### D3b — The month confirm refuses a clash BEFORE the fairness records (client)

Auto can produce a clash in normal use, not only through a flag race: the solver is not told
about instrument cells already on the board (pins are voice rows only, `v3SolveRequest.ts:127-155`),
hand-placed instrument cells survive the fill (`instrumentFill.ts:128-130`), and ADR-0078 says a
pinned drummer the solver puts in Coro «is caught by the grid's ⚠ instead». Nothing between that ⚠
and «Crear» refuses. With the server guard alone, the draft would be refused with 400 AFTER
`runV3ConfirmAttempt` has written the month's fairness records — the month left incomplete,
later months blocked, a count line with no reason, and «Reintentar» repeating the refusal.

So `runV3ConfirmAttempt` (`v3ConfirmRun.ts:57`) gains a third pre-write guard, beside the two it
already has (past month, drafts outside the horizon) and before step 2 (records): when any
creatable draft NOT yet in `state.createdLocalIds` holds a clash
(`addedSeatClashes(null, seatsOf(draft), marked)`, `marked` = the ids whose `members` entry
has `singsAndPlays: true`), return `{ kind: "refused_guard",
reason: "seat_clash", lines: [one line per clash], retry: false }` — nothing written. Drafts
already created are skipped: they exist as services now, the server judges any later edit to
them, and a flag unticked after their creation must not block the rest of the confirm forever.
The line is v3 copy, so it lives in `v3Copy.ts` (`V3_LINES.seatClash(dateLabel, sentence)`);
only the sentence comes from `seatClashSentence(name, clash)`, the name from `members` below.

`refused_guard` today has two causes (past/ceiling month, drafts outside the horizon) and its
callers re-derive which one from `confirmGuard` — `apply_schedule` prints «{Mes} ya pasó…
Vuelve a correr solve_month» for anything that is not a ceiling (`applySchedule.ts:385-391`),
which would be false for a clash and would send the model to re-solve. So the result gains a
discriminator, `reason: "past" | "ceiling" | "outside_horizon" | "seat_clash"`, set by each
guard, and both callers branch on it instead of recomputing: `MonthGenerator.afterV3Attempt`
already shows `result.lines`; `apply_schedule` shows `result.lines` for `seat_clash` (names and
seat labels only) plus `L.noWriteThisCall` (nothing was written, as in its ceiling branch), with
`code: "invalid_request", detail: "seat_clash"` and no `next: "solve_month"`. The way out it
names is the proposal's: edit it (`revise_proposal`, then `apply_schedule` again) or re-solve —
a fix in /admin does not change a stored MCP proposal. It keeps its current lines for
`past`/`ceiling`, and for `outside_horizon` uses `V3_LINES.draftsOutsideHorizon` (today it
wrongly says «ya pasó» there too).

Its input gains `members: ReadonlyMap<string, { name: string; singsAndPlays: boolean }>` — the
flag for the judgement AND the name for the line, so no line ever falls back to an id (on the
MCP that would put member ids on the wire, ADR-0062). The callers build it from the members they
already hold (`MonthGenerator.confirmV3` from `adminMembersQuery`, which projects `singsAndPlays`
since #217; `apply_schedule` from the member list it already loads (`sources.members`,
`applySchedule.ts:~300`), its projection extended with `singsAndPlays` where it lacks it). A
person missing from the map is judged unmarked (the refusal side — the server guard would refuse
the same draft) and named «alguien que ya no está en Miembros». The client map comes from
`adminMembersQuery`, which lists worship members only, so a marked person outside Alabanza would
be refused by the pre-check though the server would allow it — the safe direction, and no such
person sits in a worship roster today (a worship seat needs a Tipo). v2's `handleConfirm` (`MonthGenerator.tsx:4749`, rollback engine) gets
the same check before its first write. The server guard stays the backstop.

### D4 — Refusal shape: `invalid_request` (400), with a machine detail

`serviceError("invalid_request", { details: { issues: ["seat_clash"], seatClashes: [...] } })`,
each entry `{ memberId, name, seats: [labelA, labelB], sentence }` — `sentence` is
`seatClashSentence` built on the server, so no client rebuilds it (D5). Every renderer below
prints `sentence` (and `name`/`seats` where it lists), never `memberId`.

- **Why not a new code:** three client maps decide «proven pre-write failure» vs «unknown
  outcome» by code (`plannerSaveModel.ts:207` `PROVEN_PREWRITE_FAILURES`;
  `MonthGenerator.tsx:345,355` `SWAP_/CREATE_PROVEN_PREWRITE_FAILURES`, which also pin the
  status). An unlisted code is classified `unknown`, which sends the planner into its
  unknown-outcome recovery for a write that provably never happened. `invalid_request`/400 is in
  all three already, so no client can misclassify the refusal, and no list needs a lockstep edit.
- **Why not `integrity_conflict`/409:** a 409 means «your view is stale — reload»
  (`serviceMutation.ts:5-6`); reloading changes nothing here, and its copy («sus datos no
  cuadran») blames the stored data.

### D5 — The words the person reads

One Spanish sentence, built in ONE place — a new `seatClashSentence(name, clash)` in
`app/utils/seatClashGuard.ts`, run on the server into each refusal entry's `sentence` (D4) and
by D3b's client pre-check. Its «para cantar y tocar…» clause is ONE exported constant
(`SINGS_AND_PLAYS_HINT` in `seatModel.ts`) that `clashReason` (`candidateRanking.ts`) uses too,
so the two wordings cannot drift:
«Tony quedaría en Coro y Drums en el mismo servicio; para cantar y tocar en un servicio, marca
«Canta y toca a la vez» en Miembros.» (the second clause only for voz + instrumento, like
`clashReason`). The same seat twice reads «Tony aparece dos veces en Lead en el mismo
servicio.», never «en Lead y Lead».

**Every surface that renders one of the four writers' refusals shows the sentence** — not only
the ones a C2-skipping path is known to reach today. The premise "this path already judged C2,
so it only meets the guard through a race" was false twice in review (Auto, «Copiar a todo el
mes»); a surface that shows the sentence does not depend on it. Each prints the sentence(s)
INSTEAD of its generic `invalid_request`/`ISSUE_COPY` wording when `seatClashes` is present,
never both:

- **The planner's stored save** (`MonthGenerator.tsx:3600-3629`; also «Editar servicio»,
  ADR-0063). `classifyPatchOutcome` (`plannerSaveModel.ts:223`) keeps, on a `knownFailure`,
  the sentences of a well-formed `details.seatClashes` (`{ kind: "knownFailure", code,
  seatClashSentences?: string[] }`; malformed or absent → none). The save loop collects
  `{date}: {sentence}` per refused column into a new state, `saveClashLines`, set beside
  `saveKnownFailures` (`MonthGenerator.tsx:3622`) and cleared everywhere it is cleared (3041,
  3589). The save ends on one of THREE notices that report refused columns, and all three
  append those lines: the all-refused line (3629, «N servicio(s) fue rechazado antes de
  escribir…»), and — when some columns were sent, so the loop reloads and the reconciliation
  effect writes the notice — both reconciliation lines (3038 «Se verificaron …; N fue
  rechazado…» and 3039 «Cambios guardados y verificados. N servicio(s) fue rechazado…»), which
  today read only the count. One pure helper in `plannerSaveModel.ts`,
  `storedSaveNotice({ applied, maintenance, knownFailures, clashLines })`, builds all three, so
  no branch can drop them. The mixed save is the usual case: «Copiar a todo el mes» dirties
  every other column and only the ones where the person already sings are refused. This is the
  line an admin sees after «Copiar a todo el mes» copies a drummer onto Sundays where they sing; the
  grid's ⚠ already flags those cells before «Guardar». The copy itself is unchanged: making it
  skip or name clashing columns would fix one path, while the save line covers every path that
  reaches PATCH.
- `mutationErrorMessage` (`serviceMutationErrors.ts`): a branch before the `invalid_request`
  case when its input's new optional `seatClashes` field is non-empty. `ServicesPanel`'s
  `describeMutationError` (`ServicesPanel.tsx:142-153`) parses `body.details.seatClashes`
  beside `dependencies` and passes it — on the card the only seat-writing call is
  copy-instruments (`ServicesPanel.tsx:584-597`).
- The planner's swap refusal toast: both stored swaps it offers (team, `MonthGenerator.tsx:3835`,
  and section, 3962) go through `handleRejectedStoredSwap` (3748-3772, «No se intercambiaron …
  (code)»); one change there shows the sentence instead of the bare code.
- MCP, each emitting names, seat labels and sentences only — `memberId` never reaches the wire
  (members are tokens or names on the MCP, ADR-0062):
  - `refusalFor` (`app/mcp/writes/refusals.ts`) gains a branch for `details.seatClashes`
    (`swap_assignment`'s path) that LEADS with the sentence(s) instead of
    `CODE_COPY.invalid_request`;
  - `serviceRefusalLine` (same file, `apply_schedule`'s per-draft line, `applySchedule.ts:185`):
    the same branch, so it never prints «Detalle técnico: seat_clash»; `ISSUE_COPY` gains a
    `seat_clash` entry used ONLY when `seatClashes` is absent;
  - `copy_instruments` (`serviceEditor.ts:~1108`, `S.copy.recheck(S.reason[code])`) and the
    stored-save result lines (`save_service_edits`, `v3Copy.ts` `notSavedRecheck(reason)`): the
    sentence as the reason when the refusal carries `seatClashes`.
  - `create_service` always sends an empty roster, so it can never meet the guard; unchanged.
- Any path that does not read the detail shows its existing `invalid_request` copy —
  never «saved».
- **The one stated exception:** the month confirm's per-month count lines (v3 and v2), after a
  draft POST refused by the server guard. D3b refuses every clash before the first write with
  the sentence, so the server only refuses a confirm draft through a flag race between the
  pre-check and the POST (§6); those lines stay as today.

### D6 — Out of scope (stated so nobody "fixes" it)

- **Studio** stays an escape hatch: role documents edited there run no server rule today
  (referential or otherwise), and a Studio validation that queries members is a separate
  decision. The planner grid's ⚠ still flags whatever Studio writes.
- **Publishing** a roster that already holds a clash is not blocked (publish-ready writes no
  seats); a readiness blocker and the member-facing ⚠ (DayCard/`/schedule`, ADR-0078) remain
  the open follow-up.
- **Grandfathered clashes** are not reported by the guard; the grid's ⚠ is where they show.

## 4. Tasks

1. **Pure guard** — `app/utils/seatClashGuard.ts`: `addedSeatClashes`, `seatClashSentence`,
   seat-label helper. Tests (`app/utils/__tests__/seatClashGuard.test.ts`): create (null before)
   refuses Coro+Drums for an unmarked member and allows it for a marked one; an edit that keeps
   an old Coro+Drums pair and changes the console adds nothing; adding Bass to that member adds
   two pairs; same seat twice → `(lead, lead)`; Lead+BGV (same category) refused even when
   marked; FOH + voice allowed; removing one side of an old pair adds nothing; output order is
   stable.
2. **Member read** — `singsAndPlays` in `CANONICAL_MEMBER_PROJECTION`; `loadCanonicalMembers`
   in `roleWriteOps.ts`; `loadCanonicalMemberIds` wraps it. Update any test that pins the
   projection string.
3. **Four writers** — call the guard per D3; refuse per D4. Writer tests, mocked client as
   they do today, in the existing files: `app/api/__tests__/roleWriteRoutes.test.ts` (PATCH and
   create), `app/api/__tests__/roleSwapRoutes.test.ts` (swap and copy-instruments routes),
   `app/utils/__tests__/roleSwapCommit.test.ts`, and the MCP callers'
   `app/mcp/tools/__tests__/serviceCopy.test.ts`, `swapAssignment.test.ts`,
   `applySchedule.test.ts` (`createService.test.ts` stays unchanged: empty roster). Cases:
   refuses an added clash with the D4 body (entries carry `sentence`) and makes NO
   transaction/coordination call; allows a marked member; allows an edit to a roster with a
   grandfathered clash; `createRole` replay of an existing receipt is not refused; swap
   section/team/seat each judged on both roles.
4. **Coverage guard** — `app/utils/__tests__/seatClashGuardCoverage.test.ts`: each of the four
   writer modules calls `addedSeatClashes(` and the call precedes, in source order, its first
   occurrence of every call that writes or precedes its writes — `resolveOwnedCoordination(`,
   `bootstrapLegacyLock(`, `loadSpecialIdentityCoordinator(`, `loadTargetOccupancy(`,
   `.transaction(` (editRole's first write is the legacy bootstrap, not coordination), scanning
   the source with comments and import lines stripped (several of these files name the calls in
   prose); and that the guard call sits inside the writer's exported function body; a list of the
   non-seat writers (§2) is pinned so a NEW `*Commit.ts` must be classified (fails until added
   to one list or the other).
5. **Month confirm (D3b)** — the guard and the `reason` discriminator in
   `runV3ConfirmAttempt`, v2's `handleConfirm`, and both callers' branches. Tests
   (`v3ConfirmRun.test.ts`): a draft with an unmarked Coro + Drums returns `refused_guard` with
   `reason: "seat_clash"` naming the person (from the `members` map, never the id; a person
   missing from the map gets the fallback wording) and both seats, and `putRecords`/`postDraft` are
   never called; the same draft with the member marked proceeds; a retry after records landed
   (`state.recordsDone`) with an uncreated clash draft still refuses before posting; a clash in
   an already-created draft is skipped; each existing guard sets its own reason. `apply_schedule`
   tests: a clash proposal answers the clash line plus `L.noWriteThisCall`, `code:
   "invalid_request"`, no «ya pasó» line, no `next: "solve_month"` and no member id anywhere in
   `content`/`structuredContent`; an outside-horizon refusal answers
   `draftsOutsideHorizon`; past/ceiling answers unchanged.
6. **Copy** — D5's surfaces, with tests: `classifyPatchOutcome` keeps the sentences of a
   well-formed `seatClashes` and none of a malformed one (`plannerSaveModel.test.ts`); the
   stored save's notices list `{date}: {sentence}` in all three branches of `storedSaveNotice`
   — all refused; mixed (one column saved, one refused for a clash: the reconciliation line
   keeps «Cambios guardados y verificados.» and adds the sentence); mixed with a maintenance
   column — and the lines clear on the next save; `mutationErrorMessage` with `seatClashes`; `refusalFor` and `serviceRefusalLine`
   with `seatClashes` emit the sentence, not the `ISSUE_COPY`/`CODE_COPY` fallback, and no
   `memberId`/document id anywhere in `content` or `structuredContent`; `copy_instruments`' and
   the stored-save result lines; same seat twice reads «aparece dos veces en»; `clashReason`
   and `seatClashSentence` share the hint constant. The grid's ⚠ tests stay green on
   `clashingPairs`.
7. **Docs, same delivery** — ADR-0078 Consequences (server writers now refuse an ADDED clash;
   Studio and publish stay open; the diff rule and why); CLAUDE.md + AGENTS.md (identical line,
   `agentDocsParity`): the `seatsClash` util line gains «the four seat writers refuse a clash
   the write ADDS (`addedSeatClashes`)»; `docs/agents/project-rules.md` long form;
   `docs/UTILITIES_AND_COMPONENTS.md`; `docs/API_REFERENCE.md` (the 400 `seat_clash` detail on
   the four routes).

## 5. Verification and release

- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors). No solver tree touched.
- One merge-range code review (§Review policy); a fix that closes a HIGH finding (this is a
  production writer) gets the scoped re-review.
- Dev: merge into `preview`, verify the dev alias + SHA. **No live clash attempt on dev** —
  `preview` writes to the production dataset, so a guard that failed open would store a real
  clash on a real service. The refusal is proven by the writer tests; the dev step is the alias
  check, said so in the PR. Clean writes keep their existing coverage (the writers' current
  tests stay green unchanged except where they pin the member read).
- PR to `main`, `gates` green, merge, verify the prod alias.
- Rollback: revert the PR; the guard writes nothing and stores nothing.

## 6. Risks

- **A legitimate roster now refused:** only a pair the write ADDS, for an unmarked member, in a
  seat combination the planner's own C2 already refuses where it judges — the server now says
  what the client says there. Admins meet it where the client never judged: swap,
  copy-instruments, «Copiar a todo el mes» followed by «Guardar», and Auto (D3b). Each of those
  shows the sentence naming the person and both seats (D5), and the grid's ⚠ flags the stored
  cells before «Guardar».
- **Auto confirm meets a clash:** in normal use (a hand-placed instrument plus a solver voice),
  D3b refuses the whole confirm before any record or draft is written and names the person and
  seats; the admin fixes the cell the grid already flags and confirms again. The server guard
  only sees a confirm draft through a flag race between the pre-check and the post, where the
  draft fails with today's per-month counts.
- **Copy drift:** one sentence builder; the coverage of D5's surfaces is by test.

## 7. Post-approval changes (un-reviewed)

Added after rounds 6 and 7 approved §1–§6 (digest `c232751d…5450`), from their non-blocking
notes, each checked against the code. They narrow or complete what §3 says; none changes a
decision. Where §3 and this section differ, this section wins.

1. **The stored save: every notice, not three.** All the stored save's notices go through
   `storedSaveNotice` and append `saveClashLines` when any exist — also «No se pudo verificar la
   recarga…» (`MonthGenerator.tsx:3626`), «otra edición lo reemplazó» (3043), «No se pudo
   confirmar el resultado» (3045), and a save that stops at an unknown transport (the loop's
   `break`, 3619) after earlier clash refusals.
2. **v2's confirm line is v2's.** v2's `handleConfirm` prints `seatClashSentence` output
   directly (with the date), never `V3_LINES.seatClash`: the two engines' copy is never crossed
   (CLAUDE.md, solver v3 C6).
3. **`seatsOf(draft)` drops blank slots** exactly as `draftCreateBody` does
   (`monthDraftCreate.ts:95-96`: an instrument or FOH entry without a label or a person), so the
   pre-check judges the roster the server would receive.
4. **The confirm's `seat_clash` refusal after records landed** appends `monthReportLines` like
   the existing guards (`v3ConfirmRun.ts:75`); pinned in `v3ConfirmRun.test.ts`.
5. **`apply_schedule`'s `seat_clash` branch** keeps `existsLine(proposal, obs)` and the
   `stateSaveFailed` tail like its other branches. It names `revise_proposal` as the way out only
   when nothing of the proposal was created yet (`obs.created.size === 0`); once it started
   applying, `revise_proposal` refuses (`proposalEditor.ts:263`, `started_applying`), so the
   line says to re-solve. Tests: both wordings; and a resumed apply after an admin deleted a
   draft it had created (that draft is judged again — harmless, pinned).
6. **A stale member list in /admin:** the D3b line in `MonthGenerator` adds «si acabas de marcar
   «Canta y toca a la vez», recarga la página» — the pre-check reads the members loaded with the
   page, as the picker does.
7. **No empty name on the server:** a member whose alias and `member_name` are both blank is
   named with the same fallback wording as D3b, in `seatClashes[].name` and the sentence.
8. **One more MCP surface:** the saved-month editor's refused move group (`notSavedGroup`,
   `serviceEditor.ts:~1346`) shows the sentence as its reason when the refusal carries
   `seatClashes`, like `notSavedRecheck`.

## 8. Implementation notes (where the build differs from the text)

- **`clashInputsOf` and `memberDisplayName` live in `seatClashGuard.ts`** (pure), not
  `roleWriteOps.ts`: a test that mocks the read module must not lose the guard's helpers.
  `loadCanonicalMembers` stays in `roleWriteOps.ts`.
- **The confirm's draft check reads the server's own normalization** (`normalizeSeats` over
  `draftCreateBody`), shared by both engines as `draftSeatClashSentences` in `monthDraftCreate.ts`;
  that is §7.3's "drop blank slots exactly as `draftCreateBody` does", by construction.
- **§7.5, the deleted draft:** a draft `apply_schedule` created and an admin then deleted stays in
  `obs.created` (its receipt), so the pre-check does NOT judge it again; it is reported deleted and
  never re-posted, as before. Pinned as such in `applySchedule.test.ts`.
- **§7.8, `notSavedGroup`:** the services of a move group that were not saved are not themselves
  refused; the one the server refused carries the sentence (`notSavedRecheck`'s reason), and the
  group lines keep pointing at it. No separate sentence on `notSavedGroup`.
- **The MCP reason clause** drops the sentence's final stop, since the copy around it adds its own.

