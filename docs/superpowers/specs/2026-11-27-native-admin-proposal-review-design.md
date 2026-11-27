# Native app: an admin reviews setlist proposals from the iPhone (A-W1)

Date: 2026-11-27. First slice of the weekly admin on the native apps (ADR-0091). Follows W1
(`2026-11-26-native-proposal-save-design.md`) and W1b (`2026-11-27-native-proposal-message-design.md`).

## Requirement (Frank, verbatim, 2026-11-27 21:04Z)

> «Dale, no te detengas»

This answers the proposed weekly-admin order, whose first item was: «Revisar propuestas: ver
la lista, aprobar, pedir cambios, reabrir, y escribirle al líder en la conversación». The
standing goal for the native apps: «como mínimo igual que la web app, pero apunta a ser mejor».

What an admin does today on the web (`app/components/admin/ProposalsPanel.tsx`, the «Propuestas»
tab of `/admin`):

- It lists the proposals, landing on «Pendientes». The other tabs are «En revisión»,
  «Aprobadas», «Borradores» and «Todas».
- It reads one proposal: the date, the lead, the co-leads, the songs (title, author, the key the
  lead proposes, medleys), «Mensaje del pastor», «Mensaje para el equipo», and the conversation.
  The conversation shows the service's earlier admin messages (`earlier_messages`) followed by the
  proposal's thread.
- It decides through `PATCH /api/admin/proposals/[id]`. On pending or changes_requested:
  «Aprobar» (disabled with no songs) and «Solicitar cambios» (a note is required). On approved:
  «Reabrir para ajustes» (the note is optional).
- It writes in the thread through `POST /api/admin/proposals/[id]/messages`.
- On a 409 it shows «Propuesta actualizada — Cambió mientras la revisabas», and the card stays
  locked until a reload.

Goal: the app does the same through the same two writers, and is better where a phone is
riskier: an approval asks for confirmation first.

## Risk tier

**Critical.** This adds a second door onto two production writers: the proposal decision writer
(`reviewProposal`, which publishes a live setlist and notifies the team) and the admin's thread
append. Both doors are mutation trust boundaries.

## D1. Move the admin message body into `proposalMessageCommit.ts` (no behaviour change)

`app/api/admin/proposals/[id]/messages/route.ts` today holds both authorization and the domain
body. Move everything after the route's own checks into the module that already holds the lead's
side:

```ts
export async function postAdminProposalMessage(input: {
  adminId: string | null; // the caller's member id, the ONE identity input (null as the web allows)
  proposalId: string;     // the path segment, as the route received it
  raw: unknown;           // the JSON body as read; parsed HERE (`parseProposalMessageRequest`)
}): Promise<ProposalMessageResult>
```

These steps move verbatim, in order:

1. `parseProposalMessageRequest`.
2. `loadCanonicalProposal(proposalId)`.
3. `isThreadOpen` (400 `thread_closed`).
4. `PROPOSAL_MESSAGES_MAX` (400 `messages_full`).
5. `buildProposalMessage` with `authorRole: "admin"` and `kind: "admin_change_request"`
   (400 `body`).
6. The PRE-COMMIT `observedRev` and `pushDoc`.
7. The `setIfMissing` + `append` commit, with NO `ifRevisionId`. A Sanity conflict is 409
   `stale_revision`; any other throw is re-thrown.
8. The lead push «Nuevo mensaje / Un admin escribió en la propuesta.» inside
   `attemptSync(after(attempt(...)))`, author excluded, `awaitDelivery: true`.
9. The guarded `THREAD_AFTER_APPEND_QUERY` read-back.
10. The 200 body `{ ok, message, messages: rows|null, rev, observedRev }`.

The admin route keeps only these:

- `maxDuration = 60`;
- `requireActiveManager()` (403);
- the content-editor refusal (403);
- the JSON read (400 `json`);
- the call `postAdminProposalMessage({ adminId: session.user.sanityId ?? null, proposalId: id, raw })`
  followed by `NextResponse.json(body, { status })`.

`export const POST = withVerificationRunContext(postHandler)` stays hoisted above the handler.

Every observable answer of the web route is unchanged. Its existing route suite must pass with
only its mock paths adjusted. The module throws only where the route threw before: a failed
`loadCanonicalProposal` read, or a commit error that is not a conflict.

Registries:

- `serviceCommitCallers.test.ts`: the `proposalMessageCommit` entry gains the admin web route and
  the app's admin door.
- `protectedReadAudit.ts`: the `app/api/admin/proposals/[id]/messages/route.ts#POST` entry moves
  into the `app/utils/proposalMessageCommit.ts` entry, with its reason text kept and «moved so the
  native app's door calls the same writer» added. Its test list follows.
- `DELIVERY_CAPABLE_IMPORTS` already lists `proposalMessageCommit`.

## D2. Shared read: `app/utils/adminProposalsRead.ts`

The read of `GET /api/admin/proposals` moves into this helper, as W1 moved the editor's reads into
`proposalEditorRead.ts`. Its projection becomes `ADMIN_PROPOSAL_PROJECTION`, moved verbatim. The
helper has two functions, both on `operationalClient`, each with its own literal
`_type == "setlistProposal"` query, so `protectedReadAudit` records a canonical read in the
helper:

- `readAdminProposals()`: `*[_type == "setlistProposal"] | order(service_date asc) ${ADMIN_PROPOSAL_PROJECTION}`.
  This is today's query string byte for byte. The web route calls it and answers what it returns.
- `readAdminProposalsForApp(today)` differs in two ways:
  - It filters to the queue plus what is still ahead:
    `_type == "setlistProposal" && (status in ["pending","changes_requested"] || service_date >= $today)`.
  - It adds one field to the same projection, `"service_name": service_ref->service_name`, for a
    special's title.

The phone is for this week's work. The web's archive window and its «Ver N meses más» stay on the
web. This is narrower than the web's default, not equal to it: the web also shows the current
month's approved and draft rows (`proposalListView.ts`), so last Sunday's approved proposal is one
tap away on the web and not on the phone. The owner is told it in those terms. The queue is never filtered, for the reason `proposalListView.ts` gives: hiding a pending row
would strand the reviewer. `today` is the CDMX date
(`toLocaleDateString("sv",{timeZone:"America/Mexico_City"})`).

`protectedReadAudit.test.ts`'s «migrated» list replaces `app/api/admin/proposals/route.ts` with
`app/utils/adminProposalsRead.ts`. Once the literal leaves the route, the route has no protected
read site of its own. This is the same edit W1 made for `proposalEditorRead.ts`.

## D3. The app doors

All three doors have the W1 / W1b shape (`app/api/app/v1/proposal-messages/[proposalId]/route.ts`).

**Who may use them** is the web's rule exactly: an active manager who is not a content-editor,
i.e. admin or super-admin. The doors add no ministry check, and the web routes have none. That
gap is inherited deliberately and tracked as FrankERP/owt-kb-v1#8. A door stricter than the route
beside it would give two answers to «can this admin act on this proposal».

Each door declares `needs: "manager"` (a literal; `appAuthStatic.test.ts`). Each also refuses
`role === "content-editor"` with 403. For the reads, the refusal applies to the session's access.
For the two writes, it applies to the FRESH access read.

**Wire rule for refusals.** A non-2xx answer from a writer goes out reduced to
`{ error, conflict, details?: { issues: string[] } }`. `issues` is kept only when it is an array
of strings. Nothing else of the writer's `details` crosses: those carry revisions and target ids
the app does not need, and a coordination refusal's details are not audited for member ids. The
app branches on the status, `error` and `issues` only, as the web does.

### D3.1 `GET /api/app/v1/admin/proposals`

1. `requireAppSession(request, { needs: "manager" })`, then the content-editor 403 on
   `auth.session.access`.
2. One read: `readAdminProposalsForApp(today)`. A throw answers 503.
3. The answer is `{ proposals: AppAdminProposal[] }`, built by the pure
   `buildAppAdminProposals(rows, me, today)` in `app/utils/appAdminProposals.ts`:

```ts
type AppAdminProposal = {
  id: string; rev: string;
  status: "draft" | "pending" | "approved" | "changes_requested";
  service: { kind: "sunday" | "saturday" | "special"; date: string; title: string };
  leadName: string | null;
  coLeads: string[];            // contributors other than the lead, names only (the web's filter)
  songs: { songId: string; title: string; author: string | null; key: string | null;
           playKey: string; medleyTag: string | null }[];
  pastorMessage: string | null;
  teamNotes: string | null;
  messages: AppThreadMessage[];        // messagesOf(rows, me, "p")
  earlierMessages: AppThreadMessage[]; // messagesOf(rows, me, "s")
  threadOpen: boolean;                 // isThreadOpen({ serviceDate }), the writer's own rule
};
```

`messagesOf` is exported from `appProposalEditor.ts` and reused unchanged. It carries names and
`mine`, never an author id. `coLeads` compares contributor ids to the lead id on the server and
emits names only. No `lead_id`, `service_ref`, `approval_receipt`, `last_transition`,
`admin_notes` or `lead_notes` goes on the wire. `lead_notes` is already the thread's first message,
and the web does not show `admin_notes` either.

`title` follows `buildAppProposalEditor`: «Domingo», «Sábado», or the special's `service_name`
with whitespace folded, falling back to `SPECIAL_SERVICE_FALLBACK`. `playKey` is
`play_key || key || ""`, the lead editor's fallback. The admin panel renders `play_key`
alone; the fallback only fills an empty cell, and the writer publishes the row as stored either
way. A row without `_id`, `_rev` or a valid status is
dropped. A song row with no `song_id` is dropped too, because the writer's approval would refuse
it (`proposal_songs_malformed`) and the web cannot approve it either. The app still gets 409 from
the writer, never a silent publish, so dropping the row only affects what is displayed.

Three consequences of that narrowing are accepted for the phone and told to the owner:

- A past-dated approved row cannot be reopened from the phone; that stays on the web.
- The phone has no «Todas» tab.
- A past-dated queue row that gets decided leaves the list. See D4's «no longer in the list».

The GET door's source names neither writer module. `srVerificationRunContext`'s scan matches
substrings, and a read route needs no run-context wrapper.

The rows are ordered as `sortProposals` orders them (`app/components/admin/proposalListView.ts`,
a pure module).

### D3.2 `PATCH /api/app/v1/admin/proposals/[proposalId]`

1. `requireAppSession(request, { needs: "manager" })`, then the content-editor 403 on the session.
2. `isCanonicalDocumentId(proposalId)`, else 404 `not_found`, before any read.
3. A FRESH access read (`fetchMemberAccessFresh`):
   - a throw is 503;
   - an inactive account is 401 `account_disabled`;
   - an account that no longer meets `"manager"`, or is now a content-editor, is 403.
4. The JSON read. A failure is 400 with the writer's `invalid_request` shape, issue `json`.
5. The door allows only the three actions the web panel offers: `approve`, `request_changes` and
   `reopen`. Any other `action` (`reconcile_target` included) is 400 `invalid_request`, issue
   `action`, before the writer runs. `reconcile_target` is metadata repair the panel never sends.
   It stays on the web route and the MCP.
6. `reviewProposal(proposalId, raw, { reviewerId: auth.session.sanityId })`. A throw answers 503.
7. The answer goes through `appReviewAnswer(outcome)`:
   - a 2xx becomes `{ status: string, idempotent: boolean, pastorMessage: AdoptPastorMessageOutcome | null }`,
     with `setlistId`, `targetKey` and `ok` dropped;
   - a non-2xx is reduced by the wire rule.
8. `export const PATCH = withVerificationRunContext(patchHandler)`, hoisted. `maxDuration = 60`,
   `force-dynamic`.

The writer keeps every rule it has today: the reviewed `rev` asserted, the receipt replay that
makes a retried approval a no-write success, the weekend lock, the publish, the notices, the
pastor's-message copy. The door adds only its own entry checks.

### D3.3 `POST /api/app/v1/admin/proposal-messages/[proposalId]`

Steps 1–4 are those of D3.2. Then `postAdminProposalMessage({ adminId: auth.session.sanityId,
proposalId, raw })`; a throw answers 503. A 2xx goes out through the existing
`appMessageAnswer(result, me)`: `{ messages | null, rev, observedRev }`, without `message`, `ok`
or a member id. A non-2xx is reduced by the wire rule. The export form and the constants are
those of D3.2.

### Registries

- `serviceCommitCallers.test.ts`: `proposalReviewCommit` gains the PATCH door. `proposalMessageCommit`
  gains the admin web route and the message door.
- `protectedReadAudit`: the doors read and write nothing themselves; they call the helper and the
  writers. So they get no entry, like the W1 and W1b doors. The read helper's entry is D2's.
- `routeMatcher.test.ts` PUBLIC_ROUTES: `/api/app/v1/admin/proposals`,
  `/api/app/v1/admin/proposals/sample` and `/api/app/v1/admin/proposal-messages/sample`. The
  `/api/app/v1` prefix is already excluded from the `proxy.ts` matcher as a whole.
- `appAuthStatic.test.ts` covers the three routes by its glob.
- `srVerificationRunContext`'s scan covers the two writes.

## D4. iPhone

### Entry

- `Me.reviewsProposals`: `role == "admin" || role == "super-admin"`. This only hides the tab; the
  server decides every call.
- `MainTabs` builds its tabs as a list:
  - «Inicio» always;
  - «Biblioteca» when the person is in worship or is super-admin (today's rule);
  - «Admin» (`checkmark.seal`) when `reviewsProposals`.
  One tab renders without a tab bar, as today. A worship-less admin gets «Inicio» + «Admin», since
  the web lets them review (the #8 parity above).
- The «Admin» tab badge is the number of `pending` proposals from the last list read.
  `AppModel` reads the list on launch and on pull-to-refresh, for reviewers only.

### List: «Propuestas»

- A segmented control: «Pendientes (n)», «En revisión (n)», «Aprobadas», «Borradores». It lands
  on «Pendientes», as the web does.
- Each row shows the date tile, the service title, the lead's name, the song count and the
  status. An empty queue says «No hay propuestas pendientes.».
- Pull-to-refresh re-reads.

### Detail

The detail shows:

- the songs, each with its Biblioteca cover (the cache the editor already uses; a music-note tile
  when there is none, as for an admin outside Alabanza, whose Biblioteca read is refused), title, author,
  the proposed key in the key colour, and the medley mark;
- «Mensaje del pastor», with the web's note that approving copies it into the service when the
  service has none;
- «Mensaje para el equipo»;
- the conversation (`earlierMessages` then `messages`), ordered by `at` as the web's
  `orderedMessages` does, with the W1b bubble view;
- a song whose reference survives but whose song was deleted shows «Canción sin título», as the
  editor does.

There is a composer when `threadOpen`. It is the W1b composer: 4000 UTF-16 units, the raw text
counted, «Enviar» disabled while empty after trimming. Its hint is «Lo ven el líder y los admins.».

The actions:

- **pending / changes_requested**:
  - «Aprobar» is disabled with no songs. It opens a confirmation sheet:
    - title «¿Aprobar y publicar este setlist?»;
    - the songs it will publish, in order, with title and key;
    - «El setlist del servicio se reemplaza por esta propuesta y se avisa al líder y a quienes
      editaron la propuesta. Si el servicio está publicado, el equipo recibe el aviso del setlist.»;
    - the confirm button «Aprobar».
  - «Pedir cambios» opens a sheet with a required note («Explica qué debe cambiar el líder…»,
    4000 max) and «Enviar».
- **approved**: «Setlist publicado», and «Reabrir para ajustes». That opens a sheet with an
  optional note («¿Qué debe ajustarse? (opcional)») and «Reabrir».
- **draft**: no actions. The note says «El líder todavía no la envía.».

### Pure state: `ProposalReviewState` (`native/ios/Backstage/API/AdminProposals.swift`), XCTested

- `heldRev`: the revision the admin is reviewing. It is set only by a list read, the same read
  that supplies the songs, notes and status on screen. Content and revision therefore always come
  from one document read. **Nothing else ever writes `heldRev`**: not a message's `rev`, and not a
  revision fetched for a decision.
- `locked`: the fail-closed lock. It is set by any 409 from a decision, and by a posted message
  whose `observedRev` is non-nil and differs from `heldRev` (the web's `postAndLock`). It is
  cleared only by a reload.
- `deciding`, `posting` and `reloading` are three in-flight flags.
- `canDecide`: none of the flags set, not `locked`, and `changeSeen`. For approve, the songs must
  also be non-empty.
- `canPost`: none of the flags set and `threadOpen`. A locked card may still post, as on the web.
- `canReload`: neither `deciding` nor `posting`.
- `finishMessage(proposalId:observedRev:)`:
  - It clears `posting`.
  - It never adopts the answer's `rev`. That revision comes from a read-back taken AFTER the
    append, which carries no `ifRevisionId`. A lead's save, or another admin's decision, can land
    between the writer's load and that read-back. It would then be folded into `rev` while the
    screen still shows the old songs. Adopting it would let the next «Aprobar» publish content the
    admin was never shown.
  - When the proposal id matches and `observedRev` is non-nil and differs from `heldRev`, it sets
    `locked` (the web's `postAndLock`).
  - The answer's `messages` (when non-nil) replace the thread on screen at once, so the admin sees
    their message.
- **After every `posted`, the detail reloads** through the ordinary `reload`. That one list read
  brings the content and `heldRev` together, so the admin's own message never makes their next
  decision 409.
  - If that reload fails, `heldRev` stays as it was. A decision then meets the writer's 409 and the
    banner: fail closed.
  - The lock `finishMessage` set is cleared by that same reload. This is deliberate: the
    content and the revision then arrive together, and the change check below covers a content
    change.
- A decision always sends `heldRev`, never a revision fetched for the purpose. That is the
  writer's contract («the revision the admin ACTUALLY reviewed»).
- **Every reload that lands on an open detail checks for a change**, whatever started it: the
  reload after a message, «Recargar», pull-to-refresh, a list read on launch, or the return to
  the foreground. It compares the content fingerprint of the row on screen with the reloaded row:
  the songs in order with their keys and medleys, the team notes, the pastor's message, the
  status, and the service on screen (date, kind and title, which a `reconcile_target` from the web
  or the MCP can change).
  - When they differ, the detail shows the new content and sets `changeSeen = false`. A banner
    reads «La propuesta cambió. Revisa las canciones y notas antes de decidir.», with «Ya la
    revisé».
  - `canDecide` is false while `changeSeen` is false. A reload can therefore never put new content
    and a new `heldRev` under a decision the admin has not looked at again. This is the phone's
    version of the writer's 409, which an unrequested reload would otherwise have absorbed.
  - A reload with no content change (the admin's own message only moved the revision) raises
    nothing.
  - **The admin's own decision.** A decision that lands changes the status itself, so the check
    must not count that change against the admin. The rule, and its bounds:
    - It is armed only by a `done` whose answer reports a status (`expectedStatus` = that status).
      An `idempotent` `done` arms it too: its reported status is the one already stored, so it
      changes nothing. A `done` with no status in the answer does not arm it, and the next reload
      compares everything.
    - While armed, the next reload compares the status with `expectedStatus`, not with the status
      on screen. Another admin's decision landing in between (a reopen after my approval) leaves a
      different status and still raises the notice.
    - Songs, notes, pastor's message and service are always compared, armed or not.
    - It covers exactly one reload: the first list read that lands on the detail (whatever started
      it, or a «no longer in the list») disarms it. A reload that fails or is refused while
      something is in flight does not land, so it stays armed until one does.
- `reload` re-checks `canReload` after its read and before touching anything, as W1b does.
  - It applies only a row with the same proposal id.
  - A row no longer in the list leaves the detail on «Esta propuesta ya no está en la lista.»
    with no actions. A past-dated row that leaves the queue by being approved, or a deleted
    proposal, ends up here.
  - A reload clears `locked`. For a `blocked` 409 whose cause persists, the next decision meets
    the same 409 and the same wording; causes fixed elsewhere (content not ready, an ambiguous
    target) clear this way.
  - Returning to the foreground reloads the list and an open detail.
- Every decision sheet and the approval confirmation record the `heldRev` they were opened on. At
  the confirming tap, the app re-checks `canDecide`. If `heldRev` moved meanwhile, it sends
  nothing: the sheet closes, keeping the typed note, and the detail says «La propuesta cambió.
  Revísala de nuevo.». So a decision only ever carries the revision whose content was on screen
  when the admin chose.

### Outcomes

`ProposalDecisionOutcome.from(status:data:)`:

| Answer | Outcome | What the app shows |
|---|---|---|
| 200, `idempotent` | `done` | «Ya estaba aplicado.» (a retry after a lost answer lands here) |
| 200, approve | `done` | the web's `PASTOR_MESSAGE_TOAST` wording for `copied`, `kept_existing` or `failed`, else «Setlist publicado» |
| 200, other actions | `done` | «Cambios solicitados» or «Propuesta reabierta» |
| 409 `stale_revision` or `bootstrap_completed_reload` | `conflict` | locks the card, banner «Propuesta actualizada. Cambió mientras la revisabas. Recarga y vuelve a revisar.» with «Recargar» |
| any other 409 (`integrity_conflict`, `legacy_approval_unverified`, `ambiguous_target`, …) | `blocked` | locks the card, «Esta propuesta tiene un problema que hay que arreglar desde la web.» (W1b's `reloadCodes` split) |
| 401 | — | the session goes to sign-in, as `saveProposal` does |
| 403 | `forbidden` | «Ya no puedes revisar propuestas.» |
| 404 | `refused` | «Esta propuesta ya no existe.» |
| other 400 | `invalid` | «No se pudo procesar. Revisa la nota.» |
| anything else, including a lost answer | `failed` | «No se pudo confirmar. Recarga para ver si quedó.» |
| a tap while something is in flight | `notSent` | nothing |

After `done`, the list re-reads and the detail re-reads the same id, under the own-decision rule
above. Retrying after `failed` is
safe: the writer's receipt or last-transition replay answers a repeated identical decision with
no write.

Messages reuse W1b's `ProposalMessageOutcome` mapping: `posted`, `forbidden`, `closed`, `full`,
`invalid`, `refused`, `failed`, `notSent`. The wording is W1b's except for `failed`. An admin
message has no idempotency, so a retry after a lost answer is a permanent duplicate and a second
push. The admin's `failed` therefore says «No se pudo confirmar el envío. Recarga para ver si
llegó antes de volver a enviarlo.», and the text stays in the field.

### Notifications

The notifications are the writers', unchanged:

- Approve pushes the lead and contributors. On a published service it queues the debounced setlist
  notice, and it copies the pastor's message (ADR-0087).
- Request changes and reopen push the lead and contributors (`proposalReviewRecipients`).
- An admin message pushes the lead and contributors through `notifyProposalReview`, the author
  excluded.

The app sends nothing of its own.

## Tests

**Vitest**

- The existing admin message route suite, its assertions unchanged.
- The existing `GET /api/admin/proposals` suite, if any, unchanged. Otherwise one test that the web
  query string is the projection's.
- New door suites. Each of the three doors covers:
  - unauthenticated is 401;
  - content-editor is 403.
- The two writes also cover:
  - a bad id is 404 before the fresh read;
  - a fresh read that fails is 503;
  - an inactive account is 401;
  - an account demoted to content-editor is 403;
  - a body that is not JSON is 400;
  - a writer throw is 503;
  - a refusal is reduced (no `details` beyond `issues`);
  - a 2xx carries no member id, no `message` and no `ok`.
- The PATCH door also covers: `reconcile_target` is refused before the writer, and the reviewer id
  reaching the writer is the session's.
- `appRefusal` (the ONE wire reduction, in `appAdminProposals.ts`, used by both admin write
  doors): it keeps `error`, `conflict` and a string `issues` array, and drops everything else.
- `buildAppAdminProposals` unit tests:
  - names and `mine` only;
  - co-leads exclude the lead;
  - the special title;
  - `playKey` falls back to `key`;
  - malformed rows are dropped;
  - `threadOpen`.
- The registries.
- The decision body contract: `native/contract/proposal-decision-bodies.json` holds the three
  bodies the phone sends (approve, request changes with a note, reopen with an empty note). Vitest
  feeds each to `parseProposalTransitionRequest` and asserts the action and the note it reads;
  XCTest encodes `ProposalDecisionBody` for each and asserts the same JSON. A misspelled or dropped
  `adminNotes` would otherwise parse as `""` and «Pedir cambios» would commit with no note. This is
  the W1 fixture's pattern (`native/contract/proposal-save-body.json`).

**XCTest**

- `finishMessage`:
  - never changes `heldRev`, whatever `rev` and `observedRev` say;
  - locks when `observedRev` differs;
  - does not lock with no `observedRev` or with another proposal's id.
- `reload` sets `heldRev` and the content from one row.
- A sheet opened on a revision that has since moved sends nothing.
- Any reload that changes the songs, notes, pastor's message, status or service on an open detail
  sets `changeSeen = false`, and `canDecide` stays false until it is acknowledged, except the one
  status change the admin's own decision reported. A reload that only moves the revision does not.
- The own-decision rule: after a `done` reporting status S, a reload landing with status S raises
  nothing; with another status it raises the notice; a song change still raises it; it is disarmed
  after one landed reload (a second reload compares the status normally); a failed or refused
  reload leaves it armed; a `done` with no status does not arm it.
- `canDecide` is false while posting, reloading or locked, and approve is false with no songs.
- `canReload` is false while deciding.
- The decision outcome maps from status and body.

**Snapshot**: the list and the detail.

## Live testing

Approval must not be exercised on production data. It publishes a setlist and notifies the team.

On dev, which writes to the real dataset, only list, open, an admin message and «Pedir cambios»
run, and only against the test service «Prueba app (no es real)» (`18fa9ed1-…`, whose only
server is Frank). Even these happen only when its proposal is pending.

«Reabrir» needs an approved proposal, and approving the test proposal is forbidden. So reopen is
covered by the door tests and the writer's existing suites only. Approve through the new door gets
no live exercise at all. That gap is accepted: the door adds entry checks only, and the writer is
the one the web and the MCP already run.

## Docs

- CLAUDE.md and AGENTS.md (in parity): the writers line gains «the admin's message in
  `proposalMessageCommit.ts` too, called by `POST /api/admin/proposals/[id]/messages` and the app's
  `POST /api/app/v1/admin/proposal-messages/[proposalId]`». The proposals PATCH gains the app's
  `PATCH /api/app/v1/admin/proposals/[proposalId]` as a caller.
- `docs/agents/project-rules.md`, the same section.
- `docs/API_REFERENCE.md`.
- `docs/MOBILE.md`.
- `docs/UTILITIES_AND_COMPONENTS.md`.
- An ADR-0091 addendum line «2026-11-27 A-W1».

## Follow-up outside this slice

The web panel has the same latent hole D4 closes. `ProposalsPanel.tsx` `postMessage` adopts the
read-back `rev` unconditionally. This slice leaves `/admin` unchanged, and the owner is told so,
so that fixing the web is his call.

## Out of scope

- The admin's own-message edit and delete (the web has neither on a proposal thread).
- `reconcile_target`.
- The archive window.
- Android.
- The weekly admin's later slices: service messages, publish/unpublish, the team, the setlist.
