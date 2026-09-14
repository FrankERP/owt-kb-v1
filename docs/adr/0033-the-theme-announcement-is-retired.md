# ADR-0033: Retire the theme announcement rather than persist its dismissal

**Date:** 2026-09-13 · **Status:** Accepted

## Context

The theme-rollout banner (`ThemeAnnouncement`, shipped at Child F on `701f4b01`,
top of `/me`) stored its dismissal as one `localStorage` key,
`owt-theme-announced`. The logic was correct — read on mount, write on «Ocultar»,
every access wrapped — and it still failed in production: the team reported the
banner coming back for members who had already dismissed it, and not for one or
two of them.

`localStorage` is a per-STORAGE-JAR flag, not a per-member one, and this team
reaches the app through jars that are neither shared nor durable:

- the app's links circulate on WhatsApp, whose iOS in-app browser is a WKWebView
  with its own data store — a jar that is not Safari's, and not necessarily the
  same one twice;
- a member who opens `/me` on a phone and then on a laptop has two jars;
- Safari's ITP deletes script-writable storage after 7 days without a
  first-party interaction, and members visit around a weekly rehearsal;
- private windows and storage-blocked configurations start empty by design — the
  component's own `catch` deliberately fails toward SHOWING the banner.

Every one of those is invisible to `tsc`, to vitest and to a browser check on the
developer's own machine, where the flag persists exactly as written.

## Decision

Delete the component and its render at the top of `/me`. Nothing replaces it. The
theme control itself is untouched, `/me#tema` still works, and `NavMenu`'s
«Tema» item still lands on it.

`themePrefModule.test.ts` carries the guard: the file must not exist and `/me`
must not render it. The announcement had been live for a month, which is the
other half of the reason — every member had seen it, most of them repeatedly.

## Rejected

**Persist the dismissal per member in Sanity** (a `teamMembers` boolean plus a
PATCH route). It is the only repair that actually survives a new jar, and it is
what a future in-app announcement must do. It was rejected for THIS banner
because the banner's job was finished: the cost is a schema field, a write
boundary and a Studio schema deploy, spent so that a month-old notice can be
hidden more reliably before being deleted anyway.

**A long-lived cookie read on the server.** Cheaper than the schema change and
strictly worse than it looks: the WhatsApp WKWebView case — the one that best
explains "a todos" — isolates cookies in the same jar it isolates
`localStorage` in. It would have fixed the 7-day cap and nothing else, while
reading as a real fix.

## Consequences

A member who joins tomorrow gets no in-app notice that the theme follows their
device; the control on `/me` is self-explanatory and is reachable from the nav
menu, which is what the announcement was pointing at anyway.

If an in-app announcement is ever wanted again, do not copy this component back:
a client-only dismissal is what this record rejects. The dismissal has to be a
per-member server flag, or the banner will come back for people who dismissed it
— which is exactly what the team reported.
