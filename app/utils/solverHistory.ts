// app/utils/solverHistory.ts
//
// The month solver's fairness history, DERIVED from the weekend role documents
// Sanity stores — never from the browser's `localStorage`
// (spec `docs/superpowers/specs/2026-09-23-solver-history-derivation-design.md`,
// R1–R7; plan `docs/superpowers/plans/2026-09-25-owt-mcp-p2-solver-history.md`).
//
// Pure and NEUTRAL (ADR-0028): no `"use client"`, no `server-only`, no Sanity
// client, no `node:crypto`, no Date. The server-side builder, the admin route,
// the planner and the diff CLI all import from here, and the CLI may import only
// neutral modules — so every shared result type lives in this file, and
// `SolverHistoryEntry` is taken from `plannerModel.ts` as a TYPE only.
//
// The rules, in the order `deriveSolverHistory` applies them:
//  - R1  only `sunday_role` and `saturday_role` count; a special is ignored
//        silently (ADR-0010 keeps specials out of the solver's history).
//  - R5  a service's day is `serviceDayKey(week)` — the stored `YYYY-MM-DD`
//        string, which IS its America/Mexico_City calendar date — and its month
//        is that string's year and month. Never a `Date`.
//  - R4  only the three calendar months before the target count; the target
//        month and every later one never do. A role outside the window, and a
//        `drafts.*` overlay, are ignored defensively (the read is already
//        bounded and runs in the published perspective).
//  - R7  two or more documents of one type on one day are an ambiguous target:
//        BOTH are dropped and reported. `indexUniqueByKey` decides, the same
//        helper the read model uses, so the two cannot disagree.
//  - R2, R3  every stored seat of a surviving document counts, whatever its
//        publication state — the publication field is never read.
//  - R6  the counting rules of `historyEntryFromDrafts`, unchanged (see
//        `DERIVED_HISTORY_ROLE_KEYS`); `roleSeatContributions` is the ONE place
//        they are applied, for the derivation and for the diff evidence alike.
//  - R7  people are keyed by their CURRENT `member_name`, verbatim — the string
//        `buildSolveRequest`'s pools use — with no raw-id fallback. A dangling
//        reference, an unnamed member and a shared name are reported, never
//        guessed at.

import type { SolverHistoryEntry } from "@/app/components/admin/plannerModel";
import { indexUniqueByKey, serviceDayKey } from "./serviceReadSelect";

export type { SolverHistoryEntry };

// ─── Shared types (ruling P2-R2) ─────────────────────────────────────────────

/** The month being solved. `month` is 1–12. */
export interface SolverHistoryTarget {
  year: number;
  month: number;
}

/** One month of the window. `key` is `${year}-${month}`, unpadded, like an entry's. */
export interface SolverHistoryWindowMonth {
  key: string;
  year: number;
  month: number;
}

/** A member as the derivation reads one: `{ _id, member_name }` for ALL members. */
export interface SolverHistoryMember {
  _id: string;
  member_name?: string | null;
}

export type WeekendRoleType = "sunday_role" | "saturday_role";

/** The stored voice seats the history can count. Instruments and FOH never count. */
export type CountedSeatPath = "Lead" | "BGVs" | "Chorus";

/** Per-month metadata beside `entries`: how many weekend services fed each entry. */
export interface SolverHistoryMonth extends SolverHistoryWindowMonth {
  /** Weekend documents counted into this month's entry. Dropped duplicate-target copies are not included. */
  services: number;
}

/** Two or more documents of one weekend type on one day. Counted by none of them. */
export interface DuplicateTargetDiagnostic {
  type: WeekendRoleType;
  day: string;
  /** Every document claiming the target, sorted. */
  roleIds: string[];
}

/** A counted seat whose reference names no member. Dropped, never counted. */
export interface DanglingSeatDiagnostic {
  roleId: string;
  day: string;
  path: CountedSeatPath;
  memberId: string;
}

/** A member seated in the window whose `member_name` is not a non-empty string. Dropped. */
export interface UnnamedMemberDiagnostic {
  memberId: string;
}

/** Members sharing one `member_name`, at least one of them seated in the window. Their counts merge, as in the solver. */
export interface DuplicateNameDiagnostic {
  name: string;
  /** EVERY member carrying the name, seated or not, sorted. */
  memberIds: string[];
}

export interface SolverHistoryDiagnostics {
  duplicateTargets: DuplicateTargetDiagnostic[];
  danglingSeats: DanglingSeatDiagnostic[];
  unnamedMembers: UnnamedMemberDiagnostic[];
  duplicateNames: DuplicateNameDiagnostic[];
}

export interface DerivedSolverHistory {
  /** Always three entries, oldest first — one per window month, empty maps when it had no weekend services. */
  entries: SolverHistoryEntry[];
  months: SolverHistoryMonth[];
  diagnostics: SolverHistoryDiagnostics;
}

/** One document's share of the history, under the derivation's seat rules. */
export interface RoleSeatContributions {
  /** member_name → role key → seats. The same shape as an entry's `role_counts`. */
  role_counts: Record<string, Record<string, number>>;
  /** Counted seats whose reference resolves to no member, in stored order. */
  dangling: { path: CountedSeatPath; memberId: string }[];
  /** Referenced members with no usable `member_name`, sorted and unique. */
  unnamedMemberIds: string[];
}

// ─── The counting rules ──────────────────────────────────────────────────────

/**
 * Stored seat path → the solver's role key (`gcf/owt_solver_v2.py:34`).
 *
 * A separate copy of `plannerModel.ts`'s `HISTORY_ROLE_KEYS`, on purpose: D3
 * deletes that constant together with `historyEntryFromDrafts`, and until then
 * the R12 equivalence test proves the two agree. There is no `Sat.Choir` — a
 * Saturday's `Chorus` is ignored — and there is NO `special_role` entry, so a
 * special can never be looked up into a real key.
 */
export const DERIVED_HISTORY_ROLE_KEYS: Readonly<
  Record<WeekendRoleType, Readonly<Record<CountedSeatPath, string | null>>>
> = {
  sunday_role: { Lead: "Sun.Lead", BGVs: "Sun.BGV", Chorus: "Sun.Choir" },
  saturday_role: { Lead: "Sat.Lead", BGVs: "Sat.BGV", Chorus: null },
};

const COUNTED_SEAT_PATHS: readonly CountedSeatPath[] = ["Lead", "BGVs", "Chorus"];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** An explicit check, never a lookup: `DERIVED_HISTORY_ROLE_KEYS["constructor"]` is not undefined. */
function isWeekendRoleType(v: unknown): v is WeekendRoleType {
  return v === "sunday_role" || v === "saturday_role";
}

/** Codepoint order, never `localeCompare`: the output must not depend on the host's locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A plain object with sorted own keys. `Object.fromEntries` defines `__proto__` as an ordinary key. */
function sortedRecord<V>(map: Map<string, V>): Record<string, V> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => compareStrings(a, b)));
}

function bump(counts: Map<string, Map<string, number>>, name: string, roleKey: string, by = 1): void {
  let forName = counts.get(name);
  if (!forName) {
    forName = new Map();
    counts.set(name, forName);
  }
  forName.set(roleKey, (forName.get(roleKey) ?? 0) + by);
}

function roleCountsRecord(counts: Map<string, Map<string, number>>): Record<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const [name, forName] of counts) out.set(name, sortedRecord(forName));
  return sortedRecord(out);
}

/** Index members by `_id` — the `membersById` that `roleSeatContributions` takes. */
export function indexMembersById(
  members: readonly SolverHistoryMember[],
): ReadonlyMap<string, SolverHistoryMember> {
  const out = new Map<string, SolverHistoryMember>();
  for (const member of members) {
    if (isObj(member) && nonEmptyString(member._id) && !out.has(member._id)) out.set(member._id, member);
  }
  return out;
}

/**
 * ONE role document's per-member, per-role-key seat counts under the
 * derivation's rules (ruling P2-R1): the derivation sums these, and the diff
 * evidence reports them per document as `contributes`, so the counting rule
 * exists once.
 *
 * Seat-level rules only. A special or unknown type contributes nothing. Every
 * stored occurrence of a counted seat counts — a member seated twice counts
 * twice, as `historyEntryFromDrafts` does. A seat item with no usable `_ref` is
 * an empty seat and is skipped. The DOCUMENT-level exclusions — outside the
 * window, a `drafts.*` id, a duplicate target — belong to `deriveSolverHistory`,
 * which never calls this on an excluded document.
 */
export function roleSeatContributions(
  role: unknown,
  membersById: ReadonlyMap<string, SolverHistoryMember>,
): RoleSeatContributions {
  const counts = new Map<string, Map<string, number>>();
  const dangling: RoleSeatContributions["dangling"] = [];
  const unnamed = new Set<string>();

  if (isObj(role) && isWeekendRoleType(role._type)) {
    const keys = DERIVED_HISTORY_ROLE_KEYS[role._type];
    for (const path of COUNTED_SEAT_PATHS) {
      const roleKey = keys[path];
      const seat = role[path];
      if (!roleKey || !Array.isArray(seat)) continue;
      for (const item of seat) {
        if (!isObj(item) || !nonEmptyString(item._ref)) continue;
        const member = membersById.get(item._ref);
        if (!member) {
          dangling.push({ path, memberId: item._ref });
        } else if (!nonEmptyString(member.member_name)) {
          unnamed.add(item._ref);
        } else {
          bump(counts, member.member_name, roleKey);
        }
      }
    }
  }

  return {
    role_counts: roleCountsRecord(counts),
    dangling,
    unnamedMemberIds: [...unnamed].sort(compareStrings),
  };
}

// ─── The window ──────────────────────────────────────────────────────────────

/**
 * The three calendar months before `target`, oldest first (R4), by integer
 * arithmetic: November 2026 → Aug, Sep, Oct; January 2027 → Oct, Nov, Dec 2026.
 */
export function historyWindow(target: SolverHistoryTarget): SolverHistoryWindowMonth[] {
  const { year, month } = target;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`historyWindow: not a calendar month: ${String(year)}-${String(month)}`);
  }
  const out: SolverHistoryWindowMonth[] = [];
  for (let back = 3; back >= 1; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = index - y * 12 + 1;
    out.push({ key: `${y}-${m}`, year: y, month: m });
  }
  return out;
}

// ─── The derivation ──────────────────────────────────────────────────────────

interface WindowRole {
  role: Record<string, unknown>;
  id: string;
  type: WeekendRoleType;
  day: string;
  monthIndex: number;
}

/**
 * Derive the solver's fairness history for `target` from stored role documents
 * (`roles`: `ROLE_PROJECTION` rows) and every member's current name. The output
 * does not depend on input order: entries are built from sorted keys and every
 * diagnostic list is sorted.
 */
export function deriveSolverHistory(input: {
  target: SolverHistoryTarget;
  roles: readonly unknown[];
  members: readonly SolverHistoryMember[];
}): DerivedSolverHistory {
  const window = historyWindow(input.target);
  const monthIndexByKey = new Map(window.map((w, i) => [w.key, i]));
  const membersById = indexMembersById(input.members);

  // R1, R5, R4 — keep the weekend roles whose own day falls in the window.
  const inWindow: WindowRole[] = [];
  for (const role of input.roles) {
    if (!isObj(role) || !isWeekendRoleType(role._type)) continue;
    if (!nonEmptyString(role._id) || role._id.startsWith("drafts.")) continue;
    const day = serviceDayKey(role.week);
    if (!day) continue;
    const monthIndex = monthIndexByKey.get(`${Number(day.slice(0, 4))}-${Number(day.slice(5, 7))}`);
    if (monthIndex === undefined) continue;
    inWindow.push({ role, id: role._id, type: role._type, day, monthIndex });
  }

  // R7 — an ambiguous target is dropped whole, by the read model's own rule.
  const targetKey = (r: WindowRole) => `${r.type}:${r.day}`;
  const unique = indexUniqueByKey(inWindow, targetKey);
  const duplicates = new Map<string, DuplicateTargetDiagnostic>();
  for (const r of inWindow) {
    const key = targetKey(r);
    if (unique.has(key)) continue;
    const found = duplicates.get(key);
    if (found) found.roleIds.push(r.id);
    else duplicates.set(key, { type: r.type, day: r.day, roleIds: [r.id] });
  }

  // R2, R3, R6, R7 — count every seat of every surviving document.
  const monthCounts = window.map(() => new Map<string, Map<string, number>>());
  const services = window.map(() => 0);
  const danglingSeats: DanglingSeatDiagnostic[] = [];
  const unnamed = new Set<string>();
  for (const r of unique.values()) {
    const share = roleSeatContributions(r.role, membersById);
    services[r.monthIndex] += 1;
    for (const [name, forName] of Object.entries(share.role_counts)) {
      for (const [roleKey, n] of Object.entries(forName)) bump(monthCounts[r.monthIndex], name, roleKey, n);
    }
    for (const d of share.dangling) danglingSeats.push({ roleId: r.id, day: r.day, ...d });
    for (const id of share.unnamedMemberIds) unnamed.add(id);
  }

  // R7 — a shared name matters only when it was counted, which is exactly when
  // a window seat referenced one of its members; scoping by it also keeps an
  // unseated member's name out of the payload.
  const countedNames = new Set(monthCounts.flatMap((counts) => [...counts.keys()]));
  const idsByName = new Map<string, string[]>();
  for (const member of membersById.values()) {
    if (!nonEmptyString(member.member_name) || !countedNames.has(member.member_name)) continue;
    const ids = idsByName.get(member.member_name);
    if (ids) ids.push(member._id);
    else idsByName.set(member.member_name, [member._id]);
  }

  const entries: SolverHistoryEntry[] = window.map((w, i) => {
    const total = new Map<string, number>();
    for (const [name, forName] of monthCounts[i]) {
      total.set(name, [...forName.values()].reduce((sum, n) => sum + n, 0));
    }
    return {
      key: w.key,
      year: w.year,
      month: w.month,
      total_counts: sortedRecord(total),
      role_counts: roleCountsRecord(monthCounts[i]),
    };
  });

  return {
    entries,
    months: window.map((w, i) => ({ ...w, services: services[i] })),
    diagnostics: {
      duplicateTargets: [...duplicates.values()]
        .map((d) => ({ ...d, roleIds: [...d.roleIds].sort(compareStrings) }))
        .sort((a, b) => compareStrings(a.day, b.day) || compareStrings(a.type, b.type)),
      danglingSeats: danglingSeats.sort(
        (a, b) =>
          compareStrings(a.day, b.day) ||
          compareStrings(a.roleId, b.roleId) ||
          compareStrings(a.path, b.path) ||
          compareStrings(a.memberId, b.memberId),
      ),
      unnamedMembers: [...unnamed].sort(compareStrings).map((memberId) => ({ memberId })),
      duplicateNames: [...idsByName.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([name, ids]) => ({ name, memberIds: [...ids].sort(compareStrings) }))
        .sort((a, b) => compareStrings(a.name, b.name)),
    },
  };
}
