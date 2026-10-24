# OWT MCP — admin parity, phase 2: deleting services from the chat (plan)

**Status:** PLAN, not built. Needs two fresh adversarial approvals on the same bytes (critical tier),
then Frank's go-ahead to build. Frank decided Q1 and Q2 (§5).
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 2 of the Claude Doc «Todo el admin desde el chat»:
«Borrar un servicio o limpiar un mes. […] primero el chat te muestra exactamente qué se va a borrar.
El borrado solo pasa si la llamada repite esa lista tal cual […]. Así la lista aparece en el permiso
que te pide Claude.» Frank, 2026-10-24 00:27Z: «Dale con la fase 2».
**Builds on:** phase 1 (ADR-0066, PR #167 `23628c49`; the card save, PR #193 `bf7516bf`): the same
save discipline (fresh read, sort, refuse the whole call on «cambió», one write at a time, inline
notices, hard stop and start cut-off, classify each outcome, a repeat of the same call finishes).
**Risk tier: critical**, derived from the ladder: a production writer that DELETES documents (an
irreversible remote action), reached from the chat, with notification side effects. The whole plan
is the slice that owns that contract, so the whole plan is reviewed.

---

## 1. What Frank gets

1. «Borra los borradores de noviembre» (or «limpia noviembre», «borra el especial del 14»): Claude
   calls the read-only `check_service_deletes`, which answers the exact list, one line per service
   («sábado 7 nov · borrador», «domingo 8 nov · publicado: se avisa a hasta 9 personas»),
   plus the services it will NOT delete and why («domingo 15 nov: tiene setlist»).
2. Claude then calls the destructive `delete_services` with that list, unchanged. The Claude app
   asks permission and the prompt shows every line, so Frank reads exactly what goes before anything
   goes.
3. A published service sends its people the same «Ya no participas» email `/admin` sends; a draft
   sends nothing. Nothing else changes: the dependency refusals (setlist, proposal, a special's songs,
   any document that references the service), the weekend lock and the creation receipt are handled
   by `/admin`'s own writer.
4. A repeat of the same call after an interruption finishes the rest; what was already deleted
   answers «ya no existe».
5. The same from the saved-month card (Frank, 2026-10-24 00:51Z, «También desde la tarjeta»):
   «Borrar servicios…» opens the card's own confirmation with the same lines, and «Sí, borrar»
   deletes through an app-only twin of `delete_services`, without the app's permission prompt, as
   the card's «Guardar» already saves (ADR-0066 addendum).

What does not change: `/admin` (its card delete and «Limpiar mes» keep calling the DELETE route),
the route's rules, and the in-app assistant (read-only, ADR-0060).

## 2. Evidence (today)

- **The writer.** `DELETE /api/admin/roles/[id]` (`app/api/admin/roles/[id]/route.ts`,
  `deleteHandler`): `requireActiveManager` (not content-editor) → `parseDeleteRequest` `{rev,
  lockRev?}` → `loadRoleForWrite(id, rev)` (ambiguity, raw draft overlay, invalid role: fail closed)
  → `loadDependencies({operation: "delete"})` (`roleWriteOps.ts:419`, pure inventory in
  `roleDependencies.ts`: weekend setlists by week, proposals by target or `service_ref`, raw drafts of
  both, a special's embedded `songs`, any document that `references()` the role; unusable inventory →
  `integrity_conflict`; any dependency → refusal, never a cascade) → the weekend lock: owned → vacated
  in the transaction, `bootstrap` → `bootstrapLegacyLock` and a `bootstrap_completed_reload` /
  `bootstrap_outcome_unknown` / `stale_revision` answer with NO delete → receipts (more than one, or
  a mismatch → `integrity_conflict`; one → retired) → `beforeSeats` captured pre-commit → ONE
  transaction: vacate lock (`ifRevisionId`), retire receipt (`ifRevisionId`), a revision-asserting
  heartbeat on the role and `delete` → conflict → `stale_revision` → `queueRoleNotices({deleted:
  true, beforeSeats, published})` in `after()` → `revalidateRoleMutation()`.
- **It is not yet one of the commit modules.** CLAUDE.md's «eight admin write paths» do not include
  the DELETE; its logic lives in the route handler.
- **«Limpiar mes»** (`MonthGenerator.tsx` `handleClearMonth`, `clearMonthModel.ts`): drafts by
  default, published only when ticked; `published === false` is the only draft shape (absent =
  visible); one DELETE per service, sequential, a refused one does not stop the rest; a lost response
  is «verifica si quedó eliminado». There is deliberately no bulk route.
- **Notices.** A deleted published role queues one debounced notice per assignee, classified at flush
  as «Ya no participas» (`serviceMutationSideEffects.ts:585-592`, `notificationEmail.ts`); a draft
  delete is silent. `queueRoleNoticesNow` is the inline variant phase 1 uses.
- **Messages do not block a delete:** `serviceThread.role_id` is a plain string on purpose
  (`sanity/schemas/serviceThread.ts:11-14`), so a deleted service leaves its thread behind, as on
  `/admin`.
- **Phase 1's save machinery** (`app/mcp/tools/serviceEditor.ts`): `SAVE_HARD_STOP_MS` 45 s,
  `SAVE_START_CUTOFF_MS` 30 s, `beforeStop`, `keepWriteAlive` (`after()` keeps a write that outlived
  the answer running, with its inline notices), `runWriteTool`, `classifyPatchOutcome`
  (`plannerSaveModel.ts`), `rereadRole`.

## 3. Decisions, and why

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| D1 | **One writer.** `deleteHandler`'s body after `denyUnlessManager` and `parseDeleteRequest` moves into `app/utils/roleDeleteCommit.ts` (`deleteRole(id, request, options)`), called by the route and the MCP. The route keeps auth, JSON reading and `withVerificationRunContext`. It joins `serviceCommitCallers.test.ts` (eight → nine write paths) and `protectedReadAudit.ts`'s `PROTECTED_RUNTIME_WRITERS`. `options.notices`: `"deferred"` (the route, unchanged: `after()`) or `"inline"` (the MCP: `queueRoleNoticesNow`, awaited, its outcome in the answer), as `roleEditCommit.ts` does | A delete written for the connector | ADR-0043: MCP writes go only through the admin's own commit modules. Every guard of §2 applies to the chat by construction |
| D2 | **Preview, then an echoed list.** `check_service_deletes` (model-visible, read-only) answers, per deletable service, `{service, baseRev, line}`, and the services it will not delete with their reason. `delete_services` (destructive) takes `{month, deletes: [{service, baseRev, line}], token}`. `token` is minted by the check: HMAC of `MCP_OAUTH_SECRET` under its own label (`mcp-delete-list|`) over the month and the canonical JSON of the WHOLE `deletes` list, in the check's order; the save refuses any call whose list is not exactly the one the check minted it for (a subset, an added service, a published service under a drafts-only check), so «la llamada repite esa lista tal cual» is enforced, not only described. For every service still present, `line` must equal the server's own rendering from a fresh read (NFC, exact); a mismatch refuses the WHOLE call before any delete. **Both tools render from ONE read**, the writer's own: `loadCanonicalRolesByIds(ids)` (`roleWriteOps.ts`, the canonical `ROLE_PROJECTION` shape `loadRoleForWrite` reads, raw `_ref`s) plus `loadRawRoleDraftIdsForBaseIds(ids)` for overlays; the admin roles read (`adminRolesQuery`, dereferenced and filtered) only CHOOSES which ids are candidates in the check and never feeds a line | Delete by date or by «todo el mes» in one call; or show only ids; or lines without a list token | The doc's promise: the permission prompt shows exactly what goes, and the call repeats the preview's list. A line is a pure function of the stored service at `baseRev` in that one shape (T2), so the save re-renders it and compares, and a changed service is caught by its `_rev` first; the token binds the call to one preview. What the server cannot enforce is that Frank READ the preview: the human gate is the app's permission prompt, a host behaviour this repo has documented as a hint, which «Siempre permitir» removes (`docs/MCP.md`). So the ADR, `docs/MCP.md` and the tool description say: never choose «Siempre permitir» for `delete_services` |
| D3 | **Sort first, refuse on «cambió».** The save reads every named service fresh: gone → «ya no existe» (done, nothing to do); `_rev` ≠ `baseRev` → «cambió desde que lo revisaste» and the WHOLE call is refused before any delete; else «por borrar». Each «por borrar» line is compared (D2) | `/admin`'s «skip the stale one, delete the rest» | A service that changed since the preview may now be published or have other people; deleting it would not be what the prompt showed. Refusing the whole call keeps the prompt true. The repeat after a partial run still works: deleted services are gone (done), the rest are unchanged |
| D4 | **Published needs to be in the line.** A published service's line says so and counts the people the delete notifies: N = the unique person ids of `normalizeStoredSeats(role)` (`roleWriteRequest.ts`), the very function `deleteHandler` uses for `beforeSeats`, so the number and the notice audience are the same set by construction. The wording is «se avisa a hasta N personas»: at flush a recipient who turned that email off (`wantsNotification`) or whose member document no longer resolves is dropped (`outboxSweep.ts`). `check_service_deletes` selects drafts only unless asked for published (`include: "drafts" \| "all"`, default `"drafts"`, as «Limpiar mes»'s tick); naming a published service by id selects it explicitly | Refuse published services from the chat | Parity: `/admin` deletes published services. The line carries the consequence into the prompt, and the default is the safe one |
| D5 | **Past services stay in `/admin`** (Frank, Q2 = A). A service whose date is before today in CDMX is never deletable from the chat or the card (listed as «ya pasó: bórralo en /admin») | Parity | Deleting a past service changes the fairness balances retroactively (the ledger counts seats from stored services from `FAIRNESS_BALANCE_START`, ADR-0055) and erases history; a misread «borra noviembre» in December would do it. `/admin` keeps it, behind its own confirmation |
| D6 | **One delete at a time, inline notices, bounded time.** The «por borrar» services are deleted in date order through `deleteRole` with `notices: "inline"`; each delete and its notice upsert are awaited before the next starts. Every call races `SAVE_HARD_STOP_MS` (45 s); no delete STARTS after `SAVE_START_CUTOFF_MS` (30 s) — what did not start is «pendiente»; a lost race is «sin confirmar» and STOPS the run, the write kept alive with `keepWriteAlive` | One transaction for the month | The route deletes one role per transaction with its own lock and receipt; a bulk transaction would be a new writer. Same reasons as phase 1 T2.5 item 4: Next holds `after()` until the response closes, so durable notices go inline |
| D7 | **Classify each outcome.** `ok` → «borrado» (published: «avisos en cola» or, if the inline upsert failed, «borrado, avisos sin confirmar»). `not_found` → «ya no existe» (someone deleted it since the read: done). Proven pre-write refusals — `classifyPatchOutcome`'s `PROVEN_PREWRITE_FAILURES` (`invalid_request`, `forbidden`, `not_found`, `integrity_conflict`, `ambiguous_target`, `dependency_conflict` (unused), `stale_revision`) plus the delete's own dependency code `role_has_dependencies` (`roleDependencies.ts` `CODE_OF`), in a delete-specific `classifyDeleteOutcome` — and `bootstrap_completed_reload` (a lock maintenance write, no delete) → «no se borró» with the reason in words; the run continues. A throw, a timeout, a 5xx, `bootstrap_outcome_unknown`, or any unlisted code → «sin confirmar» and the run STOPS. After a `stale_revision`, re-read: gone → «ya no existe»; `_rev` unchanged → «repite la misma llamada»; changed → «revisa de nuevo». After `bootstrap_completed_reload` → «revisa de nuevo» (the maintenance write moved the service) | Treat every refusal as «repite» | Only contention is ever told to repeat, so a persistent refusal cannot loop. Each delete is independent (no groups), so a refusal never leaves a half-move behind |
| D8 | **The card deletes too, through an app-only twin** (Frank, Q1 = B). `delete_services_app` (`_meta.ui.visibility: ["app"]`, destructive) runs the SAME function as `delete_services`; only the log label differs. Every check of D2–D7 (token, lines, `_rev`, past, strict read, classification) runs whoever calls it. The card's own confirmation replaces the app's permission prompt for this path, as for «Guardar» | A card delete through the model-visible tool; or no card | Frank's choice. One function keeps one writer; a separate name keeps the logs able to tell the two paths apart. The model still cannot delete without the prompt: it does not see the twin (resting on the host hiding app-only tools, ADR-0062 Q1 (1), the same caveat as `save_service_edits_app`) |
| D9 | **No «unresolved write» guard.** `/admin`'s «Limpiar mes» refuses while one of its own saves, swaps or creations is unresolved (`clearUnresolvedWrite`, `MonthGenerator.tsx`), because its `_rev`s may be stale. The chat has no such client state: every call reads fresh and asserts each `_rev` (D3), and a service an unconfirmed create may have landed is simply not in the list, so it is not deleted and not reported as deleted | Mirror the guard | It guards a client's cached revisions; the save has none |
| D10 | **Recovery is named, with its limits.** The delete answer and `docs/MCP.md` say a delete cannot be undone from the chat, and how a wrong one is recovered: plan the month again (Auto, or «Crear servicio» and the seats), or restore the document from Sanity's history in Studio while the project's history retention still holds it (the retention is checked and written down during the build). A restored role comes back without the weekend lock its delete vacated or the receipt it retired, so `/admin` bootstraps its lock on the next save (the legacy path); and its people were already told «Ya no participas» | Silence | Frank knows it is irreversible; the plan still states the recovery it assumes and what it does not give back |

## 4. Tasks

- **T1 Extract the writer** (D1). `roleDeleteCommit.ts` `deleteRole(id, request: ParsedDeleteRequest,
  options?: {notices?: "deferred" | "inline"})` returns `{status, body, effects: {notices,
  noticesQueued}}` exactly as `editRole` does; the route sends `body`/`status`. Everything in §2's
  writer bullet moves unchanged, in the same order (dependency refusal BEFORE any maintenance write).
  Route tests pass unchanged. `serviceCommitCallers.test.ts`, its `DELIVERY_CAPABLE_IMPORTS` fixture
  (`__fixtures__/deliveryCapableImports.ts`; the test requires every `*Commit` there) and
  `PROTECTED_RUNTIME_WRITERS` list the new module; the CLAUDE.md invariant becomes «The nine admin write paths (… , delete …)».
- **T2 Selection and lines** (`app/mcp/monthProposals/deleteLines.ts`, pure). Input: the candidate
  roles as `loadCanonicalRolesByIds` returns them, the raw draft overlay ids from
  `loadRawRoleDraftIdsForBaseIds`, each candidate's dependency inventory (T3), the selection
  (`include`, or `services` by id), today in CDMX.
  Output: `deletable: [{service, baseRev, line}]` in date order (`byDateThenType` of
  `clearMonthModel.ts`, exported for this; a one-word change to an `/admin` module). A canonical
  weekend role carries `week`, not `date`, so every role is first mapped to `{…, date:
  storedRoleDate(role)}` before sorting, labelling or the «past» test (tested with a weekend line) and `kept: [{label, reason}]` (past, not in the month, a raw draft
  overlay (an id in the overlay list) or a role the canonical read returns more than once, as
  `loadRoleForWrite` would refuse; a dependency). A draft is `published === false` only; an absent `published` is visible, so it is a
  published service here (the worship read rule, `clearMonthModel.ts` `isDraftRole`). The line is
  `draftLabel(role)` (a special's line also says « · especial», so a special named like a weekday
  cannot read as a weekend service) + « · borrador» or « · publicado: se avisa a hasta N personas»
  (D4; N = 0 → « · publicado, sin equipo»). Pure, over T2's one input shape, so the check and the
  save render the same string. «Past» compares the stored service date (`week` or `date`, as
  `storedRoleDate` reads it) with today in CDMX.
- **T3 `check_service_deletes`** (model-visible, read-only): `{month, include?, services?}` (`services`:
  ids from `list_services`/`get_service`, at most 31; when given, `include` is ignored and a published
  id is selected). The admin roles read picks the month's candidate ids; then the one read of D2
  (canonical roles by id + raw overlays, one batched query each) and `loadDependencies({operation:
  "delete"})` per candidate, at most 4 candidates at a time, the whole tool raced against the same 45 s
  hard stop (a lost race answers «no pude revisar todo el mes a tiempo; pide menos servicios» and
  lists nothing as deletable). A candidate with a dependency, or whose inventory is unusable, moves to
  `kept` with its reason in words. More than 31 deletable services (several specials a day) → the
  first 31 in date order and «quedan N: revisa de nuevo después de borrar estos». Answers the
  text Claude needs: the lines, the kept list, and «Para borrar, llama delete_services con esta lista
  y su clave, tal cual: {...}» (phase 1's lesson: the model sees only the text). No ids of members, no names in
  logs.
- **T4 `delete_services`** (destructive, `destructiveHint: true`): `{month, deletes: [{service, baseRev,
  line}]}` (1–31, each service once, every service a role of `month` or gone). Steps: (1) admission
  (super-admin principal, as every write tool); (2) one fresh read of the named services, D2's read (canonical by id + raw overlays) through a
  STRICT reader that throws on a non-array answer (`roleWriteOps.ts`'s `run` turns one into `[]`,
  which would make every service look gone): a failed read refuses the call as «no pude leer el
  mes», never «ya no existe»; then T2 renders each present service's line; the token is verified
  (D2) before anything else is judged; sort (D3);
  any «cambió» → refuse all; any line mismatch → refuse all; a past service → refuse all (D5); all
  gone → «ya no existe», nothing to do; (3) delete in date order (D6), classify (D7); (4) the answer
  lists every service with its status and the next step («repite la misma llamada» only after
  «pendiente», «sin confirmar» or contention).
- **T6 The card** (`mcp-app/proposal-card`, saved-month mode; standard UI over D8's twin, reviewed
  with the rest because it moves the human gate). A «Borrar servicios…» action in the month's footer
  and a «Borrar este servicio» on each editable service. Both open a sheet: for the month, «Solo
  borradores» (default) or «También publicados»; the card then calls `check_service_deletes` with
  that selection (or the one service id) and shows its answer in the card's own confirmation: every
  line, the kept services with their reason, «Esto no se puede deshacer.», and the buttons «Sí,
  borrar» and «Cancelar». «Sí, borrar» calls `delete_services_app` with the check's list and token
  untouched (`callServerTool`, 70 s timeout). The rules, as for the card's save (ADR-0066 addendum):
  - The action is disabled while the card has unsaved edits or a save started («Guarda o descarta
    tus cambios primero»), so a delete never mixes with an edit list.
  - While the delete runs, and after an unknown outcome, the board is locked (`frozen`).
  - An unknown outcome (a throw, a timeout, an answer without structure, «sin confirmar»,
    «pendiente», «repite la misma llamada») keeps the SAME list and token frozen and offers «Borrar
    de nuevo» (the same call: deleted services answer «ya no existe», a changed one refuses all) and
    «Mandar al chat» (the list and token go to the chat, and Claude calls `delete_services` behind the
    permission prompt).
  - Any other answer (done, a refusal, «revisa de nuevo») shows the server's words and re-reads the
    month from the empty edit list; a failed re-read keeps the board locked and says so.
  - Lines the server writes for Claude («llama delete_services…», «repite…») are not shown on the
    card; the card says its own next step. Claude's context gets what was deleted
    (`updateModelContext`).
- **T5 Tests.** Route parity: the route's DELETE tests unchanged; the same request through the commit
  and the route produces the same outbox rows for a published service and none for a draft. Check:
  drafts only by default; `include: "all"` adds published with the count line; a past service, a
  service with a setlist, a proposal, a special with songs, a referencing document, and a raw draft
  overlay are `kept` with their reason; `services` by id selects a published one. Save: line
  mismatch, a changed `_rev`, a past service, a missing or wrong token, a subset of the check's list,
  and a list with one more service each refuse with ZERO deletes; a malformed read refuses as «no
  pude leer el mes» with zero deletes; a repeat after deleting 2
  of 4 deletes only the other 2 and answers «ya no existe» for the first; a dependency added after the
  check answers «no se borró» and the run continues; a lost race stops the run as «sin confirmar»; a
  delete not started before the cut-off is «pendiente»; each inline upsert is awaited before the next
  delete (a fake records the order); a failed upsert answers «avisos sin confirmar» and the run goes
  on; `bootstrap_completed_reload` → «revisa de nuevo», never «repite»; `stale_revision` with the
  `_rev` unchanged → «repite»; the line's N equals the number of distinct assignees the commit's
  queued notice carries for the same role (a published role with a repeated person, an instrument
  slot without a label, and a dangling ref), and the check and the save render byte-identical lines
  for the same stored role; a raw draft overlay is `kept` in the check; hygiene: no member id, name or rule key in a log line
  (`monthToolHygiene.test.ts`). Tool list: twenty-nine tools, the digest changes (ADR-0069), the three new
  tools in `mcpRoute.test.ts` (the twin's schema equals the chat tool's minus `toolsVersion`, the same
  annotations, app-only `_meta`) and `scripts/mcp-dev-smoke.mjs` with its test. Card (rendered as
  `storedCardSave.test.tsx` renders it, with the real check and delete over the fixture month):
  confirm and cancel; the action disabled with unsaved edits and after a save started; an unknown
  outcome offers «Borrar de nuevo» and «Mandar al chat» and the repeat sends the identical list and
  token; a refusal and a finished delete each re-read from the empty list; a failed re-read stays
  locked; the model-only lines never show on the card.

## 5. Frank's decisions (2026-10-24 00:51Z)

- **Q1 — where the delete happens: B, «También desde la tarjeta».** The chat (behind the
  permission prompt) and the card (behind its own confirmation, D8, T6).
- **Q2 — past services: A, «Solo de hoy en adelante».** Never from the chat or the card; `/admin`
  only (D5). Today's services stay deletable, as on `/admin`; a published one notifies its team that
  day.

## 6. Release and proof

Gates (tsc, vitest, eslint 0 errors). One merge-range code review. Preview → dev alias verified → PR →
prod alias verified. Live proof with Frank, each write on his OK, in this order: (1) create two
throwaway specials in a far month with `create_service`; delete one from the chat (preview, then
the call: this first call shows whether the app prompts at all and how it shows the lines), repeat
the same call («ya no existe»); delete the other from the card («Borrar este servicio» → «Sí,
borrar»); check `/admin`; (2) the prompt at full size with a call the SERVER refuses
whatever the prompt does: preview a real full month with `include: "all"`, then call
`delete_services` with that list but a token from another check (or one entry's `baseRev` altered),
so the call refuses with zero deletes even if it is approved; Frank reads whether every line shows
legibly. A unit test pins that such a call writes nothing. Nothing real is ever offered a valid call
during the proof. The whole call's time is read from that run; the cut-off only moves
down.

## 7. Docs in the same delivery

A new ADR (number taken at merge: ADR numbers are consecutive on `main` and other threads hold some on
`preview`): D2, D3, D5, D7. `docs/MCP.md` (the three tools, the prompt and «Siempre permitir», the card's «Borrar», the tool
count), the ADR-0066 addendum's card rules extended to the delete,
CLAUDE.md + AGENTS.md + `docs/agents/project-rules.md` (nine write paths; a delete from the chat only
through `roleDeleteCommit` with the echoed list), `docs/NOTIFICATIONS.md` (the inline «Ya no
participas» from the chat), `docs/SECRETS.md` (a new label on `MCP_OAUTH_SECRET`, the delete-list
token: rotating it mid-delete invalidates every pending preview, so the next call answers «revisa de
nuevo»).

## 8. Out of scope

Deleting songs, members or proposals (phase 4 and 3); cascading a delete into a setlist or a proposal
(never: `roleDependencies.ts` refuses, `/admin` too); moving a service to another date (phase 1's
open item).
