// `/me/disponibilidad` — the calendar on its own page (R3 F3).
//
// The page is MINISTRY-NEUTRAL by design: marking the days you cannot serve is
// not a worship surface, so a kids-only volunteer reaches it and gets the whole
// calendar. That is the opposite default from `/me`'s services column, which is
// why it is pinned here rather than assumed — the previous home of this calendar
// (`/me`) carries a test saying its service-date read is deliberately NOT
// ministry-scoped, and that exemption travelled with the calendar.
//
// The mocks mirror `mePage.test.tsx`: this is a Server Component, so it is
// awaited and rendered to static markup, and everything it renders that needs a
// browser is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const requireActiveSession = vi.fn();
vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => requireActiveSession(),
}));

// Mocked so the kids-only case can assert it is NEVER called: this page reads no
// ministry at all, and an accidental gate here would be invisible otherwise.
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

vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
// The panel is the calendar's host; it is a client component with a real drag
// surface, so it is marked rather than rendered. Its own behaviour is pinned in
// `myAvailabilityPanel.test.tsx` and `availabilityCalendarConflict.test.tsx`.
vi.mock("@/app/components/availability/MyAvailabilityPanel", () => ({
  default: () => <p>Seleccionar fechas</p>,
}));

import DisponibilidadPage from "../page";

const session = { user: { role: "member", sanityId: "m1", email: "x@y.z", name: "Ana" } };

async function renderPage(): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await DisponibilidadPage());
}

beforeEach(() => {
  redirect.mockReset();
  requireActiveSession.mockReset();
  requireActiveSession.mockResolvedValue(session);
  getMemberAccess.mockReset();
  serverFetch.mockReset();
  serverFetch.mockResolvedValue({ _id: "m1", _rev: "rev-1", member_name: "Ana", alias: "Ana" });
  opFetch.mockReset();
  opFetch.mockResolvedValue([]);
});

describe("/me/disponibilidad", () => {
  it("sends an unauthenticated visitor to sign-in with ITS OWN callbackUrl", async () => {
    requireActiveSession.mockResolvedValue(null);
    // `redirect` is mocked, so the page keeps going; the assertion is the call.
    await renderPage().catch(() => "");
    expect(redirect).toHaveBeenCalledWith("/auth/signin?callbackUrl=/me/disponibilidad");
  });

  it("gives a KIDS-ONLY member the calendar, with no worship copy", async () => {
    const html = await renderPage();
    expect(html).toContain("Seleccionar fechas");
    expect(html).toContain("Disponibilidad");
    expect(html).not.toContain("Mis próximos servicios");
    expect(html).not.toContain("Sin servicios asignados próximamente");
    expect(html).not.toContain("Mis roles en Oasis Kids");
    // The gate is the session, never the ministry.
    expect(getMemberAccess).not.toHaveBeenCalled();
  });

  it("says so when the member read comes back empty, instead of a calendar that cannot save", async () => {
    // No `_rev` means no save precondition: a calendar rendered here would take
    // edits and then 400 on every attempt to keep them.
    serverFetch.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain("No pudimos cargar tu perfil");
    expect(html).not.toContain("Seleccionar fechas");
  });

  it("reads the service dates over the CDMX horizon it computed", async () => {
    await renderPage();
    const call = opFetch.mock.calls.find(([q]) => (q as string).includes('_type == "special_role"'));
    expect(call).toBeTruthy();
    const params = call![1] as { today: string; limit: string };
    expect(params.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.limit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.limit > params.today).toBe(true);
    // A year ahead, not a week: the grid offers twelve months. Computed with the
    // same expression `horizon()` uses rather than "next calendar year" — on 1
    // January of a year following a leap year the two disagree.
    const expectedLimit = new Date(Date.now() + 365 * 86400 * 1000)
      .toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
    expect(params.limit).toBe(expectedLimit);
  });

  it("never drops the revision the save is guarded by", async () => {
    await renderPage();
    const [query] = serverFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain("_rev");
  });
});
