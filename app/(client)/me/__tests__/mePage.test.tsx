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
// the worship READS never run for them.
//
// R3 F3 MOVED THE CALENDAR OFF THIS PAGE. The availability panel — and with it
// the service-date read that was deliberately NOT ministry-scoped — now lives on
// `/me/disponibilidad` (`disponibilidadPage.test.tsx`). What `/me` keeps is ONE
// link to it, carrying the count of upcoming marked dates, which is why the
// count arithmetic is pinned below: it is the only availability logic left here.
//
// R3 MOVED THE SURFACE, NOT THE RULE. The two `h2`s are gone (the identity header
// is the heading now) and "Sin servicios asignados próximamente" is a line in
// `MeHeader`, not a block in the services column — so the empty-state assertions
// below now prove the HEADER's gating. `MeHeader` is therefore rendered for real
// here rather than stubbed: stubbing it would leave the kids-only case asserting
// nothing.

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
vi.mock("@/app/components/DayCard", () => ({ DayCard: () => <p>HERO</p> }));
vi.mock("@/app/components/DayCardDisclosure", () => ({ default: () => <p>DAYCARD</p> }));
vi.mock("@/app/components/AddToCalendarButton", () => ({ default: () => null }));
// Kept even though F3 moved the settings card to `/me/ajustes`: the marker is
// what makes the "no settings on this page" assertions below mean something —
// without it, `not.toContain("PERFIL")` would pass for any reason at all.
vi.mock("@/app/components/ProfilePanel", () => ({ default: () => <p>PERFIL</p> }));
vi.mock("@/app/components/ui/ThemeAnnouncement", () => ({ default: () => null }));
// The href matters now: the availability link is the whole of what replaced the
// panel, so the mock renders a real anchor rather than swallowing it.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => <a href={href}>{children}</a>,
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
    // A Tipo is a worship eligibility axis — even a member whose profile still
    // carries one (never cleared on a ministry switch) must see no chip for it.
    serverFetch.mockResolvedValue({
      _id: "m1", member_name: "Ana", alias: "Ana", memberType: ["voz", "sunday_lead"],
    });
    const html = await renderPage();
    // R3: the heading is gone for EVERYONE, the empty line only for this member.
    expect(html).not.toContain("Mis próximos servicios");
    expect(html).not.toContain("Sin servicios asignados próximamente");
    // The identity header still renders — it is the page, not a worship surface.
    expect(html).toContain("Ana");
    // Tipo chips are worship copy: fixture 1 rules a kids-only member sees none,
    // even though the stored `memberType` is non-empty.
    expect(html).not.toContain("Líder Domingo");
    expect(html).not.toContain("Voz");
    // The kids half is exactly what they DO get.
    expect(html).toContain("Mis roles en Oasis Kids");
  });

  it("skips the worship READS for a kids-only member instead of discarding them", async () => {
    getMemberAccess.mockResolvedValue(access(["kids"]));
    await renderPage();
    expect(queries().some((q) => q.includes("setlistCandidates"))).toBe(false);
    expect(queries().some((q) => q.includes("setlistProposal"))).toBe(false);
  });

  it("no longer reads the availability calendar's service dates — that read moved with the calendar", async () => {
    // F3: the dates feed the grid, and the grid is `/me/disponibilidad` now. A
    // kids-only member used to pay for this read here for a panel below.
    getMemberAccess.mockResolvedValue(access(["kids"]));
    await renderPage();
    expect(queries().some((q) => q.includes('_type == "special_role"'))).toBe(false);
  });

  it("renders the worship section, empty state included, for a worship member", async () => {
    getMemberAccess.mockResolvedValue(access(["worship"]));
    const html = await renderPage();
    // R3: the `h2` is gone (the header is the heading) and the empty state is the
    // header's LINE. A worship member with nothing assigned gets no services
    // column at all — the header already said it, once.
    expect(html).not.toContain("Mis próximos servicios");
    expect(html).toContain("Sin servicios asignados próximamente");
    expect(html).not.toContain("Mis roles en Oasis Kids");
    expect(queries().some((q) => q.includes("setlistCandidates"))).toBe(true);
    expect(queries().some((q) => q.includes("setlistProposal"))).toBe(true);
  });

  it("gives a member of BOTH ministries both sections", async () => {
    getMemberAccess.mockResolvedValue(access(["worship", "kids"]));
    const html = await renderPage();
    // R3: the worship half is now the header's line (the `h2` is gone).
    expect(html).toContain("Sin servicios asignados próximamente");
    expect(html).toContain("Mis roles en Oasis Kids");
  });

  // DUAL-MINISTRY PRECEDENCE (fix round 1, ruling 6): the header's ONE line
  // picks the nearest of ANY ministry, not "worship first if the member is in
  // it". A worship member with nothing of their own assigned this week, but a
  // Kids Sunday coming up, sees the Kids line — not the worship empty state,
  // which would bury real news under a line that says nothing happened.
  it("gives a dual-ministry member with no worship assignment the KIDS line, not the worship empty state", async () => {
    getMemberAccess.mockResolvedValue(access(["worship", "kids"]));
    opFetch.mockImplementation(async (q: string) => {
      if (q.includes('"sundays"')) return { sundays: [], saturdays: [], specials: [] };
      if (q.includes('_type == "kidsSchedule"')) return [{ date: "2026-09-13", ensenanza: true }];
      return [];
    });
    const html = await renderPage();
    expect(html).toContain("En Oasis Kids te toca el");
    expect(html).not.toContain("Sin servicios asignados próximamente");
  });

  it("keeps the availability link for a kids-only member, and holds no settings at all", async () => {
    // F3: Tema, Tamaño de texto and Perfil are `/me/ajustes` now, reached from the
    // avatar menu. `/me` answers "who am I and when do I serve" and nothing else,
    // so the settings card must not be here for ANY member.
    getMemberAccess.mockResolvedValue(access(["kids"]));
    const html = await renderPage();
    expect(html).toContain('href="/me/disponibilidad"');
    expect(html).toContain("Sin fechas marcadas");
    expect(html).not.toContain("PERFIL");
    expect(html).not.toContain('id="ajustes"');
  });

  it("counts only UPCOMING unavailable dates on the link", async () => {
    // A member who marked dates years ago must not read "3 fechas marcadas"
    // forever: the count answers "what have I told the team about from here on".
    getMemberAccess.mockResolvedValue(access(["worship"]));
    const iso = (plusDays: number) =>
      new Date(Date.now() + plusDays * 86400 * 1000)
        .toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
    serverFetch.mockResolvedValue({
      _id: "m1", member_name: "Ana", alias: "Ana",
      unavailableDates: ["2020-01-01", iso(2), iso(9)],
    });
    const html = await renderPage();
    expect(html).toContain("2 fechas marcadas");
  });

  it("says «1 fecha marcada» in the singular", async () => {
    getMemberAccess.mockResolvedValue(access(["worship"]));
    const iso = new Date(Date.now() + 3 * 86400 * 1000)
      .toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
    serverFetch.mockResolvedValue({
      _id: "m1", member_name: "Ana", alias: "Ana", unavailableDates: [iso],
    });
    const html = await renderPage();
    expect(html).toContain("1 fecha marcada");
    expect(html).not.toContain("1 fechas marcadas");
  });

  it("renders the page without crashing when memberType is null (Sanity null for unset array)", async () => {
    // The dev-verify bot has memberType: null in production — a legitimate state.
    // The page must render and pass the heading to MeHeader without throwing.
    getMemberAccess.mockResolvedValue(access(["worship"]));
    serverFetch.mockResolvedValue({
      _id: "m1", member_name: "Dev Verificador", alias: "Verificador",
      memberType: null,
    });
    const html = await renderPage();
    // MeHeader renders the name, not an error.
    expect(html).toContain("Dev Verificador");
    expect(html).toContain("Sin servicios asignados próximamente");
    // No error boundary or exception text.
    expect(html).not.toContain("Algo salió mal");
  });

  // Both panels hang off the same member read, and both used to be gated on
  // their own `member &&`. A null read therefore removed two thirds of this
  // page's controls without a word, on a page that otherwise rendered fine — so
  // it read as a feature the member does not have, not as something that
  // failed. Every signed-in member has a document; null means the read missed.
  it("says so when the member read comes back empty, instead of dropping the link without a word", async () => {
    getMemberAccess.mockResolvedValue(access(["worship"]));
    serverFetch.mockResolvedValue(null);
    const html = await renderPage();

    expect(html).not.toContain('href="/me/disponibilidad"');
    expect(html).not.toContain("PERFIL");
    expect(html).toContain("No pudimos cargar tu perfil");
    // Not asserting a live-region role: this is server-rendered and present at
    // first paint, so there is nothing being inserted for one to announce.
    // The rest of the page is unaffected — this is not a whole-page failure: the
    // header still renders (R3 falls its name back to the session). The settings
    // card is not part of "the rest" any more: F3 moved it to `/me/ajustes`,
    // which renders its own device-local half on a failed read.
    expect(html).toContain("Sin servicios asignados próximamente");
    expect(html).not.toContain('id="ajustes"');
  });
});
