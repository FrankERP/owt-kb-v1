# Native app: a Lead writes in a saved proposal's conversation (W1b)

Date: 2026-11-27. Slice of ADR-0091 (native apps), follows W1
(`2026-11-26-native-proposal-save-design.md`, PR #280 + #281).

## Requirement (Frank, verbatim, 2026-11-27 19:38Z)

> «ahorita que vuelvo a editar el borrador, ya no puedo agregar mensajes con los líderes»
> «Aparece el mensaje anterior que dejé, pero no puedo poner otro»

The iPhone editor lets a Lead write a note only on the FIRST save (`leadNotes`, which the writer
turns into the thread's first `lead_note` message). Once the proposal exists the app shows the
conversation read-only. The web editor shows a composer under the conversation whenever the
proposal exists (`app/(client)/me/propose/[roleId]/ProposalEditor.tsx`, `<ProposalThread
onPost={postMessage}>`), posting to `POST /api/me/proposals/[id]/messages`. The app has no door to
that writer. Goal: the app does exactly what the web does, through the same writer.

## Risk tier

Critical: a second door onto a production writer (a mutation trust boundary). Same shape as W1's
step 1 + step 2, so the same structure.

## D1. Move the writer body into `app/utils/proposalMessageCommit.ts` (no behaviour change)

`app/api/me/proposals/[id]/messages/route.ts` today holds authorization AND the domain body. Move
everything after the route's own checks into

```ts
export interface ProposalMessageResult { status: number; body: unknown }
export async function postProposalMessage(input: {
  leadId: string;          // the caller's member id — the ONE identity input
  authorName: string;      // cosmetic, for the approved-proposal admin push only
  proposalId: string;      // the path segment, as the route received it
  raw: unknown;            // the JSON body as read; parsed HERE (`parseProposalMessageRequest`)
}): Promise<ProposalMessageResult>
```

Moved verbatim, in order: `parseProposalMessageRequest`, `loadCanonicalProposal(proposalId)`,
the Lead + `published !== false` check (403 `{error:"Not a Lead on this service"}`),
`isThreadOpen` (400 `thread_closed`), `PROPOSAL_MESSAGES_MAX` (400 `messages_full`),
`buildProposalMessage` (400 `body`), the PRE-COMMIT snapshot (`beforeNotes`, `previousStatus`,
`beforeMessageCount`, `observedRev`), the `setIfMissing`+`append` commit with NO `ifRevisionId`
(409 `stale_revision` on a Sanity conflict, any other throw re-thrown), `queueLeadNotesNotice`,
the `approved`-only admin push inside `attemptSync(after(attempt(...)))`
(`pushAdminsAboutLeadMessage` moves with it; its author name is now the `authorName` input), the
guarded `THREAD_AFTER_APPEND_QUERY` read-back, and the 200 body
`{ ok, message, messages: rows|null, rev, observedRev }`.

The web route keeps: `maxDuration = 60`, `requireMinistryMember("worship")`, `sanityId` present,
the JSON read (400 `json`), then `postProposalMessage({ leadId, authorName: session.user.alias ||
session.user.name || "", proposalId: id, raw })` and `NextResponse.json(body, { status })`.
`export const POST = withVerificationRunContext(postHandler)` stays. Every observable answer of the
web route is unchanged: `app/api/__tests__/proposalMessageRoutes.test.ts` must pass with only its
mock paths adjusted if the module boundary needs it (no assertion changes).

The module throws only where the route threw before (a failed `loadCanonicalProposal` read, a
non-conflict commit error). Every post-commit step stays guarded.

Registries: `serviceCommitCallers.test.ts` gains `proposalMessageCommit: [the web route, the app
door]`; `protectedReadAudit.ts` moves the `app/api/me/proposals/[id]/messages/route.ts#POST`
entry to `app/utils/proposalMessageCommit.ts#module` (same reason text, plus "moved so the native
app's door calls the same writer") and its test list follows; `DELIVERY_CAPABLE_IMPORTS` gains
`proposalMessageCommit` (the module queues email and push).

## D2. The app door: `POST /api/app/v1/proposal-messages/[proposalId]`

A new top-level path, not under `proposals/[roleId]`: the writer keys by PROPOSAL id, and a
`[roleId]` segment would carry a redundant id the door would have to cross-check. `/api/app/v1`
is already excluded from the `proxy.ts` matcher as a whole.

Handler, the W1 door's shape (`app/api/app/v1/proposals/route.ts`):

1. `requireAppSession(request, { needs: { ministry: "worship", as: "member" } })` first.
2. `isCanonicalDocumentId(proposalId)` else 404 `not_found` (as the editor read's door).
3. A FRESH access read (`fetchMemberAccessFresh`): throw → 503; not active → 401
   `account_disabled`; not a worship member → 403.
4. JSON read → 400 `json` as the writer's `invalid_request` shape.
5. Author name: one guarded read `*[_type == "teamMembers" && _id == $id][0]{ "name": coalesce(alias, member_name) }`
   (the projection `app/(appauth)/app/authorize/page.tsx` already uses)
   on `operationalClient`; failure or absence → `""` (the push's existing nameless wording). This
   is cosmetic and never blocks the write, as the web route's comment requires.
6. `postProposalMessage({ leadId, authorName, proposalId, raw })`; a throw → 503.
7. The answer through `appMessageAnswer(result, leadId)` (in `appProposalEditor.ts`): non-2xx
   passes through as the writer shaped it (codes and ids, never a member id); a 2xx becomes
   `{ messages: messagesOf(rows, me, "p") | null, rev: string|null, observedRev: string|null }`.
   The writer's `message` row (it carries `author` = a member id) is dropped, as is `ok`.
8. `export const POST = withVerificationRunContext(postHandler)` with `postHandler(request,
   { params })`, the form `appAuthStatic.test.ts` accepts. `maxDuration = 60`, `force-dynamic`.

The writer does the Lead-of-this-published-service check on the canonical proposal's role, so the
door adds no second authorization of its own beyond the app session and the fresh access read.

## D3. iPhone

- `ProposalMessageResponse { messages: [ThreadMessage]?, rev: String?, observedRev: String? }` and
  `ProposalMessageOutcome { posted(ProposalMessageResponse), forbidden, closed, invalid, failed }`
  (`closed` = 400 with issue `thread_closed`; `invalid` = any other 400; `failed` = anything else,
  including a lost answer, where the message may or may not have landed).
- `APIClient.postProposalMessage(proposalId:body:)` and `AppModel.postProposalMessage` (a signed-out
  or disabled session goes to sign-in, as `saveProposal`).
- `ProposalDraftState` gains `postingMessage: Bool` and:
  - `canPostMessage`: proposal exists, not saving, not posting;
  - `canSave` also requires `!postingMessage` (a save racing an append would 409 on its own post);
  - `beginMessage() -> String?` (the proposal id, sets `postingMessage`);
  - `finishMessage(rev:observedRev:)`: clears `postingMessage`; adopts `rev` into `observed` ONLY
    when `observed` is `.single(id, r)` with `r == observedRev` and both are non-nil — the web's
    rule (`ProposalEditor.tsx` `postMessage`), so the lead's own post never makes their next save
    409, and a co-lead's change that landed first is never adopted silently. Never touches the
    draft, the notice, or `savedSnapshot`.
- The conversation card shows a composer whenever the proposal exists (any status, approved
  included, as the web) and the service day is today or later in America/Mexico_City (the
  writer's `isThreadOpen`; the server enforces it regardless). The card renders even with no
  messages yet when the composer is shown.
- Composer: a multi-line field, «Enviar» disabled while empty after trimming, over 4000 UTF-16
  units (`ProposalLimits.notesMax`), or while `!canPostMessage`. On `posted`: clear the field;
  replace the shown proposal thread with `messages` when non-nil, else keep it. On `failed`: keep
  the text, say «No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.» (it may have landed;
  the web shows the same retry-able failure). `forbidden` → «Ya no puedes escribir aquí»;
  `closed` → «La conversación de este servicio ya cerró»; `invalid` → «El mensaje no es válido».
- The «Nota para los admins» field on the first save stays as it is.

Notifications are the writer's, unchanged: a draft proposal notifies nobody; pending /
changes_requested queue the debounced lead-notes email to the admins; approved pushes the admins.

## Tests

- Vitest: the existing `proposalMessageRoutes.test.ts` lead-side suite unchanged in assertions; a
  new door suite (unauthenticated 401, bad id 404, fresh-read failure 503, disabled 401, not
  worship 403, writer throw 503, 2xx mapped with no member id and with `messages: null` kept,
  non-2xx pass-through, the author-name read failing still posts with `""`); `serviceCommitCallers`,
  `protectedReadAudit`, `appAuthStatic`, `srVerificationRunContext` registries.
- XCTest: `finishMessage` adopts only on a matching observed rev; never on nil; `canSave` false
  while posting; `canPostMessage` false with no proposal; outcome mapping from status + issue.
- Snapshot: the editor with the composer.

## Docs

CLAUDE.md invariant (the writers list: «a Lead's proposal message in `proposalMessageCommit.ts`,
called by `POST /api/me/proposals/[id]/messages` and the app's `POST
/api/app/v1/proposal-messages/[proposalId]`»), `docs/agents/project-rules.md` same section,
`docs/API_REFERENCE.md`, `docs/MOBILE.md`, `docs/UTILITIES_AND_COMPONENTS.md`, an ADR-0091
addendum line.

## Out of scope

Editing or deleting one's own message (the web lead side has neither). Admin-side posting from the
app (weekly admin, a later slice).
