// The `/` ⇄ `/kids` LOOP REGRESSION.
//
// P1's worship gate redirects a kids-only member to `/kids`. If `/kids` answered
// a *sessionless* visitor with `/` — the natural single-branch shape — a disabled
// member holding a live cookie would bounce between the two forever, because
// `proxy.ts:26` (`authorized: ({ token }) => !!token`) lets them past the
// middleware and neither page can render them. The two failure cases must stay
// split, and this file is the proof from the `/kids` side. Its mirror image is
// `app/utils/__tests__/worshipPageGate.test.ts`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

// `redirect` THROWS in Next — it unwinds the render. The mock throws a sentinel so
// the control flow under test is the real one: a mock that merely recorded the call
// would let execution fall through into the query the production path never reaches.
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
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSession(),
  requireMinistryMember: (m: string) => requireMinistryMember(m),
}));

const getMemberAccess = vi.fn();
vi.mock("@/app/utils/memberAccess", () => ({
  getMemberAccess: (id: string) => getMemberAccess(id),
}));

const sanityFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p: Record<string, unknown>) => sanityFetch(q, p) },
}));

// Navbar pulls in NavMenu → next-auth/react and next/image, none of which this
// test is about. Link is stubbed for the same reason.
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { href: string; children?: ReactNode }) => children,
}));

import KidsPage from "../page";

/** Runs the page and reports where it sent the visitor, or null for "rendered". */
async function visit(): Promise<string | null> {
  try {
    await KidsPage();
    return null;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.target;
    throw e;
  }
}

const activeSession = { user: { role: "member", sanityId: "m1", email: "x@y.z" } };
const memberAccess = {
  active: true,
  role: "member",
  ministries: ["kids"],
  managesMinistries: [] as string[],
};

beforeEach(() => {
  redirect.mockClear();
  requireActiveSession.mockReset();
  requireMinistryMember.mockReset();
  getMemberAccess.mockReset();
  sanityFetch.mockReset();
  sanityFetch.mockResolvedValue([]);
});

describe("/kids page gate", () => {
  it("sends a DISABLED member to sign-in, never to / (anti-loop)", async () => {
    // A disabled/deleted member still holds a valid token, so they reach the page
    // and `requireActiveSession` returns null. `/`'s own gate would bounce them
    // straight back here.
    requireActiveSession.mockResolvedValue(null);
    const target = await visit();
    expect(target).toBe("/auth/signin?callbackUrl=/kids");
    expect(target).not.toBe("/");
    expect(requireMinistryMember).not.toHaveBeenCalled();
    expect(sanityFetch).not.toHaveBeenCalled();
  });

  it("lets an ACTIVE kids member render — no redirect at all", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
    getMemberAccess.mockResolvedValue(memberAccess);
    expect(await visit()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends an active NON-kids member to /", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(null);
    expect(await visit()).toBe("/");
  });

  it("asks specifically for KIDS membership", async () => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
    getMemberAccess.mockResolvedValue(memberAccess);
    await visit();
    expect(requireMinistryMember).toHaveBeenCalledWith("kids");
  });
});

describe("/kids page read", () => {
  beforeEach(() => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
    getMemberAccess.mockResolvedValue(memberAccess);
  });

  it("reads published Sundays only, from local today, through the coalesced projection", async () => {
    await visit();
    const [query, params] = sanityFetch.mock.calls[0];
    expect(query).toContain('_type == "kidsSchedule"');
    expect(query).toContain("published == true");
    expect(query).toContain("coalesce(published, false)");
    expect(query).toContain("date >= $today");
    // Server "today" in America/Mexico_City, never a UTC day.
    expect(params.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.today).toBe(
      new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" }),
    );
  });

  it("drops a row whose date is malformed instead of rendering it", async () => {
    sanityFetch.mockResolvedValue([
      { date: null, ensenanza: { _id: "p1", name: "Ana y Beto", memberIds: ["m1", "m2"] } },
    ]);
    const html = await renderPage();
    expect(html).toContain("Aún no hay domingos publicados");
    expect(html).not.toContain("Ana y Beto");
  });
});

describe("/kids page render", () => {
  beforeEach(() => {
    requireActiveSession.mockResolvedValue(activeSession);
    requireMinistryMember.mockResolvedValue(activeSession);
  });

  const sunday = {
    date: "2026-09-06",
    published: true,
    ensenanza: { _id: "p1", name: "Ana y Beto", memberIds: ["m1", "m2"] },
    chiquitos: { _id: "p2", name: "Caro y Dan", memberIds: ["m3", "m4"] },
    medianos: null,
    grandes: { _id: "p4", name: "Eva y Fito", memberIds: ["m7", "m8"] },
  };

  it('flags the signed-in member\'s own seat with "Te toca" and names the empty one', async () => {
    getMemberAccess.mockResolvedValue(memberAccess);
    sanityFetch.mockResolvedValue([sunday]);
    const html = await renderPage();
    expect(html).toContain("Te toca");
    expect(html).toContain("Enseñanza");
    expect(html).toContain("Ana y Beto");
    expect(html).toContain("Sin asignar"); // the empty `medianos` seat
    // Local noon: 2026-09-06 must render as the 6th, not the 5th.
    expect(html).toContain("6 de septiembre");
  });

  it("does not flag a member who is in no pair that Sunday", async () => {
    getMemberAccess.mockResolvedValue({ ...memberAccess, ministries: ["kids"] });
    requireActiveSession.mockResolvedValue({ user: { ...activeSession.user, sanityId: "m9" } });
    sanityFetch.mockResolvedValue([sunday]);
    const html = await renderPage();
    expect(html).toContain("Ana y Beto");
    expect(html).not.toContain("Te toca");
  });

  it("offers /kids/admin to a kids MANAGER and to nobody else", async () => {
    sanityFetch.mockResolvedValue([]);
    getMemberAccess.mockResolvedValue({ ...memberAccess, managesMinistries: ["kids"] });
    expect(await renderPage()).toContain("Planear Kids");

    getMemberAccess.mockResolvedValue(memberAccess);
    expect(await renderPage()).not.toContain("Planear Kids");
  });
});

/** Renders the page to static markup so copy and highlighting are assertable. */
async function renderPage(): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await KidsPage());
}
