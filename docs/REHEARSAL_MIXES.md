# Rehearsal mixes — render and ingest runbook

Spec: `docs/superpowers/specs/2026-09-20-rehearsal-mixes-design.md`. Model: `post.rehearsalMixes[]`
(`docs/DATA_MODEL.md`). Route: `/api/audio/[songId]/[key]` (`docs/API_REFERENCE.md`).

## One batch, start to finish

1. Connect the SSD with the Ableton projects. Nothing in the app ever reads it.
2. Render with `abletonnl` (its MCP or CLI), one song per call, into one output root, e.g.
   `~/Rehearsal-out/<song folder>/`. Isolate the seven families the team plays:
   `tracks` = every band track whose family is one of
   `electric, acoustic, keys, organ, synth, bass, drums` (read them from `inspect_set`).
   Pads, strings, loops, FX and vocals stay in the bed. Each folder ends with
   `manifest.json` carrying per-file `kind`, `family`, `peaks`, `active`.
3. Dry run:
   `node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs ~/Rehearsal-out`
   Read every line. `?` lines are unmatched folders — write `~/Rehearsal-out/matches.json`
   (`{ "<folder>": "<post _id>" }`) and re-run until none remain.
4. Apply (production dataset — needs Frank's explicit go on the dry-run output):
   `node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs ~/Rehearsal-out --apply`
5. The song sheet shows the mixes at once; `/posts/[slug]` within its 1 h ISR window.

Re-running is safe: keys are `sha1(set.sha1 + file name)`, an asset whose sha1 already
matches is reused, items from another render of the same song (a second key) are kept.

## Quotas to watch (Sanity Free)

100 GB assets / 100 GB bandwidth per month. ~11 files per song at 192 kbps ≈ 7 MB each →
the whole catalog is ~11 GB. Bandwidth with offline download ≈ 7 GB/month. Check the
project's Usage page after the first two batches.

## Verified runs

_(paste the dry-run and apply summaries of each batch here, with the date)_
