// `PATCH /api/me/theme` — a member writing their own theme preference.
//
// Two properties matter more than the happy path.
//
// FIRST: the document id comes from the session and never from the body, so no
// member can address another member's record. That is the ordinary self-write
// guarantee — but impersonation BREAKS it, because auth.ts rewrites
// `session.user.sanityId` to the impersonated target. Without the 403 a
// super-admin toggling the theme while impersonating would persist it to someone
// else's document from a UI action that looks entirely local.
//
// SECOND: "system" is rejected. With `enableSystem={false}` next-themes would add
// a literal `system` class and strip light/dark, so the app stays dark forever
// while Sanity stores "system" and nothing logs. Child F owns the flip that makes
// that value legal.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  sets: [] as Record<string, unknown>[],
  patchedIds: [] as string[],
  commit: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => h.requireActiveSession(),
}));

vi.mock("@/sanity/lib/serverClient", () => {
  const chain: Record<string, unknown> = {};
  chain.set = (v: Record<string, unknown>) => { h.sets.push(v); return chain; };
  chain.commit = () => h.commit();
  return {
    writeClient: {
      patch: (id: string) => { h.patchedIds.push(id); return chain; },
    },
  };
});

const { PATCH } = await import("@/app/api/me/theme/route");

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const MEMBER = { user: { sanityId: "member-self", isImpersonating: false } };

beforeEach(() => {
  h.sets.length = 0;
  h.patchedIds.length = 0;
  h.commit.mockReset().mockResolvedValue({});
  h.requireActiveSession.mockReset().mockResolvedValue(MEMBER);
});

describe("PATCH /api/me/theme", () => {
  it("401s with no active session, and writes nothing", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    const res = await PATCH(req({ theme: "light" }));
    expect(res.status).toBe(401);
    expect(h.patchedIds).toEqual([]);
  });

  it("writes the member's OWN id, taken from the session and never the body", async () => {
    const res = await PATCH(req({ theme: "light", _id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(h.patchedIds).toEqual(["member-self"]);
    expect(h.sets).toEqual([{ themePref: "light" }]);
  });

  it("accepts dark", async () => {
    const res = await PATCH(req({ theme: "dark" }));
    expect(res.status).toBe(200);
    expect(h.sets).toEqual([{ themePref: "dark" }]);
  });

  // The claim a Critical-tier reviewer should not have to take on trust.
  it("403s while impersonating — the id would be the TARGET's, not the admin's", async () => {
    h.requireActiveSession.mockResolvedValue({
      user: { sanityId: "the-impersonated-member", isImpersonating: true },
    });
    const res = await PATCH(req({ theme: "light" }));
    expect(res.status).toBe(403);
    expect(h.patchedIds, "no cross-member write may reach Sanity").toEqual([]);
  });

  it('400s on "system" — legal-looking, and silently does nothing in the browser', async () => {
    const res = await PATCH(req({ theme: "system" }));
    expect(res.status).toBe(400);
    expect(h.patchedIds).toEqual([]);
  });

  it.each([
    ["an unknown string", { theme: "sepia" }],
    ["a boolean", { theme: true }],
    ["null", { theme: null }],
    ["a missing field", {}],
    ["a null body", null],
  ])("400s on %s", async (_label, body) => {
    const res = await PATCH(req(body));
    expect(res.status).toBe(400);
    expect(h.patchedIds).toEqual([]);
  });

  it("400s rather than throwing when the body is not JSON at all", async () => {
    const bad = { json: async () => { throw new SyntaxError("bad json"); } } as unknown as NextRequest;
    const res = await PATCH(bad);
    expect(res.status).toBe(400);
  });

  // CLAUDE.md's cache invariant catches "a mutating route with no revalidate", so
  // the absence is asserted rather than left to inspection: themePref is per-member
  // chrome that no ISR page renders, and revalidating here would drop the whole
  // schedule for a colour change.
  it("calls no revalidate* util — deliberate, see the route comment", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("app/api/me/theme/route.ts", "utf8"),
    );
    // Comments stripped first: the route's own comment explains at length why it
    // does NOT call revalidateServiceViews(), and a guard that cannot tell an
    // explanation from a call would fail on the documentation that keeps the
    // decision legible.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/revalidate(Path|Tag|ServiceViews|SongViews)\s*\(/);
  });
});
