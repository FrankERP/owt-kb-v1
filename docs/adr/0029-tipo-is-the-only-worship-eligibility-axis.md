# ADR-0029: "Tipo" is the only worship eligibility axis; soft retirement is removed

**Date:** 2026-09-03 · **Status:** Accepted · **Supersedes:** the P1–P3 member-retirement plans

## Context

Worship had two mechanisms answering "can this person be scheduled?", and they
did not agree.

`memberType` ("Tipo" — voz, instrumento, foh, sunday_lead, saturday_lead,
support) is the capability axis. Every seat filters on it
(`rankCandidates`: `(m.memberType ?? []).includes(seat.memberType)`) and every
solver pool is built from it (`MonthGenerator`: `memberType?.includes("voz") &&
memberType?.includes("sunday_lead")`, and the two siblings). A member with an
empty Tipo therefore matches no seat and lands in no pool — they cannot be
selected by an admin and cannot be assigned by the solver. Tipo is editable from
`/admin` by a super-admin. The one place that was NOT true is the stored solver
pools, whose ids were ticked in the past and were never re-checked against Tipo;
this delivery closes that (see Decision).

`retiredFrom` was a second axis added on top, filtering the same selection
points. It shipped with a defect a 2026-09-02 audit found: `rankCandidates`
filtered retirees with no `keepIds` escape hatch, while the two other selection
surfaces (`MonthGenerator`'s pools and the Persona select) passed one. A member
retired while already seated in a future service therefore had no candidate row,
so the only un-seat path in the planner — `toggleCandidate` — did not exist for
them, and the DD11 "Marcar para mover" anchor is gated on `selected`, so they had
no drag handle either. The cell rendered "Retirado de Alabanza — sigue en este
servicio futuro **hasta que lo cambies**", instructing an action the surface no
longer offered. Recovery was `/studio`.

The retirement spec (`2026-08-30-member-retirement-p1-roster-axis.md:104`, R2)
required the keepIds behaviour on all three surfaces. Two of three had it.

## Decision

Delete the retirement mechanism. Tipo is the only worship eligibility axis:
**a member stops being schedulable by having no Tipo.**

Removed: `app/utils/memberRetirement.ts`, `PATCH
/api/admin/members/[id]/retire`, the `retiredFrom` schema field, the AdminPanel
retirement controls and badges, the solver-rule rewrite that accompanied a
retirement (R15/R17), the planner's retired-occupant warnings, and the
`WORSHIP_NOT_RETIRED_GROQ_FILTER` arm on the setlist-push audience.

Kept, in `app/utils/memberRuleNames.ts`: `displayMemberName`,
`personNameOptions` and `rulePersonNamesMember`. These are about matching a
solver rule's free-text `person` against a member and were never about
retirement. The module carries no `"use client"` — both the planner model and
client panels import it (ADR-0028).

`buildSolveRequest` now re-filters the stored pool ids by live Tipo, and
`poolTipoMismatch` surfaces the stale ticks in the generator so they can be
removed. Without that the premise held everywhere except the one document the
admin cannot see: a member whose Tipo was cleared vanished from the pool
checkboxes — which are built FROM Tipo — so the tick could not be removed, while
their name still reached the solver. Clearing the Tipo of the only Sunday lead
now fails the request closed rather than solving with no lead.

`disabled` is unchanged and still separate: it removes app ACCESS, not
schedulability.

## Rejected

**Fixing the bug instead — threading the seated occupants into `rankCandidates`
as `keepIds`.** This is the smaller diff and it closes the reported defect, but
it keeps two axes answering one question, which is what produced the defect: the
three selection surfaces had drifted apart precisely because the rule had to be
restated at each of them. It also leaves the second half of the divergence in
place, where `moveGate` misattributed a retirement refusal to `memberType`
("requiere tipo voz" for a member who plainly is one) because `rankCandidates`
had gained a third exclusion its comment did not know about.

**Keeping retirement for the information it preserved.** Clearing Tipo loses
"this person was a voz". That is real, and it is cheap to restore: a super-admin
re-ticks the boxes. Against it, the mechanism had **one** document in production
— the `member-dev-verify` bot — and that document carried no `memberType` at
all, which every filter treats exactly as an empty one. Removing retirement
therefore changed the behaviour of exactly zero members, human or otherwise. A
mechanism with no users is not carrying the weight of its own defects.

## Consequences

**Nothing warns that someone you removed from the team is still assigned to a
future service.** Retirement's one genuine capability was the planner's ↷ badge
and its "sigue en este servicio futuro" note. Clearing Tipo produces no such
warning — the person simply stays seated where they already are, silently. That
gap predates this ADR for the Tipo path; this change makes it the only path. If
it starts to bite, the fix is a seat-level check ("this occupant no longer
matches this seat's Tipo") in `PlannerGrid`, which is a better-shaped warning
than retirement's was because it also catches a member whose Tipo merely
changed.

**The setlist push now reaches every worship member with the preference on**,
where it previously excluded retirees. The only retiree is the bot, whose
`notifPrefs.setlist` is `"off"` — and that preference, not the retirement
filter, is what `setlistRecipientIds` gates on. So this delivered nothing and
delivers nothing. Verified against production before the merge:
`count(*[_type == "teamMembers" && count(retiredFrom) > 0])` is 1.

**Undoing this means restoring two axes.** If retirement comes back, the R2
keepIds contract has to hold at every selection surface simultaneously, and the
`moveGate` refusal has to name retirement rather than falling through to the
`memberType` branch. The audit that produced this ADR found both broken.
