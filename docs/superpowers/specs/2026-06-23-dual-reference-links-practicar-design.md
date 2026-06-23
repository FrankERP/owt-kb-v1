# Dual reference links + Música/Letras Practicar — design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Repo:** owt-kb-v1 (Next.js + Sanity, song type = `post`)

## Problem & goal

The worship team catalog (`~/Downloads/ContentUpdateProject/oasis-songs.xlsx`, 120 songs)
now carries two distinct YouTube references per song:

- **Musical reference** (`MUSICALreferenceLink_url`) — the mix musicians rehearse with.
  Present for every song.
- **Spanish-lyrics video** (`LyricsReference_Link`) — the lyric version the team sings.
  Optional; the cell holds `"n/a"` when none exists.

We need to:

1. Model these two links as first-class data on `post`.
2. Display both on the song page in a clear, sleek way.
3. Make the existing set-level **Practicar** button offer a choice between a **Música**
   mix and a **Letras** mix (lyrics video per song, falling back to the musical
   reference where no lyric video exists).
4. Import the sheet into Sanity as an **upsert** — match existing songs and update only
   what should change — without creating duplicates or clobbering curated content.

Sanity already contains **56 `post` documents**, many overlapping the catalog with messy
differences (casing, accents, added or richer English subtitles, author typos, and at least
one real same-title/different-song collision: *Amor Sin Condición* by Marco Barrientos
**and** by Cory Asbury). This makes safe matching the heart of the import.

## Data model (Sanity `post` schema)

Add two dedicated URL fields to `sanity/schemas/post.ts`:

- `musicalReferenceUrl` (`url`) — musical reference mix.
- `lyricsVideoUrl` (`url`) — Spanish-lyrics video.

The legacy generic `referenceLinks[]` array **stays** in the schema (do not delete), but is
no longer the primary source. All readers prefer the two new fields and **fall back** to
`referenceLinks` / `tutorials2` so the ~12 existing non-catalog songs keep working until
they are individually touched.

Both new fields are added to the in-app editor (`EditSongButton`) so a bad link is fixable
without re-running the import. (Editor support in `SongFormModal` is optional/secondary.)

## Import — reconciliation, never blind writes

New script: `scripts/import-catalog.ts` (run with the repo's Sanity client + write token).
Two phases.

### Phase A — dry-run report (default; writes nothing)

1. **Read** the sheet (`oasis-songs.xlsx`, sheet "Songs"). Skip blank rows. Treat link
   cells equal to `"n/a"` (case-insensitive) or empty as absent.
2. **Normalize** title and author for matching:
   - lowercase
   - strip diacritics (á→a, ñ→n, etc.)
   - drop parenthetical/bracket subtitles — `(...)` and `[...]`
   - strip punctuation, collapse whitespace
3. **Match** each sheet row against the 56 existing posts on normalized title:
   - exactly one candidate → **MATCHED**
   - multiple candidates → disambiguate by normalized author; if still >1 (or none of the
     authors match) → **AMBIGUOUS** (operator resolves)
   - no candidate → **NEW**
4. **Print** a report with per-field diffs and write the resolved plan to
   `import-plan.json` (operator may hand-edit the matched `_id` for ambiguous rows).

Buckets in the report look like:

```
MATCHED (update):    Cielo Y Tierra            -> Cielo y Tierra (Conquistando Fronteras)
AMBIGUOUS (resolve): Amor Sin Condición        -> [Marco Barrientos] | [Cory Asbury]
NEW (create):        Es Navidad, Habitación, Socorro, …
```

### Phase B — apply (`--apply`; reads the approved `import-plan.json`)

Field-write policy on a **matched** song:

| Field | Policy |
|-------|--------|
| `musicalReferenceUrl` | always set from sheet (skip if sheet value absent) |
| `lyricsVideoUrl` | always set from sheet when present; skip when `"n/a"`/absent |
| `key` | **sheet wins** — overwrite when sheet has a value and it differs |
| `bpm` | **sheet wins** — overwrite when sheet has a value and it differs |
| `timeSig` | fill only when the existing value is empty |
| `title`, `author` | keep existing; conflicts are **reported only**, never auto-changed (protects richer existing titles, e.g. `El Gran Yo Soy (The Great I Am)`) |
| `tags` | **union** (add missing), with the tempo-cleanup rule below |
| `body`/lyrics, `audioTracks`, `chords`, `tutorials2`, `referenceLinks` | **never touched** |

**NEW** songs are created with the same field logic (title/author/key/bpm/timeSig + the two
URLs + normalized tags). Slug is generated as the app does: `${title}-${author}` slugified.

### Tag handling

- Tags are stored as references to `tag` documents (`name` + `slug`). Look up by normalized
  name; create the `tag` document if missing.
- **Union** with existing tags — never remove a thematic tag.
- **Tempo cleanup rule:** `Alabanza` and `Adoración` are stray duplicates of the tempo
  notation. Drop them entirely; tempo is conveyed *only* by `Up Beat` / `Down Beat`. This
  applies to both the sheet's tags and the merged result (the one case where the merge
  removes a tag). Verified: all 20 sheet songs carrying `Alabanza` already have a tempo
  tag, so none are left tempo-less by the drop. (0 songs carry `Adoración`.)
- **Flag, don't guess:** `Desde Mi Interior (From The Inside Out)` has **no** tempo tag in
  the sheet at all (`Rendición, Gracia de Dios`) — independent of the cleanup rule. List it
  in the report for a manual decision rather than inventing a tempo.

## Practicar — set-level button, two options

`PracticePlaylistButton` becomes a small two-item menu: **🎵 Música** and **🎤 Letras**
(see mockup). The API `/api/practice-playlist` takes a `mode` param:

- `musica` → `musicalReferenceUrl` per song; fall back to legacy `referenceLinks` /
  `tutorials2`.
- `letras` → `lyricsVideoUrl` per song, **falling back to the musical reference** where no
  lyric video exists.
- Build the same no-auth `youtube.com/watch_videos?video_ids=…` playlist, one video per
  song, in setlist order (existing behavior).

The GROQ projection in the route is extended to fetch `musicalReferenceUrl` and
`lyricsVideoUrl` alongside the legacy fields.

## Per-song display ("display both, sleek")

Replace the flat "Versión de referencia" link row on `app/(client)/posts/[slug]/page.tsx`
with two labeled cards (navy/cyan, matching the app):

- **🎵 Referencia musical** — shown when `musicalReferenceUrl` (or a legacy reference) exists.
- **🎤 Versión con letra** — shown only when `lyricsVideoUrl` exists.

Each card opens its video in a new tab. The section's `show` gate becomes
"has musical reference OR has lyrics video OR has legacy referenceLinks".

## Testing

- Unit tests for the normalize/match logic covering the real cases: casing
  (`Cielo Y Tierra`/`Cielo y Tierra`), accents (`Sólo`/`Solo`), subtitle differences
  (`Donde Tú Estás` vs `… (Where You Are)`), author typos (`Elevantion`/`Elevation`),
  and the same-title collision (`Amor Sin Condición` ×2 → AMBIGUOUS).
- Unit tests for the tag tempo-cleanup (drop `Alabanza`/`Adoración`, keep tempo) and the
  tempo-less flag.
- Unit test for the playlist `mode` fallback (`letras` → música when no lyric video).
- Manual: run Phase A against the live 56 docs and eyeball `import-plan.json` before any
  write.

## Out of scope

- Round 2: lyrics/body extraction from `Catálogo de letras_Oasis.pdf`.
- Bulk-editing existing non-catalog songs (`Infinito Dios`, `Sublime Gracia`, etc.).
- Migrating existing `referenceLinks[]` into the new fields for non-catalog songs (handled
  lazily by reader fallback).

## Key files

- `sanity/schemas/post.ts` — add two URL fields.
- `scripts/import-catalog.ts` — new; dry-run + apply.
- `app/api/practice-playlist/route.ts` — `mode` param + new field projection/fallback.
- `app/components/PracticePlaylistButton.tsx` — two-item menu.
- `app/(client)/posts/[slug]/page.tsx` — two-card reference display.
- `app/components/EditSongButton.tsx` — edit the two new fields.
- `app/utils/interface.tsx` — extend the `Post` type.
