# ADR-0002: Pin `engines.node` to exact `22.x`, not a range

**Date:** 2026-06-16 · **Status:** Accepted

## Context

Vercel reads `engines.node` and lets it **override the Node version set in the
Project Settings dashboard**. With a range, Vercel resolves to the highest
matching major available.

## Decision

`"engines": { "node": "22.x" }` in `package.json` — an exact major, matching
`.nvmrc`.

## Rejected

**A range such as `>=22`.** From the commit that made the change (`a38827c`):

> A range (>=22) made Vercel resolve to the highest major (24.x) and override
> the Project Setting. Pinning to 22.x aligns prod with .nvmrc and the
> local/Capacitor baseline.

So production silently ran Node 24 while `.nvmrc`, local dev, and the Capacitor
build all used 22 — a version skew with nothing surfacing it.

## Consequences

Moving to Node 24 is now a deliberate edit in three places (`engines`, `.nvmrc`,
and the Vercel Project Setting), which is the point.

**Note on the reason.** Until 2026-07-29, `docs/DEVELOPMENT.md`,
`docs/ARCHITECTURE.md`, and `docs/MOBILE.md` all attributed this pin to
"required by Capacitor 8." Capacitor only requires Node **≥22** — it is
satisfied by a range and is not why the pin is exact. Anyone reasoning from
those docs would have concluded a range was fine and reintroduced the skew. The
docs now point here.
