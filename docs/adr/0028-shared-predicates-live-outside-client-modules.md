# ADR-0028: A predicate shared with a Server Component lives outside the client module

**Date:** 2026-09-02 · **Status:** Accepted

## Context

`0a48d849` removed a real duplication. `DayCard` returned `null` when a service
had no published setlist and no assigned seat; the home page re-derived that same
condition by hand to choose between the "Esta semana" grid and an empty state. A
hand-copied guard goes stale in silence — add a sixth seat array and the page
shows a heading over nothing with every test still green — so the condition became
one exported function, `paintsDayCard`, and the page called it.

It was exported from `DayCard.tsx`, next to the component that guards on it. That
file begins with `"use client"`. `app/(client)/page.tsx` is a Server Component.

What a Server Component imports out of a client module is not the function; it is
a client reference. Calling it throws:

    Attempted to call paintsDayCard() from the server but paintsDayCard is on the
    client. It's not possible to invoke a client function from the server, it can
    only be rendered as a Component or passed to props of a Client Component.

Every render of `/` in production threw it. Vercel recorded 70 occurrences across
3 users between 15:55Z and 16:11Z on 2026-09-02, on the deploy of `103c935b`, and
members got the "Algo salió mal" error boundary instead of the app.

Nothing caught it. `tsc` types the export identically either way — the boundary is
a bundler property, not a type. The unit tests import the function directly, never
the boundary, and stayed green throughout. `next build` compiles the page but does
not render it: `/` is dynamic (ADR-0020), so the throw only happens on a request.

## Decision

A value that a Server Component calls lives in a module with no `"use client"`
directive and no import that pulls one in. `paintsDayCard` moved to
`app/utils/paintsDayCard.ts`; `DayCard.tsx` imports it like any other util.

`app/components/admin/moveOccupant.ts` now **declares** `"use client"` rather than
inheriting it from whichever importers happen to be client components. It calls
`withUpdatedCell` out of `PlannerGrid.tsx` (a client module), so it is not safe to
call from the server; its own header advertises it as the primitive "every drag
must go through", which invites exactly the caller that would discover this.

Two guards in `app/components/__tests__/paintsDayCard.test.ts` read the files: the
util module must carry no `"use client"` directive and no imports at all, and the
home page must import the predicate from it rather than from `DayCard`.

## Rejected

**Keep it in `DayCard.tsx` and pass the answer down as a prop.** The page needs the
answer *before* it renders anything — the count picks the grid layout and decides
whether the heading appears at all. There is nothing to pass it to yet.

**Keep it in `DayCard.tsx` and let the page re-derive the guard.** That is the
duplication `0a48d849` deleted, and the reason it deleted it has not changed.

**Rely on review to catch the next one.** This diff was reviewed as a plan and
merged; the boundary is invisible in a plan and invisible to all three gates. The
only available control is a test that reads the files, which is why one exists.

## Consequences

The predicate no longer sits next to the component it guards, which reads as
misplaced. It is not: moving it back into `DayCard.tsx` re-breaks `/` in
production, and the two guards will fail rather than let that ship.

`moveOccupant.ts` is now pinned to the client bundle by directive. It already was
in practice — every production importer is a client component — so nothing moves;
what changes is that a future server-side caller fails loudly at the import rather
than at render time in front of the team.

This ADR covers one class of bug the build cannot see. A repo-wide guard that
walks `app/**` and flags any non-client module calling a value imported from a
`"use client"` module would generalise it; the two guards here cover only this
site.
