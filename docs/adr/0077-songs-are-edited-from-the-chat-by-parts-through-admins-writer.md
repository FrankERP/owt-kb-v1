# ADR-0077: Songs are edited from the chat by parts, through /admin's writer

**Date:** 2026-10-28 · **Status:** Accepted

> **Numbering.** 0077 because records are numbered in the order they reach `main`; the solver-ops
> record that holds 0077 on `preview` becomes 0078 there when this one merges (as ADR-0076).

## Context

Phase 3 of Frank's «Quiero poder hacer todo lo que hago en la página como admin, pero desde el chat»
(plan approved under the critical tier, 2026-10-27,
`docs/superpowers/plans/2026-10-27-owt-mcp-admin-parity-f3b-song-save.md`). `/admin` creates a song
with «Nueva canción» (`POST /api/content/posts`) and edits one with «Editar canción»
(`PATCH /api/content/posts/[id]`). Both editors send WHOLE fields: the lyrics text (re-derived into
Portable Text by `textToBody`), every chord chart, every tag, author, link and tutorial. A chat that
sent one chart would delete the others; a chat that rewrote a whole lyric is how lines get garbled;
and a save after a retry or a stale read would overwrite an edit made in `/admin` meanwhile.

Two more facts shaped it:

- The writer re-derives `body` from text on every save, which loses anything the editor's text form
  cannot hold (an image entry, a list, a link mark). Production on 2026-10-28: every body round-trips
  (D4's own count), but nothing stopped Studio from adding one.
- Clearing a reference URL in «Editar canción» did nothing: the route skipped the empty value instead
  of unsetting the field. Fixed here for both surfaces (the one `/admin` behaviour change).

## Decision

- The routes' bodies moved into `app/utils/songSaveCommit.ts` (ADR-0043's `CommitOutcome`):
  `createSong(raw, opts?)`, `patchSong(id, raw, opts?)` and the authors route's `ensureAuthors`
  (route only). The routes keep `requireActiveManager` and the JSON parse and never pass `opts`, so
  they run the same statements; `contentPostsWriteRoute.test.ts` passed unchanged.
- **The chat edits by parts.** `applySongEdits(fresh, edits)` (`app/utils/songEdits.ts`, pure) starts
  from the freshly read song and returns the writer's input with ONLY the fields an edit touches;
  every untouched chart keeps its `_key`. A passage edit must match exactly once at its turn, unless
  it says `all` or `nth`; a key must be English notation.
- **Lyrics only when lossless** (`lyricsGate`): the stored body must equal
  `textToBody(bodyToLyrics(body))` ignoring keys, and be NFC. Otherwise every lyrics edit is refused
  and the rest still work.
- **Check, then save, bound by a token.** `check_song_edits` answers the before/after of only what
  changes, built from the WRITER's own normalized patch, plus `rev` and an HMAC over
  `{songId, rev, edits}` (label `mcp-song-edits|`). `save_song_edits` verifies the token, re-reads,
  refuses a different `_rev`, re-applies the edits and writes under `ifRevisionId`.
- **A create is keyed by its token.** `check_new_song` answers the song as it would be and a token
  carrying its issue time (label `mcp-song-create|`, dead after 30 minutes); the song's id is
  `post-mcp-` + 24 hex of that token. `create_song` reads the id first («Ya estaba creada») and writes
  with `createIfNotExists`, so a retry after an unknown outcome never makes a second copy. A slug
  another song has is refused.
- **New artists are created with the song.** The writer's own author read cannot see an author the
  same transaction creates, so the chat passes `newAuthors` and the commit writes ONE transaction:
  `createIfNotExists` for each, then the song. A lost race or a refusal leaves no author behind.
  Tags are never created from the chat.
- `get_song {full: true}` is the read the chat copies passages from (`rev`, `lyricsText`,
  `lyricsEditable`, `charts`). `full` exists only in the MCP's schema: the in-app assistant
  (ADR-0060) keeps `GET_SONG_INPUT`, and its view drops those fields by name.

## Rejected

- **Whole arrays from the chat**, as the editors send them. One forgotten chart is a deleted chart.
- **Accepting the lossy round-trip**, as `/admin` does on every save. The chat shows Frank a passage
  diff; a loss elsewhere in the song is exactly what he would not see.
- **`rev` alone.** Several edits and long texts do not fit a line Frank can compare, and a token
  makes the edits he saw the only ones that can be saved.
- **A random id on create**, like the route. The chat's failure mode is a retry, not a double click.
- **`ensureAuthors` before the song.** A separate write first could orphan an author and make
  «No se escribió nada» false.
- **`ifRevisionId` on the `/admin` route now.** The editors would need a conflict screen. `/admin`
  stays last-writer-wins: a page loaded before a chat save and saved after it overwrites the chat's
  edit, and publishing a pending Studio draft does too (the check warns about the draft).
- **Tools that call the routes over HTTP.** The bearer is not a NextAuth session (ADR-0043).

## Consequences

- A change to song validation, keys, the slug or revalidation is a change to `songSaveCommit.ts`, seen
  by both surfaces; `serviceCommitCallers.test.ts` pins its callers.
- Song writes notify nobody, from either surface.
- Rotating `MCP_OAUTH_SECRET` voids pending song checks (`docs/SECRETS.md`).
- Songs are not deleted from the chat, and tags are not created there (phase 4 or Studio).
