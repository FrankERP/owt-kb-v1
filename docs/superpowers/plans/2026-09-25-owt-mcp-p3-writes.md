# Implementation Plan: MCP P3: the four write tools

## Original request

> The **P3** row of [`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md):
> "`edit_setlist`, `swap_assignment`, `publish_service`, `unpublish_service` per the spec's write
> contracts, under I6–I9 and I12–I15. **Accepted when each produces the same document diff and the
> same notification set as the admin UI**, proven per tool on production against throwaway
> services whose notification audience is Frank alone (two for `swap_assignment`), **after** the
> exact recipients of each tool are confirmed and delivery — not only the audience — is checked —
> and when `publish_service` is shown to refuse a service the admin UI would refuse (I4) and to
> expose no override. `edit_setlist`'s first live run is on an **unpublished** draft … **The admin
> counterparts' own behaviour and tests are unchanged** by the authorization extraction."

The coordinating agent requested this plan for cycle `2026-09-25-mcp-p2-p3-plans`. Frank's own
words for the request were not supplied to this author. The roadmap row above is the accepted
parent requirement and is quoted verbatim.

## Status and contract

- **Document status:** Draft, revised after review. **Risk tier: CRITICAL.** The plan covers production writers, a
  notification audience, and multi-document concurrency (roadmap «Review handoff»). It needs two
  sequential fresh `APPROVED` verdicts on byte-identical text, plus a committed review log beside
  this file.
- **Accepted requirement source:** [`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md)
  (the spec, approved). It binds the Writes table, invariants I1–I15, the error contract E1, the
  Connector-origin section (DV1), and «Error handling, testing, first live exercise». The roadmap
  binds the P3 row and the coverage rows I4, I7, I8, I9, I12, I14, I15, "writes" and DV1, plus
  decision 6.
- **Primary outcome:** from the Claude app, Frank edits a setlist, swaps two whole sections or
  teams, publishes a draft and unpublishes a live service. Each tool lands the same document diff
  and queues the same notifications, to the same people, as the same action in `/admin`. No write
  can skip a guard `/admin` enforces, whether its server enforces it or only its editor, its
  planner or its read contract does (§ «Admin surface gates»).
- **Preconditions (entry gate, step 0):**
  1. P1 is fully accepted. Items 8 and 9 of the P1 checklist are still **pending** at `963cd736`
     (`docs/MCP.md:742-763`): phone acceptance, and a production latency figure against the 10 s
     stop condition. `publish_service` runs the same whole-catalogue load, so its budget (§ «The
     60 s ceiling») depends on that number.
  2. This plan is approved at critical tier.
  3. Frank gives the go-ahead to implement.
- **Safe ending state:** a connector with 12 tools: `ping`, the seven P1 reads and four writes. The
  writes are declared destructive. Each one has been proven once on production against throwaway
  services whose only notification audience is Frank, and the throwaways have been removed.
  Nothing writes through the connector except the four admin domain writers, which `/admin` also
  uses.

## Findings that change or sharpen the binding inputs

A reviewer should read these first. Each one was verified at `963cd736`.

| # | Finding | Evidence | Consequence in this plan |
|---|---|---|---|
| F1 | **The admin unpublish runs no outbox sweep.** The spec's `unpublish_service` row says it does "after it responds (`unpublish/route.ts:30-32`)". Those lines are only a stale comment ("its post-commit `after()` block hosts a sweep (Task 11)"). The file imports no `after`, no sweep and no notifier, and its only side effect is `revalidateRolePublication()` | `app/api/admin/roles/unpublish/route.ts:31-37,194-196`; `git log` of the file, whose last side-effect change was `0b1176a1` | The tool does exactly what the code does: no sweep. The spec's own escape clause applies ("the tool does the same, or records the difference — the scheduled sweep covers it either way"). The stale comment is corrected in step 6. An erratum is proposed in Handoff |
| F2 | **In the 2025-era (legacy) transport, a tool's body runs after the route handler has returned.** The SDK's legacy fallback returns an SSE `Response` at once and dispatches the tool asynchronously. Next resolves a route's pending `revalidatePath` tags once, when the handler's promise resolves. Tags pushed later are never executed, and `after()`'s own re-execution only diffs tags added inside its callbacks. So **a write tool's `revalidatePath` would be silently dropped** whenever a client speaks 2025-06-18. The dev smoke and the route tests speak it today (`LEGACY_PROTOCOL = "2025-06-18"`, and legacy `tools/call` answers `text/event-stream`). Which era claude.ai speaks is not recorded anywhere | `node_modules/@modelcontextprotocol/server/dist/index.mjs:770-800` (legacy SSE) vs `:10-135,1309-1420` (modern `"auto"` settles JSON after the result); `node_modules/next/dist/server/route-modules/app-route/module.js:222-231,494`; `…/server/revalidation-utils.js:24-37,141-155`; `…/server/web/spec-extension/revalidate.js:183-201`; `app/api/__tests__/mcpRoute.test.ts:123,300-306` | Step 1 makes every tool call finish inside the handler (buffering), whatever the era. It is proven by a regression test and a `next start` spike. Without it, I12 cannot hold |
| F3 | **A route file cannot export the domain function.** Next type-checks a route module's export set against a fixed list (HTTP methods, `dynamic`, `revalidate`, `maxDuration`, …), and `mcpRoute.test.ts:536` pins the MCP route's exports the same way | `node_modules/next/dist/build/webpack/plugins/next-types-plugin/index.js:46-63` | The authorization extraction (D1) moves each domain body into a new module under `app/utils/` |
| F4 | **The audit registry follows the transaction.** A protected write is detected where a Sanity client's mutation method is called in a region that names a protected type or calls a protected loader. Once the transaction leaves a route, that route's `PROTECTED_RUNTIME_WRITERS` entry is dead, and "carries no dead entries" fails | `app/utils/protectedReadAudit.ts:177-305,781-878`; `app/utils/__tests__/protectedReadAudit.test.ts:387-407,531-540` | Four route entries are replaced by four module entries, in the same commits as the moves. The MCP tool modules import no client, so they have **no** registry entry (D10). The roadmap's rollback wording "remove the tools and their registry entries" therefore becomes: remove the tools; the entries stay with the extraction |
| F5 | **A repo-wide guard would silently lose coverage.** `srVerificationRunContext.test.ts` decides which routes are "delivery-capable" by whether the route's own source imports `serviceMutationSideEffects`, `utils/push`, `utils/email`, `assignmentEmail` or `proposalNotify`. After the extraction, the four routes import only the domain module and drop out of the scan | `app/utils/__tests__/srVerificationRunContext.test.ts:619-677` | Step 3 adds the four domain module names to `DELIVERY_CAPABLE_IMPORTS`, so the same routes stay covered |
| F6 | **The setlist editor sends `leadIds` only on a worship night.** For any other service it omits them, and the writer stores no leaders | `app/components/admin/SetlistEditor.tsx:391-401`; `app/utils/setlistWriteRequest.ts:152-161,206-208` | `edit_setlist` builds the same body: leaders only when the target is a worship night (A16 still holds, since only a worship night can carry leaders) |
| F7 | **Outbox notices net out.** A notice's `before` snapshot is kept from its first queueing, and the flush compares it with live state. Two swaps that undo each other inside the debounce window therefore email nothing | `app/utils/serviceMutationSideEffects.ts:347-395`, `outboxNotice.ts:126-177` (`createIfNotExists` + `patch`) | The live proof waits for each swap's emails before the next swap (step 14) |
| F8 | **Issue #97**, a legacy-id setlist week that has a Studio draft: readiness matches the draft by base id and calls the week clean, while the setlist writer matches by `_type`+`week` and refuses | issue #97; `app/utils/serviceReadSummary.ts:445-490` vs `app/utils/serviceWriteTargets.ts:99-113`; `docs/MCP.md:197-205` | Left out of P3 (D3). The connector inherits exactly `/admin`'s behaviour |
| F9 | **`/admin` refuses more than its four routes.** The setlist editor will not open a stored setlist whose rows are malformed (a missing or duplicate `_key`, a missing or dangling song reference: `invalid_content`), will not add a song that is already in the list («Ya está»), and only offers catalogue songs. The stored planner swaps only two services of the opened month, and only two whose admission is `approved`: no duplicate weekend target, no duplicate special identity, no raw draft at the target, no dangling assignment, a valid lock. None of these routes repeats those checks. P1's `get_service` also reports `single` for a setlist whose content is invalid, because its observation checks identity only | `app/utils/setlistReadContract.ts:93-108,198-248,250-262`; `app/utils/serviceReadModel.ts:158-176`; `SetlistEditor.tsx:182-191,606-627`; `app/components/admin/storedRoleReadModel.ts:298-346`; `MonthGenerator.tsx:1661-1664,1990-1999,2802-2807`; `app/mcp/reads/servicePresenter.ts:354-356,378-382` | I15's counterpart is the **admin surface**: its UI, its read contract and its route. § «Admin surface gates» disposes of every client-side gate, one row each. The route half of I15 holds by construction (D1); the client half holds by that table (D13) |
| F10 | **A not-ready publish answers top-level `stale_revision`.** The publish-ready route picks `integrity_conflict` only when a hard blocker or an unusable observation is present; a service refused only for `not_ready` or `already_published` comes back as `409 stale_revision`, with the real reasons in `details.services[].reasons`. A commit race is also `stale_revision`, carrying `details.guard` | `app/api/admin/roles/publish-ready/route.ts:192-200,217-229,273-277` | `refusalFor` keys a publish refusal on `details.services[].reasons` first and `details.guard` second, never on the top-level code alone (step 7). Otherwise the model would read a blocker as "re-read and retry" |
| F11 | **The setlist writer silently blanks a `play_key` longer than 24 characters.** It normalizes the text (NFC, trim, collapsed whitespace) and stores nothing when the result is longer than 24. A `medley_tag` longer than 64 is refused instead. The editor has no length limit | `app/utils/setlistWriteRequest.ts:144-149,175-183,201` | The tool's schema refuses a `key` longer than 24 (I13). A stored key that long (only Studio can write one) is refused unless the row sends a new `key` (step 11) |

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| All four admin counterparts authorize the same way and use nothing else from the session. Each calls `requireActiveManager()`, refuses `content-editor` with a 403, reads the JSON body, and then runs the domain logic. The domain logic never reads the session | `app/api/admin/setlists/route.ts:262-282`; `roles/swap/route.ts:71-87`; `roles/publish-ready/route.ts:109-125`; `roles/unpublish/route.ts:64-80` | Authorization is the 8-line prefix, and everything after it is domain logic. The MCP principal is a live super-admin, checked per request by P0 (`app/api/mcp/route.ts:186-239`), so it passes the same role test (I6) |
| `requireActiveManager()` reads the session from ambient cookies and takes no `req` | `app/utils/authGuards.ts:13-27` | A bearer caller cannot reuse the guard. It can reuse everything after it |
| Every counterpart is wrapped in `withVerificationRunContext`. That wrapper only attaches A3 verification markers when a marked header is present, and an unwrapped handler "is not a safety hole" | `app/utils/srVerificationRunContext.ts:156-177`; the coverage scan, `app/utils/__tests__/srVerificationRunContext.test.ts:619-675` | The MCP route stays unwrapped. It is bearer-authenticated for one super-admin and is never an SR-verification run. The scan reads each `app/api/**/route.ts` **source** for the import names (`:649-650`) and follows no import, so it can never reach `app/api/mcp/route.ts`, whose delivery reach is transitive (route → `app/mcp/tools/*` → `*Commit`). An exception entry for that file would be dead code. Step 7 therefore adds no exception: it records the gap in `docs/MCP.md` and the step-3 ADR, and pins the route's own shape with a positive test (D15) |
| **Setlist writer.** Parse `:278`. Weekend target plus coordination `:309-338`, or the special target `:339-362`. `compareObservedTarget` `:365-372`. `validateSongLeads` `:377-380`. One transaction `:382-407`: deterministic `create` or an `ifRevisionId` patch, plus a lock heartbeat when a lock exists. Commit and conflict mapping `:409-423`. Then `revalidateSetlistSave()` `:430`, `notifySetlistSaved(week)` (awaited, and skipped for a draft or a role-less week) `:446`, and `queueSetlistNotice` with the before-songs captured pre-commit `:450-460`. The response carries no `_rev` and no row keys `:462` | `app/api/admin/setlists/route.ts` | Moves verbatim into `setlistSaveCommit.ts`. The fresh observation the spec requires comes from a read-back (D8) |
| The setlist writer rebuilds every row `_key` on save. It stores `play_key`/`medley_tag`/`leads` only when they are sent. It accepts at most 60 rows | `app/utils/setlistWriteRequest.ts:133,168-211` | Omitting an attribute clears it. `edit_setlist` must carry the stored attributes forward itself (spec A16) |
| The repeat-song hint is computed inline in the setlist GET: 8 weeks back, all three kinds, excluding this date | `app/api/admin/setlists/route.ts:49-53,164-225` | Extracted to a neutral helper (step 3) so the GET and `edit_setlist` share it |
| Medley rule: `normalizeMedleyTags` re-tags each adjacent run of 2 or more and untags singles. The editor calls it on remove and reorder only, never on a key change or an append | `app/utils/medley.ts:28-53` (neutral); `SetlistEditor.tsx:245-275` | The same trigger rule applies in `edit_setlist` (D7) |
| **Swap writer.** Parse `:83`. `loadRoleForWrite(id, rev)` for each role (asserts the observed rev) `:93-111`. Topology admission `:114-158`. Write plan from stored arrays, with `_key`s travelling `:160-239`. Dangling refusal `:241-249`. `resolveOwnedCoordination` `:251-257`. Pre-commit seat states `:259-274`. One transaction asserting both roles and every lock `:276-303`. Then `revalidateRoleMutation`, the per-destination push via `roleUpdateNotice`, and `queueRoleNotices` (union of before and after) `:305-338` | `app/api/admin/roles/swap/route.ts` | Moves verbatim into `roleSwapCommit.ts`. `parseSwapRequest` also accepts `kind: "seat"`, which the tool never constructs (decision 6). The stored planner also refuses a swap client-side: two services of different months, a role whose admission is not `approved` (duplicate weekend target, duplicate special identity, a raw draft at the target, a dangling assignment, a missing or invalid lock), a blank special name (`storedRoleReadModel.ts:298-346`; `MonthGenerator.tsx:1661-1664,1990-1999,2802-2807`). The route repeats none of these. The tool mirrors them (§ «Admin surface gates», rows S1–S2g; step 10) |
| The admin UI sends only `section` and `team` swaps, and refuses Saturday↔non-Saturday client-side. The server repeats that refusal (`incompatible_team_topology`) | `app/components/admin/MonthGenerator.tsx:2775-2836,2963`; `swap/route.ts:131-158` | The tool's schema has no seat shape (structural). The topology refusal is inherited from the server |
| **Publish writer.** Loader `:130`. Per-entry verdict inline `:173-212`. Atomic rejection `:214-230`. Assertion bundle `:232-263`. One transaction `:269-278`. Then `notifyRolePublished` (push plus consolidated email to every current assignee), `queuePublishedSetlistNotices` (the immediate «Setlist listo», ADR-0037) and `revalidateRolePublication` `:280-311` | `app/api/admin/roles/publish-ready/route.ts` | Moves verbatim into `publishReadyCommit.ts`. The verdict becomes one function, `publishVerdict` (D2) |
| **P1's D2 copy.** `publishRefusalFor` reproduces the route's verdict. It is pinned only behaviourally, over fixtures, and ADR-0040 names P3 as the place it ends | `app/mcp/reads/publishRefusal.ts:1-134`; `docs/adr/0040-…md` «Consequences» | P3 consolidates it (D2). D1, the snapshot mirror, stays for P4 |
| **Unpublish writer.** `loadRoleForWrite`, the type check, occupancy (canonical duplicates are refused as ambiguous, raw drafts as integrity) and coordination, then `published: false` via `computePublishTransitions` under `ifRevisionId` plus lock heartbeats, then `revalidateRolePublication()` only when something was patched. An already-draft service is a silent no-op (`unpublished: 0`) | `app/api/admin/roles/unpublish/route.ts:110-202` | Moves verbatim into `roleUnpublishCommit.ts`. It notifies nobody (F1) |
| `resolveOwnedCoordination` can commit a **maintenance write** (`bootstrapLegacyLock`) on a legacy weekend role and then refuse with `bootstrap_completed_reload` | `app/utils/roleWriteOps.ts:299-358`; `app/utils/serviceMutation.ts` (codes) | A refusal is not always "nothing written". The tool's refusal copy says so for the `bootstrap_*` codes (I9) |
| Side-effect helpers return `void` today. Recipients are resolved from arguments captured pre-commit: `notifyRoleAssignments` `:258-270`, `notifyRolePublished` `:285-301`, `queueRoleNotices` `:347-395`, `queueSetlistNotice` `:633-642`, `queuePublishedSetlistNotices` `:707-766`. `notifySetlistSaved` `:880-937` resolves its own audience: every worship member whose setlist preference is `all`, plus members assigned to a published service that week | `app/utils/serviceMutationSideEffects.ts` | I9 needs "which notifications, to whom" from the same values the helpers used, not a second derivation. Step 2 adds return descriptors to all six |
| Delivery filters live downstream. Push honours each member's `deviceTokens` and push preferences (`app/utils/push.ts:34-60`). The publish email's recipients are derived **inside** `sendAssignmentEmailsBatch`, from the service bodies it is handed: `assigneesOf(body)`, kept when `rolesForMember(id, body)` is non-empty (`assignmentEmail.ts:41-47,143-156`); it then honours an email address, `EMAIL_ALLOWLIST` and `wantsNotification(…, "assigned")` (`:159-167`). The setlist email goes to the service's participants at flush, `published != false` (`outboxSweep.ts:226-228`) | files | The tools report **audiences queued**, never deliveries (I9) |
| Layer-2 sweep: every committed outbox upsert runs a derated sweep in the same `after()` block. `sendBudgetMs` is `derateClock(40_000)` = 30 000, and `sweepDeadlineMs` is `derateClock(45_000)` = 32 500 | `serviceMutationSideEffects.ts:532-627`; `outboxSweep.ts:74,87,106`; `email.ts:24` | This is the 60 s arithmetic (§ «The 60 s ceiling»). It can also deliver other services' already-due notices, exactly as an `/admin` write does |
| **P1's observation shapes.** `get_service` returns `roleId`/`roleRev`, the seat `itemKey`s, and the setlist as `none`, `single{id,rev,rowKeys}`, `ambiguous`, `draft_overlay`, `invalid` or `unknown`. A row with no `_key` appears as `null` in `rowKeys`. "A future write tool will accept only `none` and `single`" | `app/mcp/reads/servicePresenter.ts:305-381`; `docs/MCP.md:185-198` | These are the observations the write inputs take (I7). The observation `rowKeys` are checked against storage. `single` says nothing about content validity (F9), so `edit_setlist` applies the editor's content gate itself (step 11) |
| MCP guards: no MCP file may import a non-canonical client (`mcpSanityClients.test.ts`, one exemption, P0's grant store), and none may spell the five role/setlist type words (`mcpProtectedTypeLiterals.test.ts`) | `app/mcp/__tests__/*` | Every write happens outside `app/mcp/`, in the domain modules. The tools stay free of literals |
| Draft gating scans only GROQ `*[…]` groups and backtick predicates | `app/utils/__tests__/draftGatingCoverage.test.ts:147-240` | The moved code holds no GROQ literal (all four routes use builders), so the new modules need no exemption (I2) |
| The tool-list test and the dev smoke pin exactly eight tools, all `{readOnlyHint: true, openWorldHint: false}`. `EXPECTED_TOOLS` is imported from the smoke | `app/api/__tests__/mcpRoute.test.ts:593-602`; `scripts/mcp-dev-smoke.mjs:301-346` | Both change to per-tool annotations (step 12) |
| `/api/mcp` already declares `maxDuration = 60` | `app/api/mcp/route.ts:52` | That is the write budget. Every counterpart runs under the same 60 |
| `claude/*` pushes produce `CANCELED` Vercel deployments | CLAUDE.md «Vercel safety»; `scripts/vercel-ignore-build.mjs` | Intermediate branch commits never serve traffic |
| `CLAUDE.md` and `AGENTS.md` must stay identical after normalization | `app/utils/__tests__/agentDocsParity.test.ts:21-23` | Every invariant line goes into both files in one commit |
| A role created in `/admin` stores an explicit boolean `published`, and a draft has `false` | `app/utils/roleWriteRequest.ts:203-231,283-316`; `app/api/admin/roles/route.ts:231,348` | A throwaway made in `/admin` is a real draft, so every draft-silence rule applies to it |
| A special cannot be deleted while it still has songs | `app/utils/roleDependencies.ts:295` | The cleanup clears the songs first (step 14) |

## Admin surface gates (I15's counterpart)

I15 says every write refuses **at least** what its admin counterpart refuses. The counterpart is
the **admin surface**: the screen Frank uses, the read contract that screen opens from, and the
route it posts to (F9). The route half holds by construction, because the tool calls the route's
own domain function with the route's own body (D1). The client half holds by this table: every
gate the editor, the planner, the Servicios panel or the setlist read contract enforces, with one
disposition each. Gates the route enforces too are listed as well, for completeness, as
`inherited`.

- **mirror**: the tool refuses it itself, before it calls the domain. The table says how and which
  test pins it.
- **mirror (behaviour)**: the gate is a behaviour, not a refusal: the editor produces a certain
  result (a carried attribute, a canonical medley tag, a reported hint). The tool reproduces that
  result, and a translation or report test pins it.
- **structural**: the tool's input cannot express the case.
- **inherited**: the route refuses it too, so the domain call refuses it with the route's code.
- **declared narrowing**: the tool does not refuse it. The row says why that is harmless, or names
  the open question when it is Frank's call.

Line numbers are at `963cd736`. Row ids name the surface: **E** the setlist editor, **S** the
swap planner, **P** the publish panel, **U** unpublish. They are gate rows, not the spec's error
contract E1 nor the read phase P1; elsewhere in this plan a gate is cited as a row of this
section, or beside the gate's name.

**`edit_setlist`**: the setlist editor and the setlist GET contract, against `PUT /api/admin/setlists`.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| E1 | **`invalid_content`.** The editor will not open a `single` setlist whose stored rows are malformed: a non-object row, a missing or duplicate `_key`, a missing song reference, or one that does not resolve. Its copy sends the admin to Studio | `setlistReadContract.ts:93-108` (content from the editor's own projection, `serviceReadQueries.ts:112-119`), `:232-233`, copy `:258-259`; `serviceReadModel.ts:158-176`; `SetlistEditor.tsx:182-191`. The route checks the target's id and rev only (`setlistWriteRequest.ts:118-129`; `setlists/route.ts:365-372`); the special loader validates seats only (`serviceWriteTargets.ts:164`). P1 reports such a setlist as `single` (`servicePresenter.ts:354-356,378-382`) | **mirror** | Step 11, resolution step 6: the editor's own predicate, `setlistContentState`, over the rows the writer's loader returned, with a resolver that answers from `loadSongTitles`. `invalid` is refused with `SETLIST_READ_ISSUE_COPY.invalid_content` and «No se escribió nada.». The resolver is `post`-typed (`songTitles.ts:31-36`) where the editor's `song->` is not (`serviceReadQueries.ts:118`), so a reference to an existing non-song document is refused here and opens in `/admin`: a declared narrowing, harmless (such a row is already broken for members). Refusal replay: a dangling song reference, a duplicate `_key`, a missing `_key`; each zero transactions |
| E2 | **Owning role.** `/admin` opens the editor only from a service card or a day card, so it can never target a date or a type that has no role | `ServicesPanel.tsx:762-768,1315,1552-1565`; `DayCard.tsx:111,239,366`. The route accepts any valid date and, with no owner, creates `<type>.<week>` and notifies nobody (`serviceWriteTargets.ts:232-235`; `setlists/route.ts:328-338,388-395`) | **structural** | The tool takes `serviceId`, resolves exactly one canonical role, and derives kind and week from it (step 11, steps 1–2). No input names a date or a type. A role deleted between the pre-read and the domain read is the gap the spec lets the tool inherit (§ «Data and failure safety») |
| E3 | **No duplicate song.** A search result already in the list shows «Ya está» and cannot be added; a newly created song has a fresh id | `SetlistEditor.tsx:606-627` (`:608,621,625`), `:318-341`. No uniqueness check in the route (`setlistWriteRequest.ts:168-189`). The notice table assumes one row per song (`setlistDiff.ts:31-38`) | **mirror** | Step 11 translation: a new row whose `songId` equals the song of any other resulting row, kept or new, is refused. Two **kept** rows that already name one song (a Studio duplicate, which the editor loads and saves back unchanged) are carried as they are (D14, Q7). Translation and refusal-replay tests |
| E4 | **Catalogue songs only.** Search and create return `post` documents | `app/api/admin/songs/route.ts:19-22`; `SetlistEditor.tsx:224-233,318-341`. The route checks the id's shape only (`setlistWriteRequest.ts:174`) and stores a strong reference (`:203`) | **mirror** | Every new `songId` must come back from `loadSongTitles` (a published `post`, `operationalClient`). Kept rows must resolve too, through E1's resolver. Refusal replay: a member id sent as `songId`; a deleted song |
| E5 | **Medley canonicalisation.** The editor re-derives tags on remove and reorder only, and links only adjacent rows | `SetlistEditor.tsx:245-275,276-316`; `medley.ts:33-53`. The route only normalizes the text (`setlistWriteRequest.ts:179-183`) | **mirror (behaviour)** | D7: the same trigger set (remove, reorder, a non-tail insert) plus an explicit `medleyTag`, after which `normalizeMedleyTags` leaves only adjacent runs of two or more. Translation tests |
| E6 | **Full-replacement round trip.** The editor loads each row's `play_key`, `medley_tag` and leaders and sends them all back | `SetlistEditor.tsx:192-207,391-401`. The route replaces `songs` wholesale (`setlists/route.ts:384,402`; `setlistWriteRequest.ts:151-153,196-209`) | **mirror (behaviour)** | Step 11 translation: a kept row starts from its stored attributes, and an absent attribute is kept (A16). Translation tests |
| E7 | **Leaders come from the resolved Lead roster.** The picker lists `Lead[]->` only; a leader who is no longer in it marks the row and disables the save | `serviceReadQueries.ts:137`; `songLeads.ts:82-93`; `SetlistEditor.tsx:427-428,524-540,668`. The route checks raw `Lead[]._ref` (`songLeads.ts:17-22,34-46`; `setlists/route.ts:377-380`) | **mirror** | Every lead id the body sends, carried or explicit, must resolve through `loadCanonicalMemberIds` (`roleWriteOps.ts:193-198`); the writer's `validateSongLeads` then checks Lead membership. Refusal replay: a carried leader whose member document is gone |
| E8 | **Source gate.** The editor opens only while roles, role targets and setlist targets are loaded | `ServicesPanel.tsx:762-764`; `serviceReadiness.ts:830` | **declared narrowing** (harmless) | The tool reads the writer's own targets (step 11, step 3) and never writes on a failed read |
| E-server | Refused by the route too, and earlier by the editor with its own copy: a duplicate target, a draft overlay, an invalid target or record, a missing `observed`, leaders on a service that is not a worship night, a leader not in Lead, more than two leaders or one named twice, a conflict that needs a reload, a special's role or date mismatch, more than 60 songs | `setlistReadContract.ts:239-244`; `SetlistEditor.tsx:374-377,406-415,668`; `setlists/route.ts:278-423`; `setlistWriteRequest.ts:152-161,170` | **inherited** | Step 11's refusal-replay table, with the route's code. The non-worship-night leaders case also carries the tool's own copy (F6) |
| E-key | **`play_key` longer than 24 characters is blanked** by the writer, silently (F11) | `setlistWriteRequest.ts:144-149,178,201` | **mirror** (I13) | The strict schema refuses a `key` longer than 24 characters. It counts the raw string, which is never looser than the writer's normalized count. A kept row whose stored `play_key` normalizes to more than 24 is refused unless the row sends `key`. (A `medley_tag` longer than 64 is refused by the writer itself, `:182-183`: inherited.) Schema and translation tests |
| E-hint | The repeat-song badge (advisory) | `SetlistEditor.tsx:69-83,511,616` | **mirror (behaviour)** | The repeat hint after a success (step 11), pinned by a report test |

**`swap_assignment`**: the stored planner in `MonthGenerator`, against `POST /api/admin/roles/swap`.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| S1 | **Same month.** The planner shows and swaps only the services of the month it has open | `MonthGenerator.tsx:1661-1664,1947-1953,1990-1999,3786`. The route has no date rule (`swap/route.ts:93-111`) and notifies both services (`:305-338`) | **mirror** (Q8) | Step 10 admission: both services' stored dates (`storedRoleDate`, CDMX `YYYY-MM-DD` day strings) must share `YYYY-MM`, the planner's own `date.slice(0, 7)` comparison. No `Date` is built. Refusal test, zero domain calls |
| S2a | **`duplicate_weekend_target`** | `storedRoleReadModel.ts:288-307`; `MonthGenerator.tsx:1990-1999,2802-2807`. The route reads no occupancy, and the lock's owner passes `planOwnedLock` (`roleWriteOps.ts:315-319`) | **mirror** | Readiness `roleTargetStatus` must be `single` (`assembleService` over P1's snapshot, `publishReadyBundle.ts:443-493`), and `loadTargetOccupancy(...).canonicalRoleIds` must be empty (`roleWriteOps.ts:371-409`), the unpublish writer's own check (`unpublish/route.ts:127-143`). Refused as `ambiguous_target` |
| S2b | **`duplicate_special_identity`**: another special on that date with the same normalized name | `storedRoleReadModel.ts:239-243,308`. **Not in readiness**: a special's target key is its own id (`serviceReadModel.ts:53-55`), so `buildRoleTargets` never groups two specials | **mirror** | `loadTargetOccupancy` for the special, which filters by `normalizeServiceName` (`roleWriteOps.ts:390-399`). Refused as `ambiguous_target`, detail `duplicate_special_identity` |
| S2c | **`ambiguous_target`**: a raw draft at the target, of this id or of another | `storedRoleReadModel.ts:313-317`. The route checks only a draft of the role's own id (`roleWriteOps.ts:237-242`) | **mirror** | Readiness `roleTargetStatus === "draft_conflict"` (drafts of any canonical id at the target, `serviceReadSummary.ts:242-247`), plus `loadTargetOccupancy(...).rawDraftIds` (a special's drafts matched by name or base id, `roleWriteOps.ts:400-407`). Refused as `integrity_conflict` |
| S2d | **Dangling reference anywhere on the role**, or an assignment mismatch between the planner's two loads | `storedRoleReadModel.ts:318-320`. The route checks only the people it moves (`swap/route.ts:241-249`) | **mirror** (dangling) / **structural** (mismatch) | `readiness.danglingRefCount > 0` is refused as `integrity_conflict`. The mismatch compares two independent loads; the tool reads one snapshot, so it cannot arise |
| S2e | `hidden_saturday_chorus`: a Saturday with stored Chorus is read-only in the planner | `storedRoleReadModel.ts:321-323` | **inherited** | The route refuses it (`swap/route.ts:117-129`); replayed in step 10 |
| S2f | **Structural checks**: a blank special name, an invalid `time`, a non-boolean `published`, a seat label that normalizes to nothing | `storedRoleReadModel.ts:181-212,309-311`. `validateRole` checks none of them (`serviceReadModel.ts:394-425`) | **mirror** (blank special name) / **declared narrowing** (the rest, harmless) | A special whose `normalizeServiceName(service_name)` is empty is refused: it has no identity for S2b to check. A swap never writes `time`, `published` or a label, and the route re-validates the seat arrays it moves (`swap/route.ts:208-212`) |
| S2g | **`bootstrapEligible`**: a legacy weekend role with no lock is read-only in the planner, and so is any other lock problem (`invalid_lock`) | `storedRoleReadModel.ts:326-344`; `MonthGenerator.tsx:2804-2806`. The route instead **commits** a lock create plus a heartbeat and then answers `409 bootstrap_completed_reload` (`roleWriteOps.ts:326-347`) | **mirror** | The missing lock surfaces in readiness: `assessRoleTargetLock` emits `missing_lock` (`roleTargetLock.ts:221`), and `assembleService` supplies every lock issue as a blocking `lock` integrity issue (`publishReadyBundle.ts:478,492`; `serviceReadiness.ts:455-464`). The tool refuses any `lock` issue before it calls the domain, so **this refusal writes nothing**. Only a lock that disappears between the admission read and the domain read still reaches the route's bootstrap, with the existing «Se reparó un dato interno…» copy (step 7). Refusal test: a snapshot with a missing lock, zero transactions |
| S3 | **Whole-inventory coherence**: any incoherence anywhere disables every swap | `storedRoleReadModel.ts:254-297`; `MonthGenerator.tsx:1655-1660` | **declared narrowing** (harmless) | The tool admits on the two roles and their targets only. The route asserts both revisions and every owned lock in one transaction |
| S4 | **Source and rules gates**: roles, members and role targets loaded, plus the shared solver rules | `MonthGenerator.tsx:1625-1639`; `ServicesPanel.tsx:979-988`; `serviceReadiness.ts:825,828` | **mirror** (sources) / **declared narrowing** (rules, harmless) | The admission needs `roles`, `members` and `roleTargets` ready (`CONTROL_REQUIRED_SOURCES.swap`, `serviceReadiness.ts:828`), or it refuses with «no se pudo comprobar». A swap applies no solver rule |
| S5 | **Local-work, lock and verification gates**: no swap while edits are unsaved or a previous outcome is unverified | `MonthGenerator.tsx:1967-2002,2749-2773,2798-2801,2845-2853` | **declared narrowing** (harmless) | The connector holds no local state. An unknown outcome says «vuelve a leer», never «repite» (step 7) |
| S6 | **Intent freeze** and post-swap verification | `MonthGenerator.tsx:2732-2747,2830-2834,2940-2961` | **declared narrowing** (harmless) | `freshRevs` comes back only when the read-back equals the written patch (step 10) |
| S7 | **No seat-level swap** | `MonthGenerator.tsx:2815,2913`; `ServicesPanel.tsx:1322`. The route accepts `seat` (`roleWriteRequest.ts:619-633`) | **structural** | The schema has no `seat` shape (roadmap decision 6). Schema test |
| S-server | Refused by the route too: Saturday team topology, Chorus with a Saturday, the same service twice, a stale rev, a wrong-owner, vacant or malformed lock, a raw draft of the role's own id, a non-role type | `swap/route.ts:89-158,241-257`; `roleWriteOps.ts:226-276,299-356`; `roleWriteRequest.ts:616-656` | **inherited** | Step 10's refusal-replay table |
| S-lead | Neither side guards it: a Lead swap on a worship night leaves `songs[].leads` naming someone no longer in Lead, and the editor then blocks the next save | `SetlistEditor.tsx:428,668` | **mirror (behaviour)**: reported, not refused, as the spec requires | `songLeadsOrphaned` (step 10), pinned by a report test |

**`publish_service`**: the Servicios panel, against `POST /api/admin/roles/publish-ready` in `ready` mode.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| P1 | `isReadyToPublish` double check | `publishSelection.ts:306-311` | **inherited** | The same dimensions as the route's verdict, now one function (`publishVerdict`, step 5) |
| P2 | `pendingOutcome` resubmit lock | `ServicesPanel.tsx:569-572,591-599,607-653` | **declared narrowing** (harmless) | A retry is refused `stale_revision`, because the first call moved the rev. An unknown outcome says «vuelve a leer», never «repite» |
| P3 | Visible scope: upcoming services, unless a month filter is on | `ServicesPanel.tsx:833-835,1084-1089` | **declared narrowing** (harmless) | A month filter reaches past services in `/admin` too |
| P4 | Confirmation dialog | `ServicesPanel.tsx:1371-1454` | **declared narrowing** (no data effect) | claude.ai's approval prompt for a `destructiveHint` tool plays that role |
| P-override | `mode: "override"` with acknowledged blockers | `publish-ready/route.ts:196-200` | **structural** | The schema has no `mode` (step 9) |

**`unpublish_service`**: the Servicios panel, against `POST /api/admin/roles/unpublish`.

| # | Gate | Code evidence | Disposition | How, and the test |
|---|---|---|---|---|
| U1 | «Ocultar» appears only on a published card | `ServiceReadinessCard.tsx:123,255-260` | **declared narrowing** (harmless) | The route answers `200 unpublished: 0`. The tool reports «ya estaba oculto», never success wording (step 8) |
| U2 | One service per request | `ServicesPanel.tsx:719-730` | **structural** | One `serviceId` (D11) |
| U3 | Source gate: roles and role targets | `serviceReadiness.ts:836` | **declared narrowing** (harmless) | The route loads its own targets |
| U4 | `pendingOutcome` lock | as P2 | **declared narrowing** (harmless) | As P2 |
| U5 | Confirmation dialog | `ServicesPanel.tsx:1518-1547` | **declared narrowing** (no data effect) | As P4 |

**How the table is tested.** Each refusal-replay case in steps 8–11 names its row.
- An **inherited** row asserts that the tool returns the route's code and that neither run commits.
- A refusing **mirror** row asserts that the tool refuses before calling the domain: zero domain
  calls and zero transactions. It also runs the route alone on the same fixture. Where the route refuses
  too, that proves both sides refuse. Where the route commits, that documents the gap the mirror
  closes, so a later route fix shows up as a changed test rather than silently.
- A **mirror (behaviour)** row is a translation or report test that asserts the editor's result.
- A **structural** row is a schema test.

Two rows are Frank's call, and each has a bounded default: E3's carried duplicates (Q7) and S1's
same-month rule (Q8).

## Scope

### In scope

- **Authorization extraction** of the four counterparts into domain modules. Behaviour is
  preserved, and the counterpart tests do not change.
- **One publish predicate** (`publishVerdict`), called by the publish writer and by the P1 reads.
  ADR-0040 is amended.
- **A transport completion gate** in `/api/mcp` (F2).
- **Return descriptors** from six side-effect helpers (additive).
- The four tools, their strict schemas, Spanish refusals and honest outcome reports. Three helpers
  support them: the row translation, the swap admission check and the reports.
- The tool-side mirrors of every client-side `/admin` gate the table in § «Admin surface gates»
  marks `mirror` or `mirror (behaviour)`.
- **Tests:** twin-run parity (the admin route and the tool over one fixture store), stale
  observation, refusal replay, transport completion, the tool list, and a caller pin on the
  domain writers.
- The dev smoke updated so it calls no write against a real service (DV1). Docs, a new ADR, and
  the invariant lines in `CLAUDE.md`/`AGENTS.md`.
- The production live proof, with parking points, and its cleanup.

### Non-goals

- Seat-level swaps, or any person-level edit on a created service (roadmap decision 6).
- Any override of a publish blocker. Batch publish and batch unpublish (the spec says "a
  service").
- Fixing issue #97 (D3). Retiring P1's snapshot mirror (D1 of P1/ADR-0040, which P4 needs).
- `solve_month`, `revise_proposal` and `apply_schedule` (P4), and the admin create route's
  extraction (P4's roadmap row).
- Any change to `app/utils/serviceReadQueries.ts`. P2 may touch it concurrently, and P3 neither
  needs nor makes a change there.
- A new secret or env var. P3 introduces none, so `docs/SECRETS.md` is untouched.

### Preserved invariants

- **The admin routes behave byte-identically.** Same statuses, same bodies, same transactions,
  same notifications, same revalidation. Their five test files (`setlistWriteRoute`,
  `setlistsRoute`, `setlistNoticeQueueing`, `roleSwapRoutes`, `publishReadyRoutes`, all under
  `app/api/__tests__/`) pass with **zero diff**. Only two repo-wide guards change, and only to keep their coverage identical:
  `protectedReadAudit.test.ts` (registry contents) and `srVerificationRunContext.test.ts`
  (`DELIVERY_CAPABLE_IMPORTS`).
- **Pre-commit `before` capture.** It moves verbatim with the domain code and is never re-derived
  in the MCP layer (I8, `docs/NOTIFICATIONS.md`).
- **The `revalidate*` call per counterpart is unchanged:** `revalidateSetlistSave`,
  `revalidateRoleMutation`, and `revalidateRolePublication` (never the generic one; spec D5)
  (I12).
- `_key` on every array item (`buildSetlistSongDocs`; swap keys travel). `saturdarSongs` comes only
  through `setlistTypeForKind`. The five seats go through the domain's own helpers. Specials are
  identified by `serviceId`, never by date+name. Worship-night rules come only from
  `serviceFormat.ts`/`songLeads.ts`.
- No `MAY_SEE_DRAFTS` entry is added, and no role literal appears in `app/mcp/**` (I2). Every
  protected read goes through `operationalClient`/`rawIntegrityClient` (I1).
- P0's checks, header stripping, kill switch and host rule are unchanged. Step 1 changes only
  *when* the handler returns, never *whether* a request is authenticated.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `app/api/mcp/route.ts` | returns `mcpHandler`'s Response as-is | buffers a `text/event-stream` response to completion before returning (F2); registers 4 more tools |
| `app/utils/serviceMutationSideEffects.ts` (writer-imported) | 6 helpers return `void` | the same 6 return a descriptor of what they registered or pushed; no statement moves (step 2) |
| `app/utils/setlistSaveCommit.ts` (new, `server-only`) | — | `saveSetlist(body: unknown)`, the PUT's domain, verbatim |
| `app/utils/setlistRecentSongs.ts` (new, neutral) | — | `recentSongUses(recent, serviceDate)` + `weeksAgoIso(n)`, extracted from the GET |
| `app/utils/roleSwapCommit.ts` (new, `server-only`) | — | `swapRoles(body: unknown)`, verbatim |
| `app/utils/publishVerdict.ts` (new, neutral) | — | `publishVerdict(service, entry)`, the one per-service publish predicate (I4) |
| `app/utils/publishReadyCommit.ts` (new, `server-only`) | — | `publishReady(body: unknown)`, verbatim except the verdict call |
| `app/utils/roleUnpublishCommit.ts` (new, `server-only`) | — | `unpublishRoles(body: unknown)`, verbatim |
| the four admin route files | auth + domain | auth + `await domain(body)` → `NextResponse.json(outcome.body, { status })` |
| `app/mcp/reads/publishRefusal.ts` | inline copy of the verdict | a thin adapter over `publishVerdict` |
| `app/utils/protectedReadAudit.ts` + its test | route entries for the 4 writers | module entries for the 4 `*Commit.ts` (count stays sixteen) |
| `app/utils/__tests__/srVerificationRunContext.test.ts` | 5 delivery-capable imports | + the 4 `*Commit` module names |
| `app/utils/__tests__/serviceCommitCallers.test.ts` (new) | — | pins the exact importer set of each `*Commit.ts` |
| `app/mcp/writes/*` (new) | — | write-tool runner, refusal copy, reports, row translation, swap admission, twin-run test harness |
| `app/mcp/tools/{editSetlist,swapAssignment,publishService,unpublishService}.ts` (new) | — | one tool each |
| `app/mcp/tools/getService.ts`, `listServices.ts` | descriptions say "once either exists" | name the write tools |
| `scripts/mcp-dev-smoke.mjs` | 8 read-only tools | 12 tools with per-tool annotations; never calls a write (step 12) |
| `docs/MCP.md`, `docs/NOTIFICATIONS.md`, `docs/API_REFERENCE.md`, `docs/README.md`, `docs/adr/0040-…`, a new ADR, `CLAUDE.md`, `AGENTS.md` | — | step 12 |
| Production dataset | — | the throwaway specials A and B, created and removed in `/admin` by Frank (step 14) |

No trust boundary moves. Every tool dispatches only after P0's six checks.

## Ordered changes

Every step leaves the four gates green (`npx tsc --noEmit`, `npm test`, `npx eslint .` with 0
errors; no `gcf/**` change). Nothing deploys before step 13, because `claude/*` builds are
canceled. Each extraction step is reviewable as a **move**: `git diff --color-moved=dimmed-zebra
--color-moved-ws=allow-indentation-change` must show the domain body moved unchanged. The only
changes allowed inside it are the listed boundary edits.

### 0. Entry gate (no code)

- P1 checklist items 8 and 9 are done: phone acceptance, and a production latency figure for
  `get_service`/`list_services` under 10 s, recorded in `docs/MCP.md`.
  - P1 has no server-side timing, and Vercel's runtime logs carry no duration on this plan
    (§ Signals). So item 9's figure is Frank's observed wall-clock time per answer, with each
    approval prompt answered at once.
  - Exact server durations for the reads arrive with step 7's timing line, and step 15 records
    them.
- This plan is approved, with its review log. Frank gives the go-ahead.
- Run `git worktree prune`. Branch `claude/mcp-p3-writes` from `main`. Any worktree uses the
  `cp -Rc` `node_modules` clone and the `.env.local` symlink rule.
- **Stop condition:** a P1 latency above 10 s blocks P3. The remedy is P1's narrowing follow-up,
  not a P3 change.

### 1. Transport completion: every tool call finishes inside the handler (F2)

- **Purpose:** in both protocol eras, a tool's `revalidatePath` and `after()` registrations must
  happen while Next's route handler is still running. Without that, I12 fails silently in the
  legacy era.
- **Change:** in `handle()`, after `const response = await mcpHandler(forwardedRequest(…))`: if
  the response's media type is `text/event-stream`, `await response.text()` and return
  `new Response(text, { status: response.status, headers: response.headers })`. Otherwise return
  the response unchanged. The existing `try/catch → serverError("unexpected")` covers a stream
  error.
- **Why it is safe:** the route holds no stream by design. `maxSubscriptions: 0`, `listChanged:
  false` and "every exchange must end with the request that was checked" (`route.ts:57-70`)
  already hold, and the existing "never an open SSE stream" tests (`mcpRoute.test.ts:1123-1145`)
  stay green. A stream that never ended would reach the same 60 s ceiling with or without
  buffering. SSE framing is unchanged, so clients parse it as before. Reads only lose incremental
  delivery, and they emit nothing incremental.
- **Verification:**
  - A new `app/api/__tests__/mcpToolCompletion.test.ts` mocks `@/app/mcp/tools/ping`'s
    registration with a tool that awaits a macrotask, then calls a `revalidatePath` spy and
    registers `after(cb)`. It sends a `tools/call` in the **legacy** era and asserts the spy was
    called **before** `await POST(...)` resolves, and the body still parses as one SSE result. It
    repeats the check in the modern era. The test fails on today's route and passes after the
    change.
  - **Local spike** (never committed; the throwaway tool is deleted before the commit, as in P0
    step 1): `next build && NEXT_PRIVATE_DEBUG_CACHE=1 next start`, then a legacy `tools/call` to
    a temporary tool that calls `revalidatePath("/schedule")` and `after(() => console.log("after
    ran"))`. The log must show "pending revalidates promise finished for: /api/mcp" and "after
    ran" with the change, and must lack the first line without it. The observed output is
    recorded in the ADR.
- **State after:** deployable. Reads behave identically apart from buffering, and no write exists.

### 2. Side-effect descriptors (additive change to a writer-imported module)

- **Purpose:** I9 reports "which notifications it queued, and to whom". Those values must be the
  ones the helpers actually used, captured pre-commit, not a second derivation that could drift.
- **Change** in `app/utils/serviceMutationSideEffects.ts`. Each helper keeps every existing
  statement in its current order and only gains a return value:
  - `notifyRoleAssignments(notices)` returns
    `{ pushes: { recipients, date, kind }[] }`, the `real` list it scheduled, or empty.
  - `notifyRolePublished(services)` returns
    `{ pushes: { recipients, date }[], emailBatch: { type, date, body }[] }`, or null when it
    returns early. `emailBatch` is exactly the argument handed to `sendAssignmentEmailsBatch`
    (`serviceMutationSideEffects.ts:293-296`). It carries no recipient list, because the batch
    derives its recipients itself, at send time (`assignmentEmail.ts:148-156`). The report
    (step 7) shows who that derivation names and labels it as such.
  - `queueRoleNotices(input)` returns
    `{ kind: "role", roleId, memberIds } | null`. It is set only **after** `after(...)` was
    registered inside the `attemptSync`, so a swallowed throw reports null.
  - `queueSetlistNotice(input)` returns
    `{ kind: "setlist", roleId, knownRecipients } | null`, which is null exactly when
    `setlistUpsert` returns null.
  - `queuePublishedSetlistNotices(subjects)` returns
    `{ kind: "publishedSetlist", subjects: { roleId, knownRecipients }[] } | null`. Song presence
    is resolved later, inside `after()`, so the report says "if the service has songs".
  - `notifySetlistSaved(week)` returns `Promise<{ recipients: string[] } | null>`. Inside its
    existing `attempt`, a closure variable captures the exact ids already computed for
    `sendPush(setlistRecipientIds(audience, assignedIds), …)`. They are captured just before the
    `fireAndForget` call, which does not move. The function returns null when the reads failed and
    `attempt` swallowed the error.

  All six helpers are thus enumerated. No leg of any tool's report is described "by rule" instead
  of listed.
- **Why behaviour is preserved:** every existing caller discards the return value. No statement
  is added before or between the existing ones. The descriptors are built from locals the helper
  already computed.
- **Verification:** new unit tests in `app/utils/__tests__/sideEffectDescriptors.test.ts`. For each
  of the six helpers, over mocked `after` and `sendPush`: the descriptor equals what was scheduled
  or pushed. Examples: `queueRoleNotices(...).memberIds` equals the upsert `memberId`s,
  `notifyRolePublished(...).emailBatch` equals `sendAssignmentEmailsBatch`'s argument, and
  `notifySetlistSaved(...).recipients` equals `sendPush`'s first argument. The descriptor is null
  in every silent case (a draft, a missing date, no songs, empty recipients, a failed read). The
  existing notification suites are unchanged and green.
- **State after:** deployable; behaviour is identical.

### 3. Extract the setlist writer

- **Change:**
  - Create `app/utils/setlistSaveCommit.ts` (`import "server-only"`), exporting
    `saveSetlist(body: unknown): Promise<CommitOutcome<SetlistSaveEffects>>`. Its body is
    `setlists/route.ts:278-462` verbatim, with three edits at the boundary:
    - each `return reject(x)` becomes `return { ok: false, ...x }`;
    - the final `NextResponse.json({...})` becomes
      `return { ok: true, status: 200, body: {...}, effects }`;
    - `effects` collects the values the code already holds: the target (`kind`, `week`,
      `roleId`, `setlistId`, `created`), the written `songs` with their new `_key`s, the
      `subject`, and the step-2 descriptors from `notifySetlistSaved` (null when it was skipped
      for a draft or a role-less week) and `queueSetlistNotice`.
  - Define the shared outcome type in `app/utils/commitOutcome.ts`:
    `type CommitOutcome<E> = { ok: true; status: 200; body: Record<string, unknown>; effects: E } | { ok: false; status: number; body: Record<string, unknown> }`.
    The `body` is exactly what the route sends today.
  - **Early returns outside `reject(x)` are boundary edits too.** The `mode: "recover"` branches of
    publish-ready (`route.ts:133-165`) and unpublish (`route.ts:86-108`) return
    `NextResponse.json` directly: a `503` `unknown_outcome`, and a recovered `200` with
    `outcome: "recovered"`. In the moved code the `503` becomes
    `{ ok: false, status: 503, body }`. The recovered `200` becomes
    `{ ok: true, status: 200, body, effects }` with the module's explicit empty-effects value
    (`recovered: true`, no descriptors, nothing patched). The admin routes' responses stay
    byte-identical. The tools never send `mode: "recover"`, because their schemas have no
    `mode`, and a test asserts that no tool-built body carries it.
  - The route's `putHandler` keeps lines `263-276` (auth and JSON parse), then does
    `const outcome = await saveSetlist(raw); return NextResponse.json(outcome.body, { status: outcome.status });`.
    `export const maxDuration`, `withVerificationRunContext` and the GET stay where they are.
  - Extract `nWeeksAgo` and the `recentSongs` loop (`:49-53,208-225`) into the neutral
    `app/utils/setlistRecentSongs.ts` (`weeksAgoIso(n)`, `recentSongUses(recentRaw, serviceDate)`).
    The GET calls it. The code is verbatim.
  - **Registry, same commit:**
    - remove `app/api/admin/setlists/route.ts#PUT` from `PROTECTED_RUNTIME_WRITERS`;
    - add `app/utils/setlistSaveCommit.ts#module` with the same reason text, re-pointed;
    - update the exact sorted list at `protectedReadAudit.test.ts:387-407`.

    The module stays detectable: it calls `writeClient.transaction()` in a region that names
    `"sunday_role"`, `"saturday_role"` and `"special_role"` (F4).
  - **Delivery coverage, same commit:** add `"setlistSaveCommit"` to `DELIVERY_CAPABLE_IMPORTS`
    (F5).
  - **Caller pin (new):** `app/utils/__tests__/serviceCommitCallers.test.ts` reads
    `git ls-files app` non-test sources and asserts the exact importer set per `*Commit.ts`. Here
    that is `{ setlistSaveCommit: ["app/api/admin/setlists/route.ts"] }`. This keeps I1's intent: a
    new surface that reaches a registered writer must still touch a pinned, reviewed list.
  - **ADR (next free number at merge):** "Admin write routes delegate to `*Commit` domain
    modules; the MCP calls the same modules". It covers:
    - the reasons: F3, I6, and one code path for both surfaces;
    - the registry move (F4) and the caller pin;
    - the transport gate (F2), with the spike's output, and the early SSE bytes it removes for
      legacy-era clients;
    - I15's counterpart as the admin surface (D13), with a pointer to the gate table in
      `docs/MCP.md`;
    - the SR-verification gap on `/api/mcp` (D15);
    - the rejected options: the MCP calling the HTTP route internally (it cannot authenticate),
      a second writer in `app/mcp/` (drift, and it breaks `mcpSanityClients`), and injecting
      `writeClient` as a parameter (invisible to the audit, P1's D3 trap).
- **Verification:**
  - `setlistWriteRoute.test.ts`, `setlistsRoute.test.ts` and `setlistNoticeQueueing.test.ts` are
    **unchanged and green**. Their `vi.mock`s act on module identity, which the new module
    imports too.
  - The audit and caller-pin tests pass. The move-diff review shows no other change.
- **State after:** deployable; `/admin` behaves identically.

### 4. Extract the swap writer

- **Change:**
  - Create `app/utils/roleSwapCommit.ts`, exporting `swapRoles(body: unknown)`: `swap/route.ts:83-340`
    plus its private helpers `:343-372`, verbatim, with the same boundary edits.
  - `effects` holds, per coordinated role: `roleId`, `_type`, `date`, `published`,
    `service_name`, `format` and `songs` (from the loaded `StoredRole`), its five stored seat
    arrays as loaded, the raw `set` payload the transaction wrote for it (`patchOf.get(roleId)`,
    `swap/route.ts:162,217-231`, `_key`s included), the pre-commit `seatStates.before/after`, and
    the step-2 descriptors from `notifyRoleAssignments` and each `queueRoleNotices`. The raw
    payload is what step 10's `freshRevs` compares the read-back against; the normalized
    `seatStates` drop `_key`s and could not.
  - Registry: replace `swap/route.ts#POST` with `app/utils/roleSwapCommit.ts#module`. Add
    `"roleSwapCommit"` to `DELIVERY_CAPABLE_IMPORTS`. The caller pin gets
    `roleSwapCommit: ["app/api/admin/roles/swap/route.ts"]`.
- **Verification:** `roleSwapRoutes.test.ts` is unchanged and green (it also covers
  copy-instruments, which is not moved). The audit and caller pin pass. The move-diff review is
  clean.
- **State after:** deployable; `/admin` behaves identically.

### 5. Extract the publish writer and consolidate I4 (ADR-0040's D2 exit)

- **Change:**
  - Create the neutral `app/utils/publishVerdict.ts`, exporting
    `publishVerdict(service: AssembledService, entry: { rev: string; mode: "ready" } | { rev: string; mode: "override"; acknowledgedBlockers: readonly string[] })`,
    which returns `{ reasons, hard, workflow, integrity }`. Its body is `publish-ready/route.ts:181-200`
    verbatim. `integrity` is true exactly where the route sets it (`hard` or
    `unusable_observation`). It type-imports `AssembledService` and imports
    `classifyPublishBlockers` and `sameBlockerSet` (both neutral).
  - Create `app/utils/publishReadyCommit.ts`, exporting `publishReady(body: unknown)`:
    `route.ts:121-318` verbatim, **plus the private helpers the body uses**, as step 4 moves
    swap's: the `SanityTransaction` alias (`:74`), `GuardedTx` and `guarded` (`:76-92`) and
    `ServiceRejection` (`:94-102`). Without them the moved body does not compile. The only in-body
    change is the loop at `:173-212`: its lines `181-200` become one
    `publishVerdict(service, entry-with-mode)` call, and the rejection record keeps its exact
    fields. `effects` holds the observations it notified and the step-2 descriptors.
  - `app/mcp/reads/publishRefusal.ts`'s `publishRefusalFor(assembled)`:
    - keeps the `null` → `not_found` case;
    - otherwise calls `publishVerdict(assembled, { mode: "ready", rev: assembled.observation?.roleRev ?? "" })`.
      Passing the snapshot's own `roleRev` makes `stale_revision` unreachable, because it
      requires an observation whose rev differs. `mode: "ready"` makes `blocker_set_changed`
      unreachable;
    - keeps an exhaustive type-narrowing filter that asserts neither code appears.
  - Registry: replace `publish-ready/route.ts#POST` with `app/utils/publishReadyCommit.ts#module`.
    Add `"publishReadyCommit"` to `DELIVERY_CAPABLE_IMPORTS`. The caller pin gets
    `publishReadyCommit: ["app/api/admin/roles/publish-ready/route.ts"]` and
    `publishVerdict: ["app/utils/publishReadyCommit.ts", "app/mcp/reads/publishRefusal.ts"]`.
  - **Parity tests change from "the mirror is equal" to "there is one predicate":**
    - `publishRefusalParity.test.ts` keeps every assertion, and only its header comment is
      rewritten. It now proves the **wiring**: the real route, run over the fixtures, still
      refuses exactly what the read reports. The header of `app/mcp/reads/publishRefusal.ts`
      (lines 1-52, "WHY A COPY", "HOW IT ENDS") is rewritten in the same commit to say the verdict
      is now shared. Both changes are comments only;
    - a new `app/utils/__tests__/publishVerdictSingleSource.test.ts` checks that
      `publishReadyCommit.ts` and `publishRefusal.ts` both call `publishVerdict(`, that neither
      contains `classifyPublishBlockers(`, and that neither contains a quoted `.push(` of any of
      the six verdict reason literals;
    - `serviceSnapshotMirror.test.ts` and `serviceSnapshotParity.test.ts` (D1) are unchanged.
  - **ADR-0040 amendment**, a dated section: "Amended 2026-MM-DD by MCP P3: D2 consolidated into
    `publishVerdict` (`app/utils/publishVerdict.ts`), called by both the publish writer and
    `publishRefusalFor`. The route-parity test remains as a wiring test and a single-source guard
    replaces the 'mirror' premise; D1 unchanged (P4 consumes it). **Residual:** the verdict is
    not the whole refusal set. After it, the route builds the guard bundle —
    `buildPublishAssertion` → `planPublishReadyAssertions`, then `mergeAssertionOps` and
    `withPublishedTrue` — and refuses `integrity_conflict` with `assertionIssues`,
    `mergeIssues` or `planIssues` (`publish-ready/route.ts:232-263`;
    `publishReadyBundle.ts:542-561`; `publishReadyTransaction.ts:108`). A read sees only the
    `unsafe` part of that stage, as `unusable_observation` (`publishReadyBundle.ts:496-502`). So
    a read can say `passesNow: true` for a service the publish then refuses at the assertion
    stage; the tool reports that refusal in words, and nothing is written". Status becomes
    "Accepted; D2 superseded".
- **Verification:**
  - `publishReadyRoutes.test.ts` is unchanged and green, and so are all P1 parity tests;
  - the new guard fails on a planted inline `reasons.push("not_ready")`;
  - the move-diff review shows only the verdict call.
- **State after:** deployable. `/admin` behaves identically, and the reads now call the writer's
  own predicate. **I4 holds by construction for the predicate**, and not for the assertion stage
  that follows it (the residual in the amendment above). Its `AssembledService` input is
  still assembled two ways: the route uses `loadServiceReadinessSources`, and the reads use P1's
  D1 snapshot mirror. That input stays mirror-pinned by P1's `serviceSnapshotMirror`/`serviceSnapshotParity` tests (ADR-0040).

### 6. Extract the unpublish writer

- **Change:**
  - Create `app/utils/roleUnpublishCommit.ts`, exporting `unpublishRoles(body: unknown)`:
    `unpublish/route.ts:76-202` verbatim, with the same boundary edits.
  - `effects` holds `{ toPatch, alreadyDraft: roles.filter(not in toPatch) }`.
  - Correct the stale comment at `:31-32` to: "An unpublish notifies nobody and runs no sweep.
    60 s is kept for parity with its sibling." `maxDuration` itself is unchanged (F1).
  - Registry: replace `unpublish/route.ts#POST` with `app/utils/roleUnpublishCommit.ts#module`.
    The caller pin gets `roleUnpublishCommit: ["app/api/admin/roles/unpublish/route.ts"]`.
  - Delivery coverage: add `"roleUnpublishCommit"` to `DELIVERY_CAPABLE_IMPORTS`. Today the route
    is in that scan only because it imports `serviceMutationSideEffects` (for
    `revalidateRolePublication`, `unpublish/route.ts:37`). After the move it no longer does, so
    the name is added to keep its coverage identical (F5).
- **Verification:** `publishReadyRoutes.test.ts` (which also covers unpublish) is unchanged and
  green. The audit, caller pin and delivery-coverage tests pass.
- **State after:** deployable. Four domain writers exist, each with exactly one caller.

### 7. MCP write foundation (`app/mcp/writes/`)

- **SR-verification gap, stated rather than excepted (D15).** The coverage scan cannot see
  `/api/mcp` (evidence row «Every counterpart is wrapped…»), so no exception entry is added: it
  would never be exercised. Instead:
  - a new case in `app/api/__tests__/mcpRoute.test.ts` asserts that the route's own source
    contains none of `DELIVERY_CAPABLE_IMPORTS` (as step 6 leaves that list) and no
    `withVerificationRunContext(`. That is the shape the gap statement below describes. A
    delivery-capable import added directly to the route fails this test as well as the scan, so
    that change has to take a wrapper decision explicitly;
  - `docs/MCP.md` («Known behaviour») and the step-3 ADR say it plainly: `/api/mcp` reaches
    delivery **transitively** (route → `app/mcp/tools/*` → `*Commit` → the side-effect helpers).
    It is deliberately unwrapped, because an MCP call is bearer-authenticated for one super-admin
    and is never an SR-verification run. The per-file scan cannot see that reach. An MCP write's
    delivery evidence therefore carries no run markers, which is an evidence gap and not a safety
    hole (`srVerificationRunContext.ts:163-165`).
- **Timing line.** Vercel's runtime logs on this plan carry no request duration (observed
  2026-09-25; § Signals).
  - `runWriteTool` and P1's `runReadTool` (`app/mcp/reads/errors.ts`, MCP-owned and imported by
    no writer) each log one line per call, in `finally`:
    `[mcp] tool=<name> outcome=<ok|refused|error> code=<code|-> ms=<n>`.
  - No argument, id, name or payload is logged, and a test asserts the line's exact shape.
  - This line is how P3's live-proof durations and the P1 latency figure are read, using
    `vercel logs <deployment> --json`, whose `logs[].message` carries it.
- **`runWriteTool(name, handler)`**, like P1's `runReadTool`, catches every throw. Apart from the
  timing line, it logs a fixed tag and the tool name, and nothing else. It returns
  `{ isError: true }` with **«No se pudo confirmar si el cambio se guardó. Antes de reintentar,
  vuelve a leer el servicio con get_service.»** A thrown write is an *unknown* outcome, never "no
  se guardó" (I9; the spec's error contract E1).
- **Post-commit report reads are caught locally.** Once the domain has returned `ok: true`, the
  write is committed. The reads a tool then makes only for its report are each wrapped in their
  own `try/catch`: member names, the unavailability lookup, the read-back behind a fresh
  observation or `freshRevs`, and the repeat hint. A failure degrades that one field (a name
  marked unresolved, `observation: null` with «vuelve a leer con get_service», the hint left out)
  and never reaches `runWriteTool`'s catch. A committed write is therefore never reported as «No
  se pudo confirmar…». A test per tool throws in each of those reads and asserts an `ok: true`
  result with the degraded field.
- **`refusalFor(outcome)`** maps each `ServiceErrorCode`, plus `details.detail` and `issues`, to
  Spanish. The result is `{ isError: true, content: text, structuredContent: { refused: true, code, detail?, services? } }`.
  Every text ends with «No se escribió nada.». There are two exceptions:
  - `bootstrap_completed_reload`: «Se reparó un dato interno de coordinación del servicio, pero tu
    cambio NO se aplicó. Vuelve a leer con get_service y reintenta.»
  - `bootstrap_outcome_unknown`: «No se pudo confirmar una reparación interna. No reintentes;
    revísalo en /admin.»

  Blocker copy reuses `PUBLISH_SKIP_COPY` and `publishRefusal.ts`'s route-only copy.
  - **A publish refusal is keyed on its per-service reasons (F10).** `refusalFor` reads
    `details.services[].reasons` first, then `details.guard`, and only then the top-level code.
    `hard_integrity_blocker`, `unusable_observation` and `not_ready` produce the blocker copy with
    no retry advice. `already_published` produces «ya está publicado». `stale_revision` alone, or
    a `details.guard` of `publish_ready_assertions`, produces «cambió desde que lo leíste; vuelve a
    leer con get_service». The assertion-stage keys `assertionIssues`, `mergeIssues` and
    `planIssues` produce the integrity copy. A test feeds the route's real `409` bodies for each
    of these.
  - The admission refusals the tool makes itself (§ «Admin surface gates», `mirror` rows) use the
    same `{ refused: true, code, detail }` shape. `code` comes from the writer's vocabulary
    (`ambiguous_target`, `integrity_conflict`, `invalid_request`, `stale_revision`), and `detail`
    names the gate (`invalid_content`, `duplicate_song`, `cross_month`,
    `duplicate_special_identity`, `lock:missing_lock`, …).
- **`reports.ts`** turns the step-2 descriptors and the `effects` into the I9 payload:
  `notifications: [{ channel: "push" | "email" | "outbox_email", title, audience: [{ memberId, name }], when, conditions }]`.
  `when` is one of `"tras la respuesta"`, `"inmediato (ADR-0037)"`, or
  `"tras la ventana de agrupación (NOTIFY_DEBOUNCE_MINUTES)"`. `conditions` names the member
  preference, the allowlist and the device-token filters. The wording is always «encolada», never
  «enviada/entregada». Names come from P1's `loadMemberNames`, a canonical read. An unresolved
  name is reported as unresolved and never dropped.
  - The publish email's audience is not a second computation. It is the batch's own derivation,
    run over the `emailBatch` descriptor: `assigneesOf(body)`, kept where `rolesForMember(id,
    body)` is non-empty (`assignmentEmail.ts:148-151`, both exported). The report labels it
    «candidatos según el envío por lotes». The conditions the batch applies at send time (an email
    address, `EMAIL_ALLOWLIST`, `wantsNotification(…, "assigned")`, `:159-167`) go in
    `conditions`. A unit test pins it: for the same argument, the labelled list equals the `ids`
    the batch then queries members with (`:157-162`, captured from a mocked `serverClient.fetch`).
- **Twin-run harness** (`app/mcp/writes/__tests__/twinRun.ts`), following P1's
  `publishRefusalParity` pattern:
  - one fixture store and strict responder answer both runs;
  - it records transactions and captures `after()` callbacks, then runs them;
  - it mocks `sendPush`, `sendAssignmentEmailsBatch`, `sweepOutbox`, `revalidatePath` and
    `revalidateServiceViews`;
  - `nextKey` is made deterministic by a partial mock of `@/app/utils/roleWriteOps`, and time is
    frozen.

  `runRoute(body)` calls the real admin handler with a mocked `requireActiveManager`. `runTool(input)`
  calls the registered tool handler. Each run returns `{ response, transactions, pushes, emails, outboxUpserts, revalidations }`.
  The tool run also makes reads the route run does not: the pre-reads, the admission reads (P1's
  snapshot, `loadTargetOccupancy`, `loadSongTitles`, `loadCanonicalMemberIds`) and the report
  reads. The store answers all of them from the same fixture. Parity is asserted on writes,
  notifications and revalidation, never on the read count.
- **Verification:** unit tests for the runner (a throw whose message looks like Sanity's comes out
  as the fixed text), for every refusal code's copy, and for the report shapes.
- **State after:** unused modules; no tool is registered.

### 8. `unpublish_service`

- **Input** (strict): `{ serviceId: string, rev: string }`, both taken from `get_service` or
  `list_services`.
- **Call:** `unpublishRoles({ roles: [{ id: serviceId, rev }] })`. Never `mode: "recover"`.
- **Output:** `{ ok: true, serviceId, changed: true | false, published: "draft", notifications: [] }`.
  - `changed: true`: «Servicio oculto. Nadie recibe aviso; /schedule y /me se actualizan.»
  - `changed: false` happens only when the `rev` passed is the current one and the service is
    already a draft (`toPatch` is empty, `unpublish/route.ts:167-172`); that is `/admin`'s
    `200 unpublished: 0`. The text is **not** success wording: «Ya estaba oculto: el servicio ya
    era un borrador. No se cambió nada.» It mentions no refresh (§ «Admin surface gates», U1).
  - A retry of a call that already hid the service is **not** `changed: false`. The first call
    moved the rev, so the retry is refused `stale_revision` by `loadRoleForWrite`
    (`roleWriteOps.ts:251-258`), with «cambió desde que lo leíste; vuelve a leer con
    get_service».
- **Annotations:** `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }`.
- **Tests:**
  - twin-run: published → draft, and the already-draft no-op (its text asserted to be the
    «Ya estaba oculto» copy);
  - refusal replay: `not_found`, `ambiguous_target` (occupancy), `integrity_conflict` (raw
    draft, `unexpected_type`, lock), `stale_revision`, `bootstrap_completed_reload`, and a retry
    with the rev the first call consumed (`stale_revision`, zero transactions);
  - schema: an unknown field or a missing `rev` is refused.
- The caller pin adds `app/mcp/tools/unpublishService.ts` to `roleUnpublishCommit`.

### 9. `publish_service`

- **Input** (strict): `{ serviceId, rev }`. There is **no** `mode` and no `acknowledgedBlockers`.
  An unknown field is refused, so no override is expressible.
- **Call:** `publishReady({ mode: "ready", roles: [{ id: serviceId, rev }] })`.
- **Refusal:** the text lists every reason from the domain's 409 in words (`hard` and `workflow`
  blocker copy), read from `details.services[].reasons` and the blocker lists beside them, never
  from the top-level code (F10; step 7). It adds: «Publicar con bloqueos de flujo sólo se puede
  hacer en /admin; los de integridad no se pueden forzar». A not-ready service therefore reads as
  its blockers, not as «vuelve a leer y reintenta».
- **Retry:** a retry of a call that already published is refused. The first call moved the rev,
  so the reasons are `already_published` and `stale_revision`, and the top-level code is
  `stale_revision` (`publish-ready/route.ts:192-195,217-229`). The copy leads with «ya está
  publicado».
- **Success report:**
  - push «Nuevo servicio asignado» to every current assignee (the `pushes` descriptor), and the
    consolidated assignment email to the candidates the batch's own derivation names, labelled as
    that derivation (step 7);
  - «Setlist listo», an outbox email with `debounceMs: 0` sent by the same `after()` block, queued
    to the participants **if the service has songs**;
  - a note that the layer-2 sweep can also deliver other already-due notices (same as `/admin`);
  - a note that `/`, `/schedule` and `/me` are refreshed.
- **Tests:**
  - twin-run: publish a ready special and a ready weekend service; identical transactions,
    pushes, email batch and outbox upserts; `revalidateRolePublication`'s three paths.
  - Refusal replay: `not_found` (404), `hard_integrity_blocker`, `unusable_observation`,
    `already_published`, `stale_revision`, `not_ready` (top-level `stale_revision`, copy asserted
    to be the blockers), assertion `integrity_conflict`, a commit conflict (`details.guard`), and
    a retry with the rev the first call consumed.
  - **The I4 agreement test** (the roadmap's "P1 + P3"). It runs over P1's whole fixture matrix:
    `app/mcp/reads/__tests__/serviceFixtures.ts`, plus the read-tool store in
    `readToolFixtures.ts`, which includes `role-sun-1129`, the #97 case:
    - `get_service`'s `publishCheck.refusals` equals `publish_service`'s refusal codes;
    - `passesNow` is true exactly when the tool publishes;
    - both calls use `rev = roleRev` from the same fixture.

    That matrix holds no assertion-stage-only failure. One added fixture pins the residual
    instead of hiding it: a service whose verdict passes and whose `planPublishReadyAssertions`
    refuses, for example an assigned member stored with an empty `_rev`
    (`publishReadyTransaction.ts:177-181`). The read says `passesNow: true`, and the tool refuses
    `integrity_conflict` with `assertionIssues` and zero transactions (step 5, ADR-0040
    amendment).
  - A test that the schema rejects `mode`, `acknowledgedBlockers` and `roles`.
- The caller pin adds `app/mcp/tools/publishService.ts` to `publishReadyCommit`.

### 10. `swap_assignment`

- **Input:** a strict discriminated union.
  - `{ kind: "section", path: "Lead" | "BGVs" | "Chorus" | "instruments" | "foh_team", services: [{ serviceId, rev }, { serviceId, rev }] }`
  - `{ kind: "team", services: [ … ×2 ] }`

  There is **no** `seat` shape.
- **Admission (tool pre-read; § «Admin surface gates», rows S1–S4).** The stored planner swaps
  only two services it has admitted. The tool admits the same way before it calls the domain,
  from what the server already assembles, and never imports
  `app/components/admin/storedRoleReadModel.ts`:
  1. `loadServiceSnapshot()` (P1's whole-catalogue load, the one `get_service` reads), then
     `assembleService(snapshot.readiness, serviceId)` for each of the two services.
     `null` is refused `not_found`.
  2. The sources the planner's swap control needs (`roles`, `members`, `roleTargets`,
     `CONTROL_REQUIRED_SOURCES.swap`, `serviceReadiness.ts:828`) must be `ready`. Otherwise:
     «No se pudo comprobar el estado de los servicios; vuelve a intentar.» (S4)
  3. For each role, readiness must show `recordStatus === "valid"`,
     `roleTargetStatus === "single"` (S2a, S2c), `danglingRefCount === 0` (S2d), and no
     integrity issue of kind `lock` (S2g: a missing lock arrives here as `missing_lock`,
     `roleTargetLock.ts:221` → `publishReadyBundle.ts:478` → `serviceReadiness.ts:455-464`).
  4. For each role, `loadTargetOccupancy({ roleType, date, serviceName, excludeRoleId })` — the
     unpublish writer's own occupancy check (`roleWriteOps.ts:371-409`;
     `unpublish/route.ts:127-150`) — must return no other canonical role (S2a, and S2b for a
     special, matched by `normalizeServiceName`) and no raw draft (S2c). A special whose
     normalized name is empty is refused (S2f).
  5. Both services' stored dates must share `YYYY-MM` (S1; Q8). The comparison is on the stored
     `YYYY-MM-DD` day strings, never on a `Date`.

  Only the role-scoped facts are checked. `publishVerdict`'s full `hard` list would also refuse
  on setlist, proposal and availability problems, which the planner's swap admission does not
  consider (`storedRoleReadModel.ts:298-346`), so it would refuse swaps `/admin` allows.
  Every admission refusal ends with «No se escribió nada.»: nothing has been written. Each names
  the service and the gate, and points to `/admin` → Servicios. For S2g the copy is: «es un
  servicio antiguo sin su dato de coordinación; guárdalo una vez desde el planner de /admin y
  vuelve a leer». The admission lives in `app/mcp/writes/swapAdmission.ts`, a pure function over
  the assembled services and the two occupancy results, plus a thin loader. It imports no
  client, because the snapshot and `loadTargetOccupancy` do the reading.
- **Call:** `swapRoles({ kind, path?, roles: [{ id, rev }, { id, rev }] })`. The domain asserts
  both observed revisions and every owned lock in one transaction. `_key`s travel with their
  items.
- **Output:**
  - Per role: `{ serviceId, date, name?, published, moved: { [path]: { before: names[], after: names[] } } }`,
    built from `effects.seatStates` (pre-commit, the same values the notices used).
  - `notifications`:
    - push «Servicio actualizado» per destination role, to the members added, published roles
      only (from the `notifyRoleAssignments` descriptor);
    - an outbox email per role to the union of before and after assignees, published roles only,
      sent after the debounce window (from the `queueRoleNotices` descriptors).
  - **Reported, never refused**, as the spec requires:
    - `songLeadsOrphaned`: for each worship night among the two roles
      (`isWorshipNight(effects.role)`), run the writer's own `validateSongLeads` over
      `songItemLeadIds(song)` of each stored song against `new Set(seatStates.after.leads)`. Each
      issue index becomes `{ songTitle, leaders }`, with the note «el próximo guardado del setlist
      se rechaza hasta corregir los líderes».
    - `unavailablePlaced`: for each role, the members in `after − before` whose
      `unavailableDates` include that role's date. Read through `canonicalMembersByIdsQuery` on
      `operationalClient`.
  - `freshRevs`: a read-back through `loadCanonicalRolesByIds`. A rev is returned **only when the
    read-back equals the state that was written**: for each role, all five seat arrays equal the
    arrays it was loaded with, overlaid with the raw `set` payload the transaction wrote
    (`effects`, step 4), item for item and `_key` for `_key`. That is the same rule D8 applies to
    `edit_setlist`. Otherwise the tool returns the read-back with
    `changedAgainAfterSave: true` and no rev. A rev captured inside the write request is never an
    I7 observation on its own. If the read fails, the text says «vuelve a leer antes de otra
    escritura» (a local catch, step 7).
  - The unavailability lookup and the member names are report reads too, each caught locally
    (step 7).
- **Tests:**
  - twin-run: section swaps on each path and a team swap, published and draft; identical
    transactions (both role patches plus lock heartbeats), pushes and outbox upserts;
    `revalidateRoleMutation`;
  - refusal replay, **inherited** rows (route code): `incompatible_team_topology`,
    `incompatible_section_topology`, `hidden_saturday_chorus`, `identical_selection`,
    `not_found` (met at admission, with the route's code), `stale_revision` (either role), and a
    commit conflict. Three more are reachable only as races, when the state changes between the
    admission read and the domain read: a moved person who dangles (`danglingRefs`), a lock that
    turns wrong-owner (`integrity_conflict`), and a lock that disappears
    (`bootstrap_completed_reload`, whose test asserts the maintenance copy);
  - refusal replay, **mirror** rows (admission, zero domain calls, zero transactions; the route
    alone run on the same fixture to record whether it refuses or commits): two services in
    different months (S1); a weekend target with two canonical roles (S2a); two specials sharing
    a date and a normalized name (S2b); a raw draft of another id at the target, and a special's
    same-name draft (S2c); a dangling assignment in a section that is not moved (S2d); a special
    with a blank name (S2f); a legacy weekend role with no lock, where the route alone commits
    the bootstrap and this tool writes nothing (S2g), and a wrong-owner lock (S2g's
    `invalid_lock`, which the route also refuses); an unready `members` source (S4);
  - reports: a worship-night Lead swap names the orphaned songs; a cross-date swap names a member
    unavailable on the new date; a same-member no-op names nobody; `freshRevs` is withheld when
    the read-back differs from the patch only by one item's `_key`;
  - schema: `kind: "seat"`, `source`/`target` or an extra field is refused.
- The caller pin adds `app/mcp/tools/swapAssignment.ts` to `roleSwapCommit`.

### 11. `edit_setlist`

- **Input** (strict):
  ```
  { serviceId,
    roleRev,                                                        // get_service's observations.roleRev
    observed:   { state: "none" }
              | { state: "single", id, rev, rowKeys: (string|null)[] }
              | { state: "ambiguous", ids } | { state: "draft_overlay", draftIds }
              | { state: "invalid" } | { state: "unknown" },       // P1's six shapes, each .strict()
    rows: (  { rowKey, key?: string|null, medleyTag?: string|null, leads?: string[] }
           | { songId, key?: string, medleyTag?: string, leads?: string[] } )[]  // 0–60
  }
  ```
  `key` is at most 24 characters (F11; § «Admin surface gates», row E-key). The writer would store
  a longer one as blank without saying so. The limit counts the raw string, which is never looser
  than the writer's normalized count (`setlistWriteRequest.ts:144-149`).

  The schema accepts every observation `get_service` can return, verbatim. An echoed
  `draft_overlay` is therefore a well-formed call, and it gets a Spanish refusal instead of the
  SDK's English validation error. **Only `none` and `single` are writable** (P1's ruling,
  `docs/MCP.md:197`). The handler refuses the other four, before any read, in Spanish:
  - `draft_overlay`: «hay un borrador de Studio sobre este setlist; descártalo o publícalo en
    Studio y vuelve a leer»;
  - `ambiguous`: «hay más de un setlist para este servicio; corrígelo en /admin o Studio»;
  - `invalid`: «el registro del setlist es inválido»;
  - `unknown`: «la lectura falló; vuelve a leer».

  Every refusal ends with «No se escribió nada.». A `single` whose `rowKeys` contains `null`, or
  repeats a key, names a stored row with no unique `_key`. That is the editor's `invalid_content`
  (§ «Admin surface gates», E1), so it is refused before any read, with resolution step 6's copy.
- **`roleRev` is required.** `get_service` returns it (`observations.roleRev`), and the tool
  refuses unless the role is still at that revision (resolution step 1). This check is the
  tool's own and stricter than `/admin`. The domain asserts the role's rev only for a special,
  whose role is the setlist target (`setlists/route.ts:345-348`); a weekend save asserts the
  setlist document and the lock. The check covers two cases the setlist observation cannot:
  - a special in `none` state, whose observation carries no rev at all;
  - a weekend role whose date moved. The tool derives the week from the role, so without the
    check it would write to the new date's setlist, silently when both dates read `none`.

  A role edit that lands between this check and the domain's own read (one round trip) is still
  not seen on a special in `none` state. `/admin`'s editor has that gap for as long as it is open,
  so the tool narrows it and does not widen it (I7).
- **Resolution (tool pre-read):**
  1. `loadCanonicalRole(serviceId)` must be `single`, with a `_type` for which `serviceKindOf` is
     non-null. Otherwise the tool refuses (`not_found`/`ambiguous_target`). Its `_rev` must equal
     `roleRev`, or the tool refuses `stale_revision`: «El servicio cambió desde que lo leíste;
     vuelve a leer con get_service.»
  2. From the role, derive `kind`, `week` (`storedRoleDate`) and `worshipNight`
     (`isWorshipNight(role)`).
  3. Load the stored rows through the **writer's own** loader: `loadWeekendSetlistTarget(setlistTypeForKind(kind), week)`,
     or `loadSpecialSetlistTarget(serviceId, week)`.
  4. Refuse with a Spanish stale message if its `server` state or rev differs from `observed`. The
     domain would refuse too; failing early means no half-built body is ever sent.
  5. Refuse unless `observed.rowKeys` equals the stored `_key`s, in order.
  6. **The editor's content gate (gate row E1).** One `loadSongTitles` call resolves every song id the
     edit involves: each stored row's `song._ref` and each new `songId`. A failed lookup
     (`ok: false`) refuses: «No se pudieron comprobar las canciones; vuelve a intentar.» Then
     `setlistContentState(storedRows, (id) => lookup.byId.has(id))` runs over the rows the
     writer's loader returned (`SONGS_FRAGMENT`, `serviceReadQueries.ts:15`). That is the
     predicate the editor's read contract applies (`serviceReadModel.ts:158-176`, reached through
     `contentStateFromProjectedSongs`, `setlistReadContract.ts:93-108`). The default resolver
     (`() => true`, `serviceReadModel.ts:160`) is never used. `invalid` refuses the **whole
     edit** with the editor's own copy, imported rather than retyped:
     `SETLIST_READ_ISSUE_COPY.invalid_content` («El setlist guardado tiene canciones inválidas.
     Revísalo en Studio antes de editar.») followed by «No se escribió nada.». The gate runs after
     steps 4–5, so a stale observation is reported as stale first; the route orders its own checks
     the same way (`setlists/route.ts:374-376`).
     The repair is in Studio, as `/admin`'s copy says: `/admin` will not open such a setlist
     (`setlistReadContract.ts:232-233`), so neither surface can repair it. This gate does not
     settle the evidence file's carried item about rows without a `_key`. It makes the connector
     refuse exactly what `/admin` refuses, and the repair stays in Studio, outside both.
  7. Every new `songId` must be in `lookup.byId`, a published `post` (E4): «X no es una canción
     del catálogo.»
- **Translation** (pure `app/mcp/writes/setlistRows.ts`):
  - A kept row (`rowKey`) starts from its stored `play_key`, `medley_tag` and `leads`
    (`songItemLeadIds`). An absent attribute is **kept**. An explicit `null` clears it (`key`,
    `medleyTag`). `leads: []` clears the leaders. This is the editor's round trip
    (`SetlistEditor.tsx:192-207,391-401`; E6).
  - A kept row whose stored `play_key` normalizes to more than 24 characters (only Studio can
    write one) is refused unless the row sends `key`. Carried as it is, the writer would blank it
    silently (E-key).
  - A new row (`songId`) starts empty.
  - A stored row not listed is removed. A `rowKey` listed twice, or one not in the observation, is
    refused and never guessed.
  - **Duplicate songs (E3, D14).** A new row whose `songId` equals the song of any other resulting
    row, kept or new, is refused: «X ya está en el setlist.» That is the editor's «Ya está»
    (`SetlistEditor.tsx:608,621`). Two **kept** rows that already name the same song, a Studio
    duplicate, are carried as two rows. The editor loads such a setlist and saves it back as it
    is, and the spec requires it: «a song that appears twice is still two distinct rows».
    Removing one of the two is allowed. Adding a song twice is something `/admin` cannot do
    either (Q7).
  - **Medley:** run `normalizeMedleyTags` (with a fresh-tag factory) only if one of these is true:
    a stored row was removed; the relative order of kept rows changed; a new row sits before any
    kept row (anything but a tail append); or any row sets `medleyTag` explicitly. Otherwise the
    stored tags are carried byte-identical. This is the editor's own trigger rule
    (`SetlistEditor.tsx:245-275`), and after it only adjacent runs of two or more carry a tag,
    as the editor's link toggle produces (`:276-316`; E5).
  - **Leaders:** the tool never drops an instruction (I13, I15, I9).
    - On a worship night, every row carries `leadIds`: stored leaders are carried forward,
      and an explicit `leads` replaces them (F6).
    - On any other service, a row carries `leadIds` only when it gives an explicit,
      **non-empty** `leads`. The writer's own `validateSongLeads` then refuses the whole
      request, because it pushes `songs[i].leadIds` whenever `!target.worshipNight`
      (`songLeads.ts:40-43`, called at `setlists/route.ts:377-380`). Nothing is written, and
      the refusal reads «Solo una Noche de alabanza lleva líderes por canción; este servicio
      no lo es. No se escribió nada.»
    - `leads: []` on such a service is a no-op, not a refusal, since the editor stores no
      leaders there either.
  - The body is `{ week, type: kind, roleId?, observed: { state, id?, rev? }, songs: [{ songId, play_key, medley_tag, leadIds? }] }`,
    with `roleId: serviceId` only for a special. That is the editor's own shape: `/admin` passes
    `roleId` only for a special (`ServicesPanel.tsx:1565`), and the editor sends what it was given
    (`SetlistEditor.tsx:391-392`). It goes through `saveSetlist`, which parses it with
    `parseSetlistWriteRequest`.
- **Stricter than `/admin`** (I15 says "at least"; each is a row of § «Admin surface gates»):
  - `roleRev` must still be current, on a weekend service as well as a special (above);
  - every song reference, kept or new, must resolve to a published `post` (gate rows E1, E4). The editor's
    `song->` resolves any document type, so a stored reference to an existing non-song document
    opens in `/admin` and is refused here;
  - every lead id the body sends, carried or explicit, resolves to a canonical `teamMembers`
    (`loadCanonicalMemberIds`), otherwise it is refused (I13). The editor offers only the Lead
    members that resolve and blocks a save that names anyone else (E7);
  - a stored `play_key` longer than 24 characters is refused unless replaced (E-key);
  - a leader who is not in the set's Lead is refused by the domain (`validateSongLeads`). The
    index maps back to the row (`rowKey` or position) with «X ya no está en Lead».
- **After a success:**
  - **Fresh observation (D8):** re-read through the same loaders, `loadCanonicalRole(serviceId)`
    and the setlist target loader. The tool returns `observations: { roleRev, setlist: { state:
    "single", id, rev, rowKeys } }` with the rows (title, key, medley runs, leader names) **only
    when the read-back is exactly the state this edit wrote**:
    - every row equals the written row, in order and field by field: `_key`, `song._ref`,
      `play_key`, `medley_tag`, and the leaders (`leads[]` with their `_ref`s and `_key`s),
      against `effects.songs`;
    - for a special, whose role document is the setlist, every other field of the role
      projection except `_rev` and `songs` equals what step 1 read: the five seat arrays with
      their `_key`s, `date`, `service_name`, `time`, `format` and `published`. A role edit made
      after the save lands on the same document and the same rev, so it counts too;
    - for a weekend service, the role's `_rev` still equals `roleRev`.

    Otherwise the tool returns the read-back with `changedAgainAfterSave: true` and no
    observation. If the read fails, it returns `observation: null` with «vuelve a leer con
    get_service» (a local catch, step 7).
  - **Repeat hint:** fetch `editorRecentSetlistsQuery(weeksAgoIso(8))` on `operationalClient`,
    exactly as the GET does (`setlists/route.ts:165`). Then call
    `recentSongUses(recentRaw, serviceDate)` with the target's own date, the step-3 signature. It
    gives `repeatedSongs: [{ title, lastUsed }]`. A failed hint read omits the hint; it never fails
    a committed edit (a local catch, step 7).
  - **Notifications:**
    - A draft (`published === false`) or a role-less week: «ninguna (servicio en borrador)».
    - Otherwise, the push «Setlist de la semana», listed member by member from the
      `notifySetlistSaved` descriptor. That audience is every worship member with setlist
      preference `all`, plus those assigned to a published service that week. It is sent
      immediately and without confirmation. Plus the outbox email to the participants
      (`queueSetlistNotice` descriptor) after the debounce window, if the setlist has songs.
- **Tests:**
  - Translation unit tests: every attribute survives an untouched row; a key-only edit leaves
    tags byte-identical; remove, reorder and a mid-list insert re-derive runs; a tail append does
    not; an explicit `null` clears; a duplicate or unknown `rowKey` is refused. **Duplicates
    (E3):** a new row naming a song that a kept row already names is refused; two new rows naming
    one song are refused; two kept rows that already name one song (a Studio duplicate) stay two
    rows, and removing one of them is allowed. A kept row with a stored `play_key` of 25
    characters is refused without `key` and accepted with one. On a worship night every row
    carries `leadIds`. On any other service only a row with explicit, non-empty `leads` does, and
    `leads: []` there carries none.
  - Schema: a `key` of 25 characters is refused and one of 24 accepted; a missing `roleRev` is
    refused.
  - Twin-run against the editor's body for the same intent:
    - weekend `none` → deterministic create, with the lock heartbeat when a role owns the week;
    - weekend `single` patch;
    - special patch under the role `_rev`;
    - draft vs published (the push is skipped on a draft; the outbox is null on a draft);
    - `revalidateSetlistSave`.
  - **Stale:** a moved rev; `none`, but created meanwhile (`concurrent_creation`); an identity
    mismatch; a special whose Lead changed (role `_rev` moved); `rowKeys` that do not match. Also
    `roleRev` moved: a special in `none` state whose team changed, and a weekend role whose date
    moved while both dates read `none`. Nothing is written in either case.
  - **Refusal replay, inherited rows** (the route's code): `setlist_draft_conflict`,
    `setlist_malformed`, `ambiguous_target`, `role_draft_conflict`, `special_role` not found or
    type mismatch, the week mismatch, `leadIds` not in Lead, **explicit `leads` on a service that
    is not a worship night** (the whole edit refused, zero transactions), `songs_length`, an
    over-long `medley_tag`, `bootstrap_completed_reload`, and a commit conflict.
    Also each of P1's four non-writable observation states, and a `null` or repeated row key: a
    Spanish refusal with zero reads past the schema and zero transactions.
  - **Refusal replay, mirror rows** (zero domain calls, zero transactions; the route alone run on
    the same fixture, where it commits): a stored row whose song reference dangles, a stored row
    with a duplicate `_key`, a stored row with no `_key` (gate row E1, each with the
    `invalid_content` copy); a stored reference to an existing non-song document (the `post`-typed
    resolver); a
    failed song lookup; a new `songId` that is a member id, and one whose song was deleted (E4);
    a carried leader whose member document is gone (E7).
  - **Fresh observation:** withheld when a row differs from what was written only in its
    `play_key`, or only in a leader's `_key`; withheld for a special whose seats changed after the
    save; returned, with the new `roleRev`, after L1-style special edits; `observation: null` with
    the committed `ok: true` when the read-back throws.
- The caller pin adds `app/mcp/tools/editSetlist.ts` to `setlistSaveCommit`.

### 12. Registration, descriptions, tool list, dev smoke, docs

- **Route:** register the four tools after the reads.
- **Descriptions** are in Spanish. Each one carries the I7 rule: pass the observation from
  `get_service`/`list_services` unchanged, never build it, and re-read after any refusal or unknown
  outcome. Each also names the notification audience. `edit_setlist` names both observations it
  needs (`roleRev` and `setlist`) and says that it refuses any setlist `/admin` will not open.
  `swap_assignment` says it only swaps two services of the same month that the planner would let
  it swap. `get_service` and `list_services` now name the write tools.
- **Tool list:** `mcpRoute.test.ts` expects exactly 12 tools (`EXPECTED_TOOLS`). Reads carry
  `{readOnlyHint: true, openWorldHint: false}`. Writes carry `{readOnlyHint: false,
  destructiveHint: true, idempotentHint: false, openWorldHint: false}` (I14). Schemas are strict
  (I13).
- **Smoke:** `scripts/mcp-dev-smoke.mjs` updates `EXPECTED_TOOLS` and `checkToolList` to the
  per-tool annotations. On dev, the four write tools are proven only by being **listed with
  `destructiveHint: true`** (`tools/list`). The smoke calls **no** write tool, in any mode (DV1).
  The smoke's own unit test asserts that its request builder can never emit a `tools/call` whose
  name is one of the four writes.
- **Docs, same delivery:**
  - `docs/MCP.md`: the four tools and their payloads; the notification table below; the
    admin-surface gate table (§ «Admin surface gates», condensed to gate → disposition); the
    transport-gate «Known behaviour», including that buffering removes the early SSE bytes a
    legacy-era client used to receive before the result; the SR-verification gap (step 7, D15);
    the unpublish no-sweep fact; the live-proof runbook and, later, the release record.
  - `docs/NOTIFICATIONS.md`: the MCP writes are the same writers, and the descriptor returns.
  - `docs/API_REFERENCE.md`, the `docs/README.md` index, the ADR from step 3 and the ADR-0040
    amendment.
  - `CLAUDE.md` **and** `AGENTS.md` get one invariant line: "The four admin write routes
    (setlists PUT, swap, publish-ready, unpublish) delegate everything after authorization to
    `app/utils/*Commit.ts`; `serviceCommitCallers.test.ts` pins their callers; MCP writes go only
    through them; `/api/mcp` buffers SSE so a tool finishes inside the handler". They also get a
    reusable-utils entry for `publishVerdict` ("the ONLY per-service publish predicate").

### 13. Release (CLAUDE.md order, without exception)

1. Gates green. **Fresh code review of the merge range.** It carries the docs-audit and
   worklog-completeness checklists, and it specifically checks:
   - each extraction is a pure move (the color-moved diff);
   - every counterpart test file has zero diff;
   - no MCP file imports a Sanity client other than the canonical ones;
   - no MCP file holds a role literal;
   - the registry and caller-pin lists match the tree;
   - every refusing `mirror` row of § «Admin surface gates» has its refusal test, every
     `mirror (behaviour)` row its translation or report test, and no tool imports
     `app/components/admin/storedRoleReadModel.ts`.

   Then fix, and **re-verify the fix** with a scoped review of the fix range plus the gates on the
   final tree.
2. Merge into `preview`, push, and verify the dev alias (`dev-owt-backstage.vercel.app` in
   `alias`, `githubCommitSha` = the pushed commit).
3. **Frank** runs `mcp-dev-smoke.mjs --await-revocation --reads` on dev. The smoke lists the 12
   tools and calls only `ping` and the reads (DV1). No write tool is called on dev at all. Dev
   writes the production dataset, and its `EMAIL_REDIRECT_TO` covers email only; it protects
   neither pushes nor production.
4. Open a PR to `main` from the same reviewed commit, wait for `gates`, and merge with Frank's OK.
   Verify the production alias.
5. The tools are live but **unused on any real service** until step 14 passes. That is the
   roadmap's "a tool released but not yet proven on production is never used on a real service".

### 14. Live proof on production: **human-gated parking points**

Every write below is made through the claude.ai connector on Frank's explicit instruction at that
moment, or by Frank in `/admin`. **The agent does not proceed past a parking point without Frank.**
Only specials are used, for two reasons:
- Every Sunday and Saturday date is a real service target, one role per date, that the team plans
  against. A throwaway would occupy it.
- Once `edit_setlist` created its `featuredSongs.<week>` document, the throwaway could not be
  deleted from `/admin`. Delete refuses a weekend role whose week holds a canonical setlist, "an
  EMPTY setlist still blocks" (`app/utils/roleDependencies.ts:219-238`).

So the weekend create/patch and lock-heartbeat paths are proven by step 11's twin-run tests, not
live. This limit is stated in the release record.

- **PP0, before anything:**
  - Frank confirms he has a working push device (a recent app push), his email preference for
    assignments and setlist is not `off`, and he is in `EMAIL_ALLOWLIST` (default `*`).
  - Read `NOTIFY_DEBOUNCE_MINUTES` for production from `vercel env ls production`. Entries only;
    the value is read only if it is non-sensitive config.
  - If there is no device, stop: push delivery cannot be proven.
- **PP1:** Frank creates, in `/admin`, two **drafts** that are specials on weekdays at least 2
  weeks out, after the next real service, and **in the same calendar month**, since the swap
  refuses a cross-month pair (§ «Admin surface gates», S1; Open question Q2):
  - **A**, «PRUEBA MCP A — ignorar», with Frank alone in Lead;
  - **B**, «PRUEBA MCP B — ignorar», with no team and no setlist.

  The two names differ, so neither trips the duplicate-special-identity admission (S2b). The
  assistant calls `get_service` on each and confirms `published: "draft"` and the exact seats.
  **The audience is confirmed before every write:** each step's expected recipients below are
  compared with those seats. Every write takes its observations (`rev`, or `roleRev` plus the
  setlist observation) from the most recent `get_service`, or from the fresh observation the
  previous write returned.
- **PP2, before L3a:** `get_service` A must show `publishCheck.passesNow: true`. In particular
  Frank has no `unavailableDates` entry on A's date, which would be an availability conflict and
  a workflow blocker. If it is not `true`, stop and resolve it in `/admin` first; L3a is the
  publish that must succeed.

| Step | Action | Expected document diff | Expected notifications (exact audience) | Delivery check |
|---|---|---|---|---|
| L1 | `edit_setlist` A with the `roleRev` and the setlist observation `get_service` reports (expected `none`: `buildRoleDocument` stores no `songs` field, `roleWriteRequest.ts:203-231`), 3 distinct songs, **each with a `key`**. A blank `play_key` makes the setlist `incomplete` (`serviceReadModel.ts:175`; `publishSelection.ts:189-191`), and L3a would then be refused | A's `songs` set under A's `_rev` | **none**: a draft skips the push, and `setlistUpsert` is null | Frank receives nothing for 10 min |
| L2 | `edit_setlist` A with L1's fresh observation (its new `roleRev` and setlist): reorder, one key change, link 2 rows as a medley | new keys; attributes carried; the medley run re-derived | **none** (draft) | nothing |
| L3a | `publish_service` A (ready), after PP2, with the `rev` from a `get_service` made after L2 | `published: true` plus assertion no-ops | push «Nuevo servicio asignado» → Frank; assignment email → Frank; «Setlist listo» → Frank (immediate) | Frank sees the push and both emails |
| L3r | `publish_service` B (not ready: empty team, no songs) | **none**: zero writes | **none** | the tool returns `not_ready` naming `team_empty` and `incomplete_setlist`, and it offers no override. Frank receives nothing. This is the roadmap's I4 "shown to refuse", live |
| L3b | Frank publishes B in `/admin` with the override (`team_empty`, `incomplete_setlist`) | `published: true` | none: B has no assignees and no songs | nothing new |
| L4 | `swap_assignment` section `Lead`, A↔B | A.Lead `[]`, B.Lead `[Frank]`, keys travel | push «Servicio actualizado» → Frank (added to B); outbox role emails for A and B → Frank after the window | the push at once; **wait for both emails** (≤ window + 5 min) before L5 (F7) |
| L5 | `swap_assignment` team, A↔B | the five seat fields exchanged: A gets `[Frank]` back | push → Frank (added to A); outbox emails → Frank | the push; wait for the emails |
| L6a | `unpublish_service` A | `published: false` | none | nothing |
| L6b | Frank unpublishes B in `/admin` | `published: false` | none | nothing. Compare A's and B's diffs (both only `published`) |
| L7 | `get_service` A first: L3a, L4, L5 and L6a all moved A's `_rev`, so L2's fresh observation is stale. Then `edit_setlist` A with the new `roleRev` and setlist observation, `rows: []` | A's `songs: []` | none (draft) | nothing |
| L8 | Frank deletes A and B in `/admin` | gone; leftover receipts and coordinators are inert | none (draft deletes are silent) | nothing |

- After each step, Frank compares `/admin` with the tool's report. The agent records:
  - the tool's reported notifications vs what arrived;
  - the step's duration, from the `[mcp]` timing line (step 7) in `vercel logs --json`;
  - the fresh observation's rev vs `get_service`.
- **I4 shown live:** L3r is refused by `publish_service` for the same blockers `/admin` will need an
  override for at L3b. The agreement test proves the same for every blocker combination.
- **Twin comparisons done live:** only the publish diff (L3a MCP vs L3b `/admin`) and the
  unpublish diff (L6a vs L6b). For `edit_setlist` and `swap_assignment` there is **no live
  `/admin` twin**: identity with `/admin` rests on the twin-run tests, the same function over the
  same body, plus L1–L2 and L4–L5 checked against the expected diff. Whether that is acceptable
  is Frank's call (Q6, beside Q5).
- **Stop conditions** (stop, report, and decide with Frank; `MCP_DISABLED=1` is the kill switch
  and needs a redeploy):
  - any notification **about A or B** to anyone but Frank (a layer-2 flush may deliver an
    unrelated notice that was already due; that is expected);
  - a reported audience that differs from what arrived, or from the table;
  - a diff that differs from the expected one;
  - any `isError` on a call expected to succeed (L3r's refusal is expected);
  - a write call slower than 20 s end-to-end.
- **Cleanup check:** `list_services` for the two months no longer lists A or B. No outbox notice
  for A or B stays pending: after L8, a pending L4/L5 notice would at most email Frank «ya no
  participas». That is acceptable, because its audience is Frank alone.

### 15. Record and close

- Write `docs/MCP.md`'s P3 release record: commits, aliases, the L-step results, durations (from
  the `[mcp]` timing line), the reads' server durations for P1's item 9, the weekend-path limit,
  the tests-only parity of `edit_setlist` and `swap_assignment` (Q6), and that the transport gate
  (step 1) removed the early SSE bytes legacy-era clients used to receive: a `tools/call` in the
  2025-06-18 era now gets its whole event stream at once, when the tool has finished.
- Close with `finish-cycle`: batch-append the worklog and schedule the weekly HR run.

## Notification audiences (confirmed from code at `963cd736`)

| Tool / path | Immediate | Queued in the outbox | Never |
|---|---|---|---|
| `edit_setlist`, draft or role-less week | — | — | push, email |
| `edit_setlist`, published | push «Setlist de la semana» to worship members with setlist preference `all`, plus members assigned to any **published** service that week (`notifySetlistSaved`, `fireAndForget`; listed from its step-2 descriptor) | `setlist` notice to the service's participants, if it has songs, after the window; recipients are resolved at flush with `published != false` | — |
| `swap_assignment`, per published role | push «Servicio actualizado» to the members **added** to that role | `role` notice to the union of before and after assignees, after the window | anything for a draft role |
| `publish_service` | push «Nuevo servicio asignado» to every current assignee; the consolidated assignment email to the members `sendAssignmentEmailsBatch` itself derives from the service body (`assigneesOf` + `rolesForMember`, `assignmentEmail.ts:148-151`), reported as that derivation | «Setlist listo» (`debounceMs: 0`) to the participants if there are songs, flushed in the same `after()` | — |
| `unpublish_service` | — | — | everything; there is no sweep (F1) |

All of these pass downstream filters: device tokens and push preferences, `EMAIL_ALLOWLIST`, and
`wantsNotification`. Any outbox upsert also triggers the derated layer-2 sweep, which can deliver
**other** already-due notices to their own recipients, exactly as the same `/admin` write does.
The tools report all of this as queued (I9).

## The 60 s ceiling

`/api/mcp` has `maxDuration = 60` (Vercel Hobby, ADR-0013), which is the same ceiling each
counterpart runs under. The table counts sequential round trips. MCP auth is 0–2, because the grant
and member are cached for 30 s.

| Tool | Before the response | `after()` (same invocation) | Worst case vs 60 s |
|---|---|---|---|
| `edit_setlist` | pre-read (role 2, target 2, songs 1 for kept and new rows together, members 0–1), then the domain (target 2, coordination 2 + locks 1, commit 1, `notifySetlistSaved` 2–3 if published), then read-back 2, repeat hint 1, names 1: about 20 × 0.1–0.3 s, so ≤ 6 s | the outbox upsert plus the sweep: deadline `derateClock(45 000)` = 32.5 s, send budget `derateClock(40 000)` = 30 s | ≈ 39 s |
| `swap_assignment` | admission: the whole-catalogue snapshot (7 parallel + 1, P1's measured figure) and `loadTargetOccupancy` for both roles (1, in parallel); then 2 × `loadRoleForWrite` (2 each), members 1, locks 1, commit 1, then members/unavailability 1 and read-back 1: ≤ 3 s + P1's load | push, plus 2 upserts each with a sweep (run concurrently): ≤ 32.5 s | ≈ 36 s + P1's load |
| `publish_service` | whole-catalogue load (7 parallel + 1), commit 1, names 1: P1's measured figure (precondition) | push + email batch (SMTP wave ≈ 2.6 s), plus the setlist upsert and sweep: ≤ 32.5 s | ≈ 37 s + P1's load |
| `unpublish_service` | load 2, occupancy 2, locks 1, commit 1: ≤ 2 s | none | ≈ 2 s |

The MCP adds at most about 8 round trips before the response over its counterpart, plus, for
`swap_assignment`, the whole-catalogue admission load that `publish_service` already pays.
Buffering adds none. A write slower than 20 s in the live proof is a stop condition. A platform kill
mid-`after()` loses notifications silently, exactly as in `/admin`. That is why the tools say
«encolada», never «entregada».

## Data and failure safety

- **Identity and source of truth:** the canonical dataset. Observations come from P1's snapshot,
  and every write re-asserts them on the server under `ifRevisionId`. The MCP layer never
  captures a revision to *send*: every rev in a write body comes from the input (I7).
  `edit_setlist`'s pre-read is only compared against the input, and the domain asserts the input.
  The admission reads (`swap_assignment`'s snapshot and occupancy, `edit_setlist`'s song and
  member lookups) only decide whether to refuse. They never supply a value the write sends.
- **Migration:** none. No schema change and no new document type.
- **Partial failure:**
  - Every counterpart commits **one** transaction, so there is no partial business write.
  - A refusal after a maintenance bootstrap is reported as such. `swap_assignment` refuses a
    missing lock at admission, before the domain, so its refusal writes nothing; the bootstrap is
    reachable through it only when the lock disappears between the admission read and the domain
    read. `edit_setlist` and `unpublish_service` inherit the bootstrap-then-refuse path exactly as
    `/admin`'s editor and «Ocultar» do.
  - A throw at or after the commit is an unknown outcome, and the text says to re-read.
  - A post-commit side-effect failure is swallowed by the shared helpers, as in `/admin`. It is
    reported as «encolada» and never as delivered.
  - A failure in a post-commit **report** read is caught locally and degrades only that field; a
    committed write is never reported as an unknown outcome (step 7).
  - A failed read-back returns `observation: null`, never a fabricated one.
- **Concurrency:** it is exactly the counterpart's, including the setlist writer's known gap (a
  weekend setlist saved before its role exists asserts no lock). `edit_setlist` addresses weekends
  only through an existing role (`serviceId`), so that gap is reachable only if the role is
  deleted between the tool's pre-read and the domain's coordination read. The tool then inherits
  the gap unchanged and neither widens nor narrows it (spec). A race is refused (409) and never
  merged. `edit_setlist`'s `roleRev` check narrows one gap `/admin`'s editor has: a special in
  `none` state, or a weekend role whose date moved, is no longer written after the role changed
  (step 11). What remains is the round trip between that check and the domain's own read.
- **Idempotency:** every write moves the rev it asserted, so a retry that reuses the same
  observation is refused `stale_revision`. That holds for all four tools: a retried publish (its
  reasons also carry `already_published`, which the copy leads with), a retried unpublish, a
  retried swap and a retried setlist edit. `unpublish_service` answers `changed: false` only when
  the rev passed is current **and** the service is already a draft, which is `/admin`'s
  `unpublished: 0`. No retry double-writes.
- **Data preservation and rollback:**
  - The throwaways are the only live data P3 creates, and they are deleted.
  - Leftover role-creation receipts and special-identity coordinators are inert; `/admin`'s own
    create-then-delete leaves the same.
  - The consumed outbox documents are inert.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| I1 audit | `protectedReadAudit.test.ts` (four entries moved, sixteen total, no dead entry); `mcpSanityClients.test.ts` unchanged (no new exemption); `serviceCommitCallers.test.ts` | an unregistered writer; a second write path; the MCP holding a client |
| I2 draft gating | `draftGatingCoverage.test.ts` and `mcpProtectedTypeLiterals.test.ts` green, no new exemption | a draft-gated literal in the MCP or the new modules |
| I4 one predicate | `publishVerdictSingleSource.test.ts`; step 9 agreement test over P1's matrix, plus the assertion-stage residual fixture; `publishRefusalParity.test.ts` (wiring) | a read and a publish that disagree; a reintroduced copy; the residual growing unnoticed |
| I6 authorization split | the four counterpart test files **unchanged** and green; the route diff shows only the auth prefix plus the call; the MCP route tests (bearer before dispatch) unchanged | an admin behaviour change; a tool reachable without the P0 checks |
| I7 observations | per-tool stale tests (steps 8–11); the schemas require every rev and observation, `edit_setlist`'s `roleRev` included; `rowKeys` checked; fresh observations and `freshRevs` withheld unless the read-back equals the write, full rows and `_key`s | clobbering a change Frank did not see; a setlist written to a date Frank did not read; a fresh rev that belongs to someone else's edit |
| I8 notification parity | twin-run: identical pushes, email batch and outbox upserts, from pre-commit captures | a notice computed after the commit (before == after, so it sends nothing) |
| I9 honest outcomes | report tests: descriptor equals scheduled; the publish email audience equals the batch's own derivation; «encolada» wording; unknown-outcome text on a throw, and never on a failed post-commit report read; `bootstrap_*` wording; publish refusals keyed on per-service reasons; «ya estaba oculto» for an already-draft unpublish | "delivered" claims; a silent partial outcome; a committed write reported as unknown; a blocker read as "retry" |
| I12 cache parity | twin-run revalidation assertions; `mcpToolCompletion.test.ts`; the step-1 `next start` spike | a dropped `revalidatePath` (F2) |
| I13 strict input | schema tests per tool (unknown field, missing rev or `roleRev`, `seat`, `mode`, a `key` over 24); song and lead resolution, kept rows included | argument injection; a dangling reference; a silently blanked key |
| I14 annotations | the 12-tool list test; the smoke's `checkToolList` | a write labelled harmless |
| I15 refusal parity, route half | step 8–11 refusal replay, `inherited` rows (route code == tool code, zero commits in both) | a guard the route has and the tool skips |
| I15 refusal parity, client half | § «Admin surface gates»: every row has a disposition; each refusing `mirror` row has a tool-side refusal test with zero domain calls and zero transactions, beside the route alone on the same fixture; each `mirror (behaviour)` row has a translation or report test; each `structural` row has a schema test; the step-13 review checks the table against the tests | a guard `/admin`'s editor, planner or read contract has and the tool skips |
| E1 (the spec's error contract) | runner and refusal tests: no Sanity text, no stack | internals leaked |
| DV1 | the smoke calls no write tool in any mode (its unit test pins the four names as never called); the four writes are checked on dev by `tools/list` only | a dev write to the production dataset |
| A16 / edit contract | step 11 translation tests (attributes survive, medley rule, unknown key refused, duplicate songs, fresh observation, repeat hint, worship-night leaders); the content gate (gate row E1) | erased medleys or leaders; overwriting a setlist `/admin` sends to Studio |
| Swap contract | step 10 (no seat shape; the admission; both revs plus locks in one tx; keys travel; the two reports) | a person-level move; a half swap; a swap the planner would not admit |
| SR-verification gap | `mcpRoute.test.ts`: the route's source has no delivery-capable import and no wrapper; the gap is stated in `docs/MCP.md` and the step-3 ADR (D15) | a delivery-capable import added to the route without a wrapper decision |
| Publish contract | step 9 (no override field; the immediate «Setlist listo» upsert with `debounceMs: 0`) | an override from the connector |
| Unpublish contract | step 8 (notifies nobody; no sweep, F1) | an unexpected fan-out |
| Transport | `mcpToolCompletion.test.ts`, both eras | work escaping the handler |
| Writes live | step 14 (L1–L8) against the table | the audience or delivery differing from the plan |

## Rollout, observability, and rollback

- **Release sequence:** step 13, then step 14. Preview first, always.
- **Signals:**
  - Vercel's runtime logs for `/api/mcp` carry the status only. Observed 2026-09-25 on
    production `dpl_3gs92i7…`: records from the logs API and from `vercel logs --json` have no
    duration field, and the Observability API answers 404 on this plan.
  - Durations therefore come from the `[mcp]` timing line (step 7). It gives the tool name,
    outcome, refusal code and milliseconds, never a payload.
  - Frank's inbox and phone, plus `/admin`.
- **Stop conditions:** those of step 14, plus any `5xx` from `/api/mcp` after release.
- **Rollback:**
  - Tools only: one commit removes the four tool modules, their four registration lines, their
    caller-pin entries and the tool-list/smoke expectations. The tools hold **no** registry
    entries (F4), so the audit needs no change.
  - The extraction, the registry moves, `publishVerdict`, the descriptors and the transport gate
    **stay**. Each one is behaviour-preserving for `/admin` and reads.
  - Emergency: `MCP_DISABLED=1` shuts every MCP and OAuth route on the next deployment.
- **Full rollback** (only if the extraction itself proves wrong): revert the P3 PR, which restores
  the route entries in the same revert.
- **Restoration check:** `tools/list` shows the 8 P1 tools; `/admin` publish, unpublish, swap and
  setlist save work on the dev alias. P0's route tests and `publishRefusalParity` are green.

## Decisions

| # | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Authorization extraction | Each counterpart's post-auth body moves **verbatim** into `app/utils/<x>Commit.ts`, taking the raw body and returning `{ok, status, body, effects}`. The route keeps auth + JSON parse + `NextResponse.json`. The tool builds the **counterpart's own request body** and calls the same function, so it goes through the same parser | Next forbids extra route exports (F3). One code path means I8 and I12 hold by construction, and so does **the route half of I15**: everything the route refuses, the tool refuses too, with the route's code, or earlier at admission with a code from the same vocabulary (I6). Running the counterpart's parser gives parse-level refusal parity for free. The **client half of I15**, what `/admin`'s editor, planner and read contract refuse and the route does not, does not follow from the extraction; it holds by § «Admin surface gates» (D13) | Four new modules; registry entries move (F4); two repo-wide guards gain names (F5) | this plan |
| D2 | I4 / ADR-0040 | **Consolidate**: one `publishVerdict`, called by the writer and by `publishRefusalFor` | I4 says "one" predicate. The mirror's only justification was P1's additive-only rule, and P3 is critical tier and edits the route anyway. ADR-0040 names P3 as D2's exit. The behavioural pin is limited to its fixtures, while one function is not | `publishRefusalFor` stays as a thin adapter, because a read has no request rev | this plan |
| D3 | Issue #97 | **Out of P3.** Inputs accept only `none`/`single`. The writer's own `setlist_draft_conflict` refusal is replayed in Spanish, naming Studio | Fixing it changes what `/admin` publishes, which conflicts with the roadmap's "admin behaviour unchanged" and "same diff as the admin UI". It is a product-visible change to a production predicate with its own acceptance (the Servicios card would gain a blocker), so it is a separate outcome by the split rule. The connector already refuses by shape, and publish inherits `/admin`'s behaviour exactly, so I4 holds (both sides use the same readiness) | The admin divergence persists until its own plan | Frank (Q3) |
| D4 | Transport completion | Buffer SSE responses in `/api/mcp` | F2: in the legacy era, revalidation is otherwise dropped. It is era-independent and costs one line | No incremental delivery (none is used) | this plan |
| D5 | Honest audiences | Side-effect helpers return descriptors (additive) | One source of truth for "queued to whom", captured pre-commit | A diff in a writer-imported module (return values only) | this plan |
| D6 | Throwaway creation and cleanup | **Frank, in `/admin`**, through the guarded create/delete routes. No script writes protected content | A script would be a second, less-guarded production create path. It would skip the receipt, the special-identity coordinator and occupancy, and need an `OPERATOR_TOOLING_ALLOWLIST` entry. Every throwaway write is Frank's own or made on his instruction at the time, which satisfies CLAUDE.md's consent rule | Manual steps; the runbook lists them | Frank (Q1) |
| D7 | Medley rule | Re-derive only on remove, reorder, a non-tail insert or an explicit medley edit | It is exactly the editor's trigger set, so the stored result is one `/admin` could produce, and key-only edits keep tags byte-identical | — | this plan |
| D8 | Fresh observation | A read-back through the writer's loaders, checked against the **full** written rows (`_key`, `song._ref`, `play_key`, `medley_tag`, leaders with their `_key`s), plus, for a special, every other field of the role, and, for a weekend service, the role's `_rev` | The PUT returns no rev. Assuming `_rev == transactionId` is unverified here, and changing the shared commit call would change a writer. Comparing keys alone would hand out a rev for a later edit that kept the keys and changed a key signature or a leader; on a special, a role edit after the save shares the document and the rev | +2 round trips; a racing write is flagged, not hidden | this plan |
| D9 | Swap reports | From `effects.seatStates` plus the writer's own `validateSongLeads`, with unavailability read from canonical members | The values are the notices' own. The leader rule is the one that will refuse the next save | +1 read | this plan |
| D10 | Registry ownership | The `*Commit` modules own the entries. The tools own none, and are pinned instead by `serviceCommitCallers.test.ts` | The transaction is where the audit looks. The caller pin restores "a new write surface must touch a pinned list" | The roadmap's rollback wording is adjusted (F4) | this plan |
| D11 | Scope per call | One service for publish and unpublish, and two for a swap. No batch | The spec's contract is "a service". Batch atomicity is `/admin`'s «Publicar todos» | More calls for a month | this plan |
| D12 | Dev smoke | Write tools are checked on dev by `tools/list` only; no call in any mode | DV1 ("no write tool against a real service"), taken literally. Registration and annotations are what dev can safely prove. Behaviour is proven by tests and by step 14 | No live refusal-path check on dev | this plan |
| D13 | I15's counterpart | The **admin surface** (UI, read contract, route), not the route alone. Every client-side gate gets one disposition in § «Admin surface gates»: `mirror`, `mirror (behaviour)`, `structural`, `inherited` or `declared narrowing` | I15 says "at least everything its admin counterpart refuses", and Frank's counterpart is the screen, not the endpoint (F9). Read as the route alone, I15 would let the tool overwrite a setlist `/admin` sends to Studio, add a song twice, and swap services the planner would not admit | Admission reads the route does not make; a table that must stay in step with the admin screens (the step-13 review checks it) | this plan |
| D14 | Duplicate songs in `edit_setlist` | Refuse a **new** row whose song is already in the resulting rows; **carry** two kept rows that already name one song | Mirrors «Ya está» exactly, which is checked when a song is added (`SetlistEditor.tsx:608,621`), while the editor loads and saves a Studio duplicate unchanged. It keeps the spec's «a song that appears twice is still two distinct rows» true. Refusing the whole edit instead would contradict that sentence, and it would block the one edit that fixes the duplicate (removing a copy) | A Studio duplicate survives until someone removes it; the notice table reads it against the last occurrence (`setlistDiff.ts:31-38`), as `/admin` does | Frank (Q7) |
| D15 | SR-verification coverage of `/api/mcp` | No exception entry in the scan; a positive test on the route's own source, and the transitive gap stated in `docs/MCP.md` and the ADR | The scan is per-file and follows no import, so an exception for `/api/mcp` would never be exercised and would read as coverage that does not exist. The positive test pins the one property the scan can see (no direct delivery-capable import, no wrapper), and the docs name what it cannot. The gap is an evidence gap, not a safety hole (`srVerificationRunContext.ts:163-165`) | An MCP write's delivery evidence carries no run markers | this plan |
| D16 | Swap admission source | P1's snapshot through `assembleService` (record, target, dangling, lock) plus the unpublish writer's `loadTargetOccupancy` (special identity, named drafts); never `storedRoleReadModel.ts` | The server already assembles these facts, and the write surfaces already use them. The planner's model is a client module over a different join. Readiness does not group specials by name (`serviceReadModel.ts:53-55`), so occupancy covers S2b. Only role-scoped facts are checked, because `publishVerdict`'s full `hard` list would refuse swaps `/admin` allows | The whole-catalogue load on every swap (§ «The 60 s ceiling») | this plan |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A1: F2 is real, meaning a legacy `tools/call`'s `revalidatePath` is dropped without buffering | none: buffering stays, and is harmless | step 1 test (red before, green after) and spike | record in the ADR either way |
| A2: `after()` registered in a tool body runs on Vercel after the buffered response | notifications lost | L3a (Frank receives the push and emails) | stop. Per the roadmap's Sequence table, a released tool not yet proven is never used on a real service: remove the write tools, or set `MCP_DISABLED=1` and redeploy. The `waitUntil` fix then follows as its own reviewed change |
| A3: Sanity is read-your-writes after commit (`visibility: "sync"` default) | the read-back shows the pre-write state | step 11 tests the mismatch flag; L2 uses L1's fresh observation | the observation is flagged and the text says to re-read |
| A4: Frank has a push device and has not opted out | push delivery unprovable | PP0 | stop; Frank registers a device or decides |
| A5: P1's production latency plus publish, and plus swap (whose admission pays the same whole-catalogue load, D16), fits the table | budget exceeded | step 0 | P1's narrowing follow-up first |
| A6: the twin-run harness drives both the route and the tool over one store | parity is only asserted piecewise | step 7 | fall back to per-surface tests plus a transaction-shape equality table |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| Q1: create and clean the throwaways in `/admin` or with a guarded script? | who writes protected content, and through which guards | **`/admin`**: the guarded routes, no new writer or registry entry, Frank's own consent (D6) | manual clicks | Frank | No | PP1 | `/admin` |
| Q2: throwaway dates and names | a published throwaway is visible to the team; an early date would become everyone's "next service" | weekdays at least 2 weeks out, after the next real service, both in the same calendar month (the swap's S1 admission); «PRUEBA MCP A/B — ignorar» | visible briefly (L3–L6) | Frank | No | PP1 | as recommended |
| Q3: fix #97 in its own critical-tier plan? | `/admin` publishes a week the editor then refuses | yes, as a separate plan that aligns readiness to `_type`+`week` and updates P1's parity fixtures | changes admin publish behaviour | Frank | No | after P3 | leave open, as today |
| Q4: exercise the unavailability report live (Frank marks himself unavailable on B's date for L4)? | proves one more report on production | **no**: step 10 tests it, and it would add two writes to Frank's own member document | one fewer live proof | Frank | No | PP1 | skip |
| Q5: is tests-only proof acceptable for the **weekend** setlist paths (deterministic create, `ifRevisionId` patch, lock heartbeat)? | the live proof uses specials only: a throwaway weekend would collide with a real Sunday or Saturday identity | **yes**: twin-run tests call the same function over the same body. A live weekend run would have to touch a real service's setlist | the weekend create/patch/heartbeat never runs live before the team uses it | Frank | No | PP1 | tests only |
| Q6: is tests-only **parity with `/admin`** acceptable for `edit_setlist` and `swap_assignment`? Live, only publish (L3a vs L3b) and unpublish (L6a vs L6b) are compared against a real `/admin` action | the roadmap accepts each tool on "the same document diff … as the admin UI"; for these two, the live steps check the expected diff, not an `/admin` twin | **yes**: the twin-run tests run the same domain function over the body the editor and the planner send, on one store. A live `/admin` twin would mean a second setlist edit and a second swap on the throwaways, with more notices to Frank | no human-observed `/admin` twin for two tools before the team uses them | Frank | No | PP1 | tests only |
| Q7: a setlist that already holds the same song twice (a Studio duplicate): carry the copies, or refuse the whole edit? | `/admin` refuses adding a duplicate but loads and saves an existing one (E3) | **carry them, refuse a new copy** (D14): it is exactly the editor's rule, keeps the spec's «two distinct rows» sentence true, and still lets Frank remove the extra copy through the connector | the duplicate survives until removed; its notice rows compare against the last occurrence, as in `/admin` | Frank | No | before implementation of step 11 | carry, refuse new copies |
| Q8: should `swap_assignment` refuse two services in different months, as the planner does (S1)? | `/admin` cannot swap across a month boundary; the route can, and notifies both services | **mirror it**: refuse unless both dates share `YYYY-MM`. It keeps the connector inside what `/admin` can do, and a cross-month swap is rare | a swap across a month boundary (the last Sunday of one month with the first of the next) cannot be done as one swap, in `/admin` or here; it takes a team edit in each month. Lifting the rule later is one line and one test | Frank | No | before implementation of step 10 | refuse cross-month |

## Handoff

- **Supplied to P4:**
  - the `*Commit` extraction pattern and the caller pin (P4 extracts the create route the same
    way);
  - the transport gate;
  - the side-effect descriptors;
  - `runWriteTool`, the refusal copy, the reports and the twin-run harness;
  - the admin-surface method (D13): P4's `apply_schedule` and `revise_proposal` get the same
    one-disposition-per-gate table for the planner's create path, whose gate the create route
    does not repeat either;
  - four proven writers.
- **Proposed spec erratum (not applied here):** the spec's `unpublish_service` row says the admin
  unpublish sweeps after responding. It does not (F1). List it in the spec review log's "later
  changes" at Frank's discretion. It changes no contract, because the spec already permits the
  difference.
- **Proposed roadmap amendment (not applied here):** the P3 row's Rollback reads «Remove the tools
  and their registry entries in one commit — the audit test forbids leaving either behind». Under
  D1/D10 the registry entries belong to the extracted `*Commit` modules, which stay. The
  amendment would read: «Remove the tools, their registration lines and their caller-pin entries
  in one commit; the `*Commit` modules keep their registry entries, so the audit stays green.
  The behaviour-preserving authorization extraction may stay» (F4). The coverage table is
  unaffected. List it in the roadmap review log's "later changes" at Frank's discretion.
- **Adversarial review order:** this plan alone, sequentially, two fresh verdicts on
  byte-identical text. Prior findings are never exposed. The churn cap is binding.
- **Implementation authorization: not granted by this plan.**

## Terminal state

**READY_FOR_ADVERSARIAL_REVIEW.** The plan is self-contained with no blocking unknowns. Q1–Q8 are
non-blocking and have defaults. Step 0's P1 acceptance is an entry gate for implementation, not a
review blocker.
