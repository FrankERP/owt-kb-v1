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

// ── Setlist grouping and content state ──────────────────────────────────────

export type CanonicalGroupState = "none" | "single" | "duplicate" | "invalid";

/** Canonical target cardinality: 0 -> none, 1 -> single, >1 -> duplicate. */
export function canonicalGroupState(canonicalCount: number): CanonicalGroupState {
  if (canonicalCount <= 0) return "none";
  if (canonicalCount === 1) return "single";
  return "duplicate";
}

export type SetlistContentState = "empty" | "incomplete" | "ready" | "invalid";

/**
 * Content state of a single canonical setlist's `songs` array. Malformed
 * structure, missing/duplicate `_key`, or a missing/dangling song reference is
 * `invalid` — never ordinary `incomplete`. `resolvesSong` reports whether a
 * referenced song id resolves to a canonical post (defaults to trusting the
 * ref, for callers that validate resolution separately).
 */
export function setlistContentState(
  songs: unknown,
  resolvesSong: (songId: string) => boolean = () => true,
): SetlistContentState {
  if (!Array.isArray(songs)) return "invalid";
  if (songs.length === 0) return "empty";

  const keys = new Set<string>();
  let hasBlankPlayKey = false;
  for (const item of songs) {
    if (!isObj(item)) return "invalid";
    if (!nonEmptyString(item._key) || keys.has(item._key)) return "invalid";
    keys.add(item._key);
    const song = item.song;
    if (!isObj(song) || !nonEmptyString(song._ref) || !resolvesSong(song._ref)) return "invalid";
    if (!nonEmptyString(item.play_key)) hasBlankPlayKey = true;
  }
  return hasBlankPlayKey ? "incomplete" : "ready";
}

// ── Member resolution and raw-draft identity ────────────────────────────────

/** The canonical member projection shared by assignment/availability resolution. */
export interface CanonicalMember {
  _id: string;
  _rev: string;
  member_name?: string;
  alias?: string;
  unavailableDates?: string[];
  /**
   * Stored as an array of `{ date, note }` (see `sanity/schemas/worshipTeam.ts`),
   * matching every other consumer. Declared as a plain string until 2026-07-25,
   * which was simply wrong: nothing called a string method on it, so it never
   * broke at runtime, but the type would have misled the next caller.
   */
  unavailabilityNotes?: { date: string; note: string }[];
}

/**
 * Map a raw document id to its canonical identity by stripping a single
 * `drafts.` prefix, so an overlay is associated with its published base before
 * any target grouping. A non-draft id is returned unchanged.
 */
export function normalizeBaseId(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

/**
 * Resolve assignment refs against canonical members. Unique refs with no
 * canonical member are `dangling` — never dropped and never treated as empty.
 */
export function resolveMembers(
  refs: string[],
  membersById: Map<string, CanonicalMember>,
): { members: CanonicalMember[]; danglingRefs: string[] } {
  const members: CanonicalMember[] = [];
  const danglingRefs: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const member = membersById.get(ref);
    if (member) members.push(member);
    else danglingRefs.push(ref);
  }
  return { members, danglingRefs };
}

/**
 * Public/admin target state: `draft_conflict` whenever any relevant raw draft
 * exists for the target; otherwise it mirrors the canonical state. Application
 * draft gating is never used here.
 */
export function publicTargetState(
  canonicalState: CanonicalGroupState,
  draftIds: string[],
): CanonicalGroupState | "draft_conflict" {
  return draftIds.length > 0 ? "draft_conflict" : canonicalState;
}

// ── Proposal validation and grouping ────────────────────────────────────────

export const PROPOSAL_STATUSES = [
  "draft",
  "pending",
  "changes_requested",
  "approved",
] as const;

export const SERVICE_KINDS = ["sunday", "saturday", "special"] as const;

export interface ProposalValidation {
  /** True only when the proposal groups cleanly (fields + resolved-role agreement). */
  valid: boolean;
  /** Issue tags: identity | service_type | service_ref | date | status | role_unresolved | role_not_groupable | role_type_mismatch | date_mismatch. */
  issues: string[];
  serviceRef: string | null;
  targetKey: string | null;
  /** Content state, validated independently of grouping validity. */
  contentState: SetlistContentState;
  createdAt: string | null;
  status: string | null;
}

/**
 * Validate a proposal for grouping. `canonicalRole` is the role resolved from
 * `service_ref` through the canonical client (or null when it does not resolve
 * to a live published role). Content validity is reported separately and does
 * not gate grouping validity.
 */
export function validateProposal(
  proposal: unknown,
  canonicalRole: unknown | null,
): ProposalValidation {
  const issues: string[] = [];
  const doc = isObj(proposal) ? proposal : {};

  if (!nonEmptyString(doc._id) || !nonEmptyString(doc._rev)) issues.push("identity");

  const serviceType = doc.service_type;
  const typeKnown = (SERVICE_KINDS as readonly unknown[]).includes(serviceType);
  if (!typeKnown) issues.push("service_type");

  const serviceRef = nonEmptyString(doc.service_ref) ? doc.service_ref : null;
  if (!serviceRef) issues.push("service_ref");

  const serviceDate = isValidServiceDate(doc.service_date) ? doc.service_date : null;
  if (!serviceDate) issues.push("date");

  if (!(PROPOSAL_STATUSES as readonly unknown[]).includes(doc.status)) issues.push("status");

  if (canonicalRole == null) {
    issues.push("role_unresolved");
  } else {
    const rv = validateRole(canonicalRole);
    if (!rv.groupable) {
      issues.push("role_not_groupable");
    } else {
      const roleType = (canonicalRole as Record<string, unknown>)._type;
      const expected =
        serviceType === "sunday"
          ? "sunday_role"
          : serviceType === "saturday"
            ? "saturday_role"
            : serviceType === "special"
              ? "special_role"
              : null;
      if (expected && roleType !== expected) issues.push("role_type_mismatch");
      if (serviceDate && rv.serviceDate && serviceDate !== rv.serviceDate) issues.push("date_mismatch");
    }
  }

  const targetKey =
    typeKnown && serviceDate && serviceRef
      ? proposalTargetKey(serviceType as string, serviceDate, serviceRef)
      : null;

  return {
    valid: issues.length === 0,
    issues,
    serviceRef,
    targetKey,
    contentState: setlistContentState(doc.songs),
    createdAt: nonEmptyString(doc._createdAt) ? doc._createdAt : null,
    status: typeof doc.status === "string" ? doc.status : null,
  };
}

const PROPOSAL_STATUS_ORDER: Record<string, number> = {
  pending: 0,
  changes_requested: 1,
  draft: 2,
  approved: 3,
};

/**
 * Deterministic display order when a grouping still needs one presentable
 * record: pending, changes_requested, draft, approved, then oldest `_createdAt`.
 * Never a substitute for validated grouping.
 */
export function orderProposals<T extends { status: string | null; createdAt: string | null }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const sa = PROPOSAL_STATUS_ORDER[a.status ?? ""] ?? 99;
    const sb = PROPOSAL_STATUS_ORDER[b.status ?? ""] ?? 99;
    if (sa !== sb) return sa - sb;
    const ca = a.createdAt ?? "";
    const cb = b.createdAt ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

export interface ProposalIndexes {
  byServiceRef: Map<string, ProposalValidation[]>;
  byTargetKey: Map<string, ProposalValidation[]>;
}

/**
 * Build both proposal indexes from validated records. Only valid proposals are
 * candidates; invalid/dangling/mismatched records are issues, never index
 * entries. A key mapping to more than one record is a grouping conflict.
 */
export function indexProposals(validated: ProposalValidation[]): ProposalIndexes {
  const byServiceRef = new Map<string, ProposalValidation[]>();
  const byTargetKey = new Map<string, ProposalValidation[]>();
  for (const p of validated) {
    if (!p.valid || !p.serviceRef || !p.targetKey) continue;
    (byServiceRef.get(p.serviceRef) ?? byServiceRef.set(p.serviceRef, []).get(p.serviceRef)!).push(p);
    (byTargetKey.get(p.targetKey) ?? byTargetKey.set(p.targetKey, []).get(p.targetKey)!).push(p);
  }
  for (const m of [byServiceRef, byTargetKey]) {
    for (const [k, v] of m) m.set(k, orderProposals(v));
  }
  return { byServiceRef, byTargetKey };
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
