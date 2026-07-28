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

export function td(inner: string, opts: { bg?: string; align?: string; colspan?: number; style?: string } = {}): string {
  const bg = opts.bg ?? C.console;
  const align = opts.align ? ` align="${opts.align}"` : "";
  const colspan = opts.colspan ? ` colspan="${opts.colspan}"` : "";
  return `<td bgcolor="${bg}"${align}${colspan} style="background:${bg}!important;${opts.style ?? ""}">${inner}</td>`;
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
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.blackout}" style="background:${C.blackout}!important;margin:0;padding:0">` +
    tr(td(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.console}" style="max-width:600px;background:${C.console}!important;border-collapse:collapse">` +
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
    `</head><body style="margin:0;padding:0;background:${C.blackout}!important">` +
    body +
    `</body></html>`
  );
}

/**
 * Holds the palette against clients that rewrite dark email into their own
 * theme. Verified in Outlook for Mac, which rendered `#071624` as slate grey and
 * flattened every surface to one tone, destroying the depth the layout relies on.
 * The `color-scheme` meta above does not stop it.
 *
 * These rules fixed Outlook's LIGHT mode. Its dark mode still transforms, which
 * says the rewriter rewrites stylesheet rules too — so a `!important` rule here
 * is rewritten along with everything else and has nothing left to win against.
 * That is why the inline declarations carry `!important` as well: many dark-mode
 * rewriters skip a value already marked important, and the inline attribute is
 * the last thing they touch.
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
