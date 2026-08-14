# Multi-chord-chart editing — adversarial review ledger

Companion to `2026-08-14-multi-chord-chart-editing.md`.

Every reviewer was a fresh `skeptical-reviewer` receiving only the plan snapshot
path, the repository path, the reviewer brief, code pointers, and the original
requirement verbatim. None received a prior review, a rebuttal, or the round
count. This ledger exists so the approval claim is auditable from the
repository rather than resting on a status line — it is written **after** the
loop and was never shown to a reviewer.

**Risk tier: CRITICAL** — two sequential fresh approvals on byte-identical
text. Derived from the ladder, not raised: the artifact changes a production
writer (`app/api/content/posts/[id]/route.ts` PATCH and
`app/api/content/posts/route.ts` POST) and a destructive full-array serializer
(`patch.chords = body.chords.map(...)` remints `_key` on every save). Both
deploying branches write the real production dataset.

**Plan approval is not authorization to implement.** After implementation, a
fresh code review of the diff plus the documented test gates are still
required; this loop is not a substitute.

**Outcome:** 3 rounds. Round 1 `APPROVED` on digest `46e5a64b…`. The author
then edited the plan (non-blocking findings adopted), which **reset the
streak**. Rounds 2 and 3 `APPROVED` on byte-identical digest `caf95f22…`.

| Round | Reviewed digest (SHA-256) | Verdict | Streak |
|---|---|---|---|
| 1 | `46e5a64b5fc3c2b27a7c85da2a393108b1f9324a725f709b38461591bcb987fb` | `APPROVED` | 1 (then **reset** — plan edited) |
| 2 | `caf95f22c4c226da681639d970316e1c9af3d0031b7f3d5f6b4acf38ad6e893c` | `APPROVED` | 1 |
| 3 | `caf95f22c4c226da681639d970316e1c9af3d0031b7f3d5f6b4acf38ad6e893c` | `APPROVED` | **2, tier satisfied** |

---

## Round 1 — `APPROVED`

Digest `46e5a64b5fc3c2b27a7c85da2a393108b1f9324a725f709b38461591bcb987fb`.
Agent `134b69a3-d24c-4be7-9ff5-f98d40a3760f`.

Blockers: none.

Independent verification of non-blocking claims (skill step 4):

| Claim | Checked | Disposition |
|---|---|---|
| After D1, ChordPro pasted into Letra no longer creates a chart; readers hide `body` when any chart exists | Verified `posts/[slug]/page.tsx:151,324` (`hasInlineChords`) and `SongSheet.tsx:103,185` (`hasChords`) | **Adopted** into the next digest: lyrics-only placeholder + Spanish hint; drop whitespace-only charts on save |
| Allowing empty `content` lets "Agregar + Guardar" hide lyrics behind a blank chart | Same reader-precedence evidence | **Adopted**: drop whitespace-only items client + server |
| Landmine copies in DATA_MODEL / ARCHITECTURE / UTILITIES | Verified `docs/DATA_MODEL.md:56-58`, `docs/ARCHITECTURE.md:554-555`, `docs/UTILITIES_AND_COMPONENTS.md:308-309` | **Adopted** into docs step |
| EditSongButton has its own `FormState` | Verified `EditSongButton.tsx:16-28` | **Adopted**: explicit `charts` on the local type |
| Route test is PATCH-shaped; POST uses `create`; mock needs `fetch` | Verified `posts/route.ts:84` (`create`) and `[id]/route.ts:58-59,107` (`fetch` + `patch().set().commit()`) | **Adopted**: POST 4xx case + `fetch` in the mock |

Author-side process: the first digest was approved, then edited. That is a
streak reset, not a confirming round. The edit was the right call — shipping
"allow empty content" against the verified reader-precedence would have been a
latent lyrics-hiding bug — but it means round 1 does **not** count toward the
two sequential approvals.

---

## Round 2 — `APPROVED` (streak 1 on `caf95f22`)

Digest `caf95f22c4c226da681639d970316e1c9af3d0031b7f3d5f6b4acf38ad6e893c`.
Agent `8b956aa9-d973-414b-a161-e441aa17a3d4`.

Blockers: none.

Non-blocking, independently verified, **not** folded into the plan (would
reset the streak again):

| Claim | Checked | Carry into implementation? |
|---|---|---|
| Coerce missing Studio `content` to `""` in `chartsFromSong` | Schema `content` has no `validation: Rule.required()` at `post.ts:146-152` | Yes — load hygiene |
| Remint on minted-key collision | `rng()` is 7-char base36; collision negligible | No — YAGNI vs the plan's mint-once |
| Landmine copies in improve skills | Verified `.agents/skills/improve-owt/SKILL.md:209-211` and `source-command-improve/SKILL.md:214-215` | Yes — same delivery, operational not historical |
| Pass `inputCls` as a prop (circular import) | `SongFormModal` would import a component that imports it | Yes |
| Payload fixture with non-empty `body` **and** N charts | Studio can already persist both | Yes |
| Widen route `chords` type to include optional `_key` | Current `as` type is `{ key, content }[]` | Yes |

---

## Round 3 — `APPROVED` (streak 2, tier satisfied)

Digest `caf95f22c4c226da681639d970316e1c9af3d0031b7f3d5f6b4acf38ad6e893c`
(byte-identical to round 2). Agent `415dfe9c-0558-4d85-90e1-ceaf4ea2accb`.

Blockers: none.

Non-blocking, independently verified, carry into implementation without
editing the approved digest:

| Claim | Checked | Carry into implementation? |
|---|---|---|
| Lyrics-only payload test must include `[Am]`-style markers | Today's serializer would still pass a marker-free fixture | Yes |
| `ChordChartsFields` must take `inputCls` as a prop | EditSongButton's local class (`:35-36`) is not the exported `inputCls` | Yes (same as round 2) |
| EditSongButton lyrics placeholder still trains ChordPro-into-Letra | Verified `:327-330` | Yes — both editors |
| Drop predicate is `trim()`, kept `content` is not trimmed | Byte-identity of chart content | Yes |
| `normalizeChordCharts` must `Array.isArray` or a non-array 500s | Plan said "must be an array"; put the check inside the util | Yes |
| ADR should record that adding a filled chart hides `body` in both readers | Existing reader behavior, stated non-goal | Yes |

---

## Post-approval changes (un-reviewed)

Approval covers digest `caf95f22…` only. Implementation may adopt the
non-blocking items listed above; they are **outside** that approval and must
not be silently treated as reviewed plan text.

No further edits were made to the plan file after round 2.
