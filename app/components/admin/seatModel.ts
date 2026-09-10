// app/components/admin/seatModel.ts
//
// The seat vocabulary for a service, as data rather than free text.
//
// `SlotEditor` used a free-text <input> for the instrument name, which let 7
// spellings of 5 instruments accumulate in production. Every seat name now passes
// through `normalizeSeatName`, so a known seat has exactly one spelling and a NEW
// seat is still possible — the list is closed against duplicates, not against growth.

export type SeatCategory = "voz" | "instrumento" | "foh";

export interface SeatDef {
  /** Stable identity for React keys and assignment lookups. */
  id: string;
  /** Canonical Spanish/English label as stored and rendered. */
  label: string;
  category: SeatCategory;
  /** Maximum occupants; `null` = unbounded. */
  max: number | null;
  /** `memberType` a person must carry to be eligible for this seat. */
  memberType: string;
}

/**
 * The three voice seats. `max` is null pending the soft maximum the design left
 * open — an invented cap would silently block a legitimately large Coro.
 */
export const VOICE_SEATS: SeatDef[] = [
  { id: "lead", label: "Lead", category: "voz", max: null, memberType: "voz" },
  { id: "bgv", label: "BGV", category: "voz", max: null, memberType: "voz" },
  { id: "coro", label: "Coro", category: "voz", max: null, memberType: "voz" },
];

/** Seeded from the distinct values present in production after normalisation. */
export const DEFAULT_INSTRUMENT_SEATS = ["Bass", "Keys", "Drums", "EG", "AG"];
export const DEFAULT_FOH_SEATS = ["Console"];

/** Canonical spelling keyed by its lowercase, whitespace-collapsed form. */
const CANONICAL = new Map<string, string>([
  ["bass", "Bass"],
  ["keys", "Keys"],
  ["drums", "Drums"],
  ["eg", "EG"],
  ["ag", "AG"],
  ["console", "Console"],
]);

/**
 * One spelling per seat. A known seat maps to its canonical form regardless of
 * case or stray whitespace; an unknown one is trimmed and whitespace-collapsed
 * but keeps the admin's casing, so a genuinely new seat is not mangled.
 */
export function normalizeSeatName(raw: unknown): string {
  const trimmed = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return CANONICAL.get(trimmed.toLowerCase()) ?? trimmed;
}

/**
 * `max` is null, like the voice seats. It is NOT a mistake that an instrument
 * seat has no cap: 18 of the team's services run TWO drummers on one `Drums`
 * seat, and every service from 2026-06-07 to 2026-08-30 does. A cap of 1 once
 * made the editor's toggle evict the first occupant on any click, silently
 * losing one of them — a shipped bug, not a hypothetical. Capacity guidance
 * belongs in the UI, never in a rule that drops data. The grid pins the same
 * invariant as D6 (`PlannerGrid.test.tsx`, "a non-solvable Drums cell with two
 * occupants never replaces a third addition").
 */
export function instrumentSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `instrumento:${name}`, label: name, category: "instrumento", max: null, memberType: "instrumento" };
}

export function fohSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `foh:${name}`, label: name, category: "foh", max: null, memberType: "foh" };
}

/**
 * The `memberType` a seat of this category requires. Every `SeatDef` above
 * already carries it; this is the same fact keyed by category, for the callers
 * that hold a `GridRow` (which has a category, not a `SeatDef`).
 */
export const SEAT_MEMBER_TYPE: Record<SeatCategory, string> = {
  voz: "voz",
  instrumento: "instrumento",
  foh: "foh",
};

/**
 * Can this member still occupy a seat of this category?
 *
 * The same test `rankCandidates` applies when building the candidate list, asked
 * of someone who is ALREADY seated. The two answers can disagree, because a seat
 * is filled once and «Tipo» is edited later — and since ADR-0029 made Tipo the
 * only eligibility axis, clearing it is how an admin takes someone off the
 * roster. Nothing re-examines the months already planned, so the person simply
 * stays where they are, silently. This is what lets the planner say so.
 *
 * An absent or empty Tipo fits nothing, which is exactly the state that clearing
 * it produces.
 */
export function occupantFitsSeat(
  member: { memberType?: string[] } | undefined,
  category: SeatCategory,
): boolean {
  return (member?.memberType ?? []).includes(SEAT_MEMBER_TYPE[category]);
}

/**
 * Whether a label names an instrument seat a MEMBER may declare. Membership in
 * `DEFAULT_INSTRUMENT_SEATS` after normalization — NOT `normalizeSeatName`
 * alone, which also canonicalizes `console` → `Console`, a FOH seat. The
 * member-side vocabulary is closed (a typo here would silently make a member
 * unschedulable); the service-side one stays open to growth.
 */
export function isKnownInstrument(label: unknown): boolean {
  const name = normalizeSeatName(label);
  return name !== "" && DEFAULT_INSTRUMENT_SEATS.includes(name);
}

/**
 * Does this member DECLARE this instrument? Both halves are required: the
 * `instrumento` Tipo (ADR-0029's only eligibility axis) AND the label in
 * `instruments`. A leftover declaration on a member whose Tipo was cleared
 * declares nothing — `instruments` is a refinement of the Tipo, never a second
 * axis. Absent or empty `instruments` is "declares nothing" (spec D6).
 *
 * Read in exactly two places besides the backfill script: `rankCandidates`
 * (the `undeclared` flag) and `PlannerGrid`'s declaration warning.
 */
export function occupantDeclaresInstrument(
  member: { memberType?: string[]; instruments?: string[] } | undefined,
  label: string,
): boolean {
  if (!member) return false;
  if (!(member.memberType ?? []).includes("instrumento")) return false;
  const name = normalizeSeatName(label);
  return (member.instruments ?? []).some((i) => normalizeSeatName(i) === name);
}
