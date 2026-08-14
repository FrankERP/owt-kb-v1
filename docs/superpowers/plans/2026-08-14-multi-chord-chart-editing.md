# Implementation Plan: multi-chord-chart editing in the song editor

## Original request

> Read `docs/tasks/2026-08-14-multi-chord-chart-editing.md` and implement it.
>
> A song (`post`) can carry several chord charts in `chords` (object type
> `chord_chart`, fields `key` and `content`). The reader already supports this
> (`ChordChart.tsx` tabs when `charts.length > 1`). Both admin editors collapse
> the array to a single chart built from one textarea. Opening a 3-key song and
> pressing Guardar silently deletes two charts. Fix it as a feature, not a
> patch.
>
> Constraints from the task: Spanish UI; work on a branch off `main`; do not
> push, merge, deploy, or run any script against Sanity. Done means
> `npx tsc --noEmit && npm test && npx eslint .` with 0 errors.

No secrets, credentials, or personal data appear in this plan.

## Status and contract

- Document status: Draft — not reviewed, not approved, not authorization to implement.
- Accepted requirement source: `docs/tasks/2026-08-14-multi-chord-chart-editing.md`
- **Risk tier: CRITICAL — two sequential fresh `APPROVED` verdicts on byte-identical text.**
  Derived from the ladder, not raised: this changes a production/server writer
  (`app/api/content/posts/[id]/route.ts` PATCH and `app/api/content/posts/route.ts`
  POST) and a destructive full-array serializer (`patch.chords = body.chords.map(...)`
  currently remints `_key` on every item). Both deploying branches write the real
  production dataset.
- Primary outcome: an admin can load, edit, add, remove, and reorder N chord
  charts; a no-op save of a 3-chart song writes all 3, same order, same content,
  same `_key`s.
- Safe ending state: local branch only. Gates green. No push, no deploy, no
  Sanity `--apply`.
- Rollback: revert the branch. No migration. Songs in production are unaffected
  until a later release (0 songs currently have multiple charts — CLAUDE.md
  landmine). Implementation authorization is **not granted by this plan**.

## Evidence and current behavior

| Evidence | Source | Planning implication |
|---|---|---|
| Schema allows N `chord_chart` objects (`key`, `content`) | `sanity/schemas/post.ts:131-161` | No schema change. `_key` is Sanity-array identity, not a schema field. |
| Reader already tabs when `charts.length > 1` | `app/components/ChordChart.tsx:142` | Editor is the bug; do not change the reader. |
| `songToForm` loads only `chords[0].content`, else `body` | `SongFormModal.tsx:61` | Charts 2..n never enter form state. Lyrics textarea is dual-use. |
| `buildPayload` emits one chart or `body`, never both, via `CHORD_MARKER_RE` | `SongFormModal.tsx:68-80` | The coupling that forces the collapse. |
| `EditSongButton` duplicates both lines | `EditSongButton.tsx:45`, `:54-69` | Fix both or extract. Last time one copy drifted. |
| PATCH remints `_key` for every chart on every save | `posts/[id]/route.ts:84-88` | Even a 1-chart no-op churns identity. Preserve existing `_key`; mint only for new items. |
| POST create maps the same shape with a fresh `_key` per item | `posts/route.ts:94-96` | Create has no existing keys to preserve; still validate; mint for every new item. |
| GET admin list projects `chords[]{ key, content }` — **no `_key`** | `posts/route.ts:28` | ContentPanel cannot preserve identity unless this projection grows `_key`. |
| Song page (feeds `EditSongButton`) projects `chords[]{ key, content }` — **no `_key`** | `app/(client)/posts/[slug]/page.tsx:72` | Same hole on the member-sheet editor. Must add `_key` here. |
| Member song API also omits `_key` | `app/api/song/[id]/route.ts:20` | Reader-only. Leave it; `EditSongButton` does not consume this route. |
| `buildPayload` is also the create path | `ContentPanel.tsx:116-119`, `SetlistEditor.tsx:226-229` | Shared helper change covers create from admin and from a setlist. |
| `textToBody("")` is `[]`; lyrics text round-trips; **body block `_key`s already churn** | `app/utils/lyrics.ts:61-74`, `lyrics.test.ts` | "Body unchanged" means lyrics **text** round-trips, not Portable Text `_key` byte-identity. Chart `_key`s are the identity that must not churn. |
| PATCH always `set`s `body` when `lyrics != null` (including `""`) | `posts/[id]/route.ts:83` | A charts-only no-op still sends `lyrics: ""` and writes `body: []`. That is already-empty, not a wipe of stored lyrics. |
| Client mutation handlers wrap fetch in try/catch/finally, check `res.ok` | `ContentPanel.tsx:113-145`, `EditSongButton.tsx:185-204` | Do not change that shape. |
| `revalidateSongViews()` after write | both post routes | Keep. |
| Both readers hide `body` when `chords.length > 0` | `posts/[slug]/page.tsx:151,324`; `SongSheet.tsx:103,185` | A persisted blank chart conceals stored lyrics. Drop whitespace-only charts on save. |

## Scope

### In scope

- Repeatable chord-chart editor in **both** `SongForm` (`SongFormModal.tsx`) and
  `EditSongButton.tsx`: load every chart (order + `_key`), per-chart tonalidad +
  content, add / remove / move up / move down. Removing the last chart is
  allowed (song has no charts).
- Separate lyrics (`body`) from charts (`chords`) per Decision D1.
- Server accepts N charts; preserves `_key` when present and valid; mints only
  for new items; 4xx on missing/non-string `content` or colliding `_key`s.
- GET projections that **feed an editor** include `_key`.
- Tests listed in Verification. ADR-0018. Landmine update in CLAUDE.md / AGENTS.md.
- Shared pure helpers so the two editors cannot drift on the chart slice.

### Non-goals

- Schema change, data migration, or any Sanity `--apply` script.
- Changing `ChordChart.tsx` (the reader).
- Preserving `_key` on `referenceLinks`, `tutorials2`, `tags`, or `authors`
  (they already remint; out of scope).
- Preserving Portable Text block `_key`s on `body` (already reminted by
  `textToBody`; out of scope).
- Adding `_key` to the member song API (`/api/song/[id]`) or other reader-only
  projections.
- Drag-and-drop reorder (move up / move down is the minimum).
- Teaching the lyrics toolbar to target a chart textarea.
- Push, merge, deploy.

### Preserved invariants

- Sanity array-of-object writes still carry a `_key` per item.
- Timezone, `saturdarSongs` spelling, five-seat queries, `published != false`,
  cache revalidation, client fetch error handling, colour tokens, toast hook:
  untouched.
- Auth: `requireActiveManager` on both writers; type guard on PATCH (`_type ===
  "post"`) stays. `protectedReadAudit` still allowlists
  `app/api/content/posts/[id]/route.ts`.
- `/api/cron/*` matcher exclusion: not touched.

## Decision D1 — lyrics and charts are independent fields

**Rule (the decision point, also a code comment on `songToForm` / `buildPayload`
and ADR-0018):**

- The lyrics textarea is **only** `body`, via `bodyToLyrics` / `textToBody`.
- The charts editor is **only** `song.chords`, preserving order and each
  existing `_key`.
- `CHORD_MARKER_RE` is **not** consulted on save. A chart is a chart because it
  sits in the charts array, even if its text has no `[Am]` markers. Lyrics stay
  lyrics even if they happen to contain `[brackets]`.
- Song-level `form.key` (`post.key`, "Tonalidad") stays independent of each
  chart's `key`. Adding a chart may default the new row's key from `form.key`;
  it does not write `form.key` into existing charts.

**Must-holds from the task, under this rule:**

1. Plain lyrics, no charts: `songToForm` sets `lyrics` from `body`, `charts`
   `[]`. No-op `buildPayload` sends that lyrics text and `chords: []`. Body
   text round-trips; chords stay empty.
2. Only lyrics live in `chords[0].content` (empty `body`): `songToForm` sets
   `lyrics` to `""` and `charts` to that one chart **including `_key`**. The
   content is shown in the chart editor, not copied into the lyrics textarea.
   No-op save sends byte-identical chart `content` and the same `_key`.
3. "No save path can produce both an emptied `body` and emptied `chords` for a
   song that had one of them" — **serializer interpretation, not a prior-state
   server gate.** Emptiness of one field is never inferred from the other.
   Saving charts does not blank `lyrics`; saving lyrics does not blank
   `chords`. A charts-only no-op sends `lyrics: ""` (body already empty) **and**
   the charts. A lyrics-only no-op sends the lyrics **and** `chords: []`. The
   only way both arrive empty is the user clearing the lyrics textarea **and**
   removing every chart — explicit, allowed, and the same as "this song has no
   lyrics and no charts." We do **not** read the live document to refuse that
   pair (extra production-writer coupling, and it would block a deliberate
   wipe).

**Rejected alternative:** keep one textarea that auto-classifies via
`CHORD_MARKER_RE`, and treat extra charts as an add-on list for keys 2..n.
That is the current coupling: chart 0 and lyrics still share a box, a 3-chart
no-op still depends on regex, and a lyrics-only song whose text contains
`[brackets]` still silently becomes a chart and empties `body`. The task asked
to separate them so charts are edited as charts.

**Also rejected:** when `body` is empty, copy `chords[0].content` into the
lyrics textarea "so the content is visible," and write it back to either `body`
or `chords[0]` on save. That re-entangles the two fields and is exactly
`songToForm` today (`chords?.[0]?.content || bodyToLyrics(song.body)`).

ADR-0018 records D1. Next number: `docs/adr/` currently ends at 0017.

## Affected boundaries

| Component | Current | Planned |
|---|---|---|
| `app/utils/songFormCharts.ts` (new) | — | Pure chart draft helpers + payload mapping. One seam for both editors. |
| `app/utils/chordChartWrite.ts` (new) | — | Pure server normalizer: validate, preserve `_key`, mint missing. Used by POST and PATCH. |
| `app/components/admin/ChordChartsFields.tsx` (new) | — | Spanish repeatable UI. Reuses `inputCls`. |
| `SongFormModal.tsx` | Dual-use lyrics; one chart out | `FormState.charts`; `songToForm`/`buildPayload` follow D1; render `ChordChartsFields`. |
| `EditSongButton.tsx` | Duplicate collapse | Same chart slice via the shared helpers; own extra fields unchanged. |
| `app/api/content/posts/[id]/route.ts` | Remint every `_key` | `normalizeChordCharts`; 4xx on invalid; `revalidateSongViews` kept. |
| `app/api/content/posts/route.ts` POST | Mint all (OK for create) | Same normalizer (all items lack `_key` → all minted) + validation. |
| `app/api/content/posts/route.ts` GET | `chords[]{ key, content }` | `chords[]{ _key, key, content }` so ContentPanel can round-trip identity. |
| `app/(client)/posts/[slug]/page.tsx` | same projection | Add `_key` so `EditSongButton` can round-trip identity. |
| `app/utils/interface.tsx` `ChordChart` | `{ key, content }` | Optional `_key?: string`. |
| `docs/adr/0018-lyrics-and-charts-are-independent.md` | — | D1. |
| `CLAUDE.md` / `AGENTS.md` landmine | Collapse bug | Point at the editor + ADR-0018; remove "0 songs affected / real feature to fix." |

`ContentPanel.tsx` and `SetlistEditor.tsx` keep calling `buildPayload`; they
change only if `FormState` requires it (TypeScript will say).

## Ordered changes

Every step is local-only (non-deployable by the user's instruction). TDD: failing
test first, watch it fail for the right reason, then minimal code.

### 1. Pure chart-draft helpers (client seam)

- Purpose: one mapping both editors call, so parity is a unit test not a hope.
- File: `app/utils/songFormCharts.ts`.
- Types: `ChartDraft = { id: string; _key?: string; key: string; content: string }`.
  `id` is a React list identity (existing `_key` reused when present, else a
  fresh local id that is **never** sent as `_key`).
- Functions: `chartsFromSong`, `chartsToPayload`, `addChart`, `removeChart`,
  `moveChart`, `updateChart`.
- `chartsFromSong`: one draft per `song.chords` item, in order; copy `content`,
  `key`, and `_key` when it is a non-empty string. Do not read `body`.
- `chartsToPayload`: omit drafts whose `content` is whitespace-only (they
  never reach the writer). Remaining items: `{ key, content }` plus `_key`
  **only** when the draft still has the Sanity `_key`. New rows omit `_key`
  so the server mints. Rationale: both readers hide `body` whenever
  `chords.length > 0` (`posts/[slug]/page.tsx:151,324`,
  `SongSheet.tsx:103,185`). Persisting a blank chart after "Agregar acorde"
  + Guardar would hide stored lyrics behind an empty `ChordChart`.
- Failure: these are pure; no I/O.
- Verification: tests in `app/utils/__tests__/songFormCharts.test.ts` covering
  the 3-chart no-op, add/remove/reorder, lyrics-only (empty charts),
  charts-only (lyrics not involved here), and `chartsToPayload` dropping
  whitespace-only drafts.
- State after: helpers exist; no UI/writer change yet.

### 2. `songToForm` / `buildPayload` / `buildEditSongPayload` follow D1

- Purpose: kill the collapse at the payload seam.
- `songToForm`: `lyrics: bodyToLyrics(song.body)` — never `chords[0]`.
  `charts: chartsFromSong(song.chords)`. Comment cites ADR-0018.
- `buildPayload` / `buildEditSongPayload`: send `form.lyrics` as `lyrics`
  always; send `chartsToPayload(form.charts)` as `chords`. Delete the
  `CHORD_MARKER_RE` save branch (the regex may remain only if still used for
  something else; it must not route the payload).
- `SongForForm.chords` / `Post.chords` / ContentPanel `Song.chords` include
  optional `_key`.
- Verification: `app/components/admin/__tests__/songFormPayload.test.ts`:
  1. 3-chart song, load + no-op save → 3 charts, same order, content, `_key`s.
  2. add / remove / reorder → expected payload.
  3. plain lyrics, no charts → lyrics text in payload, `chords: []`.
  4. only `chords[0].content` → that content in `chords[0]`, same `_key`,
     `lyrics: ""`.
  5. **Parity:** `buildPayload(songToForm(song))` and
     `buildEditSongPayload(postToForm(song))` agree on `lyrics` and `chords`
     for the same fixture (export `postToForm` or share `songToForm`). Prefer
     `EditSongButton` importing `songToForm`/`chartsToPayload` over a second
     mapper; if a second mapper remains, the parity test is mandatory.
- State after: both payload functions are correct; UI still single-textarea.

### 3. Server normalizer + both writers

- Purpose: stop reminting; reject garbage; keep revalidation.
- File: `app/utils/chordChartWrite.ts`.
- `normalizeChordCharts(input, mintKey) → { ok: true, charts } | { ok: false, error: string }`.
  - `input` must be an array (caller only invokes when `body.chords != null`).
  - Each item: object; `content` must be a string ("missing" means
    absent/non-string → 400). `key` coerced to string (missing → `""`).
  - Whitespace-only `content`: **drop the item** (same as the client). Do not
    persist a blank chart. Do not 400 — "Agregar + Guardar" on an unfilled
    row is a no-op for that row, not a rejection of the whole save.
  - If `_key` is present on a kept item: must be a non-empty string matching
    `/^[A-Za-z0-9_.:-]{1,128}$/` (same class as `isSeatItemKey` in
    `roleWriteRequest.ts:426` — do **not** import from the role writer; copy
    the class with a comment). Duplicate `_key` → fail. Use the provided `_key`.
  - If `_key` absent: `mintKey()`.
  - Output item: `{ _type: "chord_chart", _key, key, content }`.
  - After drops, `[]` is a valid result (song has no charts).
- PATCH: on `body.chords != null`, normalize; 400 with the error string on
  failure; do not `patch`/`commit` on failure. Success: `patch.chords = charts`.
  `revalidateSongViews()` still after successful commit only.
- POST: same normalizer on `body.chords ?? []`. Cover POST in the route test
  with at least one 4xx (collision or missing `content`) so the shared
  normalizer is locked to **both** writers, not only PATCH.
- Do not change URL checks, type guard, author handling, or other fields.
- Verification: `app/utils/__tests__/chordChartWrite.test.ts` (preserve, mint,
  collision, missing content, invalid `_key`, whitespace-only item dropped)
  **and** `app/api/__tests__/contentPostsWriteRoute.test.ts`: mocked
  `writeClient` / `requireActiveManager` / `revalidateSongViews`; assert the
  `set({ chords })` payload on PATCH and the `create({ chords })` payload on
  POST; collision returns 4xx and does not commit; `revalidateSongViews`
  called on success, not on 4xx.
- Mock shape: PATCH is `writeClient.patch(id).set(patch).commit()`, not a
  transaction. POST is `writeClient.create`. The type-guard (and author)
  path calls `writeClient.fetch` — the mock must include `fetch` or the test
  never reaches `set`/`create`.
- State after: writers are safe; UI still cannot produce N charts from a
  loaded song until GET/`_key` and the form UI land — create-from-blank already
  could if the payload sent N, which it will after step 2+4.

### 4. Editor reads must return `_key`

- GET `/api/content/posts`: `chords[]{ _key, key, content }`.
- `app/(client)/posts/[slug]/page.tsx`: same.
- Without this, steps 1–3 still remint on every save because the client never
  saw the stored `_key`. That would fail the 3-chart identity test in
  production even if unit tests passed with fixtures that include `_key`.
- Verification: a test that the GET query string in `posts/route.ts` contains
  `chords[]{ _key, key, content }` (string pin, same style as other query
  pins in this repo). Page query: same pin in a small test next to existing
  page tests if any exist; otherwise pin from a `*.test.ts` that reads the
  file, or colocate with the route test. Do not add `_key` to
  `/api/song/[id]` in this change.

### 5. UI — both editors

- `ChordChartsFields`: list of drafts; per row tonalidad input + content
  textarea; "Agregar acorde" / "Eliminar" / "Subir" / "Bajar"; last-chart
  remove allowed; move disabled at ends; `inputCls` reused; Spanish labels
  ("Acordes", "Tonalidad", "Cifrado"); no hardcoded hex; no `brand.*` colour
  concat.
- `SongForm`: lyrics section stays (letra of `body`); charts section added.
  Lyrics placeholder is **lyrics-only** (no `[Am]` example). A Spanish hint
  under Letra says cifrados belong in Acordes. Charts placeholder shows
  `[Acorde]`. Pasting ChordPro into Letra must not create a chart (D1);
  the old placeholder would train the opposite habit.
- `EditSongButton`: same `ChordChartsFields`, same shared helpers. Its
  **local** `FormState` (`EditSongButton.tsx:16-28`, not the exported
  `SongFormModal` type) also gains `charts: ChartDraft[]`. Extra fields
  (tutorials, musical/lyrics URLs) untouched.
- Exported `FormState` and `blankForm()` gain `charts: ChartDraft[]` /
  `[]`.
- Failure: existing try/catch/finally on submit stays; a 4xx from the server
  must not close-as-success (`res.ok` already gates that).
- Verification: payload tests already cover the state mutations. No browser
  gate in this delivery (user: local gates only).

### 6. Docs in the same delivery

- ADR-0018 as specified in D1.
- Replace the known-landmine bullet in `CLAUDE.md` and `AGENTS.md` with a
  pointer that the editor holds N charts and that lyrics/charts independence
  is ADR-0018. Do not leave "real feature to fix."
- Same delivery: the copies in `docs/DATA_MODEL.md:56-58`,
  `docs/ARCHITECTURE.md:554-555`, and
  `docs/UTILITIES_AND_COMPONENTS.md:308-309`. Historical plans/specs are
  left as history.
- Link ADR-0018 from `docs/adr/README.md` index.

## Data and failure safety

- Identity and source of truth: Sanity `post.chords[]` items, keyed by `_key`.
  The editor is a full-array replace (same as today) but with stable keys for
  items that already existed.
- Migration: none. 0 multi-chart songs in production (landmine). Songs with
  one chart keep working: load one draft, no-op preserves its `_key` once the
  GET projection includes it.
- Partial failure: validation failure returns 4xx **before** `patch`/`commit`.
  Network failure on the client: existing catch; modal stays open.
- Concurrency: last PATCH wins, same as today. No `_rev` on this writer
  (pre-existing; out of scope).
- Idempotency: a no-op save of charts is identity-preserving on `_key` +
  content + order. Body Portable Text `_key`s still churn (pre-existing).
- Rollback: revert the branch. Data already written by a later deploy would
  keep N charts (the schema already allows them).
- Dry-run / `--apply`: this change does not run any Sanity script.

## Verification

| Requirement | Test | Failure it detects |
|---|---|---|
| 3-chart no-op keeps order, content, `_key` | `songFormCharts` + `songFormPayload` | Collapse / remint / drop |
| Add / remove / reorder | `songFormCharts` | Wrong permutation |
| Lyrics-only round-trip | `songFormPayload` | Charts inferred from `[brackets]` in lyrics, or lyrics copied into chords |
| Charts-only round-trip (`_key` intact) | `songFormPayload` | Content stuffed into `lyrics` / `_key` dropped |
| `buildPayload` ≡ `buildEditSongPayload` on lyrics+chords | parity test | One editor fixed, the other not |
| Preserve `_key`, mint new, reject collision, reject missing content, drop whitespace-only | `chordChartWrite` | Remint / silent garbage / blank chart hiding body |
| Route: PATCH and POST 4xx do not commit; success calls `revalidateSongViews` | `contentPostsWriteRoute` | Validation after write, skipped revalidate, or POST bypass |
| Editor GET includes `_key` | query-string pin | Unit tests green, production remints |
| Gates | `npx tsc --noEmit && npm test && npx eslint .` | Type/lint/regession |

Named tests that prove the 3-chart no-op (implement with these names):

- `songFormCharts: a 3-chart song maps to payload with the same order, content, and _key values`
- `songToForm/buildPayload: a 3-chart song survives a no-op save with _key values intact`
- `buildEditSongPayload: a 3-chart song survives a no-op save with _key values intact`

## Rollout, observability, and rollback

- This delivery **does not roll out**. Local branch, gates, stop.
- A later session that merges follows CLAUDE.md: code review of the diff →
  preview first (verify alias) → then main. That session is not this plan.
- Stop conditions for this session: gates red; a reviewer blocker that
  survives verification; any urge to push or run Sanity writes.
- Rollback of a future deploy: revert the merge commit. Schema already
  allowed N charts; the reader already rendered them.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| D1 lyrics vs charts | Independent fields | Task must-holds; kills the regex coupling | Charts-only songs show an empty lyrics box (content lives in the chart editor). Correct. | plan |
| Empty-both | Serializer independence, not a prior-state refuse | A live-doc read on PATCH is new writer coupling; explicit wipe is allowed | A determined admin can clear both | plan |
| Shared helpers | `songFormCharts` + `ChordChartsFields` | The duplication is what broke last time | EditSongButton still owns tutorials/URLs | plan |
| `_key` on editor reads only | GET posts + slug page | Those two feed the editors | Member song API stays reader-shaped | plan |
| Invalid `_key` | 400, do not mint over it | Silent replace would look like "preserve" and change identity | Strict | plan |
| Empty / whitespace `content` | Drop the item (client + server) | Readers hide `body` whenever `chords.length > 0`; a blank chart would conceal lyrics | Cannot persist a WIP empty row across save; user re-adds | plan |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| 0 songs currently have 2+ charts | Low blast radius of a botched deploy later | Landmine text; not re-counted in this session (no Sanity script) | Still ship the feature; do not "patch around" live data |
| `EditSongButton` is only mounted from the slug page | If another parent omits `_key`, that path remints | Grep `EditSongButton` | Add `_key` to that query too |
| `writeClient.patch(id).set().commit()` is the only write shape | Wrong mock would test nothing | Read the route before writing the route test | Match the real chain |

## Open questions

None blocking.

## Handoff

- Adversarial review: this artifact, critical, two sequential cold `APPROVED`
  on one digest.
- Implementation authorization: **not granted by this plan**.

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
