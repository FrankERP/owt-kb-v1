// "Tipo" (`memberType`) — the ONLY worship eligibility axis (see the schema's
// own field description). This is the canonical list and Spanish label map: it
// used to be two separate copies (`/admin`'s abbreviated table labels and the
// PATCH route's write allowlist) with nothing to stop them from drifting apart
// — `MeHeader`'s Tipo chips would have been a third if this module hadn't
// centralized the list first.
//
// Mirrors `sanity/schemas/worshipTeam.ts`'s `memberType.options.list` exactly —
// `memberTypes.test.ts` reads that schema and pins the two together. Neutral
// module — no imports — so a Server Component may reach it without pulling in
// a `"use client"` boundary (ADR-0028), the same reason `myWeek.ts` and
// `paintsDayCard.ts` stay import-free.
export const MEMBER_TYPES = [
  "voz",
  "instrumento",
  "foh",
  "sunday_lead",
  "saturday_lead",
  "support",
] as const;

export type MemberType = (typeof MEMBER_TYPES)[number];

/** The schema's own Spanish `title`s, in full words — not `/admin`'s table abbreviations. */
export const MEMBER_TYPE_LABEL: Record<string, string> = {
  voz: "Voz",
  instrumento: "Instrumento",
  foh: "FOH",
  sunday_lead: "Líder Domingo",
  saturday_lead: "Líder Sábado",
  support: "Soporte",
};
