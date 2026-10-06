// app/components/admin/solverEngine.ts
//
// THE solver-engine constant (solver v3, parent amendment A1). C1 creates it with
// the value "v2" and nothing else. C2 adds the effective-engine resolver and its
// Preview-only override beside it, C6 wires the server-resolved engine into the
// planner, and C7 flips this value to "v3" at cutover. Until C6, the planner's
// «aplica con el nuevo solver» note reads this constant directly.
//
// A CODE CONSTANT, not an environment variable: one value in every bundle, so no
// docs/SECRETS.md entry.
//
// NEUTRAL (ADR-0028): no "use client" and no imports. Tests pick an engine with
// vi.mock("../solverEngine", ...).
//
// The explicit annotation is load-bearing, exactly as in solverHistorySource.ts:
// without it the constant's type is the literal "v2", and every comparison against
// "v3" in a consumer becomes a TS2367 "no overlap" error instead of the branch it
// is meant to be.

export const SOLVER_ENGINE: "v2" | "v3" = "v2";
