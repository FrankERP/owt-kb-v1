// `/me` MINISTRY GATING.
//
// The user's requirement for the kids delivery is that a member who is only in
// Oasis Kids "can't see any of the worship sections" (spec §5.1: worship
// surfaces for a kids-only member are "none"). The upcoming-services block used
// to render unconditionally, so such a member got the heading "Mis próximos
// servicios" and the empty state "Sin servicios asignados próximamente" — not a
// data leak (the query is scoped to their own id) but a worship surface, which
// is the thing the acceptance criterion forbids.
//
// This file pins both halves: the section is absent for a kids-only member AND
// the worship READS never run for them. It also pins the deliberate exception —
// the availability calendar's service-date read is NOT ministry-scoped (that is
// separately recorded), so it must keep firing for everyone.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const requireActiveSession = vi.fn();
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSession(),
}));

const getMemberAccess = vi.fn();
vi.mock("@/app/utils/memberAccess", () => ({
  getMemberAccess: (id: string) => getMemberAccess(id),
}));

const serverFetch = vi.fn();
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p: Record<string, unknown>) => serverFetch(q, p) },
}));

const opFetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p: Record<string, unknown>) => opFetch(q, p) },
}));

// None of these are what this test is about; several pull in next-auth/react,
// next/image or browser-only APIs. They are stubbed with a marker so the test can
// still tell whether the surrounding section rendered.
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/NextServiceHero", () => ({ default: () => <p>HERO</p> }));
vi.mock("@/app/components/DayCard", () => ({ DayCard: () => <p>DAYCARD</p> }));
vi.mock("@/app/components/AddToCalendarButton", () => ({ default: () => null }));
vi.mock("@/app/components/AvailabilityCalendar", () => ({ default: () => <p>CALENDARIO</p> }));
vi.mock("@/app/components/ProfilePanel", () => ({ default: () => <p>PERFIL</p> }));
vi.mock("@/app/components/TextSizeControl", () => ({ default: () => null }));
vi.mock("@/app/components/ui/ThemeControl", () => ({ default: () => null }));
vi.mock("@/app/components/ui/ThemeAnnouncement", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { href: string; children?: ReactNode }) => children,
}));

import MePage from "../page";

const session = { user: { role: "member", sanityId: "m1", email: "x@y.z" } };

const access = (ministries: string[]) => ({
  active: true,
  role: "member",
  ministries,
  managesMinistries: [] as string[],
});

/** Every GROQ string the page sent to the operational client this render. */
const queries = () => opFetch.mock.calls.map(([q]) => q as string);

async function renderPage(): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await MePage());
}

beforeEach(() => {
  requireActiveSession.mockReset();
  requireActiveSession.mockResolvedValue(session);
  getMemberAccess.mockReset();
  serverFetch.mockReset();
  serverFetch.mockResolvedValue({ _id: "m1", member_name: "Ana", alias: "Ana" });
  opFetch.mockReset();
  // The multi-query returns an object; the proposal, calendar-date and kids reads
  // return arrays. Keyed off the query text so each read gets its real shape.
  opFetch.mockImplementation(async (q: string) =>
    q.includes('"sundays"') ? { sundays: [], saturdays: [], specials: [] } : [],
  );
});

describe("/me worship gating", () => {
  it("renders no worship section at all for a KIDS-ONLY member", async () => {
    getMemberAccess.mockResolvedValue(access(["kids"]));
    const html = await renderPage();
    expect(html).not.toContain("Mis próximos servicios");
    expect(html).not.toContain("Sin servicios asignados próximamente");
    // The kids half is exactly what they DO get.
    expect(html).toContain("Mis roles en Oasis Kids");
  });

  it("skips the worship READS for a kids-only member instead of discarding them", async () => {
    getMemberAccess.mockResolvedValue(access(["kids"]));
    await renderPage();
    expect(queries().some((q) => q.includes("setlistCandidates"))).toBe(false);
    expect(queries().some((q) => q.includes("setlistProposal"))).toBe(false);
  });

  it("still reads the availability calendar's service dates for a kids-only member", async () => {
    // Deliberately NOT ministry-scoped in this delivery — see the header note.
    getMemberAccess.mockResolvedValue(access(["kids"]));
    await renderPage();
    expect(queries().some((q) => q.includes('_type == "special_role"'))).toBe(true);
  });

  it("renders the worship section, empty state included, for a worship member", async () => {
    getMemberAccess.mockResolvedValue(access(["worship"]));
    const html = await renderPage();
    expect(html).toContain("Mis próximos servicios");
    expect(html).toContain("Sin servicios asignados próximamente");
    expect(html).not.toContain("Mis roles en Oasis Kids");
    expect(queries().some((q) => q.includes("setlistCandidates"))).toBe(true);
    expect(queries().some((q) => q.includes("setlistProposal"))).toBe(true);
  });

  it("gives a member of BOTH ministries both sections", async () => {
    getMemberAccess.mockResolvedValue(access(["worship", "kids"]));
    const html = await renderPage();
    expect(html).toContain("Mis próximos servicios");
    expect(html).toContain("Mis roles en Oasis Kids");
  });

  it("keeps the profile and availability panels for a kids-only member", async () => {
    getMemberAccess.mockResolvedValue(access(["kids"]));
    const html = await renderPage();
    expect(html).toContain("CALENDARIO");
    expect(html).toContain("PERFIL");
  });
});
