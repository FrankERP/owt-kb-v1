# ADR-0007: Read auth client-side so member pages stay static

**Date:** 2026-06-05 · **Status:** Accepted, amended by ADR-0020 (2026-08-19)

## Context

The shared `Navbar` renders on nearly every page. It originally called
`getServerSession`, and **a cookie read opts the whole route out of static/ISR
caching** — so one component in the shell made every song page dynamic.

## Decision

`Navbar` is a plain, non-async component that reads no session. Session state
and the notification badge resolve client-side in `NavMenu`. `EditSongButton`
likewise self-gates on `useSession()`.

## Rejected

**Server-side session reads in shared shell components.** Correct-looking, but
it costs static rendering on every page that renders the shell — a large
performance regression for a small piece of UI.

## Consequences

The avatar, menu, and edit button hydrate a moment after paint instead of
appearing in the initial HTML. That flash is the accepted cost.

**`EditSongButton`'s `useSession()` check is cosmetic — it decides whether to
render the button, and nothing more.** The real authorization is server-side:
`app/api/song/[id]/route.ts` calls `requireActiveSession()` and returns 401
without it. It reads like a client-side authz check and is not one. Don't
"harden" it by moving the gate server-side — that would undo this ADR and make
the page dynamic again.

`app/components/Navbar.tsx:13–15` carries a short version of this at the
definition site.

## Amendment (2026-08-19) — seven worship pages now gate server-side

Kids Ministry scheduling introduced **ministry isolation**: a kids-only member
must not reach the worship catalog. That is a *security* requirement, not the
hardening preference this ADR rejected — and **a statically rendered page cannot
refuse a typed URL**. It has no request to inspect; it serves cached HTML to
whoever asks. Client-side gating hides UI, it does not withhold content.

So the seven worship pages listed in ADR-0020 — `/`, `/schedule`, `/tag`,
`/tag/[slug]`, `/author`, `/author/[slug]`, `/posts/[slug]` — call
`requireWorshipPage` (`app/utils/worshipPageGate.ts`) as their first statement
and are **dynamic by design**. The performance trade this ADR made is knowingly
reversed **for those seven pages only**; ADR-0020 records why the gate is
per-page rather than in the middleware.

**What still holds, unchanged:**

- `Navbar` stays a plain, non-async component that reads no session. It was the
  original reason every page went dynamic, and it is still not the place for a
  session read.
- Session state — now including `ministries`/`managesMinistries` — still
  resolves **client-side** in `NavMenu`, which filters the nav by ministry.
  That follows this ADR's pattern rather than breaking it: nav filtering is
  cosmetic, the page gate is the enforcement.
- `EditSongButton`'s `useSession()` check remains **cosmetic**. The real gate is
  still `app/api/song/[id]/route.ts`, now `requireMinistryMember("worship")`
  instead of `requireActiveSession()`.

The rule this ADR still enforces: don't move a session read into a *shared shell
component*. Do gate a page whose **content** is ministry-scoped.
