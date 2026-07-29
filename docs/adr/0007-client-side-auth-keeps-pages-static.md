# ADR-0007: Read auth client-side so member pages stay static

**Date:** 2026-06-05 · **Status:** Accepted

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
