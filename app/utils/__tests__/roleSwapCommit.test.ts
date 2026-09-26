// `swapRoles`'s OUTCOME contract — what the admin route and the MCP
// `swap_assignment` tool both receive from the one swap writer.
//
// The writer's BEHAVIOUR (every refusal, every transaction op, every notice) is
// pinned end to end through the admin route by `roleSwapRoutes.test.ts`, which
// stayed unchanged when the body moved here. What that cannot see is the part
// only a caller of the module gets: `effects` — the loaded role, the raw `set`
// payload, the pre-commit seat states and the step-2 descriptors of what the
// post-commit helpers queued, per coordinated role. The tool builds its report
// and its fresh-observation check from exactly these, so they are pinned here
// with the loaders and helpers mocked at their module seams. `roleWriteRequest`'s
// pure seat-addressing functions run for real: they are the swap mechanics this
// test double-checks feed `effects` correctly, not a rule already covered above.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  transactions: [] as { ops: unknown[]; committed: boolean }[],
  commitError: null as Error | null,
  loadRoleForWrite: vi.fn(),
  loadCanonicalMemberIds: vi.fn(),
  resolveOwnedCoordination: vi.fn(),
  notifyRoleAssignments: vi.fn(),
  queueRoleNotices: vi.fn(),
  revalidateRoleMutation: vi.fn(),
  roleUpdateNotice: vi.fn(),
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: {
    transaction: () => {
      const record = { ops: [] as unknown[], committed: false };
      h.transactions.push(record);
      const tx = {
        patch(id: string, build: (p: unknown) => unknown) {
          const op = { patch: id, rev: null as string | null, set: null as unknown };
          const builder = {
            ifRevisionId(rev: string) {
              op.rev = rev;
              return builder;
            },
            set(value: unknown) {
              op.set = value;
              return builder;
            },
          };
          build(builder);
          record.ops.push(op);
          return tx;
        },
        async commit() {
          if (h.commitError) throw h.commitError;
          record.committed = true;
        },
      };
      return tx;
    },
  },
}));

vi.mock("@/app/utils/roleWriteOps", () => ({
  loadRoleForWrite: (...a: unknown[]) => h.loadRoleForWrite(...a),
  loadCanonicalMemberIds: (...a: unknown[]) => h.loadCanonicalMemberIds(...a),
  resolveOwnedCoordination: (...a: unknown[]) => h.resolveOwnedCoordination(...a),
  nowIso: () => "2026-09-26T18:00:00.000Z",
}));

vi.mock("@/app/utils/serviceMutationSideEffects", () => ({
  notifyRoleAssignments: (...a: unknown[]) => h.notifyRoleAssignments(...a),
  queueRoleNotices: (...a: unknown[]) => h.queueRoleNotices(...a),
  revalidateRoleMutation: () => h.revalidateRoleMutation(),
  roleUpdateNotice: (...a: unknown[]) => h.roleUpdateNotice(...a),
}));

import { swapRoles } from "@/app/utils/roleSwapCommit";

interface FakeRole {
  _id: string;
  _rev: string;
  _type: string;
  published: boolean;
  Lead: { _type: string; _key: string; _ref: string }[];
}

const roleA: FakeRole = {
  _id: "role-A",
  _rev: "revA",
  _type: "sunday_role",
  published: true,
  Lead: [{ _type: "reference", _key: "l1", _ref: "m-A" }],
};
const roleB: FakeRole = {
  _id: "role-B",
  _rev: "revB",
  _type: "sunday_role",
  published: true,
  Lead: [{ _type: "reference", _key: "l2", _ref: "m-B" }],
};

const DATE_OF: Record<string, string> = { "role-A": "2026-10-04", "role-B": "2026-10-11" };

/** Wires `loadRoleForWrite` and `resolveOwnedCoordination` from a role table. */
function mockTargets(roles: FakeRole[]) {
  const byId = new Map(roles.map((r) => [r._id, r]));
  h.loadRoleForWrite.mockImplementation((id: string, rev: string) => {
    const role = byId.get(id);
    if (!role || role._rev !== rev) {
      return Promise.resolve({ ok: false, failure: { code: "stale_revision", details: { id } } });
    }
    return Promise.resolve({
      ok: true,
      target: { role, date: DATE_OF[id], targetKey: `sunday_role:${DATE_OF[id]}`, lockId: null },
    });
  });
  // Pass the loaded targets straight through as coordinated roles, in the same
  // order the writer resolved them — no legacy lock in this fixture.
  h.resolveOwnedCoordination.mockImplementation((targets: { role: FakeRole; date: string }[]) =>
    Promise.resolve({
      ok: true,
      bootstrapped: false,
      roles: targets.map((t) => ({ role: t.role, targetKey: `sunday_role:${t.date}`, date: t.date, lock: null })),
    }),
  );
}

const seatSwapBody = {
  kind: "seat",
  source: { roleId: "role-A", rev: "revA", path: "Lead", itemKey: "l1" },
  target: { roleId: "role-B", rev: "revB", path: "Lead", itemKey: "l2" },
};

beforeEach(() => {
  h.transactions.length = 0;
  h.commitError = null;
  for (const fn of [
    h.loadRoleForWrite,
    h.loadCanonicalMemberIds,
    h.resolveOwnedCoordination,
    h.notifyRoleAssignments,
    h.queueRoleNotices,
    h.revalidateRoleMutation,
    h.roleUpdateNotice,
  ]) {
    fn.mockReset();
  }
  h.loadCanonicalMemberIds.mockImplementation((ids: string[]) => Promise.resolve(new Set(ids)));
  h.roleUpdateNotice.mockImplementation((input: { date: string }) => ({
    recipients: [`added-${input.date}`],
    type: "sunday_role",
    date: input.date,
    body: { leads: [], bgvs: [], chorus: [], instruments: [], foh: [] },
    kind: "updated" as const,
  }));
  h.notifyRoleAssignments.mockReturnValue({
    pushes: [
      { recipients: ["added-2026-10-04"], date: "2026-10-04", kind: "updated" },
      { recipients: ["added-2026-10-11"], date: "2026-10-11", kind: "updated" },
    ],
  });
  h.queueRoleNotices.mockImplementation((input: { roleId: string }) => ({
    kind: "role" as const,
    roleId: input.roleId,
    memberIds: [`m-for-${input.roleId}`],
  }));
});

describe("swapRoles — success outcome", () => {
  it("a seat swap between two published roles reports each role's snapshot, its raw set payload, its seat states and its own notice, plus the batch push descriptor", async () => {
    mockTargets([roleA, roleB]);

    const outcome = await swapRoles(seatSwapBody);

    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, kind: "seat", roleIds: ["role-A", "role-B"] },
      effects: {
        push: {
          pushes: [
            { recipients: ["added-2026-10-04"], date: "2026-10-04", kind: "updated" },
            { recipients: ["added-2026-10-11"], date: "2026-10-11", kind: "updated" },
          ],
        },
        roles: [
          {
            role: roleA,
            set: { 'Lead[_key=="l1"]._ref': "m-B" },
            seatStates: {
              before: { leads: ["m-A"], bgvs: [], chorus: [], instruments: [], foh: [] },
              after: { leads: ["m-B"], bgvs: [], chorus: [], instruments: [], foh: [] },
            },
            notice: { kind: "role", roleId: "role-A", memberIds: ["m-for-role-A"] },
          },
          {
            role: roleB,
            set: { 'Lead[_key=="l2"]._ref': "m-A" },
            seatStates: {
              before: { leads: ["m-B"], bgvs: [], chorus: [], instruments: [], foh: [] },
              after: { leads: ["m-A"], bgvs: [], chorus: [], instruments: [], foh: [] },
            },
            notice: { kind: "role", roleId: "role-B", memberIds: ["m-for-role-B"] },
          },
        ],
      },
    });

    // The transaction wrote exactly the two `set` payloads reported in effects.
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].committed).toBe(true);
    expect(h.transactions[0].ops).toEqual([
      { patch: "role-A", rev: "revA", set: { 'Lead[_key=="l1"]._ref': "m-B" } },
      { patch: "role-B", rev: "revB", set: { 'Lead[_key=="l2"]._ref': "m-A" } },
    ]);
    expect(h.revalidateRoleMutation).toHaveBeenCalledTimes(1);
    // notifyRoleAssignments received one notice per coordinated role, in order.
    expect(h.notifyRoleAssignments).toHaveBeenCalledWith([
      expect.objectContaining({ date: "2026-10-04" }),
      expect.objectContaining({ date: "2026-10-11" }),
    ]);
    expect(h.queueRoleNotices).toHaveBeenCalledTimes(2);
  });
});

describe("swapRoles — refusals carry the route's status and body, and no effects", () => {
  it("an unparseable body gives 400 with no effects and no read", async () => {
    const outcome = await swapRoles({ kind: "bogus" });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect("effects" in outcome).toBe(false);
    expect(h.loadRoleForWrite).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });

  it("a stale observed role revision gives 409 with no transaction and no notices", async () => {
    mockTargets([roleA, roleB]);

    const outcome = await swapRoles({
      kind: "seat",
      source: { roleId: "role-A", rev: "STALE", path: "Lead", itemKey: "l1" },
      target: { roleId: "role-B", rev: "revB", path: "Lead", itemKey: "l2" },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect("effects" in outcome).toBe(false);
    expect(h.transactions).toHaveLength(0);
    expect(h.revalidateRoleMutation).not.toHaveBeenCalled();
    expect(h.notifyRoleAssignments).not.toHaveBeenCalled();
    expect(h.queueRoleNotices).not.toHaveBeenCalled();
  });

  it("a commit conflict rejects with 409 and runs no post-commit side effect", async () => {
    mockTargets([roleA, roleB]);
    h.commitError = Object.assign(new Error("conflict"), {
      statusCode: 409,
      details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] },
    });

    const outcome = await swapRoles(seatSwapBody);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect("effects" in outcome).toBe(false);
    expect(h.transactions[0].committed).toBe(false);
    expect(h.revalidateRoleMutation).not.toHaveBeenCalled();
    expect(h.notifyRoleAssignments).not.toHaveBeenCalled();
    expect(h.queueRoleNotices).not.toHaveBeenCalled();
  });

  it("a non-conflict commit error rethrows, and nothing is revalidated", async () => {
    mockTargets([roleA, roleB]);
    h.commitError = new Error("network down");

    await expect(swapRoles(seatSwapBody)).rejects.toThrow("network down");
    expect(h.revalidateRoleMutation).not.toHaveBeenCalled();
  });

  it("a dangling assignment gives 409 before any coordination or transaction", async () => {
    mockTargets([roleA, roleB]);
    h.loadCanonicalMemberIds.mockResolvedValue(new Set()); // neither m-A nor m-B resolves

    const outcome = await swapRoles(seatSwapBody);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(409);
    expect(h.resolveOwnedCoordination).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });
});
