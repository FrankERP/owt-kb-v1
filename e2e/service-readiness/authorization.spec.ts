// A3 §4 — "authentication/authorization rejects member/non-member callers".
//
// Two distinct claims, and both are proven against STORED state, because a route
// that returns 403 while having already written something would still be a breach:
//
//   · NON-MEMBER (no session at all) — must be rejected by the APP, not merely by
//     Deployment Protection. The anonymous context is therefore given the bypass
//     header explicitly, so the request reaches the app and the app is the one
//     saying no.
//   · MEMBER (a real signed-in ordinary member) — must be rejected from every
//     manager-only mutation and from every admin read.

import { expect, test } from "./fixtures";
import { readRole, readWeekendSetlist } from "./lib/dataset";
import {
  FIXTURE_DATE,
  ROLES,
  SETLISTS,
  createRoleBody,
  fullSeats,
  observedSingle,
  scopedRequestId,
} from "./lib/fixtureRefs";

const MANAGER_WRITES = [
  { method: "POST" as const, url: "/api/admin/roles" },
  { method: "POST" as const, url: "/api/admin/roles/publish" },
  { method: "POST" as const, url: "/api/admin/roles/swap" },
  { method: "POST" as const, url: "/api/admin/roles/copy-instruments" },
  { method: "PUT" as const, url: "/api/admin/setlists" },
];

const ADMIN_READS = [
  "/api/admin/roles",
  "/api/admin/service-integrity/roles",
  "/api/admin/service-integrity/setlists",
  "/api/admin/service-integrity/proposals",
  "/api/admin/proposals",
];

test.describe("non-member (unauthenticated) callers", () => {
  test("every manager mutation is rejected, and nothing is written", async ({ anon, run }) => {
    const before = {
      role: (await readRole(run.identity, ROLES.sundayDraft))?._rev,
      setlist: (await readWeekendSetlist(run.identity, SETLISTS.sundayReady))?._rev,
    };

    for (const route of MANAGER_WRITES) {
      const res = await anon.fetch(route.url, {
        method: route.method,
        data: { probe: true },
        failOnStatusCode: false,
        // Do NOT follow the redirect. A correct 307 to /api/auth/signin would
        // otherwise be read as the sign-in page's own 200 — i.e. a real rejection
        // reported as an unauthenticated caller getting through.
        maxRedirects: 0,
      });
      // 401/403 from the app, or a NextAuth redirect to the sign-in page. Never 2xx.
      expect(
        res.status(),
        `${route.method} ${route.url} must reject an unauthenticated caller`,
      ).toBeGreaterThanOrEqual(300);
      expect(res.status()).not.toBe(200);
    }

    expect((await readRole(run.identity, ROLES.sundayDraft))?._rev).toBe(before.role);
    expect((await readWeekendSetlist(run.identity, SETLISTS.sundayReady))?._rev).toBe(
      before.setlist,
    );
  });

  test("every admin read is rejected", async ({ anon }) => {
    for (const url of ADMIN_READS) {
      // `maxRedirects: 0` for the same reason as above: the redirect TARGET is a 200.
      const res = await anon.get(url, { failOnStatusCode: false, maxRedirects: 0 });
      expect(res.status(), `${url} must reject an unauthenticated caller`).not.toBe(200);
    }
  });

  test("a well-formed create body from an unauthenticated caller still writes nothing", async ({
    anon,
    run,
  }) => {
    // Deliberately VALID, so the rejection cannot be attributed to a parse failure.
    const requestId = scopedRequestId(run.identity.runId, "authz-anon-create");
    const res = await anon.post("/api/admin/roles", {
      data: createRoleBody({
        type: "sunday_role",
        date: FIXTURE_DATE.sundayVacant,
        requestId,
        seats: fullSeats(),
      }),
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(res.status()).not.toBe(201);

    const { readRolesAtTarget, readSidecar } = await import("./lib/dataset");
    const { receiptId } = await import("./lib/fixtureRefs");
    expect(
      await readRolesAtTarget(run.identity, {
        type: "sunday_role",
        date: FIXTURE_DATE.sundayVacant,
      }),
    ).toEqual([]);
    expect(await readSidecar(run.identity, receiptId(requestId))).toBeNull();
  });
});

test.describe("ordinary member callers", () => {
  test("a signed-in member is rejected from every manager mutation", async ({ member, run }) => {
    const before = (await readRole(run.identity, ROLES.sundayDraft))?._rev;

    const attempts: Array<{ label: string; run: () => Promise<number> }> = [
      {
        label: "create",
        run: async () =>
          (
            await member.api.post("/api/admin/roles", {
              data: createRoleBody({
                type: "sunday_role",
                date: FIXTURE_DATE.sundayVacant,
                requestId: scopedRequestId(run.identity.runId, "authz-member-create"),
                seats: fullSeats(),
              }),
              failOnStatusCode: false,
            })
          ).status(),
      },
      {
        label: "publish",
        run: async () =>
          (
            await member.api.post("/api/admin/roles/publish", {
              data: { published: true, roles: [{ id: ROLES.sundayDraft, rev: before }] },
              failOnStatusCode: false,
            })
          ).status(),
      },
      {
        label: "edit",
        run: async () =>
          (
            await member.api.patch(`/api/admin/roles/${encodeURIComponent(ROLES.sundayDraft)}`, {
              data: { rev: before, _type: "sunday_role", date: FIXTURE_DATE.sundayDraft },
              failOnStatusCode: false,
            })
          ).status(),
      },
      {
        label: "live setlist save",
        run: async () => {
          const setlist = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);
          return (
            await member.api.put("/api/admin/setlists", {
              data: {
                type: "sunday",
                week: FIXTURE_DATE.sundayDraft,
                observed: observedSingle(setlist?._id as string, setlist?._rev as string),
                songs: [],
              },
              failOnStatusCode: false,
            })
          ).status();
        },
      },
    ];

    for (const attempt of attempts) {
      const status = await attempt.run();
      expect(status, `a member must not be able to ${attempt.label}`).toBe(403);
    }

    expect(
      (await readRole(run.identity, ROLES.sundayDraft))?._rev,
      "no member-attempted mutation may have landed",
    ).toBe(before);
  });

  test("a signed-in member is rejected from the admin reads", async ({ member }) => {
    for (const url of ADMIN_READS) {
      const res = await member.api.get(url, { failOnStatusCode: false });
      expect(res.status(), `${url} must reject an ordinary member`).toBe(403);
    }
  });

  test("a member CAN reach its own proposal surface (the negative controls are real)", async ({
    member,
  }) => {
    // Without this, "everything returns 403" would also pass if the member session
    // were simply broken.
    const res = await member.api.get("/api/me", { failOnStatusCode: false });
    expect(res.status(), "the member session itself must be valid").toBe(200);
  });
});
