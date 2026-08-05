import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const transactionFactory = vi.fn();

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...args: unknown[]) => operationalFetch(...args) },
  rawIntegrityClient: { fetch: (...args: unknown[]) => rawFetch(...args) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: { transaction: () => transactionFactory() },
}));

import {
  bootstrapLegacyLock,
  resolveOwnedCoordination,
  type StoredLock,
  type StoredRole,
} from "@/app/utils/roleWriteOps";
import { loadWeekendCoordination } from "@/app/utils/serviceWriteTargets";

const INPUT = {
  roleId: "role-1",
  roleRev: "rev-before",
  targetKey: "sunday_role:2026-08-09",
  dateField: "week" as const,
  date: "2026-08-09",
};

function role(over: Partial<StoredRole> = {}): StoredRole {
  return {
    _id: "role-1",
    _rev: "rev-before",
    _type: "sunday_role",
    week: "2026-08-09",
    Lead: [],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function lock(over: Partial<StoredLock> = {}): StoredLock {
  if (!createdLock) throw new Error("bootstrap lock not created");
  return {
    ...(createdLock as unknown as StoredLock),
    _rev: "lock-rev",
    ...over,
  };
}

let roleRows: StoredRole[];
let rawRoleRows: { _id: string }[];
let lockRows: StoredLock[];
let createdLock: Record<string, unknown> | null;
let commitError: Error | null;
let onCommit: (() => void) | null;
let transactionCount: number;

function mutationError(type = "documentAlreadyExistsError"): Error {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type, id: INPUT.roleId } }] },
  });
}

beforeEach(() => {
  roleRows = [role()];
  rawRoleRows = [];
  lockRows = [];
  createdLock = null;
  commitError = null;
  onCommit = null;
  transactionCount = 0;
  operationalFetch.mockReset();
  rawFetch.mockReset();
  transactionFactory.mockReset();

  operationalFetch.mockImplementation(
    async (query: string, params: Record<string, unknown> = {}) => {
      if (query.includes('_type == "roleTargetLock"')) {
        const ids = Array.isArray(params.ids) ? new Set(params.ids) : null;
        return ids ? lockRows.filter((row) => ids.has(row._id)) : lockRows;
      }
      if (query.includes("_id == $id") || query.includes("week == $week")) return roleRows;
      return [];
    },
  );
  rawFetch.mockImplementation(async () => rawRoleRows);

  transactionFactory.mockImplementation(() => {
    transactionCount += 1;
    const tx = {
      patch(_id: string, mutate: (patch: unknown) => unknown) {
        const patch = {
          ifRevisionId() {
            return patch;
          },
          set() {
            return patch;
          },
        };
        mutate(patch);
        return tx;
      },
      create(doc: Record<string, unknown>) {
        createdLock = doc;
        return tx;
      },
      async commit() {
        onCommit?.();
        if (commitError) throw commitError;
      },
    };
    return tx;
  });
});

describe("bootstrapLegacyLock persistence classification", () => {
  it("stops for reload after a successful maintenance commit with exact-nonce readback", async () => {
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows = [lock()];
    };

    const result = await bootstrapLegacyLock(INPUT);

    expect(result).toMatchObject({
      outcome: "committed_reload",
      details: {
        commit: "succeeded",
        nonceEvidence: "exact",
        observedRoleRev: "rev-after",
        cause: "commit_succeeded",
      },
    });
    expect(result.details).not.toHaveProperty("claimNonce");
  });

  it("still reports committed_reload when successful-commit readback fails", async () => {
    operationalFetch.mockRejectedValue(new Error("read unavailable"));

    const result = await bootstrapLegacyLock(INPUT);

    expect(result).toMatchObject({
      outcome: "committed_reload",
      details: { commit: "succeeded", nonceEvidence: "unreadable", cause: "readback_failed" },
    });
  });

  it("uses the retained attempted nonce to prove a lost response committed", async () => {
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows = [lock()];
    };

    const result = await bootstrapLegacyLock(INPUT);

    // Mutant guard: regenerating the nonce during reconciliation changes this
    // exact proof to `different` and makes the targeted assertion red.
    expect(result).toMatchObject({
      outcome: "committed_reload",
      details: { commit: "rejected", nonceEvidence: "exact", cause: "attempted_nonce_observed" },
    });
  });

  it("recognizes a different valid nonce as a concurrent maintenance commit", async () => {
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-concurrent" })];
      lockRows = [lock({ claimNonce: "other-nonce" })];
    };

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "committed_reload",
      details: { nonceEvidence: "different", cause: "concurrent_nonce_observed" },
    });
  });

  it("claims not_committed only from the exact pre-bootstrap role and absent lock", async () => {
    commitError = mutationError("documentRevisionIDDoesNotMatchError");

    const result = await bootstrapLegacyLock(INPUT);

    // Mutant guard: removing exact revision equality would let moved state pass
    // this assertion and falsely authorize an ordinary retry.
    expect(result).toMatchObject({
      outcome: "not_committed",
      details: {
        observedRoleRev: "rev-before",
        nonceEvidence: "absent",
        cause: "prebootstrap_state_observed",
      },
    });
  });

  it("classifies an absent lock with a moved role revision as unknown", async () => {
    commitError = mutationError();
    roleRows = [role({ _rev: "rev-moved" })];

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { observedRoleRev: "rev-moved", nonceEvidence: "absent" },
    });
  });

  it.each([
    ["wrong owner", { roleId: "role-2" }],
    ["missing nonce", { claimNonce: undefined }],
    ["wrong target", { targetKey: "sunday_role:2026-08-16" }],
    ["malformed generation", { generation: -1 }],
  ])("classifies a %s lock as unknown", async (_label, override) => {
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows = [lock(override)];
    };

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { nonceEvidence: "unreadable", cause: "inconclusive_readback" },
    });
  });

  it("classifies a raw role overlay as unknown even when the lock nonce matches", async () => {
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      rawRoleRows = [{ _id: "drafts.role-1" }];
      lockRows = [lock()];
    };

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({ outcome: "unknown" });
  });

  it("classifies contradictory exact-revision plus present-lock evidence as unknown", async () => {
    commitError = mutationError();
    onCommit = () => {
      lockRows = [lock()];
    };

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { observedRoleRev: "rev-before", nonceEvidence: "exact" },
    });
  });

  it("classifies failed reconciliation reads as unknown after a rejected commit", async () => {
    commitError = mutationError();
    operationalFetch.mockRejectedValue(new Error("read unavailable"));

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { commit: "rejected", nonceEvidence: "unreadable", cause: "readback_failed" },
    });
  });

  it("does not mistake a malformed raw-overlay response for a proven absence", async () => {
    commitError = mutationError();
    rawFetch.mockResolvedValue({ unexpected: true });

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { cause: "readback_failed", nonceEvidence: "unreadable" },
    });
  });

  it("does not mistake a malformed lock response for a proven absent lock", async () => {
    commitError = mutationError();
    operationalFetch.mockImplementation(async (query: string) =>
      query.includes('_type == "roleTargetLock"') ? { unexpected: true } : roleRows,
    );

    expect(await bootstrapLegacyLock(INPUT)).toMatchObject({
      outcome: "unknown",
      details: { cause: "readback_failed", nonceEvidence: "unreadable" },
    });
  });
});

describe("bootstrap propagation through shared writers", () => {
  const target = () => ({
    role: role(),
    date: INPUT.date,
    targetKey: INPUT.targetKey,
    lockId: "roleTarget.sunday_role.2026-08-09",
  });

  it("stops a multi-role operation immediately after maintenance commits", async () => {
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows = [lock()];
    };

    const result = await resolveOwnedCoordination([target()]);

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "bootstrap_completed_reload", details: { cause: "commit_succeeded" } },
    });
    expect(transactionCount).toBe(1);
  });

  it("does not let a later-role refusal downgrade an earlier lost-response commit", async () => {
    const secondRole = role({
      _id: "role-2",
      _rev: "rev-2",
      week: "2026-08-16",
    });
    lockRows = [
      {
        _id: "roleTarget.sunday_role.2026-08-16",
        _rev: "lock-2-rev",
        _type: "roleTargetLock",
        targetKey: "sunday_role:2026-08-16",
        state: "vacant",
        roleType: "sunday_role",
        date: "2026-08-16",
        generation: 1,
      },
    ];
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows.push(lock());
    };

    const result = await resolveOwnedCoordination([
      target(),
      {
        role: secondRole,
        date: "2026-08-16",
        targetKey: "sunday_role:2026-08-16",
        lockId: "roleTarget.sunday_role.2026-08-16",
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: "bootstrap_completed_reload",
        details: { cause: "attempted_nonce_observed" },
      },
    });
    expect(transactionCount).toBe(1);
  });

  it("propagates unknown maintenance instead of downgrading it to stale_revision", async () => {
    commitError = mutationError();
    roleRows = [role({ _rev: "rev-moved" })];

    const result = await resolveOwnedCoordination([target()]);

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "bootstrap_outcome_unknown", details: { nonceEvidence: "absent" } },
    });
  });

  it("preserves a conclusive no-commit result as the underlying stale refusal", async () => {
    commitError = mutationError("documentRevisionIDDoesNotMatchError");

    expect(await resolveOwnedCoordination([target()])).toMatchObject({
      ok: false,
      failure: { code: "stale_revision", details: { cause: "prebootstrap_state_observed" } },
    });
  });

  it("makes the service-write helper propagate unknown and return no coordination", async () => {
    commitError = mutationError();
    onCommit = () => {
      roleRows = [role({ _rev: "rev-moved" })];
    };

    const result = await loadWeekendCoordination({
      roleType: "sunday_role",
      week: "2026-08-09",
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "bootstrap_outcome_unknown" },
    });
    expect(result).not.toHaveProperty("coordination");
  });

  it("makes the service-write helper stop after a successful bootstrap", async () => {
    onCommit = () => {
      roleRows = [role({ _rev: "rev-after" })];
      lockRows = [lock()];
    };

    const result = await loadWeekendCoordination({
      roleType: "sunday_role",
      week: "2026-08-09",
    });

    expect(result).toMatchObject({
      ok: false,
      failure: { code: "bootstrap_completed_reload" },
    });
    expect(result).not.toHaveProperty("coordination");
  });
});
