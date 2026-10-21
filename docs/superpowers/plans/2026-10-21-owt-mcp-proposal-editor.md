# OWT MCP — an interactive editor for a month proposal (plan)

**Status:** DRAFT, 2026-10-21. E5 reshaped after review round 4 (Frank chose the own checker, 01:02Z). Not approved, not authorized.
**Requirement (Frank, 2026-10-21 00:05Z, verbatim):** «Es posible hacer que el mcp haga un elemento
interactivo donde yo pueda modificar el rol como yo quiera que quede una vez que me muestra la
propuesta y entonces lo puede carga y advertirme si algo no cuadra con las reglas o algo así?» —
and, offered a conversational `revise_proposal` or an interactive screen: «Sí, quiero una pantalla
interactiva» (00:06Z).
**Builds on:** P4 on solver v3 (ADR-0061, plan `2026-10-20-owt-mcp-p4-v3-solve-apply.md`, in
production as `78939c71`). This is the separate plan ADR-0061 Q1 promised for `revise_proposal`.
**Risk tier:** slices S2–S3 are **critical** (they produce the input of a production writer,
`apply_schedule`, and cross the mutation trust boundary: an edit arrives from a client and must be
judged on the server). S1 (a read-only screen) and S4 (the editor's front end, which only consumes
S2's tools) are **standard**. Only the critical slice goes through
`.agents/skills/adversarial-plan-review/` (§Review policy).

---

## 1. What Frank gets

1. He asks Claude (web, desktop or phone) to plan a month. `solve_month` answers as today **and**
   shows a card in the conversation: the month's new services, who sits where, and the unfilled
   seats.
2. «Editar» opens the card full screen. He taps a seat and sees the candidates for it in the
   planner's own order, with the planner's own badges («No disp.», «Sin declarar», «Ya asignado»).
   He places, clears or exchanges people. A choice the planner would refuse (wrong Tipo, the same
   person twice in a section) is refused on the spot with the planner's own sentence. A choice that
   breaks one of his rules (two people kept apart, a person excluded from a role or a week) asks
   «¿Asignar de todos modos?», exactly as `/admin` does (decision Q1 below).
3. «Revisar y guardar» stores his version as a new revision and, before he loads anything, says
   what does not add up **for the whole month**: caps (`≤`, `≥`, `==`), presence rules («al menos
   uno de … cada semana»), pairs, cadence, and how each person's total moved against the fairness
   fair share, plus a service left without a Lead or with empty seats. These are **warnings**,
   never refusals: the month is his. (A role or week exclusion is not a month warning: the per-edit
   gate asks about it at the moment of the pick, and the save refuses any one left unconfirmed.)
4. «Cargar» hands the newest revision to `apply_schedule` through the conversation, so the same
   confirmation the Claude app already asks for every destructive tool still stands between a tap
   and a production write (decision Q2).

What does not change: `apply_schedule`'s rules (D7: a date taken since the solve refuses the whole
call; nothing is ever overwritten), the fairness records (the edits move seats, not eligibility),
the 7-day expiry, and the bound rule set.

## 2. The decisions, and why

Each row names the alternative it rejects. The ADR (§7) carries the ones the code will not show.

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| E1 | **The server judges every edit; the screen only shows.** The screen holds a list of edits, never a board it trusts. Every check, and the save, sends the base handle plus the whole edit list; the server replays it from the stored proposal through the planner's gate and answers the resulting board | (a) Bundle the planner's gate into the screen and trust its verdict. (b) Let the screen send a finished board | (a) makes a second judge that drifts from the planner's and from the server's; (b) lets any client — or the model, through `revise_proposal` — write an unjudged board into a record `apply_schedule` will turn into services. Replaying edits is stateless (the route has no session, `app/api/mcp/route.ts`), deterministic, and testable without a browser |
| E2 | **A revision is a NEW proposal record** (`mcpProposal.<new handle>`) that copies the base's frozen confirm entries, solve-time stored ids, rules revision, expiry and principal, carries `parent` and `revision: n+1`, and gets **fresh `creationRequestId`s**. Creating it and marking the base `supersededBy` happen in ONE transaction (T2.2) | Mutate the base's payload in place (the pre-v3 design, which then needed an apply lease, `A14`/`proposal_busy`) | The payload is digest-bound and immutable (`proposalDocument.ts:1-20`, D10); keeping it so means `apply_schedule` needs no lease and no new write path (its only changes are E3's refusal, the waiver confirmation of Q1, and naming the revision it applied). Applied **one after another**, revisions of one solve cannot both land: once one created a service, every other finds that date taken and is refused **before** any record or create (`phase3Refusals`, `applySchedule.ts:248`; `observe.ts:100-133`). Applied **at the same time**, two lineages fall into ADR-0061's accepted interleave (identical frozen entries): the month can end up mixed from both, never duplicated (the create path's weekend lock and special identity coordinator, `roleCreateCommit.ts`). E3's fork refusal makes two live lineages of one solve impossible, so this needs two applies of a base and its successor racing, which E3's supersede refusal also narrows. Fresh request ids matter: a receipt keyed by the base's id would answer «already created» for a body that holds the base's seats, and apply would report Frank's edited service as created when it is not |
| E3 | **No forks, no revising a started apply, no applying a superseded proposal.** A save is refused when its base (a) is already superseded — naming the successor (`stale_revision`, `detail: "superseded"`); (b) has started applying, judged by `observeProposal` over a fresh roles read, receipts first (R-OBS, `observe.ts:3-6`), never by the `state` cache alone; (c) would fail apply's own D7 checks (a), (b) or (c) today, so Frank learns «hay que volver a generar el mes» before editing, not after; (d) fails `admitsProposal` (origin, principal, expiry; `proposalDocument.ts:279`). `apply_schedule` refuses a superseded proposal naming its successor | Allow these and let D7 sort it out | D7 keeps the data safe either way; these refusals keep Frank from losing his edits silently (applying the solver's original after editing, or a stale tab's sibling revision) and from editing a month that is half in `/admin` already. A base whose `state` lags its receipts falls to D7 at apply, and the edits are lost loudly (apply refuses), never silently |
| E4 | **Per-edit gate = the planner's own gate for each gesture**, against CURRENT members (a fresh pool read) and the proposal's BOUND rules (a changed rule set refuses, `rules_changed`, as apply does): **`place`** (a member from the candidate list into a seat) = the manual pick, `toggleCandidate`/`overrideCandidate` (`PlannerGrid.tsx:921-1010`) — C3 by absence from `rankCandidates` (`candidateRanking.ts:109`), C2 `blockedReason`, C4 `ruleBlockedReason`; **`move`** (a seated member to another seat) = the drag gate `evaluateMove` (`moveGate.ts:231`), which needs a source seat holding the member; **`clear`** = always allowed, as the planner allows removal; **`exchange`** (two seated members trade seats) = ONE judged unit: both are removed, then each placement is judged as a `place` on the board without either, so neither sees the other in its column (no spurious pair-rule C4); either refusal refuses the unit, and each C4 names its own member and rule. C1–C3 refuse; C4 asks (Q1) | Re-implement the checks for the connector; or judge `place` with `evaluateMove` | `evaluateMove` answers `unresolved` for a pick from the pool (`moveGate.ts:252`), so it cannot be the place gate. The pick's verdict AND the assembly of its inputs (`rankFor`, `PlannerGrid.tsx:850-866`) are inline in a client component, so both are **extracted** (T2.3) into a neutral module that `PlannerGrid` calls too — one definition, not a second judge. Sharing only the verdict is not enough: `rankCandidates` enforces no rule when `column` or `config` is missing and no week exclusion without the right `sundayDates` (`candidateRanking.ts:116-135`, `ruleEnforcement.ts:372`), and the solver cannot catch the miss, because exclusions are eligibility, not rule instances (`v3MonthSources.ts:128-146`), and a pinned ineligible person is accepted silently (`gcf_v3/owt_v3/facts.py:38`). So on the server those inputs are required, and a safety net re-checks every edited column after the replay (T2.3) |
| E5 | **The whole-month check is a small checker of its own, `monthCheck.ts`, that judges the board against the rules AS WRITTEN**: every `<=`/`>=`/`==` count rule per person and month with the rule's own value (never clamped), presence («al menos uno de … cada semana»), pairs, «Mes por medio» cadence, each creatable weekend without a Lead, and each draft's voice seats against the solve's targets. Where the rule could not have been met (a `>=`/`==` above the person's availability), the line says so («pide 2; solo estaba disponible 1»). It reads the same rule objects the solve sent (`collectV3Rules`/`emitV3Rules`, `v3Rules.ts`) and the same eligibility as the solve (the proposal's frozen entries' months, `v3MonthSources.ts`) | (a) Send the board to solver v3 with every draft fixed and read its report (this plan's rounds 1–4). (b) Port the solver's model | (a) was tried on paper and failed four ways, all for one reason: the solver answers «what is the best achievable», not «does this board meet the rules as written». For a fixed service it clamps `>=`/`==` to the pinned availability (`gcf_v3/owt_v3/facts.py:46-57, 84-97`), skips `mandatory_lead` (`instances.py:93`) and `unfilled` (`report.py:92`), and sizes rows to the pins (`facts.py:32`), so removing Ana from one of two Sunday Leads under `Sun.Lead == 2` reports nothing. (b) would copy CP-SAT staging that a check does not need. **Drift guard:** `gcf_v3/acceptance/checker.py` already recomputes broken instances from assignments alone; `monthCheckParity.test.ts` runs both on shared fixtures (the acceptance worlds, solved boards) where its semantics and ours coincide — no clamping in play, services not fixed — and asserts the same broken set; the two deliberate differences (no clamping; Lead and seats judged on every draft) have their own hand-computed cases, never regenerated from output |
| E6 | **The month check runs on every check and every save** (it is pure and local), and the screen shows its lines live | Run it only on save | With no solver call it costs milliseconds, so Frank sees «Ana: Lead 1 de 2» the moment he removes her, not after saving |
| E7 | **If a read the month check needs fails, the revision is still saved**, marked «sin revisar», and the screen says so in its first line | Refuse to save | `apply_schedule` never depended on caps; refusing would make a failed read an outage of editing. The model, the screen and apply all repeat «sin revisar» |
| E8 | **The screen is an MCP App** (`@modelcontextprotocol/ext-apps` 2.0.x): `solve_month` and `revise_proposal` declare `_meta.ui.resourceUri = "ui://owt/proposal-editor"` (so the card follows a proposal into the chat; the screen itself saves only through the app-only `save_proposal_edits`, T2.5), the route serves that resource (`text/html;profile=mcp-app`), and the per-edit check is an app-only tool (`_meta.ui.visibility: ["app"]`) | An Artifact page, or a link to `/admin` | Frank asked for the screen *in* the conversation, after the proposal. MCP Apps is the official extension Claude renders on web, desktop and mobile for custom connectors; ext-apps 2.0.3 peers on `@modelcontextprotocol/server ^2` (the repo pins 2.1.0) and zod ^4.2 (4.3.6). An Artifact cannot call our server with Frank's OAuth grant; `/admin` already exists and is what he is trying not to open |
| E9 | **One self-contained HTML file, bundled at build time** (esbuild, the existing devDependency, pinned; React 19, the repo's own) and committed, with a vitest guard that rebuilds it and compares bytes | Load scripts from our origin; build only on Vercel | The app's sandbox blocks every external origin unless declared (`_meta.ui.csp`); inline needs no CSP entry and nothing new on `/api/*`. Committed + guarded keeps the gates (tsc, vitest, eslint) the whole truth, as `colour-inventory` does |
| E10 | **«Cargar» sends a message to the conversation** (`app.sendMessage`), and Claude calls `apply_schedule` | The screen calls `apply_schedule` directly | `apply_schedule` is declared destructive (I14) so the Claude app asks before running it; a call from inside an app's frame is not guaranteed that same prompt. The chat also shows apply's report, refusals and `next` exactly as today (decision Q2) |
| E11 | **Instruments and FOH are editable, judged by E4 only** | Leave them read-only | The solver never seats them (it plans voices), so the month check has nothing to say about them; the planner's manual pick does, and Frank edits them in `/admin` today |

## 3. Questions for Frank

- **Q1 — a seat that breaks one of your rules. DECIDED A (Frank, 2026-10-21 00:14Z).** (A) The screen
  asks «Esta asignación rompe la regla “…”. ¿Asignar de todos modos?» and, on yes, stores the waiver
  with that rule's wording, exactly like `/admin`'s «Forzar»; the waiver is listed again before
  «Cargar». (B) Refused, as the pre-v3 design said; forcing stays in `/admin`.
  **What «Claude desde el chat nunca puede forzar» rests on, stated exactly** (Frank is told this
  wording): (1) the force flag exists only on the app-only save (T2.5); the Claude app hides
  app-only tools from the model, but the server cannot tell who called, so this is the host's
  guarantee, not ours; (2) **ours**: `apply_schedule` refuses a proposal that carries waivers unless
  its call repeats every waiver's wording (`waivers` argument, matched exactly against the
  digest-bound payload), so a forced seat can never reach production without its rule appearing in
  the arguments of the destructive call, which the Claude app shows when it asks permission — and
  in the screen's «Cargar» step and the revise answer before that. If Frank has set the app to run
  `apply_schedule` without asking, (2) shows them only in the chat, and the docs say so.
- **Q2 — «Cargar».** (A, recommended; the plan proceeds on it unless Frank says otherwise) Through the chat, so the Claude app asks before writing (E10).
  (B) Directly from the screen after its own «¿Cargar N servicios?» confirmation.

## 4. Slices and tasks

### S1 — a read-only proposal card (standard)

Proves the delivery path in production before anything critical depends on it. Dev cannot prove it:
claude.ai cannot reach dev through Vercel Deployment Protection (`docs/MCP.md`, «Adding the
connector»).

- T1.1 Dependencies: `@modelcontextprotocol/ext-apps@2.0.3` (exact); `esbuild` is already a devDependency (`^0.28.1`) and is pinned to its installed exact version. Check
  that `mcp-handler` 2.2.0 forwards `resources/list`/`resources/read` on the stateless route and
  that the route's auth gate covers them (it gates every request before the server sees it,
  `route.ts:1-30`); a route test asserts an unauthenticated `resources/read` is a 401 and an
  authenticated one returns the HTML with `text/html;profile=mcp-app`.
- T1.2 `app/mcp/app/` (new): `editor/` (the React source, presentational halves only, host theme
  variables, dark and light, safe-area insets, 44-pt targets, 16 px controls), `build.mjs`, and the
  committed `editorHtml.generated.ts`. Guard `mcpAppBundle.test.ts`: rebuilding yields the
  committed bytes; the HTML references no external origin.
- T1.3 `solve_month` gains `_meta.ui.resourceUri` and a `structuredContent.board` (services, seats
  by row with member id and display name, unfilled seats, handle, revision, expiry). Same I5 audit
  as P4 M17: seats name seated members only; no pool list. A size guard keeps the result far below
  the host's ~150 k-character limit (40 drafts measured).
- T1.4 Release (§Release) and **Frank's look on his phone and on desktop**: the card renders, the
  theme follows the app, «Editar» goes full screen (the button is inert in S1).

### S2 — the revision record and the judge (critical)

- T2.1 **Fixtures first:** the parity fixtures of E5 (from `gcf_v3/acceptance/world_realistic.json`
  and `smoke.json`, run through `checker.py` once to capture its broken set, committed with the
  command that made them) and the hand-computed cases: a `>=` floor and an `==` exact each
  under-assigned by an edit, one above availability, a `<=` cap broken, a presence rule whose only
  holder was cleared, a pair, a «Mes por medio» break, a weekend whose Lead was cleared, an emptied
  BGV seat. Each case states the expected Spanish line.
- T2.2 **The record contract** (`proposalDocument.ts`, `documentTypes.ts`,
  `sanity/schemas/mcpProposal.ts`):
  - Header gains `parent` (a handle) and `revision` (integer ≥ 2), both present on a revision and
    both absent on a solve's record, which reads as revision 1. `PROPOSAL_FIELDS` and the schema
    gain them (read-only in Studio, like the rest).
  - Payload **v2** = v1's `{entries, drafts, storedServiceIds}` plus `waivers: [{ localId, rowId,
    memberId, rule }]` (`rule` = the C4 sentence the gate gave, verbatim). Waivers live in the
    digest-bound payload, never in the mutable `state`. `parseProposal` accepts v1 (no waivers) and
    v2; `hasOnly` per version.
  - **Digest:** a v1 record keeps today's canonical list exactly (`proposalDigest`,
    `proposalDocument.ts:110-116`), so every record already in the dataset still verifies; a v2
    record's list appends `parent` and `revision`. Guard: a fixture of a record written by today's
    code verifies byte for byte; a v2 record with `parent` or `revision` altered reads as no record.
  - `state` gains `supersededBy` (a handle). `mergeState` keeps the STORED `supersededBy` over any
    incoming one and `stateText` serializes it (today it writes only two keys,
    `proposalDocument.ts:204`), so apply's `writeState` retries (`proposalStore.ts:84-105`) can
    never clear or replace it; test: apply's `writeState` after a concurrent supersede keeps it.
    `parseState` accepts it as optional. `app/utils/studioProtection.ts` (pinned to
    `PROPOSAL_FIELDS` by its test) gains the header fields.
  - Payload v2 also carries `checked: boolean` (false = «sin revisar», E7), so `apply_schedule`
    repeats it itself, and `saveId` (T2.5). v2's `hasOnly` = `{v, entries, drafts,
    storedServiceIds, waivers, checked, saveId}`.
  - **The save transaction:** ONE Sanity transaction = `create` the child + `patch` the base's
    `state` (adding `supersededBy`) under `ifRevisionId` of the base read that passed E3. On a
    revision conflict: re-read the base and re-judge E3 — superseded → refused naming the
    successor; started applying → refused; otherwise (only `state` facts unrelated to either moved)
    retry, at most `STATE_WRITE_RETRIES`. So a child never exists without its base marked, and a
    base is never marked without its child. E3(b) is judged again from a fresh roles read right
    before the transaction, because the month check in between takes seconds.
  - A base superseded while an apply of it was already running (a race E3 narrows but cannot
    close) is refused on that apply's next call; the way out is a new `solve_month`, and the
    refusal says so. D7 keeps the data safe meanwhile.
  - **Waivers across revisions:** the rules are bound (`rulesRev` never changes across a lineage),
    so a finding on an unchanged seat is the same finding. A child inherits each base waiver whose
    seat (`localId`, row, member) is unchanged, through `ruleViolationsForColumn` with the waiver as
    `overridden` (it re-asks with the seat removed, so it does not self-exempt like the pick
    verdict): inherited exactly when the finding comes back overridden with the same reason. A
    waiver whose seat changed is dropped, and the answer says which. Never re-judged with the pick
    verdict, which self-exempts a seated member (`ruleEnforcement.ts:350`) and would drop every
    waiver while the forced seat stays.
  - Revision cap: a save whose child would be `revision` 31 is refused (`revision_limit`); with
    forks refused (E3) the lineage is a chain, so `revision` is its length.
- T2.3 `app/mcp/monthProposals/revise.ts` (neutral): `replayEdits(proposal, edits, members, rules,
  fresh)` → `{ board, verdicts[], waivers, refusal? }`. Edits are `place {service, row, member,
  force?}`, `move {from: seat, to: seat, force?}`, `clear {service, row, member}`, `exchange {a:
  seat, b: seat, force?}`; at most 200 per call. Each edit is judged by its E4 gate on the board as
  the previous edits left it; the first refusal stops the replay and names the edit by index. Plus
  R10 (a service no longer creatable is refused) and R14 (the per-cell cap) from the pre-v3 plan.
  Three extractions it needs, all pure and server-safe (a server module may never call a value from
  a `"use client"` module, ADR-0028, `clientBoundary.test.ts`):
  1. `withUpdatedCell`, today in `PlannerGrid.tsx` and imported back by `moveOccupant.ts:24`, moves
     to a neutral module that both keep importing.
  2. **`judgePick`** = the whole of `rankFor` (`PlannerGrid.tsx:850-866`) plus the verdict half of
     `toggleCandidate`/`overrideCandidate` (`:921-1010`): from (board, row, column, members,
     window roles, config) it assembles `seatDefForRow`, `assignedForColumn`, the column, the
     Sunday spine exactly as `MonthGenerator` wires `sundayDatesForColumn` through
     `ruleContextForTarget` (`serviceRuleContext.ts:75`; trailing Saturday and the second month of
     a 2-month horizon included), calls `rankCandidates`, and answers refused (C2/C3) / prompt (C4,
     with the pre-built override) / clean. It moves to a neutral module, and **`PlannerGrid` is
     changed to call it** for both its candidate list and its pick, so the grid and the connector
     share one definition of inputs and verdict. In this module `column`, `config` and the spine are
     REQUIRED: the server path refuses (`server_error`, fixed line) rather than judging with one
     missing. The grid's existing tests stay green unchanged.
  3. `draftsToCells`, the inverse of `cellsToDrafts` (`plannerModel.ts:1840`) over
     `buildRows`/`buildColumns`, because the stored payload holds drafts, not cells. Guard:
     `cellsToDrafts(draftsToCells(d))` equals `d` for every draft of the recorded boards, seats in
     order.
  4. `moveOccupant.ts` drops its `"use client"` (it imports nothing client-only once (1) lands) and
     performs `move` and each half of `exchange`, so a move has one definition (DD10).
  **Safety net after the replay:** `ruleViolationsForColumn` (`ruleEnforcement.ts:479`) over every
  edited column, with the replay's waivers as the overridden set, compared against the same call on
  the replay's STARTING board (the base's seats with the base's waivers). A finding refuses the
  save when it has no waiver and either is NEW — absent from the starting board, keyed by
  `violationKey` and reason; for a pair rule keyed by (the two members, rule), so an exchange inside
  one column is not new — or was WAIVED on the base (a forced seat that lost its waiver is never
  downgraded to a warning); it catches a gate whose inputs were wrong, independently of the gate. A finding
  already on the starting board is answered as a warning, never a refusal: the solver may break a
  pair to meet a floor (pair rules are soft, `gcf_v3/owt_v3/model.py:118`; the TS rules may disagree
  on a weekend, `ruleEnforcement.ts:440-448`), and a solve's record carries no waivers, so refusing
  it would block Frank over a seat he never touched. `check_proposal_edits` runs the same net, so
  the screen shows both kinds before any save.
- T2.4 `monthCheck.ts` (neutral, pure): input = the replayed board's creatable drafts, the month's
  stored services (counted as the solve counted them, `v3Services.ts`), the rules as the solve
  collected them (`collectV3Rules`, bound `rulesRev`), the eligibility of the frozen entries'
  months, and the solve's seat targets. Output = Spanish lines through `v3Copy.ts` (C6 U8: no rule
  key on the wire, a line or a log), grouped «Reglas del mes», «Servicios incompletos», and per
  person seats received against share (the ledger's own share, `fairnessLedger.ts`, never
  re-derived). No network, so no time budget and never «sin revisar» for an outage; E7 stays only
  for a read the check needs that failed. Uncounted specials are not month-checked, and the answer
  says so. A person seated while marked unavailable for that date is listed too (the planner only
  badges it at pick time).
- T2.5 Tools, one implementation behind three entries:
  - `check_proposal_edits` (app-only, read-only annotation): replay; answer the board, the
    verdicts and, when asked for one seat, its ranked candidates. **I5:** the listed candidates are
    filtered to the worship audience (`normalizeMinistries(m.ministries).includes("worship")`, as
    P4's M17 filters `warnings.unavailable`), while the gate still judges by id against the solver's
    pool; seated members are named under I5's seat exception; an id the replay cannot place is
    refused with one collapsed sentence that never confirms a kids-only id exists (pre-v3 R1).
    Stores nothing.
  - `save_proposal_edits` (app-only): E3's checks, replay, the month check, the T2.2 transaction,
    the sweep. Its edits may carry `force` (Q1-A); a forced edit is accepted only if the gate
    answers C4 for it, and its waiver is stored with that rule's wording.
  - `revise_proposal` (model-visible): the same save, with no `force` field in its schema; from the
    chat a rule block is refused and names the rule. **Its schema must never gain `force`**: a test
    asserts the registered input schema is strict and refuses an edit carrying `force`. The screen
    never calls it (T4.2); it exists for edits asked for in the chat. It still carries forward inherited waivers
    (T2.2), and its answer lists them.
  Neither save is destructive (each writes only a private record, like `solve_month`, I14). All
  three refuse unless the engine is v3, as `apply_schedule` does (D2), and all three apply
  `admitsProposal` (D10) before answering anything with names.
  **Time:** no solver call, so a save is reads + replay + check + one transaction, far inside the
  route's 60 s `maxDuration`.
  **Lost answer:** each save carries a client `saveId` stored in the child's payload; a retry whose
  base is superseded by a child with the same `saveId` returns that child as success, so the screen
  never mistakes its own save for a sibling tab's.
  **Replay limits:** a `place` into a row the column does not show (`rowAppliesTo`, as
  `evaluateMove` refuses, e.g. Coro on a Saturday) or outside `buildRows()` is refused, never
  accepted and then dropped by `cellsToDrafts` (E18). Only seats change: a child's drafts copy every
  non-seat field from the base (`localId`, `exists`, `isExisting`, `skipped`, `countsForFairness`,
  `service_name`, `atSolve`) and get fresh `creationRequestId`s; nothing is recomputed against
  fresh `existingRoles`. Waivers key on the kept `localId`.
  **I5 sentence:** the collapsed sentence is used only for ids outside the worship audience; a
  worship member with the wrong Tipo gets the planner's own C3 sentence.
  `apply_schedule` gains: refuse a superseded proposal naming its successor (E3); refuse a proposal
  with waivers unless `waivers` repeats each one exactly (Q1, before any write): each item is
  `{ service, member, rule }` — the service label, the member's display name and the rule's
  sentence, all server text — matched as a multiset after Unicode NFC, nothing else normalized, so
  two seats with the same sentence each need their own item and the permission prompt says who and
  where; repeat
  «sin revisar» from the payload; and name the revision it applied.
- T2.6 Tests (vitest, the existing fake-store harness of `applySchedule.test.ts`): `judgePick`
  parity — the grid calls it, and the grid's pick tests stay green; replay cases where a week
  exclusion (a trailing Saturday, and a Sunday of the second month of a 2-month horizon), a role
  exclusion and a pair rule each produce C4, each mutation-checked by dropping `column`, the spine
  and `config` in turn; the safety net refuses an unwaived violation planted past a stubbed gate;
  every T2.1 case through `monthCheck.ts`, and `monthCheckParity.test.ts`; force in revision 2,
  an unrelated `revise_proposal` edit in revision 3, the waiver is inherited and an apply without
  `waivers` is refused; replay of each edit kind, the
  exchange unit with a pair rule between the two members (no spurious C4); every refusal code; the
  save transaction under a conflict (base superseded meanwhile → refused naming the successor; an
  unrelated state fact → retried and saved); two saves on one base → exactly one child; apply after
  a sibling revision created a service → refused by D7 with nothing written; a superseded proposal
  → refused; waivers missing or altered in apply's call → refused before any write; fresh request
  ids per revision; v1 records parse and verify (fixture), v2 tampering reads as no record; I5 — a
  kids-only member with a worship Tipo is judged but never listed as a candidate; the route test for
  the three tools. Each new guard is mutation-checked once, as in P4.

### S3 — the editor's server contract is reviewed before S4 starts (critical)

The adversarial plan review covers §2 E1–E7 and S2 only. S1 and S4 are standard and rely on the
merge-range code review.

### S4 — the editing screen (standard)

- T4.1 Seat sheet: tap a seat → `check_proposal_edits` for its candidates → place / clear /
  exchange. Optimistic local board, replaced by the server's answer; a refusal reverts and shows
  the planner's sentence. Q1-A's confirm for C4.
- T4.2 «Revisar y guardar» → `save_proposal_edits` (never `revise_proposal`, T2.5); the warnings panel (month check, waivers,
  «sin revisar»); the new handle becomes the base.
- T4.3 «Cargar» → `app.sendMessage` with the handle, the revision and every waiver's wording
  verbatim, so Claude's `apply_schedule` call can repeat them (Q2-A, Q1).
- T4.4 Latency budget, measured on Frank's phone at release: a seat's candidates ≤ 2.5 s p50. If
  missed, the cheapest fix is caching the pool read per call chain, not moving the judge to the
  client (E1).

## 5. Gates and release

Every slice: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors), and the v3 solver suite
when `gcf_v3/**` is touched. Release order per CLAUDE.md: one code review per merge range, preview
(alias + SHA verified), PR to `main`, `gates`, merge, prod alias verified. S1 and S2+S4 are two
releases; S2 is never released without S4's screen, and S4 never without S2's judge.

**Live proof (Frank present, each step on his go), after the S2+S4 release:** solve January 2027
→ edit two seats, one of them forced → «Revisar y guardar» shows the expected warning → «Cargar» →
Frank checks the drafts in `/admin`. This replaces P4's pending L1–L4 if he prefers one session
for both.

## 6. Out of scope

- «Rellenar vacíos» after editing (the solver fills only the seats Frank left empty). The request
  builder already supports it («Solo llenar vacíos»); a later slice once the editor is in use.
- Editing setlists, publishing, or the kids rotation from the screen.
- Any write from the in-app assistant bubble (ADR-0060 stays read-only).
- Adding or removing a service, renaming a special, or changing «Cuenta para equidad» from the
  screen: the editor changes seats only. Those stay in `/admin` or a new `solve_month`.

## 7. Docs in the same delivery

ADR-0062 (E2, E5, E8–E10, and the rollback note: after reverting this release every record with a
v2 payload or a `supersededBy` reads as no record, which fails closed; revisions as new records, a month checker of its own that judges the rules as written (and why not the solver), MCP Apps
over an Artifact, «Cargar» through the chat, Q1's exact guarantee); the MCP spec amended: the
`revise_proposal` row and the «Editing a proposal» decision («the connector never forces», spec
`:221`, `:306`) rewritten to Q1's guarantee, I14 and I5 (the candidate list);
`docs/MCP.md` (tools, the screen, troubleshooting: «la tarjeta no aparece» → reconnect the
connector); `docs/DATA_MODEL.md` (`parent`, `revision`, `supersededBy`); CLAUDE.md and the long
form: the editor is presentational and the server judges (E1); `docs/SECRETS.md` unchanged (no new
secret, no new env var).
