// Service Readiness A3 §4 — the deployed verification identity route.
//
// This route is deliberately UNAUTHENTICATED (the harness calls it before it has
// a session), so its whole safety property is "in any ordinary deployment every
// condition fails and the route answers a bare 404". Each condition is therefore
// failed on its own here, and the success body is asserted to carry no secret.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The identity helper is `import "server-only"` guarded; neutralize it under vitest.
vi.mock("server-only", () => ({}));

const MARKER = "owt-service-readiness-verification-v1";

const BASE_ENV: Record<string, string> = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "scbxomq9",
  NEXT_PUBLIC_SANITY_DATASET: "service-readiness-verification",
  SERVICE_READINESS_VERIFICATION_MARKER: MARKER,
  ALLOW_SERVICE_READINESS_E2E_WRITES: "true",
  SERVICE_READINESS_DELIVERY_MODE: "disabled",
  VERCEL_GIT_COMMIT_REF: "verify/service-readiness",
  VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
  VERCEL_DEPLOYMENT_ID: "dpl_identityroute",
  VERCEL_URL: "owt-backstage-xyz.vercel.app",
};

const TOUCHED_KEYS = [
  ...Object.keys(BASE_ENV),
  "SR_VERIFY_CANDIDATE_SHA",
  "SR_VERIFY_DEPLOYMENT_ID",
  "SANITY_WRITE_TOKEN",
  "NEXTAUTH_SECRET",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TOUCHED_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of TOUCHED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

/** Install `over` on top of the valid environment (`undefined` deletes a key). */
function setEnv(over: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...over })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function callGet() {
  // Fresh module each time: the route reads `process.env` at request time, but a
  // reset keeps any future module-scope caching from making these tests lie.
  vi.resetModules();
  const { GET } = await import("@/app/api/service-readiness-verification/identity/route");
  return GET();
}

describe("GET /api/service-readiness-verification/identity — success", () => {
  it("returns the non-secret identity of the isolated verification deployment", async () => {
    setEnv();
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      marker: MARKER,
      projectId: "scbxomq9",
      dataset: "service-readiness-verification",
      deliveryMode: "disabled",
      e2eWritesEnabled: true,
      git: { ref: "verify/service-readiness", commitSha: "b".repeat(40) },
      deployment: { id: "dpl_identityroute", url: "owt-backstage-xyz.vercel.app" },
    });
  });

  it("returns no secret, even with every secret-shaped variable present", async () => {
    setEnv({
      SANITY_WRITE_TOKEN: "skWriteSECRET",
      NEXTAUTH_SECRET: "nextauthSECRET",
      VERCEL_AUTOMATION_BYPASS_SECRET: "bypassSECRET",
    });
    const body = await (await callGet()).text();
    expect(body).not.toContain("SECRET");
    expect(body).not.toContain("TOKEN");
    expect(body.toLowerCase()).not.toContain("token");
    expect(body.toLowerCase()).not.toContain("bypass");
    expect(body.toLowerCase()).not.toContain("password");
  });
});

describe("GET /api/service-readiness-verification/identity — fails closed", () => {
  /** Every 404 must be a bare 404: no body, no reason, no hint the route exists. */
  async function expectBare404(over: Record<string, string | undefined>) {
    setEnv(over);
    const res = await callGet();
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe("");
  }

  it("404s in a bare (production/local) environment", async () => {
    await expectBare404({
      NEXT_PUBLIC_SANITY_PROJECT_ID: undefined,
      NEXT_PUBLIC_SANITY_DATASET: undefined,
      SERVICE_READINESS_VERIFICATION_MARKER: undefined,
      ALLOW_SERVICE_READINESS_E2E_WRITES: undefined,
      SERVICE_READINESS_DELIVERY_MODE: undefined,
    });
  });

  it("404s on a wrong marker", async () => {
    await expectBare404({ SERVICE_READINESS_VERIFICATION_MARKER: "owt-service-readiness-verification-v2" });
  });

  it("404s on a missing marker", async () => {
    await expectBare404({ SERVICE_READINESS_VERIFICATION_MARKER: undefined });
  });

  it("404s on the production dataset", async () => {
    await expectBare404({ NEXT_PUBLIC_SANITY_DATASET: "production" });
  });

  it("404s on the production project", async () => {
    await expectBare404({ NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk" });
  });

  it("404s on the production project even with the right dataset NAME", async () => {
    await expectBare404({
      NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk",
      NEXT_PUBLIC_SANITY_DATASET: "service-readiness-verification",
    });
  });

  it("404s on the right project with the production dataset", async () => {
    await expectBare404({
      NEXT_PUBLIC_SANITY_PROJECT_ID: "scbxomq9",
      NEXT_PUBLIC_SANITY_DATASET: "production",
    });
  });

  it("404s when the E2E-writes flag is missing or not exactly true", async () => {
    await expectBare404({ ALLOW_SERVICE_READINESS_E2E_WRITES: undefined });
    await expectBare404({ ALLOW_SERVICE_READINESS_E2E_WRITES: "1" });
  });

  it("404s when the delivery mode is not exactly disabled", async () => {
    await expectBare404({ SERVICE_READINESS_DELIVERY_MODE: undefined });
    await expectBare404({ SERVICE_READINESS_DELIVERY_MODE: "enabled" });
    await expectBare404({ SERVICE_READINESS_DELIVERY_MODE: "Disabled" });
  });
});
