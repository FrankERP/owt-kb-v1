# OWT MCP — an interactive editor for a month proposal (plan)

**Status:** DRAFT, 2026-10-21. Not reviewed, not approved, not authorized.
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
   uno de … cada semana»), pairs, cadence, and how each person's total moved against the solver's
   fair share. These are **warnings**, never refusals: the month is his.
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
| E2 | **A revision is a NEW proposal record** (`mcpProposal.<new handle>`) that copies the parent's frozen confirm entries, solve-time stored ids, rules revision, expiry and principal, carries `parent` and `revision: n+1`, and gets **fresh `creationRequestId`s**. The parent gains a grow-only `supersededBy` in its `state` | Mutate the parent's payload in place (the pre-v3 design, which then needed an apply lease, `A14`/`proposal_busy`) | The payload is digest-bound and immutable (`proposalDocument.ts:1-20`, D10); keeping it so means `apply_schedule` needs no lease and no new write path (its only change is E3's refusal and naming the revision it applied). The duplicate-apply hazard is already closed by D7: once one revision created a service, every other revision of the same solve finds that date taken and is refused **before** any record or create (`phase3Refusals`, `applySchedule.ts:248`). Fresh request ids matter: a receipt keyed by the parent's id would answer «already created» for a body that holds the parent's seats, and apply would report Frank's edited service as created when it is not |
| E3 | **Revising a proposal that has started applying is refused** (`state.recordsDone` or any `created`), and **applying a superseded one is refused** with the handle of its successor | Allow both and let D7 sort it out | D7 keeps the data safe either way; these two refusals keep Frank from losing his edits silently (applying the solver's original after editing) or from editing a month that is half in `/admin` already. The supersede marker is a union-merged fact like `created`, written under `ifRevisionId` (`mergeState`, `proposalDocument.ts:200`); a race between the marker and an apply ends in D7's refusal, never a duplicate |
| E4 | **Per-edit gate = the planner's create-mode manual pick**: `evaluateMove` (`moveGate.ts:231`) over `rankCandidates` (`candidateRanking.ts:109`) and `ruleEnforcement.ts`'s `evaluate`, against CURRENT members (a fresh pool read) and the proposal's BOUND rules (a changed rule set refuses, `rules_changed`, as apply does). C1–C3 refuse; C4 (a rule block) asks | Re-implement the checks for the connector | Those modules carry no client boundary and are what `/admin` runs; a second copy is the drift this repo's «one definition» rules exist to prevent |
| E5 | **The whole-month check is the solver itself**: the edited months are sent to solver v3 with every draft as a **fixed** service holding exactly Frank's voice seats as pins (the same request builder, `buildV3SolveRequest`, with the board's cells as pins as «Solo llenar vacíos» already sends them, `v3SolveRequest.ts:218-259`). With nothing left to decide, the solver's report is the verdict: `violations`, `missed`, cadence and per-person planned-vs-share | Port `gcf_v3/acceptance/checker.py` (or the rule semantics) to TypeScript | One definition of what a rule means. A TypeScript port would be a mirror of §6.7 instances and §7.1 protections that needs its own sync test against Python forever; the solver already answers exactly this question for stored services, which it receives as fixed. **Premise to prove in S2's first task** (§4, T2.1): an all-fixed request answers a report, not an infeasibility, when a cap is broken. If it does not, the fallback is the port, golden-tested against `checker.py` on `acceptance/world_realistic.json` |
| E6 | **The month check runs on «Revisar y guardar», not on every tap** | Live month check after each edit | A solve round trip is seconds (Cloud Run, cold start); a tap must answer in about one. The per-edit gate (E4) is fast and covers what can be judged at pick time; caps and presence are statements about a month (`ruleEnforcement.ts` header, «What is NOT») |
| E7 | **If the month check fails to run, the revision is still saved**, marked «sin revisar», and the screen says so in its first line | Refuse to save | `apply_schedule` never depended on caps; refusing would make an outage of the solver an outage of editing. The model and the screen both repeat «sin revisar» before any apply |
| E8 | **The screen is an MCP App** (`@modelcontextprotocol/ext-apps` 2.0.x): `solve_month` and `revise_proposal` declare `_meta.ui.resourceUri = "ui://owt/proposal-editor"`, the route serves that resource (`text/html;profile=mcp-app`), and the per-edit check is an app-only tool (`_meta.ui.visibility: ["app"]`) | An Artifact page, or a link to `/admin` | Frank asked for the screen *in* the conversation, after the proposal. MCP Apps is the official extension Claude renders on web, desktop and mobile for custom connectors; ext-apps 2.0.3 peers on `@modelcontextprotocol/server ^2` (the repo pins 2.1.0) and zod ^4.2 (4.3.6). An Artifact cannot call our server with Frank's OAuth grant; `/admin` already exists and is what he is trying not to open |
| E9 | **One self-contained HTML file, bundled at build time** (esbuild, pinned as a devDependency; React 19, the repo's own) and committed, with a vitest guard that rebuilds it and compares bytes | Load scripts from our origin; build only on Vercel | The app's sandbox blocks every external origin unless declared (`_meta.ui.csp`); inline needs no CSP entry and nothing new on `/api/*`. Committed + guarded keeps the gates (tsc, vitest, eslint) the whole truth, as `colour-inventory` does |
| E10 | **«Cargar» sends a message to the conversation** (`app.sendMessage`), and Claude calls `apply_schedule` | The screen calls `apply_schedule` directly | `apply_schedule` is declared destructive (I14) so the Claude app asks before running it; a call from inside an app's frame is not guaranteed that same prompt. The chat also shows apply's report, refusals and `next` exactly as today (decision Q2) |
| E11 | **Instruments and FOH are editable, judged by E4 only** | Leave them read-only | The solver never seats them (it plans voices), so the month check has nothing to say about them; the planner's manual pick does, and Frank edits them in `/admin` today |

## 3. Questions for Frank

- **Q1 — a seat that breaks one of your rules. DECIDED A (Frank, 2026-10-21 00:14Z).** (A) The screen asks «Esta asignación
  rompe la regla “…”. ¿Asignar de todos modos?» and, on yes, stores the waiver with that rule's
  wording, exactly like `/admin`'s «Forzar»; the waiver is listed again before «Cargar». Only the
  screen can force (the flag exists only on the app-only save, T2.5; `revise_proposal` from the
  chat never forces). (B) Refused, as the pre-v3 design said; forcing stays in `/admin`.
- **Q2 — «Cargar».** (A, recommended; the plan proceeds on it unless Frank says otherwise) Through the chat, so the Claude app asks before writing (E10).
  (B) Directly from the screen after its own «¿Cargar N servicios?» confirmation.

## 4. Slices and tasks

### S1 — a read-only proposal card (standard)

Proves the delivery path in production before anything critical depends on it. Dev cannot prove it:
claude.ai cannot reach dev through Vercel Deployment Protection (`docs/MCP.md`, «Adding the
connector»).

- T1.1 Dependencies: `@modelcontextprotocol/ext-apps@2.0.3`, `esbuild` (exact versions). Check
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

- T2.1 **Spike, no production code:** an all-fixed v3 request with a broken `≤` cap and a missed
  presence rule, on the acceptance world, through the deployed solver and locally
  (`python -m unittest discover -s gcf_v3 -t gcf_v3` stays green). Go: it answers with
  `violations`/`missed`. No-go: switch E5 to the TypeScript port and re-plan T2.4 before going on.
- T2.2 `proposalDocument.ts`: header gains `parent` (handle or absent) and `revision` (1 for a
  solve); `state` gains `supersededBy`; `mergeState` keeps the first `supersededBy`. A record
  without the new fields parses as revision 1, never superseded (records already in the dataset).
  Revision cap 30 per solve (a 31st is refused, `revision_limit`).
- T2.3 `app/mcp/monthProposals/revise.ts` (neutral): `replayEdits(proposal, edits, members, rules,
  fresh)` → `{ board, verdicts[], refusal? }`. Edits are `place {service, row, slot?, member,
  force?}`, `clear {service, row, member}`, `exchange {a: seat, b: seat}`; at most 200 per call.
  Each edit is judged pre-placement by E4 on the board as the previous edits left it; the first
  refusal stops the replay and names the edit by index. Plus R10 (a service no longer creatable is
  refused) and R14 (the per-cell cap) from the pre-v3 plan.
  Two extractions it needs, both pure and server-safe: (1) `withUpdatedCell`, today inside the
  client component `PlannerGrid.tsx` and imported back by `moveOccupant.ts`, moves to a neutral
  module (the grid keeps importing it; a server module may never call a value from a
  `"use client"` module, ADR-0028, `clientBoundary.test.ts`); (2) a new `draftsToCells`, the
  inverse of `cellsToDrafts` (`plannerModel.ts:1840`) over `buildRows`/`buildColumns`, because the
  stored payload holds drafts, not cells. Its guard: `cellsToDrafts(draftsToCells(d))` equals `d`
  for every draft of the recorded boards, seats in order.
- T2.4 `monthCheck.ts`: the all-fixed request from the replayed board via `buildV3SolveRequest`
  and the solver transport `solve_month` uses; the report's violations, missed, cadence and
  planned-vs-share mapped to Spanish lines through `v3Copy.ts` (C6 U8: no rule key on the wire, a
  line or a log); the 250-pin cap (`V3_PIN_CAP`) answers «revisa un mes a la vez», not a failure.
- T2.5 Tools, one implementation behind three entries:
  - `check_proposal_edits` (app-only, read-only annotation): replay; answer the board, the
    verdicts and, when asked for one seat, its ranked candidates. Stores nothing.
  - `save_proposal_edits` (app-only): replay, the month check, the store, the parent's
    `supersededBy`, the sweep. Its edits may carry `force` (Q1-A); a forced edit is accepted only
    if the gate answers C4 for it, and the waiver is stored with that rule's wording.
  - `revise_proposal` (model-visible): the same save, with no `force` field in its schema — from
    the chat a rule block is refused and names the rule.
  Neither save is destructive (each writes only a private record, like `solve_month`, I14).
  App-only visibility is the host's courtesy, not a security boundary: what it protects is the
  model forcing a rule on Frank's behalf, and the bound on that harm is that every waiver is
  listed on the screen before «Cargar» and again in apply's report. `apply_schedule` refuses a
  superseded proposal (E3) and reports the revision it applied.
- T2.6 Tests (vitest, the existing fake-store harness of `applySchedule.test.ts`): replay parity
  with the planner on recorded boards; every refusal code; a revised proposal applied after its
  parent created a service is refused by D7 with nothing written; a superseded parent is refused;
  fresh request ids per revision; old records parse; the route test for both new tools. Each new
  guard is mutation-checked once, as in P4.

### S3 — the editor's server contract is reviewed before S4 starts (critical)

The adversarial plan review covers §2 E1–E7 and S2 only. S1 and S4 are standard and rely on the
merge-range code review.

### S4 — the editing screen (standard)

- T4.1 Seat sheet: tap a seat → `check_proposal_edits` for its candidates → place / clear /
  exchange. Optimistic local board, replaced by the server's answer; a refusal reverts and shows
  the planner's sentence. Q1-A's confirm for C4.
- T4.2 «Revisar y guardar» → `revise_proposal`; the warnings panel (month check, waivers,
  «sin revisar»); the new handle becomes the base.
- T4.3 «Cargar» → `app.sendMessage("Carga la propuesta <handle> (revisión n)")` (Q2-A).
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

## 7. Docs in the same delivery

ADR-0062 (E2, E5, E8–E10: revisions as new records, the solver as the month's checker, MCP Apps
over an Artifact, «Cargar» through the chat); the MCP spec's `revise_proposal` row and I14 amended;
`docs/MCP.md` (tools, the screen, troubleshooting: «la tarjeta no aparece» → reconnect the
connector); `docs/DATA_MODEL.md` (`parent`, `revision`, `supersededBy`); CLAUDE.md and the long
form: the editor is presentational and the server judges (E1); `docs/SECRETS.md` unchanged (no new
secret, no new env var).
