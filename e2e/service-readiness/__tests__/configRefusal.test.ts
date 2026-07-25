// Proof that the REAL `playwright.config.ts` refuses to load without an explicit
// verification base URL, and that every fixture reference the specs use is a
// deterministic seeded fixture the reset actually owns.
//
// The first half is the load-bearing one: the config is what `npx playwright test`
// evaluates, so if it throws, the suite cannot run — no browser is launched, no
// deployment is contacted, nothing is signed in.

import { describe, expect, it } from "vitest";

import {
  MEMBERS,
  PROPOSALS,
  ROLES,
  SETLISTS,
  SONGS,
  createRoleBody,
  fullSeats,
  lockId,
  observedNone,
  observedSingle,
  receiptId,
  scopedRequestId,
} from "../lib/fixtureRefs";
import { fixtureIds, isDeletableFixtureId } from "../../../scripts/lib/sr-verification.mjs";

const HARNESS_ENV_VARS = [
  "SR_VERIFY_BASE_URL",
  "ALLOW_SERVICE_READINESS_E2E_WRITES",
  "SERVICE_READINESS_VERIFICATION_MARKER",
  "SR_VERIFY_SANITY_PROJECT_ID",
  "SR_VERIFY_SANITY_DATASET",
  "SR_VERIFY_SANITY_TOKEN",
  "SR_VERIFY_ADMIN_EMAIL",
  "SR_VERIFY_ADMIN_PASSWORD",
  "SR_VERIFY_MEMBER_EMAIL",
  "SR_VERIFY_MEMBER_PASSWORD",
  "SR_VERIFY_RUN_ID",
  "SR_VERIFY_CANDIDATE_SHA",
  "SR_VERIFY_DEPLOYMENT_ID",
  "SR_VERIFY_BYPASS_SECRET",
] as const;

describe("playwright.config.ts refuses to load unconfigured", () => {
  it("throws a refusal naming the missing base URL, so the suite cannot run", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of HARNESS_ENV_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      // Cache-busted so each is a genuine fresh evaluation of the REAL config module.
      // Built at runtime from a file URL so this is the actual `playwright.config.ts`
      // the runner loads, not a copy.
      const configUrl = new URL("../../../playwright.config.ts", import.meta.url).href;
      await expect(
        import(/* @vite-ignore */ `${configUrl}?configRefusalTest=1`),
      ).rejects.toThrow(/REFUSING TO RUN/);
      await expect(
        import(/* @vite-ignore */ `${configUrl}?configRefusalTest=2`),
      ).rejects.toThrow(/missing_base_url/);
    } finally {
      for (const key of HARNESS_ENV_VARS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe("fixture references belong to the deterministic seeded set", () => {
  const seeded = new Set(fixtureIds() as string[]);

  it("every referenced member, role, setlist, proposal and song is a seeded fixture", () => {
    const referenced = [
      ...Object.values(MEMBERS),
      ...Object.values(ROLES),
      ...Object.values(SETLISTS),
      ...Object.values(PROPOSALS),
      ...Object.values(SONGS),
    ];
    for (const id of referenced) {
      expect(seeded.has(id), `${id} is not part of buildFixtureDocuments()`).toBe(true);
      // ...and is therefore inside the reset's closed deletion allowlist.
      expect(isDeletableFixtureId(id), `${id} is not resettable`).toBe(true);
    }
  });

  it("derives the weekend lock and creation-receipt ids through the shared mirrors", () => {
    expect(lockId("sunday_role", "2026-08-02")).toBe("roleTarget.sunday_role.2026-08-02");
    expect(lockId("saturday_role", "2026-08-01")).toBe("roleTarget.saturday_role.2026-08-01");
    expect(() => lockId("sunday_role", "not-a-date")).toThrow();
    expect(receiptId("srv-request-sunday-published")).toMatch(/^roleCreate\.[0-9a-f]{64}$/);
    expect(() => receiptId("")).toThrow();
  });

  it("builds a create body that carries the idempotency key and all five seat paths", () => {
    const body = createRoleBody({
      type: "sunday_role",
      date: "2026-08-30",
      requestId: "srv-example-request-id",
      seats: fullSeats(),
    });
    expect(body).toMatchObject({
      creationRequestId: "srv-example-request-id",
      _type: "sunday_role",
      date: "2026-08-30",
      published: false,
    });
    expect(body.leads).toEqual([MEMBERS.lead]);
    expect(body.bgvs).toEqual([MEMBERS.bgv]);
    expect(body.chorus).toEqual([MEMBERS.chorus]);
    expect(body.instruments).toEqual([{ instrument: "Guitarra", personId: MEMBERS.instrument }]);
    expect(body.foh).toEqual([{ role: "Audio", personId: MEMBERS.foh }]);
  });

  it("builds the observed-target shapes the write contracts require", () => {
    expect(observedNone()).toEqual({ state: "none" });
    expect(observedSingle("srv.setlist.sunday.ready", "rev-1")).toEqual({
      state: "single",
      id: "srv.setlist.sunday.ready",
      rev: "rev-1",
    });
  });

  it("scopes creation request ids to the run so two runs cannot collide on a key", () => {
    const a = scopedRequestId("srvrun-aaaaaaaaaaaaaaaa", "create");
    const b = scopedRequestId("srvrun-bbbbbbbbbbbbbbbb", "create");
    expect(a).not.toBe(b);
    expect(a.startsWith("srv-create-")).toBe(true);
  });
});
