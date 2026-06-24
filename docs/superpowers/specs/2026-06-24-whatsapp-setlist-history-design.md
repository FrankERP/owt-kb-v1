# WhatsApp setlist history backfill — design

**Date:** 2026-06-24
**Status:** Draft (pending adversarial review + user approval)
**Repo:** owt-kb-v1 (Next.js + Sanity, song type = `post`)

## Problem & goal

The worship team's WhatsApp group (`Chat de WhatsApp con Colaboradores Alabanza`, exported to
`/Users/frankrocha/Downloads/Chat de WhatsApp con Colaboradores Alabanza.txt`, 24.5k lines,
Jan 2020 → Jun 2026) contains the **setlists** the team has used, posted as messages. Sanity
currently has only **12 recent history docs** (9 `featuredSongs` Apr–Jun 2026 + 3 `saturdarSongs`
May 2026), so the song-history feature ("last times this song was played, and in what key") has
almost no data.

Goal: extract the past setlists (**2022 → today**, ~283 detected), reconcile each song against the
catalog, surface songs not in the catalog for a per-song decision, then write the setlists as
Sanity history documents so they feed the song-history feature.

This is a **one-shot extraction + gated import** (scripts), not app code. No schema or UI changes.

## Target data model (existing, unchanged)

History is read by `getSongHistory` in `app/(client)/posts/[slug]/page.tsx`:
`*[_type in ["featuredSongs", "saturdarSongs"] && references($songId)] | order(week desc)`.

- **`featuredSongs`** = Sunday service. Fields: `week` (date), `songs[]` of
  `{ _type:"setlist_song", song: reference→post, play_key: string, _key }`.
- **`saturdarSongs`** = Saturday service. Same shape. **Note the schema's name is the typo'd
  `saturdarSongs`** — that is the `_type` the feature reads, so Saturday docs MUST be written as
  `saturdarSongs` (NOT `saturdaySongs`; one orphaned `saturdaySongs` doc exists and is ignored by
  the feature — leave it alone).

We write new docs of these two types. We never modify `post`, schema, or UI.

## Scope

- **Date range:** setlists whose **service date** is **2022-01-01 → today**. (2020–21 excluded per
  user; ~18 setlists, available later if wanted.)
- **Volume:** ~283 setlist docs (verified: 2022:53, 2023:51, 2024:61, 2025:79, 2026:39) — but the
  exact count drops after section-splitting/merging and after skipping the 13 already-present weeks;
  the dry-run reports the real number. Each doc ~700 bytes → ~200 KB total; well within Sanity
  limits (project at ~374 documents total across all types today, of which 127 are `post`). No
  assets created.

## Pipeline

Three units, mirroring the catalog-import / author-migration shape (pure lib + tests, then a
two-phase gated runner).

### 1. Chat parser — `scripts/lib/whatsapp-setlists.mjs` (pure, unit-tested)

- `parseMessages(text)` → `[{ date: "YYYY-MM-DD", sender, body }]`. WhatsApp line format:
  `D/M/YYYY, H:MM a. m./p. m. - Sender: text`. Lines NOT starting with the timestamp are
  **continuation lines** of the previous message (setlists are usually one multi-line message).
  **CRITICAL:** this export uses a narrow no-break space (U+202F) between the time and `a./p.` and
  between `a./p.` and `m.` (verified via `od -c`: bytes `342 200 257`). An ASCII-space timestamp
  regex matches **zero** lines — the regex MUST treat those gaps as `\s`/`[  \s]+` (or
  normalize whitespace first). Parse `D/M/YYYY` with `Date.UTC` to avoid TZ drift. The `parseMessages`
  unit test MUST use a fixture copied verbatim from the export (with the real U+202F bytes), not a
  hand-typed line, or the bug hides behind ASCII spaces.
- `detectSetlists(messages)` → `[{ messageDate, body, songLines }]`. A setlist message is one whose
  body contains **≥3 lines matching a song-with-key pattern** (`/\(([A-G](#|b)?m?)\)/` — `(D)`,
  `(F#)`, `(Bb)`, `(Am)`). **Do NOT filter on `messageDate` here.** Scope filtering happens on the
  computed **`serviceDate`** (≥ 2022-01-01) AFTER `serviceDateFor`, so a late-Dec-2021 message for an
  early-Jan-2022 service is kept and a Jan-2022 message for a Dec-2021 service is excluded. (Scan all
  messages; the serviceDate filter is the scope gate.)
- **Section splitting (one message → possibly several services).** A single message frequently
  contains BOTH a `Sábado` block and a `Domingo` block (verified: ~29 messages have a `Sábado`
  heading and a `Domingo` heading each followed by its own song list). `splitSections(block)`
  therefore splits a detected block on **day-heading lines** — a short line that is essentially
  `Sábado`/`Domingo` (optionally followed by a date, e.g. `Domingo 16 enero`, `Sábado 13`) — into
  one sub-block per heading. Song lines are attributed to the heading they fall under. A block with
  no day heading is a single sub-block whose type is inferred (below). Each sub-block becomes its
  own candidate setlist.
- `parseSongLine(line)` → `{ rawName, key }`. `key` = the **LAST** `([A-G](#|b)?m?)` parenthetical
  on the line (NOT the first — lines like `Sólo tu amor (Need your love) - Y&F (C)` have two
  parens; the key is the trailing one). `rawName` = the text before that key paren, minus a leading
  `-`/`•`/number/`Sender:`, minus a trailing `- Artist`/`NN BPM`/`Dirige …`/`| eeyev` tail. Lines
  whose only `(…)` is not a key (or that are clearly prose, e.g. `Amigos! Les mando la jugada…`)
  are dropped, not treated as songs.
- `serviceDateFor(sectionHeading, messageDate)` → `{ serviceDate: "YYYY-MM-DD", type, confidence }`.
  Priority order (verified: 178/283 bodies carry an explicit in-body date):
  1. **Explicit in-body date** in the heading/body — Spanish day-of-month + month name
     (`16 enero`, `25 junio`, `3 de Julio`, `Sábado 13`). Parse to a real date; infer the year from
     `messageDate` (roll to next year when the month is earlier than the message month near
     year-end). `confidence:"explicit"`.
  2. **Day word only** (`domingo`/`sábado`, accent-insensitive) → the **first matching weekday on or
     after `messageDate`**. `confidence:"day-word"`.
  3. **Neither a date nor a day word** (e.g. `para este fin`, or no signal at all — ~51 of 283, 18%,
     typically posted midweek) → **default `type = featuredSongs` (Sunday)** and
     `serviceDate = the nearest Sunday on/after messageDate`. Rationale: the team runs both services
     but Sunday dominates (9 of the 12 existing real docs are Sunday), and "the message's own
     weekday" is meaningless midweek. `confidence:"inferred"`.

  `type` = `featuredSongs` for Sunday, `saturdarSongs` for Saturday. **Conflict rule:** when an
  explicit date AND a day word are both present and disagree (e.g. heading says `Domingo 13` but the
  13th that year is a Saturday — a data-entry slip), do **not** guess: keep the explicit date but set
  `confidence:"conflict"` and surface the row in the report for the user to resolve the type/date.
  Every `inferred`, `day-word`, and `conflict` row is listed in the dry-run report for the user to
  confirm/correct before any write; only `explicit` rows whose weekday matches their day word are
  treated as high-confidence.

### 2. Catalog matcher — `scripts/lib/setlist-match.mjs` (pure, unit-tested)

- `buildCatalogIndex(posts)` → a Map from `normalizeForMatch(key)` → postId, indexing for EACH post
  its **full title**, its **Spanish part** (before the first `(`/`[`), and its **English part**
  (inside the first `(...)`). This catches both `Wake`→*Vives En Mí (Wake)* and the Spanish name.
  `normalizeForMatch` (existing) strips accents/punctuation/case.
- `ALIASES` — a curated map (normalized chat name → postId or canonical title) for cases the
  bilingual index can't catch (e.g. `avivanos`, abbreviations, medleys). Seeded during the dry-run
  from the unmatched report; the genuinely-non-catalog songs (e.g. *Avívanos* by Generación 12)
  are NOT aliased — they go to the user's per-song decision.
- `matchSong(rawName, index, aliases)` → `{ postId }` or `null`. Tries alias → exact normalized →
  bilingual-part normalized. Ambiguous (same normalized name maps to >1 post) → returns the
  candidates for the report, never a silent pick.

### 3. Runner — `scripts/import-setlist-history.mjs` (two-phase, gated)

**Phase A — dry-run (writes nothing).** Reads the chat + the catalog from Sanity, runs parse →
detect → **split sections** → service-date → match, and emits a report + a `setlist-plan.json`:
- Per **sub-block** (one per service): service date, type, **date confidence**
  (`explicit`/`day-word`/`inferred`), matched songs (`postId` + `play_key`), unmatched song names,
  and the original message date — so a mis-parsed date/type is visible.
- **Distinct unmatched songs** (deduped across all setlists) — the list the **user resolves per
  song** (alias to an existing post / mark for catalog-add / skip).
- **Weeks already in Sanity** for that `(type, week)` → flagged **SKIP** (dedup; never overwrite
  the 13 existing docs).
- **Collisions:** two sub-blocks resolving to the same `(type, serviceDate)` → flagged for the user
  to merge or correct (do NOT silently drop). Note explicit-date parsing prevents the common
  false-collision where two setlists for different future weekends were posted the same day.
- **Low-confidence flags:** every `inferred`/`day-word` date and every block that lost a section
  split is listed up top so the user can eyeball the riskiest ~rows first.
- Stats: setlists by year, total/matched/unmatched song counts, # docs that will be created.

The plan/decisions file shapes are pinned in code before Phase B: `setlist-plan.json` is an array of
`{ messageDate, serviceDate, type, confidence, songs:[{ rawName, key, postId|null, candidates? }] }`;
the per-song decisions file is `{ "<normalized unmatched name>": { action:"alias"|"skip"|"add", postId? } }`.
Phase B fails loudly if the decisions file leaves any surfaced unmatched name unresolved.

**Phase B — apply (`--apply`, after approval).** Reads the approved plan + the user's unmatched
decisions, and for each setlist NOT already in Sanity, `client.create` a `featuredSongs` /
`saturdarSongs` doc with `week` = service date and `songs[]` = `{ _type:"setlist_song", _key,
song:{_type:"reference",_ref:postId}, play_key }` for each matched (or user-aliased) song;
skipped songs are omitted. Idempotency guard: before creating, re-check no doc of that type+week
exists (so a re-run does not duplicate).

## Decisions (from the user)

- **Service day:** from the message text ("for/this Saturday/Sunday" → the next immediate
  Sat/Sun), weekday fallback.
- **`week`:** the **service date**, not the message's posted date.
- **Unmatched songs:** reported as a **distinct list**; the user decides **per song** before any
  write. (No auto-create.)
- **Dedup:** skip any week+type that already has a Sanity doc.

## Edge cases

- **One message, two services** (`Sábado …` + `Domingo …` sections) → split into two sub-blocks by
  `splitSections` (the round-1 blocker). Verified on ~29 messages.
- **Ahead-posted setlists with explicit future dates** (`Domingo 3 Julio` posted in June) → use the
  parsed in-body date, not the next weekend (the round-1 collision blocker). Verified 178/283.
- **Planning chatter** (esp. 2021-era: per-person/per-date assignments scattered across many short
  messages) → mostly excluded by the ≥3-key-lines-in-one-message threshold and the 2022 fromDate;
  any that slip through are flagged low-confidence in the report for the user to discard. The
  pipeline does NOT try to reconstruct setlists from scattered single-line messages.
- Messages with `(Key)`-looking lines that aren't setlists (prose, a single quoted song) → ≥3-line
  threshold filters most; the rest appear in the report.
- Medleys / "X / Y" on one line → parsed as the line's name; if unmatched, surfaces in the report.
- Key formats kept verbatim (`play_key` is free-text). Songs with no key → listed with empty
  `play_key` IF clearly a song, else dropped.
- Deleted messages (`Se eliminó este mensaje.`) and join/system lines → never match the setlist
  threshold; ignored.
- **Catalog duplicates / shared English titles** the matcher will surface as ambiguous (verified):
  `Amor Sin Condición` (2 post `_id`s), `Dios Es Amor` (2 `_id`s), and `Worthy Is The Lamb` (the
  English part is shared by *Digno Es El Señor* and *Digno Eres Señor*). The matcher returns
  candidates (never silent-picks); the report renders them for the user to choose, and flags the
  duplicate `post`s as a data-quality note.
- **Prose glued to the first song line** (e.g. `…Porfa ensayen! Solo en Jesús - Darlene (D)` on one
  physical line) → that one song's `rawName` becomes the whole sentence and won't match; it shows up
  as an odd unmatched string in the report (≈1 message). The user can fix it in the plan before apply.

## Testing

- Unit tests for `parseMessages` (timestamp + continuation-line reassembly), `detectSetlists`
  (≥3 threshold, fromDate filter), `splitSections` (a body with both `Sábado …` and `Domingo …`
  headings → two sub-blocks with the right songs under each; a body with no heading → one block),
  `parseSongLine` (real shapes incl. the two-paren case `Sólo tu amor (Need your love) - Y&F (C)`
  → name `Sólo tu amor`/key `C`; `-Wake (D) Dirige X`; `Infinito Dios | eeyv (C)`;
  `Cordero y león (B) - Bethel Music 90 BPM`), and `serviceDateFor` (explicit in-body Spanish date
  `Domingo 3 Julio`/`Sábado 25 junio` incl. year rollover; day-word→next weekday; inferred
  fallback; correct `type` from the resolved weekday).
- Unit tests for `buildCatalogIndex` / `matchSong` (bilingual match `Wake`→*Vives En Mí*,
  `The stand`→*Aquí Estoy*; ambiguity returns candidates; genuine miss returns null).
- Manual: review the dry-run report (setlist count by year, distinct unmatched list, skipped
  weeks) before `--apply`.

## Out of scope

- 2020–21 setlists (available as a later re-run).
- Creating catalog `post`s for non-catalog songs (the user decides; a separate step if wanted).
- Any schema/UI change, including fixing the `saturdarSongs` typo or the orphaned `saturdaySongs`
  doc (flagged, not touched).

## Key files

- Create: `scripts/lib/whatsapp-setlists.mjs` (+ tests).
- Create: `scripts/lib/setlist-match.mjs` (+ tests).
- Create: `scripts/import-setlist-history.mjs` (dry-run + apply).
- Input: the chat `.txt` is **inside** `~/Downloads/Chat de WhatsApp con Colaboradores Alabanza.zip`
  (the bare `.txt` does NOT persist in Downloads). The runner extracts
  `Chat de WhatsApp con Colaboradores Alabanza.txt` from that zip to a working path (e.g.
  `/tmp/owt-chat/…`) at start, then reads it. Do not assume a pre-extracted `.txt`.
