# Plan: «Opciones que rompen una regla» when nobody passes (availability proposals)

**Date:** 2026-11-05 · **Builds on:** ADR-0079 (`docs/adr/0079-…`), plan
`2026-10-29-availability-conflict-resolver.md` · **Critical slice:** §4 («Aplicar de todos modos»).

## 1. The requirement (Frank, verbatim, 2026-11-05)

Context: `/admin › Disponibilidad` showed «Rachel no puede el Domingo 15 nov (publicado). Lead: Nadie
disponible pasa las reglas. Reasígnalo a mano en Servicios.» After the explanation (every «Líder
Domingo» person is away, already on that service, or already leads another Sunday that month, so each
would break v3's «one Sunday Lead a month» protection), Frank asked:

> «Sí, mejora el solver y que entregue 2 o más propuestas y explique por qué rompen las reglas»

Read as: when the resolver finds no rule-clean replacement for a voice seat, it still offers two or
more options (when they exist), each with the rules it breaks in plain Spanish, and Frank can apply
one deliberately.

## 2. What exists (premises, with pointers)

- `proposeReplacement` (`app/utils/availabilityConflicts.ts`) judges each held seat: candidates from
  `seatCandidates` (`eligible`, not `alreadyAssigned`, worship, an instrument declared), ordered, at
  most `MAX_TRIED_PER_SEAT` = 8, through `judge`: (0) weekend voice on the month's v3 eligibility,
  (a) `judgeTarget` adds/reforces no finding, (b) `compareVerdicts(baseline, after)` — no new rule
  instance, no grown `<=`/`==` count, no new or grown missed protection. Then `moveUp` (a singer from
  a lower voice row of the same service, ≤ 6 movers × 8 fillers). No pass on a voice seat →
  `{ kind: "none", reason: "no_candidate" }`.
- `applyAvailabilityFix` (`app/utils/availabilityFixCommit.ts`) re-reads (`readJudgeable`), requires
  the conflict, `isEditable`, `conflict.roleRev === input.rev`, the replacement rows = held rows (+1
  for a moved-up singer), re-runs `propose(…, { only: wanted })`, requires `kind: "replace"` with
  EXACTLY the wanted seats, then `editRole(roleId, parseEditRequest({...target, rev}), { notices:
  "deferred" })` (unchanged, ifRevisionId on `rev`), then records `applied` (bookkeeping only).
- `readConflictPanel` computes options on each GET under `PANEL_BUDGET_MS` = 30 s.
- The sweep stores `none`/`no_candidate` records and emails «Sin reemplazo».

## 3. The fallback search (pure, `availabilityConflicts.ts`) — standard risk

New export `proposeFallbacks(input: ProposeInput & { nameOf }) → { kind: "options"; options:
FallbackOption[] } | { kind: "none"; reason: NoneReason }`, where
`FallbackOption = { target: ServiceTarget; seats: SeatChange[]; breaks: Break[] }` and
`Break = { key: string; line: string }`.

1. Same preconditions as `proposeReplacement` (not editable / past / no config → `unchecked`; a
   worship-night song lead → `song_lead`; holds nothing → `unchecked`). It only runs for a person
   holding a VOICE seat (a person holds at most one: same-category clash, ADR-0078); otherwise
   `none`/`no_candidate`.
2. `baseline = verdictOn(board with the person removed from the voice seat)`; not judged →
   `unchecked`.
3. **Builds for the voice seat**, each a board plus seat changes:
   - **direct:** `relaxedCandidates` = the same `serverPickCandidates` list and filters as
     `seatCandidates`, except `ruleBlockedReason` is allowed (a personal rule may be broken, as the
     planner's «Asignar de todos modos»). Still required: `available` (never someone else who
     marked that day), no `blockedReason` (a seat clash, never forceable), not `alreadyAssigned`,
     worship, the seat's Tipo (the list's own filter), not the absent person. BEFORE the limit
     (weekend), only who could stand there: on the month's v3 eligibility for that seat (it does
     not depend on the seats; read from `baseline`), or blocked there by a personal rule (step 5
     decides whether that rule is what keeps them off) — else low-load singers off the lists would
     use up the tries. At most 8, in `orderedPool` order. The same pre-filter applies to the movers
     (for the vacant seat) and the fillers (for the seat they leave).
   - **move up:** as `moveUp` (lower voice rows, never a song lead, never a row the person holds),
     the mover qualifying through `relaxedCandidates` for the vacant row once their seat is freed;
     the seat they leave is filled by the filler with the FEWEST breaks among the first 3 strict
     `seatCandidates`, or, when the strict pool is EMPTY, the first 3 `relaxedCandidates`. At most
     6 movers. A person holding two voice seats (legacy data) gets `none`/`no_candidate`.
4. Every non-voice seat the person also holds is then resolved as `proposeReplacement` does (first
   of at most 8 candidates whose service judgement passes, else left empty), with ONE difference:
   «passes» means the final target adds or reforces no finding BEYOND those the voice build itself
   adds or reforces (judged on the voice build alone). Otherwise the voice taker's own broken rule
   would reject every bassist and empty the seat although a clean one exists.
5. **Breaks of a build** (`breaksOf`, on the FINAL board), each with a stable key:
   - service: `judgeTarget` on the final target; a refusal (`ok: false`) DROPS the build (a seat
     clash, an unknown row: never offered). Otherwise each `added` and `reforced` finding
     (`s:<findingKeyText>`), its line built from the rule in the rules card's Spanish
     (`ruleCopy.ts`: «Oto: su regla «No líder en domingo».», «La regla «A y B no coinciden…»: quedan
     juntos.»), the finding's own sentence as a fallback.
   - month gate: every instance in `after` not in `baseline` (`i:<family>|<rule>|<scope>|`), every
     `<=`/`==` count instance whose `observed` grew (`i:…|<observed>`), every missed protection new
     or grown (`m:<code>|<person>|<scope>|<count>`). Lines via `v3Copy` (`missedLine`, `E.count`,
     `E.presence`, `E.pair`). A `pair` instance scoped to THIS service is left to the service pair
     finding when there is one (one line per broken rule). `after` not judged or `ruleIds`
     differing → the build is DROPPED.
   - eligibility (weekend): every newly seated voice — the direct taker, the moved-up singer in
     their NEW seat, the filler — must be on the month's v3 eligibility for that role on this
     service, unless a per-seat exclusion or week exclusion finding for that same person and row
     explains it (that finding is the line). Otherwise the build is DROPPED: someone off the
     solver's lists (a «Soporte» singer as Lead) is never offered.
   - A build with NO breaks is DROPPED (it can arise only from the strict and relaxed pools'
     different `orderByEffectiveLoad` medians; it is never carried as a waiver option, and the
     strict search stays the only source of clean proposals).
   - A build with more than 32 breaks is DROPPED (the route caps `waive` at 32).
6. Options: builds deduplicated by seats, sorted by number of breaks, then number of people
   changed, then the voice-seat taker's voice seats that month (fewer first), then search order.
   At most 4. Two or more whenever the search finds two. The panel passes its deadline; past it the
   search stops building and returns what it has (the writer's replay passes none).
7. Copy: the break lines come from `v3Copy.ts` (month gate) and `ruleCopy.ts` (personal rules);
   the panel's own sentences live in `AvailabilityProposals.tsx`, the email's in
   `availabilityConflictEmail.ts`, as today.

## 4. «Aplicar de todos modos» — CRITICAL (a production writer's gate)

`POST /api/admin/availability-conflicts/apply` body gains optional `waive: string[]` (1 to 32
non-empty strings, deduplicated by the route; an empty array is a 400). Without `waive` nothing
changes.

With `waive` (`applyAvailabilityFix`):
1. Everything before the propose step is unchanged (fresh `readJudgeable`, conflict still there,
   `isEditable`, `roleRev === rev`, rows = held (+1), the ledger read).
2. It FIRST runs the strict `propose(…, { only: wanted })`. If that answers `replace` with the wanted
   seats, the option is now rule-clean: refuse `409 refused/changed` (the panel reloads and shows it
   as a normal proposal; a waiver is never stretched over a clean change).
3. Otherwise `proposeFallbacks(…, { only: wanted })` on the same read. Refuse `409 refused` unless it
   answers exactly one option whose seats equal the wanted seats (same rule as today) AND whose
   break-key SET equals the `waive` set exactly — a missing, extra or changed break (another
   service moved, a count grew) is `changed`, never applied. An empty re-derived break set is
   refused too (step 2 already covers a clean change). `only` makes the search consider only the
   wanted taker(s), so the reproduction is deterministic on one read; under `only` the filler may be
   any relaxed candidate, not just the first 3 the panel tried — accepted, since every person it can
   name is one the admin could seat by hand in Servicios, and the breaks must still match exactly.
   Accepted too: the writer does not look for a NEW rule-clean option for someone else that appeared
   between the panel's read and the click; the admin chose this option with these breaks.
4. Then the SAME tail as today: `parseEditRequest({...option.target, rev})` → `editRole` (unchanged:
   auth already done by the route's `conflictAdmin`, `ifRevisionId` on `rev`, seat-clash guard,
   notices deferred, the usual emails on a published service), then the `applied` record, which also
   stores `waived: string[]` (the keys) so the record says the change was knowingly made against
   rules. The field joins the Studio schema (`sanity/schemas/availabilityConflict.ts`). The sweep's
   transitions, «Mantener» and «Deshacer» unset both `appliedBy` and `waived`, and a strict
   «Aplicar» unsets `waived`, so a re-opened record never keeps them. `MonthCheckVerdict` gains
   optional `ruleLabels`/`serviceLabels` (from the builder) for the lines.

Why this is safe: the waiver is the exact set the person was shown, re-derived on a fresh read under
the same role `_rev`; anything else fails closed. The writer still cannot leave a voice seat empty,
seat someone unavailable, create a seat clash, or touch any other service. The person is a worship
admin who can make the same edit by hand in Servicios today.

## 5. Panel, email, docs — standard risk

- `PanelConflict` gains `fallbacks?: Array<{ seats: …same shape as options…; breaks: Break[] }>`,
  computed in `readConflictPanel` only when the first proposal is `none`/`no_candidate`, within the
  existing budget (past it: no fallbacks, the current copy). The sweep and its records are unchanged
  (no extra builds on the cron).
- `AvailabilityProposals.tsx`: for such a conflict, «Nadie pasa todas las reglas. Opciones:» then
  each option: the seat run, the break lines (bulleted), and a secondary «Aplicar de todos modos»
  that posts `{…, replacements, waive: option.breaks.map(b => b.key)}`. Existing 409 handling.
- Email «Sin reemplazo» line copy: «nadie pasa todas las reglas; en la app verás las opciones y qué
  regla rompe cada una».
- ADR-0079 updated (Decision + Consequences), `docs/UTILITIES_AND_COMPONENTS.md` if it lists the
  module.

## 6. Tests

- `availabilityConflicts.test.ts`: fixture where every Lead candidate already leads a Sunday →
  `proposeReplacement` = `no_candidate`; `proposeFallbacks` returns ≥ 2 options, each with a
  `sunday_cap_exceeded` line naming the person; an unavailable person is never offered; a seat clash
  is never offered; ordering by break count; `only` reproduces one option.
- `availabilityConflicts.test.ts` also: a singer who also plays bass, replaced by a taker a
  personal rule blocks, with a free bassist → the option names the bassist (§3.4); a build off the
  v3 eligibility is never offered; a personal rule's line comes from `ruleCopy`.
- `availabilityFixCommit.test.ts`: apply with the exact `waive` writes once through `editRole`;
  waive missing a key / with an extra key → 409 and no `editRole` call; waive on a now-clean option
  → 409; naming an unavailable person with matching-looking keys → 409; no `waive` keeps today's
  behaviour; the record stores `waived`, and a sweep transition unsets it.
- Route: invalid or empty `waive` → 400.

## 7. Rollback

Revert the PR. Records with `waived` stay readable (an extra field). There is no switch for the
waiver path short of a revert (`AVAILABILITY_SWEEP_DISABLED` stops the sweeps, not the clicks);
ADR-0079's Consequences says so.
