// Pure, server-safe validation and grouping model for the canonical service
// read contract (A1). No Sanity client, no I/O — just deterministic rules over
// already-fetched documents, so it is exhaustively unit-testable and shared
// unchanged with A2. Invalid records become integrity issues; they never enter
// date slicing, target grouping, counts, or member-visible rendering.

export const ROLE_TYPES = [
  "sunday_role",
  "saturday_role",
  "special_role",
] as const;
export type RoleType = (typeof ROLE_TYPES)[number];

export const SETLIST_TYPES = ["featuredSongs", "saturdarSongs"] as const;

// The six existing protected stored types. `saturdarSongs` is a deliberate
// stored typo (Saturday setlist) — never "corrected".
export const PROTECTED_TYPES = [
  ...ROLE_TYPES,
  ...SETLIST_TYPES,
  "setlistProposal",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real `YYYY-MM-DD` calendar day (rejects 2026-02-30, 2026-13-01, times). */
export function isValidServiceDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isRoleType(type: unknown): type is RoleType {
  return (ROLE_TYPES as readonly unknown[]).includes(type);
}

/**
 * Canonical role target key: weekend roles group by `type:week`; a special role
 * is its own target (its id). Returns null when the role cannot be targeted.
 */
export function roleTargetKey(role: {
  _type?: unknown;
  _id?: unknown;
  week?: unknown;
  date?: unknown;
}): string | null {
  if (role._type === "special_role") {
    return typeof role._id === "string" && role._id ? role._id : null;
  }
  if (role._type === "sunday_role" || role._type === "saturday_role") {
    return isValidServiceDate(role.week) ? `${role._type}:${role.week}` : null;
  }
  return null;
}

/**
 * Live-setlist target key for a role: weekend setlists key by their setlist doc
 * type and week (`featuredSongs:<week>` / `saturdarSongs:<week>`); a special
 * service stores songs on the role itself, so its key is the role id.
 */
export function setlistTargetKey(
  roleType: string,
  week: string | undefined,
  roleId: string,
): string | null {
  if (roleType === "sunday_role") return week ? `featuredSongs:${week}` : null;
  if (roleType === "saturday_role") return week ? `saturdarSongs:${week}` : null;
  if (roleType === "special_role") return roleId;
  return null;
}

/**
 * Proposal target key: weekend proposals key by `service_type:service_date`;
 * special proposals key by `special:service_ref`.
 */
export function proposalTargetKey(
  serviceType: string,
  serviceDate: string,
  serviceRef: string,
): string | null {
  if (serviceType === "sunday") return `sunday:${serviceDate}`;
  if (serviceType === "saturday") return `saturday:${serviceDate}`;
  if (serviceType === "special") return `special:${serviceRef}`;
  return null;
}

type SeatKind = "ref" | "instrument" | "foh";

const SEATS: { field: string; kind: SeatKind }[] = [
  { field: "Lead", kind: "ref" },
  { field: "BGVs", kind: "ref" },
  { field: "Chorus", kind: "ref" },
  { field: "instruments", kind: "instrument" },
  { field: "foh_team", kind: "foh" },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Validate one seat array's structure and, on success, push its member refs into
// `outRefs`. A missing/non-array field is invalid (never treated as empty); an
// empty array is a structurally valid seat with zero assignments.
function validateSeat(arr: unknown, kind: SeatKind, outRefs: string[]): boolean {
  if (!Array.isArray(arr)) return false;
  const keys = new Set<string>();
  const staged: string[] = [];
  for (const item of arr) {
    if (!isObj(item)) return false;
    if (!nonEmptyString(item._key) || keys.has(item._key)) return false;
    keys.add(item._key);
    if (kind === "ref") {
      if (item._type !== "reference" || !nonEmptyString(item._ref)) return false;
      staged.push(item._ref);
    } else {
      const expectedType = kind === "instrument" ? "instrument_slot" : "foh_slot";
      const labelField = kind === "instrument" ? "instrument" : "role";
      if (item._type !== expectedType || !nonEmptyString(item[labelField])) return false;
      const person = item.person;
      if (!isObj(person) || person._type !== "reference" || !nonEmptyString(person._ref)) return false;
      staged.push(person._ref);
    }
  }
  outRefs.push(...staged);
  return true;
}

export interface RoleValidation {
  /** True only when the role is structurally clean and can enter target grouping. */
  groupable: boolean;
  /** Issue tags: "identity" | "type" | "date" | `seat:${field}`. Empty when groupable. */
  issues: string[];
  /** Canonical target key, only when groupable. */
  targetKey: string | null;
  /** `week` for weekend roles, `date` for special; null when invalid/missing. */
  serviceDate: string | null;
  /** Unique member refs across all five seat paths (only from valid seats). */
  assignedRefs: string[];
}

/**
 * Validate a single canonical role document for groupability. Structural
 * resolution of refs against members (dangling detection) is layered on top by
 * a separate step; this function reports raw refs and per-seat structural
 * validity only.
 */
export function validateRole(role: unknown): RoleValidation {
  const issues: string[] = [];
  const assignedRefs: string[] = [];
  const doc = isObj(role) ? role : {};

  if (!nonEmptyString(doc._id) || !nonEmptyString(doc._rev)) issues.push("identity");

  const typeOk = isRoleType(doc._type);
  if (!typeOk) issues.push("type");

  let serviceDate: string | null = null;
  if (typeOk) {
    const raw = doc._type === "special_role" ? doc.date : doc.week;
    serviceDate = isValidServiceDate(raw) ? raw : null;
    if (!serviceDate) issues.push("date");
  }

  for (const seat of SEATS) {
    if (!validateSeat(doc[seat.field], seat.kind, assignedRefs)) {
      issues.push(`seat:${seat.field}`);
    }
  }

  const groupable = issues.length === 0;
  return {
    groupable,
    issues,
    targetKey: groupable ? roleTargetKey(doc) : null,
    serviceDate,
    assignedRefs: [...new Set(assignedRefs)],
  };
}
