# Native app: a lead proposes the setlist (slice W1)

Date: 2026-11-26. Owner: Frank. Tier: **critical** (moves a production writer and opens a second
door to it). Review log: `2026-11-26-native-proposal-save-design-review-log.md`.

## Requirement

Frank, 2026-11-26: «aun falta todo lo de admin y que los líderes puedan cargar cosas de los
servicios». The native iPhone app (ADR-0091) only reads today. This slice is the first write:
a Lead of a published service builds and submits that service's shared setlist proposal from the
app, with the same validations, concurrency rules and notifications as the web editor
(`/me/propose/[roleId]`).

Out of scope here, each its own later slice: posting to the proposal thread
(`/api/me/proposals/[id]/messages`), every admin write (review, team edits, publish), Android.

## What exists (verified in the tree)

- The lead's save lives **inside the route**: `postHandler` in `app/api/me/proposals/route.ts`
  (lines 96–487). It is not behind a `*Commit.ts`. It:
  1. guards with `requireMinistryMember("worship")` (cached `getMemberAccess`, a NextAuth session);
  2. parses with `parseProposalSaveRequest` (`app/utils/proposalWriteRequest.ts`), which refuses
     per-song `leadIds` and notes over `PROPOSAL_NOTES_MAX`;
  3. authorizes against the canonical role (`loadCanonicalRole`): single, no raw drafts,
     `published !== false`, caller in `canonicalLeadRefs(role)`; the target (type, date) comes
     from that role, never the client;
  4. resolves the ONE shared proposal (`loadProposalGroup`), compares it with the client's
     `observed` (`compareObservedTarget`), refuses an approved proposal;
  5. takes the coordination token (weekend lock, or the special role's own `_rev`);
  6. commits ONE transaction: patch under `ifRevisionId`, or `create` with
     `deterministicProposalId` (the co-lead first-create mutex), plus the token heartbeat;
  7. after commit: `notifyProposalPending` (awaited, only for `pending`), `queueLeadNotesNotice`
     (only when a note was appended; `beforeNotes`/`beforeMessageCount`/`previousStatus` captured
     pre-commit), then the guarded read-back of `_rev` and the thread.
- The route is wrapped in `withVerificationRunContext` and sets `maxDuration = 60`.
- The editor's reads live inside the page (`app/(client)/me/propose/[roleId]/page.tsx`):
  `getRoleDoc` (caller in `Lead[]`, `published != false`), `getSharedProposal`, `getServiceThread`.
- `/api/app/v1/*` handlers start with `requireAppSession(request, { needs })`
  (`appAuthStatic.test.ts`), are excluded from the `proxy.ts` matcher, and identify the caller as
  `auth.session.sanityId`. There is no impersonation on this door. Its access snapshot is cached
  30 s; ADR-0091 says a writer re-reads fresh.
- Route tests: `app/api/__tests__/proposalWriteRoutes.test.ts`,
  `app/api/__tests__/setlistNoticeQueueing.test.ts`. Caller guard for the other commit modules:
  `serviceCommitCallers.test.ts`.

## Decisions

### D1. Move the writer, do not copy it

New `app/utils/proposalSaveCommit.ts`:

```ts
export async function saveProposal(input: { leadId: string; raw: unknown }):
  Promise<{ status: number; body: unknown }>
```

It holds steps 2–7 above **verbatim** (the comments move with the code). The web route keeps
step 1, the JSON read (a body that is not JSON still answers `invalid_request` with
`issues: ["json"]`), the `withVerificationRunContext` wrapper and `maxDuration`, and answers
`NextResponse.json(result.body, { status: result.status })`.

Why a move and not a second handler: two copies of a 400-line concurrency protocol drift, and the
project's rule is one writer per document type. Why `raw` and not a parsed request: the parser is
part of the trust boundary and must run for every door. Why `{ status, body }` and not a typed
outcome: the route's existing tests assert exact statuses and bodies; keeping the shape makes the
move provable by those tests passing **unchanged**.

`leadId` is the only identity input. The function never reads a session.

`queueLeadNotesNotice` and `notifyProposalPending` stay called from inside `saveProposal`, in the
same order and under the same conditions. Both callers are route handlers, so the request scope
`after()` needs exists on both doors.

**The move is not test-neutral: four registries change with it, in the same PR.**

- `app/utils/protectedReadAudit.ts`: the protected-writer entry
  `app/api/me/proposals/route.ts#POST` becomes `app/utils/proposalSaveCommit.ts#module`, with the
  reason rewritten on the `setlistSaveCommit` precedent («the domain body of
  `POST /api/me/proposals`, moved here so the native app's door calls the same writer; the routes
  keep only authorization, and `serviceCommitCallers.test.ts` pins who may import this module»).
  The exact writer list in `protectedReadAudit.test.ts` is updated to match; the count stays
  twenty. The web route keeps its own canonical protected read (the `GET` handler), so its place
  in the «migrated» read list is unaffected.
- `app/utils/__tests__/__fixtures__/deliveryCapableImports.ts` gains `proposalSaveCommit`.
- `serviceCommitCallers.test.ts` `EXPECTED_CALLERS` gains
  `proposalSaveCommit: ["app/api/me/proposals/route.ts"]` in PR 1, and the app route is added to
  that list in PR 2.
- `seatClashGuardCoverage.test.ts`: `proposalSaveCommit.ts` joins `NON_SEAT_WRITERS` (it writes a
  `setlistProposal` and a lock heartbeat, never a seat); the test fails for any unclassified
  `*Commit.ts`.

Plus one generated artifact: `app/utils/__tests__/__fixtures__/colour-inventory.json` is
regenerated (`node scripts/colour-inventory.mjs`), because a new file under `app/` moves its
`filesScanned` count.

**Checked by running the gates, not only by reading (2026-11-26).** The move was made on the
branch with exactly these edits: `npx tsc --noEmit` clean, `npm test` 685 files / 12,420 tests
green, `npx eslint .` 0 errors. Before the edits the same suite showed 5 failures, all in the
four registries above and the colour inventory, and nothing else. A `diff` of the moved block
against the old route shows only the identity line removed and the three `NextResponse.json`
answers turned into `{ status, body }`. `proposalWriteRoutes.test.ts` and
`setlistNoticeQueueing.test.ts` pass with no edits. The same gate run is repeated for PR 2's new
files before its review.

PR 1 is therefore «writer moved + four registries updated»; `proposalWriteRoutes.test.ts` and
`setlistNoticeQueueing.test.ts` must pass without edits, and that is the proof of a pure move.

### D2. The app's write door

`POST /api/app/v1/proposals` (`app/api/app/v1/proposals/route.ts`):

1. `requireAppSession(request, { needs: { ministry: "worship", as: "member" } })` as its first
   statement of the inner handler (see the wrapper below).
2. `fetchMemberAccessFresh(auth.session.sanityId)`; not active → the door's 401
   `account_disabled` (`appUnauthorizedResponse`, so the app signs out as it does on every other
   endpoint); active but not a worship member → the door's 403. A failed read answers 503, never a
   write. The grant itself is not re-read fresh: a revoked grant can still write for up to 30 s per
   instance, the same window the MCP write door accepts; the ADR-0091 addendum states it. (The web door's cached guard is unchanged: this slice does not alter the web's
   behaviour.)
3. Read JSON (failure → the same `invalid_request` body), call
   `saveProposal({ leadId: auth.session.sanityId, raw })`, answer with `jsonNoStore`. A throw from
   `saveProposal` (a failed read before the commit, or a non-conflict commit error, which it
   rethrows as the web route does) is caught here and answered with the door's 503
   `temporarily_unavailable`, never a bare 500.
4. `maxDuration = 60`, `dynamic = "force-dynamic"`.
5. **Wrapped** in `withVerificationRunContext`, because the route imports a delivery-capable
   module and `srVerificationRunContext.test.ts` requires
   `export const POST = withVerificationRunContext(…)` for every such handler. That form is
   forbidden today by `appAuthStatic.test.ts`, which accepts only
   `export async function METHOD` with `requireAppSession` first. The two guards are reconciled by
   **narrowing, not loosening** `appAuthStatic`:

   ```ts
   async function postHandler(request: Request): Promise<Response> {
     const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });
     …
   }
   export const POST = withVerificationRunContext(postHandler);
   ```

   New rule in `appAuthStatic.test.ts`: an exported method is either
   `export async function METHOD(...)` (as today) or exactly
   `export const METHOD = withVerificationRunContext(<name>);` where `<name>` is an
   `async function <name>(...)` declared in the same file whose first statement passes the SAME
   first-statement and literal-`needs` checks. Any other `export const|let METHOD` stays refused.
   The test gains fixtures for: a wrapped handler whose inner first statement is not the guard
   (refused), a wrapper naming a function not in the file (refused), a wrapper around an arrow or
   an imported function (refused), and the valid form (accepted). The scan in
   `srVerificationRunContext.test.ts` gets no exemption. An unmarked request behaves exactly as an
   unwrapped one (`verificationRunMarkersFor` returns `null` with no header).

The body contract is the web's, unchanged:
`{ roleId, observed, songs, leadNotes?, teamNotes?, pastorMessage?, status: "draft" | "pending" }`.

Being a Lead of the service is still decided inside `saveProposal` from the canonical role, with
the same 403 for a non-Lead and for a draft service.

### D3. The app's editor read

New `app/utils/proposalEditorRead.ts` holds the page's three reads (moved, queries unchanged) and
one assembler; the page and the new route both call it. **The helper imports `operationalClient`
itself and runs the fetches; it takes no client parameter.**

Why: `protectedReadAudit` records a site only where a file `.fetch`es through a Sanity client it
imports (`scanSource`, `protectedReadAudit.ts:884-900`); a fetch on a parameter records nothing,
so a helper handed its client would take the role and proposal reads out of the audit and let a
future caller pass a raw client unseen. With the client imported in the helper, its three reads
are recorded as compliant sites there and a raw client in it would be flagged.

After the move the page records no protected read of its own, so in
`protectedReadAudit.test.ts`'s «migrated» list `app/(client)/me/propose/[roleId]/page.tsx` is
replaced by `app/utils/proposalEditorRead.ts`. The page and the app route then import no Sanity
client for these reads.

`GET /api/app/v1/proposals/[roleId]` (`needs` worship member): 404 unless the role exists, is
`published != false` and has the caller in `Lead[]` (the page's `getRoleDoc`); the role id is
checked with `isCanonicalDocumentId` before any read. Answers, no-store:

```
{ role: { id, kind, date, title },
  observed: { state: "none" } | { state: "single", id, rev },
  proposal: null | { status, songs: [{ songId, title, author, key, play_key, medley_tag,
                                       previous_keys }],
                     contributors: [{ id, name }],
                     teamNotes, pastorMessage, adminNotes, messages: [...] },
  serviceThread: { messages: [...], pastorMessage } }
```

`observed` is built from the same document the proposal fields come from, so what the app sends
back is what it was shown. The song fields use the save body's spelling (`play_key`,
`medley_tag`) because `parseSongRows` ignores unknown keys: a client echoing a different spelling
would save with no keys and no medleys and get a 200. A contract test round-trips D3's song rows
through `parseSongRows` and asserts the keys and medley tags survive. Thread messages carry author name, role, kind, body and time only (the
projection `THREAD_MESSAGES` already makes), never an email.

### D3b. «Tonos anteriores»

The web editor shows each song's previously played keys, both on the proposal's rows and when
picking a song (`ProposalEditor.tsx:394, :732-735`), from `/api/me/songs`'s `previous_keys`. The
app's Library carries no play history (`app/utils/appSongs.ts:20`). The history read in
`app/api/me/songs/route.ts:36-59` (canonical client, `canonicalizePlayHistory`,
`buildPreviousKeysBySong`) moves verbatim into `app/utils/songPreviousKeys.ts`
(`previousKeysFor(songIds, today)`, importing `operationalClient` itself, for the same audit
reason as D3), and `/api/me/songs` calls it. That fetch is the route's only protected read (its
other read is `post`, not a protected type), so in `protectedReadAudit.test.ts`'s «migrated» list
`app/api/me/songs/route.ts` is **replaced** by `app/utils/songPreviousKeys.ts`, keeping the
canonical-client pin on the history read. Then:

- D3 answers `previous_keys` on each proposal song row;
- `GET /api/app/v1/songs/previous-keys?ids=a,b,…` (`needs` worship member, at most 50 canonical
  ids, else 400) answers `{ [songId]: string[] }` for songs the app is about to add, so the picker
  shows them as the web does.

### D4. The services list says where the caller may propose

`GET /api/app/v1/services` gains two additive fields per service: `canPropose` (the caller's id
is in the role's raw `Lead[]._ref` of a published service, the writer's `canonicalLeadRefs`
rule, NOT the name-filtered people list the «mine» flag uses, which drops a Lead with no name) and `proposalStatus` (`null` or the shared proposal's status,
read only for services where `canPropose` is true, in one query by `service_ref._ref in $ids`;
when two share a `service_ref`, the oldest by `_createdAt` wins, D3's rule, so the list and the
editor agree).
Older builds ignore unknown fields.

### D5. Retry and lost responses (mobile networks)

The app never retries a save on its own. After a timeout or a lost response it re-reads D3 and
shows what is stored. A manual retry of a save that did commit carries a stale `observed` and is
refused with code `stale_revision` (`details.detail` is `concurrent_creation` for a first create,
`revision_mismatch` otherwise; the app switches on the code, not the detail) **before** any write or
notification, so no duplicate proposal, no duplicate thread note and no second «Nueva propuesta».
On any 409 the app keeps the person's local edits on screen, reloads D3 and offers «Recargar».
A 200 with `_rev: null` (committed, read-back failed) also forces a reload before the next save,
as the web editor does (`ProposalEditor.tsx:465-466`). A 503 or a network error is shown as «No
se pudo guardar», then the app re-reads D3 to learn whether the save landed.

### D6. The native editor (iPhone)

From a service the caller leads: «Proponer setlist» (or «Editar propuesta», with the status).
Songs are picked from the Library the app already holds, each with a play key; reorder by drag;
«medley» links consecutive songs and tags are re-derived on every reorder with a Swift port of
`normalizeMedleyTags` tested against the same cases as `medley.ts`. Team notes, the pastor's
message (ADR-0087: always sent, as the web editor does; `""` clears) and, on the first
submission only, a note to the admins (`leadNotes`; afterwards `""`, as the web editor does). Two
actions: «Guardar borrador», «Enviar». The proposal thread and the service thread are shown
read-only. Approved proposals open read-only. The app's API client decodes the 409 body (today it
maps 409 to a generic error) and reads the writer's 403 «Not a Lead on this service» as «Ya no
diriges este servicio», reloading the list.

### D7. Guards added

- `serviceCommitCallers.test.ts`: `proposalSaveCommit` is imported only by the two routes (D1);
  a new import-based check: no file under `app/api/app/v1/**` imports `writeClient` (the token
  and revoke routes write through `grantStore`, which stays allowed).
- `appAuthStatic.test.ts`: the narrowed wrapper rule and its four fixtures (D2.5).
- `protectedReadAudit`: the moved writer entry (D1); in the «migrated» list the page is replaced
  by `proposalEditorRead.ts` (D3) and `app/api/me/songs/route.ts` by `songPreviousKeys.ts` (D3b).
- `seatClashGuardCoverage`: `proposalSaveCommit.ts` classified (D1).
- The narrowed `appAuthStatic` rule also requires `withVerificationRunContext` to be imported from
  `@/app/utils/srVerificationRunContext`.
- The existing route tests pass unchanged against the web route.
- New route tests for the app door: no token 401; non-member 403; fresh access inactive 401
  `account_disabled` with no write; a throw from `saveProposal` answers 503 and is logged; non-Lead 403; happy path delegates with the token's `sub` as `leadId`; body not JSON.
- `appAuthStatic.test.ts` already enforces the first-statement guard on the new handlers.
- Read tests: non-Lead and draft service 404; `observed` matches the proposal returned.

### D8. Docs in the same delivery

ADR-0091 addendum (the app's first write door, why the writer moved, the 30 s grant window, the
wrapped handler form and its harmless reason-code warn line for an unauthenticated caller with
verification headers); CLAUDE.md and `docs/agents/project-rules.md` (the write-paths list gains
the lead's save and its module; the native-app invariant names the wrapped form);
`docs/NOTIFICATIONS.md` (the writer's new location); `docs/MOBILE.md` (the new endpoints);
`docs/UTILITIES_AND_COMPONENTS.md` (`proposalEditorRead`, `previousKeysFor`); and the two message
routes' comments that point at the old location. No comment in a non-delivery route names
`proposalSaveCommit` (the run-context scan is a substring match).

## Known gaps the owner should hear

- After the first submission the app cannot send the admins a note (that is the proposal thread,
  slice W2). The web can.
- D3 and D4 pick the proposal by `service_ref` only, the writer by two indexes. A legacy proposal
  reachable only by its target key would show as «none» and every save would answer 409. This is
  the web's behaviour today too (the page comment claiming identical selection is stale and is
  corrected in the move).

## Verification on a phone

Preview and production share the Sanity dataset, and a `pending` save on production mails the
admins. The first real-phone check is a «Guardar borrador» on a service Frank leads (silent), then
a reload showing it; «Enviar» only with Frank's go-ahead.

## Release

One PR for D1 alone (pure move; web tests unchanged) through preview and production first. A
second PR for D2–D4 and the iOS editor. The move is reversible by reverting the PR; nothing in
Sanity changes shape.

## Risks

- A subtle behaviour change hidden in the move. Mitigation: verbatim move, unchanged tests, and a
  diff review that reads the moved block side by side.
- `after()` outside a request scope if `saveProposal` is ever called from a script or an MCP tool.
  Not in this slice; the caller guard (D7) keeps it to the two routes.
- The web's cached membership guard remains as it is today (pre-existing, out of scope).
