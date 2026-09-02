// Excerpt of `app/(client)/page.tsx` at commit 103c935b — the deploy that was
// live during the 2026-09-02 outage. The import line and the `paints` helper are
// verbatim; the surrounding page is dropped.
//   Re-derive with:  git show '103c935b:app/(client)/page.tsx'
//
// This is a FIXTURE, not live code — nothing here is compiled or rendered, the
// analyser only parses it. It exists because CI clones shallow, so
// `git archive 103c935b` is unavailable there: the proof that the guard catches
// the real bug had to stop depending on clone depth.
//
// The pair of facts is what matters. This module carries NO `"use client"`
// directive, and it CALLS `paintsDayCard`, which `../components/DayCard`
// exports from behind one. That is the shape that threw on every render of `/`.

import { DayCard, paintsDayCard } from "../components/DayCard";

export function excerpt(
  sunSetlist: { songs?: unknown[] } | null,
  sunRole: { Lead?: unknown[]; instruments?: unknown[]; foh_team?: unknown[]; BGVs?: unknown[]; Chorus?: unknown[] } | null,
) {
  const paints = (
    setlist: { songs?: unknown[] } | null | undefined,
    role: { Lead?: unknown[]; instruments?: unknown[]; foh_team?: unknown[]; BGVs?: unknown[]; Chorus?: unknown[] } | null | undefined,
  ) =>
    paintsDayCard({
      setlist,
      leads: role?.Lead,
      instruments: role?.instruments,
      fohTeam: role?.foh_team,
      bgvs: role?.BGVs,
      chorus: role?.Chorus,
    });

  // DayCard itself is only ever rendered as JSX — legal, and the analyser must
  // not flag it. Only the `paintsDayCard` call above is the violation.
  return { hasSunday: paints(sunSetlist, sunRole), DayCard };
}
