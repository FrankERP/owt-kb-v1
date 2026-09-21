# Rehearsal mixes for the song catalog — design spec

**Date:** 2026-09-20 · **Status:** design approved in chat by Frank 2026-09-20 (decisions D1–D6 below); spec awaiting Frank's review · **Risk tier:** standard
(a new array on `post`, a one-off `--apply` ingest script in the same shape as the existing
backfills, a read-only API route that reuses the catalog's existing guard verbatim, and a
client player; no production writer contract, serializer, auth boundary or concurrency
protocol changes). Pipeline: this spec → user review → implementation plan → gates → fresh
code review of the diff.

This is **delivery 1 of 2**. Delivery 2 — the team's own harmony-vocal recordings — reuses
the same model and player (§10) and is not designed here. Nothing in delivery 1 depends on it.

## 1. The brief

Frank's ask: members should be able to listen to, and download, rehearsal tracks for every
song in the catalog (142 today, and every song added later). A rehearsal track is the whole
band with **one instrument raised above the rest and the click audible**, so a player can
find and learn their own part. Members pick the *specific* track — «Guitarra 2», «Piano»,
«Órgano» — not an instrument family. The player should show the track's waveform and where
in the song that instrument actually sounds (reference: MultiTracks.com's Rehearse view).

The worry that opened the conversation — that Sanity's free plan cannot hold sequences for
the whole catalog — is not true; §2 has the measurements.

## 2. What the platforms and the disk say today

| Fact | Evidence |
|---|---|
| Sanity Free: **100 GB asset storage, 100 GB/month bandwidth**, 1M CDN requests, 10k documents. No overage — uploads are refused at the cap, existing assets keep serving | sanity.io/pricing, read 2026-09-20 |
| The dataset uses **49 MB** of assets (4 orphan MP3s at ~11 MB each, 15 PDFs) and **1,041** documents | GROQ over `sanity.fileAsset` / `count(*)`, 2026-09-20 |
| **No song has audio today** — `audioTracks[].audioFile` is defined on 0 of 142 `post`s; the 4 MP3s reference nothing | same query |
| Dataset assets are **public by design**, in private datasets too. The one Sanity feature that protects files (Media Library private visibility + Ed25519 signed URLs, `@sanity/signed-urls`) is an **Enterprise add-on**. Public→private does not purge the CDN for up to 30 days | sanity.io/docs/media-library/asset-visibility |
| The app already resolves audio to `audioFile.asset->url` — `cdn.sanity.io`, never through Vercel | `app/api/song/[id]/route.ts:24` |
| A player stack already exists and is unused: `PlayerContext` (one `<audio>`, `playTrack`/`seek`/`getAudio`), `AudioTransport` (fixed bottom bar), `SongAudioSection` (cards), `Equalizer`, `PlayPauseGlyph` | `app/context/PlayerContext.tsx`, `app/components/` |
| The app's instrument vocabulary is five seats — `Bass`, `Keys`, `Drums`, `EG`, `AG` — and a member of Tipo `instrumento` declares theirs in `teamMembers.instruments[]` | `sanity/schemas/instrumentSeats.ts`, `worshipTeam.ts:181` |
| The renderer exists: `abletonnl` (Frank's separate project, spec 2026-09-09, MCP `render_rehearsal_mixes`) renders `Full.mp3` plus one `<track> UP.mp3` per selected track, measures each track's **active mask** (0.4 s windows within 25 dB of its loudest) to calibrate the boost, and writes `manifest.json` | `abletonnl` spec §4.3–4.4 |
| The service sets on this Mac are mostly **orphaned** — 31 sets, 9 with audio, 22 with none; `Songs_temp_tray` holds ~8 songs. The source multitracks live on Frank's **external SSD**, connected on demand | filesystem survey 2026-09-20 |
| Vercel Hobby is the tight platform: Function Storage hit 100% on 2026-09-17 | `docs/CI.md`, memory |

### Sizing

Songs average ~4.8 min. Per song: `Full` + 8–14 `UP` tracks (only the instruments the team
plays, §4). At **192 kbps** (~7 MB per file; indistinguishable from 320 on in-ears for
rehearsal, half the bytes):

| | 142 songs | of 100 GB |
|---|---|---|
| ~11 files/song · 192 kbps | **~11 GB** | 11% |
| same at 320 kbps | ~18 GB | 18% |

Bandwidth with offline download (D3): ~40 members × ~6 songs per service × 4 services
× ~7 MB ≈ **7 GB/month** of 100. Without download it would be ~50 GB/month (a member
learning a part loops it 15+ times and a 7 MB media file is not reliably browser-cached).

## 3. Decisions taken in chat (2026-09-20)

- **D1 — Bytes stay in Sanity.** Rejected Cloudflare R2 (zero egress, real presigned expiry,
  ~$0.08/month) because it adds a platform; rejected proxying bytes through a Next.js route
  because every byte would land on Vercel Hobby's transfer, invocation and duration quotas.
- **D2 — Access is a session-gated redirect, and that is all it is.** `/api/audio/…`
  validates the worship-member session and answers `302` to the CDN URL. It protects
  *discovery* (no public URL is ever rendered into a page) and lets access be withdrawn
  when someone leaves the team. It does **not** protect the *file*: past the redirect the
  member holds the raw URL. Frank accepted this knowing D3 makes the file leave anyway.
- **D3 — Download for offline is allowed.** It is what keeps bandwidth at ~7 GB/month.
- **D4 — One mix per *track*, not per family**, restricted to instruments the team plays.
- **D5 — The member plays the `UP` mix, and sees the isolated stem's waveform.** Rejected
  true stem playback (N synchronized stems with solo/mute, as in the reference image) —
  Web Audio sync of ~10 files, iOS quirks, offline = every stem, ~10× bandwidth per online
  play. Rejected «UP now, stems too» (~2× storage for a phase that may not come).
- **D6 — Rehearsal tracks first; harmony vocals are delivery 2.**

Licensing note, recorded not decided: the rehearsal mixes derive from **purchased
multitracks** (MultiTracks.com naming throughout the sets). The team's own harmony
recordings (delivery 2) carry no such exposure. D2's discovery gate is the whole of the
technical mitigation; anything beyond it is a licensing question for Frank, not this spec.

## 4. Which tracks get an `UP` mix

Isolated: **electric guitars, acoustic guitars, piano, organ, synth, bass, drums** — every
individual track of those kinds (`EG 1`, `EG 2`, `Keys 3`, `Órgano`…). Not isolated, but
present in every bed: loops, FX, pads, strings, choir/BGV stems, click, guide. `Full` is
always rendered.

`abletonnl`'s `families.toml` must gain rules before the backfill: the 2026-09-05 set
reported `Órgano` and `Cuerdas` as «unknown family», and `Pad`/`Synth`/`Cuerdas` need to land
in a non-isolated family (`keys` today swallows pads). That change lives in the
`abletonnl` repo — §11.

## 5. The contract between the two repos: `manifest.json`

`abletonnl` writes `manifest.json` per song folder. As of `abletonnl` commit `ef3004e`
(2026-09-20, this cycle) it carries everything the app needs — the real shape, not an
idealised one:

```jsonc
{
  "set":  { "path": "…/Amor sin Condición_144BPM_G Project/….als", "sha1": "b487…", "creator": "…" },
  "song": { "name": "2. NADIE", "start_beat": 1600, "end_beat": 2341.8, "duration_s": 330.0,
            "bpm_range": [83, 136], "sections": [ … ] },
  "transpose": { "semitones": 0, "suffix": "" },
  "families": { "EG 1": "electric", "Keys 1": "keys", … },
  "files": [
    { "path": "… - Full.mp3",    "kind": "full", "target": null, "gains": { … } },
    { "path": "… - EG 1 UP.mp3", "kind": "up",   "target": "EG 1", "family": "electric",
      "peaks":  [0, 3, 12, 40, …],                    // uint8 × 600, ISOLATED stem, before mixing
      "active": [[15.6, 16.8], [22.0, 24.8], …],      // seconds, from the renderer's active mask
      "gains": { … }, "target_gain_db": …, "normalize_gain_db": … }
  ],
  "warnings": [ … ]
}
```

`peaks` is the isolated stem's **peak** envelope (max |sample| per slice), 600 points,
quantised 0–255 against the stem's own loudest slice — gain-invariant, ~3–4 KB as indented
JSON. `active` lists the runs of the renderer's 0.4 s / 25 dB active mask as
`[start_s, end_s]`, the last clamped to the song. `Full` has neither. The MCP/CLI *result*
of `render_rehearsal_mixes` omits `peaks`; the manifest is the channel for it.

**There is no `key` in the manifest.** The set does not know the song's key; the render
folder name carries it (`…_144BPM_G`), and the ingest parses `tone` from there, falling back
to the `post`'s own `key` when the folder name has none. `bpm` comes from `song.bpm_range[0]`.

## 6. Model — a new array on `post`

```ts
rehearsalMixes: [{
  _key: string,          // deterministic: sha1(set.sha1 + basename(path)) — re-ingest updates, never duplicates
  kind: "full" | "up",
  track?: string,        // manifest `target`, "EG 1" — absent for "full"
  family?: string,       // "electric" — absent for "full"
  tone: string,          // "G" — from the folder name, else the post's `key`
  bpm?: number,          // song.bpm_range[0]
  audioFile: file,       // .mp3
  peaks?: number[],      // uint8 × 600 — absent for "full"
  active?: number[][],   // [[start, end], …] seconds — absent for "full"
  sourceHash: string,    // manifest set.sha1 — which render produced it
}]
```

**Separate from `audioTracks`.** That field already exists (title/tone/file) for reference
recordings and guide tracks; folding rehearsal mixes into it would leave no query able to
tell the two apart later. Delivery 2 adds `harmonyTracks[]` with the same shape.

**Read discipline.** `peaks` and `active` are projected **only** by the single-song read
(`/api/song/[id]`). The library list, the home page, setlists and every other `post` read
must never project `rehearsalMixes[]{peaks}` — 142 × 25 KB in a list response is 3.5 MB of
numbers nobody renders. A test greps the repo's `post` GROQ for the projection (§9).

The schema is Studio visibility only (the Content Lake is schemaless); the ingest script
writes the documents. Studio shows the array read-only-by-convention — editing 600 numbers
by hand is not a workflow.

## 7. Ingest — `scripts/ingest-rehearsal-mixes.mjs`

Same shape as `backfill-member-instruments.mjs`: dry-run by default, `--apply` to write,
run with `node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs <root>`. Uses the
existing `SANITY_WRITE_TOKEN`; **no new secret or env var** (nothing to add to
`docs/SECRETS.md`, stated here so nobody looks for the entry).

Per song folder under `<root>` (the SSD's render output):

1. Read `manifest.json`; skip with a warning if absent or missing `set.sha1`.
2. **Match** the folder to one `post`: `normalizeText(manifest.song.name)` (leading «N. » stripped) against
   `normalizeText(title)` over all posts, exact first, then the folder's leading name before
   `_<bpm>BPM_<key>`. Zero or several candidates → the folder goes to the **unmatched
   report** (`unmatched.json` beside the log, with the candidates) and nothing is written.
   A hand-written `matches.json` (`{ "<folder>": "<post _id>" }`) overrides matching for the
   next run.
3. For each file: if a `rehearsalMixes[]` item with the same `_key` already exists **and**
   the asset's `sha1` equals the local file's, skip (idempotent). Otherwise upload the MP3
   (`client.assets.upload('file', …)`, `filename` = the manifest file name) and build the
   item.
4. Write the full `rehearsalMixes` array for that post in one patch (`set`), replacing
   items whose `sourceHash` matches this manifest and keeping items from other renders
   (a song rendered in two keys keeps both). Orphaned assets from replaced items are
   deleted in the same run.
5. Log per folder: matched `_id`, files uploaded / skipped / replaced, bytes.

Dry run prints exactly the plan and the unmatched report; nothing else differs. The script
runs outside Next and does not revalidate — same convention as `retag-songs.mjs`: the
sheet's read (`/api/song/[id]`) is dynamic and shows new mixes at once, `/posts/[slug]`
follows within its `revalidate = 3600` window, and the script's final line says so.
Partial coverage is the normal state: batches are the unit of work.

## 8. Delivery and player

### 8.1 `/api/audio/[songId]/[key]/route.ts`

- Guard: `requireMinistryMember("worship")` — **the same call, verbatim, as
  `/api/song/[id]`**, because the catalog is a worship surface (a kids-only member must not
  reach a track by typed URL). 403 without it.
- Reads `*[_type=="post" && _id==$id][0].rehearsalMixes[_key==$key][0].audioFile.asset->url`
  through `serverClient`; 404 when absent.
- Answers `302` with `Cache-Control: private, no-store`. Never streams bytes.
- `?download=1` appends `?dl=<filename>` to the CDN URL (documented Sanity asset
  parameter: «append `?dl=<name>` to the asset URL» — blank name falls back to the original
  filename) so the browser saves instead of plays. The member's `<a download>` and the
  player's «Descargar» both point here; the page never holds a `cdn.sanity.io` URL.
- `post` is not a `protectedReadAudit` type, so the route reads it through `serverClient`
  like `/api/song/[id]` does. The `proxy.ts` matcher already covers `/api/*` outside
  `/api/cron`; nothing changes there.

### 8.2 `RehearsalPlayer` — `app/components/song/RehearsalPlayer.tsx`

Rendered on `app/(client)/posts/[slug]/page.tsx` and inside `SongSheet` when the sheet
has `rehearsalMixes`. Presentational; data comes down as props from the existing
single-song read (`SongSheetData` gains `rehearsalMixes?`).

- **Track list** grouped by family in the app's seat order (Bass, Keys, Drums, EG, AG),
  `Full` first. Each row: track name, a **waveform** (`<canvas>` from `peaks`, `active`
  spans painted in the accent token, the rest in `surface-accent`), and the playhead as
  a vertical line across the row that is playing. `Full` has no waveform (no isolated stem)
  — it shows the transport's plain progress bar.
- **One `<audio>`**, through `PlayerContext.playTrack` — the fixed `AudioTransport` keeps
  working as is. **Switching tracks keeps the position**: read `getAudio().currentTime`
  before `playTrack`, seek after `canplay`. Clicking a waveform seeks (`seek(fraction)`).
- **Preselection**: `Full`; if the session member has `instruments`, the first track whose
  family maps from their first instrument (`Bass→bass`, `Keys→keys`, `Drums→drums`,
  `EG→electric`, `AG→acoustic`). Preselection only highlights — nothing auto-plays.
- **Download** per row: `<a href="/api/audio/…?download=1" download>`; on native
  (Capacitor) the same link opens the share sheet, which is the offline story for
  delivery 1 — an in-app library with Filesystem caching is explicitly **out of scope**.
- Colour through tokens (`themeColour` for canvas fills, never a concatenated hex); every
  control a `Button`; motion through `--motion-*` only; touch targets and 16 px inputs
  per the repo invariants. No `useSession` inside — the page passes `preselect` down, so
  the component can host a theme-gallery fixture.

### 8.3 Empty state

A `post` without `rehearsalMixes` renders no player and no heading — same rule
`SongAudioSection` already follows for `audioTracks`.

## 9. Testing

- `rehearsalMatch.test.ts` — the matcher (pure): exact, accent-insensitive, `_BPM_` strip,
  ambiguity → unmatched, `matches.json` override.
- `rehearsalIngestPlan.test.ts` — the plan builder (pure, given a manifest + existing
  array): idempotent skip on equal sha1, replace on changed, keeps other `sourceHash`
  items, deterministic `_key`.
- `waveform.test.ts` — peaks → canvas path points and active-span painting (pure), plus
  the `family → seat` map pinned against `INSTRUMENT_SEAT_OPTIONS`.
- `audioRoute.test.ts` — 403 without worship membership, 404 on unknown key, 302 with
  `no-store`, `?download=1` → `?dl=` shape, and the `Location` host is `cdn.sanity.io`.
- `postPeaksProjection.test.ts` — greps every `post` GROQ under `app/**` and fails when
  `peaks` is projected anywhere but `/api/song/[id]`.
- `RehearsalPlayer.test.tsx` — track switch preserves `currentTime`; preselection by
  instrument; no autoplay; `document.activeElement` stays on the pressed row (the
  CueDialog focus lesson, ADR-0034, applies to any effect that could move focus).
- Existing guards must stay green: `clientBoundary`, `inputFontSize`, `themeGallery` (a
  `rehearsal` fixture hosts the presentational player), `bottomNavOffsetSync` (the player
  is in-flow, not fixed — nothing to add).

## 10. Delivery 2 (not designed here)

`harmonyTracks[]` on `post`, same item shape, ingested from the team's own recordings
(no `abletonnl`; a folder-per-song convention), rendered by the same `RehearsalPlayer`
under a second heading. The route and the read discipline already cover it.

## 11. Dependencies outside this repo — DONE 2026-09-20

All three landed in `abletonnl` (`feat/manifest-peaks-active`, commits `8cc2a28` + `ef3004e`,
171 tests under `-W error`, reviewed):
1. `families.toml`: `organ`, `synth`, `pad`, `strings` split out of `keys`, ordered after
   `bass` and before `keys`; `[oóÓā]rgano` covers the mojibake an `.als` carries for «Órgano».
2. `manifest.json`: per file `kind`; per `UP` file `family`, `peaks`, `active` (§5).
3. 192 kbps was already the encoder default — no change needed.

The SSD must be connected for a render + ingest session; the app never sees it.

## 12. Out of scope

R2 or any second storage platform · signed/expiring URLs · true stem playback with
solo/mute · an offline library inside the Capacitor app · transposed renders (the model
allows a second key per song; the pipeline renders one) · Studio-side upload UI · any
change to `audioTracks`.
