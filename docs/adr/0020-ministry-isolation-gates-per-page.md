# ADR-0020: Gate ministry isolation per page, not in the middleware

**Date:** 2026-08-19 · **Status:** Accepted — amends [ADR-0007](0007-client-side-auth-keeps-pages-static.md)

## Context

Kids Ministry scheduling made ministry isolation a security requirement: a
kids-only member must not reach the worship catalog, and a worship member must
see nothing of Kids. A statically rendered page cannot enforce that — it has no
request to inspect and serves cached HTML to whoever types the URL. So the
worship reading surfaces had to start refusing requests server-side.

Seven pages carry worship content and are hit by the whole team:

| Page | `revalidate` before |
|---|---|
| `app/(client)/page.tsx` (`/`) | 60 |
| `app/(client)/schedule/page.tsx` | 60 |
| `app/(client)/tag/page.tsx` | 60 |
| `app/(client)/tag/[slug]/page.tsx` | 60 |
| `app/(client)/author/page.tsx` | 60 |
| `app/(client)/author/[slug]/page.tsx` | 60 |
| `app/(client)/posts/[slug]/page.tsx` | 3600 |

(`/me/propose/[roleId]` also calls the gate, but it was already `revalidate = 0`
— it loses nothing and is not part of this trade.)

Gating them costs static rendering on the app's hottest routes, which is exactly
the trade ADR-0007 made in the other direction. That price needs a recorded
reason, or the next reader will "fix" it.

## Decision

Each of the seven pages calls `requireWorshipPage(callbackPath)`
(`app/utils/worshipPageGate.ts`) as its first statement. The gate reads the
session and a live member snapshot, so **the page is dynamic**; the redirect
splits "no active session" (→ sign-in) from "active, but not worship"
(→ a ministry they actually belong to, or `/me`).

Authorization is one function, called from the page that owns the content, in
the same request that renders it.

## Rejected

**Gating worship paths in `proxy.ts` middleware.** This was genuinely available:
`ministries` and `managesMinistries` now ride on the JWT (`auth.ts:203-204` / `:217-218`),
sourced from the same 30s-TTL `getMemberAccess` snapshot the guards use, so a
middleware check would have had fresh-looking claims *and* preserved ISR on all
seven pages. It is the better-performing design and it was rejected anyway, for
two reasons.

**1. The middleware reads a token copy, not a per-request snapshot.** `withAuth`
decodes the cookie; it does not run the `jwt` callback, so the claims are
whatever was written at the last token refresh — NextAuth's schedule, not the
request's. The guards call `getMemberAccess` on every request and see a
revocation within 30 seconds. `auth.ts` already carries this warning at the
place the claims are set:

> …this copy is render-only — every server-side authorization decision re-reads
> `getMemberAccess`. **If anything ever authorizes off the session copy, this
> one-request lag becomes a privilege bug.**

Middleware gating is precisely "authorizing off the session copy".

The original worked example here was impersonation, where `ministries` described
the previous identity while `sanityId` already described the new one. That
particular lag was **fixed on 2026-08-20** — it had shipped as a real bug, an
impersonated Kids manager showing no "Planear Kids" link — and the impersonation
branch now sets both fields on start and on stop. It is quoted here as history,
not as a live example.

The argument is unaffected, because the mechanism is not specific to
impersonation: the token copy is refreshed on NextAuth's schedule rather than
read per request, so any change to a member's ministries — a revocation, a
grant, an admin's own ministries changing mid-impersonation — is visible to the
guards immediately and to the token only at its next refresh. A gate in
middleware would read the older of the two. That is the reason to gate per page,
and it does not depend on which example currently demonstrates it.

**2. A matcher list is a second place for route coverage to drift.** The
middleware matcher is a regex that must be maintained alongside the routes it
protects — and this repo already pays for that: the matcher is duplicated in
`proxy.ts` and `app/utils/routeMatcher.ts` because Next requires a statically
analyzable literal, with a byte-identical sync guard in `routeMatcher.test.ts`
to keep the copies honest. A worship-path alternation would add a third thing to
keep in step with the file tree, and its failure mode is silent: a new page
matches nothing and is served to everyone.

## Consequences

**`revalidate` on those seven pages no longer means what it says.** The exports
are still in the files, and they are inert: a cookie read opts the route out of
static/ISR caching, so `revalidate = 60` on `/` and `revalidate = 3600` on
`/posts/[slug]` describe a cache that no longer exists. Do not read a surviving
`revalidate` export on a gated page as evidence the page is cached, and do not
"restore ISR" by deleting the gate — that re-opens the worship catalog to
kids-only members. If the exports are ever removed as noise, remove them
knowingly, not as a bug fix.

**Every worship page renders per request now**, including the two most visited.
The pages still read from Sanity's CDN-backed client, so the loss is the HTML
cache, not query cost.

**Coverage lives in review, not in a guard.** Nothing enumerates "pages that
must call `requireWorshipPage`" — a new worship page that forgets the call is
public to any signed-in member of any ministry. That is this decision's drift
risk, traded against the matcher's; it is smaller only because the gate sits in
the file whose content it protects. `app/utils/__tests__/worshipPageGate.test.ts`
tests the gate's behaviour, not its adoption.

**Undoing this means moving the check into `proxy.ts`**, which reopens both
problems above. If it is ever done, the token copy must stop being the
authorization source first.

ADR-0007 still holds everywhere else: `Navbar` stays session-free, and
`NavMenu`'s ministry filtering is cosmetic. See that record's Amendment section.
