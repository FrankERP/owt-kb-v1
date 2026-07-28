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

// Palette for EMAIL, deliberately light — and deliberately not app/brand.css.
//
// The app is dark-mode-only and these templates started dark to match. Five
// attempts to hold a dark palette against Outlook for Mac failed, three of them
// regressing light mode badly enough to revert. The pattern across every test
// was consistent: the brand ACCENTS survived every client transform without
// exception, and only the dark SURFACES were remapped to slate grey.
//
// That is structural, not bad luck. Client dark-mode transforms assume email is
// light: darkening a light message is the case they are built for, lightening a
// dark one is the edge case they handle badly. So the surfaces are light and the
// brand accents sit on top — the elements that already rendered correctly
// everywhere. Verified in Outlook for Mac in both toggle states.
//
// Accents are darkened from their brand.css values purely for contrast on a
// light surface; every pairing clears WCAG AA, which the dark palette was never
// checked against. See docs/superpowers/specs §6.
export const C = {
  field: "#F4F7FA",    // outer page field
  panel: "#FFFFFF",    // the message card
  surface: "#EDF2F7",  // table + panel surfaces
  accent: "#0B6E93",   // beam, darkened: eyebrow, links, medley spine
  positive: "#127A45", // signal, darkened: NUEVA chip, upward movement
  ink: "#10243A",      // primary text
  muted: "#566B7F",    // secondary text
  warning: "#9A6206",  // amber, darkened: downward movement
  retired: "#CBD7E3",  // departed-row chip
} as const;

export function td(inner: string, opts: { bg?: string; align?: string; colspan?: number; style?: string } = {}): string {
  const bg = opts.bg ?? C.panel;
  const align = opts.align ? ` align="${opts.align}"` : "";
  const colspan = opts.colspan ? ` colspan="${opts.colspan}"` : "";
  return `<td bgcolor="${bg}"${align}${colspan} style="background:${bg};${opts.style ?? ""}">${inner}</td>`;
}

export function tr(inner: string): string {
  return `<tr>${inner}</tr>`;
}

// `link` is the "Ajustar mis avisos →" footer destination — every caller
// currently passes `${appBaseUrl()}/me`.
export function shell(bodyRows: string, link: string): string {
  const eyebrow = tr(td(
    `<span style="font:700 11px system-ui,sans-serif;letter-spacing:.24em;color:${C.accent}">OASIS WORSHIP TEAM</span>`,
    { style: "padding:24px 24px 4px" },
  ));
  const footer = tr(td(
    `<p style="margin:0 0 6px;font:12px system-ui,sans-serif;color:${C.muted}">Recibes esto porque sirves en el equipo de alabanza de Oasis.</p>` +
    `<a href="${link}" style="font:12px system-ui,sans-serif;color:${C.accent};text-decoration:none">Ajustar mis avisos →</a>`,
    { style: `padding:16px 24px 24px;border-top:1px solid ${C.surface}` },
  ));
  const body =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.field}" style="background:${C.field};margin:0;padding:0">` +
    tr(td(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.panel}" style="max-width:600px;background:${C.panel};border-collapse:collapse">` +
      eyebrow + bodyRows + footer +
      `</table>`,
      { align: "center", style: "padding:24px 12px" },
    )) +
    `</table>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="color-scheme" content="light">` +
    `<meta name="supported-color-schemes" content="light">` +
    lockPalette() +
    `</head><body style="margin:0;padding:0;background:${C.field}">` +
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
function lockPalette(): string {
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
