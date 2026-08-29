# Task brief — Multi-chord-chart editing in the song editor (owt-kb-v1)

Repo: `owt-kb-v1` (Next.js 16 App Router, React 19, Sanity v5, Tailwind, vitest).
Read `CLAUDE.md` / `AGENTS.md` at the repo root before writing code — its rules
override anything here that contradicts it. UI copy is **Spanish**.

Work on a branch off `main`. **Do not push, do not deploy, do not run any script
with `--apply`.** Deliverable is a local branch with green gates.

---

## 1. The bug

A song (`post` document) can carry **several chord charts** — one per key —
in the `chords` array (`sanity/schemas/post.ts:131`, object type `chord_chart`
with fields `key` and `content`).

The **reader already supports this fully**:
`app/components/ChordChart.tsx:142` renders a tab selector when
`charts.length > 1`, one tab per chart, with transposition on top.

The **editor destroys it**. Both admin editors collapse the whole array to a
single chart built from one textarea:

- `app/components/admin/SongFormModal.tsx:61` — `songToForm()` loads only
  `song.chords?.[0]?.content`; charts 2..n are never read into form state.
- `app/components/admin/SongFormModal.tsx:77` — `buildPayload()` emits
  `chords: hasChords ? [{ key: form.key, content: form.lyrics }] : []`.
- `app/components/EditSongButton.tsx:45` and `:63` — the same two lines,
  duplicated.

The server then **replaces the entire array**:

- `app/api/content/posts/[id]/route.ts:84-88` — `patch.chords = body.chords.map(...)`,
  a full-array set, and it mints a **fresh `_key` for every item on every save**,
  so chart identity is not stable across edits either.
- `app/api/content/posts/route.ts:94-96` — same shape on create.

Net effect: opening a 3-key song in the admin editor and pressing Guardar
silently deletes two charts. `CLAUDE.md` lists this under "Known landmines" and
records that **0 songs are affected today** — so this is a latent data-loss bug,
not a live incident. Fix it as a feature, not a patch.

---

## 2. What to build

### 2.1 Editor (both `SongFormModal.tsx` and `EditSongButton.tsx`)

A repeatable chord-chart section that can hold N charts:

- Load **every** chart from `song.chords` into form state, preserving order and
  each chart's existing `_key`.
- Per chart: an editable **tonalidad** (key) field and a **content** textarea.
- Add a chart, remove a chart, and reorder (at minimum: move up / move down).
- Removing the last chart is allowed and means "this song has no chord charts".
- Spanish labels, consistent with the surrounding form (`inputCls` / `selectCls`
  in `SongFormModal.tsx` are the shared input classes — reuse them, and reuse
  the existing colour tokens; never hardcode a hex).

`EditSongButton.tsx` is a near-copy of the modal's form logic. Do not fix one
and leave the other — either fix both or extract the shared pieces
(`songToForm` / `buildPayload` are already exported from `SongFormModal.tsx`
and are the natural seam).

### 2.2 The lyrics/chords entanglement

Today one textarea serves double duty: `buildPayload()` decides with
`CHORD_MARKER_RE` (`/\[[^\]]+\]/`) whether the text is a chord chart or plain
lyrics, and writes it to `chords[0].content` **or** to `body`, never both.
That coupling is what forces the collapse.

You must separate them so charts are edited as charts. You choose the exact
shape, but these must hold:

- A song that today has plain lyrics in `body` and no charts still round-trips
  through the editor with `body` unchanged and `chords` empty.
- A song that today has its only lyrics inside `chords[0].content` still opens
  showing that content and, if the user changes nothing, saves **byte-identical
  chart content** (its `_key` included).
- No save path can produce both an emptied `body` and emptied `chords` for a
  song that had one of them.

Write down the rule you picked in a comment at the decision point, and if you
rejected a plausible alternative, add a short ADR under `docs/adr/`
(see `docs/adr/README.md` for the bar and template — most changes need none;
this one plausibly does).

### 2.3 Server (`app/api/content/posts/[id]/route.ts`, `route.ts`)

- Accept a chart list of arbitrary length.
- **Preserve `_key`** for charts that already have one; mint a key only for new
  charts. (Sanity array-of-object writes require a `_key` per item — that
  invariant stays; what changes is that keys stop churning on every save.)
- Validate: reject a payload where a chart is missing `content`, or where
  `_key`s collide. Return a 4xx with a useful message rather than writing
  garbage.
- Keep the existing `revalidateSongViews()` calls intact.

---

## 3. Constraints you must not break

From `CLAUDE.md`, the ones this change is most likely to trip:

- **Sanity array-of-object writes need a `_key` per item.**
- **Client mutation handlers** wrap `fetch` in try/catch/finally, check
  `res.ok`, reset the loading flag, and never close-as-success on failure.
- **Cache:** admin/API routes that mutate content call the matching
  `revalidate*` util in `app/utils/revalidate.ts`.
- **Never build a colour by string concatenation**; use the existing tokens /
  `themeColour()`.
- Auto-dismissing toasts use the `useTransientValue` hook — never a bare
  `setTimeout`.
- Conventional commits (`fix(scope): …` / `feat(scope): …`), body explains the
  *why*. **Never** add AI/Claude attribution or `Co-Authored-By` trailers.
- Do not rename `saturdarSongs` (deliberate typo, elsewhere in the schema).

---

## 4. Tests (required, not optional)

Add tests under `app/components/admin/__tests__/` (and an API-route test
alongside the existing route tests) covering at least:

1. **The regression itself:** a song with 3 charts, loaded and saved with no
   user edits, produces a payload with all 3 charts, same order, same content,
   same `_key`s.
2. Add / remove / reorder each produce the expected payload.
3. A song with plain lyrics and no charts round-trips unchanged.
4. A song whose only lyrics live in `chords[0].content` round-trips unchanged.
5. Server: `_key` preserved for existing charts, minted for new ones, collision
   rejected, `revalidateSongViews` called.
6. `EditSongButton` and `SongFormModal` agree — if you keep two copies, assert
   both; the parity is the thing that broke last time.

---

## 5. Definition of done

All three gates, from the repo root, **0 errors**:

```bash
npx tsc --noEmit && npm test && npx eslint .
```

(eslint *warnings* are a deliberate backlog — errors are not.)

Then, in your report, state explicitly:

- Which files changed and why each one had to.
- The lyrics-vs-charts rule you chose and what you rejected.
- The exact test names that prove the 3-chart round-trip, and their output.
- Anything you left undone.

Do not claim done without pasting the real gate output. Do not push the branch,
do not merge to `main` or `preview`, and do not touch the Sanity dataset —
`preview` and `main` both write to the **real production dataset**. (Correction
2026-08-29: only `main` emails the real team — `EMAIL_REDIRECT_TO` is set on the
Preview environment, so dev mail is rerouted to one address. The dataset half of
this instruction is unchanged and is the one that matters here.)
