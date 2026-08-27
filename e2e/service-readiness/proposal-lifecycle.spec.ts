// A3 §4 — "proposal first create/save/resubmit/request/reopen/approve/receipt retry",
// through the DEPLOYED `POST /api/me/proposals` (member) and
// `PATCH /api/admin/proposals/[id]` (admin) routes.
//
// The whole lifecycle is one ordered story, so it runs as a serial describe against
// the same fixture reset: each step's stored state is the next step's input, and a
// per-test reset would destroy that.

import { expect, test } from "./fixtures";
import { readProposal, readProposalsForRole, readWeekendSetlist } from "./lib/dataset";
import { PROPOSALS, ROLES, SETLISTS, SONGS, observedNone, observedSingle } from "./lib/fixtureRefs";

const MY_PROPOSALS = "/api/me/proposals";
const adminProposal = (id: string) => `/api/admin/proposals/${encodeURIComponent(id)}`;

function songRows(...ids: string[]): Array<Record<string, unknown>> {
  return ids.map((songId, i) => ({ songId, play_key: ["C", "D", "G"][i % 3] }));
}

test.describe("proposal lifecycle", () => {
  test("first create for a service with no proposal yet", async ({ member, run }) => {
    // `specialLegacy` has no seeded proposal, and the signed-in member IS its Lead.
    //
    // It is deliberately NOT `specialDraft`: an admin-only DRAFT service is not
    // proposable by a member at all (the draft/publish gate refuses it with a 403),
    // which the next scenario asserts on purpose. `specialLegacy` carries no
    // `published` field, so it is grandfathered-published — the member-facing
    // filter is `published != false` — and it exercises the special-role
    // coordination path, which asserts the role's own revision instead of a
    // weekend lock.
    expect(await readProposalsForRole(run.identity, ROLES.specialLegacy)).toEqual([]);

    const res = await member.api.post(MY_PROPOSALS, {
      data: {
        roleId: ROLES.specialLegacy,
        status: "draft",
        observed: observedNone(),
        songs: songRows(SONGS.a),
        leadNotes: "primer borrador",
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    const created = await readProposalsForRole(run.identity, ROLES.specialLegacy);
    expect(created, "one shared proposal per service, never one per member").toHaveLength(1);
    run.recordCreated(created[0]._id, "proposal/first-create");
    expect(created[0].status).toBe("draft");
    run.evidence("proposal_created", { id: created[0]._id });
  });

  test("refuses a member proposal for an admin-only DRAFT service", async ({ member, run }) => {
    // The counterpart of the scenario above: a service still held back as a draft is
    // not member-visible, so it is not proposable either. Nothing is written.
    const res = await member.api.post(MY_PROPOSALS, {
      data: {
        roleId: ROLES.specialDraft,
        status: "draft",
        observed: observedNone(),
        songs: songRows(SONGS.a),
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(403);
    expect(await readProposalsForRole(run.identity, ROLES.specialDraft)).toEqual([]);
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
    // The change request lives in the THREAD now, not in `admin_notes` — Child B
    // stopped the transition mirroring that field. This was the only
    // `admin_notes` assertion in the e2e tree, and it moved rather than being
    // dropped: the transition still has to record what the admin asked for, and
    // the message is where it records it.
    const requestMessages = (afterRequest?.messages ?? []) as Array<{
      kind?: string;
      body?: string;
      author_role?: string;
    }>;
    const changeRequest = requestMessages.find((m) => m.kind === "admin_change_request");
    expect(changeRequest?.body).toContain("apertura");
    expect(changeRequest?.author_role).toBe("admin");

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

    // ── The approval receipt (A2 §6) ────────────────────────────────────────
    // It is an EMBEDDED object on the proposal, written by the same transaction —
    // A2 introduces no approval-receipt DOCUMENT type, so there is no id to
    // dereference and nothing extra for the run to clean up. What makes it
    // verifiable is its content: the app/version marker, the fingerprint of the
    // exact approved inputs, and the live setlist document it wrote.
    const receipt = approved?.approval_receipt;
    expect(receipt, "an approval must record a verifiable receipt").toBeTruthy();
    expect(receipt).toMatchObject({
      marker: "owt-kb-v1/a2-approval-1",
      v: 1,
      serviceRef: ROLES.sundayPublished,
      setlistId: SETLISTS.sundayEmpty,
      songCount: 3,
    });
    expect(receipt?.fingerprint, "the receipt fingerprints the approved inputs").toBeTruthy();
    expect(receipt?.approvedAt).toBeTruthy();
    const fingerprint = receipt?.fingerprint;

    /* --- receipt retry: the same approval again is idempotent ------- */
    const retry = await admin.api.patch(adminProposal(PROPOSALS.pending), {
      data: { action: "approve", rev: approved?._rev },
      failOnStatusCode: false,
    });
    // Either a conflict (already approved) or an idempotent 200 — never a SECOND
    // receipt and never a second setlist write.
    expect([200, 409]).toContain(retry.status());
    const afterRetry = await readProposal(run.identity, PROPOSALS.pending);
    // A matching receipt makes the retry a NO-WRITE success: same fingerprint, same
    // timestamp, and the proposal's revision never moved again.
    expect(afterRetry?.approval_receipt?.fingerprint).toBe(fingerprint);
    expect(afterRetry?.approval_receipt?.approvedAt).toBe(receipt?.approvedAt);
    expect(afterRetry?._rev, "a receipt retry must write nothing").toBe(approved?._rev);
    const liveAfterRetry = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);
    expect((liveAfterRetry?.songs ?? []).map((s) => s.song?._ref)).toEqual([
      SONGS.a,
      SONGS.b,
      SONGS.c,
    ]);

    run.evidence("proposal_approved", {
      id: PROPOSALS.pending,
      receiptFingerprint: fingerprint ?? null,
      retryStatus: retry.status(),
    });
  });

  test("reopens an APPROVED proposal under the reviewed revision", async ({ admin, run }) => {
    // `reopen` means "send a published setlist back for revision": the admin UI
    // offers it only on an approved card, and it commits `changes_requested`. So
    // its one legal source state is `approved` — reopening from
    // `changes_requested` is the refusal asserted in the next scenario, not this
    // scenario's happy path.
    const before = await readProposal(run.identity, PROPOSALS.approved);
    expect(before?.status).toBe("approved");

    const res = await admin.api.patch(adminProposal(PROPOSALS.approved), {
      data: { action: "reopen", rev: before?._rev, adminNotes: "Reabrir para ajustes." },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const after = await readProposal(run.identity, PROPOSALS.approved);
    expect(after?.status).toBe("changes_requested");
    expect(after?._rev).not.toBe(before?._rev);
    // The transition is recorded, so an identical replay is a provable no-write retry.
    expect(after?.last_transition).toMatchObject({ action: "reopen", toStatus: "changes_requested" });
  });

  test("refuses a reopen whose source state is not approved, writing nothing", async ({
    admin,
    run,
  }) => {
    const before = await readProposal(run.identity, PROPOSALS.changesRequested);
    expect(before?.status).toBe("changes_requested");

    const res = await admin.api.patch(adminProposal(PROPOSALS.changesRequested), {
      data: { action: "reopen", rev: before?._rev },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { details?: { detail?: string } }).toMatchObject({
      details: { detail: "source_status" },
    });

    const after = await readProposal(run.identity, PROPOSALS.changesRequested);
    expect(after?._rev, "a refused transition must write nothing").toBe(before?._rev);
    expect(after?.status).toBe("changes_requested");
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
    expect(legacy?.approval_receipt ?? null).toBeNull();

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
