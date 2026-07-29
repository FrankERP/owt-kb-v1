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

export function instrumentSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `instrumento:${name}`, label: name, category: "instrumento", max: 1, memberType: "instrumento" };
}

export function fohSeatDef(label: string): SeatDef {
  const name = normalizeSeatName(label);
  return { id: `foh:${name}`, label: name, category: "foh", max: 1, memberType: "foh" };
}
