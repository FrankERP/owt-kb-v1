# Multi-author references + filtering — design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Repo:** owt-kb-v1 (Next.js + Sanity, song type = `post`)

## Problem & goal

Songs currently store a single `author` **string**. Some songs genuinely have multiple
artists (original artist + Spanish-cover artist, e.g. `Matt Redman, En Espíritu Y En Verdad`),
and the team wants to **filter songs by author** the same way they filter by tag. A single
string can't model multiple distinct, canonical, filterable artists.

Goal: model authors as **reference documents** (mirroring the existing `tag` system), support
multiple authors per song, add author filter pages, and migrate the existing 127 songs —
applying the richer multi-author values from the catalog spreadsheet along the way.

This supersedes the single-string author for *filtering* while keeping it for *display*.

## Data model

- **New `author` document type** (`sanity/schemas/author.ts`) — `name` (string) + `slug` (slug
  from name). Identical shape to `sanity/schemas/tag.ts`. Register in `sanity/schema.ts`.
- **`post.authors`** — `array` of `reference` to `author` (mirrors `post.tags`). **This is the
  single source of truth** for who authored a song.
- **`post.author` (existing string) is KEPT as a denormalized value** maintained as the
  canonical author names joined by `, `. It is used for: (1) **slug generation** (both
  generators read a flat string — see Slug), (2) **display in the ~13 components this plan does
  NOT touch** (setlist editor, proposals, services, admin cards, song lists, song-sheet,
  navbar), (3) **substring search** (`SongSearchList`, `ContentPanel`). It is rebuilt by the
  app editor and by the migration from `authors[]`.

### Drift — handled honestly (corrects an earlier false "cannot drift" claim)

- **New / modified UI reads `authors[]` directly** (song-page chips, `/author` pages), so it can
  never be stale regardless of the string.
- The denormalized `author` string is rebuilt on every write through the **in-app editor**. There
  are **two** editor write paths — `app/components/EditSongButton.tsx` and
  `app/components/admin/SongFormModal.tsx` — and **both** must recompute it identically.
- **Accepted limitation:** editing `authors[]` directly in **Sanity Studio** does NOT recompute
  the string, so the untouched legacy display components could show a stale author until the song
  is next saved through the app. The team edits songs via the app, not Studio, so this is
  acceptable. (Optional future safeguard, out of scope: a Sanity document action / validation that
  flags or recomputes the mismatch.)

## Filtering & pages (mirror `/tag`)

- **`/author`** — index page listing all authors with song counts. Mirrors
  `app/(client)/tag/page.tsx`.
- **`/author/[slug]`** — lists all songs by one author. Mirrors
  `app/(client)/tag/[slug]/page.tsx` (same `SongSearchList` rendering).
- **Song page** (`app/(client)/posts/[slug]/page.tsx`) renders **clickable author chips** from
  `authors[]`, each linking to `/author/[slug]`, styled like the existing `#tag` chips.

## Editor

- Both editors gain a **multi-select author picker** mirroring the tag selector (search/filter,
  toggle on/off), submitting `authorIds[]` like `tagIds[]`.
- **"Add a new author" precedent differs between the two editors** (verified): only
  `SongFormModal` has a create-tag flow today (`canCreateTag`/`handleCreateTag` → a content/tags
  route), consumed by `ContentPanel` and `SetlistEditor`. `EditSongButton` has filter+toggle only.
  So: `SongFormModal` gets **add-a-new-author** (mirroring its tag create); `EditSongButton` gets
  **filter+toggle only** (matching its current tag behavior). Don't invent a create affordance
  `EditSongButton` doesn't already have.
- **New route `app/api/content/authors/route.ts`** (GET list + POST create), mirroring the
  existing tags route, so the picker can list and create authors. Its POST `slugify` must match
  the migration's so both converge on one doc per author.
- The create/update routes own the denormalization (one source, not the two client
  `buildPayload`s):
  - accept `authorIds?: string[]`,
  - **fetch the selected author docs' names** (one GROQ lookup) and from them write `authors` as
    references (submitted order) **and** the denormalized `author` string = names joined by `, `,
  - `POST` then builds the slug from that computed string (PATCH builds no slug — see Slug).
- **The free-text "Artista" input is REMOVED from both editors** (replaced by the author picker).
  Both `buildPayload`s **always send `authorIds` (even `[]`)** and stop sending a free-text
  `author`. The routes branch precisely on **`if (body.authorIds != null)`** (present, including the
  empty array) → recompute `authors` refs + the `author` string from the refs and **ignore any
  submitted `author`**; **else** → legacy `author`-string handling, untouched. Branching on
  `authorIds` presence (not on `author` being empty) is required so that selecting zero authors
  writes `author: ""` deliberately, while a non-author code path that omits `authorIds` never wipes
  a curated string. There is exactly one writer for the string, so the two clients can't disagree.
- Pre-population: the song page already passes its `post` to `EditSongButton`, so adding
  `authors[]->{_id,name}` to the **song-page GROQ** (needed anyway for chips) also feeds that
  picker — one projection change, not two. `GET /api/content/posts` (admin lists / the modal's
  source) needs the same `authors[]->{_id,name}` added (today it selects only the `author`
  string). The `/author/[slug]` list page does NOT need `authors[]->` — its cards render the
  denormalized string via `SongSearchList`.

## Slug

**No slug logic changes, and the migration never rewrites slugs.** Slugs are built **only at
create time**, by `POST /api/content/posts` (`route.ts:67`), from the `author` string. The
**PATCH route builds no slug at all**, and the migration only patches `authors`/`author` — so
**existing slugs are frozen and all current URLs keep working** (that's *why* URLs survive — not
because two generators agree). The one change: the POST route computes the `author` string from
`authorIds` (the name lookup above) before building the slug, exactly as it builds the string
today. The Studio schema source (`sanity/schemas/post.ts`) still reads `doc.author` and is
unaffected. The migration must NOT regenerate slugs — a comma-joined multi-author slug
(`sublime-gracia-marcos-witt-marco-barrientos-marcos-vidal`) would be ugly and would break the
live URL.

(No "first author in slug" special-casing is needed. Note: no two posts share an **identical raw
title**, but two pairs share a **normalized** title — *Dios Es Amor* / *Dios Es Amor (Our God Is
Love)* and the two *Amor Sin Condición* — disambiguated by the parenthetical English in the raw
title. The migration's per-`_id` conversion is unaffected; only the xlsx cross-reference must
match on title+author to handle these clusters, as specified above.)

## Migration (one-shot script, gated like the catalog import)

`scripts/migrate-authors.mjs`, two phases (dry-run report → apply), reusing the
catalog-reconcile normalize helpers.

**Primary source = each post's STORED `author` string** (all 127 posts). The migration parses
and canonicalizes that string into author refs. This needs **no re-matching against the xlsx**
and no title matching — it reads what is already on each doc — so it cannot mis-target a song
(the *Dios Es Amor* pair share a normalized title, which is exactly why title-based re-matching
is avoided). The 71 import-created songs already carry their full multi-author strings (e.g.
`Leeland, Bethel`), so converting the stored string captures those automatically.

**The xlsx is used ONLY to SURFACE divergences for approval — never to silently overwrite.**
The dry-run cross-references `~/Downloads/ContentUpdateProject/oasis-songs.json`. It matches each
xlsx row to its post with **`matchRow` (normalized title + author)** from
`scripts/lib/catalog-reconcile.mjs`, NOT exact or normalized-title-only — because two title
clusters collide when normalized (`dios es amor`: *Dios Es Amor* / *Dios Es Amor (Our God Is
Love)*; `amor sin condicion`: the two *Amor Sin Condición*). Title-only matching would
mis-attribute. The comparison is done on **canonicalized author sets** (so case/alias variants
don't show as false diffs).

Divergences after canonicalization (verified against live data):
- `Somos Libres` — xlsx adds `Matt Redman` (stored: `En Espíritu y En Verdad`) → **add** (opt-in).
- `Vamos A Cantar (Sing Sing Sing)` — xlsx adds `En Espíritu y En Verdad` (stored: `Chris Tomlin`)
  → **add** (opt-in).
- `Dios Está Aquí` — **CONFLICT**: stored `En Espíritu y En Verdad` vs xlsx `Miel San Marcos`
  (different artist). Default = **keep stored**; only changes if the operator says so.
- `Libre Soy (Let Go)` — stored `Hillsong Young & Free` vs xlsx `Hillsong Y&F`: **benign**,
  auto-resolves to one author via the merge map; listed only so the dry-run's row isn't a
  surprise. No action.

Default policy: **never drop a stored (curated) author; only ADD xlsx co-authors when they are a
strict superset, and even then only after the operator confirms the 2 additions.** This satisfies
the "update songs with more authors" ask without the silent-overwrite hazard.

**Parsing:** split the author string on **commas** only (the multi-author separator). Names
containing `&`, `y`, or `Y` are single entities and must NOT be split
(`Hillsong Y&F`, `Majo y Dan`, `En Espíritu Y En Verdad`). Verified against the live data: the
comma is the ONLY separator actually used.

**Canonicalization — TWO maps, resolved by dedupeKey (not by raw):**
A naïve "merge map keyed on raw" is buggy: the *canonical-spelled* member of a cluster (e.g.
`Hillsong Young & Free`) misses a raw-keyed map and then loses a frequency vote to its own
abbreviation (`Hillsong Y&F`, 10×), rewriting the correct name to the abbreviation. So the pipeline
uses two maps and always resolves the display name from the **dedupeKey**:

```
ALIAS         = { "hillsong yf": "hillsong young free", "bethel": "bethel music" }   // variant normKey -> canonical normKey
KEY_CANONICAL = { "hillsong young free":"Hillsong Young & Free",
                  "bethel music":"Bethel Music",
                  "en espiritu y en verdad":"En Espíritu y En Verdad" }              // dedupeKey -> display name

dedupeKey(raw)     = ALIAS[ normalizeForMatch(raw) ] ?? normalizeForMatch(raw)
canonicalName(raw) = KEY_CANONICAL[ dedupeKey(raw) ] ?? deterministicPick( dedupeKey(raw) )
```

- `ALIAS` collapses spelling aliases whose *normalized* forms differ (`hillsong yf` ≠
  `hillsong young free`; `bethel` ≠ `bethel music`) into one dedupeKey. Pure case/accent variants
  (`En Espíritu Y/y En Verdad`) already share a normalized key and need no ALIAS entry.
- `KEY_CANONICAL` pins the display name **per dedupeKey**, so every member of a cluster — including
  the canonical-spelled one — resolves to the same name. Verified on live data: `Hillsong Young &
  Free`, `Bethel Music`, and `En Espíritu y En Verdad` (lowercase `y`, correct Spanish) all win;
  `Libre Soy`'s stored `Hillsong Young & Free` is **not** regressed.
- `deterministicPick(dedupeKey)` = most-frequent raw spelling (ties → lexicographically smallest).
  It runs for every author **not** pinned in `KEY_CANONICAL` — i.e. the ~33 single-spelling
  authors, where it trivially returns their one spelling (identity). Its disambiguation role is
  never exercised today because the only multi-spelling cluster (EEYEV) is pinned; so the result
  is fully deterministic and the apply phase is **genuinely idempotent**. (Don't treat a
  `deterministicPick` call as an anomaly — it's the normal path for single-spelling authors.)

The author doc is created with `name = canonicalName` and looked up/created by `dedupeKey`.

The dry-run report **clusters every `dedupeKey` with its raw variants and the canonical name it
resolves to**, plus per-song author counts, so an unmapped variant is visible before any write.
It also **asserts the expected author-doc count = 35** (37 distinct normalized keys minus the **2
ALIAS collapses** — `hillsong yf`+`hillsong young free` and `bethel`+`bethel music`; the EEYEV seed
reduces no keys, it only pins a display name; verified), so an accidental over/under-merge is caught. The map must NOT
merge genuinely distinct similar names (`Marcos Witt`, `Marco Barrientos`, `Marcos Vidal` get
three distinct keys — verified — and stay three authors). Approval-gated.

**Canonicalization rewrites some stored display strings** — expected and operator-visible. The
dry-run lists every song whose recomputed `author` string differs from its stored one; this is a
**meaningful batch — exactly 18 songs (verified), not "a few"**: 10 `Hillsong Y&F` →
`Hillsong Young & Free`, 7 uppercase `En Espíritu Y En Verdad` → lowercase `y`, and 1
`Cordero Y León` `Leeland, Bethel` → `Leeland, Bethel Music`. All are the same artists under one
canonical spelling.

**Apply phase (idempotent — patches only, never creates posts):**
- create/lookup `author` docs by `dedupeKey` (dedup). Author-doc slugs use **one shared
  `slugifyAuthor` helper imported by BOTH `POST /api/content/authors` and the migration** (pin the
  single source — do not let each write its own), so the editor and migration converge on one doc
  per author. Since author slugs are brand-new (no legacy to preserve), `slugifyAuthor` should
  transliterate diacritics via NFD (`Un Corazón` → `un-corazon`, not the tags-route's lossy
  `un-corazn`), and collapse `&`/repeated separators to a single `-`. Whatever it does, both paths
  use the identical function, verified by a test asserting equal output on both.
- set each post's `authors[]` references,
- recompute and set the denormalized `author` string (names joined by `, `, in source order),
- never touches any other field.
- Safe to re-run: author-doc lookup is normalized-key-first (no duplicate docs), and posts are
  patched (not created), so a second run is a no-op on already-migrated songs.

**Order note:** for the 2 superset songs the rebuilt `authors[]`/string follow the xlsx order,
which flips display order for *Vamos A Cantar* (`En Espíritu y En Verdad, Chris Tomlin`). Shown in
the dry-run; harmless, operator-visible.

## Phase ordering (must not reorder)

The app must never show empty author pages/pickers. Build strictly in this order:
1. **Schema** — `author` type + `post.authors[]`, registered; regenerate Sanity TypeGen types.
2. **Migration apply** — creates `_type:"author"` docs + refs + rebuilds the `author` string
   (after the dry-run report is approved). The Content Lake is schemaless, so author docs need
   **no Studio schema deploy** to be written/queried — don't gate this on a deploy.
3. **Read side** — song-page chips, `/author` + `/author/[slug]` pages, GROQ `authors[]->`.
4. **Editor + API** — multi-select picker, `authorIds` write path.

Steps 3–4 must not ship before step 2, or author pages render empty and the picker has no options.

## Edge cases & housekeeping

- **Empty authors:** a song with no authors → `authors[]` empty → `author` string `""`. Display
  sites already guard `{author && …}`. Slug becomes `title-` (trailing dash) — acceptable and
  matches today's empty-author behavior.
- **Studio preview bug:** `sanity/schemas/post.ts` preview renders `${title} - ${author}`, which
  shows `Title - undefined` when author is empty. Fix the preview to omit the dash when author is
  blank (small in-scope fix since we touch this file).
- **TypeGen is NOT wired** (verified): no `sanity.types.ts`, no `schema:extract`/`typegen`
  scripts, and `post.ts` is a plain object (not `defineType`). The only type that matters is the
  hand-written `Post` in `app/utils/interface.tsx` — edit that, nothing to regenerate. (New
  `author.ts` should still use `defineType`, mirroring `tag.ts`.)
- **`/author` pages ISR:** mirror `/tag` exactly — `export const revalidate = 60` and **nothing
  else**. The tag pages have **no** `generateStaticParams` (verified: `tag/page.tsx`,
  `tag/[slug]/page.tsx` are pure ISR). Do not add one — it isn't a real precedent and it would
  drag in the empty-`authors[]` static-params edge case for no benefit.
- **Referential integrity:** deleting an `author` doc leaves dangling refs + a stale string —
  the same gap the `tag` system already has (no `Rule.required` on refs). Consistent, not new;
  author-merge tooling is out of scope.
- **Out-of-band writer:** `scripts/import-catalog.mjs` writes `post.author` (string) directly and
  does not set `authors[]`. It is a one-shot that has already run; after this feature ships,
  **do not re-run it** (it would reintroduce string/refs drift). Flagged, not modified.

## Testing

- Unit tests for `parseAuthors(str)` — comma split; `&`/`y`/`Y` NOT split (`Hillsong Y&F`,
  `Majo y Dan`, `En Espíritu Y En Verdad` stay whole); trims; drops empties; **`""` and `undefined`
  → `[]`**; and a real 3-author string (`Marcos Witt, Marco Barrientos, Marcos Vidal`, from the
  non-catalog *Sublime Gracia*) → exactly three names.
- Unit tests for the two-map canonical pipeline (`dedupeKey(raw)` / `canonicalName(raw)` using
  `ALIAS` + `KEY_CANONICAL`, NOT a single raw-keyed merge map):
  - `dedupeKey("Hillsong Y&F") === "hillsong young free"` (pins the exact normalized key, guarding
    the `&`-handling that the bug in an earlier draft hinged on) and `dedupeKey("Hillsong Young &
    Free") === "hillsong young free"` — both → one doc named `Hillsong Young & Free` (the
    canonical-spelled member is NOT regressed to the abbreviation).
  - the EEYEV cluster (`En Espíritu y/Y En Verdad`) → one doc named `En Espíritu y En Verdad`
    regardless of input spelling or order (determinism / idempotency).
  - `Marcos Witt` / `Marco Barrientos` / `Marcos Vidal` → three distinct keys (no over-merge).
  - `slugifyAuthor` produces identical output when called from the route module and the migration
    module (the shared-helper convergence guard).
- Unit tests for `canonicalAuthorKey(name, mergeMap)` — normalized-key dedupe (`…Y…`/`…y…` →
  one key); merge-map aliases (`Hillsong Y&F` → `Hillsong Young & Free`, `Bethel` →
  `Bethel Music`); distinct similar names NOT merged; unknown passes through.
- Manual dry-run of the migration report (normalized-author→variants clusters + per-song author
  counts) reviewed before `--apply`.

## Key files

- Create: `sanity/schemas/author.ts`; register it in `sanity/schema.ts`.
- Modify: `sanity/schemas/post.ts` (add `authors[]` ref array; keep `author` string; fix the
  preview's `Title - undefined` when author is blank; drop the stray dead
  `import { title } from "process";` on line 1 while we're in the file).
- Modify: `app/utils/interface.tsx` (`Post.authors?: Array<{_id,name,slug}>`). (No TypeGen.)
- Create: `app/utils/slugifyAuthor.mjs` — the single shared `slugifyAuthor` helper, **co-located
  on the app module path** (not under `scripts/`) so the Next route imports it normally; the
  `.mjs` migration imports the same file by relative path. (Avoids an unproven `scripts/lib` →
  Next-route import; verify the import compiles in the first schema/route step.)
- Create: `app/api/content/authors/route.ts` (GET list + POST create), mirroring the tags route;
  imports `slugifyAuthor` from `@/app/utils/slugifyAuthor.mjs`.
- Create: `app/(client)/author/page.tsx`, `app/(client)/author/[slug]/page.tsx` (ISR
  `revalidate = 60`, no `generateStaticParams`).
- Modify: `app/(client)/posts/[slug]/page.tsx` (GROQ `authors[]->{_id,name,slug}`; chips).
- Modify: `app/components/EditSongButton.tsx` (multi-select, filter+toggle),
  `app/components/admin/SongFormModal.tsx` (multi-select + add-new-author); both submit `authorIds`.
- Modify: `app/api/content/posts/route.ts` (POST: accept `authorIds`, write refs + recomputed
  string + slug; GET: add `authors[]->{_id,name}` to projection) + `[id]/route.ts` (PATCH:
  accept `authorIds`, write refs + recomputed string; no slug).
- Create: `scripts/migrate-authors.mjs` (+ pure parse/canonicalize lib with tests); imports the
  same `app/utils/slugifyAuthor.mjs` as the authors route.

## Out of scope

- Converting the many low-traffic display components (setlist, proposals, services, admin cards,
  song-sheet, navbar) to chips — they keep reading the denormalized `author` string.
- Removing the `author` string field.
- Author search beyond keeping the existing substring search working on the denormalized string.
