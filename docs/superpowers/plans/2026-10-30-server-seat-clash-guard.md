# Server seat-clash guard — the role writers refuse a clash they would ADD

**Status:** plan, awaiting Frank's OK. Owner thread: «Corregir a Tony en coro y batería».
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
  `blockedReason`. Not where the SOLVER chooses a voice: it does not see instrument cells
  already on the board, so a hand-placed drummer it puts in Coro reaches «Crear» with only the
  grid's ⚠ (ADR-0078, Rejected) — see D3b.
- **Server side** checks referential integrity only. `editRole` says so in a comment
  (`roleEditCommit.ts:116-118`: «referential validation only; memberType remains UI guidance,
  not server policy»). Four protected writers change seats:

  | Writer (`app/utils/`) | Route / MCP caller | Before-state | After-state |
  |---|---|---|---|
  | `roleEditCommit.editRole` | `PATCH /api/admin/roles/[id]`; MCP `save_service_edits` (+ app twin), «Editar servicio» | `normalizeStoredSeats(role)` | `request.seats` |
  | `roleCreateCommit.createRole` | `POST /api/admin/roles`; MCP `apply_schedule`, `create_service`; Auto confirm | none | `request.seats` |
  | `roleSwapCommit.swapRoles` | `POST /api/admin/roles/swap`; MCP `swap_assignment`; card swap | per role, `normalizeStoredSeats(role)` | per role, `afterSeatsOf` / replacements (already computed, lines 251-312) |
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
  per roster). The 2026-11-29 fix is a separate, consented write in this thread.

## 3. Decisions

### D1 — Refuse only clashes the write ADDS (diff), not every clash in the result

A write is refused when its after-state holds a clashing seat pair that its before-state did
not hold. A pair is `(memberId, seatIdA, seatIdB)` with the two seat ids sorted; seat ids are
the planner's (`lead`, `bgv`, `coro`, `instrumento:<normalizeSeatName(label)>`,
`foh:<label>`), one entry per occurrence, so the same person twice in one seat is the pair
`(lead, lead)` and clashes (same category). Both sides are judged with the member's CURRENT
flag.

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
  `Map<id, { singsAndPlays: boolean; name: string }>` (name = alias ?? member_name, for the
  message). `loadCanonicalMemberIds` stays as a wrapper over it (its fifth caller,
  `app/mcp/tools/editSetlist.ts`, is unchanged). No extra round trip.
- Only `singsAndPlays === true` counts as marked (same as `seatsClash`); absent = unmarked.

### D3 — Where each writer calls it: read-only stage, before ANY write

Each writer calls `addedSeatClashes` right after its dangling-reference refusal and before
anything that can write — `resolveOwnedCoordination` (legacy-lock bootstrap commits), the
special-identity coordinator, the occupancy inventory, the transaction:

- **editRole:** after `loadRoleForWrite` and the stored-type checks (`roleEditCommit.ts`
  ~line 170), before the dependency inventory and the bootstrap at ~line 236; the member read
  moves from line 120 to cover `seatAssignees(request.seats)` exactly as now. Before =
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
creatable draft holds a clash (`addedSeatClashes(null, seatsOf(draft), singsAndPlays)`), return
`{ kind: "refused_guard", lines: [one seatClashSentence per clash, prefixed by the draft's
date], retry: false }` — nothing written. Its input gains `singsAndPlays: ReadonlySet<string>`,
built by the callers from the members they already hold (`MonthGenerator.confirmV3` from
`adminMembersQuery`, which projects `singsAndPlays` since #217; `apply_schedule` from the member
list it already loads (`sources.members`, `applySchedule.ts:~300`), its projection extended with
`singsAndPlays` where it lacks it). A person missing from the list is judged unmarked (the
refusal side — the server guard would refuse the same draft). v2's `handleConfirm` (`MonthGenerator.tsx:4749`, rollback engine) gets
the same check before its first write. The server guard stays the backstop.

### D4 — Refusal shape: `invalid_request` (400), with a machine detail

`serviceError("invalid_request", { details: { issues: ["seat_clash"], seatClashes: [...] } })`,
each entry `{ memberId, name, seats: [labelA, labelB] }`.

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

One Spanish sentence, built in ONE place — a new `seatClashSentence(clash)` in
`app/utils/seatClashGuard.ts`. Its «para cantar y tocar…» clause is ONE exported constant
(`SINGS_AND_PLAYS_HINT` in `seatModel.ts`) that `clashReason` (`candidateRanking.ts`) uses too,
so the two wordings cannot drift:
«Tony quedaría en Coro y Drums en el mismo servicio; para cantar y tocar en un servicio, marca
«Canta y toca a la vez» en Miembros.» (the second clause only for voz + instrumento, like
`clashReason`). Shown by:

- `mutationErrorMessage` (`serviceMutationErrors.ts`): a branch before the `invalid_request`
  case when its input's new optional `seatClashes` field is non-empty. `ServicesPanel`'s
  `describeMutationError` (`ServicesPanel.tsx:142-153`, the card's copy-instruments and edit
  flows) parses `body.details.seatClashes` beside `dependencies` and passes it.
- The planner's two swap toasts (`MonthGenerator.tsx` ~3763 seat/section swap «No se
  intercambiaron … (code)», and the column swap ~3962) show the sentence instead of the bare
  code when the refusal carries `seatClashes`.
- MCP, every surface that renders one of the four writers' refusals, each emitting names and
  seat labels only — `memberId` never reaches the wire (members are tokens or names on the MCP,
  ADR-0062):
  - `refusalFor` (`app/mcp/writes/refusals.ts`) gains a branch for `details.seatClashes`
    (`swap_assignment`'s path);
  - `serviceRefusalLine` (same file, `apply_schedule`'s per-draft line, `applySchedule.ts:185`):
    the same branch, so it never prints «Detalle técnico: seat_clash»; and `ISSUE_COPY` gains a
    `seat_clash` entry as the fallback when the detail is absent;
  - `copy_instruments` (`serviceEditor.ts:~1108`, `S.copy.recheck(S.reason[code])`) and the
    stored-save result lines (`save_service_edits`, `v3Copy.ts` `notSavedRecheck(reason)`): the
    sentence as the reason when the refusal carries `seatClashes`.
  - `create_service` always sends an empty roster, so it can never meet the guard; unchanged.
- **Not changed:** the planner's stored save (`MonthGenerator.tsx:3613-3629`, «N servicio(s)
  fue rechazado antes de escribir; tus cambios siguen pendientes.», also «Editar servicio»).
  Every seat it writes went through C2 (picker, drag, fill), so it reaches the guard only
  through a flag race (D3); its count line stays true. The month confirm is handled by D3b.
- Any path that does not read the detail shows its existing `invalid_request` copy —
  never «saved».

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
3. **Four writers** — call the guard per D3; refuse per D4. Writer tests (each writer's
   existing `__tests__` file, mocked client as they do today): refuses an added clash with the
   D4 body and makes NO transaction/coordination call; allows a marked member; allows an edit
   to a roster with a grandfathered clash; `createRole` replay of an existing receipt is not
   refused; swap section/team/seat each judged on both roles.
4. **Coverage guard** — `app/utils/__tests__/seatClashGuardCoverage.test.ts`: each of the four
   writer modules calls `addedSeatClashes(` and the call precedes, in source order, its first
   occurrence of every write-capable call it makes — `resolveOwnedCoordination(`,
   `bootstrapLegacyLock(`, `loadSpecialIdentityCoordinator(`, `loadTargetOccupancy(`,
   `.transaction(` (editRole's first write is the legacy bootstrap, not coordination); a list of the
   non-seat writers (§2) is pinned so a NEW `*Commit.ts` must be classified (fails until added
   to one list or the other).
5. **Month confirm (D3b)** — the guard in `runV3ConfirmAttempt` and v2's `handleConfirm`.
   Tests (`v3ConfirmRun.test.ts`): a draft with an unmarked Coro + Drums returns
   `refused_guard` naming the person and both seats, and `putRecords`/`postDraft` are never
   called; the same draft with the member marked proceeds; a retry after records already landed
   (state.recordsDone) with a clash draft still refuses before posting. `apply_schedule` passes
   the flag set (its test covers the refusal line).
6. **Copy** — D5's surfaces, with tests: `mutationErrorMessage` with `seatClashes`;
   `refusalFor` and `serviceRefusalLine` with `seatClashes` emit the sentence and no
   `memberId`/document id anywhere in `content` or `structuredContent`; `copy_instruments`' and
   the stored-save result lines; `clashReason` and `seatClashSentence` share the hint constant.
   The grid's ⚠ tests stay green on `clashingPairs`.
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
  seat combination the planner's own C2 already refuses — the server now says what the client
  already said. The one new place admins meet it is swap/copy, which never judged it.
- **Auto confirm meets a clash:** in normal use (a hand-placed instrument plus a solver voice),
  D3b refuses the whole confirm before any record or draft is written and names the person and
  seats; the admin fixes the cell the grid already flags and confirms again. The server guard
  only sees a confirm draft through a flag race between the pre-check and the post, where the
  draft fails with today's per-month counts.
- **Copy drift:** one sentence builder; the coverage of D5's surfaces is by test.
