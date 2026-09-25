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
A **transposed** render of the same set (`manifest.transpose.semitones ≠ 0`) is another
render too: its `sourceHash` is `set.sha1:+1` / `set.sha1:-1` (`renderHash`), so
ingesting the Gb render does not drop the G one. Untransposed renders keep the bare sha1
— every row written before this rule still matches.

## Keys — which ones exist, and how a member picks one (2026-09-21)

Every song is rendered in **its set's key ±1 semitone**, plus **every key the song has been
played in** (`play_key` on `featuredSongs` / `saturdarSongs`), from the nearest set. The
pitch shift is abletonnl's per-track Rubber Band; drums, percussion and the click are
`unpitched` in `families.toml` and pass through untouched. All 12 keys was rejected (~144 GB
against a 100 GB quota); this set is ~40 GB total.

The member picks the key with the hero's key dial — `SongHeroPills` is the ONE 12-key
picker, so the player grew no strip of its own. The dial now arms whenever the song has
mixes in more than one key, ChordPro chart or not, and a key that has a mix carries a dot
(`mixTones` prop; `aria-label` says «con mix de ensayo»). `RehearsalPlayer` reads the
sounding key from `TransposeProvider` and shows `mixesForKey` — the rows in that key, or
the NEAREST key's rows with a caption saying so («No hay mix en B — se muestra Ab»).
Turning the dial while a row plays carries the same track into the new key at the same
position; a paused row stays paused. Outside a provider (the gallery fixture) every key's
rows show.

Render driver: `scripts/render-keys.py` in the AbletonNL repo (`de69c5e`; `render-list.py`
beside it is the untransposed one) takes `[{als, stem, postId, semis}]` where `stem` is the base stem with the TARGET
key (`Jesucristo Basta_69BPM_Ab` → `…_G`), passes `transpose=semis` to
`render_rehearsal_mixes`, moves the folder to `<root>/<stem>/` and writes `matches.json`.
The list comes from Sanity: per post, `mixTones` ± 1 ∪ `play_key` roots − keys already
rendered; each target picks the closest base set. A transposed render is ~4.5 min per song
(vs ~45 s plain) — run three shards in parallel.

## The mix rule (calibrated 2026-09-21)

Every `UP` mix is rendered with, in abletonnl terms:
`weighting="k", separation_db=7, utility_level_db=17, normalize="target", loudness_db=-16,
target_leveler=True, skip_missing=True`. In words: levels are measured through the BS.1770
K-weighting curve (a bass and a piano land equally loud to the ear); the boosted instrument is
held at −16 dB and the band sits 7 dB under it; the click's **peak** sits 17 dB above the
instrument; a slow leveler (1 s windows, ±8 dB, 0.5 s attack / 2 s release, frozen in silence)
evens the instrument phrase by phrase before measuring. The numbers were read off the mix Frank
picked as the reference (Como En El Cielo · Piano) and reproduce it within 0.3 dB. The earlier
rule — instrument at −20 dBFS flat RMS, click following the band's gain, whole mix normalised —
made the click land anywhere from 7 to 20 dB under the instrument depending on how the set was
mixed, and pulled the instrument down whenever the click came up.

## Quotas to watch (Sanity Free)

100 GB assets / 100 GB bandwidth per month. ~11 files per song at 192 kbps ≈ 7 MB each →
one key of the whole catalog is ~12 GB; with ±1 semitone and the history keys, ~40 GB.
Bandwidth with offline download ≈ 7 GB/month. **The project's Usage widget lags the
dataset by up to a day** (it showed 49.6 MB the evening 12 GB were ingested); the number
that bills is `math::sum(*[_type=="sanity.fileAsset"].size)` in Vision.
Alternatives were weighed on 2026-09-21 and parked: Google Drive is not an audio origin
(download quotas, no dependable `Range`, virus-scan interstitials — and a proxy would push
the bytes through Vercel Hobby); Cloudflare R2 (zero egress, signed URLs, ~$0.015/GB) is the
fallback if the catalog ever nears the quota — the swap is `audioFile` → an object key, the
ingest uploading over S3, and the route signing instead of redirecting.

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
| **Recalibration** — all 144 folders re-rendered with the mix rule above (abletonnl `2f38a56`…`425650c`) | sube 1458 (12.0 GB), reusa 1, reemplaza 1458 | escribió 144; the ingest deleted every replaced asset; re-run reuses 1459 |
| **Keys** (2026-09-22) — 469 folders: the 144 above + 325 transposed renders (set key ±1 semitone + every `play_key` from the setlists; 3 shards overnight, ~4.5 min each, 0 failures) | dry run 1: 6 failed (BPM-less folder names → parser fix `1af15a26`) + 6 unmatched (shards raced on `matches.json` → overrides restored from the shard lists); dry run 2: 469 matched, sube 3354 (27.7 GB), reusa 1459, reemplaza 0 | first `--apply` paused at 8/469 on a 170 KB/s network; relaunched at 7.8 MB/s: sube 3324 (27.5 GB), reusa 1489, reemplaza 0, escribió 469 in ~95 min |

Result on production (GROQ, 2026-09-22 23:55, after the keys ingest): **135 of 144 songs** carry
`rehearsalMixes`, **4,822 mixes** in **4,817 audio assets**, **39.8 GB of the 100 GB quota**; keys per
song: 3 → 92 songs, 4 → 31, 5 → 5, 6 → 6, 7 → 1; every row's asset resolves, 3 orphan assets
(~30 MB, uploads cut off when the slow first `--apply` was killed mid-folder). A GROQ
`count(*[_type=="post"].rehearsalMixes[…])` over posts WITHOUT the field counts the null as 1 per
post — the 9 songs with no mixes show up as «9 dangling rows» that do not exist; filter
`count(rehearsalMixes) > 0` first. Before the keys ingest (2026-09-21 15:20): 144 renders — 9 songs
in two keys, 1,468 mixes, 12.0 GB.
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
