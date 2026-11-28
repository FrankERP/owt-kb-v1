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
- Unpublished services have no entry point. The app's services list reads `published != false`
  only (`app/utils/appServices.ts`). The DOORS accept any canonical role id, exactly as the web
  routes do, so a later slice («Publicar/despublicar») can open them for drafts without a door
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
  messages: AppThreadMessage[];        // service ("s") + proposal ("p"), merged by key, sorted by `at`
};
```

- `messages` reuses `messagesOf(rows, me, source)` for both threads, so names, `mine` and the
  `"s"/"p"` fallback keys are exactly those of the editor door. Each `AppThreadMessage` gains one
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
the first statement.

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
   name (POST, pastor PUT), the name comes from ONE guarded live read of
   `coalesce(alias, member_name)`, `""` on failure. This is the `authorNameOf` rule of the W1b
   door (`app/api/app/v1/proposal-messages/[proposalId]/route.ts`), moved into a shared helper,
   `app/appAuth/authorName.ts`, so the two doors keep one copy. The name only words the leads'
   email; the stored message names its author by reference. Implementation must confirm that
   `notifyLeadsAboutServiceMessage` words a mail with an empty name sensibly. If it does not, the
   fallback becomes `"Un admin"` at the door, and the web path is untouched.
7. Any throw from the writer answers 503 `appUnavailableResponse()`. The writers throw only on a
   failed pre-commit read or a non-conflict commit error, so the client treats a 503 as «not
   known whether it landed» only on POST, the one write without a guard (D5).
8. A refusal passes through `appRefusal(result)`, the A-W1 shape: codes, issues and document ids,
   never a member id.
9. A success is shaped by a new pure builder per writer in `appServiceMessages.ts`:
   - **POST, PATCH, DELETE** → `{ messages: AppThreadMessage[] | null }`: the SERVICE thread's
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
- `routeMatcher`: `/api/app/v1` is already excluded from `proxy.ts`. Nothing changes.
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
| pastor PUT | 409 `pastor_message_moved`, because the stored stamp is no longer the observed one. No second notice | On a 409, re-reads (D2). If the stored body equals what it sent (trimmed, line endings folded), it says «Guardado» and adopts the read; otherwise it shows the web's stale copy («Otro admin cambió este mensaje…») with «Recargar» |
| team-notes PUT | 409 `revision_moved` (the setlist's `_rev` moved). Nothing else is sent | Same as the pastor PUT: on a 409, re-reads. If the stored text equals what it sent, it says «Guardado»; otherwise it shows the stale copy |

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
  Refusal copy maps the writer's codes: `thread_closed` → «La conversación de este servicio ya
  cerró.»; `messages_full` → the limit sentence; `not_author` (403) → «Solo puedes editar tus
  mensajes.»; `no_setlist` → the no-setlist sentence; 401 → the session's sign-out path; 503 →
  «No se pudo guardar. Revisa tu conexión».

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
  - the snapshot of the sheet in `SnapshotTests.swift` (filled; empty; no setlist; closed).

## Open questions for the review

None the author knows of. The empty-name email (D3.1 step 6) is an implementation check with a
stated fallback, not an open design choice.
