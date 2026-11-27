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
web. The queue is never filtered, for the reason `proposalListView.ts` gives: hiding a pending row
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
   `buildAppAdminProposals(rows, me)` in `app/utils/appAdminProposals.ts`:

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
`play_key || key || ""`, as the web shows it. A row without `_id`, `_rev` or a valid status is
dropped. A song row with no `song_id` is dropped too, because the writer's approval would refuse
it (`proposal_songs_malformed`) and the web cannot approve it either. The app still gets 409 from
the writer, never a silent publish, so dropping the row only affects what is displayed.

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

- the songs, each with its Biblioteca cover (the cache the editor already uses), title, author,
  the proposed key in the key colour, and the medley mark;
- «Mensaje del pastor», with the web's note that approving copies it into the service when the
  service has none;
- «Mensaje para el equipo»;
- the conversation (`earlierMessages` then `messages`), with the W1b bubble view.

There is a composer when `threadOpen`. It is the W1b composer: 4000 UTF-16 units, the raw text
counted, «Enviar» disabled while empty after trimming. Its hint is «Lo ven el líder y los admins.».

The actions:

- **pending / changes_requested**:
  - «Aprobar» is disabled with no songs. It opens a confirmation: «¿Aprobar y publicar este
    setlist?» with «El setlist del servicio se reemplaza por esta propuesta y se avisa al líder.
    Si el servicio está publicado, el equipo recibe el aviso del setlist.». The confirm button is
    «Aprobar».
  - «Pedir cambios» opens a sheet with a required note («Explica qué debe cambiar el líder…»,
    4000 max) and «Enviar».
- **approved**: «Setlist publicado», and «Reabrir para ajustes». That opens a sheet with an
  optional note («¿Qué debe ajustarse? (opcional)») and «Reabrir».
- **draft**: no actions. The note says «El líder todavía no la envía.».

### Pure state: `ProposalReviewState` (`native/ios/Backstage/API/AdminProposals.swift`), XCTested

- `heldRev`: the revision the admin is reviewing. It is set from the list read and re-set only by
  a reload.
- `locked`: the fail-closed lock. It is set by any 409 from a decision, and by a posted message
  whose `observedRev` is non-nil and differs from `heldRev` (the web's `postAndLock`). It is
  cleared only by a reload.
- `deciding`, `posting` and `reloading` are three in-flight flags.
- `canDecide`: none of the flags set and not `locked`. For approve, the songs must also be
  non-empty.
- `canPost`: none of the flags set and `threadOpen`. A locked card may still post, as on the web.
- `canReload`: neither `deciding` nor `posting`.
- `finishMessage(proposalId:rev:observedRev:)`:
  - It clears `posting`.
  - It adopts `rev` into `heldRev` only when the proposal id matches, `observedRev == heldRev`,
    and both are non-nil. So the admin's own message never makes their next decision 409.
  - When `observedRev` is non-nil and differs, it sets `locked`.
  - With no `observedRev` it changes nothing else. A decision on that held revision then meets the
    writer's 409 and the banner, which is the fail-closed outcome.
- A decision always sends `heldRev`, never a revision fetched for the purpose. That is the
  writer's contract («the revision the admin ACTUALLY reviewed»).
- `reload` re-checks `canReload` after its read and before touching anything, as W1b does.

### Outcomes

`ProposalDecisionOutcome.from(status:data:)`:

| Answer | Outcome | What the app shows |
|---|---|---|
| 200, `idempotent` | `done` | «Sin cambios» |
| 200, approve | `done` | the web's `PASTOR_MESSAGE_TOAST` wording for `copied`, `kept_existing` or `failed`, else «Setlist publicado» |
| 200, other actions | `done` | «Cambios solicitados» or «Propuesta reabierta» |
| 409 | `conflict` | locks the card, banner «Propuesta actualizada. Cambió mientras la revisabas. Recarga y vuelve a revisar.» with «Recargar» |
| 403 | `forbidden` | «Ya no puedes revisar propuestas.» |
| 404 | `refused` | «Esta propuesta ya no existe.» |
| other 400 | `invalid` | «No se pudo procesar. Revisa la nota.» |
| anything else, including a lost answer | `failed` | «No se pudo confirmar. Recarga para ver si quedó.» |
| a tap while something is in flight | `notSent` | nothing |

After `done`, the list re-reads and the detail re-reads the same id. Retrying after `failed` is
safe: the writer's receipt or last-transition replay answers a repeated identical decision with
no write.

Messages reuse W1b's `ProposalMessageOutcome` mapping unchanged: `posted`, `forbidden`, `closed`,
`full`, `invalid`, `refused`, `failed`, `notSent`, with the same Spanish wording.

### Notifications

The notifications are the writers', unchanged:

- Approve pushes the lead and contributors. On a published service it queues the debounced setlist
  notice, and it copies the pastor's message (ADR-0087).
- Request changes and reopen push the lead.
- An admin message pushes the lead.

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
- `buildAppAdminProposals` unit tests:
  - names and `mine` only;
  - co-leads exclude the lead;
  - the special title;
  - `playKey` falls back to `key`;
  - malformed rows are dropped;
  - `threadOpen`.
- The registries.

**XCTest**

- `finishMessage`:
  - adopts only when the revisions match;
  - locks when they differ;
  - leaves everything as it was with no `observedRev`.
- `canDecide` is false while posting, reloading or locked, and approve is false with no songs.
- `canReload` is false while deciding.
- The decision outcome maps from status and body.

**Snapshot**: the list and the detail.

## Live testing

Approval must not be exercised on production data. It publishes a setlist and notifies the team.

On dev, which writes to the real dataset, only these run against the test proposal: list, open, an
admin message, request changes and reopen, all on the test service «Prueba app (no es real)»
(`18fa9ed1-…`, whose only server is Frank). Approve is covered by the door tests and the writer's
existing suites.

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

## Out of scope

- The admin's own-message edit and delete (the web has neither on a proposal thread).
- `reconcile_target`.
- The archive window.
- Android.
- The weekly admin's later slices: service messages, publish/unpublish, the team, the setlist.
