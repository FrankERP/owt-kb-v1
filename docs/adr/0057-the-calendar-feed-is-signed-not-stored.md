# ADR-0057: The member calendar feed is signed, not stored

**Date:** 2026-10-15 · **Status:** Accepted

## Context

Members asked for a calendar subscription (Frank, 2026-10-15): every service on their own phone
calendar, the ones they serve marked, with the songs and the team, updating by itself. A
subscription URL is fetched by Google's servers or the iPhone with **no session**, so the URL is
the credential. The Sanity dataset is **public** (Free plan) and DEF-A-16 is moving everything
credential-like out of it; it is also shared by production and `preview`. Design and review:
[`2026-10-15-member-calendar-feed-design.md`](../superpowers/specs/2026-10-15-member-calendar-feed-design.md)
and its review log.

## Decision

- URL: `/api/calendar/<memberId>/<generation>/<token>.ics[?solo=mios]`, with
  `token = base64url(HMAC-SHA256(CALENDAR_FEED_SECRET, "owt-calendar-feed:v1\n" + memberId + "\n" + generation))`
  (`app/utils/calendarFeedToken.ts`). The secret lives only in Vercel, one per environment.
- **The generation travels in the URL**, so the route verifies the signature with zero I/O before
  it reads anything: junk traffic costs no Sanity request. Only then one tokened read checks the
  member (exists, not disabled, in worship) and that the stored generation equals the URL's.
- Revocation per member: `calendarFeed.<memberId>` (dotted, hidden/read-only in Studio) holds a
  non-secret counter; «Generar un enlace nuevo» (`POST /api/me/calendar-feed`) increments it
  atomically, which kills every earlier URL. Absent document = generation 0.
- Fail closed: no secret, or no `SANITY_API_READ_TOKEN` (a token-less read of a dotted id answers
  «absent», which would read as 0 and resurrect revoked URLs) → 503. A corrupt stored counter → 503.
- One spelling per URL (the `.ics` suffix required, the query empty or exactly `?solo=mios`, and
  the raw path — percent-escapes included — equal to the minted one), so the one-hour edge cache (`Vercel-CDN-Cache-Control`) cannot be bypassed by a URL holder.
- `/api/calendar` is excluded from the `proxy.ts` matcher; the rotate route stays session-gated.

## Rejected

- **A random token per member, stored in Sanity.** It would have to live in a private dotted
  document every reader must read with the token, and it is a real secret sitting in the dataset
  DEF-A-16 is emptying of secrets. The HMAC lets the server re-derive the URL from public facts
  plus a key that never leaves Vercel.
- **Signing with `NEXTAUTH_SECRET`.** Rotating it after a calendar leak would sign the whole team
  out; rotating it for auth reasons would silently kill every subscription.
- **Generation looked up before the signature** (the first draft). Every forged request would cost
  Sanity reads — and fill `getMemberAccess`'s never-evicted cache — on a quota the production app
  shares. Review round 1 found it.
- **An undotted counter document.** It would remove the token-less failure mode, but publish per
  member whether and how often they reset their link; the fail-closed token check is one line.

## Consequences

- A URL leaks wherever URLs leak (Vercel logs, the calendar provider). Mitigations: per-member
  rotation, the per-environment kill switch (remove the secret, redeploy). A rotation takes effect
  within the one-hour edge cache.
- The counter lives in the dataset production and `preview` share: rotating on dev also revokes
  that member's production link. Rehearse rotation only with the «Verificador (bot)» member.
- Rotating `CALENDAR_FEED_SECRET` kills every link in that environment; members re-subscribe.
- Undo: revert the change; the `calendarFeed` documents are inert.
