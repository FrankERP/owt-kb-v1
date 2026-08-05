import { describe, expect, it } from "vitest";
import type { RoleDomainSummary, RoleTarget } from "@/app/utils/serviceReadSummary";
import {
  buildStoredGridRows,
  joinStoredRoleInventory,
  translateStoredRole,
} from "../storedRoleReadModel";

const member = (id: string, key: string) => ({ _id: id, _key: key, member_name: id });

function role(overrides: Record<string, unknown> = {}) {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    date: "2026-02-01",
    published: false,
    leads: [member("lead-1", "lead-key")],
    bgvs: [member("bgv-1", "bgv-key")],
    chorus: [member("chorus-1", "chorus-key")],
    instruments: [{ _key: "inst-key", instrument: "Bass", person: member("bass-1", "ignored") }],
    foh: [{ _key: "foh-key", role: "Console", person: member("foh-1", "ignored") }],
    ...overrides,
  };
}

const refs = ["lead-1", "bgv-1", "chorus-1", "bass-1", "foh-1"];

function target(overrides: Partial<RoleTarget> = {}): RoleTarget {
  return {
    targetKey: "sunday_role:2026-02-01",
    type: "sunday_role",
    canonicalCount: 1,
    canonicalIds: ["role-1"],
    canonicalState: "single",
    publicState: "single",
    memberVisibleCount: 0,
    draftIds: [],
    records: [{
      id: "role-1",
      rev: "rev-1",
      type: "sunday_role",
      serviceDate: "2026-02-01",
      published: false,
      assignedRefs: refs,
      members: [],
      danglingRefs: [],
    }],
    expectsLock: true,
    lock: {
      id: "roleTarget.sunday_role.2026-02-01",
      rev: "lock-rev",
      state: "claimed",
      roleId: "role-1",
      generation: 1,
    },
    lockIssues: [],
    ...overrides,
  };
}

function summary(targets: RoleTarget[] = [target()]): RoleDomainSummary {
  return { targets, recordIssues: [], lockIssues: targets.flatMap((item) => item.lockIssues) };
}

describe("joinStoredRoleInventory", () => {
  it("admits a complete role only after exact inventory and assignment reconciliation", () => {
    const result = joinStoredRoleInventory([role()], summary());
    expect(result.coherent).toBe(true);
    expect(result.roles[0]).toMatchObject({ admission: "approved", reasons: [] });
    expect(result.roles[0]?.assignedRefs).toEqual(refs);
  });

  it.each([
    ["missing peer", [], summary()],
    ["extra integrity peer", [role()], summary([target(), target({
      targetKey: "sunday_role:2026-02-08",
      canonicalIds: ["role-2"],
      records: [{ ...target().records[0]!, id: "role-2", rev: "rev-2", serviceDate: "2026-02-08" }],
    })])],
    ["revision race", [role()], summary([target({ records: [{ ...target().records[0]!, rev: "other" }] })])],
  ])("blocks the whole inventory on %s", (_name, rows, integrity) => {
    const result = joinStoredRoleInventory(rows, integrity);
    expect(result.coherent).toBe(false);
    expect(result.roles.every((entry) => entry.admission === "readOnly")).toBe(true);
  });

  it("blocks all roles when integrity exposes an untyped issue or raw draft", () => {
    const withIssue = summary();
    withIssue.recordIssues.push({ id: "drafts.unknown", kind: "draft_only", issues: ["draft_only"] });
    expect(joinStoredRoleInventory([role()], withIssue).coherent).toBe(false);

    const withDraft = summary([target({ draftIds: ["drafts.role-1"], publicState: "draft_conflict" })]);
    expect(joinStoredRoleInventory([role()], withDraft).coherent).toBe(false);
  });

  it("keeps every duplicate weekend target read-only after coherent reconciliation", () => {
    const peer = role({ _id: "role-2", _rev: "rev-2" });
    const duplicateTarget = target({
      canonicalCount: 2,
      canonicalIds: ["role-1", "role-2"],
      canonicalState: "duplicate",
      publicState: "duplicate",
      records: [target().records[0]!, { ...target().records[0]!, id: "role-2", rev: "rev-2" }],
    });
    const result = joinStoredRoleInventory([role(), peer], summary([duplicateTarget]));
    expect(result.coherent).toBe(true);
    expect(result.roles.map((entry) => entry.admission)).toEqual(["readOnly", "readOnly"]);
    expect(result.roles.every((entry) => entry.reasons.includes("duplicate_weekend_target"))).toBe(true);
  });

  it("blocks normalized-identical specials and rejects normalized-empty names", () => {
    const specialA = role({ _id: "special-a", _rev: "rev-a", _type: "special_role", service_name: "Vigilia" });
    const specialB = role({ _id: "special-b", _rev: "rev-b", _type: "special_role", service_name: "  Vigilia  " });
    const specialTarget = (id: string, rev: string): RoleTarget => target({
      targetKey: `special_role:${id}`,
      type: "special_role",
      canonicalIds: [id],
      records: [{ ...target().records[0]!, id, rev, type: "special_role" }],
      expectsLock: false,
      lock: null,
    });
    const result = joinStoredRoleInventory(
      [specialA, specialB],
      summary([specialTarget("special-a", "rev-a"), specialTarget("special-b", "rev-b")]),
    );
    expect(result.roles.every((entry) => entry.reasons.includes("duplicate_special_identity"))).toBe(true);
    expect(joinStoredRoleInventory([role({ _type: "special_role", service_name: "   " })], summary()).coherent).toBe(false);
  });

  it("distinguishes the narrow missing-lock bootstrap state from unsafe locks", () => {
    const missing = target({
      lock: null,
      lockIssues: [{
        kind: "missing_lock",
        lockId: "roleTarget.sunday_role.2026-02-01",
        targetKey: "sunday_role:2026-02-01",
      }],
    });
    expect(joinStoredRoleInventory([role()], summary([missing])).roles[0]?.admission).toBe("bootstrapEligible");

    const malformed = target({
      lock: null,
      lockIssues: [{ kind: "malformed_lock", lockId: null, targetKey: null }],
    });
    const readOnly = joinStoredRoleInventory([role()], summary([malformed])).roles[0]!;
    expect(readOnly.admission).toBe("readOnly");
    expect(translateStoredRole(readOnly)?.column).toMatchObject({
      roleId: "role-1",
      admission: "readOnly",
    });
  });

  it("rejects hidden Saturday chorus and visible/integrity assignment drift", () => {
    const saturday = role({ _type: "saturday_role" });
    const saturdayTarget = target({
      type: "saturday_role",
      targetKey: "saturday_role:2026-02-01",
      records: [{ ...target().records[0]!, type: "saturday_role" }],
    });
    expect(joinStoredRoleInventory([saturday], summary([saturdayTarget])).roles[0]?.reasons)
      .toContain("hidden_saturday_chorus");

    const drift = target({ records: [{ ...target().records[0]!, assignedRefs: ["lead-1"] }] });
    expect(joinStoredRoleInventory([role()], summary([drift])).roles[0]?.reasons)
      .toContain("assignment_mismatch");
  });

  it("translates all five fields with stable role and occupant identity", () => {
    const stored = role({
      instruments: [
        { _key: "bass-upper", instrument: "Bass", person: member("bass-1", "ignored") },
        { _key: "bass-lower", instrument: "bass", person: member("bass-2", "ignored") },
        { _key: "accent", instrument: "Percusión", person: member("perc-1", "ignored") },
      ],
      foh: [
        { _key: "console-upper", role: "Console", person: member("foh-1", "ignored") },
        { _key: "console-lower", role: "console", person: member("foh-2", "ignored") },
      ],
    });
    const assignedRefs = [
      "lead-1", "bgv-1", "chorus-1", "bass-1", "bass-2", "perc-1", "foh-1", "foh-2",
    ];
    const integrity = summary([target({
      records: [{ ...target().records[0]!, assignedRefs }],
    })]);
    const joined = joinStoredRoleInventory([stored], integrity);
    const translated = translateStoredRole(joined.roles[0]!);
    expect(translated?.column).toMatchObject({
      columnId: "role-1",
      roleId: "role-1",
      rev: "rev-1",
      published: false,
    });
    expect(translated?.cells.find((cell) => cell.rowId === "instrumento:bass")?.occupants)
      .toEqual([{ memberId: "bass-2", itemKey: "bass-lower" }]);
    expect(translated?.cells.find((cell) => cell.rowId === "foh:console")?.occupants)
      .toEqual([{ memberId: "foh-2", itemKey: "console-lower" }]);
    const rows = buildStoredGridRows([translated!]);
    expect(rows.filter((row) => row.id === "instrumento:Bass")).toHaveLength(1);
    expect(rows.filter((row) => row.id === "instrumento:bass")).toEqual([
      expect.objectContaining({ writeLabel: "bass" }),
    ]);
    expect(rows.some((row) => row.id === "foh:console" && row.writeLabel === "console")).toBe(true);
  });

  it("keeps same-date services attached to their own role-ID columns", () => {
    const first = role();
    const second = role({ _id: "role-2", _rev: "rev-2", leads: [member("lead-2", "lead-key-2")] });
    const secondTarget = target({
      targetKey: "special_role:role-2",
      type: "special_role",
      canonicalIds: ["role-2"],
      records: [{
        ...target().records[0]!,
        id: "role-2",
        rev: "rev-2",
        type: "special_role",
        assignedRefs: ["lead-2", "bgv-1", "chorus-1", "bass-1", "foh-1"],
      }],
      expectsLock: false,
      lock: null,
    });
    const special = { ...second, _type: "special_role", service_name: "Vigilia" };
    const joined = joinStoredRoleInventory([first, special], summary([target(), secondTarget]));
    const translations = joined.roles.map(translateStoredRole);
    expect(translations[0]?.cells.find((cell) => cell.rowId === "lead")?.occupants[0]?.memberId)
      .toBe("lead-1");
    expect(translations[1]?.cells.find((cell) => cell.rowId === "lead")?.occupants[0]?.memberId)
      .toBe("lead-2");
  });
});
