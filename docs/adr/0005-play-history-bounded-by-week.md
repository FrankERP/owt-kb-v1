# ADR-0005: Bound play history by week, not by a published-role join

**Date:** 2026-07-10 · **Status:** Accepted

## Context

`CLAUDE.md` states an invariant: **member-facing reads must filter
`published != false`**. The song play-history read — "Última vez tocada" —
deliberately does not, which makes it look like a violation of a documented
rule.

## Decision

Bound the read by date instead:

```groq
*[_type in ["featuredSongs", "saturdarSongs"] && references($id) && week < $today]
```

in `app/(client)/posts/[slug]/page.tsx:96` and `app/api/song/[id]/route.ts:33`.
Past weeks are already-happened services, so they carry no draft-leak risk — the
gating concern is *upcoming* services that haven't been published yet.

## Rejected

**Joining to the published role document,** which is what the invariant would
suggest. Verified against production at the time: **204 of 215 historical
setlists predate role documents entirely.** A role join would have erased
legitimate play history for all of them — a song last played in 2025 would read
as never played.

## Consequences

This read is a deliberate, evidence-backed exception to the
`published != false` invariant, not an oversight. It is safe only because the
`week < $today` bound does the same job for this particular data. **Do not
"restore" the published filter here** — and if you add a new read that touches
setlists, the invariant still applies unless you have the same argument.
