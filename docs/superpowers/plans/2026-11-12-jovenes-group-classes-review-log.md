# Review log — 2026-11-12-jovenes-group-classes.md

Skill: `.agents/skills/adversarial-plan-review`. Approval is NOT authorization to implement; the
owner's request (Frank, 2026-11-12: «Aún no lo abras a todos, falta la sección para poder planear
el calendario individual de cada ministerio», and his answers at 03:22Z) is, and the plan's release
steps keep production behind his explicit word.

## Tier

**Critical**, derived from the ladder, for §3 only (the writer slice): it changes the payload of a
production writer (`ministryEventCommit.ts`) and adds two multi-document transactions («Recorrer»,
«Cambiar con…») behind a group security boundary (ADR-0081). §4 (the screen) is standard work and
was not part of the loop.

## Rounds

| Round | Reviewed digest | Base | Verdict | Streak |
|---|---|---|---|---|
| 1 | 0a4d8d20…eeaabb | `main` 2ee15003 | CHANGES_REQUIRED (2 verified blockers) | 0 |
| 2 | 98af7006…3642ea4 | 2ee15003 + round-1 edits | CHANGES_REQUIRED (2 verified blockers) | 0 |

Each round was a new reviewer with only the brief, the snapshot path and SHA-256, the evidence
pointers and the owner's requirement.

**Churn cap reached after round 2** (two rounds with verified blockers). Per CLAUDE.md §Review
policy a third round needs Frank's go-ahead in advance; it was asked on 2026-11-12 and, at the time
of this entry, is still unanswered. The loop has therefore **not converged**: no two consecutive
fresh APPROVED verdicts exist on one digest. On 2026-11-12 06:05Z Frank asked
for the release («quiero verlo todo bien en producción») with the third round still unrun; that is
his call on the cap, and the release went out without it.

## Blockers

### Round 1

- **B1 — the «No hubo clase» marker showed as a real meeting on member views.** VERIFIED: an
  untitled group meeting renders «Reunión de grupo», and the member reader filters only
  `published` + audience. Fixed: the marker is created unpublished, titled «No hubo clase», with no
  time or place; a published `sin_clase` row shows its title.
- **B2 — the screen's 6-month window against the writer's unbounded set gave a permanent 409.**
  VERIFIED from the plan's §4 text. Fixed: the section reads the roster to `9999-12-31`; «Nuevo
  libro» is capped at 60 classes.

Non-blocking items adopted: `already_exists` → 409; the anchor's revision re-checked inside the
set; `sin_clase` rows' handling stated; a collision warning in the preview; the server unsets a
dormant `lesson`; «Nuevo libro» freezes after its first POST and counts a 409 as done; one refusal
order; the ADR and CLAUDE.md name the set read; the swap refuses held and `sin_clase` rows.

### Round 2

- **B1 — «Recorrer» moved «No hubo clase» rows off their dates.** VERIFIED against the sheet
  (rows such as «Campamento» and «Domingo de amigos» are bound to their date). Fixed: gaps never
  move; classes hop +7 over them; each gap's revision is asserted in the transaction.
- **B2 — leaders got no people list.** VERIFIED (`admin/page.tsx` passed `[]` to non-managers;
  `jovenesPeople.ts` had no groups). Fixed: people, with their groups, go to leaders too.

Non-blocking items adopted: classes kept out of «Calendario de grupos»; one shared lesson
validity rule; the create-during-shift window accepted in §7; «Nueva clase»; the row cap stated in
§7; the swap moving all seats stated; no undo stated. Not adopted: refusing a past anchor (the
sheet records cancellations after the Sunday).

## Code review of the merge range (2026-11-12)

One fresh `code-reviewer` over `2ee15003..f622ba48`: no HIGH finding, no security finding; verdict
CHANGES NEEDED for this log (then missing) and one MEDIUM. Dispositions, all in the fix commit:

- MEDIUM — closing a «Nuevo libro» that stopped part way hid the classes it had created, inviting
  a duplicating second run. Fixed: closing it refreshes the page and selects the roster.
- LOW — a 60-class book could not be shifted from its start once a gap existed (cap 60 counted
  gaps too). Fixed: `SHIFT_MAX_ROWS` = 120; Spanish words for `invalid_shift`, `invalid_swap`,
  `invalid_lesson`.
- LOW — `shift_done` (a 409) closed the dialog as if a reload would fix it. Fixed: shown in place.
- LOW — the swap did not require one roster. Fixed: same `series` required (plan L4 step 5).
- LOW — a row switched to «No hubo clase» kept its hidden responsable. Fixed: `classBody` saves no
  seat for it.
- LOW — two moved classes could land on one date when a class already shared a date with a gap.
  Fixed in the preview's warning; the writer's behaviour is stated in §7.
- LOW — a class created in the roster during a shift is not moved: already accepted in §7.

The fixes are not HIGH, so per §Review policy they carry the gates on the final tree plus the
author's re-read of the fix diff, not a re-review.
