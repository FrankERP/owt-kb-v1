# ADR-0018: Keep lyrics and chord charts as independent fields

**Date:** 2026-08-14 · **Status:** Accepted

## Context

A `post` can hold N `chord_chart` objects in `chords` and plain lyrics in `body`.
The reader already tabs when `charts.length > 1`. The editor used one textarea
for both: `songToForm` loaded `chords[0].content || bodyToLyrics(body)`, and
`buildPayload` routed that text to **either** `chords[0]` **or** `body` via
`CHORD_MARKER_RE` (`/\[[^\]]+\]/`). Opening a 3-chart song and pressing Guardar
silently deleted charts 2..n. The same two lines were duplicated in
`EditSongButton`.

## Decision

Lyrics are `body`. Charts are `chords`. `songToForm` / `buildPayload` (and
`buildEditSongPayload`) never copy chart content into the lyrics field and never
classify lyrics with a chord-marker regex. Each chart keeps its Sanity `_key`
across a no-op save. Whitespace-only charts are dropped on save because both
readers hide `body` whenever `chords.length > 0`.

Carried by `app/utils/songFormCharts.ts`, `app/utils/chordChartWrite.ts`,
`SongFormModal.tsx`, `EditSongButton.tsx`, and the two `/api/content/posts`
writers.

## Rejected

Keep one textarea that auto-classifies via `CHORD_MARKER_RE`, and treat extra
charts as an add-on list for keys 2..n. Chart 0 and lyrics still share a box, so
a 3-chart no-op still depends on regex, and a lyrics-only song whose text
contains `[brackets]` still silently becomes a chart and empties `body`. That is
the coupling that forced the collapse.

Also rejected: when `body` is empty, copy `chords[0].content` into the lyrics
textarea "so the content is visible." That is `songToForm` as it stood
(`chords?.[0]?.content || bodyToLyrics(song.body)`).

## Consequences

A charts-only song shows an empty Letra box; the content lives in Acordes. A
lyrics-only song whose text contains `[Am]` stays lyrics. Adding a filled chart
to a lyrics-only song hides `body` in both readers (`ChordChart` wins when
`chords.length > 0`) until every chart is removed — existing reader behavior,
not a prompt to re-entangle the fields. Re-introducing `CHORD_MARKER_RE` on save
would restore the data-loss bug.
