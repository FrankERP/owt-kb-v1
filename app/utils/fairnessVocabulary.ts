// app/utils/fairnessVocabulary.ts
//
// Solver v3 C2 — the fairness vocabulary (spec IF2-1) and the wire shapes every
// C2 surface shares (IF2-3 … IF2-9). NEUTRAL (ADR-0028): no "use client", no
// `server-only`, no Sanity client and no `node:crypto`, so the ledger, the
// eligibility resolver, the panel and the routes import ONE definition. The
// write-request module (which hashes with `node:crypto`) imports from here,
// never the other way round.
//
// Units and sign (spec §4 vocabulary, LG-13): every fairness figure — `share`,
// `received`, `balance` — is integer HUNDREDTHS of a seat, positive = owed («le
// deben»); `received` is 100 × the seats counted; `balance` is `share − received`.
// Display tenths and seat counts are separate fields (IF2-8), never fed back into
// a computation.

/** The six role keys, in the CANONICAL ROLE ORDER (IF2-1). Every role-key list on the wire uses it. */
export const ROLE_KEYS = ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const STATUSES = ["in", "out", "exact"] as const;
export type Status = (typeof STATUSES)[number];

export type LineKey = "DL" | "SL" | "BGV" | "CORO" | `P:${string}`;
export type TabKey = "DL" | "SL" | "BGV" | "CORO" | "TOTAL";
export const TAB_KEYS: readonly TabKey[] = ["DL", "SL", "BGV", "CORO", "TOTAL"];

export const SET_ASIDE_REASONS = [
  "second_seat",
  "exact",
  "cadence",
  "not_in_record",
  "outside_population",
  "floor",
] as const;
export type SetAsideReason = (typeof SET_ASIDE_REASONS)[number];

/** Role key → line (§4 vocabulary). Presence sub-lines `P:<ruleKey>` are not role lines. */
export const ROLE_LINE: Readonly<Record<RoleKey, "DL" | "SL" | "BGV" | "CORO">> = {
  "Sun.Lead": "DL",
  "Sat.Lead": "SL",
  "Sun.BGV": "BGV",
  "Sat.BGV": "BGV",
  "Sun.Choir": "CORO",
  "Sat.Choir": "CORO",
};

/** The Sunday-class and Saturday-class keys of a service (LG-4: a counted special by day class). */
export const SUNDAY_KEYS: readonly RoleKey[] = ["Sun.Lead", "Sun.BGV", "Sun.Choir"];
export const SATURDAY_KEYS: readonly RoleKey[] = ["Sat.Lead", "Sat.BGV", "Sat.Choir"];

/** Lead > BGV > Choir — the one seat-class order (LG-4, LG-7, LG-11). */
export type RoleClass = "Lead" | "BGV" | "Choir";
export const ROLE_CLASS_ORDER: readonly RoleClass[] = ["Lead", "BGV", "Choir"];

export function roleClassOf(key: RoleKey): RoleClass {
  return key.slice(4) as RoleClass;
}

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** Distinct keys in canonical role order. */
export function canonicalRoles(keys: Iterable<RoleKey>): RoleKey[] {
  const set = new Set(keys);
  return ROLE_KEYS.filter((k) => set.has(k));
}

/** The display tab a line folds into (LG-14): every `P:*` sub-line folds into BGV. */
export function tabOfLine(line: LineKey): Exclude<TabKey, "TOTAL"> {
  if (line === "DL" || line === "SL" || line === "BGV" || line === "CORO") return line;
  return "BGV";
}

/** Codepoint comparison — never `localeCompare` (LG-16, REC-6). */
export function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Months ─────────────────────────────────────────────────────────────────

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthString(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

/** `YYYY-MM` → an integer index (year × 12 + month − 1). Integer arithmetic, never a `Date`. */
export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

/** The inverse of {@link monthIndex}, zero-padded. */
export function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  return monthFromIndex(monthIndex(month) + by);
}

// ─── Wire shapes ────────────────────────────────────────────────────────────

/** IF2-4 — one month of `PUT /api/admin/fairness/months`. */
export interface FairnessMonthWrite {
  month: string;
  source: "auto" | "manual";
  expectedRev: string | null;
  people: Array<{
    memberId: string;
    roles: Record<RoleKey, Status>;
    exactRules: Array<{ roles: RoleKey[]; count: number }>;
    sundayCadence?: "alternate";
    exempt: boolean;
    blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>;
  }>;
  presence: Array<{ ruleKey: string; roles: RoleKey[]; members: string[]; exclusive: boolean }>;
}

/** IF2-4 — the request body. 1–2 entries, consecutive and ascending. */
export interface FairnessMonthsPut {
  months: FairnessMonthWrite[];
}

/** The logical content of one month — a body without `source`/`expectedRev`. */
export type FairnessMonthBody = Omit<FairnessMonthWrite, "source" | "expectedRev">;

export type RecordSource = "auto" | "manual" | "reconstructed";
export type RecordEngine = "v2" | "v3";
export type RecordEnvironment = "production" | "preview" | "local";

/** IF2-3 — the logical record (GET `horizon[].record`, fixture records, the parser's output). */
export interface LogicalRecord {
  month: string;
  rev: string;
  contentHash: string;
  source: RecordSource;
  engine: RecordEngine;
  environment: RecordEnvironment;
  recordedAt: string;
  people: Array<FairnessMonthWrite["people"][number] & { name: string }>;
  presence: FairnessMonthWrite["presence"];
}

/** IF2-5 — the PUT's 200. */
export interface FairnessMonthsPutOk {
  months: Array<{
    month: string;
    outcome: "created" | "replaced" | "unchanged";
    rev: string;
    contentHash: string;
    recordedAt: string;
  }>;
}

/** IF2-6 — the refusal codes the PUT can answer in `details.detail`. */
export const FAIRNESS_PUT_REFUSALS = [
  "record_exists",
  "record_missing",
  "stale_revision",
  "month_has_services",
  "past_month",
  "engine_not_v3",
  "member_unknown",
  "member_not_worship",
  "tipo_mismatch",
] as const;
export type FairnessPutRefusal = (typeof FAIRNESS_PUT_REFUSALS)[number];

/** IF2-6 — every refusal the executor can answer, for either actor. */
export const FAIRNESS_WRITE_REFUSALS = [
  ...FAIRNESS_PUT_REFUSALS,
  "not_past_month",
  "not_reconstruction_owned",
  "record_edited",
  "invalid_body",
] as const;
export type FairnessWriteRefusal = (typeof FAIRNESS_WRITE_REFUSALS)[number];

/** IF2-5 — `details` of a PUT 409. */
export interface FairnessMonthsPutConflictDetails {
  detail: FairnessPutRefusal;
  months: Array<{ month: string; verdict: "create" | "replace" | "unchanged" | FairnessPutRefusal }>;
  cause?: "commit_conflict";
  rev?: string;
  source?: RecordSource;
  recordedAt?: string;
  memberIds?: string[];
}

/** IF2-8 — figures for one line or tab. Fairness figures are hundredths; `seats` and `tenths` are display. */
export interface Figures {
  share: number;
  received: number;
  balance: number;
  seats: number;
  tenths: { share: number; balance: number };
}

export interface RecordSummary {
  rev: string;
  source: RecordSource;
  engine: RecordEngine;
  environment: RecordEnvironment;
  recordedAt: string;
}

/** IF2-9 — the closed set of notes, in their display order (§8). */
export const NOTE_CODES = [
  "unrecorded_month",
  "not_listed",
  "role_out",
  "unavailable",
  "rule_excluded",
  "exact",
  "exact_clamped",
  "cadence_set_aside",
  "cadence_no_sunday_saturday",
  "floor_seat",
  "presence",
  "outside_population",
  "second_seat",
  "exempt",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export type Note = { line?: LineKey } & (
  | { code: "unrecorded_month" }
  | { code: "not_listed" }
  | { code: "role_out" }
  | { code: "unavailable"; dates: string[] }
  | { code: "rule_excluded"; dates: string[] }
  | { code: "exact"; roles: RoleKey[]; count: number }
  | { code: "exact_clamped"; count: number; available: number }
  | { code: "cadence_set_aside"; dates: string[] }
  | { code: "cadence_no_sunday_saturday"; dates: string[] }
  | { code: "floor_seat"; date: string; roleKey: RoleKey }
  | { code: "presence"; ruleKey: string; members: string[] }
  | { code: "outside_population"; dates: string[] }
  | { code: "second_seat"; dates: string[] }
  | { code: "exempt" }
);

export interface FairnessPersonMonth {
  month: string;
  recorded: boolean;
  listed: boolean;
  lines: Partial<Record<LineKey, Figures>>;
  held: Partial<Record<RoleKey, number>>;
  setAsides: Array<{ date: string; serviceId: string; roleKey: RoleKey; reason: SetAsideReason }>;
  notes: Note[];
}

export interface FairnessPerson {
  memberId: string;
  name: string;
  exists: boolean;
  window: Partial<Record<LineKey, Figures>>;
  cumulative: Partial<Record<LineKey, Figures>>;
  tabs: { window: Partial<Record<TabKey, Figures>>; cumulative: Partial<Record<TabKey, Figures>> };
  sang: number;
  exempt: boolean;
  months: FairnessPersonMonth[];
  countedSundayLeads: string[];
  firstRecordedIn: Partial<Record<RoleKey, string>>;
}

/** IF2-8 — the GET's 200 body. */
export interface FairnessLedgerResponse {
  v: 1;
  engine: RecordEngine;
  environment: RecordEnvironment;
  currentMonth: string;
  target: string;
  window: Array<{ month: string; record: RecordSummary | null }>;
  recordsSince: string | null;
  horizon: Array<{ month: string; record: LogicalRecord | null; storedServices: number; recordBinds: boolean }>;
  people: FairnessPerson[];
  diagnostics: {
    duplicateTargets: Array<{ type: string; date: string; roleIds: string[] }>;
    notInRecordSeats: number;
    unknownMembers: string[];
  };
}

/** IF2-7 — the GET's failure body. */
export const FAIRNESS_UNAVAILABLE_MESSAGE = "No se pudo leer el saldo de equidad.";
