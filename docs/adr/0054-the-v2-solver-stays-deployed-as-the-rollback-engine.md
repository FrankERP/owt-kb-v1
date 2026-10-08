# ADR-0054: The v2 solver stays deployed as the rollback engine

**Date:** 2026-10-09 · **Status:** Accepted

> Solver v3 C7, the cutover (plan `docs/superpowers/plans/2026-10-05-solver-v3-c7-cutover.md`,
> decisions K1, K3, K5–K7; parent amendments A28–A31). Amends nothing by itself: the seven
> «Under v3» sections it triggers (ADRs 0004, 0010, 0038, 0041, 0042, 0046, 0047) each keep v2's
> original decision for the rollback engine.

## Context

Since 2026-10-09 Auto runs solver v3: `SOLVER_ENGINE = "v3"` (`app/components/admin/solverEngine.ts`),
the function `owt-solver-v3` (ADR-0051), the ledger and its eligibility records (ADR-0050), the
planner's horizon and confirm (ADR-0053). v3 cannot be rehearsed against production data without
writing it — `preview` shares the one dataset and the one `solverConfig` — so the cutover had to be
reversible after the fact, and the shared rules had to change in a way v2 would not misread in the
meantime. v2 builds a Saturday anchor: a dedicated «Líderes Sábado» member on every Saturday
(`gcf/owt_solver_v2.py`, C3 §6.7). The cadence members sit in that pool under v2 and must sit in
«Líderes Domingo» with «Mes por medio» under v3.

## Decision

- **v2 stays deployed, byte-identical and selectable.** `owt-solver`, `gcf/**`, its goldens, its
  request builder and parsers, `SOLVER_SENDS_HISTORY`, `SOLVER_HISTORY_SOURCE` and the
  derived-history read are untouched. Flipping back is one PR: the constant and its pin test back
  to `"v2"`, plus a revert of the cutover's copy hunks, released like any other (`preview` first);
  if the Preview override `OWT_SOLVER_ENGINE` is still set, it is removed before that PR reaches
  `preview`. Records and drafts written under v3 stay: they are inert under v2 and valid again on
  a later flip forward.
- **The order is snapshot → flip → pools (K1, parent A28).** A read-only snapshot of the whole
  `solverConfig` goes to the private repository first; then the flip PR merges and the production
  alias is verified serving it; only then does Frank save, in the production UI, the pool moves
  (the cadence members into «Líderes Domingo», «Líderes Sábado» emptied) and every rule edit v3
  needs that v2 would read differently — in one «Guardar reglas», with nobody running Auto between
  the merge and the save. Between the two, production is v3 with the old pools: degraded but
  announced on screen («Mes por medio fuera de Líderes Domingo», the non-empty «Líderes Sábado»
  warning), and a solve treats an unticked cadence member as `out` rather than doing anything
  silently wrong.
- **A rollback restores only the step's own paths (K3, parent A29).** A private, consented
  script reverts, in the config model, only the paths the step changed whose live value still
  equals the post-step value; it reads with `solverConfigFromDocument`, validates with
  `parseSolverConfigWrite`, writes only `solverConfigFields` under `ifRevisionId`, dry-runs by
  default and lists every path it skips. It is written and dry-run before the flip and applied
  only on Frank's yes to that dry run.
- **What retires when.**
  - *In the flip PR:* C3's v2-only cadence copy — the «Mes por medio» chip's note «aplica con el
    nuevo solver» (`CADENCE_V2_NOTE`) and the rule form's «Aplica con el nuevo solver; el solver
    actual no lo usa.». Under v3 both misstate «the current solver». A flip-back restores them.
  - *After a rollback window Frank closes (K5, parent A30):* the v2-only «sin Lead en …» surfaces
    (`LeadPoolHistoryPanel`, `leadPoolHistory.ts`) and C4's reconstruction script, which becomes a
    registered retired writer once every v2-confirmed month is recorded. The window closes when the
    first v3-planned month is published, the next v3 Auto has read it as lookback, Frank has read
    its «Equidad» panel as correct, and every v2-confirmed month is recorded.
  - *v2 itself — function, code, suite:* only by a later plan of its own.
- **MCP P4 is blocked on v3 (K7).** `solve_month`, `revise_proposal` and `apply_schedule` were
  approved on parity with the browser's v2 request and on an apply order that writes drafts with no
  eligibility record. Neither holds under v3. P4 is re-baselined onto v3 as a new critical plan
  before any implementation (`docs/MCP.md`).

## Rejected

- **Pools, or the v2-changing rule edits, before the flip.** For the length of CI and the deploy,
  production would be v2 with the cadence members in «Líderes Domingo», where v2 schedules them as
  regular Sunday leads with no warning. The chosen order fails loudly if the freeze is broken; the
  reverse fails silently.
- **Restoring the whole document from the snapshot.** It would discard every rule edit made after
  the flip and write around C3's serializer and version guard.
- **Deleting the «sin Lead» panel in the flip PR.** A flip-back would then restore v2 without the
  panel it was planned with.
- **Deleting v2 as dead code at the flip.** It is the rollback; a flip-back must find it deployed.
- **Building P4 on v2.** It would ship a planning tool against the engine production no longer
  runs, writing drafts without the records v3's ledger counts on.

## Consequences

- Two functions stay deployed and share one key (`OWT_SOLVER_API_KEY`); a rotation still redeploys
  both, and a gap on `owt-solver-v3` is now what breaks production Auto (`docs/SECRETS.md`).
- `solver-v2` stays a required CI job: its goldens guard the rollback engine, not production.
- A rollback leaves v3's records and drafts in place; the «Under v3» sections and this record
  gain a dated «rolled back» note, and `CLAUDE.md` and `docs/SOLVER_AND_INFRA.md` say v2 serves
  Auto again, in the flip-back PR itself.
- After the retirement PR a rollback still flips the engine, but the planner under v2 has no
  «sin Lead» panel; restoring it is a revert of that PR.
- The cutover's measurements (the real-container timing gate, the rehearsal) are in
  `docs/SOLVER_AND_INFRA.md` «Cutover record», without names or per-person figures; snapshots,
  captures and the restore script live in the private repository.
