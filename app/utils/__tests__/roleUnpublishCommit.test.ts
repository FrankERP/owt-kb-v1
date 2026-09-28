// `unpublishRoles`'s OUTCOME contract — what the admin route and the MCP
// `unpublish_service` tool both receive from the one unpublish writer.
//
// The writer's BEHAVIOUR (every refusal, every guard, every no-op) is pinned
// end to end through the admin route by `publishReadyRoutes.test.ts`, which
// stayed unchanged when the body moved here. What that cannot see is the part
// only a caller of the module gets: `effects` — which ids this transaction
// actually patched and which requested roles were already draft. The tool
// builds its report from exactly these, so they are pinned here with the
// loaders mocked at their module seams. `parseUnpublishRequest` and
// `computePublishTransitions` run for real: they are the mechanics this test
// double-checks feed `effects` correctly, not a rule already covered above.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  transactions: [] as { ops: unknown[]; committed: boolean }[],
  commitError: null as Error | null,
  loadRoleForWrite: vi.fn(),
  loadTargetOccupancy: vi.fn(),
  resolveOwnedCoordination: vi.fn(),
  revalidateRolePublication: vi.fn(),
  operationalFetch: vi.fn(),
  rawFetch: vi.fn(),
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

// Only `observePublicationStates` (recover mode) reaches these — through the
// REAL `publishReadyBundle`, left unmocked so its parse/observe logic runs.
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operationalFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.rawFetch(...a) },
}));

vi.mock("@/app/utils/roleWriteOps", () => ({
  loadRoleForWrite: (...a: unknown[]) => h.loadRoleForWrite(...a),
  loadTargetOccupancy: (...a: unknown[]) => h.loadTargetOccupancy(...a),
  resolveOwnedCoordination: (...a: unknown[]) => h.resolveOwnedCoordination(...a),
  nowIso: () => "2026-09-26T18:00:00.000Z",
}));

vi.mock("@/app/utils/serviceMutationSideEffects", () => ({
  revalidateRolePublication: () => h.revalidateRolePublication(),
}));

import { unpublishRoles } from "@/app/utils/roleUnpublishCommit";

interface FakeRole {
  _id: string;
  _rev: string;
  _type: string;
  published: boolean;
}

const rolePub: FakeRole = { _id: "role-pub", _rev: "rev-pub", _type: "sunday_role", published: true };
const roleDraft: FakeRole = { _id: "role-draft", _rev: "rev-draft", _type: "sunday_role", published: false };

const DATE_OF: Record<string, string> = { "role-pub": "2026-10-04", "role-draft": "2026-10-11" };

/** Wires `loadRoleForWrite`, `loadTargetOccupancy` (no conflicts) and
 * `resolveOwnedCoordination` (no legacy lock) from a role table. */
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
  h.loadTargetOccupancy.mockResolvedValue({ canonicalRoleIds: [], rawDraftIds: [] });
  h.resolveOwnedCoordination.mockImplementation((targets: { role: FakeRole; date: string; targetKey: string }[]) =>
    Promise.resolve({
      ok: true,
      bootstrapped: false,
      roles: targets.map((t) => ({ role: t.role, targetKey: t.targetKey, date: t.date, lock: null })),
    }),
  );
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.transactions.length = 0;
  h.commitError = null;
  for (const fn of [
    h.loadRoleForWrite,
    h.loadTargetOccupancy,
    h.resolveOwnedCoordination,
    h.revalidateRolePublication,
    h.operationalFetch,
    h.rawFetch,
  ]) {
    fn.mockReset();
  }
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("unpublishRoles — a committed batch", () => {
  it("patches only the published role, reports toPatch/alreadyDraft, and revalidates once", async () => {
    mockTargets([rolePub, roleDraft]);

    const outcome = await unpublishRoles({
      roles: [
        { id: "role-pub", rev: "rev-pub" },
        { id: "role-draft", rev: "rev-draft" },
      ],
    });

    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, unpublished: 1, services: [{ id: "role-pub" }, { id: "role-draft" }] },
      effects: {
        toPatch: ["role-pub"],
        alreadyDraft: [
          { role: roleDraft, targetKey: "sunday_role:2026-10-11", date: "2026-10-11", lock: null },
        ],
      },
    });

    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].committed).toBe(true);
    expect(h.transactions[0].ops).toEqual([
      { patch: "role-pub", rev: "rev-pub", set: { published: false } },
    ]);
    expect(h.revalidateRolePublication).toHaveBeenCalledTimes(1);
  });

  it("writes NOTHING and revalidates NOTHING when every requested role is already draft", async () => {
    mockTargets([roleDraft, { ...roleDraft, _id: "role-draft-2", _rev: "rev-draft-2" }]);

    const outcome = await unpublishRoles({
      roles: [
        { id: "role-draft", rev: "rev-draft" },
        { id: "role-draft-2", rev: "rev-draft-2" },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.body).toEqual({
      ok: true,
      unpublished: 0,
      services: [{ id: "role-draft" }, { id: "role-draft-2" }],
    });
    expect(outcome.effects.toPatch).toEqual([]);
    expect(outcome.effects.alreadyDraft.map((r) => r.role._id)).toEqual(["role-draft", "role-draft-2"]);
    // No transaction is even opened when there is nothing to patch.
    expect(h.transactions).toHaveLength(0);
    expect(h.revalidateRolePublication).not.toHaveBeenCalled();
  });
});

describe("unpublishRoles — recover mode", () => {
  it("answers a recovered outcome with an explicit empty effects, and no read of the write targets", async () => {
    h.operationalFetch.mockResolvedValue([{ _id: "role-x", published: false }]);
    h.rawFetch.mockResolvedValue([]);

    const outcome = await unpublishRoles({ mode: "recover", roles: [{ id: "role-x" }] });

    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: {
        ok: true,
        mode: "recover",
        outcome: "recovered",
        services: [{ id: "role-x", publishState: "draft", rawDrafts: [] }],
      },
      effects: { toPatch: [], alreadyDraft: [] },
    });
    expect(h.loadRoleForWrite).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });

  it("answers an unknown recovery as a 503 refusal with NO effects", async () => {
    h.operationalFetch.mockRejectedValue(new Error("network down"));
    h.rawFetch.mockResolvedValue([]);

    const outcome = await unpublishRoles({ mode: "recover", roles: [{ id: "role-x" }] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(503);
    expect("effects" in outcome).toBe(false);
    expect(outcome.body).toMatchObject({ error: "unknown_outcome", outcome: "unknown" });
    expect(h.transactions).toHaveLength(0);
  });
});

describe("unpublishRoles — refusals carry the route's status and body, and no effects", () => {
  it("an invalid body (no roles) gives 400 with no effects and no read", async () => {
    const outcome = await unpublishRoles({ roles: [] });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(400);
    expect("effects" in outcome).toBe(false);
    expect(h.loadRoleForWrite).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });
});
