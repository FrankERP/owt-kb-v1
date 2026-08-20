import { describe, it, expect, vi, beforeEach } from "vitest";

// `redirect` THROWS in Next — it unwinds the render. The mock throws a sentinel
// so the gate's control flow under test is the real one: a mock that merely
// recorded the call would let execution fall through into code the production
// path never reaches.
class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`REDIRECT ${target}`);
  }
}
const redirect = vi.fn((target: string) => {
  throw new RedirectSignal(target);
});
vi.mock("next/navigation", () => ({ redirect: (t: string) => redirect(t) }));

const requireActiveSession = vi.fn();
const requireMinistryMember = vi.fn();
vi.mock("../authGuards", () => ({
  requireActiveSession: () => requireActiveSession(),
  requireMinistryMember: (m: string) => requireMinistryMember(m),
}));

const getMemberAccess = vi.fn();
vi.mock("../memberAccess", () => ({
  getMemberAccess: (id: string) => getMemberAccess(id),
}));

import { requireWorshipPage } from "../worshipPageGate";

/** Runs the gate and reports where it sent the visitor, or null for "rendered". */
async function gate(path = "/tag"): Promise<string | null> {
  try {
    await requireWorshipPage(path);
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.target;
    throw e;
  }
}

const activeSession = { user: { role: "member", sanityId: "m1", email: "x@y.z" } };

beforeEach(() => {
  redirect.mockClear();
  requireActiveSession.mockReset();
  requireMinistryMember.mockReset();
  getMemberAccess.mockReset();
});

describe("requireWorshipPage", () => {
  it("sends a visitor with no session to sign-in, carrying the callback", async () => {
    requireActiveSession.mockResolvedValue(null);
    expect(await gate("/tag")).toBe("/auth/signin?callbackUrl=%2Ftag");
    expect(requireMinistryMember).not.toHaveBeenCalled();
  });

  it("sends a DISABLED member to sign-in, never to /kids (anti-loop)", async () => {
    // proxy.ts:26 is `authorized: ({ token }) => !!token` — a disabled member
    // still holds a valid token and reaches this gate, where
    // requireActiveSession returns null. /kids' own gate would bounce them
    // straight back here, forever.
    requireActiveSession.mockResolvedValue(null);
    const target = await gate("/schedule");
    expect(target).toBe("/auth/signin?callbackUrl=%2Fschedule");
    expect(target).not.toContain("/kids");
  });

  it("sends an active kids-only member to /kids", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(null);
    getMemberAccess.mockResolvedValue({
      active: true, role: "member", ministries: ["kids"], managesMinistries: [],
    });
    expect(await gate("/")).toBe("/kids");
  });

  it("sends an active member of NO known ministry to /me, never /kids (anti-loop)", async () => {
    // Unreachable through any current path — the write boundary rejects `[]`
    // and normalizeMinistries maps unknown ids back to ["worship"]. The branch
    // is defence in depth against a future third ministry or a hand-edited
    // document: /kids would send this member right back here.
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(null);
    getMemberAccess.mockResolvedValue({
      active: true, role: "member", ministries: [], managesMinistries: [],
    });
    expect(await gate("/author")).toBe("/me");
  });

  it("lets an active worship member render — no redirect at all", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
    expect(await gate("/posts/song")).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(getMemberAccess).not.toHaveBeenCalled();
  });

  it("asks specifically for WORSHIP membership", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
    await gate("/tag/adoracion");
    expect(requireMinistryMember).toHaveBeenCalledWith("worship");
  });
});
