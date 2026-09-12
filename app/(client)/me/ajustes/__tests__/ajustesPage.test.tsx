// `/me/ajustes` — Tema, Tamaño de texto and Perfil on their own page (R3 F3).
//
// MINISTRY-NEUTRAL, like `/me/disponibilidad`: a theme, a text size and an email
// address belong to the person, not to a ministry, so a kids-only volunteer gets
// the whole card. The page reads no ministry at all, which is pinned below by
// asserting `getMemberAccess` is never called — an accidental gate here would
// lock a kids volunteer out of changing their own password.
//
// The mocks mirror `disponibilidadPage.test.tsx`: this is a Server Component, so
// it is awaited and rendered to static markup, and each client child of
// `SettingsCard` is stubbed with the marker the assertions look for (the real
// ones need a session, `localStorage` and a browser; their own behaviour is
// pinned in `settingsCard.test.tsx`, `themeControl.test.tsx` and
// `profilePanel.test.tsx`).

import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

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

vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/ui/ThemeControl", () => ({
  default: () => <section id="tema"><h3 id="tema-h">Tema</h3></section>,
}));
vi.mock("@/app/components/TextSizeControl", () => ({ default: () => <p>Tamaño de texto</p> }));
vi.mock("@/app/components/ProfilePanel", () => ({ default: () => <p>PERFIL</p> }));

import AjustesPage from "../page";

const session = { user: { role: "member", sanityId: "m1", email: "x@y.z", name: "Ana" } };

const profile = {
  _id: "m1",
  _rev: "rev-1",
  member_name: "Ana Torres",
  alias: "Ana",
  email: "ana@example.com",
  role: "member",
  hasPassword: true,
};

async function renderPage(): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await AjustesPage());
}

beforeEach(() => {
  redirect.mockReset();
  requireActiveSession.mockReset();
  requireActiveSession.mockResolvedValue(session);
  getMemberAccess.mockReset();
  serverFetch.mockReset();
  serverFetch.mockResolvedValue(profile);
});

describe("/me/ajustes", () => {
  it("sends an unauthenticated visitor to sign-in with ITS OWN callbackUrl", async () => {
    requireActiveSession.mockResolvedValue(null);
    // `redirect` is mocked, so the page keeps going; the assertion is the call.
    await renderPage().catch(() => "");
    expect(redirect).toHaveBeenCalledWith("/auth/signin?callbackUrl=/me/ajustes");
  });

  it("gives a KIDS-ONLY member the whole card, without reading a ministry", async () => {
    const html = await renderPage();
    expect(html).toContain('id="ajustes"');
    expect(html).toContain('id="tema"');
    expect(html).toContain("Tamaño de texto");
    expect(html).toContain("Perfil");
    expect(html).toContain("PERFIL");
    // No worship copy anywhere: this page answers "my settings", not "my week".
    expect(html).not.toContain("Sin servicios asignados próximamente");
    expect(html).not.toContain("Mis roles en Oasis Kids");
    // The gate is the session, never the ministry — nothing here is scoped to one.
    expect(getMemberAccess).not.toHaveBeenCalled();
  });

  it("says so when the member read comes back empty, and still renders the device-local settings", async () => {
    // Tema and Tamaño de texto survive a failed profile read: the first PATCHes
    // and reports its own failure, the second is device-local. Perfil cannot —
    // there is nothing to edit without a profile.
    serverFetch.mockResolvedValue(null);
    const html = await renderPage();
    expect(html).toContain("No pudimos cargar tu perfil");
    expect(html).toContain('id="ajustes"');
    expect(html).toContain('id="tema"');
    expect(html).toContain("Tamaño de texto");
    expect(html).not.toContain("PERFIL");
  });

  it("reads the profile fields ProfilePanel edits, and no availability", async () => {
    await renderPage();
    const [query, params] = serverFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toEqual({ id: "m1" });
    for (const field of ["email", "role", "notifPrefs", "photoUrl", "hasPassword"]) {
      expect(query).toContain(field);
    }
    // The calendar's fields belong to `/me/disponibilidad`.
    expect(query).not.toContain("unavailableDates");
    expect(query).not.toContain("unavailabilityNotes");
  });
});
