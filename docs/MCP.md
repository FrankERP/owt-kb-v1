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
> [#98](https://github.com/FrankERP/owt-kb-v1/pull/98), `main` `a04edb43`), **acceptance
> complete 7/7** (four asks on 2026-09-25, three on 2026-09-28, production latency recorded).
> The seven read tools below (`get_service`, `list_services`, `search_songs`, `get_song`,
> `get_member_availability`, `get_participation`, `list_proposals`) exist in the [Tools](#tools)
> section and production exposes them. See the
> [P1 release record](#release-record-p1-2026-09-25) for the evidence and the
> [P1 release checklist](#p1-release-checklist-released-2026-09-25) for how it shipped.
>
> **P3 status: released to production 2026-09-28** (PR
> [#106](https://github.com/FrankERP/owt-kb-v1/pull/106), `main` `7c65f2eb`), **live proof passed
> the same day.** The four write tools (`edit_setlist`, `swap_assignment`, `publish_service`,
> `unpublish_service`, see [Write tools](#write-tools-p3-released-2026-09-28)) are registered on
> `/api/mcp` on dev and production, so both expose all twelve tools. Step 14, the live proof on
> production against two throwaway specials with Frank as the only audience, ran 2026-09-28 on
> Frank's explicit go; see the
> [P3 live-proof runbook](#p3-live-proof-runbook-step-14-executed-2026-09-28) and the
> [P3 release record](#release-record-p3-2026-09-28). One limit stands: **push delivery could not
> be proven for any path**, `/admin`'s included, because production has no registered device (see
> the record); email is the delivery proof.
>
> **Summary: P0 released 2026-09-24; P1 released 2026-09-25 (PR #98, `main` `a04edb43`),
> acceptance complete 2026-09-28; P3 (four write tools) released 2026-09-28 (PR #106, `main`
> `7c65f2eb`), live proof passed; P2 (the solver's fairness history, derived from stored
> services) cut over 2026-09-28 (PR #108, `main` `98aa67a9`), Gate D pending; P4 (`solve_month`,
> `revise_proposal`, `apply_schedule`) plan approved at critical tier 2026-09-28
> ([plan](superpowers/plans/2026-09-28-owt-mcp-p4-solve-apply.md),
> [review log](superpowers/plans/2026-09-28-owt-mcp-p4-solve-apply-review-log.md)), not
> implemented.**

This app exposes itself to Claude as an [MCP](https://modelcontextprotocol.io) server, so Frank
can ask Claude questions against a live OWT Backstage deployment from his phone or desktop. The
connector is OAuth-gated end to end: only a super-admin can authorize it, and only super-admin
tools are exposed — P0 shipped one health check (`ping`); P1 adds seven read-only tools over the
same service/song/member/proposal data `/admin` shows (released to production 2026-09-25); P3 adds
four write tools that make the same changes `/admin` makes, through the same domain writers
([ADR-0043](adr/0043-admin-writes-delegate-to-commit-modules.md); released to production
2026-09-28). See the status banner above. See [ADR-0039](adr/0039-mcp-client-registration-is-stateless-dcr.md) for why client
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

Twelve tools: `ping` (P0, released to production 2026-09-24), seven read tools
(P1, **released to production 2026-09-25** — PR #98, `main` `a04edb43`), and four write tools
(P3, **released to production 2026-09-28** — PR #106, `main` `7c65f2eb`; dev and production both
expose all twelve). Every tool is
registered the same way — one file per tool in `app/mcp/tools/`, exporting a
`register<Tool>(server, deps?)` function that `app/api/mcp/route.ts` calls inside its handler
init, the writes after the reads. `ping` and every read declare
`annotations: { readOnlyHint: true, openWorldHint: false }`; every write declares
`{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }`
(spec I14). Every tool has a **strict** input schema (`.strict()` on the zod object): an
unrecognized argument is refused as a tool error, never silently ignored (spec I13). A tool reads the principal from
`ctx.http.authInfo`; the request it sees as `ctx.http.req` carries only an **allowlist** of the
headers the SDK needs (`FORWARDED_HEADERS` in `app/api/mcp/route.ts`) — never `Authorization`, a
session cookie or the Vercel bypass header. Every refusal and every error is **Spanish text that
carries no internals** — no Sanity error message, no stack, no query (`runReadTool` and
`runWriteTool`, spec E1); the one documented exception is the SDK's OWN schema-violation message
for a malformed call, which starts in English (see [Known behaviours](#known-behaviours)). `ping` and the reads write
nothing; the four writes are under
[Write tools](#write-tools-p3-released-2026-09-28).

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
- **Readiness comes from a pinned copy of the publish-ready loader; the publish check is the
  writer's own predicate.** The snapshot mirrors the loader (D1) and must never be merged with it
  in a routine cleanup. The per-service verdict is `publishVerdict` (`app/utils/publishVerdict.ts`),
  the same function the publish writer calls, so what `publishCheck` reports as blocking is what
  publishing refuses. It is not the whole refusal set: the writer's later guard-bundle stage can
  still refuse a service a read reports as passing. See
  [ADR-0040](adr/0040-mcp-reads-mirror-the-readiness-loader-and-publish-check.md) and its
  2026-09-26 amendment.

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
observations the write tools take (I7).

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
  service (**I4** — one predicate, `publishVerdict`, never re-derived; the writer's later
  guard-bundle stage is the one refusal it cannot see, per ADR-0040's amendment):
  `blockers.hard`/`blockers.workflow` (Spanish
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
- **`observations`** is everything a write takes (I7), passed unchanged and never built by hand:
  `roleId` and `roleRev` (the role's own `_id`/`_rev` — the `serviceId` and `rev` of
  `publish_service`, `unpublish_service` and `swap_assignment`, and `edit_setlist`'s `serviceId`
  and `roleRev`), `seatItemKeys` (every seat item's `_key` per path — `Lead`, `BGVs`, `Chorus`,
  `instruments`, `foh_team`; no P3 write takes one, because `swap_assignment` moves whole sections
  or teams, never a seat), and `setlist`, below (`edit_setlist`'s `observed`).
- **`observations.setlist`** is the setlist's OBSERVED state, in the same vocabulary the setlist
  writer itself would use: `none` (no setlist exists), `single { id, rev, rowKeys }` (exactly one
  — the only state a write can act on), `ambiguous { ids }` (more than one candidate — a data
  problem), `draft_overlay { draftIds }` (an unpublished Studio draft sits over the target — the
  editor refuses until it is discarded or published in Studio), `invalid` (a malformed record), or
  `unknown` (a read this decision depends on failed — including a COORDINATION read, e.g. the
  weekend lock inventory, not only the setlist read itself; `unknown` is never "no setlist", it
  means "re-read before trusting this"). **`edit_setlist` accepts only `none` and `single`**; it
  refuses the other four, as the setlist editor does.
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
deterministic. Each entry carries identity, `published`/`publishedRaw` (I3), `roleRev` (I7 — the
`rev` of `publish_service`, `unpublish_service` and `swap_assignment`, passed unchanged, never built
by hand), `passesNow` and `blockers` (I4, from the
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
normally. The tool always counts specials; the sidebar leaves them out unless its «Incluir
especiales» switch is on (off by default, 2026-10-01), so with the switch off the two differ by
exactly the specials. A member's `name` is the sidebar's display name: the `alias` when one is set, otherwise
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

### Write tools (P3, released 2026-09-28)

Four tools write. Each makes exactly the change its `/admin` counterpart makes, through the same
code. All four are on dev and production since 2026-09-28 (PR #106, `main` `7c65f2eb`) and were
proven live on production the same day (see the
[P3 release record](#release-record-p3-2026-09-28)).

| Tool | `/admin` counterpart | Route | Domain module |
|---|---|---|---|
| `edit_setlist` | the setlist editor | `PUT /api/admin/setlists` | `app/utils/setlistSaveCommit.ts` (`saveSetlist`) |
| `swap_assignment` | the stored planner's section or team swap | `POST /api/admin/roles/swap` | `app/utils/roleSwapCommit.ts` (`swapRoles`) |
| `publish_service` | «Publicar» in Servicios, `ready` mode | `POST /api/admin/roles/publish-ready` | `app/utils/publishReadyCommit.ts` (`publishReady`) |
| `unpublish_service` | «Ocultar» in Servicios | `POST /api/admin/roles/unpublish` | `app/utils/roleUnpublishCommit.ts` (`unpublishRoles`) |

What the four share:

- **One code path** ([ADR-0043](adr/0043-admin-writes-delegate-to-commit-modules.md)). The admin
  route authorizes and then calls its `*Commit` module. The tool, after `/api/mcp`'s own bearer
  check, builds the counterpart's OWN request body and calls the same function. So every refusal
  the route makes comes back with the route's code (I15, the route half). Every notice is queued
  by the same helper from the same pre-commit capture (I8). Every cache the route revalidates is
  revalidated (I12). The tool modules import no Sanity client, and `serviceCommitCallers.test.ts`
  pins each `*Commit` module's callers to exactly its route and its tool.
- **The client half of I15** is the gates `/admin`'s screens enforce and its routes do not. They are
  in [Admin-surface gates](#admin-surface-gates-i15) below.
- **Observations (I7).** A write takes what `get_service` or `list_services` returned, unchanged:
  `serviceId` is `observations.roleId` (or `list_services`' `serviceId`); `rev`/`roleRev` is
  `observations.roleRev` (or `list_services`' `roleRev`); `observed` is `observations.setlist`. A
  stale observation is refused `stale_revision`, never reinterpreted, and so is a retry that
  reuses an observation the first call consumed. Every write's description ends with the same
  sentence (`WRITE_REREAD_RULE`): after any refusal or unknown outcome, re-read with `get_service`
  before retrying.
- **Annotations and schema.** `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false,
  openWorldHint: false }` (I14) — a hint, not a guarantee: claude.ai is expected to ask before
  running a destructive tool, unless the user has chosen «Always allow» for that tool. Step 14's
  PP0/L1 was meant to record that prompt on the live connector; the
  [P3 release record](#release-record-p3-2026-09-28) says what was and was not observed. The strict
  input schemas (I13) carry the writer's own bounds: `isCanonicalDocumentId`, `isRevisionString`,
  at most 60 rows, a key of at most 24 characters, at most 2 leaders. So `tools/list` advertises
  them up front, and the SDK refuses a violation before the handler runs (see
  [Known behaviours](#known-behaviours)). Each tool also re-checks the same shapes itself, in
  Spanish, for a direct call.
- **Honest outcomes (I9), from one runner** (`runWriteTool`, `app/mcp/writes/runWriteTool.ts`):
  - A **refusal** is `isError: true`, a Spanish text, and
    `structuredContent: { refused: true, code, detail?, services?, issues? }`. `code` is the
    route's own error code (`ServiceErrorCode`); a gate the tool mirrors uses the closest code in
    that vocabulary, and `detail` names the gate. Every refusal text ends «No se escribió nada.»,
    with three exceptions: `bootstrap_completed_reload`, where the legacy-lock maintenance write
    DID land (the caller's own change did not, and the text says so); `bootstrap_outcome_unknown`,
    where whether that maintenance write landed is itself unknown (the text says that, not that it
    landed); and a code the tool does not know, which it reports as an unknown outcome.
  - A **throw before the domain was called**: «No se pudo preparar el cambio; vuelve a intentarlo.
    No se escribió nada.»
  - A **throw at or after the domain call** is an unknown outcome, never "not saved": «No se pudo
    confirmar si el cambio se guardó. Antes de reintentar, vuelve a leer el servicio con
    get_service.»
  - A read made only to **build the report** of a committed write (names, the read-back, the repeat
    hint) that fails degrades that one field. It never turns the committed write into an unknown
    outcome.
- **Notifications are reported as queued, never as delivered.** Each entry of `notifications[]`
  carries:
  - `channel` (`push`, `email` or `outbox_email`), `title`, `status` (`"encolada"` or
    `"no encolada"`) and `when`;
  - `audience`: `{ memberId, name }` per member, flagged `missing` or `unresolved`;
  - `conditions`: the downstream filters that still apply (device tokens and the push preference,
    `EMAIL_ALLOWLIST`, `wantsNotification`, `EMAIL_REDIRECT_TO`);
  - `summary`: one Spanish sentence.

  The list is built from the descriptors the side-effect helpers return, never re-derived (see
  [NOTIFICATIONS.md](NOTIFICATIONS.md#the-mcp-write-tools--the-same-writers)). An empty audience
  is «nadie»; a helper that failed or skipped is «no encolada», with a note. When a write queues an
  outbox notice, `sweepNote` says that the layer-2 sweep also ran and may have delivered OTHER
  notices that were already due, exactly as the same `/admin` write does. The full table is in
  [Notification audiences](#notification-audiences-the-write-tools).

#### `edit_setlist`

Replaces ONE service's setlist with the rows sent, in that order, as the setlist editor saves it.

- **Input:** `{ serviceId, roleRev, observed, rows }`. `roleRev` is `observations.roleRev` and
  `observed` is `observations.setlist`, verbatim. `rows` holds at most 60 entries, each one of:
  - a **stored** row, `{ rowKey, key?, medleyTag?, leads? }`, named by its `_key` from
    `observations.setlist.rowKeys`;
  - a **new** row, `{ songId, key?, medleyTag?, leads? }`, naming a catalogue song from
    `search_songs`.
- **What a row means:**
  - A stored row keeps its key, medley link and leaders unless it sends them (E6): `null` clears
    `key` or `medleyTag`, and `leads: []` clears the leaders. A new row starts empty. A stored row
    that is not sent is removed.
  - A `rowKey` sent twice, or one the observation does not have, is refused, never guessed.
  - `key` is at most 24 characters.
  - A new row naming a song that is already in the resulting setlist is refused («Ya está», E3).
    Two stored rows that already name one song (a Studio duplicate) are carried as they are.
  - A medley links adjacent rows only (E5). The runs are re-derived on a removal, a reorder, an
    insert anywhere but the tail, or any explicit `medleyTag`, exactly as the editor re-derives
    them. An explicit link that cannot stay adjacent is refused, never dropped.
  - Only a «Noche de alabanza» carries leaders: 1 or 2 per song, from its Lead. On any other
    service, explicit non-empty `leads` refuse the whole edit in the tool's own words («Solo una
    Noche de alabanza lleva líderes por canción…», F6), and `leads: []` is a no-op.
- **Checks, in order.** Each refusal writes nothing.
  1. Before any read: the schema; an `observed` in `ambiguous`, `draft_overlay`, `invalid` or
     `unknown` (only `none` and `single` are writable); `rowKeys` holding a null or a repeat (E1).
  2. The role must be one canonical service, still at `roleRev`.
  3. The stored rows come from the writer's own loader.
  4. The observation must still be exactly current (the writer's own `compareObservedTarget`), and
     then row for row.
  5. The stored content must be valid (E1, the editor's own `setlistContentState`).
  6. Every new `songId` must be a published song (E4).
  7. The row translation (E3, E5, E6, E-key, F6).
  8. On a worship night only, every leader must be a canonical member (E7).
- **The call** is the editor's own body, `{ week, type, roleId? (specials only), observed, songs }`,
  through `saveSetlist`.
- **Payload on success:** `{ ok, serviceId, kind, date, name?, published, created, setlist,
  notifications, notificationNote?, sweepNote?, repeatedSongs? }`, plus the fresh observation
  below.
  - `setlist` is `{ rows, runs }` in `get_service`'s shape: **what was written**.
  - `notificationNote` explains an empty list: «ninguna (servicio en borrador)» or «ninguna
    (ningún servicio es dueño de esa semana)».
  - `repeatedSongs` (`{ songId, title, lastUsed }`) is the editor's 8-week repeat hint, omitted
    when its read fails.
- **The fresh observation (D8).** The tool re-reads the service and its setlist, then returns
  exactly one of:
  - `observations: { roleRev, setlist }`: the read-back is exactly what was written. Pass it to
    the next write as it is.
  - `changedAgainAfterSave: true` with `current: { published?, setlist }`: something changed after
    the save, and no observation is returned. `setlist` is what was written; `current.setlist` is
    what is there now. A `single` setlist with no `songs` array reads as the empty setlist, as in
    `get_service`. `current.setlist` is `null` only when the post-save read-back of the target
    itself fails (the re-read throws); a `none` read-back — reachable only through a concurrent
    delete right after the save — reports the empty list `{ rows: [], runs: [] }` instead, where
    `get_service` would report `null` for the same `none` state (an accepted asymmetry).
  - `observations: null`: the read-back failed. Re-read with `get_service`.
- **Revalidates** `/`, `/schedule` and the song pages (`revalidateSetlistSave`).

The refusals that are the tool's own (every other one is the route's):

| `detail` | `code` | When |
|---|---|---|
| `observed_draft_overlay`, `observed_invalid` | `integrity_conflict` | `observed` is a state nothing writes to |
| `observed_ambiguous` | `ambiguous_target` | the same |
| `observed_unknown` | `invalid_request` | the same |
| `invalid_content` | `integrity_conflict` | a stored row with no `_key`, a repeated `_key`, or a song that does not resolve (E1) |
| `role_revision`, `row_keys_mismatch` | `stale_revision` | the role or the stored rows moved since the read |
| `unknown_song` | `invalid_request` | a new `songId` that is not a published song (E4) |
| `unknown_row_key`, `duplicate_row_key`, `duplicate_song`, `key_too_long`, `stored_key_too_long`, `medley_not_adjacent` | `invalid_request` | the row translation (E3, E5, E-key) |
| `lead_not_member` | `invalid_request` | a worship-night leader with no member document (E7) |
| `song_lookup_failed` | `integrity_conflict` | the song check itself could not be read |
| `date` | `integrity_conflict` | the role has no valid stored date |
| `invalid_input` | `invalid_request` | an argument the schema refuses, when the handler runs it. A registered call is refused by the SDK first; see [Known behaviours](#known-behaviours) |

#### `swap_assignment`

Swaps a whole section, or the whole team, between two services, as the stored planner does.

- **Input:** `{ kind: "section" | "team", path?, services: [{ serviceId, rev }, { serviceId, rev }] }`,
  one strict object. A section needs `path` (`Lead`, `BGVs`, `Chorus`, `instruments` or
  `foh_team`). A team takes none and swaps all five. There is no seat-level swap (S7): the schema
  cannot express one.
- **Admission.** Before the domain, the tool admits the pair as the planner would, from the same
  readiness the reads assemble. A refused admission writes nothing. The gates, in the order they
  run:

  | Gate | `code` / `detail` |
  |---|---|
  | S4: the `roles`, `members` and `roleTargets` reads succeeded | `integrity_conflict` / `sources:<keys>` |
  | the service exists | `not_found`, in the route's 404 wording |
  | the record is valid | `integrity_conflict` / `invalid_record` |
  | S2a: one weekend role at its target | `ambiguous_target` / `duplicate_weekend_target` |
  | S2c: no Studio draft at the target | `integrity_conflict` / `raw_draft` |
  | the service resolves to a single document (any other target status) | `integrity_conflict` / `role_target_<status>` |
  | S2d: no seat names a member who is gone | `integrity_conflict` / `dangling_assignment` |
  | S2g: the weekend coordination lock is sound | `integrity_conflict` / `lock:<kind>`, e.g. `lock:missing_lock` |
  | S2f: a special has a name | `integrity_conflict` / `invalid_special_name` |
  | the service has a valid stored date | `integrity_conflict` / `date` |
  | S1: both services in one `YYYY-MM` | `invalid_request` / `cross_month` |
  | S2a/S2b/S2c again, from the occupancy reads (S2b: no other special with that date and name) | `ambiguous_target` / `duplicate_special_identity`, and the codes above |

  A missing lock is refused here, so the route's maintenance bootstrap never runs from the tool.
  **There is no past-month refusal.** `/admin` can open a past month («Roles previos» → «Editar
  mes»), and the planner's swap gate never reads the date (ruling P3-R21). The tool swaps two
  services of the same month that the planner would let it swap.
- **The call** is the route's own body, `{ kind, path?, roles: [{ id, rev }, { id, rev }] }`,
  through `swapRoles`. So every counterpart refusal comes back with the route's code: the team or
  section topology, a hidden Saturday Chorus, the same service twice, a stale rev, a lock owned by
  another role, a vacant lock, a moved person who is gone.
- **Payload on success:** `{ ok, kind, path?, services, notifications, sweepNote?,
  songLeadsOrphaned, unavailablePlaced, freshRevs }`.
  - `services[i]` is `{ serviceId, date, name?, published, moved }`. `moved` maps each path that
    changed to `{ before, after }`, with names.
  - `songLeadsOrphaned` is reported, never refused. On a «Noche de alabanza» it lists the songs
    whose named leaders left Lead; the next setlist save is refused until they are fixed.
  - `unavailablePlaced` lists members newly placed on a day they marked unavailable. It is `null`
    when the member read failed.
  - `freshRevs` (D8) gives each service's new `rev` when its read-back equals the written state
    across the whole role except `_rev`. Otherwise that entry is
    `{ serviceId, changedAgainAfterSave: true, current }`. It is `null` when the read-back failed.
    A swap moves both revisions, so the next write takes `freshRevs` or re-reads.
- **Revalidates** `/`, `/schedule`, the song pages and `/me` (`revalidateRoleMutation`).

#### `publish_service`

Publishes ONE service, exactly as «Publicar» does in `ready` mode.

- **Input:** `{ serviceId, rev }`. There is no `mode` and no `acknowledgedBlockers`, so an override
  or a recovery cannot be expressed. A workflow blocker can be overridden only in `/admin`; a hard
  one, nowhere.
- **The verdict is the reads' verdict (I4).** The writer reloads every read domain and decides with
  `publishVerdict`, the predicate behind `get_service`'s `readiness.publishCheck`. A service that
  `get_service` reports as not passing is refused for the same reasons. The one stage a read cannot
  see is the writer's later guard-bundle assertion (ADR-0040's amendment).
- **Refusals** name every blocker in Spanish, read from `details.services[].reasons`, plus one note
  on where an override lives. An already published service is refused «Ya está publicado.». So is
  a retry after a successful publish, because the revision moved.
- **Payload on success:** `{ ok, serviceId, published: "published", notifications, sweepNote? }`.
- **Revalidates** `/`, `/schedule` and `/me` (`revalidateRolePublication`).

#### `unpublish_service`

Hides ONE published service (`published: false`), exactly as «Ocultar» does.

- **Input:** `{ serviceId, rev }`. The tool makes no admission read of its own. Hiding is a
  separate safety action, meant to work precisely when a service's data is incomplete or in
  conflict, so it uses no publish readiness and accepts no acknowledgements.
- **Payload on success:** `{ ok, serviceId, changed, published: "draft", notifications: [] }`.
  `changed: false` is `/admin`'s own `200 unpublished: 0` no-op: the service already was a draft at
  that `rev`. It is worded «Ya estaba oculto…», never as a success.
- **Notifies nobody and runs no outbox sweep** (see [Known behaviours](#known-behaviours)).
- **Revalidates** `/`, `/schedule` and `/me` when it hid something.

### Notification audiences (the write tools)

Confirmed from the code at `963cd736` (P3 plan, § «Notification audiences»):

| Tool / path | Immediate | Queued in the outbox | Never |
|---|---|---|---|
| `edit_setlist`, draft or role-less week | — | — | push, email |
| `edit_setlist`, published | push «Setlist de la semana» to worship members whose setlist preference is `all`, plus members assigned to any **published** service that week (`notifySetlistSaved`, fire-and-forget, listed from its descriptor) | a `setlist` notice to the service's participants, if it has songs, after the debounce window; recipients are resolved at flush with `published != false` | — |
| `swap_assignment`, per published role | push «Servicio actualizado» to the members **added** to that role | a `role` notice to the union of before and after assignees, after the window | anything for a draft role |
| `publish_service` | push «Nuevo servicio asignado» to every current assignee; the consolidated assignment email to the members `sendAssignmentEmailsBatch` itself derives from the service body (`assigneesOf` + `rolesForMember`), reported as that derivation | «Setlist listo» (`debounceMs: 0`) to the participants if there are songs, flushed in the same `after()` | — |
| `unpublish_service` | — | — | everything; there is no sweep |

All of these pass the downstream filters: device tokens and push preferences, `EMAIL_ALLOWLIST`,
and `wantsNotification`. Any outbox upsert also triggers the derated layer-2 sweep, which can
deliver **other** notices that were already due to their own recipients, exactly as the same
`/admin` write does. The tools report all of it as queued (I9).

### Admin-surface gates (I15)

I15 says every write refuses at least what its admin counterpart refuses. The counterpart is the
**admin surface**: the screen, the read contract that screen opens from, and the route it posts
to. The route half holds by construction (one code path, above). The client half is this table:
every gate the editor, the planner or the Servicios panel enforces, with one disposition each.

- **mirror**: the tool refuses it itself, before the domain call.
- **mirror (behaviour)**: the editor produces a result, and the tool reproduces that result.
- **structural**: the tool's input cannot express the case.
- **inherited**: the route refuses it too, with the route's code.
- **declared narrowing**: the tool does not refuse it, and the row says why that is harmless.

This is the condensed form (gate → disposition). The full table, with the code evidence and the
test that pins each row, is § «Admin surface gates» of
[the P3 plan](superpowers/plans/2026-09-25-owt-mcp-p3-writes.md).

**`edit_setlist`**: the setlist editor and its read contract, against `PUT /api/admin/setlists`.

| # | Gate | Disposition |
|---|---|---|
| E1 | The editor will not open a `single` setlist whose stored rows are malformed (no `_key`, a repeated `_key`, a song that does not resolve) | **mirror**. A reference to an existing document that is not a song is refused here but opens in `/admin`: a declared narrowing, harmless, because that row is already broken for members |
| E2 | The editor opens only from a service card, so it never targets a date or type with no role | **structural**: the tool takes a `serviceId` and derives kind and week from its role |
| E3 | No duplicate song («Ya está») | **mirror** for new rows. Studio duplicates among stored rows are carried, as the editor carries them |
| E4 | Catalogue songs only | **mirror**: every new `songId` must be a published song |
| E5 | Medley canonicalisation | **mirror (behaviour)**: the editor's own triggers, and a link that normalization would erase is refused |
| E6 | Full-replacement round trip | **mirror (behaviour)**: an attribute a stored row does not send is kept |
| E7 | Leaders come from the resolved Lead roster | **mirror**, on a worship night. Elsewhere F6 refuses any leader, whoever it names |
| E8 | Source gate | **declared narrowing** (harmless): the tool reads the writer's own targets and never writes on a failed read |
| E-server | The route's own refusals (a draft overlay, a stale or missing observation, leaders on a service that is not a worship night, a leader not in Lead, more than two leaders, more than 60 songs, …) | **inherited**. The non-worship-night leaders case carries the tool's own words (F6) |
| E-key | A `play_key` over 24 characters is blanked silently by the writer | **mirror**: the schema, and then the writer's own parser, refuse it before it is sent. A stored key that long is refused unless the row sends `key` |
| E-hint | The repeat-song badge (advisory) | **mirror (behaviour)**: `repeatedSongs` |
| E-repair | Two corruptions only Studio can write, which `/admin` refuses with a 400 when it saves them back: a stored row naming one leader twice, and a stored `play_key` or `medley_tag` that is not a string | **declared narrowing: a repair, not a refusal** (ruling P3-R24). The duplicate leader is de-duplicated (`songItemLeadIds`) and the non-string value is dropped. The repaired document is valid |

**`swap_assignment`**: the stored planner in `MonthGenerator`, against `POST /api/admin/roles/swap`.

| # | Gate | Disposition |
|---|---|---|
| S1 | Same month: the planner swaps only services of the month it has open | **mirror**: both stored dates share `YYYY-MM`. A past month is allowed, since `/admin` opens past months too (ruling P3-R21) |
| S2a | One weekend role at its target (`duplicate_weekend_target`) | **mirror** |
| S2b | No other special on that date with the same name | **mirror** |
| S2c | No Studio draft at the target, of this id or another | **mirror** |
| S2d | No dangling reference anywhere on the role | **mirror**. The planner's two-load mismatch is **structural**: the tool reads one snapshot |
| S2e | A Saturday with stored Chorus is read-only | **inherited** |
| S2f | Structural record checks | **mirror** for a blank special name; **declared narrowing** for the rest (a swap writes none of those fields) |
| S2g | A legacy weekend role with no lock, or any other lock problem, is read-only | **mirror**: refused before the route's maintenance bootstrap, so the refusal writes nothing |
| S3 | Whole-inventory coherence | **declared narrowing** (harmless): the route asserts both revisions and every owned lock in one transaction |
| S4 | Source and rules gates | **mirror** (sources) / **declared narrowing** (rules: a swap applies no solver rule) |
| S5 | Local-work, lock and verification gates | **declared narrowing**: the connector holds no local state, and an unknown outcome says re-read, never repeat |
| S6 | Intent freeze and post-swap verification | **declared narrowing**: `freshRevs` only when the read-back matches the written state |
| S7 | No seat-level swap | **structural**: the schema has no `seat` shape |
| S-server | The route's own refusals (topology, Chorus with a Saturday, the same service twice, a stale rev, a wrong-owner, vacant or malformed lock, a raw draft of the role's own id, a non-role type) | **inherited** |
| S-lead | A Lead swap on a worship night leaves song leaders who are no longer in Lead | **mirror (behaviour)**: reported (`songLeadsOrphaned`), not refused |

**`publish_service`**: the Servicios panel, against `POST /api/admin/roles/publish-ready` in `ready`
mode.

| # | Gate | Disposition |
|---|---|---|
| P1 | The panel's `isReadyToPublish` double check | **inherited**: the same `publishVerdict` |
| P2 | The resubmit lock while an outcome is pending | **declared narrowing** (harmless): a retry is refused `stale_revision` |
| P3 | Visible scope: upcoming services unless a month filter is on | **declared narrowing** (harmless): a month filter reaches past services in `/admin` too |
| P4 | The confirmation dialog | **declared narrowing** (no data effect): claude.ai's approval prompt for a destructive tool is expected to play that role (a hint, not a guarantee — see Annotations and schema above; step 14/PP0-L1 confirms it live), unless the user chose «Always allow» |
| P-override | `mode: "override"` with acknowledged blockers | **structural**: the schema has no `mode` |

**`unpublish_service`**: the Servicios panel, against `POST /api/admin/roles/unpublish`.

| # | Gate | Disposition |
|---|---|---|
| U1 | «Ocultar» appears only on a published card | **declared narrowing** (harmless): the route answers `unpublished: 0`, and the tool reports «Ya estaba oculto», never success |
| U2 | One service per request | **structural**: one `serviceId` |
| U3 | Source gate: roles and role targets | **declared narrowing** (harmless): the route loads its own targets |
| U4 | The resubmit lock | **declared narrowing** (harmless), as P2 |
| U5 | The confirmation dialog | **declared narrowing** (no data effect), as P4 |

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
`ping`, not P1's or P3's registration. **`--reads`** adds a sub-step right after `ping` and before
refresh. Its OWN `tools/list` check (`checkToolList`) requires the full twelve tools, in order,
each with its own annotations: it is about to call the seven reads, and that listing is the ONLY
proof the four P3 writes get on dev — present, with `destructiveHint: true`. **So `--reads` passes
only against a deployment that carries P3** (dev has carried it since 2026-09-28; it passed there
10/10, see the [P3 release record](#release-record-p3-2026-09-28)); against one that carries only
P1 it fails at that check, by design. The sub-step makes one call each to `list_services`, `get_service` (selected BY ID from `list_services`'s own first
result, the same way `get_song` below uses `search_songs`'s — never `{}`, so it never hits its own
same-day-tie refusal; an empty month, with no service to select by id, falls back to `{}`, and if
THAT refuses on a tie the pass logs it as an EXPECTED pass, "ambiguous (expected)", not a failure),
`search_songs`, `get_song` (using the first song id `search_songs` found),
`get_member_availability`, `get_participation` and `list_proposals`, printing a PASS/FAIL line per
tool and a counts-only summary — never a name or any other personal data.

**The smoke never calls a write tool, in any mode (DV1)**: dev writes the production dataset, and
its mail redirect covers email only. This is enforced twice. STRUCTURALLY: `createMcpRequest`
returns the one function the script uses to send anything to `/api/mcp`, and before that function
ever calls `fetch` it refuses a `tools/call` naming a tool outside `ping` and the seven reads — a
write tool included, whatever built the request body. LEXICALLY: `scripts/__tests__/mcpDevSmoke.test.ts`
proves, over the comment-stripped source, that `toolCallRequest` is the only place in the script
that builds a `tools/call` at all — it fails if a second `tools/call` quoted literal, or a second
quoted literal of a write tool's name, appears anywhere in the script's code.

```bash
# Full dev smoke: discovery → registration → consent (opens the browser) → token →
# initialize/tools-list/ping → refresh → ping again → prints the grant id + revoke command.
node --env-file=.env.local scripts/mcp-dev-smoke.mjs

# Same, plus one call to each of the seven P1 read tools after ping, and a tools/list check that
# pins all twelve tools with their annotations (so the target must carry P3, as dev does) — see the Tools
# section above for what each one returns. It calls no write tool (DV1).
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
- **A malformed call gets the SDK's own validation text, which starts in English** — for every
  tool, the writes included. Once a tool is registered, `@modelcontextprotocol/server` validates
  its input schema BEFORE the handler runs. The answer is `isError: true`, no `structuredContent`,
  and the text `Input validation error: Invalid arguments for tool <name>: <path>: <message>`. The
  prefix is the SDK's. Each `<message>` is the schema's own: the tool's Spanish message where the
  schema defines one (an id, a rev, a key over 24 characters, the leaders, the swap's pairing and
  count), and zod's English default otherwise (more than 60 rows, an unknown field). Nothing
  downstream runs: no read, no domain call, no write. `mcpRoute.test.ts` pins that once per write
  tool, through the real route (ruling P3-R24). The write tools' own Spanish shape refusals
  (`shapeRefusal`, the pre-phase checks) therefore answer only a direct call of the tool's function,
  which is what each tool's own test suite makes. The bounds stay in the SDK-facing schema on
  purpose: `tools/list` advertises them (`maxItems`, `maxLength`) to the client before it calls.
  Accepted as-is — Claude reads the error, not Frank, and translating an upstream library's
  internal message is not worth the maintenance cost.
- **`subscriptions/listen` gets a JSON-RPC error (`-32603`), never a held stream.** The handler is
  built with `maxSubscriptions: 0` deliberately (see `app/api/mcp/route.ts`'s header comment) — a
  kept-open SSE stream would mean a revocation or a role demotion could not bite within the
  30-second cache window, and would keep a serverless function invocation alive for no reason.
  **Not observed to be invoked during the step-13 live acceptance** (2026-09-24) — whether
  claude.ai's iOS app called `subscriptions/listen` was not directly confirmed; what was observed
  is that the authorization and `ping` flow completed with no visible effect from this refusal.
- **Every tool call that reaches its handler logs one `[mcp]` timing line, and that is the only duration there is.**
  Vercel's runtime logs on this plan carry no request duration (observed 2026-09-25: no duration
  field from the logs API or from `vercel logs --json`, and the Observability API answers 404 on
  Hobby). So `runReadTool` (`app/mcp/reads/errors.ts`) and the write runner `runWriteTool`
  (`app/mcp/writes/runWriteTool.ts`) each log exactly one line per call, from `finally`, through
  `app/mcp/toolTiming.ts`:
  `[mcp] tool=<name> outcome=<ok|refused|error> code=<code|-> ms=<n>`. `code` is a refusal's
  machine code (`stale_revision`, `not_found`, …) and `-` otherwise; a read logs `-`. The line
  never carries an argument, an id, a member or service name, a payload or an error message.
  Read it with `vercel logs <deployment> --json`: each record's `logs[].message` holds it. It is
  how the P1 latency figure and P3's live-proof durations are measured. It goes to
  `console.info`. Two kinds of call log nothing:
  - `ping`, which does not run through `runReadTool`;
  - a call the SDK refuses on its input schema (a strict-schema or bound violation). That call never reaches `runReadTool` or `runWriteTool`, so it is missing from the durations.
- **`/api/mcp` reaches outbound delivery transitively, and is deliberately NOT wrapped in
  `withVerificationRunContext`** (P3 plan D15; ADR-0043). The SR-verification coverage scan in
  `srVerificationRunContext.test.ts` marks a route delivery-capable only when the route's OWN
  source names a delivery-capable module, and follows no import. `/api/mcp` names none: its reach
  is route → the tool modules → the `*Commit` domain modules → the side-effect helpers (push,
  email, the outbox). An exception entry for it would never be exercised and would read as
  coverage that does not exist, so there is none. The route stays unwrapped because an MCP call
  is bearer-authenticated for one super-admin and is never an SR-verification run. Consequence:
  **an MCP write's delivery evidence carries no run markers** — an evidence gap, not a safety
  hole (blocking never depends on a context; `app/utils/srVerificationRunContext.ts`). What is
  pinned is the property the scan can see: `app/api/__tests__/mcpRoute.test.ts` fails if the
  route's comment-stripped source ever names a delivery-capable module or uses the wrapper, so
  that change has to come with a wrapper decision.
- **`/api/mcp` finishes every tool call inside the handler, so a legacy-era client gets its events
  all at once** (the transport gate; P3 finding F2, ADR-0043). The SDK answers a 2025-06-18
  `tools/call` with an SSE stream while the tool is still running, and so does the 2026-07-28 era
  once a tool sends a notification mid-call. Next drops a `revalidatePath` or an `after()`
  registered after the handler has returned, which for a write would mean a committed change with
  stale pages and lost notices. So `handle()` reads every SSE response to its end before returning
  it (`app/mcp/transport/completeResponse.ts`). The cost: **buffering removes the early SSE bytes
  a legacy-era client used to receive before the result** — keep-alive comments and progress
  notifications now arrive together with the result, when the tool has finished. A call's ceiling
  is the route's 60 s `maxDuration`. `app/api/__tests__/mcpToolCompletion.test.ts` is the guard,
  in both eras.
- **A client that disconnects does not cancel the call.** The request handed to the SDK is detached
  from the client's abort signal (`signal: null` in `forwardedRequest`). So a tool runs to
  completion inside the 60 s ceiling and its response goes to a closed socket: a write's commit is
  never cut off from its revalidation or its notices. The rule for tool code: never check an abort
  signal (`ctx.mcpReq.signal`) between a Sanity commit and its revalidate/`after()`. The trade-off:
  a long read that a client abandons still runs to the end.
- **`unpublish_service` notifies nobody and runs no outbox sweep** — the same as `/admin`'s
  «Ocultar», whose writer (`roleUnpublishCommit.ts`) queues nothing after its commit. The spec's
  `unpublish_service` row says the admin unpublish sweeps after responding. It does not (P3 finding
  F1); the P3 plan proposes that spec erratum for Frank's discretion. A role notice still pending
  for the service is silenced when the next sweep classifies it against the hidden service
  (`classifyRole`, `app/utils/outboxClassify.ts`).
- **Not observed:** the consent page's streaming quirks above (`notFound()` arriving as a 200,
  an error redirect delivered in-stream) were not exercised by the step-13 happy path — Frank's
  phone never hit a foreign host or a refused request. Treat those two bullets as a design
  description, not a production-verified behavior, until an actual refusal is exercised there.

---

## P3 live-proof runbook (step 14, executed 2026-09-28)

**Status: executed 2026-09-28 (11:53–13:35) and passed.** No stop condition tripped. The results,
step by step, are in the [P3 release record](#release-record-p3-2026-09-28); the text below is the
runbook as it was run and stays as the procedure for any later live proof of a write tool. This is
the proof, on production, that each write tool makes the same document diff and sends the same
notifications as `/admin` (roadmap acceptance). It is condensed from step 14 of
[the P3 plan](superpowers/plans/2026-09-25-owt-mcp-p3-writes.md), which has the full evidence.
**One PP0 condition could not be met, and the run went on under ruling P3-R27 rather than skipping
it:** production has no registered push device, so «with no push device, stop» would have ended the
run. The ruling made email the delivery proof, and push is verified as the tool's reported
audience only. The debounce window was taken as 5 minutes from `SECRETS.md` rather than confirmed
by Frank; the run bore it out (a swap at 11:57 was flushed at 12:05).

Every write below is made through the claude.ai connector on Frank's explicit instruction at that
moment, or by Frank in `/admin`. **The agent does not go past a parking point (PP) without Frank.**
Only throwaway specials are used:
- every Sunday and Saturday date is a real target the team plans against;
- a weekend setlist, once created, would stop `/admin` from deleting the throwaway.

So the weekend create/patch and lock-heartbeat paths are proven by `edit_setlist`'s twin-run tests,
not live. The [release record](#release-record-p3-2026-09-28) says so.

**Before any write:**
- **PP0.**
  - Frank confirms a working push device, email preferences for assignments and setlist that are
    not `off`, and his place in `EMAIL_ALLOWLIST` (default `*`).
  - He confirms the production debounce window. The code default is 15 minutes; `docs/SECRETS.md`
    records `NOTIFY_DEBOUNCE_MINUTES=5` on Production since 2026-09-10.
  - `vercel env pull` is never run: it would write every production secret to disk.
  - With no push device, stop: delivery cannot be proven.
  - **On L1, the first write of the run**, Frank records whether claude.ai asked him to confirm
    before running it. `destructiveHint: true` is a hint, not a guarantee (see «Write tools» →
    Annotations and schema, above): if he had chosen «Always allow» for the tool earlier, no prompt
    is expected, and that is a pass too. This is the one place this whole document treats the
    prompt as observed rather than assumed.
- **PP1.** Frank creates, in `/admin`, two **draft** specials on weekdays at least two weeks out,
  after the next real service, **in the same calendar month** (the swap refuses a cross-month pair):
  - **A**, «PRUEBA MCP A — ignorar», with Frank alone in Lead;
  - **B**, «PRUEBA MCP B — ignorar», with no team and no setlist.

  `get_service` on each must show `published: "draft"` and exactly those seats. Before every
  write, its expected audience is compared with those seats. Every write takes its observations
  from the latest `get_service`, or from the fresh observation the previous write returned.
- **PP2, before L3a.** `get_service` A must show `readiness.publishCheck.passesNow: true`. In
  particular, Frank has no unavailable date on A's day. If it is not `true`, stop and fix it in
  `/admin` first.

| Step | Action | Expected document diff | Expected notifications | Delivery check |
|---|---|---|---|---|
| L1 | `edit_setlist` A (`observed` is `none`): three distinct songs, **each with a `key`** (a blank key would make the setlist incomplete and L3a would be refused) | A's `songs` set, under A's `_rev` | none (a draft) | nothing for 10 min |
| L2 | `edit_setlist` A with L1's fresh observation: a reorder, one key change, two rows linked as a medley | new row keys; attributes carried; the medley run re-derived | none (a draft) | nothing |
| L3a | `publish_service` A, after PP2, with a `rev` read after L2 | `published: true` | push «Nuevo servicio asignado», assignment email and «Setlist listo», all to Frank | the push within 2 min; both emails within 5 min. If NOTHING has arrived by 5 min, stop at once: all three are made inside `after()`, so waiting cannot help |
| L3r | `publish_service` B (empty team, no songs) | none: zero writes | none | the tool refuses naming `team_empty` and `incomplete_setlist`, and offers no override (I4 shown live) |
| L3b | Frank publishes B in `/admin` with the override | B `published: true` | none (no assignees, no songs) | nothing new |
| L4 | `swap_assignment` section `Lead`, A↔B | A.Lead `[]`, B.Lead `[Frank]`; the keys travel | push «Servicio actualizado» to Frank (added to B); role emails for A and B to Frank, after the window | the push at once; **wait for both emails** before L5 |
| L5 | `swap_assignment` team, A↔B | the five seat fields exchanged: A gets `[Frank]` back | the push to Frank (added to A); the role emails | the push; wait for the emails |
| L5b | **`/admin` twin of L4**: Frank swaps section `Lead` between A and B in the stored planner | as L4, compared with L4's diff through `get_service` | as L4 | as L4; **wait for both emails** before L6a, because an unpublish before the flush silences a pending role notice |
| L6a | `unpublish_service` A, with a `rev` read after L5b | A `published: false` | none | nothing |
| L6b | Frank unpublishes B in `/admin` | B `published: false`; compared with A's (both only `published`) | none | nothing |
| L7 | `get_service` A first (every write since L2 moved A's `_rev`), then `edit_setlist` A with `rows: []` | A's `songs: []` | none (a draft) | nothing |
| L7b | **`/admin` twin of L1, L2 and L7**: Frank saves B's setlist three times in the editor — L1's songs and keys, then L2's changes, then no songs | each save changes only B's `songs`, row for row as the matching L-step changed A's (row `_key`s and medley tag values are fresh on both sides by design); the last leaves `songs: []`, which L8's delete needs | none: B is a draft, although Frank sits in its Lead | nothing for 10 min |
| L8 | Frank deletes A and B in `/admin` | both gone; leftover receipts and coordinators are inert | none (draft deletes are silent) | nothing |

**After each step,** Frank compares `/admin` with the tool's report, and the agent records three
things:
- the notifications the tool reported, against what arrived;
- the step's duration, from the `[mcp]` timing line in `vercel logs --json`;
- the fresh observation's rev, against `get_service`.

**Twin comparisons** (Frank's Q6 default): publish L3a vs L3b, unpublish L6a vs L6b, swap L4 vs
L5b, setlist edit L1/L2/L7 vs L7b. If Frank opts out of L5b and L7b, identity with `/admin` for
`swap_assignment` and `edit_setlist` rests on the twin-run tests, and the release record says so.
Frank did not opt out: L5b and L7b ran live in his browser on production `/admin`, and the record
holds their results.

**Stop conditions.** On any of these, stop, report, and decide with Frank. `MCP_DISABLED=1` is the
kill switch, and it needs a redeploy.
- any notification **about A or B** to anyone but Frank (a layer-2 flush may deliver an unrelated
  notice that was already due; that is expected);
- a reported audience that differs from what arrived, or from the table;
- a document diff that differs from the expected one;
- any `isError` on a call expected to succeed (L3r's refusal is expected);
- a write slower than 20 s end to end.

**Cleanup check.** `list_services` for the month no longer lists A or B, and no outbox notice for
either is left pending. After L8, a pending L4, L5 or L5b notice would at most email Frank «ya no
participas», which is acceptable because its audience is Frank alone.

**Rollback.** Remove the four tools, their registration lines and their caller-pin entries in
`serviceCommitCallers.test.ts` in one commit. The `*Commit` modules keep their protected-write
registry entries, so the audit stays green, and the behaviour-preserving authorization extraction
may stay (roadmap P3 row, amended). The emergency switch is `MCP_DISABLED` (see
[Kill switch](#kill-switch)); it takes effect on the next deployment.

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

**Acceptance — complete, 7/7.** Frank asked through his claude.ai connector, and each answer was
checked read-only against production. The first four asks (next service, the month's services, a
song, participation) were verified 2026-09-25 at about 09:55. The remaining three were verified
2026-09-28 at about 10:45:
- **availability**, next Sunday: exactly one worship member unavailable, the pattern correct;
- **song search**, by the theme tag `gracia`: 19 songs, and every title, key and tempo grouping the
  answer cited matched. A plain-text query fuzzy-matches titles, so the tag filter is the precise
  path; that is how the search works, not a defect;
- **proposal threads**: 0 open, 0 for October, and six September proposals all approved. Both
  threads compared matched message by message.

**Latency (checklist item 9).** The end-to-end time Frank reported from the connector, which includes
the model's own, was 3–10 s per call. The server-side figures, from the `[mcp]` timing line, are: `get_service` 348–718 ms,
`list_services` 389–403 ms, `search_songs` 666 ms. The tool's own share is therefore far below the
plan's 10 s stop condition.

---

## Release record (P3, 2026-09-28)

All times America/Mexico_City.

**Code on the branch.** P3 was implemented on `claude/mcp-p3-writes`, final `05d8c154` (tree
`41afe16b`). The final whole-branch code review returned READY TO RELEASE, with no Critical and no
Important finding. Its three minors (the timing-line scope, the refusal tables, the publish
wording) were fixed in `05d8c154` and re-verified, so the last review before the merge is a
verification, not a fix. The local `next start` spike behind the transport gate is recorded in
[ADR-0043](adr/0043-admin-writes-delegate-to-commit-modules.md). Gates on the released tree,
re-measured while writing this record: `tsc` 0 errors, vitest 412 files / 7500 tests, eslint 0
errors.

**Preview.** Merged into `preview` as `7353a8e0`, a tree identical to the reviewed one. Dev alias
verified — deployment `dpl_5SsX7AFH7Lpf7wTcZLreqYq3VTxf`.

**Dev smoke.** `node --env-file=.env.local scripts/mcp-dev-smoke.mjs --await-revocation --reads`
passed 10/10 at 10:49. That run included the `tools/list` check that pins all twelve tools with
their annotations. Reads 7/7: `list_services` (6 services), `get_service` (1), `search_songs` (20
songs), `get_song` (1), `get_member_availability` (36 members), `get_participation` (24 members /
6 services), `list_proposals` (6 proposals). The smoke calls no write tool, in any mode (DV1). Its
own dev grant was revoked afterward — a dry run, then `--apply` — and a `401 invalid_token` was
observed.

**Production.** PR [#106](https://github.com/FrankERP/owt-kb-v1/pull/106), `gates` passed in
12m22s, merged 10:50 (`main` `7c65f2eb`, tree `41afe16b`: the reviewed tree, and the one on
`preview`). Deployment `dpl_Cj4pEswB8fKtmrRuboHCjW16Kswo` — alias includes
`owt-backstage.vercel.app`, `githubCommitSha` `7c65f2eb`.

**Revocation policy for this release.** As for P1: the revoke-and-401 proof ran only on dev,
against the dev smoke's own grant. Frank's production connector grant was not revoked; it is the
grant the live proof below used.

**Live proof on production (step 14) — passed, 11:53–13:35.** Two throwaway specials, both created
by Frank in `/admin` and both deleted by him at the end: **A**, «PRUEBA MCP A — ignorar»
(2026-10-13, Frank alone in Lead) and **B**, «PRUEBA MCP B — ignorar» (2026-10-14, empty). The MCP
writes went through the claude.ai connector (the same OAuth grant), driven from Claude Code, on
Frank's explicit go. The `/admin` twin steps L6b and L7b were performed in Frank's own browser on
production `/admin`, with his permission; L3b, L5b and L8 were done by Frank himself. Durations
are server-side milliseconds from the `[mcp]` timing line.

| Step | Action | Result | ms |
|---|---|---|---|
| L1 | `edit_setlist` A (draft): three songs, each with a key | notifications none («ninguna (servicio en borrador)») | 1666 |
| L2 | `edit_setlist` A: a reorder, one key change, two rows linked as a medley | none; `get_service` matched the tool's report exactly (D8) | 1691 |
| L3a | `publish_service` A | reported audience Frank only: push «Nuevo servicio asignado», the assignment email, «Setlist listo» (immediate). The logs show 2 SMTP sends, `recipientCount` 1 each; Frank confirmed both emails arrived | 1528 |
| L3r | `publish_service` B (not ready) | refused, listing «el setlist está incompleto o falta; no hay equipo asignado», no override offered, «No se escribió nada.» (I4 shown live) | 402 |
| L3b | Frank publishes B in `/admin` with the override | B published | — |
| L4 | `swap_assignment` section `Lead`, A↔B | the seat key travelled, one shared rev on both roles; reported audience Frank only. The cron flush at 12:05 claimed 2 notices and sent 1 grouped email (one email per recipient, by design: `outboxSweep.ts`, step 6); Frank confirmed | not itemized |
| L5 | `swap_assignment` team, A↔B | the grouped email «Novedades de tus servicios» arrived 12:45 («Ya no participas — Miércoles 14 oct», «Nueva asignación — Martes 13 oct, Sirves como Líder»), Frank only | 2416 |
| L5b | **`/admin` twin of L4**: the stored planner's «Intercambiar sección», Lead, A↔B | the seat key travelled B→A, one shared rev: the same shape as L4. Its email was not awaited: swap delivery was already proven twice, and the `/admin` swap runs the same `roleSwapCommit` | — |
| L6a | `unpublish_service` A | published → draft; notifications none | 1245 |
| L6b | **`/admin` twin of L6a**: «Ocultar» on B | the same shape: only `published` changed | — |
| L7 | `edit_setlist` A with `rows: []` | songs `[]`; none | 1749 |
| L7b | **`/admin` twin of L1, L2 and L7**: the setlist editor on B, three saves | (1) equals L1 row for row; (2) equals L2 (same order and keys, medley run at positions 2–3); (3) songs `[]` equals L7. Only the opaque row `_key`s and the medley tag values differ, by design | — |
| L8 | Frank deletes A and B in `/admin` | cleanup check: `list_services` for October lists neither, `notificationOutbox` is empty, and no document references either | — |

- **A first L5b attempt does not count as the twin.** Swapping by seat edits and «Guardar» produced
  a new seat key and two separate revs, because that is the roles PATCH path, not the swap route.
  The twin is the «Intercambiar sección» run in the table.
- **Stop conditions: none tripped.** Every email in the window (L3a's publish-time sends, then the
  flushes at 12:05, 12:45, 13:00 and 13:15) had `recipientCount` 1, Frank. The write calls took 1.2–2.4 s server-side, against
  the 20 s limit.
- **Push delivery could not be proven, for any path (ruling P3-R27).** Production has 0 members with
  `deviceTokens`: web push was never built, and the native iOS app awaits Apple enrollment. A push
  from `/admin` and one from the MCP therefore reach nobody today. Push was verified only as the
  tool's reported audience; email is the delivery proof.
- **claude.ai's confirmation prompt was not recorded.** PP0/L1 asked Frank to note whether claude.ai
  asked him to confirm the first write. The writes were driven from Claude Code, each on Frank's
  explicit go, so this run does not say how the claude.ai app treats `destructiveHint: true`; it
  stays a hint, as the [Write tools](#write-tools-p3-released-2026-09-28) section says.
- **The weekend paths are proven by tests, not live.** The throwaways were specials only, as the
  plan requires (a real Sunday or Saturday is a target the team plans against). `edit_setlist`'s
  deterministic weekend create, its `ifRevisionId` patch and its lock heartbeat are covered by the
  twin-run tests, which run the same domain function over the same body on one store.
- **The live `/admin` twins ran.** Frank did not opt out (Q6): publish L3a/L3b, unpublish L6a/L6b,
  swap L4/L5b and setlist L1·L2·L7/L7b were all compared against a real `/admin` action.
- **The transport gate changed what a legacy-era client receives.** A 2025-06-18 `tools/call` now
  gets its whole SSE event stream at once, when the tool finishes; the early keep-alive and progress
  bytes are no longer streamed ahead of the result (see
  [Known behaviours](#known-behaviours)).
- **Observability follow-up (Minor, open).** For a publish refused as not ready, the timing line
  logs `code=stale_revision`, the publish writer's top-level 409 (plan F10), while the tool's text is
  built from the per-service reasons. Logging the per-service reason instead would make durations
  and outcomes easier to read. Nothing depends on it.

**Live state.** Both throwaways are gone and nothing about them is pending. The connector exposes
twelve tools on production. The kill switch and rollback are as the
[runbook](#p3-live-proof-runbook-step-14-executed-2026-09-28) records them.

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

The plan's step 9, the release, is the checklist below — every step is done: the release through
the production alias on 2026-09-25, and acceptance (items 8–9) on 2026-09-28. See the
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
8. ✅ **Acceptance from the claude.ai connector**, on production — complete 7/7. Frank asked for:
   - next Sunday's service;
   - this month's services;
   - a song;
   - this month's participation;
   - a song search;
   - availability for next Sunday;
   - a proposal thread.

   Each answer was compared with `/admin` (Servicios, Disponibilidad) and the song page. The first four
   (service, month, song, participation) were verified 2026-09-25 (about 09:55); the last three
   (song search, availability, proposal thread) on 2026-09-28 (about 10:45). Every answer
   matched `/admin` or the song page. See the
   [P1 release record](#release-record-p1-2026-09-25) for the detail.
9. ✅ **Observed latency** of `get_service` and `list_services` on production, recorded
   2026-09-28. The plan's stop condition is **10 s**. From the `[mcp]` timing line (server side):
   `get_service` 348–718 ms, `list_services` 389–403 ms (and `search_songs` 666 ms). On the connector, as Frank reported it,
   end to end and including the model's own time: 3–10 s per call. **The 870 ms real-data probe in
   the [release record](#release-record-p1-2026-09-25) above does NOT satisfy this item** — it was
   measured laptop→Sanity through direct calls, not through Vercel; these figures are the ones that
   do. The remedy for a genuine latency failure would have been a follow-up plan that narrows the
   load (a month-scoped snapshot plus a parity proof, plan A1/D3), never an ad hoc change; none is
   needed.
10. ✅ Updated this document's status banner, the [Tools](#tools) section's per-tool markers, and
    `docs/API_REFERENCE.md` / `docs/README.md` to say released, with the PR number and commit
    (this change).

**Rollback:** revert PR [#98](https://github.com/FrankERP/owt-kb-v1/pull/98), or set
`MCP_DISABLED` (see [Kill switch](#kill-switch) and
[SECRETS.md](SECRETS.md#mcp_disabled)) as the emergency switch — it shuts every MCP and OAuth
route (503, «No disponible»), but **takes effect on the next deployment**, not immediately, since
env vars bind at build time.
