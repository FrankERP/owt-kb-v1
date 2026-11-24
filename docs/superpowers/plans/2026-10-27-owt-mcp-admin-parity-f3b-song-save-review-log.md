# Review log — S3, creating and editing songs from the chat (admin parity, phase 3)

Artifact: `2026-10-27-owt-mcp-admin-parity-f3b-song-save.md`. Process:
`.agents/skills/adversarial-plan-review/`. Approval is NOT authorization to implement; the build follows
CLAUDE.md's release order and gets its own merge-range code review.

## Tier

**Critical**, derived from the ladder (not raised or lowered): the slice adds a second caller to the
production song writer, a destructive full-array serializer (lyrics body, chord charts, tags, authors,
links are written whole), and creates documents from the chat.

## Rounds

| Round | Reviewed SHA-256 | Commit | Verdict | Streak |
|---|---|---|---|---|
| R1 | `407dc750…307d` | 59b4d5e0 | CHANGES_REQUIRED (substantive) | 0 |
| R2 | `9b871633…3857` | f4a9af7d | APPROVED | 1 → reset (non-blocking points folded in, new bytes) |
| R3 | `9bbe6475…4cd8` | ef32e4e3 | CHANGES_REQUIRED (substantive) | 0 |
| R4 | `a5132dc0…acf8` | 19a04161 | APPROVED | 1 |
| R5 | `a5132dc0…acf8` (same snapshot) | 19a04161 | APPROVED | 2 — loop ended |

Every round was a fresh reviewer with only the brief, the snapshot, the repository and the requirement.
R4 and R5 reviewed the same read-only snapshot; its digest was checked before each dispatch and after
each verdict and matched the canonical file.

## Blockers and dispositions

**R1**
- B1 — `get_song {full}` would reach the in-app assistant through the shared `GET_SONG_INPUT` and
  `chatSongView`'s `...rest` (ADR-0060). **Fixed** (D8: an MCP-only schema; the assistant's view drops
  the fields; D11 pins). Evidence checked: `adminChatServer.ts:156-160`, `adminChatViews.ts`.
- B2 — the lossless test was too narrow (image entries, list items). **Fixed** (D4: whole-array
  structural equality, tests). Evidence checked: `sanity/schemas/post.ts` (`body` = block + image).

**R2** — approved; its non-blocking points (the headline example was unusable because production lyrics
repeat lines, an NFC splice risk, the create slug re-check on retry, orphan authors, key notation, the
D10 window, a trim claim, the route mock) were folded in, which reset the streak.

**R3**
- B1 — new authors were dropped: the routes read authors by id and filter unknown ones, and `create`
  minted a random id. **Fixed** (D1: `{id, newAuthors}` / `{ifRevisionId, unset, newAuthors}`, one
  transaction, a shared `resolveSongAuthors`; D6, D7). Evidence checked: `posts/route.ts:59-66`,
  `posts/[id]/route.ts:74-79`.

**R4, R5** — no blockers.

## Non-blocking items

R4 and R5 items were adopted **after approval** as the plan's §7 A1–A8 and are NOT reviewed. The
author checked the material ones against the code: the writer's `!= null` rule for `bpm` and the URLs
(`posts/[id]/route.ts:84,101-102`); the reviewers' run of `bodyToLyrics(textToBody(t))` (formatting
markers round-trip). None was declined.

## Process record (author side)

- **Churn cap reached after R3** (R1 and R3 substantive). The defect class: the plan described the
  chat path without tracing what the existing writer does with the same input (authors resolved by
  id, the assistant sharing a schema, whole arrays). Frank's go-ahead for another round came
  **before** R4: decision card «Sí, las dos», 2026-10-27 23:17Z (recorded in the private ledger).
- The artifact's status line carried the round history in earlier snapshots (a coldness slip); it was
  neutral for R4 and R5.
- The worklog no longer exists (retired 2026-10-22); the cap is recorded here, as CLAUDE.md directs.

## Post-approval changes (un-reviewed)

- The plan's §7 (A1–A8) and its status line.
- Approved digest: `a5132dc00a77bfa89d90a62badeaa0d1e8a93cf4f709a36d0008c68515ecacf8`.
