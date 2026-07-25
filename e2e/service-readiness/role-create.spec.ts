// A3 §4 — "role create plus lost-response/idempotency behavior", through the
// DEPLOYED `POST /api/admin/roles` route.
//
// Every scenario re-queries Sanity afterwards, under the live lease, because the
// HTTP body is the route's claim and the stored document is the fact.

import { expect, test } from "./fixtures";
import { readRole, readRolesAtTarget, readSidecar } from "./lib/dataset";
import {
  FIXTURE_DATE,
  createRoleBody,
  fullSeats,
  lockId,
  receiptId,
  scopedRequestId,
} from "./lib/fixtureRefs";

const CREATE = "/api/admin/roles";

test.describe("role create", () => {
  test("creates the role, its receipt and its weekend lock in one transaction", async ({
    admin,
    run,
  }) => {
    // `sundayVacant` has a vacant lock and no role — the reclaim path.
    const date = FIXTURE_DATE.sundayVacant;
    const requestId = scopedRequestId(run.identity.runId, "create-ok");
    const body = createRoleBody({
      type: "sunday_role",
      date,
      requestId,
      published: false,
      seats: fullSeats(),
    });

    const res = await admin.api.post(CREATE, { data: body, failOnStatusCode: false });
    expect(res.status(), await res.text()).toBe(201);
    const created = (await res.json()) as { _id: string; creationRequestId: string };
    run.recordCreated(created._id, "role-create/created");
    run.recordCreated(receiptId(requestId), "role-create/receipt");
    expect(created.creationRequestId).toBe(requestId);

    // Stored state: exactly one canonical role at the target...
    const atTarget = await readRolesAtTarget(run.identity, { type: "sunday_role", date });
    expect(atTarget.map((r) => r._id)).toEqual([created._id]);

    // ...the deterministic receipt is committed and points at it...
    const receipt = await readSidecar<{ state: string; roleId: string; requestId: string }>(
      run.identity,
      receiptId(requestId),
    );
    expect(receipt).toMatchObject({ state: "committed", roleId: created._id, requestId });

    // ...and the weekend lock is claimed by it.
    const lock = await readSidecar<{ state: string; roleId: string }>(
      run.identity,
      lockId("sunday_role", date),
    );
    expect(lock).toMatchObject({ state: "claimed", roleId: created._id });

    run.evidence("role_created", { roleId: created._id, requestId });
  });

  test("replays a lost response for the same key and payload without writing again", async ({
    admin,
    run,
  }) => {
    const date = FIXTURE_DATE.sundayVacant;
    const requestId = scopedRequestId(run.identity.runId, "create-replay");
    const body = createRoleBody({
      type: "sunday_role",
      date,
      requestId,
      seats: fullSeats(),
    });

    const first = await admin.api.post(CREATE, { data: body, failOnStatusCode: false });
    expect(first.status()).toBe(201);
    const created = (await first.json()) as { _id: string };
    run.recordCreated(created._id, "role-create/replay");
    run.recordCreated(receiptId(requestId), "role-create/replay-receipt");
    const afterFirst = await readRole(run.identity, created._id);
    expect(afterFirst).not.toBeNull();

    // The client never saw the 201. It retries the identical request.
    const second = await admin.api.post(CREATE, { data: body, failOnStatusCode: false });
    expect(second.status(), "a lost-response replay is a 200, not a second create").toBe(200);
    const replay = (await second.json()) as { _id: string; replay: boolean };
    expect(replay.replay).toBe(true);
    expect(replay._id).toBe(created._id);

    // No duplicate, and the stored revision did not move: the replay wrote nothing.
    const atTarget = await readRolesAtTarget(run.identity, { type: "sunday_role", date });
    expect(atTarget.map((r) => r._id)).toEqual([created._id]);
    const afterReplay = await readRole(run.identity, created._id);
    expect(afterReplay?._rev, "a replay must not mutate the role").toBe(afterFirst?._rev);
  });

  test("rejects the same key with a different payload as idempotency_mismatch", async ({
    admin,
    run,
  }) => {
    const date = FIXTURE_DATE.sundayVacant;
    const requestId = scopedRequestId(run.identity.runId, "create-mismatch");

    const first = await admin.api.post(CREATE, {
      data: createRoleBody({ type: "sunday_role", date, requestId, seats: fullSeats() }),
      failOnStatusCode: false,
    });
    expect(first.status()).toBe(201);
    const created = (await first.json()) as { _id: string };
    run.recordCreated(created._id, "role-create/mismatch");
    run.recordCreated(receiptId(requestId), "role-create/mismatch-receipt");
    const before = await readRole(run.identity, created._id);

    // Same key, different seats.
    const second = await admin.api.post(CREATE, {
      data: createRoleBody({
        type: "sunday_role",
        date,
        requestId,
        seats: { ...fullSeats(), bgvs: [] },
      }),
      failOnStatusCode: false,
    });
    expect(second.status()).toBe(409);
    const err = (await second.json()) as { error: string; conflict: boolean };
    expect(err).toMatchObject({ error: "idempotency_mismatch", conflict: true });

    const after = await readRole(run.identity, created._id);
    expect(after?._rev, "a mismatch must change nothing").toBe(before?._rev);
  });

  test("refuses to recreate through a retired idempotency key", async ({ admin, run }) => {
    // `FIXTURE_REQUEST_IDS.retired` is seeded as a `role_deleted` tombstone receipt.
    const { FIXTURE_REQUEST_IDS } = await import("./lib/fixtureRefs");
    const requestId = FIXTURE_REQUEST_IDS.retired as string;

    const res = await admin.api.post(CREATE, {
      data: createRoleBody({
        type: "sunday_role",
        date: FIXTURE_DATE.sundayDangling,
        requestId,
        seats: fullSeats(),
      }),
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: "idempotency_key_retired",
    });

    // The tombstone is untouched and no role was resurrected.
    const receipt = await readSidecar<{ state: string; roleId: string }>(
      run.identity,
      receiptId(requestId),
    );
    expect(receipt?.state).toBe("role_deleted");
    expect(await readRole(run.identity, receipt?.roleId as string)).toBeNull();
  });

  test("refuses a second role at an already-occupied target", async ({ admin, run }) => {
    // `sundayPublished` already has a canonical role.
    const date = FIXTURE_DATE.sundayPublished;
    const res = await admin.api.post(CREATE, {
      data: createRoleBody({
        type: "sunday_role",
        date,
        requestId: scopedRequestId(run.identity.runId, "create-occupied"),
        seats: fullSeats(),
      }),
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "ambiguous_target" });

    const atTarget = await readRolesAtTarget(run.identity, { type: "sunday_role", date });
    expect(atTarget, "the target must still hold exactly one role").toHaveLength(1);
  });
});
