# OWT MCP — implementation evidence for the child plans

**Status: working evidence. Not normative, not a requirement, not under review.**
The requirements are the contracts in
[`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md)
(invariants I1–I15, auth O1–O9, the tool contracts) and the roadmap's H1–H4.

This file carries the repository facts gathered on 2026-09-22 that the P0–P4
implementation plans will need, so they are not rediscovered from scratch. Every
line was re-verified against `4a7ba45d` (after merging `origin/main`) on 2026-09-23 and **must be re-verified when the plan
that uses it is written** — line numbers drift, and a plan written from stale
evidence is exactly the failure the v2 spec exists to prevent. Candidate
mechanisms below are candidates; the plan decides.

## P0 — auth, transport, discovery

- **Middleware.** `MIDDLEWARE_MATCHER` at `app/utils/routeMatcher.ts:39-40`, copied
  verbatim into `proxy.ts` (sync guard `routeMatcher.test.ts:155-166`).
  `PUBLIC_ROUTES` (`routeMatcher.test.ts:34-50`) is asserted against a walk of
  `app/` route files (`:15-26`, `:59-60`), so only real route paths need entries.
  `public/` traffic passes through the middleware — the matcher already carries an
  explicit `manifest.webmanifest` exclusion.
- **Discovery (I10).** Static files fail twice: `public/.well-known/x.json` is served
  at `/.well-known/x.json`, not the extensionless RFC path, and an extensionless
  file's inferred `Content-Type` meets the global `X-Content-Type-Options: nosniff`
  (`next.config.mjs:34`); and a static document pins one origin. Candidate:
  route handlers computing `issuer`/`resource` from the request, reached at the RFC
  paths through `next.config.mjs` rewrites onto `/api/oauth/discovery/*`. Whether
  the App Router serves a literal `app/.well-known/` dot-directory is untested.
- **Reaching dev.** `dev-owt-backstage` is behind Vercel Deployment Protection
  (ADR-0027:7). The existing bypass is `SR_VERIFY_BYPASS_SECRET`, local only, sent as
  the `x-vercel-protection-bypass` header on the first request of a context; Vercel
  holds its own copy as the project's Protection Bypass for Automation
  (`docs/SECRETS.md:381-387`; `docs/DEV_VERIFY.md:69-72`). A local MCP smoke client on
  dev would be a new consumer of that secret.
- **House style.** `app/api/me/route.ts:7-9`: guard returning `null`, then
  `NextResponse.json({ error }, { status })`. No route under `app/` declares
  `export const runtime`.
- **Existing pieces.** Revocation-cache pattern: `TTL_MS = 30_000`,
  `app/utils/memberAccess.ts:4`. World-readable basis:
  `sanity/lib/operationalClient.ts:13-15`. No rate limiter exists (the only
  `rateLimit` hit is nodemailer's outbound pacing, `app/utils/email.ts:173`). No
  repo-owned JWT utility; `jose` is transitive only.
- **Secrets doc shape.** `docs/SECRETS.md:62-115` (`CRON_SECRET`): bold heads
  **Needed in** (a whole sentence), **Purpose**, **Where the value came from**,
  **How to rotate**, **Blast radius of rotation**; `:119-137` uses a bare
  **Blast radius**. No `.env.example` exists. Pinning pattern: ADR-0001 `:13`.
- **Tests.** Route tests import the handler and mock with `vi.mock`/`vi.hoisted`:
  `app/api/__tests__/cueRoute.test.ts:30,46`; params/URL stand-ins at
  `audioRoute.test.ts:21-22`. CI `gates`: `.github/workflows/ci.yml:46,49,55`.

## P1 — reads

- **Canonical read model.** `app/utils/serviceReadQueries.ts` exports pure
  `BoundQuery` builders only and executes nothing. Role projection returns seats as
  bare refs (`:20-24`) and songs unresolved (`:15`). `published` is projected
  (`:18`) and never filtered, so `canonical*` queries return drafts. Exempt from
  draft gating at `draftGatingCoverage.test.ts:96-104`. No month-scoped role query
  exists. Its header (`:1`) still says "six" protected types (ledger A13). A
  builder executed on a non-canonical client is flagged
  (`protectedReadAudit.ts:806-821`).
- **Readiness bundle.** `app/utils/publishReadyBundle.ts`: zero query literals of
  its own, in no audit registry. `loadServiceReadinessSources()` (`:140`) fires
  seven whole-catalogue queries — the proposal projection carries full `messages[]`,
  with its own "~800 KB × the catalog" warning (`serviceReadQueries.ts:38-43`).
  `assembleService(sources, roleId)` (`:443`) is **song-free and name-free by
  design**: `EMPTY_SETLIST_BODY` (`:254`), "The song rows are not re-projected"
  (`:266`), members mapped to `{id, rev, unavailableDates}` (`:504-508`). Since
  PR #90 it reads specials through `specialRolesWithEmbeddedSetlist` (`:184`), so a
  special with no songs shows the ordinary "missing setlist" workflow blocker. The
  embedded-setlist guard test checks a hard-coded list of two files
  (`embeddedSetlistPredicate.test.ts:16-19`) — an MCP readiness reader is not covered
  automatically. Neither
  file reads `_type == "post"`.
- **The one resolved + joined service query** is an inline literal in
  `app/api/admin/roles/route.ts:64-81` (whole dataset, ordered by `coalesce(week, date)` then `time`; it returns `time` and `format`, but its song projection (`:57`) carries no item `_key` and no `leads`). Candidate
  for `get_service`: extract it into `serviceReadQueries.ts` and scope it.
- **Readiness predicate (I4).** `deriveServiceReadiness`
  `app/components/admin/serviceReadiness.ts:702`; `classifyPublishBlockers`
  `app/components/admin/publishSelection.ts:102`.
- **Worship scope (I5).** `app/ministries.ts`: `WORSHIP_AUDIENCE_GROQ_FILTER`
  (`:74-75`, no super-admin arm — the audience/"is worship" filter) and
  `WORSHIP_MEMBER_GROQ_FILTER` (`:77`, `$all` arm, super-admin only per `:50-56`);
  its callers bind `$all` for a super-admin — `app/api/admin/members/route.ts:31` and
  `app/api/admin/login-events/route.ts:20-21`. Three readers of the storage contract:
  those two plus `normalizeMinistries`.
- **Other reads.** Fuse keys `app/utils/libraryIndex.ts:45`; tag filter `:103-105` (since PR #92: any match within tempo tags or within themes, all across the two groups).
  Taxonomy: `TEMPO_TAGS` `scripts/retag-songs.mjs:41`, `THEMES` `:100-236`.
  `mixesForKey` `app/utils/rehearsalMixes.ts:100-103`; audio route resolves
  `rehearsalMixes[_key == $key]` (`app/api/audio/[songId]/[key]/route.ts:20`),
  gated by `requireMinistryMember("worship")` (`:15`). `THREAD_MESSAGES`
  `app/utils/proposalMessageRead.ts:29-33`, embedded at
  `app/api/admin/proposals/route.ts:37` and `app/api/me/proposals/route.ts:65`;
  `isThreadOpen` `app/utils/proposalThread.ts:94-104`. `computeParticipation`
  `app/utils/computeParticipation.ts:48` over `ParticipantRole` (`:2-10`).
  `assignedMemberRefsQuery` `app/utils/notifyTargets.ts:21`, seat paths `:7-13`.

## P3 — writes

- **Common entanglement.** `requireActiveManager()` resolves the session from
  cookies (`app/utils/authGuards.ts:13-27`). `withVerificationRunContext` needs a
  `.headers` bag (`app/utils/srVerificationRunContext.ts:170-177`); its absence is
  safe. `after` and `revalidatePath` are imported by
  `app/utils/serviceMutationSideEffects.ts:55-56` and need a Next request scope —
  an MCP route handler has one, but the plan must confirm it.
- **`edit_setlist`** (`app/api/admin/setlists/route.ts`). Reusable:
  `app/utils/setlistWriteRequest.ts` (`parseSetlistWriteRequest` `:274`,
  `compareObservedTarget` `:118`, `buildSetlistSongDocs` `:214`,
  `buildWeekendSetlistDocument` `:234`; worship-night leaders `:152-161`) and `app/utils/serviceWriteTargets.ts`
  (`:99`, `:148`, `:205`). Inline: target/subject resolution `:285-362`,
  transaction `:382-407`, conflict mapping `:409-423`, side effects `:425-460`;
  worship-night leader checks `:356-361`, `:374-380`. Lock heartbeat `:404-407`, conditional on a lock; `loadWeekendCoordination` returns
  `{role: null, lock: null}` when no role occupies the target
  (`serviceWriteTargets.ts:233-235`); a special serializes on `target.role._rev`
  (`:347-348`, asserted `:402`). Revalidation `revalidateSetlistSave`
  (`serviceMutationSideEffects.ts:1037-1039`). Setlist push to the team:
  `notifySetlistSaved` (`:880-937`, called at `setlists/route.ts:446`); its email goes
  only to those seated (`outboxSweep.ts:229-231`).
- **`swap_assignment`** (`app/api/admin/roles/swap/route.ts`). Reusable: the
  `roleWriteRequest.ts` seat helpers, `loadRoleForWrite` (`roleWriteOps.ts:226`),
  `resolveOwnedCoordination` (`:299`). Inline: selection `:93-112`, topology
  admission `:114-158` (pure), write plan `:160-239` (pure), pre-commit seat states
  `:259-274`, transaction `:276-292` (both role revisions `:283`, locks `:291`),
  side effects `:305-338`.
- **`publish_service`** (`app/api/admin/roles/publish-ready/route.ts`, modes
  `ready`/`override`/`recover` at `:6-8`). Largely extracted already:
  `parsePublishReadyRequest` `publishReadyBundle.ts:735`, `buildPublishAssertion`
  `:542`, `mergeAssertionOps` `:576`, `withPublishedTrue` `:613`,
  `planPublishReadyAssertions` `publishReadyTransaction.ts:108`,
  `applyPublishReadyAssertions` `:219`. Inline: `GuardedTx` adapter `:76-92`,
  per-entry rejection loop `:167-230`, op assembly `:232-263`, commit `:269-278`,
  side effects `:280-311`. Revalidation `revalidateRolePublication`
  (`serviceMutationSideEffects.ts:1030-1034`). Since ADR-0037 the publish-time setlist
  email is sent at once: `queuePublishedSetlistNotices` (`:707`) passes
  `PUBLISH_WINDOWS = {debounceMs: 0}` (`:667`, `:756-757`); its before-state is the
  constant `[]` (`:684-685`). `/api/admin/roles/publish` has no
  readiness logic and no app caller (ledger F1).
- **`unpublish_service`** (`app/api/admin/roles/unpublish/route.ts`): imports no
  notifier (`:37`).

## P4 — solve and apply

- **Solve.** `buildSolveRequest` (`app/components/admin/plannerModel.ts:697-705`)
  takes `config, members, sundayDates, activeSatDates, historyEntries, year, month`
  and reads no role document. The solve route (`app/api/admin/solve/route.ts`)
  performs no Sanity read and declares `maxDuration = 60`; since ADR-0038 its response
  may carry `objective_skipped` (`:37-45`), passed through unchanged (`:73`).
- **Auto is three stages, not one.** `handleAuto` runs CP-SAT, then `applySpecialFill`
  on every exit (`MonthGenerator.tsx:3040-3097`): `fillColumn` (`localFill.ts`) for each
  special column, then `fillInstruments` (`instrumentFill.ts`, `:3070`) across weekend
  columns. Neither fill module has a client boundary. FOH is not auto-filled.
  Both fills rank by `load` over `savedWindowFor` — 56 days of role documents ending at
  the month's first Sunday, drafts and specials included (`MonthGenerator.tsx:417-433`,
  `:2224-2226`; `localFill.ts:263,294`; `instrumentFill.ts:169`; source: the admin roles
  GET, unfiltered). Saturdays default to ALL on every month change
  (`MonthGenerator.tsx:1842-1846`). Special refusals: `refuseSpecialOn`
  (`MonthCalendar.tsx:140` — check its client boundary before reuse); `buildColumns`
  drops an overlapping special with only `console.warn` (`plannerModel.ts:433-450`).
  Applying a move: `moveOccupant.ts` is `"use client"` and calls PlannerGrid's
  `withUpdatedCell` — extract, don't reuse. The planner's pick-time badges «No disp.» /
  «Sin declarar»: `PlannerGrid.tsx:3006-3015`. The MCP route needs a `maxDuration` with
  room for `after()` notification fan-out, as `publish-ready` and `unpublish` set.
- **Apply is create-only today.** `handleConfirm`
  (`app/components/admin/MonthGenerator.tsx:3202-3362`) re-runs `preflight`
  (`:3231-3247`) and aborts the whole batch if a date became occupied since the
  preview, then `runDraftCreateBatch` (`app/utils/monthDraftCreate.ts:106-124`)
  loops `POST /api/admin/roles` sequentially; the body (`:65-84`) carries no
  revision. The route creates one role per request (`:126`, `:213`, `:261`, `:368`).
  The month-create flow drafts one special per date on purpose (`plannerModel.ts:1009`,
  `:1031`).
- **The create route's precondition bundle.** Receipt id
  `roleCreate.<sha256(creationRequestId)>` (`app/utils/roleCreationReceipt.ts:233-235`,
  route `:258-261`); payload fingerprint → `409 idempotency_mismatch`
  (`roleCreationReceipt.ts:220-225`; includes `time` only when present, `:191`); occupancy → `409` (route `:148-167`); weekend
  lock under `ifRevisionId` (`:183-211`, `:273-275`); special identity coordinator
  (`:238-256`, `:278-281`); special identity is date + normalised name
  (`roleWriteOps.ts:367-399`); members exist (`:140-145`).
- **Atomic multi-role precedent.** `publish-ready` merges every entry into one
  transaction (`publishReadyBundle.ts:576-605`, committed `route.ts:270`); swap
  commits two roles plus locks (`swap/route.ts:278-295`).
  `PUBLISH_BATCH_MAX = 100` (`roleWriteRequest.ts:383`). A month is 3-6 Sundays plus
  selected Saturdays plus specials.

## P2 — fairness history

- `historyEntryFromDrafts` (`app/components/admin/plannerModel.ts:1254-1259`) keys
  by member **name** (via `memberIdToName`), counting only leads, BGVs and chorus.
  `HISTORY_ROLE_KEYS` (`:1205-1212`): `sunday_role` → `Sun.Lead`/`Sun.BGV`/`Sun.Choir`;
  `saturday_role` → `Sat.Lead`/`Sat.BGV`/none; `special_role` → none.
- It is fed the drafts **just created**, so the browser records history at
  draft-creation time. Storage: `localStorage["owt_solver_history_v2"]`
  (`MonthGenerator.tsx:306`, read `:1886`, written `:1898`/`:1905`). ADR-0038: one or two
  months of history can trigger `objective_skipped` — relevant to the P2 diff.
- ADR-0010 Decision 3: `docs/adr/0010-specials-fill-locally-not-in-the-solver.md:72-76`.

## Carried from the spec review — for the plans to decide

Non-blocking points the spec's final reviewers raised that belong to a child plan,
not to the spec:

- **P0:** whether the new OAuth doc types get a Studio schema (July put them in a
  hidden "Sistema" group); O9 needs a revocation path that needs no deployment.
- **P1/P3:** I7's "a read the user acted on" is enforceable by input shape only — the
  tool descriptions must carry the rule for the model.
- **P3:** define the refusal for a stored setlist whose rows have a missing or
  duplicate `_key` (legacy or imported data), which `edit_setlist` cannot address.
- **P4:** a month-sized signed proposal echoed verbatim by the model fails closed on
  any transcription slip — consider a compact opaque token that the server resolves.
- **P0:** the MCP and OAuth routes fail closed when `MCP_OAUTH_SECRET` is unset — an
  empty key must never sign or verify a token.
- **P0:** the dev smoke handshake needs a super-admin session and a consent POST, and
  `dev-verify` aborts every non-GET request — so Frank runs it himself; no agent can.
