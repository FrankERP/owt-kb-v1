# ADR-0052: The planner learns the solver engine from the server

**Date:** 2026-10-06 · **Status:** Accepted

## Context

Solver v3 runs beside v2 until a cutover that flips one code constant (`SOLVER_ENGINE`,
`app/components/admin/solverEngine.ts`, C1) by PR. Preview must be able to rehearse v3 before that
flip, so C2 added a Preview-only override (`OWT_SOLVER_ENGINE`) read by one pure resolver
(`resolveSolverEngine`, `app/utils/solverDeployment.ts`) that honours it only on the `preview`
branch deployment and locally. A client bundle cannot read that variable, and a planner that read
the constant directly would disagree with its own server on Preview — sending a v2 request to a
server answering v3, or the reverse.

## Decision

- `/admin`'s Server Component resolves the effective engine with C2's resolver at render and passes
  it as a plain string prop: `AdminPanel` → `ServicesPanel` → `MonthGenerator`, and on to the
  surfaces it gates (C1's «aplica con el nuevo solver» note, C3's card-chip note, C2's preview
  banner, C3's warning gate). Every engine-dependent client branch reads that prop; no client module
  reads `SOLVER_ENGINE` or imports the resolver (`engineProp.test.ts`, C2's `solverDeployment.test.ts`).
  The client props default to the literal `"v2"` for tests only; the guard fails a production mount
  that omits `engine=`.
- `POST /api/admin/solve` resolves the engine on every request and answers a body of the other
  contract (`contract: 3` or not) with `409 { ok: false, error: "solver_version_mismatch", engine }`
  before any other validation — the backstop for a page rendered before a deployment change. Under
  v2 that 409 is the client's one new branch («El solver cambió de versión… Recarga la página»).
- The `"v2" | "v3"` union lives in `solverEngine.ts` (a type adds no import); the resolver's module
  re-exports it.

## Rejected

- **The client fetching the engine** (an endpoint or the fairness GET's `engine`): adds a loading
  state to every planner open and a window where the planner renders under the wrong engine.
- **A `NEXT_PUBLIC_` variable**: baked into the bundle per build, so a Preview override would still
  need a rebuild and could never be refused for `verify/service-readiness`; and production would carry
  a variable its code must ignore.
- **Reading `SOLVER_ENGINE` in client components**: correct in production, wrong on a Preview with the
  override — the exact disagreement this record exists to prevent.

## Consequences

The prop is threaded through three components that did not need it before. A page left open across a
deployment change gets the 409 (or C2's `engine_not_v3` on a record PUT) instead of a mixed solve. C7
flips the constant (and C1's pin test) and touches no client code to do it; a client test that
changes with the constant is a defect (C7 S8).
