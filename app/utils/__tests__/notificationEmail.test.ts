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
    // The one <style> block is the Outlook dark-mode opt-out, added after Outlook
    // for Mac was observed rewriting #071624 to slate grey. It is enhancement
    // only: this assertion is what guarantees the layout still does not depend on
    // it, since every colour remains inline and on bgcolor.
    expect(html.replace(/<style>[\s\S]*?<\/style>/, "")).not.toContain("<style");
  });

  it("pins the exact movement colours: signal up, amber down, steel dash", () => {
    // before: [x, y, z] → after: [y, x, z] — y moves up, x moves down, z holds.
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [],
      beforeSongs: [song("x", "G"), song("y", "D"), song("z", "A")],
      songs: [song("y", "D"), song("x", "G"), song("z", "A")],
    };
    const withXYZ = new Map([...titles, ["x", "X"], ["y", "Y"], ["z", "Z"]]);
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, withXYZ);
    expect(html).toContain('color:#37F58A">▲1');
    expect(html).toContain('color:#F5B437">▼1');
    expect(html).toContain('color:#7F94A8">&ndash;');
  });

  it("renders NUEVA and SALIÓ chips for an actually added and removed song", () => {
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [],
      beforeSongs: [song("a", "G"), song("b", "D")],
      songs: [song("a", "G"), song("c", "A")],
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).toContain(">NUEVA<");
    expect(html).toContain(">SALIÓ<");
  });

  it("escapes an injected payload in a role label (roleChanged before/after)", () => {
    const line = roleLine("roleChanged", ['<img src=x onerror=alert(1)>'], ["<b>Líder</b>"]);
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<b>Líder</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;Líder&lt;/b&gt;");
  });

  it("escapes an injected payload in lead notes", () => {
    const line: Line = {
      kind: "leadNotes", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [], notes: "<script>alert(2)</script>",
    };
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, titles);
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("shows a non-empty movement cell for every row: up, down, same, new, gone", () => {
    // before: [x, y, z, w] → after: [y, x, z, n]; w departs, n arrives.
    const line: Line = {
      kind: "setlistChanged", serviceDate: "2026-08-09", roleType: "sunday_role",
      before: [], after: [],
      beforeSongs: [song("x", "G"), song("y", "D"), song("z", "A"), song("w", "E")],
      songs: [song("y", "D"), song("x", "G"), song("z", "A"), song("n", "C")],
    };
    const withAll = new Map([...titles, ["x", "X"], ["y", "Y"], ["z", "Z"], ["w", "W"], ["n", "N"]]);
    const { html } = buildGroupedEmail({ name: "Ana", lines: [line] }, withAll);
    // One row per movement kind, and every kind's marker is present exactly
    // once (five songs total: y=up, x=down, z=same, n=new, w=gone).
    expect(html).toContain("▲1");
    expect(html).toContain("▼1");
    expect(html).toContain("&ndash;");
    expect(html).toContain(">NUEVA<");
    expect(html).toContain(">SALIÓ<");
    // No movement <td> is left with an empty cell body.
    expect(html).not.toMatch(/font:13px monospace">\s*<\/td>/);
  });
});
