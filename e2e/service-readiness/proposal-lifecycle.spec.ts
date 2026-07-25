// A3 §4 — "proposal first create/save/resubmit/request/reopen/approve/receipt retry",
// through the DEPLOYED `POST /api/me/proposals` (member) and
// `PATCH /api/admin/proposals/[id]` (admin) routes.
//
// The whole lifecycle is one ordered story, so it runs as a serial describe against
// the same fixture reset: each step's stored state is the next step's input, and a
// per-test reset would destroy that.

import { expect, test } from "./fixtures";
import { readProposal, readProposalsForRole, readSidecar, readWeekendSetlist } from "./lib/dataset";
import { PROPOSALS, ROLES, SETLISTS, SONGS, observedNone, observedSingle } from "./lib/fixtureRefs";

const MY_PROPOSALS = "/api/me/proposals";
const adminProposal = (id: string) => `/api/admin/proposals/${encodeURIComponent(id)}`;

function songRows(...ids: string[]): Array<Record<string, unknown>> {
  return ids.map((songId, i) => ({ songId, play_key: ["C", "D", "G"][i % 3] }));
}

test.describe("proposal lifecycle", () => {
  test("first create for a service with no proposal yet", async ({ member, run }) => {
    // `specialDraft` has no seeded proposal.
    expect(await readProposalsForRole(run.identity, ROLES.specialDraft)).toEqual([]);

    const res = await member.api.post(MY_PROPOSALS, {
      data: {
        roleId: ROLES.specialDraft,
        status: "draft",
        observed: observedNone(),
        songs: songRows(SONGS.a),
        leadNotes: "primer borrador",
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    const created = await readProposalsForRole(run.identity, ROLES.specialDraft);
    expect(created, "one shared proposal per service, never one per member").toHaveLength(1);
    run.recordCreated(created[0]._id, "proposal/first-create");
    expect(created[0].status).toBe("draft");
    run.evidence("proposal_created", { id: created[0]._id });
  });

  test("rejects a save whose observed state is stale, writing nothing", async ({ member, run }) => {
    const before = await readProposal(run.identity, PROPOSALS.pending);

    const res = await member.api.post(MY_PROPOSALS, {
      data: {
        roleId: ROLES.sundayPublished,
        status: "pending",
        observed: observedSingle(PROPOSALS.pending, "stale-proposal-revision"),
        songs: songRows(SONGS.b, SONGS.c),
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);

    const after = await readProposal(run.identity, PROPOSALS.pending);
    expect(after?._rev).toBe(before?._rev);
    expect((after?.songs ?? []).length).toBe((before?.songs ?? []).length);
  });

  test("admin requests changes, the member resubmits, then the admin approves and the receipt retry is idempotent", async ({
    admin,
    member,
    run,
  }) => {
    /* --- request_changes ------------------------------------------- */
    const pending = await readProposal(run.identity, PROPOSALS.pending);
    expect(pending?.status).toBe("pending");

    const requested = await admin.api.patch(adminProposal(PROPOSALS.pending), {
      data: { action: "request_changes", rev: pending?._rev, adminNotes: "Cambia la apertura." },
      failOnStatusCode: false,
    });
    expect(requested.status(), await requested.text()).toBe(200);

    const afterRequest = await readProposal(run.identity, PROPOSALS.pending);
    expect(afterRequest?.status).toBe("changes_requested");
    expect(afterRequest?.admin_notes).toContain("apertura");

    /* --- member resubmits ------------------------------------------ */
    const resubmit = await member.api.post(MY_PROPOSALS, {
      data: {
        roleId: ROLES.sundayPublished,
        status: "pending",
        observed: observedSingle(PROPOSALS.pending, afterRequest?._rev as string),
        songs: songRows(SONGS.a, SONGS.b, SONGS.c),
        leadNotes: "reordenado",
      },
      failOnStatusCode: false,
    });
    expect(resubmit.status(), await resubmit.text()).toBeLessThan(300);

    const resubmitted = await readProposal(run.identity, PROPOSALS.pending);
    expect(resubmitted?.status).toBe("pending");
    expect((resubmitted?.songs ?? []).map((s) => s.song?._ref)).toEqual([
      SONGS.a,
      SONGS.b,
      SONGS.c,
    ]);
    // Still ONE shared proposal for the service — a resubmit never forks a second.
    expect(await readProposalsForRole(run.identity, ROLES.sundayPublished)).toHaveLength(1);

    /* --- approve: writes the live setlist AND the receipt ----------- */
    const approve = await admin.api.patch(adminProposal(PROPOSALS.pending), {
      data: { action: "approve", rev: resubmitted?._rev },
      failOnStatusCode: false,
    });
    expect(approve.status(), await approve.text()).toBe(200);

    const approved = await readProposal(run.identity, PROPOSALS.pending);
    expect(approved?.status).toBe("approved");

    // The live Sunday setlist for that week now holds the approved songs.
    const live = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);
    expect((live?.songs ?? []).map((s) => s.song?._ref)).toEqual([SONGS.a, SONGS.b, SONGS.c]);

    // The approval receipt exists and is the verifiable record of that approval.
    const receiptRef = approved?.approvalReceiptId;
    expect(receiptRef, "an approval must record a verifiable receipt").toBeTruthy();
    const receipt = await readSidecar<Record<string, unknown>>(run.identity, receiptRef as string);
    expect(receipt, "the recorded approval receipt must resolve").not.toBeNull();
    run.recordCreated(receiptRef as string, "proposal/approval-receipt");

    /* --- receipt retry: the same approval again is idempotent ------- */
    const retry = await admin.api.patch(adminProposal(PROPOSALS.pending), {
      data: { action: "approve", rev: approved?._rev },
      failOnStatusCode: false,
    });
    // Either a conflict (already approved) or an idempotent 200 — never a SECOND
    // receipt and never a second setlist write.
    expect([200, 409]).toContain(retry.status());
    const afterRetry = await readProposal(run.identity, PROPOSALS.pending);
    expect(afterRetry?.approvalReceiptId).toBe(receiptRef);
    const liveAfterRetry = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);
    expect((liveAfterRetry?.songs ?? []).map((s) => s.song?._ref)).toEqual([
      SONGS.a,
      SONGS.b,
      SONGS.c,
    ]);

    run.evidence("proposal_approved", {
      id: PROPOSALS.pending,
      receiptId: receiptRef ?? null,
      retryStatus: retry.status(),
    });
  });

  test("reopens a changes-requested proposal under the reviewed revision", async ({ admin, run }) => {
    const before = await readProposal(run.identity, PROPOSALS.changesRequested);
    expect(before?.status).toBe("changes_requested");

    const res = await admin.api.patch(adminProposal(PROPOSALS.changesRequested), {
      data: { action: "reopen", rev: before?._rev },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const after = await readProposal(run.identity, PROPOSALS.changesRequested);
    expect(after?.status).not.toBe("changes_requested");
    expect(after?._rev).not.toBe(before?._rev);
  });

  test("refuses a transition whose reviewed revision is not the current one", async ({
    admin,
    run,
  }) => {
    const before = await readProposal(run.identity, PROPOSALS.pending);

    const res = await admin.api.patch(adminProposal(PROPOSALS.pending), {
      data: { action: "approve", rev: "revision-the-reviewer-never-saw" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    const after = await readProposal(run.identity, PROPOSALS.pending);
    expect(after?._rev, "a rejected transition must write nothing").toBe(before?._rev);
    expect(after?.status).toBe("pending");
    // ...and no live setlist was written.
    const live = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);
    expect(live?.songs ?? []).toEqual([]);
  });

  test("flags a legacy approval that carries no verifiable receipt", async ({ admin, run }) => {
    const legacy = await readProposal(run.identity, PROPOSALS.legacyApproved);
    expect(legacy?.status).toBe("approved");
    expect(legacy?.approvalReceiptId ?? null).toBeNull();

    const res = await admin.api.patch(adminProposal(PROPOSALS.legacyApproved), {
      data: { action: "approve", rev: legacy?._rev },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error?: string };
    // Either the legacy-approval refusal or another conflict — never a silent success
    // that manufactures a receipt for an approval nobody can verify.
    expect(body.error).toBeTruthy();

    const after = await readProposal(run.identity, PROPOSALS.legacyApproved);
    expect(after?._rev).toBe(legacy?._rev);
  });
});
