// A3 §4 — "failed transaction leaves no partial business state" and "successful
// mutation returns expected refreshed read shape".
//
// The first is the harder claim: a mutation that touches SEVERAL documents in one
// transaction must, when it fails, leave EVERY one of them exactly as it was. Proving
// that requires a full before/after snapshot of every document the transaction would
// have touched — not just the one the error message mentions.

import { expect, test } from "./fixtures";
import { readProposal, readRole, readSidecar, readWeekendSetlist } from "./lib/dataset";
import {
  FIXTURE_DATE,
  MEMBERS,
  PROPOSALS,
  ROLES,
  SETLISTS,
  createRoleBody,
  fullSeats,
  lockId,
  receiptId,
  scopedRequestId,
} from "./lib/fixtureRefs";

interface Snapshot {
  [id: string]: string | null;
}

/** Revisions of every document a multi-document transaction could touch. */
async function snapshot(
  identity: Parameters<typeof readRole>[0],
  ids: { roles?: string[]; setlists?: string[]; proposals?: string[]; sidecars?: string[] },
): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const id of ids.roles ?? []) out[id] = (await readRole(identity, id))?._rev ?? null;
  for (const id of ids.setlists ?? []) out[id] = (await readWeekendSetlist(identity, id))?._rev ?? null;
  for (const id of ids.proposals ?? []) out[id] = (await readProposal(identity, id))?._rev ?? null;
  for (const id of ids.sidecars ?? []) {
    out[id] = ((await readSidecar<{ _rev?: string }>(identity, id))?._rev as string) ?? null;
  }
  return out;
}

test.describe("transaction atomicity", () => {
  test("a failed role create writes NO receipt, NO role and NO lock", async ({ admin, run }) => {
    const date = FIXTURE_DATE.sundayPublished; // already occupied → the create must fail
    const requestId = scopedRequestId(run.identity.runId, "atomic-create");

    const before = await snapshot(run.identity, {
      roles: [ROLES.sundayPublished],
      sidecars: [lockId("sunday_role", date), receiptId(requestId)],
    });
    expect(before[receiptId(requestId)], "the receipt must not exist yet").toBeNull();

    const res = await admin.api.post("/api/admin/roles", {
      data: createRoleBody({ type: "sunday_role", date, requestId, seats: fullSeats() }),
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);

    const after = await snapshot(run.identity, {
      roles: [ROLES.sundayPublished],
      sidecars: [lockId("sunday_role", date), receiptId(requestId)],
    });
    expect(after, "a refused create must leave every touched document identical").toEqual(before);
    // Specifically: no partial receipt was left behind to poison the idempotency key.
    expect(after[receiptId(requestId)]).toBeNull();

    run.evidence("failed_transaction_no_partial_state", { requestId, status: res.status() });
  });

  test("a failed proposal approval writes NO setlist, NO receipt and NO status change", async ({
    admin,
    run,
  }) => {
    const ids = {
      roles: [ROLES.sundayPublished],
      setlists: [SETLISTS.sundayEmpty],
      proposals: [PROPOSALS.pending],
    };
    const before = await snapshot(run.identity, ids);
    const proposalBefore = await readProposal(run.identity, PROPOSALS.pending);
    const liveBefore = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);
    expect(liveBefore?.songs ?? []).toEqual([]);

    // A revision the reviewer never saw: the whole approval transaction must abort.
    const res = await admin.api.patch(`/api/admin/proposals/${encodeURIComponent(PROPOSALS.pending)}`, {
      data: { action: "approve", rev: "a-revision-that-never-existed" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    expect(await snapshot(run.identity, ids)).toEqual(before);
    const proposalAfter = await readProposal(run.identity, PROPOSALS.pending);
    expect(proposalAfter?.status).toBe(proposalBefore?.status);
    // The approval receipt is an embedded object (A2 §6 adds no receipt document),
    // so "no receipt was written" is "the embedded receipt is still absent".
    expect(proposalAfter?.approval_receipt ?? null).toEqual(proposalBefore?.approval_receipt ?? null);
    expect(proposalAfter?.approval_receipt ?? null).toBeNull();
    expect(
      (await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty))?.songs ?? [],
      "the live setlist must stay empty when the approval aborts",
    ).toEqual([]);
  });

  test("a failed team swap leaves both roles byte-identical", async ({ admin, run }) => {
    const ids = { roles: [ROLES.sundayPublished, ROLES.saturdayPublished] };
    const before = await snapshot(run.identity, ids);

    const res = await admin.api.post("/api/admin/roles/swap", {
      data: {
        kind: "team",
        roles: [
          { id: ROLES.sundayPublished, rev: before[ROLES.sundayPublished] },
          { id: ROLES.saturdayPublished, rev: "stale-on-the-second-role" },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(await snapshot(run.identity, ids)).toEqual(before);
  });
});

test.describe("successful mutation returns the refreshed read shape", () => {
  test("a role edit returns the stored document, at the new revision", async ({ admin, run }) => {
    const before = await readRole(run.identity, ROLES.sundayDraft);

    const res = await admin.api.patch(`/api/admin/roles/${encodeURIComponent(ROLES.sundayDraft)}`, {
      data: {
        rev: before?._rev,
        _type: "sunday_role",
        date: FIXTURE_DATE.sundayDraft,
        leads: [MEMBERS.lead],
        bgvs: [MEMBERS.bgv, MEMBERS.chorus],
        chorus: [],
        instruments: [{ instrument: "Bajo", personId: MEMBERS.instrument }],
        foh: [{ role: "Audio", personId: MEMBERS.foh }],
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The response must be the REFRESHED read, not the request echoed back.
    const stored = await readRole(run.identity, ROLES.sundayDraft);
    expect(body._id).toBe(stored?._id);
    expect(body._rev, "the returned revision must be the new stored revision").toBe(stored?._rev);
    expect(body._rev).not.toBe(before?._rev);
    expect(body._type).toBe("sunday_role");

    // Seat content agrees with storage on all five member-referencing paths.
    const storedSeats = {
      Lead: (stored?.Lead ?? []).map((r) => r._ref).sort(),
      BGVs: (stored?.BGVs ?? []).map((r) => r._ref).sort(),
      Chorus: (stored?.Chorus ?? []).map((r) => r._ref).sort(),
      instruments: (stored?.instruments ?? []).map((s) => `${s.instrument}:${s.person?._ref}`).sort(),
      foh_team: (stored?.foh_team ?? []).map((s) => `${s.role}:${s.person?._ref}`).sort(),
    };
    expect(storedSeats.Lead).toEqual([MEMBERS.lead]);
    expect(storedSeats.BGVs).toEqual([MEMBERS.bgv, MEMBERS.chorus].sort());
    expect(storedSeats.instruments).toEqual([`Bajo:${MEMBERS.instrument}`]);
    expect(storedSeats.foh_team).toEqual([`Audio:${MEMBERS.foh}`]);

    run.evidence("refreshed_read_shape_verified", { roleId: ROLES.sundayDraft });
  });
});
