# ADR-0053: Auto plans one or two months, with stored services and counted specials as fixed services

**Date:** 2026-10-06 · **Status:** Accepted (behind `SOLVER_ENGINE`; production stays v2 until C7)

## Context

The team asked for Auto to respect seats already assigned, plan two months at once, and keep
fairness across months (solver v3, parent §7). v2 plans one month, ignores stored rosters in create
mode, never sends specials, and writes drafts only. v3's solver (C5) takes opaque service ids, fixed
services and pins, and the fairness ledger (C2) measures balances against a per-month eligibility
record that must exist for a month to count.

## Decision

Under the v3 engine (C6, `app/components/admin/v3*.ts`):

- **Horizon.** «Planear: 1 mes · 2 meses»; one grid across the horizon; Auto refuses a month before
  the current CDMX month and one beyond the current month + 12.
- **Services that will exist, and only those.** Planned columns (not skipped, creatable), every
  stored service of the horizon — sent FIXED, id = its document `_id` verbatim, its kept seats as pins
  (C2's `keepVoiceSeats`), empty stored seats left empty — and every counted special, filled by the
  planner first (protections, then balance) and then sent fixed. Uncounted specials and instruments
  keep today's after-solve filler. This is the amendment ADR-0010's Decision 1 will need at the flip.
- **One builder.** `buildV3SolveRequest` is pure (state, ledger read, roles read, clock in; request,
  notices, refusals, snapshot out); every rule id is minted, never a config key (production's seed
  keys spell first names), and each run keeps a name-free id → config-ordinal table.
- **Records first, atomically.** The confirm sends every horizon month's eligibility record in one
  PUT before any draft — a bound month's record back `unchanged`, a recorded-unbound month replaced
  under the revision read, a create for every month without a record, anchored or not (parent A27) —
  frozen at the solve; then drafts oldest first, month 2 only after month 1 is complete; a month that
  became past refuses before anything is written (A40). A 2-month confirm creates drafts only.
- **Only Auto's v3 confirm (and C2's «Registrar») writes a record.** The stored editor («Editar
  mes») writes none.

## Rejected

- **Re-planning stored services** (or filling their empty seats): overwrites what the team already
  sees and plans with; the spec makes them fixed.
- **Letting the solver fill counted specials**: C5 accepts a special only as a fixed service; the
  planner's pre-fill ranks by the same protections and balances, and a placement the solver can only
  report as a `pins` miss is used only when nobody else can lead.
- **One PUT per month, or drafts before records**: a refused month's eligibility differs from what
  was solved, so the plan is joint; records first means a refusal creates nothing.
- **Skipping the record of a month that already had stored services**: the month would drop out of
  the ledger while its services count (parent A27 removed that skip).

## Consequences

A record can outlive drafts that all failed (the confirm deletes nothing); the next Auto then sees
the month as recorded and replaces it, or — if it already had stored services — as bound. C7 amends
ADR-0010 and ADR-0047 at the flip (v3 has no solver weeks; the trailing Saturday is a dated service).
Deleting the v2 history surfaces is C7's, after the rollback window.
