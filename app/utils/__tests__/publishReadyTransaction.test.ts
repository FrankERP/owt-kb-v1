// The Plan B publish-ready transaction helper (Service Readiness A2 §6).
//
// The planner is pure, so every assertion it emits is checked exactly; the
// executor is replayed onto a recording transaction to prove each op is a
// revision-guarded patch and nothing else.

import { describe, expect, it, vi } from "vitest";

// The helper is `import "server-only"` guarded; neutralize the marker.
vi.mock("server-only", () => ({}));

import {
  applyPublishReadyAssertions,
  planPublishReadyAssertions,
  type PublishReadyAssertion,
} from "@/app/utils/publishReadyTransaction";

function weekend(over: Partial<PublishReadyAssertion> = {}): PublishReadyAssertion {
  return {
    role: { id: "role-1", rev: "role-rev", dateField: "week", date: "2026-08-09" },
    lock: { id: "roleTarget.sunday_role.2026-08-09", rev: "lock-rev" },
    special: false,
    setlist: { state: "single", id: "featuredSongs.2026-08-09", rev: "set-rev" },
    setlistWeek: "2026-08-09",
    proposal: { state: "single", id: "setlistProposal.role-1", rev: "prop-rev" },
    proposalServiceDate: "2026-08-09",
    members: [
      { id: "mem-1", rev: "m1", unavailableDates: ["2026-08-16"] },
      { id: "mem-2", rev: "m2" },
    ],
    ...over,
  };
}

describe("planPublishReadyAssertions", () => {
  it("asserts role, lock, setlist, proposal and every member in one plan", () => {
    const plan = planPublishReadyAssertions(weekend());
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.ops).toEqual([
      {
        kind: "assert",
        id: "role-1",
        rev: "role-rev",
        set: { week: "2026-08-09" },
        unset: [],
        subject: "role",
      },
      {
        kind: "assert",
        id: "roleTarget.sunday_role.2026-08-09",
        rev: "lock-rev",
        set: {},
        unset: [],
        subject: "lock",
      },
      {
        kind: "assert",
        id: "featuredSongs.2026-08-09",
        rev: "set-rev",
        set: { week: "2026-08-09" },
        unset: [],
        subject: "setlist",
      },
      {
        kind: "assert",
        id: "setlistProposal.role-1",
        rev: "prop-rev",
        set: { service_date: "2026-08-09" },
        unset: [],
        subject: "proposal",
      },
      // Availability is asserted by writing back exactly what was observed…
      {
        kind: "assert",
        id: "mem-1",
        rev: "m1",
        set: { unavailableDates: ["2026-08-16"] },
        unset: [],
        subject: "member",
      },
      // …or by unsetting a field that is already absent. Neither changes data.
      {
        kind: "assert",
        id: "mem-2",
        rev: "m2",
        set: {},
        unset: ["unavailableDates"],
        subject: "member",
      },
    ]);
  });

  it("never sends _type in any assertion (it is immutable per document id)", () => {
    const plan = planPublishReadyAssertions(weekend());
    expect(plan.ok && plan.ops.every((op) => !("_type" in op.set))).toBe(true);
  });

  it("asserts an absent weekend setlist/proposal through the lock alone", () => {
    const plan = planPublishReadyAssertions(
      weekend({ setlist: { state: "none" }, proposal: { state: "none" }, members: [] }),
    );
    expect(plan.ok && plan.ops.map((o) => o.subject)).toEqual(["role", "lock"]);
  });

  it("refuses a weekend assertion with no coordination token", () => {
    // Without the lock, "there is still no setlist/proposal" is unprotected — a
    // concurrent deterministic create heartbeats exactly that lock.
    expect(planPublishReadyAssertions(weekend({ lock: null }))).toEqual({
      ok: false,
      issues: ["lock"],
    });
  });

  it("asserts a special service through its own role revision, with no weekend lock", () => {
    const plan = planPublishReadyAssertions({
      role: { id: "role-sp", rev: "sp-rev", dateField: "date", date: "2026-08-20" },
      lock: null,
      special: true,
      setlist: { state: "single", id: "role-sp", rev: "sp-rev" },
      proposal: { state: "none" },
      members: [{ id: "mem-1", rev: "m1", unavailableDates: [] }],
    });
    expect(plan.ok && plan.ops).toEqual([
      { kind: "assert", id: "role-sp", rev: "sp-rev", set: { date: "2026-08-20" }, unset: [], subject: "role" },
      { kind: "assert", id: "mem-1", rev: "m1", set: { unavailableDates: [] }, unset: [], subject: "member" },
    ]);
  });

  it.each([
    ["a special service carrying a weekend lock", { special: true }],
    ["a missing role revision", { role: { id: "role-1", rev: "", dateField: "week" as const, date: "2026-08-09" } }],
    ["a singleton setlist with no guard value", { setlistWeek: null }],
    ["a singleton proposal with no guard value", { proposalServiceDate: null }],
    ["a member with no revision", { members: [{ id: "mem-1", rev: "" }] }],
  ])("fails closed on %s", (_label, patch) => {
    expect(planPublishReadyAssertions(weekend(patch as Partial<PublishReadyAssertion>)).ok).toBe(false);
  });

  it("refuses a special setlist observation that is not the role itself", () => {
    const plan = planPublishReadyAssertions({
      role: { id: "role-sp", rev: "sp-rev", dateField: "date", date: "2026-08-20" },
      lock: null,
      special: true,
      setlist: { state: "single", id: "featuredSongs.2026-08-20", rev: "x" },
      proposal: { state: "none" },
      members: [],
    });
    expect(plan).toEqual({ ok: false, issues: ["setlist_identity"] });
  });

  it("asserts each member once even when the same person holds several seats", () => {
    const plan = planPublishReadyAssertions(
      weekend({
        members: [
          { id: "mem-1", rev: "m1", unavailableDates: [] },
          { id: "mem-1", rev: "m1", unavailableDates: [] },
        ],
      }),
    );
    expect(plan.ok && plan.ops.filter((o) => o.subject === "member")).toHaveLength(1);
  });
});

describe("applyPublishReadyAssertions", () => {
  it("replays every op as a revision-guarded patch and nothing else", () => {
    interface Op { id: string; rev: string | null; set: Record<string, unknown>; unset: string[] }
    const ops: Op[] = [];
    interface Patcher {
      ifRevisionId(rev: string): unknown;
      set(values: Record<string, unknown>): unknown;
      unset(fields: string[]): unknown;
    }
    const tx = {
      patch(id: string, fn: (p: Patcher) => unknown) {
        const op: Op = { id, rev: null, set: {}, unset: [] };
        const p = {
          ifRevisionId(rev: string) { op.rev = rev; return p; },
          set(values: Record<string, unknown>) { Object.assign(op.set, values); return p; },
          unset(fields: string[]) { op.unset.push(...fields); return p; },
        };
        fn(p);
        ops.push(op);
        return tx;
      },
    };
    const plan = planPublishReadyAssertions(weekend());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(applyPublishReadyAssertions(tx, plan.ops)).toBe(tx);
    expect(ops.map((o) => `${o.id}@${o.rev}`)).toEqual([
      "role-1@role-rev",
      "roleTarget.sunday_role.2026-08-09@lock-rev",
      "featuredSongs.2026-08-09@set-rev",
      "setlistProposal.role-1@prop-rev",
      "mem-1@m1",
      "mem-2@m2",
    ]);
    expect(ops.every((o) => o.rev !== null)).toBe(true);
    expect(ops.find((o) => o.id === "mem-2")).toEqual({
      id: "mem-2",
      rev: "m2",
      set: {},
      unset: ["unavailableDates"],
    });
  });
});
