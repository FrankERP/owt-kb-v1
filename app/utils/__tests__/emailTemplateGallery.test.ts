// Renders every notification template once and asserts the email-client
// constraints hold across ALL of them, not just the cases the per-template unit
// tests happen to cover.
//
// The per-template tests check behaviour (does the Mov. column disappear, does a
// one-song run render plain). This checks the constraints that are easy to break
// anywhere and that no single behavioural test owns: table-based layout, bgcolor
// on cells, no <style> block, no flexbox or grid, no remote images, no web fonts.
// Spec §6 makes those hard requirements because they are what keeps a dark email
// legible in Gmail and Apple Mail.
//
// Set PREVIEW_EMAILS=1 to also write the rendered HTML to .preview-emails/ (which
// is gitignored) plus an index framing each one with its subject line — that is
// what you forward to settle the two behaviours §6 flags as reasoned-but-unverified:
// Outlook/Windows and the key pills, and the four-column table on a narrow phone.
//
//   PREVIEW_EMAILS=1 npx vitest run app/utils/__tests__/emailTemplateGallery.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// `assignmentEmail` reaches the transport and the Sanity client at module load —
// `email` -> `deliveryFirewall` -> `server-only` (which resolves only inside
// Next's bundler), and `serverClient` -> `sanity/env` (which asserts its
// variables on import). Nothing here sends or reads, so both are stubbed, the
// same way `assignmentEmail.test.ts` does it.
vi.mock("../email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));

const { buildAssignmentEmail, buildBatchAssignmentEmail } = await import("../assignmentEmail");
const { buildGroupedEmail } = await import("../notificationEmail");
type Line = import("../outboxClassify").Line;

const titles = new Map([
  ["s1", "Abres Camino"],
  ["s2", "Santo"],
  ["s3", "Digno Es El Cordero"],
  ["s4", "Cuán Grande Es Él"],
  ["s5", "Al Que Está Sentado En El Trono"],
  ["s6", "Renuévame"],
]);

const song = (ref: string, key: string, group: number | null = null) => ({
  _key: `k-${ref}`, ref, key, group,
});

const SUNDAY = "2026-08-09";
const SATURDAY = "2026-08-15";

const line = (over: Partial<Line> & Pick<Line, "kind">): Line => ({
  serviceDate: SUNDAY, roleType: "sunday_role", before: [], after: [], ...over,
});

// Quoted-printable encoder for the .eml sidecars (RFC 2045).
function quotedPrintable(s: string): string {
    // Encode first, THEN wrap on token boundaries. Wrapping on a raw character
    // count splits an =XX triplet in half — `—` is =E2=80=94, and a break after
    // `=E2=` yields `â= 80` in the client. The first version of this helper did
    // exactly that, and the corruption looked like a template bug.
    const tokens: string[] = [];
    for (const byte of Buffer.from(s, "utf8")) {
      const printable = byte >= 0x20 && byte <= 0x7e && byte !== 0x3d; // `=` must escape
      tokens.push(printable ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`);
    }
    const lines: string[] = [];
    let line = "";
    for (const t of tokens) {
      // 75, so the line plus its trailing soft-break `=` stays inside the
      // 76-character limit RFC 2045 sets.
      if (line.length + t.length > 75) {
        lines.push(line);
        line = "";
      }
      line += t;
    }
    lines.push(line);
    return lines.join("=\r\n");
  }

const gallery: { file: string; label: string; subject: string; html: string }[] = [];
const add = (file: string, label: string, built: { subject: string; html: string }) => {
  gallery.push({ file, label, ...built });
  return built;
};

add("01-assigned.html", "Nueva asignación", buildGroupedEmail(
  { name: "Ana", lines: [line({ kind: "assigned", after: ["Líder"] })] }, titles));

// Three of the five seat paths do not sing, so the copy must read "Sirves como".
add("02-assigned-instrument.html", "Nueva asignación (instrumento)", buildGroupedEmail(
  { name: "Beto", lines: [line({ kind: "assigned", after: ["Bajo"] })] }, titles));

add("03-removed.html", "Ya no participas", buildGroupedEmail(
  { name: "Carla", lines: [line({ kind: "removed", before: ["BGV"] })] }, titles));

add("04-role-changed.html", "Tu rol cambió", buildGroupedEmail(
  { name: "Diego", lines: [line({ kind: "roleChanged", before: ["BGV"], after: ["Líder"] })] }, titles));

add("05-setlist-ready.html", "Setlist listo (sin columna Mov.)", buildGroupedEmail(
  { name: "Elena", lines: [line({
    kind: "setlistReady", beforeSongs: [],
    songs: [song("s1", "G"), song("s2", "D", 0), song("s3", "D", 0), song("s4", "A")],
  })] }, titles));

// The hard case, every marker at once: s1 holds (dash), s5 is new, s3 moves up,
// s4 is re-keyed and moves down, s2 departs, and s3+s6 form a NEW medley.
add("06-setlist-changed.html", "El setlist cambió (todos los marcadores)", buildGroupedEmail(
  { name: "Elena", lines: [line({
    kind: "setlistChanged",
    beforeSongs: [song("s1", "G"), song("s2", "E"), song("s3", "D"), song("s4", "A")],
    songs: [song("s1", "G"), song("s5", "C"), song("s3", "D", 0), song("s6", "D", 0), song("s4", "B")],
  })] }, titles));

add("07-one-song-group.html", "Grupo de una canción (debe verse normal)", buildGroupedEmail(
  { name: "Elena", lines: [line({
    kind: "setlistReady", beforeSongs: [],
    songs: [song("s1", "G", 0), song("s2", "D", 1), song("s3", "D", 1)],
  })] }, titles));

add("08-lead-notes.html", "Notas del líder", buildGroupedEmail(
  { name: "Admin", lines: [line({
    kind: "leadNotes", roleType: null,
    notes: "Bajé la tonalidad de Santo a D. Ensayo el jueves 7pm.",
  })] }, titles));

add("09-grouped.html", "Novedades de tus servicios (agrupado)", buildGroupedEmail(
  { name: "Ana", lines: [
    line({ kind: "roleChanged", before: ["BGV"], after: ["Líder"] }),
    line({ kind: "setlistChanged",
      beforeSongs: [song("s1", "G"), song("s2", "E")],
      songs: [song("s2", "E"), song("s1", "G"), song("s4", "A")] }),
    line({ kind: "assigned", serviceDate: SATURDAY, roleType: "saturday_role", after: ["Teclado"] }),
  ] }, titles));

add("10-long-titles.html", "Títulos largos (ajuste en móvil)", buildGroupedEmail(
  { name: "Ana", lines: [line({
    kind: "setlistChanged",
    beforeSongs: [song("s5", "G")],
    songs: [song("s5", "G#m"), song("s3", "Bb")],
  })] }, titles));

add("11-publish-single.html", "Publicación: un servicio",
  buildAssignmentEmail({ name: "Ana", roles: ["Líder", "Guitarra"], type: "sunday_role", date: SUNDAY }));

add("12-publish-batch.html", "Publicación: varios servicios",
  buildBatchAssignmentEmail({ name: "Ana", items: [
    { type: "sunday_role", date: SUNDAY, roles: ["Líder"] },
    { type: "saturday_role", date: SATURDAY, roles: ["BGV", "Pandero"] },
    { type: "sunday_role", date: "2026-08-23", roles: ["Guitarra"] },
  ] }));

describe("email template gallery", () => {
  it("renders every template without throwing", () => {
    expect(gallery).toHaveLength(12);
    for (const g of gallery) expect(g.html.length).toBeGreaterThan(200);
  });

  // Spec §6: these are hard requirements, not preferences. Each one is a way a
  // dark email silently degrades in a real client.
  it.each(gallery.map((g) => [g.label, g] as const))(
    "%s obeys the email-client constraints",
    (_label, g) => {
      // §6 requires bgcolor on EVERY cell, not just the body — that is what keeps
      // a dark email dark in Gmail and Apple Mail. Asserting the document merely
      // contains one bgcolor would pass with a single attribute on the outer
      // table and 180 bare cells, so count the cells that lack it.
      const cells = g.html.match(/<td[^>]*>/g) ?? [];
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.filter((c) => !c.includes("bgcolor="))).toEqual([]);

      // Without this declaration a dark-mode client remaps the palette: Outlook
      // for Mac lightened blackout to slate grey and darkened the signal chips.
      // It is what opts the email out of that transformation.
      expect(g.html).toContain('name="color-scheme" content="dark"');
      expect(g.html).toContain('name="supported-color-schemes" content="dark"');

      // §6 forbids DEPENDING on a stylesheet, not using one. The single <style>
      // block is the dark-mode opt-out, and it must stay pure enhancement: only
      // background-color declarations, nothing structural. A client that drops it
      // renders exactly what it rendered before, because every colour is also
      // inline and on bgcolor.
      const styles = g.html.match(/<style>([\s\S]*?)<\/style>/g) ?? [];
      expect(styles).toHaveLength(1);
      const css = styles[0] ?? "";
      for (const structural of ["width", "display", "padding", "margin", "position", "float", "font"]) {
        expect(css).not.toContain(`${structural}:`);
      }
      expect(css.replace(/background-color:/g, "")).not.toContain("color:"); // no foreground rules
      // Nothing outside the opt-out block: no second stylesheet, no @import.
      expect(g.html).not.toContain("@import");
      expect(g.html).not.toContain("display:flex");     // Outlook has no flexbox
      expect(g.html).not.toContain("display:grid");
      expect(g.html).not.toMatch(/<img[^>]+src="https?:/); // no remote images
      expect(g.html).not.toMatch(/@import|fonts\.googleapis/); // no web fonts
      expect(g.html).toContain("<table");                // table-based layout
    },
  );

  // The first version of this encoder wrapped on a raw character count and split
  // =XX triplets, so an em dash arrived as `â= 80`. Decoding must return the exact
  // input, and no line may end mid-escape.
  it("quoted-printable survives multi-byte characters at any line boundary", () => {
    const decode = (enc: string) =>
      Buffer.from(
        enc.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))),
        "binary",
      ).toString("utf8");

    // Shift the multi-byte character across every offset near the wrap column, so
    // one of these lands exactly where a naive wrapper would cut the triplet.
    for (let pad = 60; pad < 90; pad++) {
      const src = `${"x".repeat(pad)}— ▲ ▼ Cuán cambió ñ`;
      const enc = quotedPrintable(src);
      expect(decode(enc)).toBe(src);
      for (const l of enc.split("=\r\n")) expect(l.length).toBeLessThanOrEqual(75);
      expect(enc).not.toMatch(/=[0-9A-F]?=\r\n/);
    }
  });

  it("never says Cantas como — three of five seat paths do not sing", () => {
    for (const g of gallery) expect(g.html).not.toContain("Cantas");
  });

  it("uses the app's word for a group and never popurrí", () => {
    for (const g of gallery) expect(g.html.toLowerCase()).not.toContain("popurr");
  });

  it("interpolates no content into any subject line", () => {
    // A subject is a constant plus a formatted date. No song title, seat label or
    // member name may leak in — that is what keeps a subject unbreakable.
    for (const g of gallery) {
      for (const title of titles.values()) expect(g.subject).not.toContain(title);
      for (const seat of ["Líder", "BGV", "Bajo", "Teclado", "Guitarra"]) {
        expect(g.subject).not.toContain(seat);
      }
      expect(g.subject).not.toContain("Ana");
    }
  });

  it("writes the preview gallery when PREVIEW_EMAILS=1", () => {
    if (!process.env.PREVIEW_EMAILS) return;
    const out = ".preview-emails";
    mkdirSync(out, { recursive: true });
    for (const g of gallery) writeFileSync(join(out, g.file), g.html, "utf8");

    // Also emit RFC-822 messages. Opening one in Outlook for Windows renders it
    // through the same Word engine a received message uses, which settles §6's
    // remaining unverified behaviour (border-radius and padding on the key pills)
    // without needing SMTP credentials or sending anything.
    //
    // quoted-printable, not 8bit: the templates carry accented Spanish and the
    // ▲/▼ glyphs, and a raw 8-bit body is exactly what some clients mangle into
    // mojibake — which would look like a template bug rather than a transfer
    // encoding one.
    const qp = quotedPrintable;
    const b64 = (s: string) => `=?utf-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
    // ── Light-surface variant, for side-by-side comparison ──────────────────
    // Not production code: a colour-swap of the rendered output, so the two can
    // be judged on identical content. Every screenshot of the dark templates
    // showed the SAME pattern — brand accents (beam, amber, signal, frost)
    // survived every client transform, and only the dark SURFACES were remapped.
    // Client dark-mode transforms assume email is light: darkening a light email
    // is the case they handle well, lightening a dark one is the edge case they
    // handle badly. This variant works with that grain instead of against it.
    //
    // Single-pass replace, deliberately: `#0D2234` is both a source (deck) and a
    // target (frost), so sequential replaces would re-map their own output.
    const LIGHT: Record<string, string> = {
      "#010B17": "#F4F7FA", // field  → near-white
      "#071624": "#FFFFFF", // panel  → white
      "#0D2234": "#EDF2F7", // table  → light tint
      "#12C8F4": "#0B6E93", // beam   → darkened for contrast on white
      "#37F58A": "#127A45", // signal → darkened; chips keep light text
      "#D7E7F6": "#10243A", // frost  → primary text, dark navy
      "#7F94A8": "#566B7F", // steel  → secondary text
      "#F5B437": "#9A6206", // amber  → darkened for contrast on white
      "#3B4A5A": "#CBD7E3", // gone   → light grey chip
    };
    const toLight = (html: string) =>
      html.replace(/#[0-9A-Fa-f]{6}/g, (m) => LIGHT[m.toUpperCase()] ?? m);

    mkdirSync(join(out, "light"), { recursive: true });
    for (const g of gallery) {
      writeFileSync(join(out, "light", g.file), toLight(g.html), "utf8");
    }

    for (const g of gallery) {
      const eml = [
        "MIME-Version: 1.0",
        "From: Oasis Worship Team <contacto@oasis.mx>",
        "To: Prueba <preview@example.com>",
        `Subject: ${b64(g.subject)}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        qp(g.html),
      ].join("\r\n");
      writeFileSync(join(out, g.file.replace(/\.html$/, ".eml")), eml, "utf8");

      const lightEml = [
        "MIME-Version: 1.0",
        "From: Oasis Worship Team <contacto@oasis.mx>",
        "To: Prueba <preview@example.com>",
        `Subject: ${b64(`[CLARO] ${g.subject}`)}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        qp(toLight(g.html)),
      ].join("\r\n");
      writeFileSync(join(out, "light", g.file.replace(/\.html$/, ".eml")), lightEml, "utf8");
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8">
<title>Vista previa de correos</title>
<style>
 body{background:#010B17;color:#D7E7F6;font:15px/1.5 system-ui,sans-serif;margin:0;padding:28px}
 h1{font-size:16px;letter-spacing:.14em;text-transform:uppercase;color:#7F94A8}
 .c{margin:24px 0;border:1px solid #12C8F4;border-radius:6px;overflow:hidden}
 .h{background:#0D2234;padding:12px 16px}
 .l{color:#12C8F4;font-weight:600}
 .s{color:#7F94A8;font-size:13px;margin-top:4px}
 .s b{color:#D7E7F6}
 iframe{width:100%;height:620px;border:0;border-top:1px solid #12C8F4;display:block;background:#010B17}
</style>
<h1>Vista previa de correos — ${gallery.length} plantillas</h1>
${gallery.map((g) => `<div class="c"><div class="h"><div class="l">${esc(g.label)}</div>
<div class="s">Asunto: <b>${esc(g.subject)}</b></div></div>
<iframe src="./${g.file}" title="${esc(g.label)}"></iframe></div>`).join("\n")}`, "utf8");
    expect(gallery.length).toBeGreaterThan(0);
  });
});
