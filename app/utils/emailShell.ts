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
  return `<td bgcolor="${bg}"${align}${colspan} style="background:${bg};${opts.style ?? ""}">${inner}</td>`;
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
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.blackout}" style="background:${C.blackout};margin:0;padding:0">` +
    tr(td(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.console}" style="max-width:600px;background:${C.console};border-collapse:collapse">` +
      eyebrow + bodyRows + footer +
      `</table>`,
      { align: "center", style: "padding:24px 12px" },
    )) +
    `</table>`
  );
}
