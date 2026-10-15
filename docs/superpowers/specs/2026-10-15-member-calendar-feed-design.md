# Member calendar feed (.ics subscription) — design

**Date:** 2026-10-15 · **Risk tier: critical** (it opens a new unauthenticated route whose only
gate is a secret: an auth/security/secret boundary, CLAUDE.md §Review policy) · Review log:
[`2026-10-15-member-calendar-feed-design-review-log.md`](2026-10-15-member-calendar-feed-design-review-log.md)

## Original requirement

> Frank (2026-10-15): «Podemos mantener un calendario de suscripción para cada miembro que les vaya
> poniendo los servicios y algún indicador especial si les toca tocar? Me gustaría que tuviera el
> detalle de las canciones y el equipo que va en ese servicio»

Reading (stated to Frank, decision card open): every published worship service goes on the
calendar; the ones where the member holds a seat are marked (⭐ + their seat). A second URL variant
carries only the member's own services. Each event lists the songs (with key) and the whole team.

## What exists today

- `/me` downloads a one-shot `.ics` of the member's own upcoming services
  (`app/components/AddToCalendarButton.tsx`, events built at `app/(client)/me/page.tsx:362-370`,
  builder `app/utils/ics.ts` — all-day only, no line folding). It does not update: a re-plan never
  reaches the member's calendar. This design adds a **subscription** (the calendar app re-fetches
  the URL), and keeps the download.
- Weekend roles (`sunday_role`, `saturday_role`) have a date (`week`) and no time; only
  `special_role.time` (`"HH:mm"`, CDMX) exists (`sanity/schemas/specialRole.ts:61`).
- The roster, role assignments and published schedule are public by design (dataset `aclMode:
  public`; DEF-A-16 parent spec, non-goals). Names and seats in the feed expose nothing the public
  dataset does not already serve; the feed adds no email, no availability, no notes.

## Design

### D1 — URL and token

`GET /api/calendar/<memberId>/<generation>/<token>` (an optional trailing `.ics` on `<token>` is
accepted and stripped; Apple and Google don't need it but some clients like it). Query
`?solo=mios` selects the member's own services only; absent = all services. The variant is not part
of the signature: both variants reveal the same member's view, so a holder of one URL learns
nothing new from the other.

```
token = base64url( HMAC-SHA256( CALENDAR_FEED_SECRET,
                                 "owt-calendar-feed:v1\n" + memberId + "\n" + generation ) )
```

**The generation travels in the URL** so the signature is verified with ZERO I/O before anything
else happens. A forged or junk request costs one HMAC and no Sanity request: the route never reads
the dataset (nor fills any server-side cache) for a caller who does not hold a valid signature.
This matters because the dataset is on the Free plan and shared with the production app — an
anonymous route whose Sanity cost scales with junk traffic could spend the whole app's quota.
`<generation>` must be a canonical non-negative decimal integer (`0` or `[1-9][0-9]{0,8}`);
anything else is refused before the HMAC.

- 43 characters, 256 bits. Verified with `crypto.timingSafeEqual` on equal-length buffers (a length
  mismatch is a plain refusal, never a throw that becomes a 500).
- **Nothing secret is stored in Sanity.** The dataset is public and DEF-A-16 is moving secrets out
  of it, so storing a random token per member (alternative A) would need a dotted private document
  that every reader must read with a mandatory token; the HMAC lets the server recompute the URL any
  time from a public member id, the secret (Vercel only) and a non-secret counter.
- **Why a dedicated secret, not `NEXTAUTH_SECRET` (alternative B):** rotating the calendar secret
  after a leak must not sign the whole team out, and rotating the session secret must not silently
  kill every subscribed calendar. Same reasoning as `MCP_OAUTH_SECRET` (`docs/SECRETS.md`).
  Generated separately per environment like `MCP_OAUTH_SECRET`; minimum 32 bytes.
- **Missing or short secret → 503 for every request, before any Sanity read** (fail closed).

### D2 — Per-member revocation: the generation counter

`generation` (integer, absent = 0) lives in one document per member, `_id` =
`calendarFeed.<memberId>`, `_type` = `calendarFeed`, fields `member` (weak reference), `generation`
(number), `rotatedAt` (datetime). Dotted, so an untokened read never serves it.

- **Rotate** (`POST /api/me/calendar-feed`): session-guarded with `requireActiveSession`, refused
  (403) while impersonating — a super-admin must not reset a member's link by accident. One
  transaction: `createIfNotExists({ _id, _type, member, generation: 0 })` then
  `patch(_id).inc({ generation: 1 }).set({ rotatedAt })`. `inc` is atomic in Content Lake, so two
  concurrent rotations both advance the counter and neither old URL survives. Returns the new URLs,
  signed with the generation the committing transaction itself returned (`returnDocuments`, highest
  value for that id) — not a follow-up read, which could lag a concurrent rotation.
- **Reading the generation fails closed:** a token-less read of a dotted id answers «no document»
  with HTTP 200 (`fairnessLedgerRead.ts` exists for this reason). Read as 0, that would RESURRECT
  every revoked generation-0 URL. So the feed route and the settings page refuse (503 / panel
  unavailable) when `SANITY_API_READ_TOKEN` is absent or empty, before reading. A failed read
  (throw) is a 503, and a stored `generation` that is present but not a non-negative safe integer is
  a 503 too — never coerced to 0.
- **Why a dotted id even though `generation` is not secret:** an undotted id would remove the
  token-less failure mode, but it would publish, per member, whether and how often they reset their
  link, and it would put a new member-keyed document in the public dataset that DEF-A-16 is
  shrinking. The fail-closed token check is one line and has a precedent; the dotted id stays.
- The route checks the URL's generation against the stored one (equality): an older URL carries an
  older number and is refused; a URL with a number the server never issued fails the HMAC anyway.
- A rotation takes effect within the edge cache lifetime (D5: at most 15 minutes).
- Member deletion: the weak reference does not block `DELETE`; an orphaned `calendarFeed` doc is
  harmless (the feed route requires a live, active member first). Not deleted by the member DELETE
  in this change.

### D3 — Who gets a feed

Order (the contract): secret present → read token present → shapes (`memberId` non-empty,
`generation` canonical, token 43 base64url chars) → **HMAC compare (no I/O)** → ONE tokened read
through `serverClient` returning both the member (`disabled`, `ministries`) and the stored
generation → member must exist, `disabled !== true`, `normalizeMinistries(ministries)` must include
`worship`, and the stored generation must equal the URL's → schedule read. Every refusal after the
configuration checks is the same 404. `getMemberAccess` is deliberately NOT used: its module-level
cache is keyed by the caller-supplied id and never evicted; even after the HMAC gate, the feed has no
use for a 30-second cache it would have to reason about. Kids-only members get no feed in this
change (kids schedules are a separate read with their own gating, ADR-0022) — named follow-up,
stated to Frank.

A disabled member's existing calendar stops at the next uncached fetch (404); re-enabling restores
the same URL (generation unchanged).

### D4 — Content

One read through `operationalClient` (published perspective, protected types — `protectedReadAudit`),
window **CDMX today − 60 days … today + 365 days** (past services stay visible for a while instead
of vanishing the day after), worship draft gating `published != false` on all three role types.
Weekend setlists joined by `week` and collapsed with `pickUnique` (never `[0]`), specials carry
`songs[]` inline — exactly the `/me` read model (`page.tsx:139-213`).

Per role document, one `VEVENT`:

- `UID`: `<roleDocId>@owt-backstage` — stable across re-plans of the same document, so an edited
  service updates in place instead of duplicating.
- `SUMMARY`: the service label — «Domingo», «Sábado», or the special's `service_name`
  (fallback «Servicio especial»), plus «· Oasis Worship». When the member holds a seat:
  `⭐ <label> · <seatLabel(doc)>` (`app/utils/myWeek.ts:seatLabel`, the same wording as `/me`).
- **Time:** weekend roles store no time, so weekend services start at the team's standing times
  (`WEEKEND_SERVICE_TIME`: Saturday 18:00, Sunday 11:00 — change 10 below; they were all-day
  until then). A special with a valid `time` (`isServiceTime`) is a timed event:
  `DTSTART;TZID=America/Mexico_City:<YYYYMMDD>T<HHmm>00` with `DURATION:PT2H` and a `VTIMEZONE`
  block (fixed UTC−6, Mexico has had no DST since 2022). Pure string formatting — the time is never
  combined into a JS `Date` (CLAUDE.md invariant on special `time`); a special without a valid time
  is all-day.
- `DESCRIPTION`: «Tu lugar: …» (when seated), the songs (`1. Título — Tono: <play_key ?? key>`,
  medleys marked, worship-night song leads «dirige …»), or «Setlist pendiente» when none; then the
  team by section (Lead, BGVs, Coro, each instrument seat, each FOH seat — empty seats omitted), names
  as `alias || member_name`; then the app link (`<origin>/me`). No `team_notes`: they are free text
  written for the team in the app, and a calendar copy travels further (shared calendars, other
  devices) — a named follow-up if Frank wants them.
- A role document that paints nothing (no seat filled, no setlist — `paintsDayCard`) is skipped, as
  on `/me`.
- `?solo=mios`: only role documents where the member is in one of the five seat paths
  (`Lead[]._ref`, `BGVs[]._ref`, `Chorus[]._ref`, `instruments[].person._ref`,
  `foh_team[].person._ref` — the CLAUDE.md five-seat invariant). The seat test uses member **ids**,
  never names (`mySeats` in `agenda.ts` compares names; it is not reused here).

Calendar header: `X-WR-CALNAME` «Oasis Worship» / «Oasis Worship · mis servicios»,
`X-WR-TIMEZONE:America/Mexico_City`, `REFRESH-INTERVAL;VALUE=DURATION:PT3H` and
`X-PUBLISHED-TTL:PT3H` (Apple honours them; Google refreshes on its own schedule, typically every
several hours — stated to members in the panel copy).

### D5 — ICS correctness

`app/utils/ics.ts` gains: RFC 5545 line folding at 75 octets without splitting a UTF-8 sequence
(emoji in titles), escaping of `\`, `;`, `,`, CR/LF, timed events with `TZID`, `URL`, and the
calendar-level properties above. `buildICS`'s existing signature and all-day output stay
compatible for the download button. Response: `200`, `Content-Type: text/calendar; charset=utf-8`,
`Cache-Control: private, max-age=300`, `Vercel-CDN-Cache-Control: max-age=900` (the edge caches a
200 for 15 minutes keyed by the full secret URL; browsers and shared proxies still see `private`),
`Content-Disposition: inline; filename="owt.ics"`. Errors are plain-text bodies with no detail and
`Cache-Control: no-store`.

**Request budget.** A valid uncached fetch costs two Sanity API requests (the combined
member/generation read and the schedule read); junk costs none (D1). With the edge cache, each URL
costs at most 96 fetches a day however many devices share it; at PT3H a device asks 8 times a day.
Roughly 40 subscribers × 2 variants at most × 96 × 2 ≈ 15k requests/day worst case, typically far
less (Google refreshes every several hours). Measured after release (Sanity usage page) before
anyone tunes it.

### D6 — Middleware

`api/calendar(?:/|$)` joins the `proxy.ts` matcher exclusions, byte-identical in
`app/utils/routeMatcher.ts` with a rationale comment (calendar apps fetch without a session; the
handler checks its own HMAC). `routeMatcher.test.ts` gains the anchored-exclusion cases and the
reviewed-public-list entry. `POST /api/me/calendar-feed` stays gated.

### D7 — UI

`/me/ajustes` (`SettingsCard`) gains a «Calendario» block (a new client component
`CalendarFeedPanel`, presentational: receives the two URLs as strings from the Server Component —
ADR-0028: the page never calls a client value). It shows: «Agregar a Google Calendar»
(`https://calendar.google.com/calendar/r?cid=<webcal URL>`), «Agregar al iPhone / Mac»
(`webcal://…`), «Copiar enlace», the «solo mis servicios» variant, and «Generar un enlace nuevo»
behind a `CueDialog` confirmation (the old link stops working). Uses `Button`, `CueDialog`,
`useToast`; the rotate handler follows the client-mutation rule (try/catch/finally, `res.ok`,
loading flag reset, never success on failure). Copy also says that a member who already imported
the one-shot download will see each service twice until they delete the imported events (the
subscription's UIDs differ on purpose: a subscribed calendar and an imported one are separate
calendars in every client). On Preview (`VERCEL_ENV=preview`) the panel adds one line: dev is behind
Vercel Deployment Protection, so Google and Apple cannot subscribe to a dev link — only «Copiar
enlace» is useful there. Kids-only members, a missing secret or read token,
and impersonation show a one-line «no disponible» instead of URLs (impersonation: so a super-admin
never copies a member's private link).

The origin for the URLs (and the app link inside each event) is `canonicalOrigin(process.env)`
(`app/mcp/oauth/origin.ts` — pure, chosen by `VERCEL_ENV` only: production → the production
alias, preview → the dev alias, local → localhost; any other value → null → panel unavailable). Not
`appBaseUrl()` (`assignmentEmail.ts`), which on Preview falls back to the PRODUCTION host: a URL
minted on dev would point at production, where dev's separately generated secret does not verify
it. The feed route itself does not check `Host` — the per-environment secret already confines a
token to the environment that minted it.

### D8 — Studio governance and docs

- Schema `calendarFeed` (hidden, readOnly) and registration in `PROTECTED_STUDIO_TYPES` +
  `INTERNAL_STUDIO_TYPES` (machine state, never hand-edited), as `mcpOauthGrant`.
- `docs/SECRETS.md`: `CALENDAR_FEED_SECRET` — Vercel Production and Preview, generated separately
  (`openssl rand -hex 32`), local `.env.local` optional (feed answers 503 without it); not CI.
  Rotation = every calendar URL in that environment dies; members re-subscribe.
- An ADR: «the calendar feed is signed, not stored» (rejects A and B above).
- `docs/DATA_MODEL.md` (`calendarFeed`), `docs/ROUTES.md` / `docs/API_REFERENCE.md` (two routes),
  `docs/AUTH_AND_SECURITY.md` (the new public route and its gate).

## Requirements

| ID | Requirement | Test |
|---|---|---|
| CF1 | Valid token for an active worship member → 200 `text/calendar` with every published service in the window (all variant) or only the member's (`solo=mios`). | route test (in-memory Sanity) |
| CF2 | Wrong token, wrong-length token, non-canonical generation → 404 with **no Sanity request at all**; unknown/disabled/kids-only member or stale generation → the same 404 after the one combined read and before the schedule read. | route tests with a fetch spy |
| CF3 | No `CALENDAR_FEED_SECRET` (or < 32 bytes), or no `SANITY_API_READ_TOKEN` → 503 before any read; a throwing or malformed generation read → 503. | route tests |
| CF4 | Rotation bumps the generation atomically; the old URL 404s, the new one 200s; impersonating → 403; no session → 401. | route tests |
| CF5 | Seated services carry `⭐` + `seatLabel`, decided by member id across all five seat paths. | pure test |
| CF6 | Events: stable UID per role doc, weekends timed at Sáb 18:00 / Dom 11:00 (change 10), timed (TZID, PT2H) for specials with a valid time; songs with key, team by section, no `team_notes`. | pure tests |
| CF7 | ICS lines ≤ 75 octets, folded on UTF-8 boundaries, CRLF, escaped. | pure tests |
| CF8 | Middleware excludes exactly `/api/calendar` and below, anchored; `proxy.ts` byte-identical. | `routeMatcher.test.ts` |
| CF9 | Existing download button output unchanged. | existing tests + a pin |

## Verification beyond unit tests

1. **Parser check:** the feed body for a fixture with timed and all-day events, folded lines and an
   emoji is parsed by an independent iCalendar parser (Python `icalendar`, run once by the author)
   and the result recorded in the PR.
2. **Dev:** after the preview merge, fetch the dev feed with the Vercel bypass header
   (`x-vercel-protection-bypass: $SR_VERIFY_BYPASS_SECRET`, as `scripts/mcp-dev-smoke.mjs` does) —
   a valid URL answers 200 `text/calendar`, a tampered one 404, the rotated-away one 404. Run from
   Frank's machine (the secret lives there), or by Frank. Real calendar clients cannot reach dev.
3. **Production acceptance (after the release, Frank or the author):** subscribe one account in
   Google Calendar and one iPhone; confirm events appear with ⭐, songs and team, and that a
   rotation stops the old subscription. This is the first real-client check and is named in the PR.

## Rollback

Revert the commit. Feeds then 404 (gated by middleware → redirect); no data migration, the
`calendarFeed` docs are inert. Emergency kill without a deploy: remove `CALENDAR_FEED_SECRET` in
Vercel and redeploy → every feed answers 503.

## Out of scope / follow-ups

Kids schedule feed; a stored per-service weekend time (today a constant, change 10);
`team_notes` in the event; reminders (`VALARM` — Google ignores alarms in subscribed calendars).

## Accepted residuals

- The token travels in the URL path, so it appears in Vercel request logs and in the member's
  calendar provider (Google fetches the feed from its own servers). That is inherent to calendar
  subscriptions; the mitigations are per-member rotation (D2) and the environment kill switch.
- A leaked URL keeps working for up to 15 minutes after a rotation (edge cache, D5).
- A leaked URL exposes that member's view of the schedule — the same roster and assignments the
  public dataset already serves — until it is rotated.

## Post-approval changes (UN-REVIEWED — approval covers digest `30f68420…1b29` only)

Adopted from the approving rounds' non-blocking notes; see the review log.

1. **One URL spelling (D1/D5).** The `.ics` suffix is required, and the query must be empty or
   exactly `?solo=mios`; anything else is a 404 before the HMAC, with no I/O. Without it a URL holder
   could append junk to miss the edge cache at will.
2. **Edge cache 15 → 60 minutes (D5).** `Vercel-CDN-Cache-Control: max-age=3600`. Budget restated:
   at most 24 uncached fetches per URL per day, two Sanity requests each; worst case ~40 members ×
   2 variants × 24 × 2 ≈ 3.8k requests/day, typically much less. A rotation therefore takes effect
   within an hour, and a service change reaches a calendar within an hour plus the client's own
   refresh (Google: several hours anyway).
3. **Dev rotation reaches production.** The counter lives in the dataset `preview` and production
   share, so a rotation on dev revokes that member's production link too (the signature is
   per-environment; revocation is not). Rehearse rotation only as «Verificador (bot)»; the panel's
   Preview line says so.
4. **Kids-only members cannot rotate** (`POST` 403), matching the panel.
5. **CF9 wording.** The download's output is unchanged except that lines over 75 octets are now
   folded (RFC 5545-correct; previously they were not).
6. **Panel copy:** Google Calendar subscribes by URL only from calendar.google.com (on a computer);
   the Google button says so. Acceptance step 3 also checks the `webcal://` button inside the iOS
   app (Capacitor WebView), not only Safari.
7. **Rollback wording.** After a revert the middleware answers a redirect to sign-in (307), not a
   404; calendar clients treat both as an error.
8. **Several instrument seats** show only the first in ⭐/«Tu lugar» (`[0]`, inherited from `/me`).
9. **Raw-path pinning (merge-range code review, MEDIUM).** Next decodes dynamic params, so a
   percent-encoded spelling (`%2Eics`, an encoded token or id character) verified too and missed
   the edge cache. After the HMAC (still zero I/O) the route requires the raw `pathname` to equal
   the minted one, and refuses a bare trailing `?`.
10. **Weekend start times (2026-10-15, after release).** Frank gave the standing times: Saturday
    18:00, Sunday 11:00. Weekend events are now timed (`DTSTART;TZID=America/Mexico_City`, PT2H)
    from the constant `WEEKEND_SERVICE_TIME` in `app/utils/calendarFeed.ts`; nothing is stored.
    A special keeps its own time, and stays all-day without a valid one. A different time for one
    weekend would need a stored field; not built.
