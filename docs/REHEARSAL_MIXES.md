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
   Publish or discard any open Studio draft of a song **before** running a batch — the script
   patches the *published* document, and publishing an older draft afterwards drops
   `rehearsalMixes` from it (re-running the ingest restores it, but the team sees no mixes
   until then).
5. The song sheet shows the mixes at once; `/posts/[slug]` within its 1 h ISR window.

## How members find it

The «Ensayo» section is the first thing on the song page — before the chord chart — and in
the song sheet's section nav. A song with no `rehearsalMixes` shows no «Ensayo» heading and
no player at all: the section only renders once a batch has ingested that song.

Re-running is safe: keys are `sha1(set.sha1 + file name)`, an asset whose sha1 already
matches is reused, items from another render of the same song (a second key) are kept.

## Quotas to watch (Sanity Free)

100 GB assets / 100 GB bandwidth per month. ~11 files per song at 192 kbps ≈ 7 MB each →
the whole catalog is ~11 GB. Bandwidth with offline download ≈ 7 GB/month. Check the
project's Usage page after the first two batches.

## Verified runs

### 2026-09-20/21 — first full catalog ingest (Frank's SSD `/Volumes/OWT-2TB`)

Source: `ABLETON/Multitraks/<artist>/…/<Song>_<BPM>BPM_<Key>.als` (166 OWT-style sets among 285;
273 with audio). Rendered with `abletonnl` `72c0694` into `/Volumes/OWT-2TB/Rehearsal-out/<stem>/`
by a per-song driver (inspect → longest group track → tracks in the seven isolated families →
`render_rehearsal_mixes` → move); `als-match.json` + `matches.json` there hold the folder → post
mapping. **The abletonnl segment cache (`~/.cache/abletonnl`) grew to 87 GB and filled the Mac** —
it is now a symlink to `/Volumes/OWT-2TB/abletonnl-cache`; keep it on the SSD.

| Batch | Dry run | Apply |
|---|---|---|
| 5 songs (Praise, Gracias Dios, Como El Sol, Cristo Es El Centro, Nadie D) | sube 67 (447 MB) | escribió 5; re-run reused 67 |
| 108 folders (103 new + the 5) | sube 1057 + 12 after a matches.json spelling fix | sube 1069 (8.9 GB), reusa 67, escribió 108 |
| 113 folders (6 new) | sube 53 (435 MB), reusa 1136 | escribió 113 |
| 136 folders (23 Live 10 sets, after abletonnl `7998519` learned to read Live 10) | sube 207 (1.6 GB) → 191 after excluding two wrong-target folders | sube 191 (1.4 GB), reusa 1189, escribió 136 |
| 142 folders (6 songs unblocked by abletonnl `5a61afa`: seek past EOF → silence, <64-frame warp segments copied, foreign absolute paths rebased) | sube 72 → 63 after excluding a second C-key Way Maker | sube 63 (670 MB), reusa 1380, escribió 142 |
| 144 folders (Resplandeció! and Orgullo De Un Padre, after abletonnl renames duplicate track names to «Name (2)» and `skip_missing` lets a lost scratch track render as silence) | sube 16 (124 MB), reusa 1443 | escribió 144 |

Result on production (GROQ, 2026-09-21 10:40): **135 of 144 songs** carry `rehearsalMixes`
(144 renders — 9 songs in two keys), **1,468 mixes**, **12.0 GB of the 100 GB quota**.
Idempotence held on every re-run (reusa = all previous uploads, reemplaza 0). Three rendered
folders were deliberately excluded (`/Volumes/OWT-2TB/Rehearsal-out/_excluded/`): the vendor
`Oceans_132BPM_D` (the OASIS arrangement in the same key is the one ingested),
`Sólo en Jesús_68BPM_F` (Passion's *In Christ Alone*, which had title-matched the *In Jesus
Name* post), and `Way Maker_68BPM_C` (a second C-key set; `Así eres Tú_68BPM_C` was already in).
The render driver passes `skip_missing=True` and never asks for an `UP` of a track abletonnl
renamed («Drums (2)») — the duplicate still plays in the bed, as in Live.

Still without mixes (9): 6 have no set on the SSD (En Tu Presencia, Generación Que Danza,
Heme Aquí, Mi Sanador, Ojos De Amor, Sube Más Alto); 3 have no isolatable instrument track at
all — only loops, pads or voices (Noche De Paz, Sopla Espíritu, Sendas Dios Hará), so a `Full`
alone is the most they could carry.

Known wart: when an isolated track is silent in a song, its `UP` file is byte-identical to `Full`
and Sanity dedupes the asset — the row still shows (e.g. «EG 4», «Keys 3» on El Que Resucitó).
A cleanup that drops `up` items whose asset equals the `full` asset is the fix.

_(paste the dry-run and apply summaries of each batch here, with the date)_
