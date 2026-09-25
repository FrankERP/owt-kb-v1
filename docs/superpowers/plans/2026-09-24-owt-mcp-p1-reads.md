# Implementation Plan: MCP P1 — the seven read tools

## Original request

> "haz el plan de P1" — Frank, 2026-09-24, after P0 (OAuth + `ping`) was released to
> production (PR #95, `main` `c2ca5f7c`; release docs PR #96, `main` `2fcb319c`).

## Status and contract

- **Document status:** Draft. **Risk tier: STANDARD** (the roadmap's P1 row). The work
  reads only, touches no audit registry, and changes **no existing export** of a module a
  production writer imports. The one edit to such a module is a header comment (A13). By
  CLAUDE.md's 2026-08-19 retier it gets **no adversarial plan review**: spec (approved)
  → implement → gates → fresh code review of the diff.
- **Accepted requirement source:**
  [`2026-09-22-owt-mcp-design-v2.md`](../specs/2026-09-22-owt-mcp-design-v2.md). That
  covers the read tool table, invariants I1–I5, I7, I13, I14 and E1, and ledger rows A6,
  A7, A8, A13, A15 and F2. The **P1** row of
  [`2026-09-22-owt-mcp-roadmap.md`](2026-09-22-owt-mcp-roadmap.md) applies, and so do its
  coverage rows I1–I5, I7, TZ, A13 and "reads".
- **Primary outcome:** from the claude.ai app, Frank can ask about services, setlists,
  seats, readiness, songs, availability, participation and proposal threads, and the
  answers match what `/admin` shows. The connector still **mutates nothing**.
- **Preconditions (all met):** P0 released, its production alias verified, and the
  handshake and revocation proven from the phone on 2026-09-24. **Frank's go-ahead to
  implement is still needed.**
- **Safe ending state:** a read-only connector with eight tools, `ping` plus seven reads,
  every one declared `readOnlyHint: true`.

## Evidence and current behavior

Verified at `2fcb319c`, 2026-09-24.

| Evidence | Source | Planning implication |
|---|---|---|
| The P0 tool pattern: one file per tool under `app/mcp/tools/`, each exporting `register<Tool>(server)`, all called in `createMcpHandler`. The handler is built once per module with `maxSubscriptions: 0` and `tools.listChanged: false`. Tools receive `ctx.http.authInfo = { clientId, scopes: [], expiresAt, resource, extra: { sub, grantId } }` and a request copy stripped of credentials | `app/api/mcp/route.ts:55-71,125-155,211-221`; `app/mcp/tools/ping.ts` | Each read is one module registered the same way. The principal is always the live super-admin (P0's six checks) |
| **The SDK turns a thrown handler error into `isError` text that contains `error.message`** | SDK `mcp-Dw2OlZ1f.mjs:1736-1763` | Every handler catches everything and returns a fixed Spanish message (E1). A Sanity error message must never reach the model |
| `/api/mcp` declares `force-dynamic` and **no `maxDuration`** | `route.ts:42-43` | Add `maxDuration = 60`, the repo's value on Hobby (ADR-0013). Each read loads the catalogue |
| The two route tests import `app/api/mcp/route.ts`. Once a tool imports `operationalClient`, the import chain reaches `sanity/env.ts`, which throws when `NEXT_PUBLIC_SANITY_*` is unset, as it is under vitest | `app/api/__tests__/mcpRoute.test.ts`; `mcpHandshakeChain.test.ts`; `sanity/env.ts` | Both tests need a client mock (step 1) |
| **Canonical read model.** `serviceReadQueries.ts` exports pure `BoundQuery` builders and executes nothing. It has 11 non-test importers, eight of them on write paths. `ROLE_PROJECTION` carries `_rev`, `published`, week/date, `service_name`, `time`, `format`, all five seat paths as bare refs with item `_key`, and `songs[]{_key, play_key, medley_tag, song._ref, leads[]}`. `SETLIST_PROJECTION` carries `_id`, `_rev`, `_type`, `week` and the same row fragment. `CANONICAL_MEMBER_PROJECTION` carries `_id`, `_rev`, `member_name`, `alias`, `unavailableDates` and `unavailabilityNotes`. The header at `:1` still says "six" (A13) | `app/utils/serviceReadQueries.ts:1,15-58` | Every protected-type projection P1 needs **already exists**. No new builder is required there. The A13 fix is a one-word comment edit |
| **Draft gating.** A role-type literal (`sunday_role` / `saturday_role` / `special_role`) without `published != false` anywhere under `app/` fails the suite. The only exemptions are the `api/admin` prefix and `utils/serviceReadQueries.ts`, and I2 forbids adding one | `draftGatingCoverage.test.ts:96-104,139-170,281-289` | MCP-owned files carry **no role-type literal**. They only execute existing canonical builders |
| **Protected-read audit.** Seven protected types. Canonical clients are the names imported from `sanity/lib/operationalClient` (`operationalClient`, `rawIntegrityClient`). A `serviceReadQueries` builder executed on another client is flagged. So is an unresolvable query on a non-canonical client in an operation that names a protected type, and it has no registry home. `app/mcp/**` is scanned (git-tracked files) | `app/utils/protectedReadAudit.ts:21-30,73,538-540,807-838,891-896` | Every protected read runs on those two clients, **imported directly** by the MCP module. A client passed in as a parameter is invisible to the audit |
| **The readiness loader.** `loadServiceReadinessSources()` runs 7 parallel whole-catalogue queries (roles, raw role drafts, locks, setlists, raw setlist drafts, proposals with full threads, raw proposal drafts), then one query for the referenced members. That is 8 round trips. Canonical reads use `operationalClient` and draft inventories use `rawIntegrityClient`. A failed domain becomes an `error` source and later a hard blocker. It returns summaries and `rolesById` / `proposalsById`, but **no raw setlist rows and no member map** | `app/utils/publishReadyBundle.ts:104-213` | Readiness (I4) comes from exactly these inputs. Content that Frank acts on (setlist rows, member names) is not exposed, so P1 needs its own snapshot of the same queries (Decision D1) |
| **The readiness chain publish uses.** `loadServiceReadinessSources` (`:130`) → `assembleService(sources, id)` (`:174`) → `classifyPublishBlockers(service.readiness)` (`:181`). Then come **inline** refusals: `hard_integrity_blocker`, `unusable_observation` (no observation, or `unsafe.length > 0`), `already_published`, `stale_revision`, `not_ready`, `blocker_set_changed` (`:182-200`) and `not_found` (`:209-216`) | `app/api/admin/roles/publish-ready/route.ts` | I4 needs `classifyPublishBlockers` **plus** the inline observation checks. Those live in a writer route that P1 must not modify (Decision D2) |
| Summary builders exported and pure: `collectRoleMemberRefs` (`:132`), `buildRoleTargets` (`:153`), `specialRolesWithEmbeddedSetlist` (`:438`), `buildSetlistTargets` (`:445`), `buildProposalSummary` (`:571`) | `app/utils/serviceReadSummary.ts` | A second loader can reuse them unchanged |
| `derivePublishState` (`:108`; absent means published), `deriveServiceReadiness` (`:702`), `serviceTodayIso()` (`:996`, CDMX), `isPastServiceDate` (`:1015`). `classifyPublishBlockers` (`publishSelection.ts:102`). Spanish reason copy `PUBLISH_SKIP_COPY` (`serviceCardModel.ts:1072`). All neutral, no `"use client"` | `app/components/admin/serviceReadiness.ts`, `publishSelection.ts`, `serviceCardModel.ts` | Every readiness, publication-state and "today" decision is **called**, never re-derived. Blocker text is the admin's own Spanish copy |
| **Setlist identity for I7.** Weekend setlists are found by `_type` + `week`: `loadWeekendSetlistTarget` refuses on any `drafts.*` overlay for the week, a malformed record or more than one document, and otherwise returns single `{id, rev}` or none. A special's setlist is the role itself: `songs` as an array means single `{id: roleId, rev: role._rev}`; absent means none. The writer rebuilds every row `_key` on save | `app/utils/serviceWriteTargets.ts:99-178`; `setlistWriteRequest.ts:76-101,195-209,274-303` | `get_service` reports the setlist's observed state in the **same shape** the writer takes (`none` / `single {id, rev}`), and also `ambiguous` and `draft_overlay` when the writer would refuse. It returns row `_key`s for P3 |
| Swap takes `seat {roleId, rev, path, itemKey}`, `section {path, roles[{id, rev}×2]}` or `team {roles[{id, rev}×2]}`, where `path` is one of `Lead`, `BGVs`, `Chorus`, `instruments`, `foh_team`. Publish takes `roles: [{id, rev}]` | `roleWriteRequest.ts:427,616-660`; `publish-ready/route.ts:193-195` | `get_service` returns the role's `_id` and `_rev` and every seat item's `_key` |
| **The admin's service list.** A whole-dataset inline query ordered by `coalesce(week, date)`, then `time` (null last, `compareServiceTime`). Weekend setlists are joined `[0]` by week. It has no row `_key`, no `leads`, no setlist `_id`/`_rev`, and it drops dangling seat references silently | `app/api/admin/roles/route.ts:57-81`; `app/utils/serviceTime.ts:25-32` | P1 does **not** copy this query. D1's snapshot is richer and does not guess a setlist with `[0]`. A dangling reference is **reported**, not dropped |
| "Next upcoming": `/api/cue` takes the earliest service `>= today` with `published != false`, because it is member-facing | `app/api/cue/route.ts:19-23,47` | For Frank, the default includes drafts (Decision D5); I3 reports which state it is in |
| **Library search.** `libraryIndex.ts` is neutral; its only runtime import is `fuse.js`. Fuse keys are title ×3, artist ×1.5, key ×1, with threshold 0.35 and `getFn` = `normalizeText`. Queries of two characters or fewer use accent-folded substring matching. `isTipoSlug` (`:90`) and the tag filter (`:103-105`, PR #92) work as: any tempo tag, AND any theme. The library loads posts with `tags[]->`, `authors[]->`, plus tags and authors | `app/utils/libraryIndex.ts:38-105`; `app/utils/normalizeText.ts`; `app/(client)/biblioteca/page.tsx:18-25` | `search_songs` builds the **same** index server-side and calls the same filter. Nothing is reimplemented |
| **Songs.** `post` is neither protected nor draft-gated. Studio edits can leave `drafts.<id>` copies, which `operationalClient` (published perspective) excludes. Neither of the two song projections is canonical (A8). ADR-0018: lyrics are `body`, charts are `chords[]{key, content}`, and **both readers hide `body` whenever `chords.length > 0`**. `body: []` means no lyrics. A mix is `{_key, kind, track, family, tone, bpm, audioFile, peaks[600], active, sourceHash}`; `peaks` must never be projected (4,822 mixes). Its audio is served only by `/api/audio/[songId]/[key]` (worship-gated) | `app/(client)/posts/[slug]/page.tsx:56-87,181,405`; `app/api/song/[id]/route.ts:17-60`; `sanity/schemas/post.ts:107-135`; `docs/REHEARSAL_MIXES.md:115-116` | `get_song` declares its own field set and derives lyrics presence by ADR-0018. Mixes go out grouped by tone with `_key`, never peaks or audio URLs |
| **Play history, as the song route computes it.** Weekend setlists only, `week < today`, read on `operationalClient`, so a `drafts.*` overlay never counts. The role's `published` flag is **not** checked (ADR-0005). **Specials are not counted.** The route's leaders join is an inline role literal with `published != false` | `app/api/song/[id]/route.ts:30-56`; `posts/[slug]/page.tsx:98-104` | `get_song` computes history from the existing `canonicalSetlistsQuery()` builder on `operationalClient`, with the same rule, and skips the leaders join (no role literal, I2) |
| **Worship scope (I5).** `WORSHIP_AUDIENCE_GROQ_FILTER` (`:74-75`) has no bypass: absent, empty or containing `"worship"` means worship. `WORSHIP_MEMBER_GROQ_FILTER` (`:77`) adds `$all ||`, which the admin member list binds to true for a super-admin (`members/route.ts:31`). Dates live on `teamMembers.unavailableDates` (`YYYY-MM-DD`) with `unavailabilityNotes[{date, note}]` | `app/ministries.ts:44-77`; `sanity/schemas/worshipTeam.ts:222-240` | `get_member_availability` uses the **audience** filter, never the `$all` one. `teamMembers` is not protected, so that query may live in the MCP module |
| **Participation.** `computeParticipation(roles: ParticipantRole[])`, where `ParticipantRole = {_type, date, leads, bgvs, chorus, instruments[{person}], foh[{person}]}`. Voice seats on a special count toward `especial`. `total` includes `especial` (A6). Instruments and FOH count once per week via `serviceWeekKey`. The sidebar feeds it the month's cards from the admin roles GET, **drafts included** | `app/utils/computeParticipation.ts:2-10,40-82`; `ServicesPanel.tsx:1273-1276` | `get_participation` feeds the same function from the same kind of source (all roles in the month, drafts included) and reports each service's publication state |
| **Proposals.** `setlistProposal` is **protected** but not draft-gated. It links to a service by `service_ref` (a role reference), `service_type` (sunday / saturday / special) and `service_date`. Status is one of `draft`, `pending`, `changes_requested`, `approved`. The live conversation is `messages[]`, capped at 200 × 4,000 characters; `lead_notes` / `admin_notes` are a frozen archive (A7). `isThreadOpen`: open while `day >= today` in CDMX. Read-marks exist on neither document (ADR-0024) | `sanity/schemas/setlistProposal.ts:16-42`; `serviceReadModel.ts:82-92,240-245`; `proposalMessageWrite.ts:90`; `app/utils/proposalThread.ts:94-104` | `list_proposals` reads proposals from D1's snapshot, reports the thread and whether it is open, bounds the payload (D6), and never reports unread state |
| Sizes: about 7 services a month, 144 songs, 43 tags, about 227 `featuredSongs`, 14 proposals, about 35 members | `docs/NOTIFICATIONS.md:114`; `docs/REHEARSAL_MIXES.md:115`; `serviceReadQueries.ts:44`; `serviceTime.ts:14-15` | Whole-catalogue loads are small today. Latency is measured at release (Assumption A1) |

## Scope

### In scope

- The seven read tools: `get_service`, `list_services`, `search_songs`, `get_song`,
  `get_member_availability`, `get_participation`, `list_proposals`. Each follows its
  spec contract.
- One MCP-owned service snapshot loader (D1). It is parity-tested against
  `loadServiceReadinessSources`.
- One MCP-owned "would publish refuse this, and why" function (D2). It is parity-tested
  against the publish-ready route's decision.
- `maxDuration = 60` on `/api/mcp`, the A13 header fix, test mocks, a tool-list update,
  an optional read pass in the dev smoke client, and docs.

### Non-goals

- Any write tool, any audit registry entry, and any change to an existing export, route
  or test of a writer-imported module (the roadmap's additive-only rule).
- Retiring the admin roles route's inline join or the publish-ready route's inline
  refusal checks. Both stay, pinned equal by parity tests until a separately reviewed
  change (P3, critical tier) consolidates them.
- Lyrics text, chord charts, audio URLs or waveform peaks in any payload. `get_song`
  reports lyrics **presence** only, per the spec.
- Kids reads. Unread state on proposals. Solver inputs (P4).
- Narrowing readiness to a month-scoped loader. The spec allows it only "as long as I4
  holds"; D1 keeps the whole-catalogue read, so I4 holds by construction.

### Preserved invariants

- **Existing modules stay unchanged.** Every existing export in `serviceReadQueries.ts`,
  `publishReadyBundle.ts`, `serviceReadSummary.ts`, `serviceReadiness.ts`,
  `publishSelection.ts`, `libraryIndex.ts`, `computeParticipation.ts` and
  `proposalThread.ts` is unchanged, and so are their tests. P1 **calls** them.
- **Draft gating.** No role-type literal appears in an MCP-owned file, and there is no
  new `MAY_SEE_DRAFTS` entry (I2).
- **Audit.** Every protected read runs on `operationalClient` or `rawIntegrityClient`,
  imported directly (I1). No registry changes.
- **P0.** P0's route checks, header stripping, kill switch and host rule are unchanged.
  The register route's import closure is unchanged (its guard test must still pass
  untouched).
- **Timezone.** Every "today", "next upcoming" and default month is computed in
  America/Mexico_City (`serviceTodayIso`). Dates go in and out as `YYYY-MM-DD` / `YYYY-MM`.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `app/api/mcp/route.ts` | registers `ping` | registers eight tools; `export const maxDuration = 60` |
| `app/mcp/reads/serviceSnapshot.ts` (new, `server-only`) | — | D1: one load of the readiness inputs, keeping the raw rows |
| `app/mcp/reads/publishRefusal.ts` (new, neutral) | — | D2: the publish-refusal predicate for reads |
| `app/mcp/reads/*.ts` (new) | — | presenters: service selector, seats, setlist, observations, payload shaping, Spanish errors |
| `app/mcp/tools/{getService,listServices,searchSongs,getSong,getMemberAvailability,getParticipation,listProposals}.ts` (new) | — | one tool each |
| `app/utils/serviceReadQueries.ts` | header says "six" | header says "seven" (comment only, A13) |
| `app/api/__tests__/mcpRoute.test.ts`, `mcpHandshakeChain.test.ts` | one tool; no client mock | eight tools listed, all `readOnlyHint`; client mocks |
| `app/utils/__tests__/embeddedSetlistPredicate.test.ts` | guards two files | also guards the MCP snapshot if it reads special setlists (step 2) |
| `scripts/mcp-dev-smoke.mjs` | calls `ping` | optional `--reads`: calls each read tool once (DV1 allows reads) |
| `docs/MCP.md`, `docs/API_REFERENCE.md` | one tool | the read tools, their payloads, and the departures (I5, A8, I3) |

No trust boundary moves. Every read runs behind P0's per-request checks.

## Ordered changes

Every step leaves the four gates green. Nothing deploys until step 9.

### 1. Foundation

- **Change:**
  - Add `export const maxDuration = 60` to `app/api/mcp/route.ts`.
  - Fix the `serviceReadQueries.ts:1` header ("six" → "seven"), comment only.
  - Add a client mock to `mcpRoute.test.ts` and `mcpHandshakeChain.test.ts`, following the
    repo's existing `vi.mock` conventions, so a tool's import of `operationalClient` never
    reaches `sanity/env.ts`.
  - Create `app/mcp/reads/errors.ts`: one wrapper that runs a handler, catches every
    throw, logs a fixed tag and the tool name (never the error body, a token or a query),
    and returns `{ isError: true }` with a fixed Spanish message. Validation refusals
    return their own specific Spanish messages.
- **Verification:** existing P0 tests pass unchanged apart from the mock lines. A unit test
  proves that a throw carrying a Sanity-looking message comes out as the fixed Spanish
  text, with no internals.

### 2. The service snapshot (D1) and its parity test

- **Change:** `app/mcp/reads/serviceSnapshot.ts` exports `loadServiceSnapshot()`.
  - It executes the **same** eight builders as `loadServiceReadinessSources`, on the same
    clients, with the same error semantics: a failed domain is `error`, never empty.
  - It calls the same exported summary builders to produce a `ServiceReadinessSources`.
  - It also keeps what the readiness bundle discards: raw role rows, raw setlist rows,
    setlist draft ids and `membersById`.
  - For content beyond readiness, it fetches the names of members referenced by proposal
    authors and contributors with the existing `canonicalMembersByIdsQuery` (a separate,
    non-readiness query).
- **Why not reuse the loader:** it does not expose raw rows. Changing its return value
  would change an export a writer imports.
- **Parity test** (`app/mcp/reads/__tests__/serviceSnapshotParity.test.ts`):
  - Both loaders run over identical mocked client responses, covering a matrix of normal
    services, drafts, a legacy role with no `published` field, a special with and without
    `songs`, a raw draft overlay, a lock issue and one failed domain.
  - The `ServiceReadinessSources` part of D1's output must **deep-equal**
    `loadServiceReadinessSources()`'s output, and `assembleService` must give the same
    `readiness` for every role id.
  - If the snapshot reads special setlists through `specialRolesWithEmbeddedSetlist`, add
    it to `embeddedSetlistPredicate.test.ts`'s file list.
- **Verification:** the parity test. A second test asserts the same `_rev` for a document
  wherever it appears in the snapshot.

### 3. The publish-refusal predicate (D2) and its parity test

- **Change:** `app/mcp/reads/publishRefusal.ts` exports
  `publishRefusalFor(assembled): { refusals: Code[], copy: string[] }`. It covers:
  - `hard_integrity_blocker` and `not_ready` from `classifyPublishBlockers`;
  - `unusable_observation` exactly as `publish-ready/route.ts:182-200` computes it;
  - `already_published` for a published service.

  It excludes `stale_revision` and `blocker_set_changed`, which only exist relative to a
  POST. Copy comes from `PUBLISH_SKIP_COPY`.
- **Parity test:** for each fixture service in the step-2 matrix, run the real
  `POST /api/admin/roles/publish-ready` handler with mocked guards and a mocked client, and
  observe its refusal reasons. The route refuses before any write. D2's codes must equal
  the route's for every service. The test follows `app/api/__tests__/publishReadyRoutes.test.ts`'s
  existing conventions and adds no new mocks to that file.
- **Verification:** the parity test, which is the I4 agreement test the roadmap requires
  ("what a read reports blocking is what publish refuses on").

### 4. `get_service` and `list_services`

- **`get_service` input:** strict, exactly one selector.
  - `{ serviceId }`, which must resolve to a role document (I13). Or
  - `{ date, kind: "sunday" | "saturday" }`. Or
  - `{ date, kind: "special", name? }`, with the name matched by `normalizeServiceName`. Or
  - `{}`, meaning the next upcoming service: the earliest service dated on or after today
    in CDMX, drafts included (D5).

  Ambiguity handling (A15):
  - A special selector without a name, when several specials share the date, is refused.
    The refusal lists `{ serviceId, name, time }` for every candidate.
  - `{ date }` without `kind` resolves only when exactly one service is on that date;
    otherwise it lists the candidates.
- **`get_service` output:**
  - **Identity:** `serviceId`, `kind`, `date`, and for a special its `name`, `time` and
    `format`.
  - **Publication (I3):** `published` normalised by `derivePublishState` (`"draft"` /
    `"published"`), with `publishedRaw` alongside.
  - **Seats:** all five groups, each item `{ itemKey, memberId, name, alias, instrument | role }`.
    A dangling reference comes out as `{ itemKey, memberId: null, missing: true }`, never
    dropped. A seated kids-only member is shown (the I5 seat exception).
  - **Setlist:** rows `{ rowKey, song: { id, title, author }, key, medleyTag }`, with the
    medley runs computed by `buildRuns`. On a worship night each row also carries its
    `leads` as names.
  - **Readiness (I4):**
    - `readiness.blockers` from D2, as codes plus Spanish copy;
    - `readiness.primaryAction.label`;
    - the conflict and integrity notes that `deriveServiceReadiness` reports.
  - **Observations (I7):**
    - `{ roleId, roleRev }` and the seat `itemKey`s;
    - `setlist`: `{ state: "none" }`, `{ state: "single", id, rev, rowKeys }`,
      `{ state: "ambiguous", ids }` or `{ state: "draft_overlay" }`, the last two naming the
      writer's refusal.

  **Snapshot rule:** every `_rev`, row `_key` and item `_key` comes from the **same query
  row** as the content it describes. The role row supplies seats and role `_rev`; the
  setlist row supplies rows and setlist `_rev`. Readiness is computed from that same
  snapshot.
- **`list_services` input:** `{ month?: "YYYY-MM" }`, defaulting to the current month in
  CDMX.
- **`list_services` output:**
  - one entry per service dated in the month, ordered by date then `compareServiceTime`:
    `serviceId`, `roleRev`, `date`, `kind`, special `name`/`time`/`format`, `published`
    (I3) and `blockers` (D2);
  - the snapshot's `failedSources`, when there are any.
- **Songs:** song titles come from one `post` query by id, run in the MCP module.
- **Descriptions:** both tools' descriptions carry the I7 rule: the observations must be
  passed unchanged to a later write, and are never constructed (the evidence file's P1/P3
  carried item).
- **Verification:**
  - selector tests for each form, including a two-special camp day and the `{}` default at
    **2026-09-30T23:30-06:00**, when UTC is already October 1;
  - an unknown `serviceId` refused;
  - a legacy role with no `published` reports `"published"`;
  - a draft reports `"draft"`;
  - blockers equal D2's output for the fixture;
  - observations match `loadWeekendSetlistTarget`/`loadSpecialSetlistTarget`'s decision on
    the same fixture: `none`, `single`, and a refusal for multiple documents or a draft
    overlay;
  - no `peaks`, body or chords in the payload.

### 5. `search_songs` and `get_song`

- **`search_songs` input:** `{ query?, tags?: string[] (slugs), limit? (1–50, default 20) }`,
  at least one of `query` or `tags`.
- **`search_songs` behaviour:**
  - The tag vocabulary is read live. An unknown slug is refused with the list of valid
    slugs (I13); none are hard-coded.
  - Search reuses `libraryIndex.ts`: the same Fuse index, the short-query path and the tag
    filter.
  - Output per song: `{ id, slug, title, artist, key, tags }`.
- **`get_song` input:** `{ songId } | { slug }`. An unknown id is refused.
- **`get_song` output, a declared field set (A8), copied from neither projection:**
  - `title`, `authors` (names), `artist` (the legacy string);
  - `keys`: the base `key`, chord-chart keys and PDF keys;
  - `bpm`, `timeSig`, `tags`;
  - `referenceLinks` (`referenceLinks`, `musicalReferenceUrl`, `lyricsVideoUrl`, `lyricsURL`, `tutorials2`);
  - `lyrics`: `"visible"` when `body` is non-empty and there is no chart, `"hidden_by_chart"`
    when `body` is non-empty and there is a chart, `"none"` otherwise, plus
    `hasChordChart` (ADR-0018);
  - `rehearsalMixes`, grouped by tone: `{ tone, mixes: [{ mixKey, kind, family, track, bpm }] }`;
  - `playHistory`.
- **Play history:** `[{ date, service: "sunday" | "saturday", key }]`, computed from
  `canonicalSetlistsQuery()` on `operationalClient` with the song route's rule: weekend
  setlists only, `week < today` in CDMX, no role publication check, specials not counted.
  The description states that specials are excluded, so the model does not over-read it.
- **Verification:**
  - accent-insensitive search (`"cancion"` finds «Canción»);
  - the tempo AND theme combination;
  - unknown tag refused;
  - the three lyrics states;
  - a mix with a `_key` and no peaks;
  - play history excludes today, a future date and a special, and includes a past draft
    role's setlist (ADR-0005 parity);
  - a `drafts.<id>` song copy is not returned.

### 6. `get_member_availability` and `get_participation`

- **`get_member_availability` input:** `{ month?, memberId? | name? }`.
  - The name is matched against `member_name`/`alias` via `normalizeText`, exactly.
  - An ambiguous name is refused with its candidates.
- **`get_member_availability` output:**
  - Members come from a `teamMembers` query in the MCP module, using
    `WORSHIP_AUDIENCE_GROQ_FILTER`, never the `$all` filter (I5).
  - Per member: `{ memberId, name, tipo, disabled, unavailable: [{ date, note? }] }`,
    filtered to the month. `disabled` is reported, not hidden: it removes access, not
    schedulability.
- **`get_participation` input:** `{ month? }`.
- **`get_participation` output:**
  - `computeParticipation` over the snapshot's roles dated in the month, drafts included,
    as the sidebar does.
  - Names come from `membersById`.
  - Per member: the function's counts, including `especial` and `total` (A6).
  - Plus `services: [{ serviceId, date, published }]`, so it is clear which counts include
    drafts.
  - It lists only members who hold at least one seat, since it is derived from seats (the
    I5 seat exception).
- **Verification:**
  - a kids-only fixture member is absent from availability even though the caller is
    super-admin (I5);
  - a member with no `ministries` field is present;
  - participation matches `computeParticipation` on the same fixture, and a special seat
    counts as `especial` and inside `total`;
  - a draft service is reported `published: "draft"`.

### 7. `list_proposals`

- **Input:** `{ serviceId } | { month? }`.
- **Output:**
  - Proposals from the snapshot. For each: `{ proposalId, serviceId, serviceDate, kind, status, lead (name), contributors (names), songs (titles, keys), threadOpen, messages, messagesTotal, truncated }`.
  - `threadOpen` comes from `isThreadOpen` (CDMX).
  - Messages are `{ at, authorName, authorRole, kind, body }`, taken from `messages[]` only.
    The frozen `lead_notes`/`admin_notes` are never reported (A7).
  - D6 caps the payload: a single service returns the whole thread; a month returns the
    last 10 messages per proposal, with `truncated`.
  - No unread state.
- **Verification:**
  - a proposal with only frozen notes and no messages reports an empty thread, not the
    notes;
  - `threadOpen` on the service date is `true`, and the day after is `false` (CDMX);
  - the month-mode truncation.

### 8. Registration, tool list, dev smoke, docs

- **Route:** register all seven reads in `route.ts`. Annotations: `readOnlyHint: true` and
  `openWorldHint: false`.
- **Tool-list test:** update the test in `mcpRoute.test.ts` to expect exactly eight tools,
  every one read-only, with strict schemas (I14, I13).
- **Dev smoke:** `scripts/mcp-dev-smoke.mjs --reads` calls each read tool once after
  `ping`, with no arguments or a current-month argument. Each call must return without
  `isError`. It still calls no write tool (DV1).
- **Docs:**
  - `docs/MCP.md` gets a Tools section: each read, its inputs, its payload, and the named
    departures. Those are I5 (worship filter on availability), A8 (declared song fields),
    I3 (normalised publication), play history excluding specials, and D6 truncation.
  - `docs/API_REFERENCE.md`'s MCP entry and the `docs/README.md` index line are updated.
- **Verification:** the route tests, a smoke run locally against `next start`, and a docs
  audit.

### 9. Release (per CLAUDE.md)

1. Gates green; **fresh code review** of the merge range. That review specifically checks
   that every `_rev` and `_key` returned comes from the same query row as its content
   (the roadmap requirement), and that no MCP file carries a role-type literal. Then fix,
   then re-verify.
2. Merge into `preview` and verify the dev alias. **Frank** runs
   `mcp-dev-smoke.mjs --await-revocation --reads` on dev.
3. PR to `main`, `gates`, merge with Frank's OK, and verify the production alias.
4. **Acceptance from the phone:**
   - Frank asks for next Sunday's service, this month's services, a song search, a song,
     his own availability, this month's participation and a proposal thread.
   - Each answer is compared with `/admin` (Servicios, Disponibilidad) and the song page.
   - Record the observed latency of `get_service` and `list_services`.

## Data and failure safety

- **Source of truth:** the canonical dataset, read through the published perspective.
  `drafts.*` is read only as an inventory (overlays), exactly as the readiness loader
  does. Nothing is cached across requests. Every call reloads, so a read never serves
  state older than its own request.
- **Writes:** none. No audit registry changes; the audit test enforces this.
- **Partial failure:** a failed domain in the snapshot is reported (`failedSources`), and
  readiness shows it as a blocker, as the admin does. A read never presents a failed
  domain as empty. A failed `post` query leaves song titles `null` with a note, while the
  service data stays correct. Every throw becomes a fixed Spanish tool error (E1).
- **Concurrency:** within a document, content and revision come from one query row, so an
  observation always matches the content Frank saw. Documents are read in parallel, not in
  one transaction, so two different documents may reflect moments milliseconds apart. That
  is the same guarantee the admin UI and the readiness loader have. P3's writes assert
  revisions, so a stale observation is refused, not applied.
- **Rollback:** see below. No data is touched, so there is nothing to restore.

## Verification

| Requirement | Test or check | Failure it detects |
|---|---|---|
| I1 audit | `protectedReadAudit.test.ts` green, registries unchanged; `app/mcp/__tests__/mcpSanityClients.test.ts` (every git-tracked non-test `app/mcp/**` file imports Sanity clients only from `sanity/lib/operationalClient`, one documented exemption: P0's grant store `writeClient`), because the audit cannot resolve a query passed through a helper parameter; step 2's parity responder rejects any snapshot read on the wrong client | a protected read on a non-canonical client |
| I2 draft gating | `draftGatingCoverage.test.ts` green, `MAY_SEE_DRAFTS` unchanged; review: no role literal in `app/mcp/**` | a draft-gated literal outside the exempt model |
| I3 | step 4 tests (legacy, draft, published) | a raw empty field reported as "not published" |
| I4 | step 3 parity test against the publish-ready route; step 2 snapshot parity | a read that says "ready" and a publish that refuses |
| I5 | step 6 kids-only fixture | the super-admin bypass leaking into a member listing |
| I7 | step 4 observation tests against the writer's own target loaders; code review of snapshot consistency | observations a later write cannot use, or taken from another snapshot |
| I13 / I14 | per-tool schema tests; the eight-tool list test | argument injection; a mislabelled tool |
| E1 | step 1 wrapper test; per-tool error tests | Sanity internals in a tool result |
| TZ | step 4 and step 7 evening-hour tests | a UTC day-flip in "next upcoming", the default month or `threadOpen` |
| A6 | step 6 `especial` / `total` test | a participation payload that drops specials |
| A7 | step 7 frozen-notes test | stale notes reported as the live thread |
| A8 | step 5 declared-field and lyrics-state tests | a copied projection; body shown when a chart hides it |
| A13 | diff shows the header fix | — |
| A15 | step 4 two-special test | an arbitrary pick on a camp day |
| F2 | `list_services` uses D2, not `summarizeUnfilledSeats` | the helper that cannot read stored services |
| Additive-only | `git diff` of writer-imported modules shows only the A13 comment; their tests unchanged | a silent change to a writer's dependency |

## Rollout, observability, and rollback

- **Release sequence:** step 9 exactly, preview first.
- **Signals:** Vercel logs for `/api/mcp` carry status codes and the per-tool error tag
  only, never payloads. The phone acceptance compares answers with `/admin`.
- **Stop conditions:**
  - an answer disagrees with `/admin`, and the disagreement is not one of the named
    departures;
  - any `isError` on a valid request;
  - `get_service` or `list_services` slower than 10 s on production.
- **Rollback:**
  - Revert the P1 PR. `ping` and P0 remain, and no data needs restoring.
  - For an emergency without a deploy, `MCP_DISABLED=1` shuts the whole connector (next
    deployment).
  - A single misbehaving tool can be removed by reverting its registration line.
- **Restoration check:** `tools/list` shows only `ping`, and `/admin` is unaffected.

## Decisions

| # | Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|---|
| D1 | Where services, seats and setlists come from | An MCP-owned snapshot running the **same eight canonical builders** as the readiness loader, keeping raw rows; parity-tested against `loadServiceReadinessSources` | Readiness and content come from one snapshot, so I4 holds by construction and every `_rev` sits beside its content. The existing loader does not expose rows, and changing it would change a writer-imported export | About 60 lines of orchestration duplicated, guarded by a deep-equality parity test. The roadmap's suggested new join builder in `serviceReadQueries.ts` becomes unnecessary | this plan |
| D2 | I4's refusal reasons | An MCP-owned predicate reproducing `classifyPublishBlockers` plus the route's inline observation checks, parity-tested by running the real route | The inline checks live in a writer route P1 must not modify. Two copies with an equality test is the roadmap's own pattern | A second copy until P3 consolidates it, at critical tier | this plan |
| D3 | Whole-catalogue load on every service read | Keep it | It is what publish does per request. At about 7 services a month and 14 proposals it is small. Narrowing it would put I4 at risk | 8 round trips per call. Measured at release; the stop condition is 10 s | this plan |
| D4 | Play-history rule | The song route's rule exactly: weekend only, past, published perspective, no role-publication check | The spec says "as the song page computes it today". Parity with what Frank sees on the song page | Specials are not counted, which is stated in the description | this plan |
| D5 | The default `get_service` includes drafts | Yes | Frank is the admin. The next service he plans is often a draft, and I3 labels it | Differs from the member-facing `/api/cue`, which is stated in the description | this plan |
| D6 | Proposal thread size | Full thread for one service; the last 10 messages per proposal for a month, flagged `truncated` | A month of worst-case threads (200 × 4 KB each) would swamp the model's context. The full thread is one call away | A month view shows recent messages only | this plan |
| D7 | Availability includes `disabled` members | Yes, flagged | `disabled` removes app access, not schedulability (CLAUDE.md). Hiding them would misreport who can be seated | Slightly longer list | this plan |
| D8 | Name matching for members and specials | Exact after `normalizeText` / `normalizeServiceName`; ambiguous input is refused with candidates | A fuzzy pick feeds the wrong observations to a later write (A15's lesson) | The model sometimes needs a second call | this plan |

## Assumptions

| Assumption | Impact if false | Validation point | Failure response |
|---|---|---|---|
| A1: a whole-catalogue load plus shaping stays well under 10 s on production | Slow answers on the phone | Step 9, measured | Narrow the load with a month-scoped snapshot plus a parity proof, as a follow-up plan. I4 must hold |
| A2: claude.ai handles an `isError` tool result by telling Frank, not by retrying forever | Loops on a refused selector | Step 9 phone run | Refine the descriptions and error text |
| A3: `libraryIndex.ts` produces the same ranking server-side as in the browser, since Fuse is deterministic | Search order differs from the library | Step 5 test with a fixed catalogue | Report the difference; the contract requires the match set, not an identical order |
| A4: the publish-ready route's refusal can be observed in a test without executing a write | The D2 parity test cannot run the real route | Step 3 | Pin D2 against a table extracted from the route's own tests instead, and flag it for P3 |

## Open questions

None blocking. D5, D6 and D7 are product-visible defaults Frank can overrule at review
without changing the design.

## Handoff

- **Supplied to P3:**
  - `get_service`'s observation block, in exactly the shapes the admin writers take;
  - row `_key`s for `edit_setlist`;
  - seat `itemKey`s for `swap_assignment`;
  - `roleRev` for `publish_service`;
  - D2, which P3 consolidates with the publish-ready route at critical tier.
- **Supplied to P4:** the snapshot loader as a reusable read of the whole service catalogue.
- **Review:** standard tier. No adversarial plan review; a fresh code review of the diff
  before `main`.
- **Implementation authorization: not granted by this plan.** Frank's go-ahead is
  required.

## Terminal state

**READY_FOR_ADVERSARIAL_REVIEW**: self-contained, with no blocking unknowns. Under the
roadmap's standard tier, the next step is Frank's go-ahead to implement, not a plan review.
