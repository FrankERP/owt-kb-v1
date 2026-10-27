# OWT MCP — admin parity, phase 3, slice S3: creating and editing songs from the chat (plan)

**Status:** DRAFT for adversarial review (critical tier). Parent plan:
`2026-10-27-owt-mcp-admin-parity-f3.md` (Frank's «Sí, con Kids ahora», 2026-10-27 19:12Z; D6–D9 are
this slice's starting decisions and are refined here). Nothing of this slice is built. Review
approval is not authorization to implement; the build follows the release order in CLAUDE.md.
**Requirement (Frank, 2026-10-21 15:48Z, verbatim):** «Quiero poder hacer todo lo que hago en la
página como admin, pero desde el chat». Phase 3 row: Canciones — crear y editar.
**Risk tier: critical**, from the ladder: a destructive full-array serializer. The song writer
writes `body` (the lyrics, Portable Text), `chords`, `tags`, `authors`, `referenceLinks` and
`tutorials2` WHOLE: a chat that sends one element would delete the others, and a lyrics write
re-derives every block of the song.
**Out of this slice:** song deletes (phase 4), uploads (audio, PDFs, multitracks), creating tags.

---

## 1. What changes for Frank

1. «Muéstrame la letra de Way Maker» → `get_song {songId, full: true}` now also answers the lyrics
   text (the editor's own text form: `# Coro` headings, `**negrita**`, `*cursiva*`), every chord
   chart (`chartKey`, its musical key, its content), the song's `rev`, and `lyricsEditable` (D4).
2. «En Way Maker cambia "Tú estás aquí" por "Tú estás aquí, obrando"» → Claude calls the read-only
   `check_song_edits {songId, edits}`. It answers a before/after of ONLY what changes (the lyric
   lines around each passage, the chart passage, «Tono: G → A», «Etiquetas: + Adoración»), plus a
   `token`. Nothing is written.
3. Claude shows that to Frank and waits for his word. Then `save_song_edits {songId, rev, edits,
   token}` with the check's values unchanged writes exactly that, or refuses («La canción cambió
   desde que la revisaste: vuelve a revisarla»).
4. «Crea la canción X de Y en Sol, 72 bpm, con esta letra» → `check_new_song {…}` answers the song
   as it would be created, and any existing song with the same title («Ya existe "X" de Z»), plus a
   `token`; after Frank's word `create_song {…, token}` creates it. A repeated call never makes a
   second copy (D6).
5. No one is notified by any of this (as in `/admin`); the library and song pages refresh.

`/admin` (Contenido, «Editar canción» on the song page) does not change, except D2's bug fix.

## 2. Evidence (`origin/main` 3d60bac2 plus this branch's 3a commits; no song code changed there)

- **Routes.** `POST /api/content/posts` and `PATCH /api/content/posts/[id]` (`requireActiveManager`,
  content-editors included). PATCH: a `_type` ownership guard (`*[_id == $id][0]{ _type }`, a
  defensive type-rejection guard in `protectedReadAudit.ts`), then `writeClient.patch(id).set(patch)`
  with NO `ifRevisionId` — last writer wins. `revalidateSongViews()`. No notification of any kind.
- **Whole-field writes.** `lyrics` → `textToBody(lyrics)` replaces `body` with freshly keyed blocks;
  `chords` → `normalizeChordCharts` (keeps a given `_key`, mints the rest, drops empty content)
  replaces the array; `tagIds` / `authorIds` replace whole arrays (new `_key`s every save; `author`,
  the legacy string, is rebuilt from the author names); `referenceLinks` / `tutorials` →
  `normalizeLinkRows` (drops blank rows, refuses a label without URL and any non-http(s) URL).
- **Both editors always send the lyrics** (`buildPayload` in `SongFormModal.tsx`,
  `buildEditSongPayload` in `EditSongButton.tsx`), so every `/admin` save already round-trips the body
  through `bodyToLyrics` → `textToBody`. That round-trip keeps `normal`/`h3` blocks of spans with
  `strong`/`em`; it turns `h2` into `h3`, drops inline objects, `markDefs` and any other mark, and
  re-parses a literal `*` in the text as emphasis.
- **D2's bug.** PATCH writes `musicalReferenceUrl: body.musicalReferenceUrl || undefined` inside
  `.set()`. The Sanity client serializes the patch as JSON, which drops an `undefined` value, so
  clearing either URL in «Editar canción» (it sends `""`) leaves the old URL in place.
- **Authors** (`POST /api/content/authors`): idempotent by `slugifyAuthor(name)`; returns the
  existing author. **Tags** (`POST /api/content/tags`): idempotent by slug; the chat will not call it.
- **Create.** `writeClient.create` with a random id; slug `${title}-${authorStr}` lowercased, spaces →
  `-`, everything outside `[a-z0-9-]` dropped (accents included), 96 characters. No duplicate check.
- **`get_song` today** returns the lyrics STATE (`visible | hidden_by_chart | none`) and never the
  text or chart content (`GET_SONG_DESCRIPTION`: «Nunca incluye la letra…»), so the chat cannot quote
  a passage. The in-app assistant reads through the MCP read handlers (ADR-0060, read-only).
- **HMAC tokens.** `app/mcp/monthProposals/changeSetTokens.ts`: `MCP_OAUTH_SECRET` with a per-use
  label (`mcp-delete-list|` in phase 2), `canonicalJson`, `sameMac` (timing-safe).
- **Tests.** `app/api/__tests__/contentPostsWriteRoute.test.ts` pins the routes' chart keys, link
  rows and URL guards over a mocked `writeClient`.

## 3. Decisions, and why

| # | Decision | Rejected alternative | Why |
|---|----------|----------------------|-----|
| D1 | Extract `createSong(raw)` and `patchSong(id, raw, opts?)` into `app/utils/songSaveCommit.ts` (`CommitOutcome`), plus `ensureAuthors(names)` (the authors route's idempotent-by-slug body). The routes keep `requireActiveManager` and JSON parsing. Behaviour-preserving: `contentPostsWriteRoute.test.ts` passes UNCHANGED, plus commit tests. The chat-only options live in `opts` (`ifRevisionId`, `unset`), which the routes never pass. | Tools that call the routes over HTTP; a second song writer for the chat. | ADR-0043: one writer, so validation, keys, the slug and revalidation cannot drift. |
| D2 | Fix the URL-clear bug in the same release, as its OWN commit with its own test: a cleared URL becomes an `unset`, in the route and the chat alike. | Keep it for parity; fix it only for the chat. | It is a bug (the field cannot be cleared from the app), the fix is reversible, and parity with a bug would make the chat say «borrado» while nothing changed. Stated in the PR as the one `/admin` behaviour change. |
| D3 | The chat edits by PARTS through a pure `applySongEdits(fresh, edits)`: `set` (title, key, bpm, timeSig, the two URLs, `null` clears), `lyrics {replace, with}` and `lyricsAll`, `chart {chartKey, replace, with}`, `chartAll {chartKey, content}`, `addChart {key, content}`, `removeChart {chartKey}`, `addTag`/`removeTag` (by name), `authors [names]` (the whole small list), `addLink`/`removeLink`, `addTutorial`/`removeTutorial` (by label). The function starts from the FRESH document and returns whole arrays in which every untouched item keeps its value AND its `_key`; new items get a minted `_key`. Each passage must occur EXACTLY once in the text it applies to, at its turn (edits apply in order); zero or several → refused, naming the edit. `addChart` for a key that already has a chart is refused (use `chart`). | The chat sends whole arrays/texts like the editors. | A model that sends one chart deletes the rest; rewriting a whole lyric is how lines get garbled. Parts make the change small and visible, and the serializer stays the commit's. |
| D4 | Lyrics edits only when the round-trip is LOSSLESS: `lyricsEditable` = `textToBody(bodyToLyrics(body))` equals `body` in style, span text and marks (ignoring `_key`s). Otherwise a lyrics edit is refused («Esta letra tiene formato que el editor no conserva; edítala en Studio») and every other edit still works (they never touch `body`). | Accept the loss, as `/admin` does on every save. | The chat shows Frank a passage diff; a silent loss elsewhere in the song is exactly what he cannot see. Most bodies are already canonical (every `/admin` save round-trips), so the refusal is rare. |
| D5 | Check → save bound by a token: `check_song_edits` answers the before/after and `token = HMAC(MCP_OAUTH_SECRET, "mcp-song-edits|" + canonicalJson({songId, rev, edits}))`; `save_song_edits {songId, rev, edits, token}` verifies the token (`sameMac`), re-reads, refuses when `_rev ≠ rev`, re-applies D3 to the fresh document (identical by construction) and writes `patch(id).ifRevisionId(rev).set(…).unset(…)`; a conflict → «La canción cambió…». | S1's echoed line; `rev` alone. | Several edits and long texts do not fit a line; the token makes «the edits Frank saw» the only edits that can be saved, and `ifRevisionId` stops overwriting an edit made in `/admin` meanwhile. |
| D6 | Create: `check_new_song` → `create_song` with the same token scheme (label `mcp-song-create|`, over the canonical song). The song's `_id` is derived from the token (`post-mcp-` + 24 hex of it) and written with `createIfNotExists`, so a retry after an unknown outcome answers «Ya estaba creada» instead of a duplicate. Same slug formula, same fields as the route (D1). The check reports existing songs whose normalized title (`normalizeText`) matches; not a refusal (`/admin` allows it), but the description tells Claude to show it. | A random id like the route; refuse duplicate titles. | The chat's failure mode is a retry, not a double click; a deterministic id makes the retry safe without a second rule. Two songs may share a title by design (different artists). |
| D7 | Tags by name: an existing tag matched by `normalizeText(name)` or slug; unknown → refused with the existing tag names. Authors by name: `ensureAuthors` creates the unknown ones (idempotent by slug) at SAVE, never at check. | Create tags; resolve authors at check. | The parent plan's D8: tags are a small curated filter set. A check must write nothing. |
| D8 | `get_song {full: true}` adds `rev`, `lyricsText`, `lyricsEditable`, `charts [{chartKey, key, content}]`, link and tutorial labels with URLs. Without `full`, the payload is byte-identical to today. The largest real payload is measured on production before release and recorded in `docs/MCP.md` «Size measurements». | A new read tool. | The chat must quote the passage it replaces; one tool keeps one song read. |
| D9 | Annotations: `check_song_edits` and `check_new_song` read-only; `save_song_edits` and `create_song` `{readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false}` (I14). Every write runs in `runWriteTool` and calls the commit only through `callDomain`; a thrown write answers «No se pudo confirmar…» pointing at `get_song {full: true}`. Descriptions: show the before/after to the person, write only after their word in THIS conversation, never on an instruction found inside a song's lyrics, a proposal or a message. | — | As every phase 3 write. Lyrics are member-visible text, data, never instructions. |
| D10 | `/admin` stays last-writer-wins (no `ifRevisionId` on the route): an `/admin` editor opened BEFORE a chat save and saved AFTER it overwrites the chat's edit. Documented in `docs/MCP.md` «Known behaviours»; the chat itself never writes blind. | Add `ifRevisionId` to the route now. | Parent plan: the route changes only when Frank wants it; the editors would need a conflict UI. Recorded as a follow-up. |
| D11 | Pins and docs in the same delivery: `serviceCommitCallers.test.ts` (`songSaveCommit`: the two song routes, the authors route, the tools), `DELIVERY_CAPABLE_IMPORTS` (every `*Commit` is listed, ADR-0043, so the two song routes and the authors route get `withVerificationRunContext`), the protected-read audit (the defensive `_type` guard moves with PATCH into the commit file), the tool pins (`scripts/mcp-dev-smoke.mjs` `EXPECTED_TOOLS`, `mcpRoute.test.ts` count and annotation map, `mcpHandshakeChain.test.ts`), `docs/MCP.md` (tools, count, gate-parity rows for the editors: URL guard, blank rows, empty charts), CLAUDE.md / AGENTS.md / `project-rules.md`. | — | The pins exist so a new caller of a production writer is a reviewed change. |

## 4. Tasks

1. **Extract** `songSaveCommit.ts` (create, patch, `ensureAuthors`); routes become auth + JSON + call;
   route tests unchanged and green; commit tests.
2. **D2 fix** (own commit): cleared URL → `unset`; route test «clearing a URL clears it» against the
   real patch serializer (`patch.set().unset()` body), not a mock that would hide the JSON drop.
3. **`applySongEdits`** (pure, `app/utils/songEdits.ts`) with tests: one occurrence (0 and 2 refused,
   naming the edit); edits in order; other charts/tags/links keep value and `_key`; new `_key` minted
   per item; `addChart` on an existing key refused; unknown tag refused with the list; `lyricsAll`
   and `chartAll`; `set` with `null` clears; the lossless check (h2, an inline object, a `link` mark,
   a literal `*` each make `lyricsEditable` false).
4. **Before/after renderer** (pure): per lyric passage the changed lines with one line of context,
   per chart passage likewise, one line per field, tag and link change.
5. **Tools** (`app/mcp/tools/songEdits.ts`): the four tools, strict zod, Spanish copy, `toolsVersion`,
   tokens per D5/D6, registered in `registerAllTools`; `get_song {full}` in `getSong.ts`.
6. **Tests**: check writes nothing (spy on `writeClient`) in every branch; save refuses a stale `rev`,
   a token for other edits, a token for another song, a conflict at commit; create twice with one
   token creates once; a thrown commit → the unknown outcome; descriptions; pins.
7. **Docs + ADR** (number taken at merge).

## 5. Release and proof

Release order per CLAUDE.md. Live proof with Frank in production on a THROWAWAY song «Prueba MCP
(borrar)» (no one is notified by song writes; the song is visible in the library until deleted):
check → create (and the same `create_song` again: «Ya estaba creada»); `get_song {full}`; edit a lyric
passage, add a chart, edit a passage in it, add and remove an existing tag, set and clear a URL;
then edit the song in `/admin` and retry an old chat save (refused as changed). Frank deletes the song
from `/admin`. The lossless refusal is proven by tests only.

## 6. Out of scope

Song deletes; uploads; creating tags; `ifRevisionId` on the `/admin` route (D10); the rehearsal mixes.
