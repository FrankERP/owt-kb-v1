/** @vitest-environment jsdom */
// The shared rule set as the CLIENT sees it — and the cutover that retired
// `owt_solver_config_v3`.
//
// This file replaces `solverConfigStorage.test.ts`, whose subject no longer
// exists: `readStoredSolverConfig`, `normalizeStoredSolverConfig` and
// `isFirstRunSolverSeed` were the `localStorage` era's answer to "are these the
// team's rules or a stand-in?", and the server answers it now. The QUESTION did
// not retire — `ready` vs `absent` is the same distinction with a fact behind it
// instead of a content-equality heuristic — so the pin that mattered most there
// survives here in a stronger form: `absent` yields the defaults IN MEMORY ONLY
// and carries no `rev`, so it can never be written back over the shared
// document.
//
// Four properties, each a way the live rules could still be lost:
//
//   · "absent" and "read failed" never collapse into one `?? DEFAULT`;
//   · a save is UNREPRESENTABLE outside `ready` — no `rev` exists elsewhere;
//   · the rule panel and the grid read ONE controller, so they cannot drift;
//   · nothing reads or writes the retired browser key any more.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SOLVER_CONFIG } from "../solverConfigDefaults";
import {
  READ_FAILED_MESSAGE,
  SAVE_ABSENT_MESSAGE,
  SAVE_FORBIDDEN_MESSAGE,
  SAVE_REJECTED_MESSAGE,
  SAVE_STALE_MESSAGE,
  editableConfig,
  sameSolverConfig,
  saveFailure,
  sourceFromGet,
  type SolverConfigSource,
} from "../solverConfigSource";
import type { SolverConfig } from "../plannerModel";

const STORED = {
  present: true,
  rev: "rev-7",
  config: {
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
  },
};

describe("sourceFromGet — absent and failed are different answers", () => {
  it("a present document is `ready`, carrying the rev a save needs", () => {
    const source = sourceFromGet(true, STORED);
    expect(source.status).toBe("ready");
    if (source.status !== "ready") throw new Error("unreachable");
    expect(source.rev).toBe("rev-7");
    expect(source.config.conflicts).toEqual(STORED.config.conflicts);
    expect(source.config.restrictions[0].weekExclusions).toEqual([
      { id: "w1", week: 3, pattern: "*.*" },
    ]);
  });

  it("an absent document is `absent` with the defaults — and NO rev", () => {
    // The defaults are in memory only. There is no `rev`, so `save` cannot be
    // called at all: "the first Guardar mints the shared document out of
    // DEFAULT_SOLVER_CONFIG" is not a bug to avoid, it is unspellable.
    const source = sourceFromGet(true, { present: false, rev: null, config: null });
    expect(source).toEqual({ status: "absent", config: DEFAULT_SOLVER_CONFIG });
    expect(source).not.toHaveProperty("rev");
  });

  it("a FAILED read is `error` — never `absent`, and never a config", () => {
    // THE test this module exists for. Collapse the two states into one
    // `fetched ?? DEFAULT_SOLVER_CONFIG` and a transient network blip becomes
    // "your team's rules are the shipped samples", with hard blocks degraded to
    // whatever the samples say until somebody notices.
    for (const failed of [
      sourceFromGet(false, { error: "Forbidden" }),
      sourceFromGet(false, null),
      sourceFromGet(true, null),
      sourceFromGet(true, "not an object"),
    ]) {
      expect(failed.status).toBe("error");
      expect(failed).not.toHaveProperty("config");
      if (failed.status === "error") expect(failed.message).toBe(READ_FAILED_MESSAGE);
    }
  });

  it("a malformed successful response is `error` — only explicit false confirms absence", () => {
    for (const malformed of [
      {},
      { present: null },
      { present: "false" },
      { present: 0 },
    ]) {
      const source = sourceFromGet(true, malformed);
      expect(source.status).toBe("error");
      expect(source).not.toHaveProperty("config");
    }
  });

  it("a present document with no usable rev is an ERROR, not an absent one", () => {
    // A document we cannot name a revision for is one we must not overwrite.
    // Calling it "absent" would put the client and the seed script's
    // refuse-if-exists guard into disagreement about the same document.
    expect(sourceFromGet(true, { present: true, rev: null, config: {} }).status).toBe("error");
    expect(sourceFromGet(true, { present: true, rev: "", config: {} }).status).toBe("error");
  });
});

describe("editableConfig — what the RULE PANEL may show", () => {
  it("shows the document, or the defaults when there is none", () => {
    expect(editableConfig(sourceFromGet(true, STORED))?.support).toEqual(["Niza"]);
    expect(editableConfig(sourceFromGet(true, { present: false }))).toBe(DEFAULT_SOLVER_CONFIG);
  });

  it("shows NOTHING while loading or after a failed read", () => {
    // The panel renders the reason instead. Returning the defaults here is the
    // same collapse one screen over — and the save control sits underneath.
    expect(editableConfig({ status: "loading" })).toBeNull();
    expect(editableConfig({ status: "error", message: "x" })).toBeNull();
  });
});

describe("saveFailure — branching on the machine code, never on prose", () => {
  it("tells a lost race apart from every other failure", () => {
    // Reporting everything as `stale_revision` is the loop the route header
    // describes: reload, get the same rev back, retry, fail identically.
    expect(saveFailure(409, { error: "stale_revision" })).toEqual({
      message: SAVE_STALE_MESSAGE,
      stale: true,
    });
    expect(saveFailure(404, { error: "not_found" })).toEqual({
      message: SAVE_ABSENT_MESSAGE,
      stale: false,
    });
    expect(saveFailure(400, { error: "invalid_request" })).toEqual({
      message: SAVE_REJECTED_MESSAGE,
      stale: false,
    });
    expect(saveFailure(403, { error: "Forbidden" })).toEqual({
      message: SAVE_FORBIDDEN_MESSAGE,
      stale: false,
    });
    const unknown = saveFailure(500, null);
    expect(unknown.stale).toBe(false);
    expect(unknown.message).toContain("500");
  });
});

describe("sameSolverConfig", () => {
  it("compares content, not references or field order", () => {
    const reordered = {
      presence: DEFAULT_SOLVER_CONFIG.presence,
      conflicts: DEFAULT_SOLVER_CONFIG.conflicts,
      restrictions: DEFAULT_SOLVER_CONFIG.restrictions,
      support: DEFAULT_SOLVER_CONFIG.support,
      saturdayLeads: DEFAULT_SOLVER_CONFIG.saturdayLeads,
      sundayLeads: DEFAULT_SOLVER_CONFIG.sundayLeads,
    } as SolverConfig;
    expect(sameSolverConfig(DEFAULT_SOLVER_CONFIG, reordered)).toBe(true);
    expect(
      sameSolverConfig(DEFAULT_SOLVER_CONFIG, { ...DEFAULT_SOLVER_CONFIG, support: ["Niza"] }),
    ).toBe(false);
    // A NESTED edit counts too, or "Guardado" would lie about a changed rule.
    expect(
      sameSolverConfig(DEFAULT_SOLVER_CONFIG, {
        ...DEFAULT_SOLVER_CONFIG,
        conflicts: DEFAULT_SOLVER_CONFIG.conflicts.map((c, i) =>
          i === 0 ? { ...c, pattern: "*.Lead" } : c,
        ),
      }),
    ).toBe(false);
  });
});

// ── The links a render test cannot reach ────────────────────────────────────
//
// There is no `ServicesPanel` render harness in this repo (it drives five
// independent source loads, a readiness gate matrix and a snapshot/stale
// machine). SOURCE assertions, in the style `studioProtection.test.ts` already
// uses, are what stop the wiring from being dropped in a refactor with every
// other test still green.
describe("ServicesPanel wires ONE rule set to its roster surfaces", () => {
  const src = readFileSync(
    path.join(process.cwd(), "app/components/admin/ServicesPanel.tsx"),
    "utf8",
  );

  it("fetches the rules exactly once, in the panel that owns both surfaces", () => {
    expect(src).toContain("useSolverConfig");
    expect(src.match(/useSolverConfig\(\)/g) ?? []).toHaveLength(1);
  });

  it("retires every SeatBoard mount after create and edit move to the month editor", () => {
    const mounts = src.match(/<SeatBoard[\s\S]*?\/>/g) ?? [];
    expect(mounts).toHaveLength(0);
    expect(src).not.toContain('from "./SeatBoard"');
  });

  it("hands every generator the SAME controller object", () => {
    // Two `useSolverConfig()` calls would read the same document through the
    // same code and still drift: save a rule in the generator, close it, open a
    // service, and the board would enforce the copy it fetched before the edit.
    expect(src).toMatch(/<MonthGenerator[\s\S]*?rules=\{rules\}[\s\S]*?\/>/);
  });

  it("mounts stored editing with independent role and integrity observations", () => {
    expect(src).toMatch(/<MonthGenerator[\s\S]*?mode="stored"[\s\S]*?initialMonth=\{monthEditor\.month\}/);
    expect(src).toContain("rolesStatus: sourceRecords.roles.status");
    expect(src).toContain("integrityStatus: sourceRecords.roleTargets.status");
    expect(src).toContain("rolesGeneration: sourceRecords.roles.generation");
    expect(src).toContain("integrityGeneration: sourceRecords.roleTargets.generation");
    expect(src).toContain('loadSources(["roles", "roleTargets"])');
  });

  it("routes card roster actions into the stored month editor", () => {
    expect(src.match(/openMonthEditor\(card\.role\.date\.slice\(0, 7\), card\.role\._id, false, \{ kind: "card", roleId: card\.role\._id \}\)/g) ?? [])
      .toHaveLength(2);
    expect(src).toContain('data-card-id="${escaped}"');
    expect(src).toContain("Editar mes");
    expect(src).not.toContain('openEditModal({ type: "edit"');
  });

  it("routes Nuevo to the stored editor's safe create-one composer", () => {
    expect(src).toMatch(/openMonthEditor\(selectedMonths\.size === 1 \? \[\.\.\.selectedMonths\]\[0\] : currentYM, undefined, true, \{ kind: "new" \}\)/);
    expect(src).toContain("ref={newServiceTriggerRef}");
    expect(src).toContain("openComposerInitially={monthEditor.openComposerInitially}");
    expect(src).not.toContain('openEditModal({ type: "add"');
  });

  it("retires the legacy card swap entry after stored grid swaps ship", () => {
    expect(src).not.toContain("const [swapMode");
    expect(src).toContain("swapMode={false}");
    expect(src).not.toContain("SwapConfirmModal");
    expect(src).not.toContain("Modo intercambio activo");
  });

  it("allows the stored editor to show its own read-only and retry state", () => {
    const opener = src.slice(src.indexOf("function openMonthEditor"), src.indexOf("// ── Render", src.indexOf("function openMonthEditor")));
    expect(opener).toContain("if (openComposerInitially)");
    expect(opener.match(/guardControl\(/g) ?? []).toHaveLength(1);
    expect(opener).toContain('guardControl(sources, "createService")');
  });
});

describe("the localStorage rule set is RETIRED", () => {
  it("no production source USES `owt_solver_config_v3` any more", () => {
    // Read and write had to go in the SAME change as the fetch: both called
    // `setSolverConfig`, so with both live the fetched document was mirrored
    // straight back into the browser key and load order decided which won —
    // unspecified, and different on a cold load than on a re-render.
    //
    // Comments are stripped rather than matched, because several files
    // deliberately NAME the retired key while explaining the retirement (this
    // one included). Tests are excluded because two of them assert the key stays
    // empty, which requires spelling it.
    const tracked = execFileSync("git", ["ls-files", "app", "sanity", "scripts"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      .filter((f) => !f.includes("__tests__") && !/\.test\./.test(f));
    const hits = tracked.filter((f) =>
      readFileSync(path.join(process.cwd(), f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .includes("owt_solver_config_v3"),
    );
    expect(hits, "the browser key must not be read or written").toEqual([]);
  });

  it("the generator no longer imports a `localStorage` reader for the rules", () => {
    // The comment-stripping above cannot see a re-introduced import, and the
    // retired module is the only thing that ever read the key.
    const generator = readFileSync(
      path.join(process.cwd(), "app/components/admin/MonthGenerator.tsx"),
      "utf8",
    );
    expect(generator).not.toContain("solverConfigStorage");
    expect(generator).not.toContain("readStoredSolverConfig");
    expect(generator).not.toContain("isFirstRunSolverSeed");
    // And the retired module is gone from the tree entirely.
    const tracked = execFileSync("git", ["ls-files", "app"], { encoding: "utf8" });
    expect(tracked).not.toContain("solverConfigStorage.ts");
  });

  it("keeps `owt_solver_history_v2` per-browser, on purpose", () => {
    // P6 shares the RULES, not the fairness history (ADR-0010). Two admins
    // still solve against different history — narrower than "shared rules"
    // sounds, and deliberately out of scope.
    const generator = readFileSync(
      path.join(process.cwd(), "app/components/admin/MonthGenerator.tsx"),
      "utf8",
    );
    expect(generator).toContain("owt_solver_history_v2");
  });
});

describe("the source union cannot express a save outside `ready`", () => {
  // Not a style point: `SolverConfigController.save` demands a `rev`, so there
  // is no value to pass from `absent`/`loading`/`error`. The route's
  // refuse-to-create is the second, independent lock.
  //
  // This used to be asserted over four hand-built literals — which tested the
  // fixture, not the module: adding `rev?: string` to the `absent` variant AND
  // making `sourceFromGet` emit `rev: "sneaky"` on absent left it green. Both
  // halves of the property are now pinned against something that can move:
  // the RUNTIME half over `sourceFromGet`'s own outputs, the TYPE half against
  // the union itself, so widening a variant fails `tsc` rather than nothing.

  it("emits a rev on `ready` and on no other state it can produce", () => {
    for (const body of [
      { present: false, rev: null, config: null },
      { present: false },
      { present: true, rev: null, config: {} },
      { present: true, rev: "", config: {} },
      null,
      "not an object",
    ]) {
      const source = sourceFromGet(true, body);
      expect(source.status, JSON.stringify(body)).not.toBe("ready");
      expect(source, JSON.stringify(body)).not.toHaveProperty("rev");
    }
    for (const failedRead of [sourceFromGet(false, STORED), sourceFromGet(false, null)]) {
      expect(failedRead.status).toBe("error");
      expect(failedRead).not.toHaveProperty("rev");
    }
    const ready = sourceFromGet(true, STORED);
    expect(ready.status).toBe("ready");
    expect(ready).toHaveProperty("rev", "rev-7");
  });

  it("does not let the TYPE carry a rev anywhere but `ready`", () => {
    // `@ts-expect-error` inverted: each of these fails `npx tsc --noEmit` today
    // because `rev` is an excess property, and would START failing — as an
    // UNUSED expect-error — the moment somebody widened the variant to accept
    // it. That is the mutation the old literal-based test could not see.
    // Written per-variant, against `Extract<SolverConfigSource, {status: …}>`,
    // rather than annotated as the bare union: `SolverConfigSource` is
    // discriminated on `status`, so TS narrows to the matching member before
    // excess-property-checking these literals either way — both forms are
    // sound here. `Extract<…>` is kept because each directive then pins the
    // ONE variant it names, legible at the assertion itself rather than left
    // to whichever member TS happens to narrow to.
    const absent: Extract<SolverConfigSource, { status: "absent" }> = {
      status: "absent",
      config: DEFAULT_SOLVER_CONFIG,
      // @ts-expect-error `absent` must not carry a rev: there is no document to revise.
      rev: "r",
    };
    const failed: Extract<SolverConfigSource, { status: "error" }> = {
      status: "error",
      message: "x",
      // @ts-expect-error `error` must not carry a rev: we could not read the document.
      rev: "r",
    };
    const loading: Extract<SolverConfigSource, { status: "loading" }> = {
      status: "loading",
      // @ts-expect-error `loading` must not carry a rev: nothing is known yet.
      rev: "r",
    };
    expect([absent.status, failed.status, loading.status]).toEqual([
      "absent",
      "error",
      "loading",
    ]);
  });
});
