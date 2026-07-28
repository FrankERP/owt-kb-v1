// app/utils/__tests__/notificationEmail.test.ts
import { describe, expect, it, vi } from "vitest";

// notificationEmail.ts reuses escapeHtml/appBaseUrl from assignmentEmail.ts,
// which imports the real Sanity client at module scope for its send paths.
// That client asserts NEXT_PUBLIC_SANITY_DATASET/PROJECT_ID at import time
// (sanity/env.ts), so any test that reaches it — even transitively, even
// without calling it — needs the same stub assignmentEmail.test.ts already
// uses.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
// Same reason: assignmentEmail.ts also imports ./email, which imports the
// "server-only" package guard — unresolvable outside a Next.js server build.
vi.mock("../email", () => ({ sendEmail: vi.fn() }));

import { buildGroupedEmail } from "../notificationEmail";
import type { Line } from "../outboxClassify";

const titles = new Map([["a", "Abres Camino"], ["b", "Santo"], ["c", "Digno Es"]]);
const song = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

const roleLine = (kind: Line["kind"], before: string[], after: string[]): Line =>
  ({ kind, serviceDate: "2026-08-09", roleType: "sunday_role", before, after });

describe("buildGroupedEmail", () => {
  it("uses a constant subject plus a date, with nothing interpolated from content", () => {
    const { subject } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(subject).toBe("Nueva asignación — Domingo 9 ago");
    expect(subject).not.toContain("Líder");
  });

  it("switches to the grouped subject for several lines", () => {
    const { subject } = buildGroupedEmail({
      name: "Ana",
      lines: [roleLine("assigned", [], ["Líder"]), roleLine("removed", ["BGV"], [])],
    }, titles);
    expect(subject).toBe("Novedades de tus servicios");
  });

  it("says 'Sirves como', never 'Cantas como'", () => {
    // Three of the five seat paths do not sing.
    const { html } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Bajo"])] }, titles);
    expect(html).toContain("Sirves como");
    expect(html).not.toContain("Cantas");
  });

  it("renders no interpretive prose", () => {
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [song("a", "G")], songs: [song("c", "A"), song("a", "G")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toMatch(/Ahora abren con/);
    expect(html).not.toMatch(/No la ensayes/);
  });

  it("omits the movement column for a first setlist", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [], songs: [song("a", "G")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toContain("Mov.");
  });

  it("shows the movement column and a dash for unmoved rows on a change", () => {
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [],
      beforeSongs: [song("a", "G"), song("b", "D")],
      songs: [song("a", "G"), song("b", "D")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).toContain("Mov.");
    expect(html).toContain("&ndash;");
  });

  it("uses the app's word for a medley and draws a one-song run as a single", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [],
      songs: [song("a", "G", 0), song("b", "D", 0), song("c", "A", 1)],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).toContain("Medley");
    expect(html).not.toContain("Popurr");
    // Group 1 has a single member: rendered plain, so only ONE Medley label.
    expect(html.match(/Medley/g)).toHaveLength(1);
  });

  it("escapes song titles", () => {
    const line: Line = {
      kind: "setlistReady", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], beforeSongs: [], songs: [song("x", "G")],
    };
    const { html } = buildGroupedEmail(
      { name: "Ana", lines: [line] },
      new Map([["x", "<script>alert(1)</script>"]]),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the service date at local noon, never bare", () => {
    // A bare new Date(iso) would flip the day in America/Mexico_City.
    const { subject } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(subject).toContain("9 ago");
  });

  it("puts bgcolor on cells so a dark email survives Gmail and Apple Mail", () => {
    const { html } = buildGroupedEmail({ name: "Ana", lines: [roleLine("assigned", [], ["Líder"])] }, titles);
    expect(html).toContain('bgcolor="#010B17"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("<style");
  });
});
