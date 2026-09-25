# MCP connector — operator runbook

> **P0 status: released to production 2026-09-24** (PR
> [#95](https://github.com/FrankERP/owt-kb-v1/pull/95), `main` `c2ca5f7c`). Every P0 route, test and
> script this document describes is deployed; the core flow (discovery, registration, consent,
> token exchange, `ping` and revocation) has been exercised end to end on dev and production.
> **Refresh has run only on dev** — claude.ai won't refresh a production access token until close
> to its 7-day expiry, so the first production refresh is expected around 2026-10-01. See
> [Release record](#release-record-p0-2026-09-24) for the evidence and the
> [release checklist](#p0-release-checklist-steps-1213) for how it shipped.
>
> **P1 status: released to production 2026-09-25** (PR
> [#98](https://github.com/FrankERP/owt-kb-v1/pull/98), `main` `a04edb43`). The seven read tools
> below (`get_service`, `list_services`, `search_songs`, `get_song`, `get_member_availability`,
> `get_participation`, `list_proposals`) exist in the [Tools](#tools) section, the route registers
> them, the full gate set (`tsc`, `vitest`, `eslint`) is green, and production now exposes all
> eight tools. **Frank's phone acceptance is still pending** — Frank runs it later; checklist
> steps 8–9 (the answers compared against `/admin` and the song page, and
> production latency recorded against the 10 s stop condition) are not done. See the
> [P1 release record](#release-record-p1-2026-09-25) for the evidence and the
> [P1 release checklist](#p1-release-checklist-released-2026-09-25) for how it shipped and what's
> still open.
>
> **Summary: P0 released 2026-09-24; P1 released to production 2026-09-25 (PR #98, `main`
> `a04edb43`); phone acceptance pending.**

This app exposes itself to Claude as an [MCP](https://modelcontextprotocol.io) server, so Frank
can ask Claude questions against a live OWT Backstage deployment from his phone or desktop. The
connector is OAuth-gated end to end: only a super-admin can authorize it, and only super-admin
tools are exposed — P0 shipped one health check (`ping`); P1 adds seven read-only tools over the
same service/song/member/proposal data `/admin` shows (released to production 2026-09-25; see the
status banner above). See [ADR-0039](adr/0039-mcp-client-registration-is-stateless-dcr.md) for why client
registration is stateless, and [AUTH_AND_SECURITY.md](AUTH_AND_SECURITY.md#mcp--oauth) /
[API_REFERENCE.md](API_REFERENCE.md) for the route-level contract.

---

## What exists

### Endpoints

| Route | Gated by the session middleware? | What enforces it | Notes |
|---|---|---|---|
| `GET /.well-known/oauth-authorization-server` | No | nothing — **public by design**: fixed metadata, no input | `beforeFiles` rewrite to `app/api/oauth/discovery/authorization-server/route.ts`, which stays gated at its own path |
| `GET /.well-known/oauth-protected-resource` | No | nothing — **public by design** | rewrite to `app/api/oauth/discovery/protected-resource/route.ts` |
| `GET /.well-known/oauth-protected-resource/api/mcp` | No | nothing — **public by design** | same rewrite target, path-suffixed RFC 9728 form (what `resourceMetadataUrl` points at) |
| `POST /api/oauth/register` | No | the **redirect-URI allowlist**; what it returns is a **signed client id** that every later step verifies | stateless DCR — writes nothing (ADR-0039) |
| `POST /api/oauth/token` | No | the **signed authorization code plus its PKCE verifier** (or a signed refresh token and its live grant), and the signed client id | the only place grants are created and refresh tokens rotate |
| `GET \| POST \| DELETE /api/mcp` | No | its own **bearer-token** check, on every request | the MCP endpoint itself |
| `GET /oauth/authorize` | **Yes** | the session, plus a live, non-impersonating super-admin | the consent screen (a page, not an API route) |
| `POST /api/oauth/authorize` | **Yes** | the same, plus the same-origin check and the re-validated signed client id | the only thing that mints an authorization code; GET is 405 |

Every route in the table runs the same preflight before anything else (`mcpRoutePreflight`: the
kill switch, a foreign `Host`, a missing signing secret — a 503/404/503 on the API routes, «No
disponible» or a not-found page on the consent screen). The six routes marked "No" are excluded
from `proxy.ts` / `MIDDLEWARE_MATCHER` (`app/utils/routeMatcher.ts`) by design — none of them
reads a session cookie, and each is enforced by what its row names instead. `/oauth/authorize`
and `/api/oauth/authorize` deliberately stay **gated**: the consent screen needs a real
super-admin session, and it can afford to sit behind the middleware because NextAuth's
**default** `redirect` callback carries a relative `callbackUrl` (query included) through sign-in
unchanged — see the invariant in `CLAUDE.md` and the guard test
`app/utils/__tests__/authRedirectCallback.test.ts`.

**Canonical origin, one per deployment.** Every request is checked against the ONE origin that
deployment is allowed to serve, chosen by `VERCEL_ENV` (`app/mcp/oauth/origin.ts`):

| `VERCEL_ENV` | Canonical origin | Resource (`GET /api/mcp`'s audience) |
|---|---|---|
| `production` | `https://owt-backstage.vercel.app` | `https://owt-backstage.vercel.app/api/mcp` |
| `preview` | `https://dev-owt-backstage.vercel.app` | `https://dev-owt-backstage.vercel.app/api/mcp` |
| unset / `development` | `http://localhost:3000` | `http://localhost:3000/api/mcp` |

Every other `Host` gets a 404 — a per-deployment `*.vercel.app` preview URL, the other alias, a
loopback address on a Vercel box, all refused. This is what makes "one deployment, one issuer"
structural rather than configured.

### Tokens

HS256 JWTs (`jose`), signed with `MCP_OAUTH_SECRET` (see [SECRETS.md](SECRETS.md#mcp_oauth_secret)):

| Kind | Lifetime | Carries |
|---|---|---|
| client id | none (DCR client) | `redirect_uris`, an optional `client_name`, `iat` |
| authorization code | 60 s | subject, client hash, redirect URI, PKCE challenge, resource, `jti` |
| access token | 7 days | subject, grant id, `jti`, `aud` = this origin's resource |
| refresh token | 30 days | subject, grant id, `jti` — **rotated on every use** |

**A reused refresh token revokes the whole grant** (once the request otherwise passes every
other check) — this is deliberate (spec O4): the second presenter of a superseded refresh token
is treated as a sign that the token leaked, not as a race to be quietly resolved. A lost token
response therefore means Frank reconnects from Claude; there is no partial-recovery path.

### Tools

Eight tools total: `ping` (P0, released to production 2026-09-24) plus seven read tools (P1,
**released to production 2026-09-25** — PR #98, `main` `a04edb43`; see the status banner at the
top of this document). Every tool is registered the same way — one file per tool in
`app/mcp/tools/`, exporting a
`register<Tool>(server, deps?)` function that `app/api/mcp/route.ts` calls inside its handler
init — and every one declares `annotations: { readOnlyHint: true, openWorldHint: false }` and a
**strict** input schema (`.strict()` on the zod object): an unrecognized argument is refused as a
tool error, never silently ignored (spec I13). A tool reads the principal from
`ctx.http.authInfo`; the request it sees as `ctx.http.req` carries only an **allowlist** of the
headers the SDK needs (`FORWARDED_HEADERS` in `app/api/mcp/route.ts`) — never `Authorization`, a
session cookie or the Vercel bypass header. Every refusal and every error is **Spanish text that
carries no internals** — no Sanity error message, no stack, no query (`runReadTool`, spec E1); the
one documented exception is the SDK's OWN schema-violation message for a malformed call, which is
in English regardless (see [Known behaviours](#known-behaviours)). None of the eight writes
anything — P1 is reads only, and no write tool exists yet.

Four conventions the seven read tools share:

- **A refusal that has candidates names them in its TEXT**, as well as in
  `structuredContent.candidates`: `get_service`/`list_proposals` list `serviceId (kind, date)`,
  `get_member_availability` lists `memberId (name «alias»)`, and `get_song` lists
  `songId («title»)`. The SDK adds no text fallback for an object payload, so without this a
  client that reads only `content` would have no id to retry with.
- **What counts as a service is one rule, in one order.** A service is a role row of one of the
  three role types whose `_id` is a canonical document id (`serviceCandidateOf` in
  `app/mcp/reads/servicePresenter.ts`). The order is date, then `compareServiceTime`, then id
  (`compareServiceCandidates`). `get_service`, `list_services`, `get_participation` (its counts
  and its `services[]`) and `list_proposals`' links all use both, so a row one tool lists is never
  missing from another.
- **`name` does not mean the same thing in every tool.** `get_participation`'s `name` is the
  sidebar's display name: the `alias` when one is set, otherwise `member_name`. In `get_service`
  (seats and song leaders) and `get_member_availability`, `name` is `member_name`, with `alias` as a
  separate field. `list_proposals`' `lead`, `contributors` and message `authorName` carry
  `member_name` only, with no alias.
- **Readiness and the publish check come from pinned copies** of the publish-ready loader and
  route verdict, not from the originals. See
  [ADR-0040](adr/0040-mcp-reads-mirror-the-readiness-loader-and-publish-check.md) for why, the
  three tests that pin them, and why they must never be merged in a routine cleanup.

#### `ping` (P0, released)

Read-only, a strict empty input schema. Returns:

```json
{ "ok": true, "server": "owt-backstage", "version": "a1b2c3d", "now": "2026-09-24T10:15:00-06:00" }
```

`version` is the deployment's `VERCEL_GIT_COMMIT_SHA`, first 7 characters (`"local"` if absent) —
this is how you tell from the phone which deployment answered. Confirmed live 2026-09-24: the dev
smoke's `ping` returned `version: fd0bbe2` and the phone's returned `version: c2ca5f7`, both the
deployed commit, never `"local"`. `now` is America/Mexico_City wall-clock time with its UTC
offset.

#### `get_service` (P1, released 2026-09-25)

One service, selected **unambiguously**, exactly as `/admin` → Servicios shows it, plus the
observations a later write would need (I7 — P1 ships no write tool yet, but the shape is already
the one a future `edit_setlist`/`swap_assignment` would take).

- **Input** (exactly one of): `{ serviceId }`; `{ date, kind: "sunday" | "saturday" }` (`date` is
  the service's own day — a Saturday's is the Saturday's own date, the same `week` its setlist is
  stored under); `{ date, kind: "special", name? }`; `{ date }` alone when exactly one service
  falls on that day; or `{}` for the next service on or after today in America/Mexico_City —
  **D5: this default INCLUDES drafts**, unlike the member-facing `/api/cue`, because Frank is the
  admin planning the next service, which is often still a draft. A `drafts.*` id, a mixed
  selector, or a selector matching several or zero services is refused with the day's candidates
  listed (**D8**'s "never an arbitrary pick" discipline, ledger A15) — never a guess.
- **Payload:** `serviceId`, `kind`, `date`; for a special, `name`/`time`/`format`; `published`
  ("draft" | "published" — **I3**'s normalised state: an absent field predates drafts and is
  published, never inferred as invisible) alongside the raw `publishedRaw`; all five seat groups
  (`Lead`, `BGVs`, `Chorus`, `instruments`, `foh_team`) with resolved member names, each item
  flagged `missing: true` (the reference names no member) or `unresolved: true` (the name lookup
  itself failed) when it cannot resolve; the setlist's rows (song id/title/author, key, medley
  grouping, and on a «Noche de alabanza» each song's leaders); and `readiness`.
- **`readiness`** mirrors exactly what `POST /api/admin/roles/publish-ready` would decide for this
  service (**I4** — one predicate, never re-derived): `blockers.hard`/`blockers.workflow` (Spanish
  copy, the same the admin card shows), `primaryAction`, `conflicts` (availability),
  `integrityIssues`, and `publishCheck`. **`publishCheck.passesNow`** is the literal field that
  answers "does the per-service publish check pass right now" — there is no field simply called
  `ready`. `publishCheck.refusals` carries the route's refusal codes verbatim;
  `publishCheck.alreadyPublished` is broken out separately (a live service is not a "problem");
  everything else the route would refuse on is in `publishCheck.problems`, one entry per refusal
  code (`hard_integrity_blocker`, `unusable_observation`, `not_ready`) with its Spanish copy. The
  `hard_integrity_blocker` and `not_ready` entries also carry the copy of the blockers behind them.
  **`readiness.blockers` is not the same list.** It is the full `classifyPublishBlockers` result,
  one line per hard or workflow blocker code, reported whether or not the route refuses. A live
  service that lost its setlist is refused only `already_published` + `not_ready`, but its gap
  still shows in `blockers.workflow`. `unusable_observation` has no blocker code of its own: it
  appears only in `refusals`/`problems`, and today it always arrives with at least one hard blocker
  (see `list_services`).
- **`observations`** is everything a later write would need (I7): `roleId` and `roleRev` (the
  role's own `_id`/`_rev` — pass unchanged to `publish_service`/`swap_assignment` once either
  exists, never build them by hand), `seatItemKeys` (every seat item's `_key` per path — `Lead`,
  `BGVs`, `Chorus`, `instruments`, `foh_team` — `swap_assignment` would need one), and `setlist`,
  below.
- **`observations.setlist`** is the setlist's OBSERVED state, in the same vocabulary the setlist
  writer itself would use: `none` (no setlist exists), `single { id, rev, rowKeys }` (exactly one
  — the only state a write can act on), `ambiguous { ids }` (more than one candidate — a data
  problem), `draft_overlay { draftIds }` (an unpublished Studio draft sits over the target — the
  editor refuses until it is discarded or published in Studio), `invalid` (a malformed record), or
  `unknown` (a read this decision depends on failed — including a COORDINATION read, e.g. the
  weekend lock inventory, not only the setlist read itself; `unknown` is never "no setlist", it
  means "re-read before trusting this"). **A future write tool will accept only `none` and
  `single`** — the other four name states nothing may write to yet.
- **The legacy-id divergence.** `get_service`'s observation can name a week `draft_overlay` (the
  setlist WRITER's own rule: an overlay is found by `_type` + `week`) in a case where the
  `publish-ready` route's readiness bundle would call the same week clean (it matches overlays by
  BASE id, and a week whose canonical setlist carries a non-deterministic legacy id has no base id
  for the overlay to match). `get_service` adds a Spanish note pointing this out whenever readiness
  itself does not already name the draft. Tracked as
  [issue #97](https://github.com/FrankERP/owt-kb-v1/issues/97) — the same divergence the publish
  route and the setlist editor already disagree about.
- **`{}` follows /admin's order, so a timed special can come before an untimed service on the
  same day.** Untimed services sort after timed ones (`compareServiceTime`, as in /admin). So a
  day with an untimed Sunday-morning service and a special at 19:00 answers `{}` with the evening
  special, and lists the Sunday in `sameDayOthers`. `{}` refuses only when first place itself is
  tied: two untimed services with no timed one that day, or two services at the same earliest
  time. This is known and kept. A special's `time` is display and sort data only (CLAUDE.md), so
  `{}` never picks "next" by comparing it with the clock. Ask for the day with `{ date }` to see
  every service on it.
- **Also in the payload:** `sameDayOthers` (when `{}` resolved a service, every other candidate
  that shared its earliest date), `failedSources` (which domain of the snapshot failed, if any —
  the same list every other tool below reports) and `notes` (Spanish text for content a failed
  read could not show, e.g. an unresolved song title) — never a silent empty answer in place of
  either.

#### `list_services` (P1, released 2026-09-25)

Every canonical service in a month (`month: "YYYY-MM"`, default the current CDMX month), in
`/admin` → Servicios' order: date, then `compareServiceTime`. Services still tied after that are
ordered by id. That last tie-break is the MCP's own, not /admin's; it only makes the order
deterministic. Each entry carries identity, `published`/`publishedRaw` (I3), `roleRev` (I7 — pass
unchanged to a later write, never build it by hand), `passesNow` and `blockers` (I4, from the
same predicate `get_service` uses). **`passesNow` is the same verdict as `get_service`'s
`readiness.publishCheck.passesNow`**, so the two tools always agree on "can it be published now".
An entry does not carry the refusal codes. The one refusal with no blocker code of its own,
`unusable_observation`, always arrives with a non-empty `blockers.hard` today. A test pins that
over the fixture matrix (`servicePresenter.test.ts`); if it ever breaks, this entry would need the
codes. A failed roles read is a refusal — `services: []` never means "the read failed silently."

#### `search_songs` (P1, released 2026-09-25)

The same search `/biblioteca` runs, server-side, over the live catalogue: `normalizeText`
accent-insensitive matching (a query of 2 characters or fewer uses substring matching; 3+ uses the
library's own fuzzy Fuse index over title/artist/key), plus a tag filter combining the library's
own way — any match within one axis (tempo OR theme), both axes required when both are given.
`query`, `tags`, or both are required; an unknown tag slug is refused, listing the LIVE
vocabulary (never hard-coded). Each result carries `id, slug, title, artist, key, tags` — `tags`
here is an array of **slugs** (re-filterable directly against this tool's own input), a
deliberate asymmetry with `get_song`'s richer `{slug, title}` tag objects below.

#### `get_song` (P1, released 2026-09-25)

One song's OWN declared field set (**A8**) — neither of the two existing song-page projections,
because neither is canonical. Selects by `songId` (canonical id; a `drafts.*` id is refused) or
`slug` (never both); a slug shared by two posts — a Studio data problem, not something Sanity
enforces — is refused rather than picking one, and the refusal lists each candidate's `songId` and
title. **The payload carries neither the song's id nor its slug** (the caller already has whichever
one it selected by). `search_songs` is where both come from: each of its results has `id` and
`slug`. This is known and kept.

- `title`, `authors` (names), `artist` (the legacy `author` string, kept separate from `authors`),
  `keys` (base key, then each chord-chart key, then each PDF key, deduplicated), `bpm`, `timeSig`,
  `tags` (**`{slug, title}` objects** here — richer than `search_songs`'s bare slugs, since a
  single song's tag list is small and the title reads better standalone).
- `referenceLinks`: the reference-link list, the musical-reference URL, the lyrics-video URL,
  **`lyricsURL`** (a PDF link) and the tutorials. `lyricsURL` is returned exactly as stored,
  regardless of the chord-chart rule below — the PDF link is not gated by whether a chart exists,
  matching the existing song-page readers.
- `lyrics`: `"visible" | "hidden_by_chart" | "none"`, per
  [ADR-0018](adr/0018-lyrics-and-charts-are-independent.md) — a filled chord chart hides
  the lyrics even though they still exist in the document; an explicitly empty lyrics field is
  `"none"`, the same as an absent one. `hasChordChart` is reported alongside.
- `rehearsalMixes`, grouped by tone (`{tone, mixes: [{mixKey, kind, family, track, bpm}]}`) —
  never the waveform, the audio file or the content hash.
- `playHistory`: every past weekend service (Sunday/Saturday) this song played in, before today in
  America/Mexico_City, most recent first — **uncapped**: `get_song` reads the whole weekend-setlist
  catalogue and filters in JS, with no upper bound at all. By contrast, the song page
  (`app/(client)/posts/[slug]/page.tsx`) shows only its **3** most recent, and the song API route
  (`app/api/song/[id]/route.ts`) returns its **5** most recent — both reached through a GROQ
  `[0..19]` over-fetch (a buffer so canonicalizing a duplicate-week target still leaves enough rows
  to reach 3 or 5 after filtering), which is NOT itself a 20-entry display cap, and `get_song`
  carries no equivalent of it at all. **Specials never count** — a special's songs live on the role
  document itself, never in a separate weekend setlist, so the exclusion is structural, not a
  filter.

#### `get_member_availability` (P1, released 2026-09-25)

Unavailable dates for a month, for one member (`memberId` or `name`, mutually exclusive) or the
whole team when neither is given. **I5: lists the WORSHIP TEAM only** — a kids-only member never
appears here, not even by id (an id naming one is refused with the SAME message an unknown id
gets, so the refusal never leaks which case it was). Contrast with `get_participation` below: a
seat READ shows whoever is actually seated, kids-only included, because hiding a seated person
would misreport the service — the I5 exclusion applies to LISTING members, not to reporting who
holds a seat. **D7:** a `disabled` member is still listed, flagged `disabled: true` — `disabled`
removes app access, not schedulability. **D8:** `name` matches exactly (accent/case-insensitive)
against `member_name` or `alias`; an ambiguous name is refused, never a guess, and the refusal's
text lists every candidate as `memberId (name «alias»)`. In the payload, `name` is `member_name`
and `alias` is its own field (unlike `get_participation`). **One malformed member document fails
the whole-team answer.** If any worship-team document has an unexpected field shape (e.g.
`unavailableDates` or `memberType` stored as something other than a list), the whole call returns
the generic Spanish tool error instead of skipping that member. This is known and kept. Selecting
one member by `memberId` still works as long as that member's own document is well-formed. A
`name` lookup compares against every member's `member_name` and `alias`, so a malformed name field
on any member fails it too.

#### `get_participation` (P1, released 2026-09-25)

Per-member counts for a month, computed by the SAME function the Servicios sidebar uses
(`computeParticipation`), fed every service dated that month, drafts included. Each member with at
least one seat gets `sunLead`/`satLead`/`sunBGV`/`satBGV`/`coro`/`especial`/`total` (`total`
includes `especial`, A6) plus `instrWeeks`/`fohWeeks`. A dangling seat reference is counted and
flagged `missing: true`, never dropped; a member whose name could not be resolved (the bulk
snapshot read or the supplementary lookup failed — the two can fail SEPARATELY) is flagged
`unresolved: true` with a note, while every other member in the same result can still resolve
normally. A member's `name` is the sidebar's display name: the `alias` when one is set, otherwise
`member_name`. This differs from the other tools (see the conventions above). `services[]` covers
exactly the services the counts were computed from, under the same service rule and in the same
order as `list_services` (date, then `compareServiceTime`, then id). Each entry reports
`published`, so Frank can see which counts include drafts. A special also carries `name` and
`time`, so two specials on one day can be told apart. `failedSources` is reported for the same
reason `get_service`/`list_services` report it.
Unlike `get_member_availability`, this tool applies **no** ministry filter at all — the I5
exception for a SEAT read (above): a kids-only member seated on a role still counts.

#### `list_proposals` (P1, released 2026-09-25)

Setlist proposals for one service (`serviceId`, reusing `get_service`'s own selector validation)
or a month (`month`, default current CDMX month) — never both. Each proposal carries its link to
a service (`serviceId: null` when it cannot be resolved — never a guess — and only ever a service
`list_services` would list), `serviceDate`, `kind`, `status`, `lead`/`contributors` (with
`missing`/`unresolved`, same meaning as `get_service`'s seats; `name` is `member_name`, with no
alias), `songs` (title and key; a dangling song reference is `missing: true`), `threadOpen`, and
the **live** `messages[]` conversation — never the frozen `lead_notes`/`admin_notes`/`team_notes`
archive fields (ledger A7). **D6:** with `{ serviceId }` the full thread comes back; with
`{ month }` each proposal is capped to its last 10 messages (chronological), `messagesTotal`
always the true full count, `truncated: true` when anything was cut. `threadOpen` is
`isThreadOpen`'s own rule: open while the service's day has not yet passed in
America/Mexico_City, independent of `status`. **Unread state is never reported** — neither
document stores a read-mark
([ADR-0024](adr/0024-read-state-belongs-on-neither-document.md)), so this tool cannot invent one.

### Stored state

Two Sanity document types, both hidden and read-only in `/studio`
(`app/utils/studioProtection.ts`) — see [DATA_MODEL.md](DATA_MODEL.md#studio) for the full field
list:

- **`mcpOauthGrant`** (`mcpOauthGrant.<uuid>`) — one per authorized connection: member id, a
  HASH of the client id (never the raw value), the issuing origin, timestamps, the current
  refresh `jti`, the revocation flag.
- **`mcpOauthCodeRedemption`** (`mcpOauthCode.<sha256(jti)>`) — a replay guard, `redeemedAt` only.

Nothing stored is secret or replayable on its own — the dataset answers unauthenticated
published reads, and both types are safe to be world-readable (a member id is already public;
neither a client hash nor a refresh `jti` is usable without the signing secret). Dotted `_id`s
are not surfaced by the public reader regardless.

---

## Adding the connector (claude.ai)

**The connector is production-only** (the spec's «Connector origin» decision, D-2026-09-23).
Dev (`dev-owt-backstage.vercel.app`) sits behind Vercel Deployment Protection, and claude.ai's
servers carry neither the bypass header nor the bypass cookie, so they cannot reach discovery,
the token endpoint or `/api/mcp` there — a claude.ai connector pointed at dev fails at its first
request. Dev is exercised **only** by the local dev smoke client, `scripts/mcp-dev-smoke.mjs`
([below](#dev-smoke-procedure)), which sends the bypass header itself. Lifting the protection
instead was considered and declined: dev writes the production dataset.

1. In claude.ai (web, Desktop or mobile), add a **custom connector** with URL:
   ```
   https://owt-backstage.vercel.app/api/mcp
   ```
   Production only — P0 shipped there 2026-09-24 (its step 7 is exactly this; see
   [Release record](#release-record-p0-2026-09-24)).
2. Claude discovers the OAuth endpoints, registers itself (stateless DCR — nothing is written
   yet), and opens the authorize URL in a browser.
3. **Sign in to Backstage** if you are not already — the consent page is a real app page behind
   the session middleware, so it goes through the ordinary `/auth/signin` flow first if needed.
4. The consent screen (`/oauth/authorize`) shows the client's self-declared, **unverified** name,
   the exact redirect URI, and how long ago it was registered. Read it — this screen is what
   stands between a super-admin and the confused-deputy attack that stateless, open registration
   makes possible (ADR-0039). Approve only a connection you just started in Claude.
5. Press **«Permitir»**. This is the only action that mints an authorization code
   (`POST /api/oauth/authorize`) — a GET never does, so no link, prefetch or redirect can trigger
   it.
6. Claude exchanges the code for tokens and the connector is live. A `ping` call in Claude is the
   quickest proof it worked.

Only a live, non-impersonating **super-admin** can reach step 4 successfully — everyone else sees
a refusal screen (no session, wrong role, or impersonation active) and no code is issued.

---

## Revoking

Grant documents are hidden and read-only in Studio, so the script is the only way to revoke one
without a deployment:

```bash
# Dry run — lists every grant (id, sub, origin, timestamps, revoked state). Writes nothing.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs

# Revoke one grant.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id mcpOauthGrant.<uuid> --apply

# Revoke every live grant.
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --all --apply

# Either --apply form accepts an optional reason (defaults to "manual"):
node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id mcpOauthGrant.<uuid> --apply --reason "lost device"
```

Every non-`--apply` invocation is a dry run that shows exactly what would be revoked. Revocation
takes effect **within 30 s** (the MCP route's grant cache TTL, `GRANT_CACHE_TTL_MS` in
`app/mcp/oauth/grantStore.ts`) and needs **no deployment** — the next request bearing that
grant's access token gets a 401 once the cache entry expires.

---

## Kill switch

Setting `MCP_DISABLED` to any non-empty value (Vercel → Settings → Environment Variables, on the
environment to disable) shuts every MCP and OAuth route: they answer 503, and the consent page
shows «No disponible» instead of rendering. Unlike grant revocation, **this takes effect on the
next deployment**, not within 30 s — env vars bind at build time. See
[SECRETS.md](SECRETS.md#mcp_disabled).

---

## The WAF rate limit (`/api/oauth/register`)

Registration is stateless and writes nothing (ADR-0039), so its risk is noise and cost, not a
growing dataset. Vercel's Hobby tier allows **one rate-limit rule per project**:

1. Vercel dashboard → the `owt-backstage` project → **Firewall** → **New Rule**.
2. **Rate Limit**, path `/api/oauth/register`, key **IP**, a window like **10 requests / 60 s**,
   action **429**.
3. **If the project's one Hobby rate-limit slot is already used by something else, stop and
   decide** — do not silently displace an existing rule. This is a Frank-run dashboard step, not
   code; nothing in this repo can create or verify it.

---

## Dev smoke procedure

`scripts/mcp-dev-smoke.mjs` is a self-contained local client that runs the whole OAuth + MCP
handshake against a real deployment of this app's own MCP server — discovery, DCR registration,
PKCE, a loopback OAuth callback, token exchange, `initialize`/`tools/list`/`ping`, refresh, and
(optionally) a revoke-and-401 proof. It needs `SR_VERIFY_BYPASS_SECRET` (see
[SECRETS.md](SECRETS.md#sr_verify_bypass_secret)) to pass Vercel's Deployment Protection when
targeting the dev alias, and refuses to run against production outright. **Running it against dev
creates a real grant document in the shared production Sanity dataset** — revoke it afterward with
`scripts/revoke-mcp-grant.mjs`, per the steps below.

By default the smoke calls only `ping`, and its `tools/list` check requires only that `ping` be
registered — it passes against BOTH a P0-only deployment and a P1 one (production and dev have
both carried P1 since 2026-09-25), since the plain smoke's job is proving the handshake and
`ping`, not P1's registration. **`--reads`** (P1, once P1 is deployed to the target — true of both
dev and production since 2026-09-25) adds a sub-step right after `ping` and before refresh,
and its OWN `tools/list` check requires the full eight tools (it is about to call the other seven):
one call each to `list_services`, `get_service` (selected BY ID from `list_services`'s own first
result, the same way `get_song` below uses `search_songs`'s — never `{}`, so it never hits its own
same-day-tie refusal; an empty month, with no service to select by id, falls back to `{}`, and if
THAT refuses on a tie the pass logs it as an EXPECTED pass, "ambiguous (expected)", not a failure),
`search_songs`, `get_song` (using the first song id `search_songs` found),
`get_member_availability`, `get_participation` and `list_proposals`, printing a PASS/FAIL line per
tool and a counts-only summary — never a name or any other personal data. It calls no write tool;
none exist (DV1).

```bash
# Full dev smoke: discovery → registration → consent (opens the browser) → token →
# initialize/tools-list/ping → refresh → ping again → prints the grant id + revoke command.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs

# Same, plus one call to each of the seven P1 read tools after ping (P1 is on both dev and
# production as of 2026-09-25) — see the Tools section above for what each one returns.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --reads

# Same, then pauses after printing the revoke command so you can run
# revoke-mcp-grant.mjs --id <id> --apply in another terminal, press Enter, and this
# polls tools/list every 10s for up to 60s for the 401 that proves the revocation landed.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --await-revocation

# Local next dev instead of the deployed dev origin — no bypass secret needed.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --base http://localhost:3000

# Print the authorize URL instead of auto-opening it.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --no-open

# Skip the refresh-token round trip (step 8).
node --env-file=.env.local scripts/mcp-dev-smoke.mjs --no-refresh
```

Two safe proof-of-refusal runs — no network call, may be run by anyone, any time:

```bash
node scripts/mcp-dev-smoke.mjs --base https://owt-backstage.vercel.app   # refuses, exit 2
env -u SR_VERIFY_BYPASS_SECRET node scripts/mcp-dev-smoke.mjs --reads    # refuses, exit 2
```

**The revoke-and-401 check, end to end:** run the script with `--await-revocation`, let it walk
through registration/consent/token/ping/refresh, then when it prints the grant id and pauses, run
`revoke-mcp-grant.mjs --id <id> --apply` in a second terminal, come back to the first terminal and
press Enter. The script polls `tools/list` (not `ping` — the route authenticates before it
dispatches any method, so a `tools/list` 401 already proves the revocation) every 10 s for up to
60 s, and passes once it observes a 401 whose `WWW-Authenticate` header carries
`error="invalid_token"` — the same challenge a real, revoked Claude connection would see.

**A run that fails after the token exchange still names its grant.** By then the grant document
already exists in the shared dataset, even though the run never reached step 9. So the FAIL line
is followed by the grant id and the exact `revoke-mcp-grant.mjs --id <id> --apply` command. If the
id cannot be decoded from the access token, it is followed instead by the dry run that lists every
grant. A failed `--reads` pass is the usual case. Revoke that grant before re-running.

**If the token exchange reaches the server but its response is lost** (the request never gets a
usable reply — a dropped connection, a client-side timeout after the server already wrote the
grant), the smoke has nothing to decode and prints no grant id at all — neither the FAIL line's id
nor the "cannot be decoded" fallback names it. The grant still exists in the shared dataset;
`revoke-mcp-grant.mjs`'s dry-run listing (no `--apply`) still shows it, most recent first — find it
there and revoke it the normal way.

Every secret, code and token the script ever prints is redacted (an 8-character prefix plus the
length, never the value); nothing is written to disk.

---

## Size measurements

Measured at implementation time (steps 1 and 9):

- `/api/mcp`'s traced serverless function is **≈2.46 MB** (155 files).
- Installing the new dependencies (`mcp-handler`, `@modelcontextprotocol/server`,
  `@modelcontextprotocol/core`, `zod`, `jose`) grew `.next/server` by **≈+4.8 MB**.
- Adding any new route rehashes Turbopack's shared chunks, so **every existing function's trace
  shifted by ≈+90 KB** too — this is Turbopack build behavior, not something the new dependencies
  themselves cause.
- **The per-deployment total on Vercel (Function Storage impact) was not measured.** Vercel's API
  does not expose a per-deployment total, and step 13 (the production release) did not surface
  one either — the three build-measured numbers above are the only size evidence this project
  has. See [CI.md](CI.md#which-branches-vercel-builds) for why Function Storage matters on this
  project's Hobby quota.

---

## Known behaviours

A few things that look like bugs at first glance and are not:

- **The consent page streams.** `/oauth/authorize` lives under `app/(client)/`, which has its own
  `loading.tsx` — so Next streams the route rather than blocking on it. A concrete consequence:
  `notFound()` (the foreign-host refusal) arrives to the browser as an HTTP 200 with the 404 body
  streamed in, and every error redirect is delivered in-stream too. This is ordinary App Router
  streaming, not a bug in the OAuth flow.
- **A session that expires between opening the consent page and clicking «Permitir» dead-ends at
  a 405 JSON body**, not at a helpful error screen — `GET /api/oauth/authorize` (which is what a
  stale form would effectively hit) is deliberately 405, because a GET must never mint a code.
  Frank should restart the connection from Claude rather than retry the stale page.
- **The token endpoint refuses client authentication with two different statuses.** Clients are
  public (`token_endpoint_auth_method: "none"`), so any attempt is `invalid_client` — a
  `client_secret` in the body is a **400**, but an `Authorization: Basic` header is a **401**
  with `WWW-Authenticate: Basic realm="owt-backstage"`. RFC 6749 §5.2 requires that 401, with a
  challenge in the client's own scheme, whenever the client authenticated through the
  `Authorization` header. Every other `invalid_client` (a client id this origin never minted) is
  a 400.
- **A replayed authorization code is refused, but the tokens issued on its FIRST redemption are
  not revoked.** Spec O4 requires refusing the replay itself, not retroactively invalidating a
  legitimate prior exchange — if that is a security concern in a specific incident, revoke the
  grant directly.
- **The SDK's schema-violation message is in English**, regardless of the rest of the app's
  Spanish UI: `Input validation error: Invalid arguments for tool …` comes from
  `@modelcontextprotocol/server` itself, not from this app's code. Accepted as-is — Claude reads
  the error, not Frank, and translating an upstream library's internal message is not worth the
  maintenance cost.
- **`subscriptions/listen` gets a JSON-RPC error (`-32603`), never a held stream.** The handler is
  built with `maxSubscriptions: 0` deliberately (see `app/api/mcp/route.ts`'s header comment) — a
  kept-open SSE stream would mean a revocation or a role demotion could not bite within the
  30-second cache window, and would keep a serverless function invocation alive for no reason.
  **Not observed to be invoked during the step-13 live acceptance** (2026-09-24) — whether
  claude.ai's iOS app called `subscriptions/listen` was not directly confirmed; what was observed
  is that the authorization and `ping` flow completed with no visible effect from this refusal.
- **Not observed:** the consent page's streaming quirks above (`notFound()` arriving as a 200,
  an error redirect delivered in-stream) were not exercised by the step-13 happy path — Frank's
  phone never hit a foreign host or a refused request. Treat those two bullets as a design
  description, not a production-verified behavior, until an actual refusal is exercised there.

---

## Release record (P0, 2026-09-24)

All times America/Mexico_City.

**Dev smoke.** `scripts/mcp-dev-smoke.mjs --await-revocation` passed 10/10 at 10:42–10:44 against
the `fd0bbe28` preview deployment: discovery (issuer = dev), DCR registration, browser consent,
token exchange, `initialize`/`tools/list`/`ping` (`version: fd0bbe2`), refresh + `ping` again,
then a manual revoke (`scripts/revoke-mcp-grant.mjs … --apply`) that the smoke observed as a
`401 invalid_token`.

**Production discovery and the no-token 401.** Without a cookie, both discovery documents
(`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) return 200
JSON with `issuer`/`resource` equal to `https://owt-backstage.vercel.app`. `POST /api/mcp` with
no bearer token returns 401 with
`WWW-Authenticate: Bearer resource_metadata="https://owt-backstage.vercel.app/.well-known/oauth-protected-resource/api/mcp"`.

**Step 13 — live acceptance from the phone.** Frank added the custom connector in the claude.ai
iOS app (~13:25) and completed consent on the phone. `ping` returned `ok` with
`version: c2ca5f7` and Mexico City wall-clock time. Revocation test: the grant was revoked at
13:30:47; `ping` failed once the ≤30 s grant cache expired; Frank reconnected (a new grant at
13:31:59) and `ping` worked again. Vercel's runtime logs for `/api/mcp` showed 11×200 and 1×401
in the 15 minutes before the revocation test (the log read preceded the post-revocation `ping`,
whose failure Frank observed in the app); the 401 is consistent with an MCP client's token-less
first request, which is how clients discover auth, but it was not individually attributed.

**The WAF rule.** «MCP register rate limit», live since 2026-09-24: Request Path equals
`/api/oauth/register`, a fixed 60 s window, 10 requests, keyed by IP address, action 429. It
occupies the project's only Hobby-tier rate-limit slot — a future rate-limit need on a different
route means replacing this rule or upgrading the plan.

**Secrets.** Preview and Production each carry their own `MCP_OAUTH_SECRET`, generated
separately by Frank (~07:30 and ~10:56, per `vercel env ls`'s `created` timestamp at the
coordinator's check) — see [SECRETS.md](SECRETS.md#mcp_oauth_secret).

**Live state.** One live grant, from the phone connection above. Two revoked: the dev smoke's
grant and the one created and then revoked during the step-13 revocation test.

---

## Release record (P1, 2026-09-25)

All times America/Mexico_City.

**Code on the branch.** P1 was implemented on `claude/mcp-p1-reads`, head `becffada`. Its gates:
`tsc` 0 errors, vitest 376 files / 6649 tests, eslint 0 errors. The last review before merge was a
scoped re-verify over `b74bc9ae..becffada` — the final fix wave, not a fresh fix — so the last
worklog entry before the merge is that verification, not a fix. See the
[P1 release checklist](#p1-release-checklist-released-2026-09-25) below.

**Real-data probe.** Read-only, run against the production dataset before release: 0
readiness-parity mismatches across 39 roles; 0 cross-tool mismatches; 13/13 calls ok, worst
870 ms. This was measured laptop→Sanity through direct calls, **not through Vercel** — it is not a
production-latency measurement (see checklist item 9).

**Preview.** Merged into `preview` as `1345f711`, pushed 07:22. Deployment
`dpl_AdqsDZ7XK45vQN5rAiDp4BzaEMhi` — alias includes `dev-owt-backstage.vercel.app`,
`githubCommitSha` `1345f711`.

**Dev smoke.** `node --env-file=.env.local scripts/mcp-dev-smoke.mjs --await-revocation --reads`
passed 10/10 at 07:26. Reads 7/7: `list_services` (6 services), `get_service` (1),
`search_songs` (20 songs), `get_song` (1), `get_member_availability` (36 members),
`get_participation` (24 members / 6 services), `list_proposals` (6 proposals). `ping` reported
`version: 1345f71`. The smoke's own dev grant was revoked afterward, and a subsequent call
observed a `401 invalid_token`, same as the P0 revocation proof.

**Production.** PR [#98](https://github.com/FrankERP/owt-kb-v1/pull/98), `gates` passed in
7m34s, merged 07:37 (`main` `a04edb43`). Deployment `dpl_DsGcCQNyZWkv5JpPqsg3aBL4TMvR` — alias
includes `owt-backstage.vercel.app`, `githubCommitSha` `a04edb43`. Public checks: the PRM
discovery document returns 200, and `POST /api/mcp` with no token returns 401 with
`resource_metadata`.

**Revocation policy for this release.** The revoke-and-401 proof ran only on dev, against the dev
smoke's own grant, per the operator's preference recorded 2026-09-25: Frank's production connector
grant is not revoked as a routine release check, since revocation was already proven live on
2026-09-24 on both dev and production (see [Release record (P0)](#release-record-p0-2026-09-24)
above). The [P1 release checklist](#p1-release-checklist-released-2026-09-25) below reflects
this — it carries no "revoke the production grant" step.

**Not yet done.** Frank's phone acceptance (checklist items 8 and 9) is still pending; Frank runs
it later. Both are marked pending, not done, below.

---

## P0 release checklist (steps 12–13)

**Status: done — released 2026-09-24** (PR
[#95](https://github.com/FrankERP/owt-kb-v1/pull/95), `main` `c2ca5f7c`). All seven steps below
are complete; see [Release record](#release-record-p0-2026-09-24) above for the full evidence.

1. ✅ `MCP_OAUTH_SECRET` generated and set on **preview** by Frank, ~07:30 (per `vercel env ls`'s
   `created` timestamp).
2. ✅ Branch merged into `preview` as `fd0bbe28`, pushed 09:21; dev alias verified — deployment
   `dpl_o5ZZH4Hw5jegrVa4HUshmXXuov8x` READY, alias includes `dev-owt-backstage.vercel.app`,
   `githubCommitSha` `fd0bbe28`.
3. ✅ Dev smoke (`scripts/mcp-dev-smoke.mjs --await-revocation`) passed 10/10 at 10:42–10:44; the
   grant it created was revoked afterward.
4. ✅ WAF rate-limit rule «MCP register rate limit» created on `/api/oauth/register` — live since
   2026-09-24.
5. ✅ A **separate** `MCP_OAUTH_SECRET` generated and set on **production** by Frank, ~10:56 (per
   `vercel env ls`'s `created` timestamp) — never reused preview's value (see why in
   [SECRETS.md](SECRETS.md#mcp_oauth_secret)).
6. ✅ PR [#95](https://github.com/FrankERP/owt-kb-v1/pull/95) opened, `gates` passed (7m17s),
   merged 13:05 (`main` `c2ca5f7c`); production alias verified — deployment
   `dpl_CEFFwWzqX2GW6ADvprH2Up9XyWZe` READY, alias includes `owt-backstage.vercel.app`,
   `githubCommitSha` `c2ca5f7c`.
7. ✅ Connector added from Frank's phone (claude.ai iOS app, ~13:25) against
   `https://owt-backstage.vercel.app/api/mcp`; `ping` answered with `version: c2ca5f7`, matching
   the merged commit — including a revocation-and-reconnect test.

---

## P1 release checklist (released 2026-09-25)

**Status: done — released 2026-09-25** (PR
[#98](https://github.com/FrankERP/owt-kb-v1/pull/98), `main` `a04edb43`). All eight implementation
steps of the P1 plan are implemented and gate-green:

1. the foundation (`runReadTool`, the route's `maxDuration`, the test client mocks);
2. the service snapshot (D1) and its parity test;
3. the publish-refusal predicate (D2) and its route-parity test;
4. `get_service` / `list_services`;
5. `search_songs` / `get_song`;
6. `get_member_availability` / `get_participation`;
7. `list_proposals`;
8. registration, the tool-list test, the dev smoke's `--reads` and these docs.

The plan's step 9, the release, is the checklist below — all release steps through the production
alias are done; **phone acceptance (items 8–9) is still pending**, deliberately — Frank runs it
later. See the
[P1 release record](#release-record-p1-2026-09-25) above for the full evidence behind every ✅.

1. ✅ A fresh code review on the merge range (this repo's release rule: a merge to `main` needs a
   review of the diff, not just the plan). It ran over `2fcb319c..b74bc9ae` and returned "with
   fixes", with the additive-only rule confirmed.
2. ✅ The fix wave for that review is committed on the branch (head `becffada`).
3. ✅ **Re-verify the fix** (CLAUDE.md): a scoped review over `b74bc9ae..becffada` — the fix
   commits' range — with the gates (`tsc`, `vitest`, `eslint`) re-run on the final tree — `tsc` 0,
   vitest 376 files / 6649 tests, eslint 0 errors. `mcpProtectedTypeLiterals.test.ts` pins the
   no-role-type-literal confirmation. The re-verify also confirmed the plan's other
   release-review ask — that every returned `_rev`/`_key` comes from the same query row as its
   content: `presentServiceList` (`app/mcp/reads/servicePresenter.ts`) reads `row._rev` from the
   same row it built the candidate from, and `serviceSnapshotParity.test.ts` pins it ("serves the
   raw rows and the readiness from the SAME row objects"; "gives a document the same `_rev`
   wherever it appears in one snapshot").
4. ✅ Merged `claude/mcp-p1-reads` into `preview` as `1345f711`, pushed 07:22; dev alias verified —
   deployment `dpl_AdqsDZ7XK45vQN5rAiDp4BzaEMhi`, alias includes `dev-owt-backstage.vercel.app`,
   `githubCommitSha` `1345f711`.
5. ✅ `scripts/mcp-dev-smoke.mjs --await-revocation --reads` ran against dev (see
   [Dev smoke procedure](#dev-smoke-procedure)) — passed 10/10 at 07:26, all seven read tools
   PASS, and the grant it printed was revoked afterward. **Revocation policy:** this is the only
   revocation check this release performs — Frank's production connector grant is not revoked as
   a routine release step, since revocation was already proven live on 2026-09-24 on both dev and
   production (see [Release record (P0)](#release-record-p0-2026-09-24)).
6. ✅ PR [#98](https://github.com/FrankERP/owt-kb-v1/pull/98) opened from the feature branch into
   `main`; `gates` passed in 7m34s.
7. ✅ Merged 07:37 (`main` `a04edb43`) — the production release. Production alias verified —
   deployment `dpl_DsGcCQNyZWkv5JpPqsg3aBL4TMvR`, alias includes `owt-backstage.vercel.app`,
   `githubCommitSha` `a04edb43`.
8. ☐ **PENDING — acceptance from the phone**, on production. Frank asks for:
   - next Sunday's service;
   - this month's services;
   - a song search;
   - a song;
   - his own availability;
   - this month's participation;
   - a proposal thread.

   Compare each answer with `/admin` (Servicios, Disponibilidad) and the song page. Any
   disagreement that is not one of the named departures in [Tools](#tools) is a stop condition.
   So is any `isError` on a valid request. Frank runs this later — do not mark it done until he
   has.
9. ☐ **PENDING — record the observed latency** of `get_service` and `list_services` on
   production, here, once Frank runs item 8. The plan's stop condition is **10 s**: a slower
   answer stops the release. **The 870 ms real-data probe in the
   [release record](#release-record-p1-2026-09-25) above does NOT satisfy this item** — it was
   measured laptop→Sanity through direct calls, not through Vercel, so it is not a production
   latency measurement. The remedy for a genuine latency failure is a follow-up plan that narrows
   the load (a month-scoped snapshot plus a parity proof, plan A1/D3), never an ad hoc change.
10. ✅ Updated this document's status banner, the [Tools](#tools) section's per-tool markers, and
    `docs/API_REFERENCE.md` / `docs/README.md` to say released, with the PR number and commit
    (this change).

**Rollback:** revert PR [#98](https://github.com/FrankERP/owt-kb-v1/pull/98), or set
`MCP_DISABLED` (see [Kill switch](#kill-switch) and
[SECRETS.md](SECRETS.md#mcp_disabled)) as the emergency switch — it shuts every MCP and OAuth
route (503, «No disponible»), but **takes effect on the next deployment**, not immediately, since
env vars bind at build time.
