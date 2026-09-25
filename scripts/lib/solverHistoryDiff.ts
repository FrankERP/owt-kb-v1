// scripts/lib/solverHistoryDiff.ts
//
// R11's diff gate, as a PURE classifier: Frank's exported browser history against
// the server-derived one, per month × member × role key, every difference given
// exactly one verdict — explained, unverified or bug — by the spec's rules 1–5,
// in order, the first rule and the first arm that apply winning, and nothing else.
//
// Spec: `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`
// (R11, R13). Plan: `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`
// (step 6, decisions D7–D9).
//
// Pure: no `fs`, no network, no Sanity, no Date.now. It imports only the neutral
// derivation module and its neutral types (ruling P2-R2), so the CLI that runs it
// on Frank's machine reaches no server-only module and no Sanity client.
//
// Every place where R11's text left a choice open is settled toward `bug` or
// `unverified`, never toward `explained`, and each one is pinned by a test in
// `scripts/__tests__/solverHistoryDiff.test.ts`:
//  - rule 1 blocks by itself and makes every differing cell of ITS month a bug;
//  - rule 2's arms run in the spec's order, so a full export (six or more
//    entries) missing a month is `unverified` even when another export holds it;
//  - rule 3b maps a raw `_id` of a current member unconditionally (the identity
//    is known), and any other unknown key only to the ONE current name that
//    carries exactly its role counts and that the export does not already hold;
//  - rule 4's "no receipt" arm is `receipt.status === "unstamped"` — a stamped
//    document whose receipt is missing is not admitted by it;
//  - rule 4c ("changed") needs a FOUND receipt: `unchangedAs === null` without
//    one cannot tell a mismatch from a missing fingerprint;
//  - rule 4b's "a latest-session document has since changed" is a fingerprint
//    mismatch or a move (the date is hashed); a DELETED latest-session document
//    is not a change in R11's vocabulary (4d is its own arm), so it admits nothing;
//  - rule 4b's sessions are undetermined — and admit nothing — when a receipt of
//    the month has no `createdAt` or state, or a document of the month is stamped
//    but its receipt was not found;
//  - rule 4d needs a `role_deleted` receipt whose role is gone; a committed
//    receipt whose role vanished was deleted out of band, and is a bug;
//  - rule 4e never counts an out-of-window receipt whose role's current day is
//    INSIDE the window: the two reads are not transactional, so that is a race;
//  - an export whose `total_counts` disagrees with its own role counts is a
//    difference (role key `total_counts`) that no document can explain.

import {
  DERIVED_HISTORY_ROLE_KEYS,
  historyWindow,
  type SolverHistoryEntry,
  type SolverHistoryTarget,
  type WeekendRoleType,
} from "../../app/utils/solverHistory";
import type {
  SolverHistoryDocumentEvidence,
  SolverHistoryEvidence,
  SolverHistoryOutOfWindowReceipt,
  SolverHistoryResult,
} from "../../app/utils/solverHistoryTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Decision D8: receipts more than this far apart start a new create session. */
export const SESSION_GAP_MINUTES = 60;

/** The browser keeps this many entries (`MAX_HISTORY` in `MonthGenerator.tsx`). */
export const EXPORT_CAPACITY = 6;

/** The pseudo role key of a cell where `total_counts` disagrees with the role counts. */
export const TOTAL_KEY = "total_counts";

export type Verdict = "explained" | "unverified" | "bug";

/** Every class R11 names, in rule-and-arm order. The order IS the precedence. */
export const DIFF_CLASSES = [
  "duplicate_target",
  "future",
  "outside_window",
  "evicted_or_deleted",
  "another_profile",
  "deleted_by_hand_or_never_written",
  "raw_response_entry",
  "rename_or_unknown_id",
  "created_outside_create_mode_no_receipt",
  "created_outside_create_mode_empty_seat",
  "partial_month_overwrite",
  "partial_month_overwrite_unverified",
  "changed_since_creation",
  "deleted_since_creation",
  "moved_out_of_month",
  "residual",
] as const;

export type DiffClass = (typeof DIFF_CLASSES)[number];

export const CLASS_VERDICT: Readonly<Record<DiffClass, Verdict>> = {
  duplicate_target: "bug",
  future: "explained",
  outside_window: "explained",
  evicted_or_deleted: "unverified",
  another_profile: "explained",
  deleted_by_hand_or_never_written: "unverified",
  raw_response_entry: "explained",
  rename_or_unknown_id: "explained",
  created_outside_create_mode_no_receipt: "explained",
  created_outside_create_mode_empty_seat: "explained",
  partial_month_overwrite: "explained",
  partial_month_overwrite_unverified: "unverified",
  changed_since_creation: "unverified",
  deleted_since_creation: "unverified",
  moved_out_of_month: "unverified",
  residual: "bug",
};

/** R11's rule and arm for each class, as the report prints them. */
export const CLASS_ARM: Readonly<Record<DiffClass, string>> = {
  duplicate_target: "1",
  future: "2a",
  outside_window: "2b",
  evicted_or_deleted: "2c",
  another_profile: "2d",
  deleted_by_hand_or_never_written: "2e",
  raw_response_entry: "3a",
  rename_or_unknown_id: "3b",
  created_outside_create_mode_no_receipt: "4a (no receipt)",
  created_outside_create_mode_empty_seat: "4a (empty seat)",
  partial_month_overwrite: "4b",
  partial_month_overwrite_unverified: "4b (latest session changed)",
  changed_since_creation: "4c",
  deleted_since_creation: "4d",
  moved_out_of_month: "4e",
  residual: "5",
};

export const CLASS_LABEL: Readonly<Record<DiffClass, string>> = {
  duplicate_target: "duplicate weekend target in the window",
  future: "future month",
  outside_window: "outside the window",
  evicted_or_deleted: "evicted or deleted (full export)",
  another_profile: "another browser or profile",
  deleted_by_hand_or_never_written: "deleted by hand or never written",
  raw_response_entry: "pre-2026-07-30 raw-response entry",
  rename_or_unknown_id: "rename or unknown id",
  created_outside_create_mode_no_receipt: "created outside create mode — no receipt (weaker: pre-2026-07-24 planner documents have none either)",
  created_outside_create_mode_empty_seat: "created outside create mode — «+ Nuevo servicio»",
  partial_month_overwrite: "partial-month overwrite",
  partial_month_overwrite_unverified: "partial-month overwrite, latest session changed",
  changed_since_creation: "changed since creation",
  deleted_since_creation: "deleted since creation",
  moved_out_of_month: "moved out of the month",
  residual: "residual — no rule admits it",
};

const VERDICT_RANK: Record<Verdict, number> = { explained: 0, unverified: 1, bug: 2 };

// ─── Types ───────────────────────────────────────────────────────────────────

/** A calendar month. `key` is unpadded (`2026-9`), like a history entry's. */
export interface MonthRef {
  key: string;
  year: number;
  month: number;
}

export interface CellPart {
  class: DiffClass;
  /** How many of the cell's seats this part accounts for. */
  amount: number;
  /** Role ids (`role:`), receipt ids (`receipt:`) or a reason — never a name. */
  evidence: string[];
}

/** One differing month × member × role key. */
export interface DiffCell {
  month: MonthRef;
  /** The key compared: a current name, or the export's own key for an unmapped or renamed one. */
  member: string;
  /** Rule 3b: the current name this export key was mapped to. */
  mappedTo?: string;
  /** A solver role key (`Sun.Lead` …), or `total_counts` for an internally inconsistent total. */
  roleKey: string;
  derived: number;
  exported: number;
  /** `derived − exported`. */
  delta: number;
  /** The worst verdict among the parts. */
  verdict: Verdict;
  /** The class of the first part carrying that verdict. */
  class: DiffClass;
  /** How the difference was attributed; the amounts sum to `|delta|`. */
  parts: CellPart[];
}

/** Rule 1: a duplicate weekend target blocks the cutover by itself. */
export interface DiffBlocker {
  verdict: "bug";
  class: "duplicate_target";
  type: WeekendRoleType;
  day: string;
  roleIds: string[];
}

export interface RenameRecord {
  month: string;
  exportKey: string;
  name: string;
  arm: "raw_id" | "rename";
}

export interface SessionReceipt {
  receiptId: string;
  roleId: string | null;
  createdAt: string | null;
  state: string | null;
  source: "document" | "out_of_window";
}

export interface SessionGroup {
  start: string;
  end: string;
  receipts: SessionReceipt[];
}

/**
 * What rule 4b concluded about the month's latest create session.
 * `not_compared`: the month never reached rule 4 (an earlier rule decided it,
 * or the export has no entry for it).
 */
export type LatestSessionStatus =
  | "explained"
  | "unverified"
  | "not_admitted"
  | "one_session"
  | "no_receipts"
  | "undetermined"
  | "not_compared";

export interface MonthSessions {
  month: string;
  groups: SessionGroup[];
  latest: LatestSessionStatus;
  reason: string;
}

export interface ClassTotals {
  /** Cells whose deciding class this is. */
  cells: number;
  /** Seats accounted for by this class across every part — the per-arm hit line. */
  units: number;
}

export interface DiffTotals {
  cells: Record<Verdict, number>;
  /** Only the classes that were hit, in rule order. */
  byClass: Partial<Record<DiffClass, ClassTotals>>;
  blockers: number;
}

export interface HistoryDiffResult {
  target: { year: number; month: number; key: string };
  window: MonthRef[];
  cells: DiffCell[];
  blockers: DiffBlocker[];
  renames: RenameRecord[];
  sessions: MonthSessions[];
  totals: DiffTotals;
  control: { withReceipt: number; unchanged: number };
  /** Evidence the verdicts do not rest on but Frank should see: ids only. */
  notes: string[];
}

export interface ClassifyInput {
  target: SolverHistoryTarget;
  primary: SolverHistoryEntry[];
  others: SolverHistoryEntry[][];
  derived: SolverHistoryResult;
  sessionGapMinutes: number;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function describe(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

/** Months as one integer, so `2026-10` sorts after `2026-9` — never the key as a string. */
export function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function monthRefOf(index: number): MonthRef {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { key: `${year}-${month}`, year, month };
}

/** `2026-11` (the route's zero-padded month) for a target. */
export function targetKeyOf(target: SolverHistoryTarget): string {
  return `${target.year}-${String(target.month).padStart(2, "0")}`;
}

const TARGET_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` → a target, or null. */
export function parseTargetKey(key: string): SolverHistoryTarget | null {
  const m = TARGET_RE.exec(key);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The month index of a stored `YYYY-MM-DD`, or null. Integer arithmetic, never a Date (R5). */
function monthOfDay(day: string | null | undefined): number | null {
  if (typeof day !== "string") return null;
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? monthIndex(Number(m[1]), month) : null;
}

/** Solver role key → the weekend type whose documents carry it (`Sun.*` ↔ Sunday). */
const ROLE_KEY_TYPE: ReadonlyMap<string, WeekendRoleType> = new Map(
  (Object.entries(DERIVED_HISTORY_ROLE_KEYS) as [WeekendRoleType, Record<string, string | null>][]).flatMap(
    ([type, keys]) => Object.values(keys).flatMap((roleKey) => (roleKey ? [[roleKey, type] as const] : [])),
  ),
);

/** Stable JSON: object keys sorted, so two captures of one result compare equal byte for byte. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort(compareStrings)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// ─── Parsing the export (R13) ────────────────────────────────────────────────

function countMap(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (!entries.every(([, n]) => isCount(n))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function roleCountMap(v: unknown): Record<string, Record<string, number>> | null {
  if (!isObj(v)) return null;
  const out: [string, Record<string, number>][] = [];
  for (const [name, byRole] of Object.entries(v)) {
    const counts = countMap(byRole);
    if (!counts) return null;
    out.push([name, counts]);
  }
  return Object.fromEntries(out);
}

function parseEntry(v: unknown, where: string): SolverHistoryEntry {
  if (!isObj(v)) throw new Error(`${where}: expected an object, got ${describe(v)}`);
  const { key, year, month } = v;
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 9999) {
    throw new Error(`${where}: year must be an integer, got ${JSON.stringify(year)}`);
  }
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) {
    throw new Error(`${where}: month must be an integer from 1 to 12, got ${JSON.stringify(month)}`);
  }
  if (key !== `${year}-${month}`) {
    throw new Error(`${where}: key ${JSON.stringify(key)} is not "${year}-${month}" (the browser writes it unpadded)`);
  }
  const total_counts = countMap(v.total_counts);
  if (!total_counts) throw new Error(`${where}: total_counts must map names to non-negative integers`);
  const role_counts = roleCountMap(v.role_counts);
  if (!role_counts) throw new Error(`${where}: role_counts must map names to { roleKey: non-negative integer }`);
  return { key: key as string, year: year as number, month: month as number, total_counts, role_counts };
}

/**
 * Frank's export (R13): the string `copy(localStorage.getItem("owt_solver_history_v2"))`
 * puts on the clipboard, or that value already parsed. `null` — the store was
 * empty — is an export with no entries. Zero counts are KEPT: they are rule 3a's
 * signature. Anything malformed throws, naming `label` and the entry.
 */
export function parseExport(raw: unknown, label = "export"): SolverHistoryEntry[] {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") throw new Error(`${label}: empty — an empty store is exported as null`);
    try {
      value = JSON.parse(text);
    } catch (e) {
      throw new Error(`${label}: not JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    // A value pasted with its quotes on is still unambiguous: unwrap one level.
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (e) {
        throw new Error(`${label}: not JSON inside the quoted string (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array of history entries (or null), got ${describe(value)}`);
  const entries = value.map((e, i) => parseEntry(e, `${label}[${i}]`));
  const seen = new Set<number>();
  for (const e of entries) {
    const idx = monthIndex(e.year, e.month);
    if (seen.has(idx)) throw new Error(`${label}: month ${e.key} appears twice — the browser keeps one entry per month`);
    seen.add(idx);
  }
  return entries;
}

// ─── Parsing the derived side (the route's evidence result) ─────────────────

const RECEIPT_STATES = new Set(["committed", "role_deleted"]);
const WEEKEND_TYPES = new Set(["sunday_role", "saturday_role"]);

function nullableString(v: unknown): boolean {
  return v === null || typeof v === "string";
}

function validReceiptLink(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (v.status === "unstamped") return true;
  if (v.status === "not_found") return nullableString(v.receiptId);
  return (
    v.status === "found" &&
    typeof v.receiptId === "string" &&
    (v.state === null || RECEIPT_STATES.has(v.state as string)) &&
    nullableString(v.targetDay) &&
    nullableString(v.createdAt)
  );
}

function validDocument(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v.roleId === "string" &&
    WEEKEND_TYPES.has(v.type as string) &&
    nullableString(v.day) &&
    validReceiptLink(v.receipt) &&
    (v.unchangedAs === null || v.unchangedAs === "published" || v.unchangedAs === "draft") &&
    typeof v.emptySeatCreate === "boolean" &&
    (v.excluded === null || v.excluded === "duplicate_target" || v.excluded === "invalid_date") &&
    roleCountMap(v.contributes) !== null
  );
}

function validOutOfWindowReceipt(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v.receiptId === "string" &&
    (v.state === null || RECEIPT_STATES.has(v.state as string)) &&
    WEEKEND_TYPES.has(v.type as string) &&
    typeof v.targetDay === "string" &&
    nullableString(v.createdAt) &&
    nullableString(v.roleId) &&
    typeof v.roleFound === "boolean" &&
    nullableString(v.roleCurrentDay)
  );
}

function sameCounts(a: Record<string, Record<string, number>>, b: Record<string, Record<string, number>>): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * The builder's result for `target`, as the Gate B snippet captured it from
 * `GET /api/admin/solver-history?month=…&evidence=1`. Refuses anything that is
 * not exactly that: another month's window, a missing evidence block, or
 * entries that disagree with the documents' `contributes` (task 3's invariant —
 * per-cell attribution rests on it).
 */
export function parseDerivedResult(body: unknown, target: SolverHistoryTarget, label: string): SolverHistoryResult {
  if (!isObj(body)) throw new Error(`${label}: expected the route's JSON object, got ${describe(body)}`);
  const window = historyWindow(target);
  const entries = body.entries;
  if (
    !Array.isArray(entries) ||
    entries.length !== window.length ||
    !entries.every((e, i) => isObj(e) && e.key === window[i].key && e.year === window[i].year && e.month === window[i].month)
  ) {
    throw new Error(`${label}: entries are not the window of ${targetKeyOf(target)}`);
  }
  entries.forEach((e, i) => parseEntry(e, `${label} entries[${i}]`));
  if (isObj(body.target) && (body.target.year !== target.year || body.target.month !== target.month)) {
    throw new Error(`${label}: carries target ${JSON.stringify(body.target)}, not ${targetKeyOf(target)}`);
  }
  const months = body.months;
  if (!Array.isArray(months) || months.length !== window.length || !months.every((m, i) => isObj(m) && m.key === window[i].key && isCount(m.services))) {
    throw new Error(`${label}: months are not the window of ${targetKeyOf(target)}`);
  }
  const diagnostics = body.diagnostics;
  if (
    !isObj(diagnostics) ||
    !Array.isArray(diagnostics.duplicateTargets) ||
    !Array.isArray(diagnostics.danglingSeats) ||
    !Array.isArray(diagnostics.unnamedMembers) ||
    !Array.isArray(diagnostics.duplicateNames) ||
    !diagnostics.duplicateTargets.every(
      (d) => isObj(d) && WEEKEND_TYPES.has(d.type as string) && typeof d.day === "string" && Array.isArray(d.roleIds),
    )
  ) {
    throw new Error(`${label}: diagnostics are malformed`);
  }
  const evidence = body.evidence;
  if (!isObj(evidence)) throw new Error(`${label}: no evidence — capture it with evidence=1, as a super-admin`);
  if (!Array.isArray(evidence.documents) || !evidence.documents.every(validDocument)) {
    throw new Error(`${label}: evidence.documents are malformed`);
  }
  if (!Array.isArray(evidence.outOfWindowReceipts) || !evidence.outOfWindowReceipts.every(validOutOfWindowReceipt)) {
    throw new Error(`${label}: evidence.outOfWindowReceipts are malformed`);
  }
  if (!Array.isArray(evidence.members) || !evidence.members.every((m) => isObj(m) && typeof m.id === "string" && nullableString(m.name))) {
    throw new Error(`${label}: evidence.members are malformed`);
  }
  if (!isObj(evidence.control) || !isCount(evidence.control.withReceipt) || !isCount(evidence.control.unchanged)) {
    throw new Error(`${label}: evidence.control is malformed`);
  }

  const result = body as unknown as SolverHistoryResult;
  const documents = (evidence.documents as SolverHistoryDocumentEvidence[]).filter((d) => d.excluded === null);
  window.forEach((w, i) => {
    const idx = monthIndex(w.year, w.month);
    const sum = new Map<string, Map<string, number>>();
    for (const d of documents) {
      if (monthOfDay(d.day) !== idx) continue;
      for (const [name, byRole] of Object.entries(d.contributes)) {
        const row = sum.get(name) ?? new Map<string, number>();
        for (const [roleKey, n] of Object.entries(byRole)) row.set(roleKey, (row.get(roleKey) ?? 0) + n);
        sum.set(name, row);
      }
    }
    const summed = Object.fromEntries([...sum].map(([name, row]) => [name, Object.fromEntries(row)]));
    if (!sameCounts(summed, result.entries[i].role_counts)) {
      throw new Error(`${label}: entries disagree with the documents' contributes for ${w.key} — a builder defect; do not use this capture`);
    }
  });
  return result;
}

// ─── Bundles (the Gate B snippet's output) ───────────────────────────────────

export type BundleTarget = { usable: true; result: SolverHistoryResult } | { usable: false; reason: string };

export interface ParsedBundle {
  label: string;
  origin: string;
  takenAt: string;
  exportEntries: SolverHistoryEntry[];
  /** The snippet's `NEXT`: its first target. */
  next: string | null;
  targets: Map<string, BundleTarget>;
}

/** `{ origin, takenAt, exportRaw, derived: { [YYYY-MM]: { status, body } } }`. */
export function parseBundle(json: unknown, label: string): ParsedBundle {
  if (!isObj(json)) throw new Error(`${label}: expected the snippet's JSON object, got ${describe(json)}`);
  if (typeof json.origin !== "string") throw new Error(`${label}: origin is missing`);
  if (typeof json.takenAt !== "string") throw new Error(`${label}: takenAt is missing`);
  if (!("exportRaw" in json)) throw new Error(`${label}: exportRaw is missing`);
  if (json.exportRaw !== null && typeof json.exportRaw !== "string") {
    throw new Error(`${label}: exportRaw must be the stored string or null`);
  }
  if (!isObj(json.derived)) throw new Error(`${label}: derived is missing`);
  const exportEntries = parseExport(json.exportRaw, `${label} exportRaw`);
  const targets = new Map<string, BundleTarget>();
  for (const [key, value] of Object.entries(json.derived)) {
    const target = parseTargetKey(key);
    if (!target) throw new Error(`${label}: derived key ${JSON.stringify(key)} is not YYYY-MM`);
    if (!isObj(value) || typeof value.status !== "number") throw new Error(`${label}: derived[${key}] has no status`);
    if (value.status !== 200) {
      targets.set(key, { usable: false, reason: `HTTP ${value.status}` });
    } else if (!isObj(value.body) || value.body.evidence === undefined || value.body.evidence === null) {
      targets.set(key, { usable: false, reason: "no evidence (captured without evidence=1, or not as super-admin)" });
    } else {
      targets.set(key, { usable: true, result: parseDerivedResult(value.body, target, `${label} derived[${key}]`) });
    }
  }
  const keys = [...targets.keys()];
  return { label, origin: json.origin, takenAt: json.takenAt, exportEntries, next: keys[0] ?? null, targets };
}

export type MergedTarget = { usable: true; result: SolverHistoryResult; from: string[] } | { usable: false; reasons: string[] };

/**
 * One derived result per target across every bundle (one bundle per browser
 * profile). Two captures of one target must agree byte for byte: if the data
 * changed between them, no single snapshot is being compared, so this refuses.
 */
export function mergeBundles(bundles: readonly ParsedBundle[]): Map<string, MergedTarget> {
  const merged = new Map<string, MergedTarget>();
  for (const bundle of bundles) {
    for (const [key, t] of bundle.targets) {
      const existing = merged.get(key);
      if (t.usable) {
        if (existing?.usable) {
          if (stableStringify(existing.result) !== stableStringify(t.result)) {
            throw new Error(
              `bundles disagree on ${key}: ${existing.from.join(", ")} vs ${bundle.label} — the services changed between the captures. ` +
                `Run Gate B's snippet again in each profile, without planning in between.`,
            );
          }
          existing.from.push(bundle.label);
        } else {
          merged.set(key, { usable: true, result: t.result, from: [bundle.label] });
        }
      } else if (!existing) {
        merged.set(key, { usable: false, reasons: [`${bundle.label}: ${t.reason}`] });
      } else if (!existing.usable) {
        existing.reasons.push(`${bundle.label}: ${t.reason}`);
      }
    }
  }
  return merged;
}

/**
 * The targets an export needs as primary (decision D9): every `NEXT`, plus
 * `m + 1` for each export month, so that every export month is the newest month
 * of some window. Sorted as months.
 */
export function neededTargets(entries: readonly SolverHistoryEntry[], nexts: readonly string[]): string[] {
  const idx = new Set<number>();
  for (const n of nexts) {
    const t = parseTargetKey(n);
    if (t) idx.add(monthIndex(t.year, t.month));
  }
  for (const e of entries) idx.add(monthIndex(e.year, e.month) + 1);
  return [...idx].sort((a, b) => a - b).map((i) => {
    const m = monthRefOf(i);
    return targetKeyOf(m);
  });
}

// ─── The classifier ──────────────────────────────────────────────────────────

/** name → role key → seats, plus name → total, as Maps: no name can reach a prototype. */
interface MonthCounts {
  roles: Map<string, Map<string, number>>;
  totals: Map<string, number>;
}

function countsOf(entry: SolverHistoryEntry | undefined): MonthCounts {
  const roles = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  if (entry) {
    for (const [name, byRole] of Object.entries(entry.role_counts)) roles.set(name, new Map(Object.entries(byRole)));
    for (const [name, n] of Object.entries(entry.total_counts)) totals.set(name, n);
  }
  return { roles, totals };
}

function hasZeroRow(entry: SolverHistoryEntry): boolean {
  return (
    Object.values(entry.total_counts).some((n) => n === 0) ||
    Object.values(entry.role_counts).some((byRole) => Object.values(byRole).some((n) => n === 0))
  );
}

function roleSum(row: Map<string, number> | undefined): number {
  let sum = 0;
  for (const n of row?.values() ?? []) sum += n;
  return sum;
}

interface RawCell {
  member: string;
  roleKey: string;
  derived: number;
  exported: number;
}

/** Every differing cell of one month. `total_counts` compares each side's total MINUS its own role sum. */
function diffCells(d: MonthCounts, e: MonthCounts): RawCell[] {
  const members = new Set([...d.roles.keys(), ...e.roles.keys(), ...d.totals.keys(), ...e.totals.keys()]);
  const out: RawCell[] = [];
  for (const member of members) {
    const dRow = d.roles.get(member);
    const eRow = e.roles.get(member);
    for (const roleKey of new Set([...(dRow?.keys() ?? []), ...(eRow?.keys() ?? [])])) {
      const derived = dRow?.get(roleKey) ?? 0;
      const exported = eRow?.get(roleKey) ?? 0;
      if (derived !== exported) out.push({ member, roleKey, derived, exported });
    }
    const dGap = (d.totals.get(member) ?? 0) - roleSum(dRow);
    const eGap = (e.totals.get(member) ?? 0) - roleSum(eRow);
    if (dGap !== eGap) out.push({ member, roleKey: TOTAL_KEY, derived: dGap, exported: eGap });
  }
  return out;
}

function mapsEqual(a: Map<string, number> | undefined, b: Map<string, number> | undefined): boolean {
  const aKeys = [...(a?.entries() ?? [])].filter(([, n]) => n !== 0);
  const bKeys = [...(b?.entries() ?? [])].filter(([, n]) => n !== 0);
  return aKeys.length === bKeys.length && aKeys.every(([k, n]) => b?.get(k) === n);
}

function buildCell(month: MonthRef, raw: RawCell, parts: CellPart[], mappedTo?: string): DiffCell {
  let decisive = parts[0];
  for (const p of parts) {
    if (VERDICT_RANK[CLASS_VERDICT[p.class]] > VERDICT_RANK[CLASS_VERDICT[decisive.class]]) decisive = p;
  }
  return {
    month,
    member: raw.member,
    ...(mappedTo !== undefined ? { mappedTo } : {}),
    roleKey: raw.roleKey,
    derived: raw.derived,
    exported: raw.exported,
    delta: raw.derived - raw.exported,
    verdict: CLASS_VERDICT[decisive.class],
    class: decisive.class,
    parts,
  };
}

interface SessionEntry extends SessionReceipt {
  ms: number | null;
  doc?: SolverHistoryDocumentEvidence;
  receipt?: SolverHistoryOutOfWindowReceipt;
}

interface MonthSessionState {
  groups: SessionEntry[][];
  undetermined: string[];
}

/**
 * Rule 4b's sessions for one month (decision D8): the month's weekend receipts —
 * those whose TARGET day is in it, committed or role_deleted, empty-seat creates
 * left out — sorted by `createdAt`, a new session after a gap of more than
 * `gapMinutes`. A month the grouping cannot be trusted for is `undetermined`.
 */
function monthSessions(idx: number, evidence: SolverHistoryEvidence, gapMinutes: number): MonthSessionState {
  const entries: SessionEntry[] = [];
  const undetermined: string[] = [];
  for (const d of evidence.documents) {
    if (d.receipt.status === "not_found" && monthOfDay(d.day) === idx) {
      undetermined.push(`role:${d.roleId} carries a creation stamp whose receipt was not found`);
    }
    if (d.receipt.status !== "found" || monthOfDay(d.receipt.targetDay) !== idx || d.emptySeatCreate) continue;
    const ms = d.receipt.createdAt === null ? NaN : Date.parse(d.receipt.createdAt);
    entries.push({
      receiptId: d.receipt.receiptId,
      roleId: d.roleId,
      createdAt: d.receipt.createdAt,
      state: d.receipt.state,
      source: "document",
      ms: Number.isFinite(ms) ? ms : null,
      doc: d,
    });
  }
  for (const r of evidence.outOfWindowReceipts) {
    if (monthOfDay(r.targetDay) !== idx) continue;
    const ms = r.createdAt === null ? NaN : Date.parse(r.createdAt);
    entries.push({
      receiptId: r.receiptId,
      roleId: r.roleId,
      createdAt: r.createdAt,
      state: r.state,
      source: "out_of_window",
      ms: Number.isFinite(ms) ? ms : null,
      receipt: r,
    });
  }
  for (const e of entries) {
    if (e.ms === null) undetermined.push(`receipt:${e.receiptId} has no usable createdAt`);
    if (e.state === null) undetermined.push(`receipt:${e.receiptId} has no state`);
  }
  const timed = entries
    .filter((e) => e.ms !== null)
    .sort((a, b) => (a.ms as number) - (b.ms as number) || compareStrings(a.receiptId, b.receiptId));
  const groups: SessionEntry[][] = [];
  const gapMs = gapMinutes * 60_000;
  for (const e of timed) {
    const last = groups[groups.length - 1];
    if (last && (e.ms as number) - (last[last.length - 1].ms as number) <= gapMs) last.push(e);
    else groups.push([e]);
  }
  return { groups, undetermined: undetermined.sort(compareStrings) };
}

interface LatestVerdict {
  status: LatestSessionStatus;
  reason: string;
  earlierReceiptIds: Set<string>;
}

function latestSessionVerdict(
  idx: number,
  sessions: MonthSessionState,
  mappedExport: MonthCounts,
  inWindowDay: (day: string | null) => boolean,
): LatestVerdict {
  const none = new Set<string>();
  if (sessions.undetermined.length > 0) {
    return { status: "undetermined", reason: sessions.undetermined.join("; "), earlierReceiptIds: none };
  }
  if (sessions.groups.length === 0) return { status: "no_receipts", reason: "no create receipt targets this month", earlierReceiptIds: none };
  if (sessions.groups.length === 1) return { status: "one_session", reason: "one create session: nothing predates it", earlierReceiptIds: none };

  const earlierReceiptIds = new Set(sessions.groups.slice(0, -1).flatMap((g) => g.map((e) => e.receiptId)));
  const latest = sessions.groups[sessions.groups.length - 1];
  const changed: string[] = [];
  const other: string[] = [];
  const sum: MonthCounts = { roles: new Map(), totals: new Map() };
  for (const e of latest) {
    if (e.doc) {
      const d = e.doc;
      if (d.unchangedAs === null) changed.push(`role:${d.roleId} changed`);
      else if (d.excluded !== null || monthOfDay(d.day) !== idx) other.push(`role:${d.roleId} is not counted in this month`);
      else {
        for (const [name, byRole] of Object.entries(d.contributes)) {
          const row = sum.roles.get(name) ?? new Map<string, number>();
          for (const [roleKey, n] of Object.entries(byRole)) row.set(roleKey, (row.get(roleKey) ?? 0) + n);
          sum.roles.set(name, row);
        }
      }
    } else if (e.receipt) {
      const r = e.receipt;
      if (r.roleFound && !inWindowDay(r.roleCurrentDay)) changed.push(`receipt:${r.receiptId}'s role moved out of the window`);
      else if (r.roleFound) other.push(`receipt:${r.receiptId}'s role is inside the window but was not read with it (a race)`);
      else if (r.state === "role_deleted") other.push(`receipt:${r.receiptId}'s role was deleted`);
      else other.push(`receipt:${r.receiptId}'s role is missing without a role_deleted receipt`);
    }
  }
  if (changed.length > 0) {
    return { status: "unverified", reason: `a latest-session document has since changed: ${changed.join("; ")}`, earlierReceiptIds };
  }
  if (other.length > 0) return { status: "not_admitted", reason: other.join("; "), earlierReceiptIds };
  const members = new Set([...sum.roles.keys(), ...mappedExport.roles.keys()]);
  const equal = [...members].every((m) => mapsEqual(sum.roles.get(m), mappedExport.roles.get(m)));
  return equal
    ? { status: "explained", reason: "the export equals the unchanged latest session exactly", earlierReceiptIds }
    : { status: "not_admitted", reason: "the export does not equal the latest session's counts", earlierReceiptIds };
}

function classOrder(c: DiffClass): number {
  return DIFF_CLASSES.indexOf(c);
}

/**
 * R11 for one target: every difference between `primary` (an export, used as the
 * primary) and `derived` (the builder's evidence result for `target`), over the
 * union of the target's window months and the export's months.
 */
export function classifyHistoryDiff(input: ClassifyInput): HistoryDiffResult {
  const { target, primary, others, derived, sessionGapMinutes } = input;
  const evidence = derived.evidence;
  if (!evidence) throw new Error("classifyHistoryDiff: the derived result carries no evidence");

  const window = historyWindow(target);
  const targetIdx = monthIndex(target.year, target.month);
  const windowIdx = window.map((w) => monthIndex(w.year, w.month));
  const inWindow = (idx: number | null) => idx !== null && windowIdx.includes(idx);
  const inWindowDay = (day: string | null) => inWindow(monthOfDay(day));

  const exportByIdx = new Map(primary.map((e) => [monthIndex(e.year, e.month), e]));
  const otherIdx = new Set(others.flat().map((e) => monthIndex(e.year, e.month)));
  const derivedByIdx = new Map(derived.entries.map((e) => [monthIndex(e.year, e.month), e]));
  const servicesByIdx = new Map(derived.months.map((m) => [monthIndex(m.year, m.month), m.services]));

  const currentNames = new Set(evidence.members.flatMap((m) => (typeof m.name === "string" && m.name ? [m.name] : [])));
  const nameById = new Map(evidence.members.flatMap((m) => (typeof m.name === "string" && m.name ? [[m.id, m.name] as const] : [])));

  const blockers: DiffBlocker[] = derived.diagnostics.duplicateTargets
    .map((d) => ({ verdict: "bug" as const, class: "duplicate_target" as const, type: d.type, day: d.day, roleIds: [...d.roleIds].sort(compareStrings) }))
    .sort((a, b) => compareStrings(a.day, b.day) || compareStrings(a.type, b.type));
  const duplicateIdx = new Set(blockers.flatMap((b) => {
    const idx = monthOfDay(b.day);
    return idx === null ? [] : [idx];
  }));

  const sessionState = new Map(windowIdx.map((idx) => [idx, monthSessions(idx, evidence, sessionGapMinutes)]));
  const latestByIdx = new Map<number, LatestVerdict>();

  const cells: DiffCell[] = [];
  const renames: RenameRecord[] = [];
  const domain = [...new Set([...windowIdx, ...exportByIdx.keys()])].sort((a, b) => a - b);

  for (const idx of domain) {
    const month = monthRefOf(idx);
    const exportEntry = exportByIdx.get(idx);
    const derivedEntry = derivedByIdx.get(idx);
    const rawCells = diffCells(countsOf(derivedEntry), countsOf(exportEntry));

    // Rules 1 and 2 decide whole months.
    let monthClass: DiffClass | null = null;
    if (duplicateIdx.has(idx)) monthClass = "duplicate_target";
    else if (exportEntry && !inWindow(idx)) monthClass = idx >= targetIdx ? "future" : "outside_window";
    else if (!exportEntry && inWindow(idx)) {
      if (primary.length >= EXPORT_CAPACITY) monthClass = "evicted_or_deleted";
      else if (otherIdx.has(idx)) monthClass = "another_profile";
      else if ((servicesByIdx.get(idx) ?? 0) > 0) monthClass = "deleted_by_hand_or_never_written";
    }
    if (monthClass) {
      for (const raw of rawCells) cells.push(buildCell(month, raw, [{ class: monthClass, amount: Math.abs(raw.derived - raw.exported), evidence: [] }]));
      continue;
    }
    if (!exportEntry) {
      for (const raw of rawCells) {
        cells.push(buildCell(month, raw, [{ class: "residual", amount: Math.abs(raw.derived - raw.exported), evidence: ["no arm of rule 2 admits this month's absence"] }]));
      }
      continue;
    }

    // Rule 3a: a raw-response entry, explained for the whole month.
    if (hasZeroRow(exportEntry)) {
      for (const raw of rawCells) cells.push(buildCell(month, raw, [{ class: "raw_response_entry", amount: Math.abs(raw.derived - raw.exported), evidence: [] }]));
      continue;
    }

    // Rule 3b: map the export's keys to current names, then compare under them.
    const exportCounts = countsOf(exportEntry);
    const derivedCounts = countsOf(derivedEntry);
    const exportKeys = new Set([...exportCounts.roles.keys(), ...exportCounts.totals.keys()]);
    const mapping = new Map<string, RenameRecord>();
    const unknown = [...exportKeys].filter((k) => !currentNames.has(k)).sort(compareStrings);
    for (const k of unknown) {
      const name = nameById.get(k);
      if (name) mapping.set(k, { month: month.key, exportKey: k, name, arm: "raw_id" });
    }
    const rawIdNames = new Set([...mapping.values()].map((r) => r.name));
    const candidates = new Map<string, string[]>();
    for (const k of unknown) {
      if (mapping.has(k) || roleSum(exportCounts.roles.get(k)) === 0) continue;
      candidates.set(
        k,
        [...derivedCounts.roles.keys()].filter(
          (n) => !exportKeys.has(n) && !rawIdNames.has(n) && mapsEqual(derivedCounts.roles.get(n), exportCounts.roles.get(k)),
        ),
      );
    }
    const claims = new Map<string, number>();
    for (const names of candidates.values()) for (const n of names) claims.set(n, (claims.get(n) ?? 0) + 1);
    for (const [k, names] of candidates) {
      if (names.length === 1 && claims.get(names[0]) === 1) mapping.set(k, { month: month.key, exportKey: k, name: names[0], arm: "rename" });
    }
    const mapped: MonthCounts = { roles: new Map(), totals: new Map() };
    for (const [k, row] of exportCounts.roles) {
      const name = mapping.get(k)?.name ?? k;
      const into = mapped.roles.get(name) ?? new Map<string, number>();
      for (const [roleKey, n] of row) into.set(roleKey, (into.get(roleKey) ?? 0) + n);
      mapped.roles.set(name, into);
    }
    for (const [k, n] of exportCounts.totals) {
      const name = mapping.get(k)?.name ?? k;
      mapped.totals.set(name, (mapped.totals.get(name) ?? 0) + n);
    }
    for (const record of [...mapping.values()].sort((a, b) => compareStrings(a.exportKey, b.exportKey))) {
      renames.push(record);
      for (const [roleKey, n] of exportCounts.roles.get(record.exportKey) ?? []) {
        if (n === 0) continue;
        cells.push(
          buildCell(
            month,
            { member: record.exportKey, roleKey, derived: 0, exported: n },
            [{ class: "rename_or_unknown_id", amount: n, evidence: [record.arm === "raw_id" ? "the key is this member's _id" : "the one current name carrying exactly these counts"] }],
            record.name,
          ),
        );
      }
    }

    // Rule 4 (then 5), per cell, under current names.
    const sessions = sessionState.get(idx)!;
    const latest = latestSessionVerdict(idx, sessions, mapped, inWindowDay);
    latestByIdx.set(idx, latest);

    for (const raw of diffCells(derivedCounts, mapped)) {
      const delta = raw.derived - raw.exported;
      const amount = Math.abs(delta);
      if (raw.roleKey === TOTAL_KEY) {
        cells.push(buildCell(month, raw, [{ class: "residual", amount, evidence: ["total_counts disagrees with the role counts on one side"] }]));
        continue;
      }
      if (delta > 0) {
        cells.push(buildCell(month, raw, derivedHigherParts(idx, raw, delta, evidence, latest)));
      } else {
        cells.push(buildCell(month, raw, exportHigherParts(idx, raw, amount, evidence, inWindowDay)));
      }
    }
  }

  cells.sort(
    (a, b) =>
      monthIndex(a.month.year, a.month.month) - monthIndex(b.month.year, b.month.month) ||
      compareStrings(a.member, b.member) ||
      compareStrings(a.roleKey, b.roleKey),
  );

  const sessions: MonthSessions[] = windowIdx.map((idx) => {
    const state = sessionState.get(idx)!;
    const latest = latestByIdx.get(idx);
    return {
      month: monthRefOf(idx).key,
      groups: state.groups.map((g) => ({
        start: g[0].createdAt as string,
        end: g[g.length - 1].createdAt as string,
        receipts: g.map(({ receiptId, roleId, createdAt, state: s, source }) => ({ receiptId, roleId, createdAt, state: s, source })),
      })),
      latest: latest?.status ?? "not_compared",
      reason: latest?.reason ?? (state.undetermined.length ? state.undetermined.join("; ") : "the month did not reach rule 4"),
    };
  });

  return {
    target: { year: target.year, month: target.month, key: targetKeyOf(target) },
    window: window.map((w) => ({ key: w.key, year: w.year, month: w.month })),
    cells,
    blockers,
    renames,
    sessions,
    totals: totalsOf(cells, blockers),
    control: { withReceipt: evidence.control.withReceipt, unchanged: evidence.control.unchanged },
    notes: notesOf(derived, evidence),
  };
}

/** Rule 4 when the derived count is higher: only documents seating that member in that role, each up to what it contributes. */
function derivedHigherParts(
  idx: number,
  raw: RawCell,
  delta: number,
  evidence: SolverHistoryEvidence,
  latest: LatestVerdict,
): CellPart[] {
  const seats = (d: SolverHistoryDocumentEvidence): number => {
    const row = own(d.contributes, raw.member);
    const n = isObj(row) ? own(row, raw.roleKey) : undefined;
    return typeof n === "number" ? n : 0;
  };
  const candidates = evidence.documents
    .filter((d) => d.excluded === null && monthOfDay(d.day) === idx && seats(d) > 0)
    .map((d) => ({ d, arm: documentArm(d, idx, latest), capacity: seats(d) }));
  const ranked = candidates
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => (a.arm === null ? Infinity : classOrder(a.arm)) - (b.arm === null ? Infinity : classOrder(b.arm)) || a.i - b.i);

  const parts: CellPart[] = [];
  let remaining = delta;
  for (const c of ranked) {
    if (c.arm === null || remaining === 0) continue;
    const take = Math.min(c.capacity, remaining);
    const existing = parts.find((p) => p.class === c.arm);
    if (existing) {
      existing.amount += take;
      existing.evidence.push(`role:${c.d.roleId}`);
    } else {
      parts.push({ class: c.arm, amount: take, evidence: [`role:${c.d.roleId}`] });
    }
    remaining -= take;
  }
  if (remaining > 0) {
    const unexplained = ranked.filter((c) => c.arm === null).map((c) => `unexplained by role:${c.d.roleId}`);
    parts.push({ class: "residual", amount: remaining, evidence: unexplained.length ? unexplained : ["no weekend document seats this member in this role"] });
  }
  return parts;
}

/** The first arm of rule 4 a window document admits, for the seats it contributes. */
function documentArm(d: SolverHistoryDocumentEvidence, idx: number, latest: LatestVerdict): DiffClass | null {
  if (d.receipt.status === "unstamped") return "created_outside_create_mode_no_receipt";
  if (d.emptySeatCreate) return "created_outside_create_mode_empty_seat";
  // "Created in this month" is already implied — `earlierReceiptIds` holds only receipts
  // targeting this month — and is spelled out because it is the rule's own condition.
  if (d.receipt.status === "found" && monthOfDay(d.receipt.targetDay) === idx && latest.earlierReceiptIds.has(d.receipt.receiptId)) {
    if (latest.status === "explained") return "partial_month_overwrite";
    if (latest.status === "unverified") return "partial_month_overwrite_unverified";
  }
  if (d.receipt.status === "found" && d.unchangedAs === null) return "changed_since_creation";
  return null;
}

/** Rule 4 when the export's count is higher: only a changed, deleted or moved document of the matching type in the month. */
function exportHigherParts(
  idx: number,
  raw: RawCell,
  amount: number,
  evidence: SolverHistoryEvidence,
  inWindowDay: (day: string | null) => boolean,
): CellPart[] {
  const type = ROLE_KEY_TYPE.get(raw.roleKey);
  if (!type) return [{ class: "residual", amount, evidence: [`no weekend document type carries ${raw.roleKey}`] }];

  const changed = evidence.documents.filter(
    (d) =>
      d.type === type &&
      d.receipt.status === "found" &&
      monthOfDay(d.day) === idx &&
      monthOfDay(d.receipt.targetDay) === idx &&
      d.unchangedAs === null,
  );
  if (changed.length) return [{ class: "changed_since_creation", amount, evidence: changed.map((d) => `role:${d.roleId}`) }];

  const deleted = evidence.outOfWindowReceipts.filter(
    (r) => r.type === type && monthOfDay(r.targetDay) === idx && r.state === "role_deleted" && !r.roleFound,
  );
  if (deleted.length) return [{ class: "deleted_since_creation", amount, evidence: deleted.map((r) => `receipt:${r.receiptId}`) }];

  const moved = [
    ...evidence.outOfWindowReceipts
      .filter((r) => r.type === type && monthOfDay(r.targetDay) === idx && r.roleFound && !inWindowDay(r.roleCurrentDay))
      .map((r) => `receipt:${r.receiptId}`),
    ...evidence.documents
      .filter((d) => d.type === type && d.receipt.status === "found" && monthOfDay(d.receipt.targetDay) === idx && monthOfDay(d.day) !== idx)
      .map((d) => `role:${d.roleId}`),
  ];
  if (moved.length) return [{ class: "moved_out_of_month", amount, evidence: moved }];

  return [{ class: "residual", amount, evidence: [`no changed, deleted or moved ${type} created in this month`] }];
}

function totalsOf(cells: readonly DiffCell[], blockers: readonly DiffBlocker[]): DiffTotals {
  const byVerdict: Record<Verdict, number> = { explained: 0, unverified: 0, bug: 0 };
  const byClass = new Map<DiffClass, ClassTotals>();
  const bump = (c: DiffClass) => {
    const t = byClass.get(c) ?? { cells: 0, units: 0 };
    byClass.set(c, t);
    return t;
  };
  for (const cell of cells) {
    byVerdict[cell.verdict] += 1;
    bump(cell.class).cells += 1;
    for (const p of cell.parts) bump(p.class).units += p.amount;
  }
  return {
    cells: byVerdict,
    byClass: Object.fromEntries(DIFF_CLASSES.flatMap((c) => (byClass.has(c) ? [[c, byClass.get(c)!] as const] : []))),
    blockers: blockers.length,
  };
}

function notesOf(derived: SolverHistoryResult, evidence: SolverHistoryEvidence): string[] {
  const notes: string[] = [];
  const invalid = evidence.documents.filter((d) => d.excluded === "invalid_date").map((d) => d.roleId);
  if (invalid.length) notes.push(`documents whose week is not a valid day (counted nowhere): ${invalid.join(", ")}`);
  const notFound = evidence.documents.filter((d) => d.receipt.status === "not_found").map((d) => d.roleId);
  if (notFound.length) notes.push(`documents with a creation stamp whose receipt was not found: ${notFound.join(", ")}`);
  const { danglingSeats, unnamedMembers, duplicateNames } = derived.diagnostics;
  if (danglingSeats.length) notes.push(`dangling seats dropped by the derivation: ${danglingSeats.length}`);
  if (unnamedMembers.length) notes.push(`seated members with no name, dropped: ${unnamedMembers.length}`);
  if (duplicateNames.length) notes.push(`names shared by several members (their counts merge): ${duplicateNames.length}`);
  return notes;
}
