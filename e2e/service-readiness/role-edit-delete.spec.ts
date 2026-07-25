// A3 §4 — "edit, dependency-blocked date move, delete/vacate, and recreate",
// through the DEPLOYED `PATCH`/`DELETE /api/admin/roles/[id]` routes.

import { expect, test } from "./fixtures";
import { readRole, readRolesAtTarget, readSidecar } from "./lib/dataset";
import {
  FIXTURE_DATE,
  MEMBERS,
  ROLES,
  createRoleBody,
  fullSeats,
  lockId,
  receiptId,
  scopedRequestId,
} from "./lib/fixtureRefs";

const CREATE = "/api/admin/roles";
const roleUrl = (id: string) => `/api/admin/roles/${encodeURIComponent(id)}`;

test.describe("role edit", () => {
  test("applies a seat edit under the observed revision", async ({ admin, run }) => {
    const before = await readRole(run.identity, ROLES.sundayDraft);
    expect(before).not.toBeNull();

    const res = await admin.api.patch(roleUrl(ROLES.sundayDraft), {
      data: {
        rev: before?._rev,
        _type: "sunday_role",
        date: FIXTURE_DATE.sundayDraft,
        leads: [MEMBERS.lead, MEMBERS.unavailable],
        bgvs: [MEMBERS.bgv],
        chorus: [MEMBERS.chorus],
        instruments: [{ instrument: "Guitarra", personId: MEMBERS.instrument }],
        foh: [{ role: "Audio", personId: MEMBERS.foh }],
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    // The successful mutation must return the REFRESHED read shape, not an echo.
    const body = (await res.json()) as { _id: string; _rev: string; Lead?: Array<{ _ref?: string }> };
    expect(body._id).toBe(ROLES.sundayDraft);
    expect(body._rev).not.toBe(before?._rev);

    const stored = await readRole(run.identity, ROLES.sundayDraft);
    expect(stored?._rev).toBe(body._rev);
    expect((stored?.Lead ?? []).map((r) => r._ref).sort()).toEqual(
      [MEMBERS.lead, MEMBERS.unavailable].sort(),
    );
  });

  test("rejects a stale observed revision without touching the document", async ({ admin, run }) => {
    const before = await readRole(run.identity, ROLES.sundayDraft);

    // Move the revision once...
    const first = await admin.api.patch(roleUrl(ROLES.sundayDraft), {
      data: {
        rev: before?._rev,
        _type: "sunday_role",
        date: FIXTURE_DATE.sundayDraft,
        leads: [MEMBERS.lead],
        bgvs: [],
        chorus: [],
        instruments: [],
        foh: [],
      },
      failOnStatusCode: false,
    });
    expect(first.status()).toBe(200);
    const moved = await readRole(run.identity, ROLES.sundayDraft);

    // ...then retry with the revision the client originally observed.
    const stale = await admin.api.patch(roleUrl(ROLES.sundayDraft), {
      data: {
        rev: before?._rev,
        _type: "sunday_role",
        date: FIXTURE_DATE.sundayDraft,
        leads: [MEMBERS.chorus],
        bgvs: [],
        chorus: [],
        instruments: [],
        foh: [],
      },
      failOnStatusCode: false,
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()) as { error: string }).toMatchObject({ error: "stale_revision" });

    const after = await readRole(run.identity, ROLES.sundayDraft);
    expect(after?._rev, "a stale-revision refusal must write nothing").toBe(moved?._rev);
  });

  test("blocks a date move whose current date has dependent setlist/proposal history", async ({
    admin,
    run,
  }) => {
    // `sundayPublished` has both a seeded setlist week and a seeded pending proposal.
    const before = await readRole(run.identity, ROLES.sundayPublished);

    const res = await admin.api.patch(roleUrl(ROLES.sundayPublished), {
      data: {
        rev: before?._rev,
        _type: "sunday_role",
        // A date with no role and no dependencies.
        date: FIXTURE_DATE.sundayVacant,
        leads: [MEMBERS.lead],
        bgvs: [MEMBERS.bgv],
        chorus: [MEMBERS.chorus],
        instruments: [{ instrument: "Guitarra", personId: MEMBERS.instrument }],
        foh: [{ role: "Audio", personId: MEMBERS.foh }],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    const err = (await res.json()) as {
      error: string;
      details?: { dependencies?: Array<{ id: string; type: string; scope: string }> };
    };
    expect(err.error).toBe("role_date_has_dependencies");
    // The refusal carries the EXACT blocking ids, so the operator needs no second query.
    expect(err.details?.dependencies?.length ?? 0).toBeGreaterThan(0);

    // Nothing moved: the role kept its date and its revision.
    const after = await readRole(run.identity, ROLES.sundayPublished);
    expect(after?._rev).toBe(before?._rev);
    expect(after?.week).toBe(FIXTURE_DATE.sundayPublished);
    // ...and the destination target is still empty.
    expect(
      await readRolesAtTarget(run.identity, {
        type: "sunday_role",
        date: FIXTURE_DATE.sundayVacant,
      }),
    ).toEqual([]);
  });
});

test.describe("role delete, vacate and recreate", () => {
  test("deletes a dependency-free role, vacates its lock, and lets the target be recreated", async ({
    admin,
    run,
  }) => {
    // Create a fresh role at the vacant target so the delete has no dependencies.
    const date = FIXTURE_DATE.sundayVacant;
    const requestId = scopedRequestId(run.identity.runId, "delete-cycle");
    const created = (await (
      await admin.api.post(CREATE, {
        data: createRoleBody({ type: "sunday_role", date, requestId, seats: fullSeats() }),
        failOnStatusCode: false,
      })
    ).json()) as { _id: string };

    const stored = await readRole(run.identity, created._id);
    const del = await admin.api.delete(roleUrl(created._id), {
      data: { rev: stored?._rev },
      failOnStatusCode: false,
    });
    expect(del.status(), await del.text()).toBeLessThan(300);

    // The role is gone, the lock is VACANT (not deleted), and the receipt is a tombstone.
    expect(await readRole(run.identity, created._id)).toBeNull();
    const lock = await readSidecar<{ state: string; roleId: string | null; generation: number }>(
      run.identity,
      lockId("sunday_role", date),
    );
    expect(lock?.state).toBe("vacant");
    const receipt = await readSidecar<{ state: string }>(run.identity, receiptId(requestId));
    expect(receipt?.state).toBe("role_deleted");

    // Recreate at the same target with a NEW key — the vacated lock is reclaimable.
    const recreateId = scopedRequestId(run.identity.runId, "delete-recreate");
    const again = await admin.api.post(CREATE, {
      data: createRoleBody({
        type: "sunday_role",
        date,
        requestId: recreateId,
        seats: fullSeats(),
      }),
      failOnStatusCode: false,
    });
    expect(again.status(), await again.text()).toBe(201);
    const recreated = (await again.json()) as { _id: string };
    run.recordCreated(recreated._id, "role-delete/recreated");
    run.recordCreated(receiptId(recreateId), "role-delete/recreated-receipt");

    const atTarget = await readRolesAtTarget(run.identity, { type: "sunday_role", date });
    expect(atTarget.map((r) => r._id)).toEqual([recreated._id]);
    const reclaimed = await readSidecar<{ state: string; roleId: string; generation: number }>(
      run.identity,
      lockId("sunday_role", date),
    );
    expect(reclaimed).toMatchObject({ state: "claimed", roleId: recreated._id });
    // Generation is monotonic across vacate/reclaim, so a stale holder cannot win.
    expect(reclaimed?.generation ?? 0).toBeGreaterThan(lock?.generation ?? 0);

    run.evidence("role_delete_vacate_recreate", {
      deleted: created._id,
      recreated: recreated._id,
    });
  });

  test("refuses to delete a role that has dependent setlist/proposal history", async ({
    admin,
    run,
  }) => {
    const before = await readRole(run.identity, ROLES.sundayPublished);
    const res = await admin.api.delete(roleUrl(ROLES.sundayPublished), {
      data: { rev: before?._rev },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "role_has_dependencies",
    });

    const after = await readRole(run.identity, ROLES.sundayPublished);
    expect(after?._rev, "a blocked delete must not touch the role").toBe(before?._rev);
  });
});
