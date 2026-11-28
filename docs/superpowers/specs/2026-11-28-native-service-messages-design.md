# Native app: an admin's «Mensajes del servicio» on the iPhone (A-W2)

Date: 2026-11-28. Slice 2 of the native weekly admin (ADR-0091), after A-W1 «Revisar propuestas»
(`2026-11-27-native-admin-proposal-review-design.md`, PR #284).

## Requirement

Frank, 2026-11-26 15:21Z: admins and leaders load a service's content from the app. The agreed
weekly-admin order (Frank «Dale, no te detengas», 2026-11-27 21:04Z) is: 1) Revisar propuestas,
**2) Mensajes del servicio**, 3) Publicar/despublicar, 4) Editar equipo, 5) Editar setlist. The
app's bar (Frank): «como mínimo igual que la web app, pero apunta a ser mejor».

On the web an admin opens «Mensajes del servicio» from a service card
(`app/components/admin/ServiceMessagesDialog.tsx`, ADR-0065 + its 2026-10-24 amendment +
ADR-0087). The dialog has three parts, and each part has its own writer in
`app/utils/serviceThreadCommit.ts`:

1. **Mensaje del pastor** is ONE text per service (`setPastorMessage`, `PUT …/pastor-message`).
   An admin can set it, edit it or clear it. The first time it appears on a published service it
   mails and pushes the leads. The web dialog also offers «Usar como mensaje del pastor» when the
   leads' submitted proposal carries a different text (ADR-0087).
2. **Mensaje para el equipo** is the live setlist's `team_notes` (`saveTeamNotes`,
   `PUT …/team-notes`), guarded by the observed target. «Mover a mensaje del pastor» does two
   writes, the pastor's message first.
3. **Conversación con los líderes** is the service thread plus the shared proposal's own thread.
   A new message goes to the service thread (`postServiceThreadMessage`, `POST …/messages`), and it
   mails and pushes the leads when the service is published. An admin edits or deletes only their
   OWN service-thread messages (`editServiceThreadMessage` / `deleteServiceThreadMessage`,
   `PATCH|DELETE …/messages/[key]`).

The app has no door to any of these. Goal: the iPhone does what the dialog does, through the SAME
writers, with the app's messaging behaviour (PR #285: a message joins the chat at once and the
composer never locks).

## Risk tier

**Critical**, derived from the ladder rather than chosen. This slice adds a second mutation door
onto five production writers, and three of those writers notify the leads: a lost answer that is
resent duplicates an email. No writer changes, so there is no move step (unlike W1 and W1b): the
writers already live in `serviceThreadCommit.ts` and are already called by two surfaces (the web
routes and the MCP tools).

## Non-scope

- No writer change. Every body contract, refusal, notification rule and post-commit read-back
  stays the writer's.
- No message idempotency key. Adding one is a writer change with its own review; this slice uses
  the outbox's verify-before-resend rule instead (D5).
- No ministry check beyond the web's own: a manager who is not a content-editor. That gap is the
  same as the web's (FrankERP/owt-kb-v1#8) and is not widened here.
- **Where the phone is narrower than the web, named so Frank can weigh it against «como mínimo
  igual que la web»:** the entry point is the app's services list (`app/utils/appServices.ts`),
  so only published services from today to +95 days can be opened. These cannot:
  - a DRAFT service. On the web an admin can load the pastor's message before publishing;
  - a past service. Its thread is closed anyway, so only reading is lost;
  - a service beyond +95 days;
  - a week whose weekend role is duplicated, which the list does not show at all.

  The DOORS accept any canonical role id, exactly as the web routes do, so a later slice
  («Publicar/despublicar», which needs drafts) can open the sheet for drafts without a door
  change.
- No push or email on the phone for a lead's new message (an existing follow-up).

## D1. Where it opens, and for whom

- In `ServiceDetailView` (the detail opened from Inicio or Calendario), a «Mensajes del servicio»
  row appears when `model.me` is a manager and NOT a content-editor. This is the same rule as the
  Admin tab (`AdminTab`), read from the app session's level. The server decides again on every
  call (D3.1), so the client rule only decides what is shown.
- The row opens a full-height sheet, `ServiceMessagesSheet(serviceId:)`, which loads the read door
  (D2) when it opens and never before. A service card on the list costs no read, as on the web.

## D2. The read door: `GET /api/app/v1/admin/service-threads/[roleId]`

New route, `app/api/app/v1/admin/service-threads/[roleId]/route.ts`:

1. `requireAppSession(request, { needs: "manager" })` is the first statement, with a literal
   level. A content-editor gets 403 `appForbiddenResponse()`.
2. A roleId that fails `isCanonicalDocumentId`, or has no `serviceThreadId`, gets 404
   `{error:"not_found"}` before any read.
3. A FRESH access read (`fetchMemberAccessFresh`), exactly as the A-W1 doors do:
   - not active → 401 `account_disabled`;
   - no longer a manager, or now a content-editor → 403;
   - a failed read → 503.
4. `serviceConversationQuery(roleId, threadId)` on `operationalClient`. No service → 404
   `not_found`. A failed read → 503.
5. The answer is built by a new pure `buildAppServiceMessages(read, me)` in
   `app/utils/appServiceMessages.ts`. It is `jsonNoStore` and `dynamic = "force-dynamic"`, and it
   carries NO member id:

```ts
type AppServiceMessages = {
  service: { id: string; kind: "sunday" | "saturday" | "special"; date: string; title: string;
             published: boolean; leads: string[] /* names only */ };
  open: boolean;                       // isThreadOpen({ serviceDate }) at read time
  pastorMessage: null | { body: string; authorName: string | null; at: string | null;
                          editedAt: string | null; stamp: string };   // stamp = pastorMessageStamp(row)
  teamNotes: null                      // no setlist yet
           | { unavailable: "ambiguous" }
           | { text: string; observed: { id: string; rev: string } };  // teamNotesTarget, verbatim
  proposal: null | { status: "draft" | "pending" | "approved" | "changes_requested";
                     offeredPastorMessage: string | null };            // offeredProposalPastorMessage rule
  serviceMessages: AppThreadMessage[];   // the service thread, messagesOf(rows, me, "s")
  proposalMessages: AppThreadMessage[];  // the shared proposal's thread, messagesOf(rows, me, "p"); [] without one
};
```

- **The two threads travel apart**, as on the web dialog (`ServiceMessagesDialog.tsx`, which
  replaces only the service list after a write) and as in both existing app doors
  (`serviceThread.messages` + `proposal.messages`). The phone merges them for display, deduped by
  key and sorted by `at`, exactly as `conversation(_:)` does in `ProposalViews.swift`. The client
  rule:
  - a write answer (D3.1 step 9) REPLACES the service list only. `null` keeps it;
  - the proposal list changes only on a read of this door;
  - the merged list, and the outbox's `known` keys, are built from both;
  - a `verify` read (D5) is ADOPTED on screen, both lists, unless a write is in flight. This is
    the lead editor's rule from PR #285: a message the outbox hands over must stay in view.
- Both lists reuse `messagesOf(rows, me, source)`, so names, `mine` and the `"s"/"p"` fallback
  keys are exactly those of the editor door. Each `AppThreadMessage` gains one
  field, `editable: boolean`. It is true only when ALL of these hold: the row is in the SERVICE
  thread; it has a stored `_key` that passes `isMessageKey` (a fallback key never does); `mine`;
  and `open`. The writer re-checks the author and the open thread on every edit; `editable` only
  decides which rows offer «Editar»/«Eliminar».
- Adding `editable` to the shared type is optional for the existing doors: their builders set it
  to `false`, and the iOS decoder treats a missing value as `false`.
- `offeredPastorMessage` moves the web dialog's rule (`offeredProposalPastorMessage`: a submitted
  proposal's text, trimmed and with line endings folded, only when it differs from the service's
  message) into `app/utils/serviceMessageEdit.ts`. The dialog and the door then import ONE
  function. That is a pure move, guarded by the dialog's existing test. It is also required: the
  dialog is a `"use client"` module, and a server module must never CALL a value imported from one
  (CLAUDE.md, ADR-0028, `clientBoundary.test.ts`).
- `stamp` is computed on the server (`pastorMessageStamp`) and sent verbatim as the PUT's
  `observed`. The phone never derives it.
- `title` is built exactly as the services list builds it (`appServices.ts`), so the sheet and the
  card name the service the same way.

The read wraps nothing in `withVerificationRunContext`. It is its own module and sends nothing,
and `appAuthStatic.test.ts` accepts the plain `export async function GET` form when the guard is
the first statement. The SR scan (`srVerificationRunContext.test.ts`) matches substrings in the
route's OWN source, comments included, and follows no import. The GET route's source must
therefore never name a delivery-capable module, for example `serviceThreadCommit` or anything
matching `utils/email`. The title builder is imported in `appServiceMessages.ts`, not in the
route.

## D3. The write doors

Four new routes, the app's twins of the web's four:

| App door | Writer | Web twin |
| --- | --- | --- |
| `POST /api/app/v1/admin/service-threads/[roleId]/messages` | `postServiceThreadMessage` | `POST /api/admin/service-threads/[roleId]/messages` |
| `PATCH`/`DELETE /api/app/v1/admin/service-threads/[roleId]/messages/[key]` | `editServiceThreadMessage` / `deleteServiceThreadMessage` | same path under `/api/admin` |
| `PUT /api/app/v1/admin/service-threads/[roleId]/pastor-message` | `setPastorMessage` | same |
| `PUT /api/app/v1/admin/service-threads/[roleId]/team-notes` | `saveTeamNotes` | same |

### D3.1 What every write door does, in this order

1. `export const METHOD = withVerificationRunContext(<local async function>)`, whose first
   statement is `requireAppSession(request, { needs: "manager" })`. This is the form ADR-0091's W1
   addendum allows for a route that can send mail. It is used on all four, including the two that
   send nothing, because `srVerificationRunContext.test.ts` requires every handler that imports a
   delivery-capable module to be wrapped (the web routes do the same).
2. A content-editor gets 403.
3. A malformed roleId (`isCanonicalDocumentId` or `serviceThreadId` fails) gets 404 before any
   read. A malformed `[key]` (`isMessageKey` fails) also gets 404.
4. The fresh access read, as in D2 step 3: 401 `account_disabled` / 403 / 503. Never a write.
5. The JSON body is read (PATCH, POST and the PUTs). Malformed JSON gets 400 `invalid_request`
   with issues `["json"]`, the same answer as the A-W1 door.
6. The writer is called with the session's `sanityId` as the actor id. Where the writer takes a
   name (POST, pastor PUT), the name comes from ONE live read of `alias || member_name` through
   the existing `loadActorName` (`app/mcp/reads/serviceConversation.ts`, which the MCP message
   tools already use for these same writers), wrapped in `try/catch` → `""` on failure. That is the
   W1b door's rule (`authorNameOf`), with no third copy of the read. The name only words the
   leads' email; the stored message names its author by reference. An empty name already reads
   «Un admin» in the mail (`serviceThreadNotify.ts`), and the push carries no name.
7. Any throw from the writer answers 503 `appUnavailableResponse()`. The writers throw only on a
   failed pre-commit read or a non-conflict commit error, so the client treats a 503 as «not
   known whether it landed» only on POST, the one write without a guard (D5).
8. A refusal passes through `appRefusal(result)`, the ONE refusal shape of the admin doors:
   `{ error, conflict, details?: { issues } }`. Nothing else crosses: neither `details.detail`
   (`pastor_message_moved`, `no_setlist`, `revision_mismatch`) nor the 403's `code: "not_author"`.
   The phone therefore branches on the status, `error` and `issues` only (D6), and learns «no
   setlist» from a re-read, never from a refusal.
9. A success is shaped by a new pure builder per writer in `appServiceMessages.ts`:
   - **POST, PATCH, DELETE** → `{ serviceMessages: AppThreadMessage[] | null }`: the SERVICE thread's
     read-back through `messagesOf(rows, me, "s")`, with `editable` set as in D2, or `null` when
     the writer's guarded read-back failed («keep what you show»). The writer's `message` row
     carries an author id and is dropped.
   - **pastor PUT** → `{ pastorMessage: <D2 shape> | null }`. The writer's fallback row (when its
     read-back failed) carries `author: adminId` and no name. The builder takes only `body`, `at`
     and `edited_at` from it, uses the caller's own name, and computes the stamp.
   - **team-notes PUT** → `{ teamNotes: string | null, observed: { id, rev } }`, verbatim. It holds
     document ids only.

Each route sets `export const dynamic = "force-dynamic"`. POST and the pastor PUT also set
`maxDuration = 60`, because the writer's post-commit `after()` notice needs room, as on the web.

### D3.2 Shared contract fixture

`native/contract/service-message-bodies.json` holds one request body per write:

- `{ "body": "…" }` for the POST and the PATCH;
- `{ "body": "…", "observed": null }` and `{ "body": "", "observed": "<stamp>" }` for the pastor
  PUT;
- `{ "teamNotes": "…", "observed": { "id": "…", "rev": "…" } }` for the team-notes PUT.

A vitest parses each body with the writer's own parser (`parseProposalMessageRequest`,
`parseMessageEdit`, `parsePastorMessageEdit`, `parseTeamNotesEdit`) and expects `ok`. An XCTest
encodes the app's request types and asserts that they equal the fixture byte for byte (JSON
object equality). This is the A-W1 pattern, so a renamed field breaks a test on one side.

## D4. Registries and rules that must move with the doors

- `serviceCommitCallers.test.ts`: `serviceThreadCommit` gains the four app routes.
- `appAuthStatic.test.ts`: the four wrapped write routes and the plain GET match its accepted forms
  with a literal `needs`. No rule is narrowed or widened.
- `protectedReadAudit.ts` describes the Sanity WRITERS, not the doors that call them. The new
  doors write nothing themselves, so no entry is expected. Implementation runs its test and adds an
  entry only if the test asks for one, never by loosening it.
- `routeMatcher.test.ts`: `/api/app/v1` is already excluded from `proxy.ts`, but the test pins
  every ungated route against a reviewed `PUBLIC_ROUTES` list. Five entries are added, each with its
  justification in the A-W1 entries' words:
  - `/api/app/v1/admin/service-threads/sample`
  - `…/sample/messages`
  - `…/sample/messages/sample`
  - `…/sample/pastor-message`
  - `…/sample/team-notes`
- `AGENTS.md` mirrors CLAUDE.md (`agentDocsParity.test.ts`); `docs/API_REFERENCE.md` lists the
  new doors beside A-W1's; the caller sentence in `protectedReadAudit.ts` for the service-thread
  writers names the app doors.
- CLAUDE.md's «service conversation's writers» line, and the long form in
  `docs/agents/project-rules.md`: «called by its four routes, the app's four doors (A-W2), the MCP
  conversation tools and the proposal approval's copy».
- ADR-0091 addendum: A-W2 adds the service-thread doors; same audience as the web (manager, not a
  content-editor, no ministry check, #8).
- `docs/MOBILE.md`: the A-W2 row.

## D5. Lost answers and retries, per write

The rule is the same as PR #285's: a write whose answer was lost is resent only when a resend
cannot store something twice or notify twice.

| Write | A resend after a lost answer | So the app |
| --- | --- | --- |
| POST message | Appends again (no idempotency): a duplicate and a second email | Uses `MessageOutbox` unchanged. The sheet's `verify` is the read door's `messages` (D2). Two reads 2.5 s apart must miss the message before «Reintentar» |
| PATCH own message | Sets the same body again and moves `edited_at`. Nobody is notified | Retries freely; on success shows the answer's thread |
| DELETE own message | 404 `not_found` (already gone) | Treats a 404 on a retry of its own delete as done |
| pastor PUT | 409 `stale_revision`, because the stored stamp is no longer the observed one. No second notice | On a 409, re-reads (D2). If the stored body equals what it sent (trimmed, line endings folded), it says «Guardado» and adopts the read; otherwise it shows the web's stale copy («Otro admin cambió este mensaje…») with «Recargar» |
| team-notes PUT | 409 `stale_revision` (the setlist's `_rev` moved: `compareObservedTarget` says `revision_mismatch`). Nothing else is sent | Same as the pastor PUT: on a 409, re-reads. If the stored text equals what it sent, it says «Guardado»; otherwise it shows the stale copy |

- The comparison in the pastor and team-notes rows judges only the write the phone itself made.
  It never decides another admin's write. A 409 whose read shows a DIFFERENT text is shown as the
  conflict it is.
- «Mover a mensaje del pastor» keeps the web's order and copy: the pastor's message first, with
  `observed: null`, offered only when the service has none; then the team note is cleared. If the
  second write fails, the text is in both places, nothing is lost, and the sheet says the web's
  sentence («Ya es el mensaje del pastor, pero no se pudo quitar de aquí. Bórralo con «Editar».»).
- «Usar como mensaje del pastor» is one pastor PUT with the offered text and the current stamp, as
  on the web.

## D6. The iPhone sheet

`native/ios/Backstage/Views/ServiceMessagesViews.swift`, with state in
`native/ios/Backstage/API/ServiceMessages.swift`:

- **Header:** the service (date leaf, title) and its leads' names. A line «Borrador: los líderes
  no reciben avisos» appears when `published == false`. Unreachable from D1 today, it is kept for
  the later slice.
- **Mensaje del pastor:** the text in a `NoteBox`, with «Editar» and «Quitar». Editing opens an
  inline text editor that carries the stamp it STARTED from (never the one on screen at save time,
  as on the web). Saving a message that did not exist says, before the tap, «Les llega a los
  líderes por correo» on a published service. «Quitar» asks for confirmation. A submitted
  proposal's different text offers «Usar como mensaje del pastor», with the web's confirmation.
- **Mensaje para el equipo:** the text with «Editar», and «Mover a mensaje del pastor» when the
  pastor's message is empty. With no setlist: «Todavía no hay setlist; el mensaje para el equipo
  llega con la propuesta de los líderes». Ambiguous: the web's copy for a duplicated setlist.
- **After a pastor-message or team-note save**, the sheet asks the model to reload the services
  list. The card under the sheet shows both texts, and `ServiceDetailView` holds a `let service`;
  the web dialog does the same (`onChanged`). The detail adopts the reloaded row by id.
- **Conversación con los líderes:** `ConversationThread` (PR #285) with `canCompose: open`,
  `canPostNow` true while no edit or delete is in flight, the hint «Lo ven los líderes y los
  admins. A los líderes les llega por correo» (published) or «… no reciben aviso mientras el
  servicio no esté publicado» (draft), `post` → POST, `verify` → the read door's `messages`.
  - An `editable` message offers «Editar» and «Eliminar» in a context menu (long press).
    «Eliminar» asks for confirmation. Editing opens a sheet with the text and «Guardar».
  - `ConversationThread` gains an optional `actions(ThreadMessage) -> [Action]` parameter for
    this. The lead's and the admin's proposal screens pass none, so they do not change.
- A pull to refresh, or «Recargar», re-reads. While a POST is on its way or being checked, a
  reload never replaces the outbox; the outbox reconciles against the new thread, as in PR #285.
- Every write shows its own state: «Guardando…», then the saved text, or the refusal's words.
  Refusal copy, from what crosses the wire (D3.1 step 8):
  - issue `thread_closed` → «La conversación de este servicio ya cerró.»;
  - issue `messages_full` → the limit sentence;
  - 409 `stale_revision` → the D5 re-read decides «Guardado», «no setlist yet», or the web's
    stale copy;
  - 409 `ambiguous_target` / `integrity_conflict` → the web's blocked copy;
  - 403 → «No tienes permiso para hacer esto», then a re-read. A lost author and a lost admin
    role look the same on the wire, and the re-read shows which;
  - 401 → the session's sign-out path;
  - 503 → «No se pudo guardar. Revisa tu conexión».
- `MessageOutbox`'s refusal sentences name a proposal («Ya no puedes escribir en esta propuesta.»).
  They become a parameter (`MessageOutbox.Words`). The proposal screens pass today's sentences
  unchanged, and this sheet passes service wording («Ya no puedes escribir en este servicio.»,
  «No se pudo enviar: este servicio ya no existe.»). The rest of `MessageOutbox` is unchanged.

## D7. Tests

- **Vitest, `app/utils/__tests__/appServiceMessages.test.ts`:**
  - the read builder: no member id anywhere in the answer (a recursive scan for every id in the
    fixture);
  - `editable` only for an own, keyed, open, service-thread row;
  - fallback keys never editable;
  - the offered pastor text rule;
  - the stamp;
  - the three answer builders, including both `null` read-backs and the pastor fallback row with
    no name.
- **Vitest, the doors (`app/api/__tests__/appServiceMessagesRoutes.test.ts`), with mocked
  writers:**
  - D3.1's order: 401/403 before any read; 404 before any read; the fresh-read refusals; 400
    json;
  - the writer is called with `sanityId` and the live name;
  - a writer throw → 503;
  - a refusal passes through `appRefusal`;
  - success shapes.
- **The contract fixture test (D3.2)**, on both sides.
- **Registry tests updated (D4)**, never loosened.
- **XCTest:**
  - the decoder (missing `editable` → false; each `teamNotes` arm);
  - the D5 rules as pure functions: a pastor or team-notes 409 whose read shows the sent text →
    saved, a different text → stale; a DELETE 404 on a retry → done;
  - a POST, PATCH or DELETE answer replaces the service list and keeps every proposal row; a
    `null` answer keeps both;
  - the outbox's service wording;
  - the snapshot of the sheet in `SnapshotTests.swift` (filled; empty; no setlist; closed).

## Open questions for the review

None the author knows of. The empty-name email (D3.1 step 6) is an implementation check with a
stated fallback, not an open design choice.
