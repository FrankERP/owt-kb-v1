// Test-only `SolverConfigController`s — NOT a test file (no `.test.` in the
// name, so vitest's `include` never picks it up).
//
// `MonthGenerator` takes the shared rule set as a REQUIRED prop, so every render
// has to say which of the four states it is in. `readyRules()` is the state
// production is in (the document exists, seeded 2026-08-02) and is what the
// ~65 pre-existing renders use, which keeps them exercising exactly the rule set
// they always did: `DEFAULT_SOLVER_CONFIG` was the component's initial state
// before the cutover.

import { vi } from "vitest";

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import { READ_FAILED_MESSAGE, type SolverConfigController } from "../solverConfigSource";
import type { SolverConfig } from "../plannerModel";

export interface RulesHarness extends SolverConfigController {
  save: SolverConfigController["save"] & ReturnType<typeof vi.fn>;
  reload: SolverConfigController["reload"] & ReturnType<typeof vi.fn>;
}

/** The document exists — the production state. */
export function readyRules(
  config: SolverConfig = DEFAULT_SOLVER_CONFIG,
  opts: { rev?: string; save?: SolverConfigController["save"] } = {},
): RulesHarness {
  const save = vi.fn(opts.save ?? (async () => ({ ok: true as const })));
  return {
    source: { status: "ready", rev: opts.rev ?? "rev-1", config },
    reload: vi.fn(),
    save,
  } as RulesHarness;
}

/** No shared document yet — the defaults, in memory only, and no `rev` to save under. */
export function absentRules(): RulesHarness {
  return {
    source: { status: "absent", config: DEFAULT_SOLVER_CONFIG },
    reload: vi.fn(),
    save: vi.fn(async () => ({ ok: true as const })),
  } as RulesHarness;
}

/** The read FAILED. Never the defaults — that collapse is the whole point. */
export function failedRules(message = READ_FAILED_MESSAGE): RulesHarness {
  return {
    source: { status: "error", message },
    reload: vi.fn(),
    save: vi.fn(async () => ({ ok: true as const })),
  } as RulesHarness;
}

/** The read has not answered yet. */
export function loadingRules(): RulesHarness {
  return {
    source: { status: "loading" },
    reload: vi.fn(),
    save: vi.fn(async () => ({ ok: true as const })),
  } as RulesHarness;
}
