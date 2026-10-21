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
| E2 | **A revision is a NEW proposal record** (`mcpProposal.<new handle>`) that copies the base's frozen confirm entries, solve-time stored ids, rules revision, expiry and principal, carries `parent` and `revision: n+1`, and gets **fresh `creationRequestId`s**. Creating it and marking the base `supersededBy` happen in ONE transaction (T2.2) | Mutate the base's payload in place (the pre-v3 design, which then needed an apply lease, `A14`/`proposal_busy`) | The payload is digest-bound and immutable (`proposalDocument.ts:1-20`, D10); keeping it so means `apply_schedule` needs no lease and no new write path (its only changes are E3's refusal, the waiver confirmation of Q1, and naming the revision it applied). Applied **one after another**, revisions of one solve cannot both land: once one created a service, every other finds that date taken and is refused **before** any record or create (`phase3Refusals`, `applySchedule.ts:248`; `observe.ts:100-133`). Applied **at the same time**, two lineages fall into ADR-0061's accepted interleave (identical frozen entries): the month can end up mixed from both, never duplicated (the create path's weekend lock and special identity coordinator, `roleCreateCommit.ts`). E3's fork refusal makes two live lineages of one solve impossible, so this needs two applies of a base and its successor racing, which E3's supersede refusal also narrows. Fresh request ids matter: a receipt keyed by the base's id would answer «already created» for a body that holds the base's seats, and apply would report Frank's edited service as created when it is not |
| E3 | **No forks, no revising a started apply, no applying a superseded proposal.** A save is refused when its base (a) is already superseded — naming the successor (`stale_revision`, `detail: "superseded"`); (b) has started applying, judged by `observeProposal` over a fresh roles read, receipts first (R-OBS, `observe.ts:3-6`), never by the `state` cache alone; (c) would fail apply's own D7 checks (a)/(c) today, so Frank learns «hay que volver a generar el mes» before editing, not after; (d) fails `admitsProposal` (origin, principal, expiry; `proposalDocument.ts:279`). `apply_schedule` refuses a superseded proposal naming its successor | Allow these and let D7 sort it out | D7 keeps the data safe either way; these refusals keep Frank from losing his edits silently (applying the solver's original after editing, or a stale tab's sibling revision) and from editing a month that is half in `/admin` already. A base whose `state` lags its receipts falls to D7 at apply, and the edits are lost loudly (apply refuses), never silently |
| E4 | **Per-edit gate = the planner's own gate for each gesture**, against CURRENT members (a fresh pool read) and the proposal's BOUND rules (a changed rule set refuses, `rules_changed`, as apply does): **`place`** (a member from the candidate list into a seat) = the manual pick, `toggleCandidate`/`overrideCandidate` (`PlannerGrid.tsx:921-1010`) — C3 by absence from `rankCandidates` (`candidateRanking.ts:109`), C2 `blockedReason`, C4 `ruleBlockedReason`; **`move`** (a seated member to another seat) = the drag gate `evaluateMove` (`moveGate.ts:231`), which needs a source seat holding the member; **`clear`** = always allowed, as the planner allows removal; **`exchange`** (two seated members trade seats) = ONE judged unit: both are removed, then each placement is judged as a `place` on the board without either, so neither sees the other in its column (no spurious pair-rule C4); either refusal refuses the unit, and each C4 names its own member and rule. C1–C3 refuse; C4 asks (Q1) | Re-implement the checks for the connector; or judge `place` with `evaluateMove` | `evaluateMove` answers `unresolved` for a pick from the pool (`moveGate.ts:252`), so it cannot be the place gate. The pick's verdict is inline in a client component, so it is **extracted** (T2.3) into a neutral module that `PlannerGrid` calls too — one definition, not a second judge |
| E5 | **The whole-month check is the solver itself**, on the board exactly as apply would store it: every draft of the board — weekend and counted special — is sent as a **fixed** service holding exactly Frank's voice seats as pins, with **no** pre-fill (`prefillCountedSpecials` skipped) and no row targets, through a named builder option `asStoredBoard` (T2.4). With nothing left to decide, the solver's report is the verdict: `violations`, `missed`, cadence and per-person planned-vs-share | (a) Port `gcf_v3/acceptance/checker.py` (or the rule semantics) to TypeScript. (b) Reuse «Solo llenar vacíos» as it is | (a): one definition of what a rule means; a port mirrors §6.7 instances and §7.1 protections and needs a sync test against Python forever, while the solver already judges stored services, which it receives as fixed. (b) is wrong: that path sends planned weekends `fixed:false` with row targets (`v3Services.ts:163-167`) and pre-fills counted specials (`v3SolveRequest.ts:249-258`), so the solver would FILL the seats Frank emptied and the check would judge a board he did not make (clearing the only person who met «al menos uno … cada semana» would show no warning). **Premise to prove first** (T2.1, through `asStoredBoard` itself): such a request answers a report, not an infeasibility, when a cap is broken. If it does not, the fallback is the port, golden-tested against `checker.py` on `acceptance/world_realistic.json` |
| E6 | **The month check runs on «Revisar y guardar», not on every tap** | Live month check after each edit | A solve round trip is seconds (Cloud Run, cold start); a tap must answer in about one. The per-edit gate (E4) is fast and covers what can be judged at pick time; caps and presence are statements about a month (`ruleEnforcement.ts` header, «What is NOT») |
| E7 | **If the month check fails to run, the revision is still saved**, marked «sin revisar», and the screen says so in its first line | Refuse to save | `apply_schedule` never depended on caps; refusing would make an outage of the solver an outage of editing. The model and the screen both repeat «sin revisar» before any apply |
| E8 | **The screen is an MCP App** (`@modelcontextprotocol/ext-apps` 2.0.x): `solve_month` and `revise_proposal` declare `_meta.ui.resourceUri = "ui://owt/proposal-editor"`, the route serves that resource (`text/html;profile=mcp-app`), and the per-edit check is an app-only tool (`_meta.ui.visibility: ["app"]`) | An Artifact page, or a link to `/admin` | Frank asked for the screen *in* the conversation, after the proposal. MCP Apps is the official extension Claude renders on web, desktop and mobile for custom connectors; ext-apps 2.0.3 peers on `@modelcontextprotocol/server ^2` (the repo pins 2.1.0) and zod ^4.2 (4.3.6). An Artifact cannot call our server with Frank's OAuth grant; `/admin` already exists and is what he is trying not to open |
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

- T2.1 **Spike, no production code:** through T2.4's `asStoredBoard` builder path (not a
  hand-built request), a board from the acceptance world with a broken `≤` cap, a cleared seat that
  was the only one meeting a presence rule, and a forced pair; run against the local solver and the
  deployed one (`python -m unittest discover -s gcf_v3 -t gcf_v3` stays green). Go: it answers with
  `violations`/`missed` naming each, and seats nobody. No-go: switch E5 to the TypeScript port and
  re-plan T2.4 before going on.
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
    incoming one, so apply's `writeState` retries (`proposalStore.ts:84-105`) can never clear or
    replace it. `parseState` accepts it as optional.
  - **The save transaction:** ONE Sanity transaction = `create` the child + `patch` the base's
    `state` (adding `supersededBy`) under `ifRevisionId` of the base read that passed E3. On a
    revision conflict: re-read the base and re-judge E3 — superseded → refused naming the
    successor; started applying → refused; otherwise (only `state` facts unrelated to either moved)
    retry, at most `STATE_WRITE_RETRIES`. So a child never exists without its base marked, and a
    base is never marked without its child.
  - **Waivers across revisions:** a child inherits each base waiver whose seat still holds the
    same member and whose rule still blocks there (re-judged as C4); any other is dropped, and the
    answer says which.
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
  2. **`pickVerdict`**: the verdict half of `toggleCandidate`/`overrideCandidate`
     (`PlannerGrid.tsx:921-1010`) — given the ranked candidate, answer refused (C2/C3) / prompt (C4,
     with the pre-built override, as `evaluateMove` builds it) / clean — moves to a neutral module,
     and **`PlannerGrid` is changed to call it**, so the grid and the connector share one definition.
     The grid's existing tests stay green unchanged.
  3. `draftsToCells`, the inverse of `cellsToDrafts` (`plannerModel.ts:1840`) over
     `buildRows`/`buildColumns`, because the stored payload holds drafts, not cells. Guard:
     `cellsToDrafts(draftsToCells(d))` equals `d` for every draft of the recorded boards, seats in
     order.
- T2.4 `monthCheck.ts`: `buildV3SolveRequest` gains the option `asStoredBoard` (default off; the
  planner never sets it): every planned column of the horizon becomes a fixed service whose pins
  are its voice occupants, `prefillCountedSpecials` is skipped, no row targets are sent. What
  `pinsOfColumn` drops is reported, never hidden: a person in two voice seats of one service is
  sent once and the check says «X está en dos lugares de voz del mismo servicio; el solver cuenta
  uno»; a seat holding a non-member refuses the check with the builder's own line. The report's
  violations, missed, cadence and planned-vs-share become Spanish lines through `v3Copy.ts` (C6 U8:
  no rule key on the wire, a line or a log). Over the 250-pin cap (`V3_PIN_CAP`) the answer is
  «revisa un mes a la vez», and the save stores «sin revisar» (E7).
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
    chat a rule block is refused and names the rule. It still carries forward inherited waivers
    (T2.2), and its answer lists them.
  Neither save is destructive (each writes only a private record, like `solve_month`, I14).
  `apply_schedule` gains: refuse a superseded proposal naming its successor (E3); refuse a proposal
  with waivers unless `waivers` repeats each one's wording exactly (Q1, before any read that could
  write); and name the revision it applied.
- T2.6 Tests (vitest, the existing fake-store harness of `applySchedule.test.ts`): `pickVerdict`
  parity — the grid calls it, and the grid's pick tests stay green; replay of each edit kind, the
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
over an Artifact, «Cargar» through the chat, Q1's exact guarantee); the MCP spec amended: the
`revise_proposal` row and the «Editing a proposal» decision («the connector never forces», spec
`:221`, `:306`) rewritten to Q1's guarantee, I14 and I5 (the candidate list);
`docs/MCP.md` (tools, the screen, troubleshooting: «la tarjeta no aparece» → reconnect the
connector); `docs/DATA_MODEL.md` (`parent`, `revision`, `supersededBy`); CLAUDE.md and the long
form: the editor is presentational and the server judges (E1); `docs/SECRETS.md` unchanged (no new
secret, no new env var).
