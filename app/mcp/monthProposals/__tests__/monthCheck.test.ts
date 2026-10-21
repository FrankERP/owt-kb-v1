// The month check's ADAPTER (plan T2.4, A1–A3): the wire is THE request builder's with only A2's
// overrides, the board's own lines (Lead, voice seats, unavailable people), the rules judged on
// what Frank left, «sin revisar» when a ledger read or the builder fails, and the fair-share lines
// from the ledger's own assembly. The judging core itself is held to the solver's checker by
// `monthCheckParity.test.ts`.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import { V3_EDITOR_LINES as E } from "@/app/components/admin/v3Copy";
import { buildV3SolveRequest } from "@/app/components/admin/v3SolveRequest";
import { ALL_IN, cap, ledgerResponse, restriction } from "@/app/components/admin/__tests__/v3Fixtures";
import type { V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import { assembleFairnessLedger } from "@/app/utils/fairnessLedgerRead";
import { checkWire, fairShareAdjust, monthCheck, monthCheckLines, type MonthCheckInput } from "../monthCheck";
import type { EditorBoard } from "../editorBoard";
import { MEMBERS, board, draft, rules } from "./editorFixtures";

const NOV = ["2026-11"];
const PEOPLE = ["m-ana", "m-bruno", "m-carla", "m-dani"];

function entry(month: string): V3ConfirmEntry {
  return {
    month,
    state: "unrecorded",
    write: {
      month,
      people: PEOPLE.map((memberId) => ({
        memberId,
        roles: memberId === "m-dani" ? { ...ALL_IN, "Sun.Lead": "out", "Sat.Lead": "out" } : memberId === "m-carla" ? { ...ALL_IN, "Sun.Lead": "out" } : { ...ALL_IN },
        exactRules: [],
        exempt: false,
        blocks: [],
      })),
      presence: [],
      source: "auto",
      expectedRev: null,
    },
    expects: ["created", "unchanged"],
  } as V3ConfirmEntry;
}

/** November, every weekend, each Sunday with a Lead and three BGV unless the case says otherwise. */
function november(over: Record<string, Parameters<typeof draft>[3]> = {}): EditorBoard {
  const full = { leads: ["m-bruno"], bgvs: ["m-carla", "m-dani", "m-ana"], chorus: [] };
  const sat = { leads: ["m-carla"], bgvs: ["m-ana", "m-bruno", "m-dani"] };
  const ds = [
    draft("s1", "sunday_role", "2026-11-01", over.s1 ?? full),
    draft("a1", "saturday_role", "2026-11-07", over.a1 ?? sat),
    draft("s2", "sunday_role", "2026-11-08", over.s2 ?? full),
    draft("a2", "saturday_role", "2026-11-14", over.a2 ?? sat),
    draft("s3", "sunday_role", "2026-11-15", over.s3 ?? full),
    draft("a3", "saturday_role", "2026-11-21", over.a3 ?? sat),
    draft("s4", "sunday_role", "2026-11-22", over.s4 ?? full),
    draft("a4", "saturday_role", "2026-11-28", over.a4 ?? sat),
    draft("s5", "sunday_role", "2026-11-29", over.s5 ?? full),
  ];
  return board(ds);
}

function input(b: EditorBoard, over: Partial<MonthCheckInput> = {}): MonthCheckInput {
  return {
    months: NOV,
    currentMonth: "2026-10",
    entries: [entry("2026-11")],
    board: b,
    config: rules(),
    members: MEMBERS,
    storedRoles: [],
    savedWindow: [],
    ledger: ledgerResponse(NOV),
    fairShare: null,
    ...over,
  };
}

function withFairShare(i: MonthCheckInput): MonthCheckInput {
  const adjust = fairShareAdjust({ months: i.months, entries: i.entries, board: i.board, environment: "local", nameOf: (id) => id.slice(2) });
  const { records, services } = adjust({ records: [], services: [] });
  const fair = assembleFairnessLedger({
    target: "2026-12", records, services,
    members: MEMBERS.map((m) => ({ id: m._id, name: m.alias ?? m.member_name, unavailableDates: [] })),
  });
  return { ...i, fairShare: fair };
}

describe("checkWire — A2 over THE request builder", () => {
  it("equals buildV3SolveRequest's wire except planned services unfixed, planned pins dropped, the board's seats as assignments", () => {
    const b = november();
    const planned = b.columns;
    const built = buildV3SolveRequest({
      months: NOV, currentMonth: "2026-10", ledger: ledgerResponse(NOV, { horizon: [{ record: null }] }), config: rules(), members: MEMBERS,
      storedRoles: [], planned: { columns: planned, cells: b.cells, rows: b.rows }, savedWindow: [], fillEmpty: true, seed: 0, requestId: "x",
    });
    if (!built.ok) throw new Error(built.lines.join(" "));
    const { request, assignments } = checkWire(built.request, planned.map((c) => c.columnId), b);
    expect(request.months).toEqual(built.request.months);
    expect(request.people).toEqual(built.request.people);
    expect(request.rules).toEqual(built.request.rules);
    expect(request.prior).toEqual(built.request.prior);
    expect(request.services).toEqual(built.request.services.map((s) => ({ ...s, fixed: false })));
    expect(request.pins).toEqual([]);
    expect(built.request.pins.length).toBeGreaterThan(0);
    const s1 = b.columnIdOf.get("s1")!;
    expect(assignments[s1]).toEqual({ Lead: ["m-bruno"], BGV: ["m-carla", "m-dani", "m-ana"] });
  });

  it("a STORED service keeps the builder's form: fixed, its pins as its seats", () => {
    const b = november();
    const request = {
      contract: 3, seed: 0, request_id: "x", months: NOV, people: [], rules: [], prior: { month: null, services: [] },
      services: [{ id: "stored-1", fixed: true }, { id: b.columns[0].columnId, fixed: true }],
      pins: [{ service: "stored-1", date: "2026-11-04", role: "Lead", person: "m-ana" }, { service: b.columns[0].columnId, date: "2026-11-01", role: "Lead", person: "m-dani" }],
    } as unknown as Parameters<typeof checkWire>[0];
    const out = checkWire(request, [b.columns[0].columnId], b);
    expect(out.request.services).toEqual([{ id: "stored-1", fixed: true }, { id: b.columns[0].columnId, fixed: false }]);
    expect(out.request.pins.map((p) => p.service)).toEqual(["stored-1"]);
    expect(out.assignments["stored-1"]).toEqual({ Lead: ["m-ana"] });
    expect(out.assignments[b.columns[0].columnId].Lead).toEqual(["m-bruno"]);
  });
});

describe("monthCheck", () => {
  it("both reads succeed: checked; «todo cuadra» only when no rule and no service line", () => {
    const c = monthCheck(withFairShare(input(november())));
    expect(c.checked).toBe(true);
    expect(c.notes).toEqual([]);
    const clear = { checked: true, notes: [], rules: [], services: [], fairness: ["x"] };
    expect(monthCheckLines(clear)).toEqual([E.groupFairness, "x", E.allClear]);
    expect(monthCheckLines({ ...clear, services: ["y"] })).toEqual([E.groupServices, "y", E.groupFairness, "x"]);
    expect(monthCheckLines({ ...clear, checked: false, notes: [E.unchecked] })).toEqual([E.unchecked, E.groupFairness, "x"]);
  });

  it("the solve's targets: two Leads, three BGV, three Coro on a Sunday; a Saturday has no Coro", () => {
    const c = monthCheck(withFairShare(input(november())));
    expect(c.services).toContain(E.seats("domingo 1 nov", "Lead", 1, 2));
    expect(c.services).toContain(E.seats("domingo 1 nov", "Coro", 0, 3));
    expect(c.services.some((l) => l.startsWith("sábado") && l.includes("Coro"))).toBe(false);
  });

  it("the board's own lines: no Lead, a voice seat short, someone seated on a day they marked unavailable", () => {
    const away = MEMBERS.map((m) => (m._id === "m-dani" ? { ...m, unavailableDates: ["2026-11-08"] } : m));
    const c = monthCheck(input(november({ s1: { bgvs: ["m-carla", "m-dani", "m-ana"] }, s3: { leads: ["m-bruno"], bgvs: ["m-carla"] } }), { members: away }));
    expect(c.services).toContain(E.noLead("domingo 1 nov"));
    expect(c.services).toContain(E.seats("domingo 15 nov", "BGV", 1, 3));
    expect(c.services).toContain(E.unavailableSeated("Dani", "domingo 8 nov"));
  });

  it("a cap and a pair are judged on what the board holds (Ana and Carla share all nine services)", () => {
    const config = rules({
      restrictions: [restriction("x-bruno", "Bruno", { caps: [cap("c1", "Sun.Lead", "<=", 2)] })],
      conflicts: [{ id: "c-ana-carla", personA: "Ana", personB: "Carla", pattern: "*.*" }],
    });
    const withRules = monthCheck(withFairShare(input(november(), { config }))).rules;
    // Without the rules the same board has none of these lines: they are the rules', not the board's.
    const without = new Set(monthCheck(withFairShare(input(november()))).rules);
    const added = withRules.filter((l) => !without.has(l));
    expect(added.some((l) => l.includes("quedó en 5") && l.includes("pide como máximo 2"))).toBe(true);
    expect(added.filter((l) => l.includes("quedaron juntos"))).toHaveLength(9);
  });

  it("E7: a failed ledger read is «sin revisar», names what it omitted, and still judges the board", () => {
    const c = monthCheck(input(november({ s1: { bgvs: [] } }), { ledger: null }));
    expect(c.checked).toBe(false);
    expect(c.notes).toEqual([E.unchecked, E.omittedLedger]);
    expect(c.services).toContain(E.noLead("domingo 1 nov"));
    expect(monthCheckLines(c)).not.toContain(E.allClear);
  });

  it("a failed fair-share read alone is «sin revisar» too", () => {
    const c = monthCheck(input(november(), { fairShare: null }));
    expect(c.checked).toBe(false);
    expect(c.notes).toEqual([E.unchecked]);
    expect(c.fairness).toEqual([]);
  });

  it("A3: a builder refusal is «sin revisar» with the builder's own lines; the board's lines stay", () => {
    // «Mes por medio» on a name that resolves to nobody refuses the build before any read.
    const config = rules({ restrictions: [restriction("x", "Nadie", { sundayCadence: "alternate" })] });
    const c = monthCheck(withFairShare(input(november({ s2: { leads: [], bgvs: [] } }), { config })));
    expect(c.checked).toBe(false);
    expect(c.notes[0]).toBe(E.uncheckedBuild);
    expect(c.notes.length).toBeGreaterThan(1);
    expect(c.services).toContain(E.noLead("domingo 8 nov"));
  });

  it("fair share: the ledger's own figures, one line per person a full seat off their share", () => {
    const lopsided = november({
      s1: { leads: ["m-bruno"], bgvs: ["m-carla", "m-dani", "m-ana"] },
      a1: { leads: ["m-carla"], bgvs: ["m-ana", "m-bruno", "m-dani"] },
    });
    const c = monthCheck(withFairShare(input(lopsided)));
    expect(c.checked).toBe(true);
    // Bruno leads every Sunday: far over his share of Sunday Lead.
    expect(c.fairness.join("\n")).toMatch(/noviembre/);
    for (const line of c.fairness) expect(line).toMatch(/le tocaban/);
  });
});
