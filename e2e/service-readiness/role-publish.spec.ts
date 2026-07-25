// A3 §4 — "single/bulk publish with atomic rejection", through the DEPLOYED
// `POST /api/admin/roles/publish` route.
//
// The atomicity claim is the point: one bad entry in a batch must leave EVERY role
// in the batch untouched, which can only be proven by re-querying all of them.

import { expect, test } from "./fixtures";
import { readRole } from "./lib/dataset";
import { ROLES } from "./lib/fixtureRefs";

const PUBLISH = "/api/admin/roles/publish";

test.describe("publish", () => {
  test("publishes one role under its observed revision", async ({ admin, run }) => {
    const before = await readRole(run.identity, ROLES.sundayDraft);
    expect(before?.published).toBe(false);

    const res = await admin.api.post(PUBLISH, {
      data: { published: true, roles: [{ id: ROLES.sundayDraft, rev: before?._rev }] },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()) as { ok: boolean; published: number }).toMatchObject({
      ok: true,
      published: 1,
    });

    const after = await readRole(run.identity, ROLES.sundayDraft);
    expect(after?.published).toBe(true);
    expect(after?._rev).not.toBe(before?._rev);
  });

  test("publishes a batch atomically", async ({ admin, run }) => {
    const sunday = await readRole(run.identity, ROLES.sundayDraft);
    const saturday = await readRole(run.identity, ROLES.saturdayDraft);
    const special = await readRole(run.identity, ROLES.specialDraft);

    const res = await admin.api.post(PUBLISH, {
      data: {
        published: true,
        roles: [
          { id: ROLES.sundayDraft, rev: sunday?._rev },
          { id: ROLES.saturdayDraft, rev: saturday?._rev },
          { id: ROLES.specialDraft, rev: special?._rev },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()) as { published: number }).toMatchObject({ published: 3 });

    for (const id of [ROLES.sundayDraft, ROLES.saturdayDraft, ROLES.specialDraft]) {
      expect((await readRole(run.identity, id))?.published, id).toBe(true);
    }
  });

  test("rejects the WHOLE batch when one entry's revision is stale", async ({ admin, run }) => {
    const sunday = await readRole(run.identity, ROLES.sundayDraft);
    const saturday = await readRole(run.identity, ROLES.saturdayDraft);

    // Move the Saturday role's revision so the batch below carries one stale entry.
    const bump = await admin.api.post(PUBLISH, {
      data: { published: true, roles: [{ id: ROLES.saturdayDraft, rev: saturday?._rev }] },
      failOnStatusCode: false,
    });
    expect(bump.status()).toBe(200);
    const movedSaturday = await readRole(run.identity, ROLES.saturdayDraft);

    const res = await admin.api.post(PUBLISH, {
      data: {
        published: true,
        roles: [
          { id: ROLES.sundayDraft, rev: sunday?._rev },
          // Stale: this is the revision from before the bump.
          { id: ROLES.saturdayDraft, rev: saturday?._rev },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { error: string; conflict: boolean }).toMatchObject({
      conflict: true,
    });

    // ATOMIC: the healthy Sunday entry must NOT have been published.
    const sundayAfter = await readRole(run.identity, ROLES.sundayDraft);
    expect(sundayAfter?.published, "one stale entry must not let a sibling through").toBe(false);
    expect(sundayAfter?._rev).toBe(sunday?._rev);
    // ...and the already-published Saturday role is untouched by the rejected batch.
    expect((await readRole(run.identity, ROLES.saturdayDraft))?._rev).toBe(movedSaturday?._rev);

    run.evidence("publish_batch_atomic_rejection", { rejected: 2, mutated: 0 });
  });

  test("rejects the whole batch when one id does not resolve", async ({ admin, run }) => {
    const sunday = await readRole(run.identity, ROLES.sundayDraft);

    const res = await admin.api.post(PUBLISH, {
      data: {
        published: true,
        roles: [
          { id: ROLES.sundayDraft, rev: sunday?._rev },
          { id: "srv.role.sunday.neverCreated", rev: sunday?._rev },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    const after = await readRole(run.identity, ROLES.sundayDraft);
    expect(after?.published).toBe(false);
    expect(after?._rev).toBe(sunday?._rev);
  });

  test("unpublishes back to a draft under the observed revision", async ({ admin, run }) => {
    const published = await readRole(run.identity, ROLES.sundayPublished);
    expect(published?.published).toBe(true);

    const res = await admin.api.post(PUBLISH, {
      data: { published: false, roles: [{ id: ROLES.sundayPublished, rev: published?._rev }] },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()) as { unpublished: number }).toMatchObject({ unpublished: 1 });
    expect((await readRole(run.identity, ROLES.sundayPublished))?.published).toBe(false);
  });
});
