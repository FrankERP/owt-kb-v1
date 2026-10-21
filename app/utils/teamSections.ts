// The team block of a service card as three folding sections — Voces, Banda,
// Cabina — of people with a face (the Inicio redesign, Frank 2026-10-21: «a las
// personas que cantan solo les muestra las voces expandidas, a los instrumentos
// solo los instrumentos…, cualquiera puede expandir todas»).
//
// NEUTRAL module (no "use client", no React): the card renders it, and the pure
// rules — what each section holds, which ones open by default, the initials and
// the avatar URL — are tested here without a DOM.

export type TeamSectionId = "voces" | "banda" | "cabina";

export type TeamPerson = {
  /** Display name: alias || member_name, the name every seat is matched by. */
  name: string;
  /** The seat: Lead, BGV, Coro, an instrument, or a FOH role. */
  role: string;
};

export type TeamSection = { id: TeamSectionId; label: string; people: TeamPerson[] };

export type TeamInput = {
  leads?: string[];
  bgvs?: Array<{ member_name: string; alias?: string }>;
  chorus?: Array<{ member_name: string; alias?: string }>;
  instruments?: Array<{ label: string; person: string }>;
  fohTeam?: Array<{ label: string; person: string }>;
};

/** The lowercase/trim key every seat comparison in the card uses (`findDuplicates`,
 *  `myNameFromSession`), and the key of the `photos` map. */
export const personKey = (name: string) => name.toLowerCase().trim();

/** The sections that have anyone in them, always in Voces → Banda → Cabina order.
 *  An empty seat (an instrument with no person) is not a person and is dropped. */
export function teamSections(t: TeamInput): TeamSection[] {
  const display = (m: { member_name: string; alias?: string }) => m.alias || m.member_name;
  const sections: TeamSection[] = [
    {
      id: "voces",
      label: "Voces",
      people: [
        ...(t.leads ?? []).map((name) => ({ name, role: "Lead" })),
        ...(t.bgvs ?? []).map((m) => ({ name: display(m), role: "BGV" })),
        ...(t.chorus ?? []).map((m) => ({ name: display(m), role: "Coro" })),
      ],
    },
    { id: "banda", label: "Banda", people: (t.instruments ?? []).filter((s) => s.person).map((s) => ({ name: s.person, role: s.label })) },
    { id: "cabina", label: "Cabina", people: (t.fohTeam ?? []).filter((s) => s.person).map((s) => ({ name: s.person, role: s.label })) },
  ];
  return sections.filter((s) => s.people.some((p) => p.name));
}

/** Tipo (`memberType`, the only worship eligibility axis) → the section a member
 *  of that type cares about. Leaders sing; `support` has no section of its own. */
const SECTION_OF_TYPE: Record<string, TeamSectionId> = {
  voz: "voces",
  sunday_lead: "voces",
  saturday_lead: "voces",
  instrumento: "banda",
  foh: "cabina",
};

/**
 * Which sections start open. THIS service's seat wins: someone whose Tipo is voz
 * but who plays keys this Sunday needs Banda open, not Voces. Only a member with
 * no seat here falls back to their Tipo, and a member with both kinds of Tipo
 * gets both. Nothing matching opens nothing — a closed section still lists its
 * names, so nobody is hidden.
 */
export function defaultOpenSections(sections: TeamSection[], myName: string, viewerTypes?: string[] | null): Set<TeamSectionId> {
  const seated = new Set<TeamSectionId>();
  if (myName) {
    for (const s of sections) if (s.people.some((p) => personKey(p.name) === myName)) seated.add(s.id);
  }
  if (seated.size) return seated;
  const present = new Set(sections.map((s) => s.id));
  return new Set(
    (viewerTypes ?? []).map((t) => SECTION_OF_TYPE[t]).filter((id): id is TeamSectionId => !!id && present.has(id)),
  );
}

/** Two letters for a face with no photo: the first two of the display name
 *  («Toño» → TO). Deliberately the rule `MeHeader` and `NavMenu` already use, so
 *  a member's circle reads the same on every surface. */
export function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

/**
 * The URL an avatar loads. A Sanity image is asked for at 2× the 36 px circle,
 * cropped square — the original upload can be several MB, and the card shows up
 * to fifteen faces. No `auto=format`: it would hand WebP to the iOS WKWebView,
 * which is why `MeHeader` serves avatars `unoptimized`. Any other URL (the Google
 * photo) is passed through untouched.
 */
export function avatarSrc(url: string): string {
  if (!url.startsWith("https://cdn.sanity.io/images/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=96&h=96&fit=crop`;
}

/** Display name → photo URL, from role projections that carry `photo` per seat.
 *  The card matches seats by display name, so the map is keyed the same way. */
export function seatPhotos(
  roles: Array<{
    Lead?: Array<{ member_name: string; alias?: string; photo?: string | null }> | null;
    BGVs?: Array<{ member_name: string; alias?: string; photo?: string | null }> | null;
    Chorus?: Array<{ member_name: string; alias?: string; photo?: string | null }> | null;
    instruments?: Array<{ person?: string | null; photo?: string | null }> | null;
    foh_team?: Array<{ person?: string | null; photo?: string | null }> | null;
  } | null | undefined>,
): Record<string, string> {
  const photos: Record<string, string> = {};
  const add = (name: string | null | undefined, photo: string | null | undefined) => {
    if (name && photo && !photos[personKey(name)]) photos[personKey(name)] = photo;
  };
  for (const r of roles) {
    if (!r) continue;
    for (const m of [...(r.Lead ?? []), ...(r.BGVs ?? []), ...(r.Chorus ?? [])]) add(m?.alias || m?.member_name, m?.photo);
    for (const s of [...(r.instruments ?? []), ...(r.foh_team ?? [])]) add(s?.person, s?.photo);
  }
  return photos;
}
