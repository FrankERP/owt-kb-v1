// app/utils/emailShell.ts
// The dark on-brand table shell shared by every transactional email
// (assignment, notification-outbox, proposal). Extracted from
// assignmentEmail.ts/notificationEmail.ts (Task 7 review, finding 1) so the
// palette, cell helpers, and outer shell exist in exactly one place — no
// hand-copied "same shell" to keep in sync by hand.
//
// This module imports nothing from assignmentEmail.ts or notificationEmail.ts
// (and must stay that way): both of those import FROM here, so an import back
// the other way would cycle. `shell()` therefore takes the footer link as a
// parameter instead of computing it itself via `appBaseUrl()`.

// Palette from app/brand.css, plus the two approved non-token colours: amber
// for downward setlist movement (red would read as an error), and gone for
// struck-through/departed rows.
export const C = {
  blackout: "#010B17",
  console: "#071624",
  deck: "#0D2234",
  beam: "#12C8F4",
  signal: "#37F58A",
  frost: "#D7E7F6",
  steel: "#7F94A8",
  amber: "#F5B437",
  gone: "#3B4A5A",
} as const;

/**
 * A 1×1 opaque GIF of one palette colour, as a `data:` URI.
 *
 * This exists because a dark-mode rewriter substitutes colour VALUES — it does
 * not repaint pixels. Outlook for Mac's dark mode rewrites `bgcolor`, inline
 * `background`, and stylesheet rules alike, which is why every cascade-level
 * fix failed: by render time our colour is no longer in the document. An image
 * is not a colour value, so there is nothing for it to substitute.
 *
 * `data:` rather than a hosted URL on purpose — §6 forbids remote images, which
 * are blocked by default in roughly half of clients. A data URI is inert, adds
 * ~60 bytes per use, and needs no origin.
 *
 * Safe to fail: it is applied through the HTML `background` attribute ALONGSIDE
 * `bgcolor` and the inline `background`, never instead of them. A client that
 * ignores or strips it renders exactly what it renders today.
 */
const gifCache = new Map<string, string>();
export function solidBackgroundGif(hex: string): string {
  const cached = gifCache.get(hex);
  if (cached) return cached;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const uri = `data:image/gif;base64,${Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00,             // 1×1
    0x80, 0x00, 0x00,                   // global colour table, 2 entries
    r!, g!, b!,                          // colour 0 — the one that paints
    0x00, 0x00, 0x00,                   // colour 1, unused
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
    0x02, 0x01, 0x44, 0x00,             // LZW: min code size, block, data, terminator
    0x3b,                                // trailer
  ]).toString("base64")}`;
  gifCache.set(hex, uri);
  return uri;
}

export function td(inner: string, opts: { bg?: string; align?: string; colspan?: number; style?: string } = {}): string {
  const bg = opts.bg ?? C.console;
  const align = opts.align ? ` align="${opts.align}"` : "";
  const colspan = opts.colspan ? ` colspan="${opts.colspan}"` : "";
  // The data URI goes on the `background` ATTRIBUTE, never inside `style`. A
  // data URI contains `;` and `,`, and a naive client parser that splits a style
  // attribute on `;` would break every declaration after it — trading one
  // client's dark mode for broken styling everywhere.
  return `<td bgcolor="${bg}"${align}${colspan} background="${solidBackgroundGif(bg)}" style="background:${bg};${opts.style ?? ""}">${inner}</td>`;
}

export function tr(inner: string): string {
  return `<tr>${inner}</tr>`;
}

// `link` is the "Ajustar mis avisos →" footer destination — every caller
// currently passes `${appBaseUrl()}/me`.
export function shell(bodyRows: string, link: string): string {
  const eyebrow = tr(td(
    `<span style="font:700 11px system-ui,sans-serif;letter-spacing:.24em;color:${C.beam}">OASIS WORSHIP TEAM</span>`,
    { style: "padding:24px 24px 4px" },
  ));
  const footer = tr(td(
    `<p style="margin:0 0 6px;font:12px system-ui,sans-serif;color:${C.steel}">Recibes esto porque sirves en el equipo de alabanza de Oasis.</p>` +
    `<a href="${link}" style="font:12px system-ui,sans-serif;color:${C.beam};text-decoration:none">Ajustar mis avisos →</a>`,
    { style: `padding:16px 24px 24px;border-top:1px solid ${C.deck}` },
  ));
  const body =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.blackout}" background="${solidBackgroundGif(C.blackout)}" style="background:${C.blackout};margin:0;padding:0">` +
    tr(td(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.console}" background="${solidBackgroundGif(C.console)}" style="max-width:600px;background:${C.console};border-collapse:collapse">` +
      eyebrow + bodyRows + footer +
      `</table>`,
      { align: "center", style: "padding:24px 12px" },
    )) +
    `</table>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="color-scheme" content="dark">` +
    `<meta name="supported-color-schemes" content="dark">` +
    darkModeOptOut() +
    `</head><body style="margin:0;padding:0;background:${C.blackout}">` +
    body +
    `</body></html>`
  );
}

/**
 * Holds the palette against clients that rewrite dark email into their own
 * theme. Verified in Outlook for Mac: `#071624` rendered as slate grey, which
 * flattened every surface to a single tone and destroyed the depth the layout
 * relies on — in BOTH states of Outlook's per-message light/dark toggle, so it
 * is an unconditional transform rather than part of the dark-mode pass. The
 * `color-scheme` meta above does not stop it; Microsoft's `data-ogs*` mechanism
 * is the only documented opt-out.
 *
 * §6 forbids depending on a `<style>` block, and this does not create one: every
 * colour is still carried inline AND on a `bgcolor` attribute, so a client that
 * drops this block renders exactly what it rendered before. It is pure
 * enhancement — the rules only ever restate a value the element already has.
 *
 * Generated from `C` rather than hand-written, so a palette change cannot leave
 * a stale override behind. `[data-ogsb]`/`[data-ogsc]` are the attributes
 * Outlook stamps on elements whose background/colour it rewrote; the bare
 * attribute selectors cover clients that transform without stamping.
 */
function darkModeOptOut(): string {
  const rules = Object.values(C).flatMap((hex) => [
    `[bgcolor="${hex}"]{background-color:${hex}!important}`,
    `[data-ogsb][bgcolor="${hex}"]{background-color:${hex}!important}`,
    `[data-ogsc][bgcolor="${hex}"]{background-color:${hex}!important}`,
    // The NUEVA/SALIÓ/NUEVO chips carry their fill inline with no bgcolor
    // attribute, and they were the other casualty — signal green came back dark.
    // Matching on `background:` is safe because it cannot also match
    // `background-color:`; the reverse trick on `color:` is NOT safe, since
    // `[style*="color:#010B17"]` would also match `background-color:#010B17` and
    // repaint that element's TEXT. Foregrounds survived the transform anyway, so
    // they are deliberately left alone.
    `[style*="background:${hex}"]{background-color:${hex}!important}`,
  ]);
  return `<style>${rules.join("")}</style>`;
}
