# The saved-month card saves by itself (amends ADR-0066 «the card never writes»)

**Date:** 2026-10-23 · **Tier:** critical (changes a production writer's mutation trust boundary:
who can start `roleEditCommit` writes from the connector, and which confirmation precedes them).

## Requirement (Frank, verbatim)

2026-10-23 19:15Z, after the «Guardar» message showed up in the chat again:
«Pero por qué para guardar a fuerzas tiene que ser un prompt explícito mío? No puede manejarlo la
herramienta y el conector de forma interna». At 19:17Z he picked «Sí, guardar desde la tarjeta» on a card
that said: the card saves by itself through a tool only the card can use, after a confirmation inside
the card; Claude from the chat still needs his permission to save; «Cargar» of a proposal stays in the
chat for now.

## Today (evidence)

- The saved-month card (`mcp-app/proposal-card/useStoredEditor.tsx`) calls only the read-only, app-only
  `check_service_edits_app`. Its «Guardar» (`send`, lines 129–154) hands the checked change sets to the chat:
  `app.updateModelContext` (arguments, labelled by a key) plus `app.sendMessage` (the changes in words). Claude
  then calls the model-visible, destructive `save_service_edits`, and the Claude app shows its permission
  prompt («Use caution») before the call runs. ADR-0066 «The card never writes»; ADR-0062 Q1 for the
  proposal side.
- `save_service_edits` (`app/mcp/tools/serviceEditor.ts`, `saveServiceEditsResult` from line 1179) already
  re-verifies everything it is given, whoever calls it: each change's MAC (`changeMac`), the stored date, the
  signed `unit` (never half a move), a fresh judgement of every «por guardar» service against the rules, that
  the change's `lines` equal what this read would write (F4, `sameLines`), and that every forced rule carries a
  waiver token only the APP check mints (`waiverToken`, line 655: `app ? … : []`). It writes one service at a
  time through `roleEditCommit` inside `runWriteTool` (unknown outcome on a throw after the domain started),
  queues the role notices inline, and answers `{ ok, month, services: [{service, status}], next? }` with
  `next` = `repeat_same_call` (safe: written services answer «ya estaba») or `check_again`.
- A change set's `lines` (`changeLines`, `app/mcp/monthProposals/storedJudge.ts:177`) are the changes in words
  AND every rule the change forces (`S.forced`, `S.reforced`): they are exactly what the permission prompt shows.
- MCP Apps: `app.callServerTool` is proxied by the host; a tool-level error comes back as `isError`, a
  transport failure (timeout — 60 s default — lost connection, host refusal) throws
  (`@modelcontextprotocol/ext-apps` `app.d.ts`, `callServerTool`). Whether claude.ai asks the user before an
  app-initiated call to a destructive tool is NOT documented; the card must work either way.

## Decision

### S1 — server: `save_service_edits_app`

In `registerServiceEditor`, register `save_service_edits_app`: the same `SAVE_SERVICE_EDITS_INPUT`, the same
handler (`saveServiceEditsResult(args, principalOf(ctx))`), `annotations` identical to `save_service_edits`
(destructive), `_meta: APP_ONLY_META` (visibility `["app"]`), title «Guardar cambios a servicios (tarjeta)»,
description «Solo para la tarjeta del mes guardado: guarda los cambios que la tarjeta revisó y la persona
confirmó.». There is no second writer: both names run the one function, so every check above holds for both.
`saveServiceEditsResult` gains an optional `tool` label (default `"save_service_edits"`) passed to
`runWriteTool`, so the logs say which path wrote; nothing else differs.

- It registers in `registerAllTools` (through `registerServiceEditor`), so it is in the tool list digest
  (ADR-0069). App-only, so it gets no `toolsVersion` (the card is bundled from the same deployment).
- `serviceCommitCallers.test.ts` keeps its caller list unchanged (`serviceEditor.ts` is already the MCP caller of
  `roleEditCommit`); the plan adds no import of a commit anywhere else.
- `copy_instruments` is untouched (the card never copies; chat only).

### S2 — the card: «Guardar» → confirm → save

`useStoredEditor.tsx`:

1. «Guardar» (or «Guardar parte i de n») no longer sends anything. It opens an inline confirmation in the
   footer (never `position: fixed`): «¿Guardar estos cambios?», the part's `lines` exactly as the check
   answered them (changes in words and every forced rule), the sentence «Se guarda en la app y se avisa por
   correo a quien le toque, como en /admin.», and two buttons: «Sí, guardar» and «Cancelar». While it is open
   the board is locked (as with «¿Asignar de todos modos?»). «Cancelar» calls nothing.
2. «Sí, guardar» closes the confirmation, sets `busy` (every button disabled, so no double write), and calls
   `app.callServerTool({ name: "save_service_edits_app", arguments: { month, changes: part } })` with the part
   untouched (as the chat path passes it today). It also empties `contextLines`, so nothing handed to the chat
   earlier for this list stays in the map a later «Mandar al chat» sends.
3. **One rule after a save starts: the edit list is never replayed.** From the first «Sí, guardar» for the
   current edit list, the list is either kept FROZEN for a repeat of the same part, or thrown away by a fresh
   check from the empty list (`runCheck(month, [], keep)`). It is never sent to `check_service_edits_app` again.
   While frozen, the seat gestures (open a seat, clear, exchange, «Asignar de todos modos») are disabled; only the
   save buttons, «Mandar al chat» (below) and «Descartar cambios» work. Reason: an attempt can write some services
   without the card knowing which (an unknown outcome, the 30 s start cutoff, a throw while the server's write goes
   on), and a replayed `place` of a member the month already holds is refused (`already_in_cell` /
   `member_not_in_cell`, `app/mcp/monthProposals/revise.ts`); two such refusals leave `runCheck` on the pre-save
   board (`useStoredEditor.tsx:87-91`). A fresh check from `[]` reads what is stored, whatever happened.
4. **`runCheck` takes the notice to keep.** `runCheck(month, edits, keep?: string[])`: when `keep` is given, the
   notice after the check is `keep` instead of `null`, so a follow-up check never erases the save's report (its
   lines include «S.whereNow», who is where after half a group was written, the only on-screen record of it).
   «Descartar cambios» after a save started passes the last save's lines as `keep` too.
5. The answer, read by a new pure `storedSaveViewOf` in `storedModel.ts` (`ok`, `lines` from `textLines`, `next`,
   and whether `structuredContent` was present), decides only between the two moves of 3.:
   - **`ok: true`** (every service «guardado» or «ya estaba»): the part is marked saved (`Parte i guardada` /
     `Guardado`, no button for it) and the notice shows the save's lines. Remaining parts keep their change sets
     and stay frozen (parts are disjoint units of the same check; another part's write does not touch their
     `baseRev`s). When every part is saved, `runCheck(month, [], saveLines)`: the board is the stored month read
     fresh (Frank sees himself in EG), the subtitle says «Sin cambios», and the save's lines stay as the notice.
   - **`ok: false` with `next: "repeat_same_call"`, an answer with no structured content** (`runWriteTool`'s
     catch), **or a throw** (transport, timeout, the host refusing app calls or not knowing the tool before the
     connector is refreshed): keep the list frozen, no re-check. The notice shows the server's text, or for a throw
     «No supe si se guardó. Toca «Guardar de nuevo»: lo que ya quedó dirá «ya estaba». Si sigue fallando, actualiza
     el conector o usa «Mandar al chat».» The part gets «Guardar de nuevo» (re-opens the confirmation for the SAME
     part) AND «Mandar al chat». A repeat is safe: what was written answers «ya estaba» (`sameRoleSemantics`
     against the fresh read, checked before «cambió»). «Mandar al chat» runs today's `send` (context + message,
     unchanged code) for that part, so a host that refuses app-initiated writes still saves through the chat and
     its permission prompt; since `contextLines` was emptied when the save started (2.), the context it sets holds
     `CONTEXT_HEAD` and this part's line only.
   - **Anything else** (a structured refusal — `refused: true`: «cambió», `not_the_checked`, `needs_card`,
     `unit_incomplete`, `group_too_big`, … — or `ok: false` with `next: "check_again"` or without `next`):
     `runCheck(month, [], [...saveLines, «Lo que no se guardó ya no está en la tarjeta: vuelve a hacerlo sobre el
     mes como quedó.»])`. Even a refusal that wrote nothing in THIS call throws the list away, because an earlier
     attempt for the same list may have written (deliberately simple: Frank redoes a refused edit on the fresh
     board rather than the card tracking which attempt may have written what).
   - `busy` resets in `finally` on every path; every button is disabled while a call runs (no double write).
     `callServerTool` gets an explicit `{ timeout: 70_000 }`, above the route's 60 s `maxDuration`, so a slow
     answer is not cut off by the client's 60 s default just before the server finishes.
6. After a save call returns a structured answer, the card replaces the model context with one line,
   `«Guardado desde la tarjeta: …» + the save's lines` (or «No se guardó: …»), so Claude knows what happened and
   the earlier `CONTEXT_HEAD` lines (arguments of a part now saved) are gone; `contextLines` resets. Best effort:
   a failed context update changes nothing on screen.
7. The footer note becomes «Al confirmar, la tarjeta guarda directo; Claude no interviene.»

### S3 — docs

- ADR-0066: an addendum «2026-10-23: the card saves» (no new number): what changed, why (Frank's ask; the one
  writer re-verifies everything; the in-card confirmation lists exactly the lines F4 compares, so it says what
  the host prompt said), and what still holds: the model cannot force (the model-visible check mints no waiver);
  the model cannot save without the host prompt (it cannot see `save_service_edits_app`; same caveat as
  ADR-0062 Q1 (1) for a client that ignores visibility); «Cargar» still goes through the chat.
- `docs/MCP.md` (the saved-month card and the tool list), CLAUDE.md, AGENTS.md (byte mirror) and
  `docs/agents/project-rules.md` lines that say «the card hands «Guardar» to the chat» / «never writes».
- Every place that names `save_service_edits` as the writer that queues its notices inline also names the
  app twin: `docs/NOTIFICATIONS.md`, the header comment of `app/api/mcp/route.ts`, the comment in
  `app/components/admin/v3Copy.ts`, and `docs/MCP.md`'s tool table.
- `SAVE_SERVICE_EDITS_DESCRIPTION` stays as it is (its «pide tocar «Guardar» otra vez» is still right: the tap now
  saves directly), so the model-visible list changes only by the new app-only tool.

## The trust boundary, before and after

| | Before | After |
|---|---|---|
| Who may start a card save | Frank's tap + Claude's call + the host prompt | Frank's tap + the card's confirmation (the host may add its own prompt) |
| What the person sees before the write | the host prompt with `save_service_edits`' arguments (lines in words, waivers as tokens) | the part's `lines` in words (changes and every forced rule) |
| What the server re-checks | MAC, date, unit, rules, F4 lines, waivers | the same, unchanged (one function) |
| Can the model write without the person | no (host prompt) | no: `save_service_edits` still prompts; the app-only twin is hidden from the model |
| Can the model force a rule | no (model check mints no waiver) | no (unchanged) |

What a reader must accept: a production write from the card is now confirmed by our UI, not the host's. That is
the same as `/admin`, which saves on one click.

## Tests

- `mcpRoute.test.ts`: `tools/list` has `save_service_edits_app` with visibility `["app"]`, `destructiveHint: true`,
  the input schema of `save_service_edits` with `toolsVersion` left out of the latter, and NO `toolsVersion` of
  its own; the recorded names still equal `tools/list`. The pinned lists that name the tools are updated with it:
  the destructive-name list in the annotations test, the `withCard` list and the Q1 visibility loop
  (`mcpRoute.test.ts`), and `scripts/mcp-dev-smoke.mjs` `EXPECTED_TOOLS` / `SERVICE_EDITOR_WRITE_NAMES` with
  `scripts/__tests__/mcpDevSmoke.test.ts` (the tool count).
- `serviceEditor` tests: `save_service_edits_app` and `save_service_edits`, given the same arguments and deps,
  answer the same (one bad MAC → `not_the_checked`; one valid save → `saved`), and the app one logs its own name.
- `storedMonthCard.test.tsx` (card, mocked `App`): «Guardar» opens the confirmation with the part's lines and
  calls nothing; «Cancelar» calls nothing; «Sí, guardar» calls `callServerTool` once with
  `save_service_edits_app` and `{ month, changes: part }` and never `sendMessage`; buttons are disabled while the
  call runs, with `{ timeout: 70_000 }`; `ok` → «Guardado», a re-check with `[]`, and the save's lines still the
  notice after that re-check; part 1 of 2 `ok` → seat gestures disabled until part 2 or «Descartar», and
  «Descartar» keeps the save's lines; `repeat_same_call`, an answer without structured content, and a throw → no
  re-check, list frozen, «Guardar de nuevo» re-opens the confirmation for the same part and «Mandar al chat» runs
  the old `send` with only that part's context line; `refused: true` and `check_again` → a re-check with `[]`
  (never the edit list) and the save's lines plus «Lo que no se guardó…» as the notice; an unknown outcome
  followed by a `refused: true` repeat → a re-check with `[]`. Across every test: between the first save call for a list
  and the next check from `[]`, `check_service_edits_app` is never called with a non-empty `edits`.
- `storedModel` unit tests for `storedSaveViewOf`.
- Gates: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors), `node mcp-app/build.mjs` (generated card
  committed; the URI digest changes, ADR-0069).

## Release and proof

Normal release order. dev cannot be driven from Frank's connector (it points at production), so the first live
use is in production: Frank refreshes the connector (the tool list changed), opens the 29 Nov card, puts himself
back in EG, «Guardar» → «Sí, guardar», and checks `/admin`. The save queues the same role notices as `/admin` would for that change (a
real email to whoever the change notifies, `docs/NOTIFICATIONS.md`); Frank is told before he taps. If the host refuses the app-initiated write, the card
says so and «Mandar al chat» saves the old way; that outcome is recorded in ADR-0066's addendum.

## Rejected

- **Calling the model-visible `save_service_edits` from the card.** It would work the same, but the logs could
  not tell the two paths apart, and visibility would not say that this call is the card's.
- **A card save without its own confirmation.** One mistaken tap would write production and email people.
- **Moving «Cargar» (proposals, `apply_schedule`) too.** It creates a month of drafts and fairness records; Frank
  was told it stays in the chat for now.
