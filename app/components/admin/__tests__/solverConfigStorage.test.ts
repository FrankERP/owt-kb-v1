/** @vitest-environment jsdom */
// The `localStorage` rule set, read through ONE module.
//
// It exists because two surfaces now read the same key — `MonthGenerator` (which
// always did) and `ServicesPanel`, which feeds `SeatBoard`, so the Tablero
// enforces exactly what the planner grid enforces. A second hand-rolled copy of
// this normaliser is how a legacy `conflicts`/`presence`-less value white-screens
// one surface and not the other.

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  SOLVER_CONFIG_STORAGE_KEY,
  normalizeStoredSolverConfig,
  readStoredSolverConfig,
} from "../solverConfigStorage";

beforeEach(() => localStorage.clear());

describe("normalizeStoredSolverConfig", () => {
  it("fills the four fields a legacy persisted config can be missing", () => {
    // `conflicts` and `presence` were added to `SolverConfig` after this key was
    // first written; the acceptance test has only ever checked `sundayLeads` and
    // `restrictions`. Without this, `RuleBuilder` iterates `undefined` during the
    // config step's own first render and the panel white-screens.
    const legacy = { sundayLeads: ["Frank"], restrictions: [] };
    const out = normalizeStoredSolverConfig(legacy);
    expect(out).toEqual({
      sundayLeads: ["Frank"],
      saturdayLeads: [],
      support: [],
      restrictions: [],
      conflicts: [],
      presence: [],
    });
    for (const v of Object.values(out!)) expect(Array.isArray(v)).toBe(true);
  });

  it("keeps the original two-field acceptance test, neither widened nor narrowed", () => {
    // Widening starts accepting values the generator has always ignored;
    // narrowing starts rejecting an admin's live rules.
    expect(normalizeStoredSolverConfig({ restrictions: [] })).toBeNull();
    expect(normalizeStoredSolverConfig({ sundayLeads: [] })).toBeNull();
    expect(normalizeStoredSolverConfig({ sundayLeads: [], restrictions: [] })).not.toBeNull();
    expect(normalizeStoredSolverConfig(null)).toBeNull();
    expect(normalizeStoredSolverConfig("nope")).toBeNull();
  });

  it("preserves every stored rule verbatim", () => {
    const stored = {
      sundayLeads: ["Frank"],
      saturdayLeads: ["Mkz"],
      support: ["Niza"],
      restrictions: [
        {
          id: "r1",
          person: "Frank",
          excludedPatterns: ["Sat.*"],
          fairness: "exempt",
          fairnessSlack: 1,
          weekExclusions: [{ id: "w1", week: 3, pattern: "*.*" }],
          caps: [],
        },
      ],
      conflicts: [{ id: "c1", personA: "Lucía", personB: "Niza", pattern: "*.LeadBGV" }],
      presence: [{ id: "p1", persons: ["Hugo"], pattern: "Sun.BGV" }],
    };
    expect(normalizeStoredSolverConfig(stored)).toEqual(stored);
  });
});

describe("readStoredSolverConfig", () => {
  it("returns null when this browser holds no rules — never the defaults", () => {
    // `null` means "no rules here". A browser with none must not start
    // hard-blocking picks against a rule set nobody on this team ever wrote.
    expect(readStoredSolverConfig()).toBeNull();
  });

  it("returns null rather than throwing on a corrupt value", () => {
    localStorage.setItem(SOLVER_CONFIG_STORAGE_KEY, "{not json");
    expect(readStoredSolverConfig()).toBeNull();
  });

  it("reads and normalises the stored value", () => {
    localStorage.setItem(
      SOLVER_CONFIG_STORAGE_KEY,
      JSON.stringify({ sundayLeads: ["Frank"], restrictions: [] }),
    );
    expect(readStoredSolverConfig()?.conflicts).toEqual([]);
    expect(readStoredSolverConfig()?.sundayLeads).toEqual(["Frank"]);
  });

  it("reads the key `MonthGenerator` has always written", () => {
    // The two must never diverge: the generator writes on every config change,
    // and `ServicesPanel` reads on every seat-modal open.
    expect(SOLVER_CONFIG_STORAGE_KEY).toBe("owt_solver_config_v3");
  });
});

// ── The one link a render test cannot reach ────────────────────────────────
//
// `SeatBoard` enforces the rules only if `ServicesPanel` hands it a `config`,
// and there is no `ServicesPanel` render harness in this repo (it drives five
// independent source loads, a readiness gate matrix and a snapshot/stale
// machine). A SOURCE assertion, in the style `studioProtection.test.ts` already
// uses for the Studio config, is what stops the prop from being dropped in a
// refactor and the Tablero silently going back to enforcing nothing — with
// every other test in this file still green.
describe("ServicesPanel feeds SeatBoard the rules", () => {
  const src = readFileSync(
    path.join(process.cwd(), "app/components/admin/ServicesPanel.tsx"),
    "utf8",
  );

  it("passes `config` to BOTH seat boards — the create one and the edit one", () => {
    const mounts = src.match(/<SeatBoard[\s\S]*?\/>/g) ?? [];
    expect(mounts.length, "expected the add and edit SeatBoard mounts").toBe(2);
    for (const mount of mounts) {
      expect(mount, "a SeatBoard mount with no config enforces nothing").toContain("config=");
    }
  });

  it("refreshes the rules when a seat modal opens, from this module", () => {
    // Through `readStoredSolverConfig` — not a second hand-rolled read, which
    // would be a second copy of the legacy-config normaliser to keep in step.
    expect(src).toContain("readStoredSolverConfig");
    expect(src, "the refresh belongs at modal-open, not on mount").toMatch(
      /openEditModal[\s\S]*?setSolverConfig\(readStoredSolverConfig\(\)\)/,
    );
  });
});
