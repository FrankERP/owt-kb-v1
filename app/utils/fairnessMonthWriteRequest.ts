// app/utils/fairnessMonthWriteRequest.ts
//
// THE write-request module of the monthly eligibility record (`fairnessMonth`, solver v3
// C2 REC, WR; spec IF2-18 … IF2-22). It owns everything about the stored shape: the id
// and every `_key` (only this module constructs them, REC-1), the body validator (WR-3,
// WR-4, WR-17), the content hash (REC-6), the stored-record parser (RD-2), the write
// decision for both actors (WR-8, WR-14) and the ONE write executor (WR-16).
//
// NEUTRAL BUT NOT CLIENT-IMPORTABLE: no "use client", no `server-only`, no module-level
// Sanity client — C4's `tsx` script imports it with its own injected clients — but it
// hashes with `node:crypto`, so no client module may import it. The eligibility
// resolver (IF2-15), which IS client-callable, lives in `fairnessEligibility.ts`.
//
// Key hygiene (spec §6): every issue's `path` is index-based (field names and array
// indexes in input order) and every `message` is a fixed text — no member id, name,
// `ruleKey` or other stored value — so an issue may be logged or returned safely.

import { createHash } from "node:crypto";

import {
  ROLE_KEYS,
  canonicalRoles,
  compareCodepoint,
  isMonthString,
  isRoleKey,
  isStatus,
  monthIndex,
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type LogicalRecord,
  type RoleKey,
  type Status,
} from "./fairnessVocabulary";
import { isValidServiceDate } from "./serviceReadModel";

export const FAIRNESS_MONTH_TYPE = "fairnessMonth";
export const FAIRNESS_SCHEMA_VERSION = 1;

/** Who may write: the PUT (`route`) or C4's consented script (`reconstruction`). */
export type Actor = "route" | "reconstruction";

/** One validation issue (IF2-18's format, shared by IF2-20 and IF2-22). */
export interface FairnessIssue {
  path: string;
  message: string;
}

/** The stored field of each role key — dotted field names are invalid in Sanity (REC-3). */
export const ROLE_FIELD: Readonly<Record<RoleKey, "sunLead" | "satLead" | "sunBgv" | "satBgv" | "sunChoir" | "satChoir">> = {
  "Sun.Lead": "sunLead",
  "Sat.Lead": "satLead",
  "Sun.BGV": "sunBgv",
  "Sat.BGV": "satBgv",
  "Sun.Choir": "sunChoir",
  "Sat.Choir": "satChoir",
};

// ─── Identity and keys (REC-1, REC-3, REC-4) ─────────────────────────────────

/** The record's id: dotted, so private (parent A2). Only this module builds it. */
export function fairnessMonthId(month: string): string {
  return `${FAIRNESS_MONTH_TYPE}.${month}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** `"p"` + 24 hex of SHA-256 of the member `_id` — never the raw id, which may contain dots. */
export function personKey(memberId: string): string {
  return `p${sha256Hex(memberId).slice(0, 24)}`;
}

/** `"x"` + 24 hex of SHA-256 of the canonical role list. */
export function exactRuleKey(roles: readonly RoleKey[]): string {
  return `x${sha256Hex(canonicalRoles(roles).join(",")).slice(0, 24)}`;
}

/** `"d"` + YYYYMMDD. */
export function blockKey(date: string): string {
  return `d${date.replace(/-/g, "")}`;
}

/** `"r"` + 24 hex of SHA-256 of the presence rule key. */
export function presenceKey(ruleKey: string): string {
  return `r${sha256Hex(ruleKey).slice(0, 24)}`;
}

// ─── Small guards ────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A Sanity document id (letters, digits, `.`, `_`, `-`; ≤ 128). */
const MEMBER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** REC-4's presence rule key grammar. */
export const RULE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

const at = (base: string, key: string) => (base ? `${base}.${key}` : key);
const idx = (base: string, i: number) => `${base}[${i}]`;

/** Fixed messages, one per violated rule — never a stored value. */
const MSG = {
  object: "must be an object",
  unknown: "unknown field",
  required: "required field missing",
  month: "must be a YYYY-MM month",
  monthCeiling: "is more than 12 months after the current month",
  source: "must be auto or manual",
  expectedRev: "must be null or a non-empty revision of at most 64 characters",
  array: "must be an array",
  peopleCount: "must hold 1 to 100 people",
  memberId: "must be a member id",
  duplicateMember: "lists a member twice",
  roles: "must hold exactly the six role keys",
  status: "must be in, out or exact",
  roleList: "must hold 1 to 6 distinct role keys",
  count: "must be a whole number from 1 to 31",
  notExact: "lists a role whose status is not exact",
  exactUnlisted: "is exact but no exact rule lists it",
  overlapping: "overlapping_exact",
  cadence: "must be absent or alternate",
  cadenceAndExact: "cadence_and_exact",
  boolean: "must be a boolean",
  blocksCount: "must hold at most 31 dates",
  date: "must be a date inside the month",
  duplicateDate: "lists a date twice",
  excludedRoles: "must hold distinct role keys",
  emptyBlock: "must mark the date unavailable or exclude a role",
  presenceCount: "must hold at most 20 rules",
  ruleKey: "must match the rule key grammar",
  duplicateRule: "lists a rule key twice",
  members: "must hold 2 to 12 distinct listed members",
} as const;

function unknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: FairnessIssue[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: at(path, key), message: MSG.unknown });
  }
}

function roleList(value: unknown, min: number): value is RoleKey[] {
  if (!Array.isArray(value) || value.length < min || value.length > 6) return false;
  if (!value.every(isRoleKey)) return false;
  return new Set(value).size === value.length;
}

// ─── The body validator (IF2-18; WR-3, WR-4, WR-17, REC-3, REC-4, A11, A38) ──

const ROUTE_FIELDS = ["month", "source", "expectedRev", "people", "presence"] as const;
const RECONSTRUCTION_FIELDS = ["month", "expectedRev", "people", "presence"] as const;
const PERSON_FIELDS = ["memberId", "roles", "exactRules", "sundayCadence", "exempt", "blocks"] as const;
const EXACT_FIELDS = ["roles", "count"] as const;
const BLOCK_FIELDS = ["date", "unavailable", "excludedRoles"] as const;
const PRESENCE_FIELDS = ["ruleKey", "roles", "members", "exclusive"] as const;

/**
 * Validate ONE write entry. Strict: unknown fields at any level are refused, and so is
 * every server-derived stamp, `_key`, `name` and `contentHash`. `actor` decides only
 * WR-4's `source` rule (route: `auto`|`manual`; reconstruction: absent); `currentMonth`
 * (CDMX `YYYY-MM`) decides only WR-4's «at most current month + 12». A delete entry is
 * not a body and never comes here.
 */
export function validateFairnessMonthWrite(
  body: unknown,
  actor: Actor,
  currentMonth: string,
):
  | { ok: true; value: FairnessMonthWrite | Omit<FairnessMonthWrite, "source"> }
  | { ok: false; issues: FairnessIssue[] } {
  const issues: FairnessIssue[] = [];
  if (!isPlainObject(body)) return { ok: false, issues: [{ path: "", message: MSG.object }] };
  unknownFields(body, actor === "route" ? ROUTE_FIELDS : RECONSTRUCTION_FIELDS, "", issues);

  const month = body.month;
  const monthOk = isMonthString(month);
  if (!monthOk) issues.push({ path: "month", message: MSG.month });
  else if (isMonthString(currentMonth) && monthIndex(month) > monthIndex(currentMonth) + 12) {
    issues.push({ path: "month", message: MSG.monthCeiling });
  }

  if (actor === "route" && body.source !== "auto" && body.source !== "manual") {
    issues.push({ path: "source", message: MSG.source });
  }

  if (!("expectedRev" in body)) issues.push({ path: "expectedRev", message: MSG.required });
  else if (
    body.expectedRev !== null &&
    !(typeof body.expectedRev === "string" && body.expectedRev.length > 0 && body.expectedRev.length <= 64)
  ) {
    issues.push({ path: "expectedRev", message: MSG.expectedRev });
  }

  const memberIds = new Set<string>();
  if (!Array.isArray(body.people)) issues.push({ path: "people", message: MSG.array });
  else {
    if (body.people.length < 1 || body.people.length > 100) issues.push({ path: "people", message: MSG.peopleCount });
    body.people.forEach((person, i) => validatePerson(person, idx("people", i), monthOk ? month : null, memberIds, issues));
  }

  if (!Array.isArray(body.presence)) issues.push({ path: "presence", message: MSG.array });
  else {
    if (body.presence.length > 20) issues.push({ path: "presence", message: MSG.presenceCount });
    const ruleKeys = new Set<string>();
    body.presence.forEach((rule, j) => validatePresence(rule, idx("presence", j), memberIds, ruleKeys, issues));
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: body as unknown as FairnessMonthWrite };
}

function validatePerson(
  person: unknown,
  path: string,
  month: string | null,
  memberIds: Set<string>,
  issues: FairnessIssue[],
) {
  if (!isPlainObject(person)) {
    issues.push({ path, message: MSG.object });
    return;
  }
  unknownFields(person, PERSON_FIELDS, path, issues);
  for (const required of ["memberId", "roles", "exactRules", "exempt", "blocks"]) {
    if (!(required in person)) issues.push({ path: at(path, required), message: MSG.required });
  }

  if ("memberId" in person) {
    if (typeof person.memberId !== "string" || !MEMBER_ID_RE.test(person.memberId)) {
      issues.push({ path: at(path, "memberId"), message: MSG.memberId });
    } else if (memberIds.has(person.memberId)) {
      issues.push({ path: at(path, "memberId"), message: MSG.duplicateMember });
    } else memberIds.add(person.memberId);
  }

  const statuses = new Map<RoleKey, Status>();
  if ("roles" in person) {
    const roles = person.roles;
    if (!isPlainObject(roles) || Object.keys(roles).length !== 6 || !Object.keys(roles).every(isRoleKey)) {
      issues.push({ path: at(path, "roles"), message: MSG.roles });
    } else {
      for (const key of ROLE_KEYS) {
        if (!isStatus(roles[key])) issues.push({ path: at(at(path, "roles"), ROLE_FIELD[key]), message: MSG.status });
        else statuses.set(key, roles[key] as Status);
      }
    }
  }

  const listedBy = new Map<RoleKey, number>();
  let overlapping = false;
  let coversSunLead = false;
  if ("exactRules" in person) {
    if (!Array.isArray(person.exactRules)) issues.push({ path: at(path, "exactRules"), message: MSG.array });
    else {
      person.exactRules.forEach((rule, j) => {
        const rulePath = idx(at(path, "exactRules"), j);
        if (!isPlainObject(rule)) {
          issues.push({ path: rulePath, message: MSG.object });
          return;
        }
        unknownFields(rule, EXACT_FIELDS, rulePath, issues);
        if (!roleList(rule.roles, 1)) issues.push({ path: at(rulePath, "roles"), message: MSG.roleList });
        else {
          for (const key of rule.roles) {
            const seen = listedBy.get(key) ?? 0;
            if (seen > 0) overlapping = true;
            listedBy.set(key, seen + 1);
            if (key === "Sun.Lead") coversSunLead = true;
            if (statuses.size === 6 && statuses.get(key) !== "exact") {
              issues.push({ path: at(rulePath, "roles"), message: MSG.notExact });
            }
          }
        }
        if (!(Number.isInteger(rule.count) && (rule.count as number) >= 1 && (rule.count as number) <= 31)) {
          issues.push({ path: at(rulePath, "count"), message: MSG.count });
        }
      });
    }
  }
  if (overlapping) issues.push({ path, message: MSG.overlapping });
  if (statuses.size === 6) {
    for (const key of ROLE_KEYS) {
      if (statuses.get(key) === "exact" && !listedBy.has(key)) {
        issues.push({ path: at(at(path, "roles"), ROLE_FIELD[key]), message: MSG.exactUnlisted });
      }
    }
  }

  if ("sundayCadence" in person) {
    if (person.sundayCadence !== "alternate") issues.push({ path: at(path, "sundayCadence"), message: MSG.cadence });
    else if (coversSunLead) issues.push({ path: at(path, "sundayCadence"), message: MSG.cadenceAndExact });
  }

  if ("exempt" in person && typeof person.exempt !== "boolean") issues.push({ path: at(path, "exempt"), message: MSG.boolean });

  if ("blocks" in person) {
    if (!Array.isArray(person.blocks)) issues.push({ path: at(path, "blocks"), message: MSG.array });
    else {
      if (person.blocks.length > 31) issues.push({ path: at(path, "blocks"), message: MSG.blocksCount });
      const dates = new Set<string>();
      person.blocks.forEach((block, k) => {
        const blockPath = idx(at(path, "blocks"), k);
        if (!isPlainObject(block)) {
          issues.push({ path: blockPath, message: MSG.object });
          return;
        }
        unknownFields(block, BLOCK_FIELDS, blockPath, issues);
        const date = block.date;
        if (!isValidServiceDate(date) || (month !== null && date.slice(0, 7) !== month)) {
          issues.push({ path: at(blockPath, "date"), message: MSG.date });
        } else if (dates.has(date)) issues.push({ path: at(blockPath, "date"), message: MSG.duplicateDate });
        else dates.add(date);
        if (typeof block.unavailable !== "boolean") issues.push({ path: at(blockPath, "unavailable"), message: MSG.boolean });
        if (!roleList(block.excludedRoles, 0)) issues.push({ path: at(blockPath, "excludedRoles"), message: MSG.excludedRoles });
        else if (block.unavailable === false && block.excludedRoles.length === 0) {
          issues.push({ path: blockPath, message: MSG.emptyBlock });
        }
      });
    }
  }
}

function validatePresence(
  rule: unknown,
  path: string,
  memberIds: Set<string>,
  ruleKeys: Set<string>,
  issues: FairnessIssue[],
) {
  if (!isPlainObject(rule)) {
    issues.push({ path, message: MSG.object });
    return;
  }
  unknownFields(rule, PRESENCE_FIELDS, path, issues);
  if (typeof rule.ruleKey !== "string" || !RULE_KEY_RE.test(rule.ruleKey)) {
    issues.push({ path: at(path, "ruleKey"), message: MSG.ruleKey });
  } else if (ruleKeys.has(rule.ruleKey)) issues.push({ path: at(path, "ruleKey"), message: MSG.duplicateRule });
  else ruleKeys.add(rule.ruleKey);
  if (!roleList(rule.roles, 1)) issues.push({ path: at(path, "roles"), message: MSG.roleList });
  const members = rule.members;
  if (
    !Array.isArray(members) ||
    members.length < 2 ||
    members.length > 12 ||
    !members.every((m) => typeof m === "string" && memberIds.has(m)) ||
    new Set(members).size !== members.length
  ) {
    issues.push({ path: at(path, "members"), message: MSG.members });
  }
  if (typeof rule.exclusive !== "boolean") issues.push({ path: at(path, "exclusive"), message: MSG.boolean });
}

// ─── The content hash (IF2-19, REC-6) ────────────────────────────────────────
//
// One serialization, two entry points. Codepoint order everywhere, never
// `localeCompare`. It excludes `name`, every `_key`/`_type`, every stamp, `_rev` and
// timestamps. Built defensively from `unknown`, so a hand-edited or malformed stored
// document still hashes — and hashes DIFFERENTLY from what was written: unknown role
// strings, missing fields and duplicates are kept in the serialization, never dropped.

/** Canonical role order for any list: known keys first in canonical order, then the rest by codepoint. */
function looseRoleList(value: unknown): unknown {
  if (!Array.isArray(value)) return value === undefined ? null : value;
  const rank = (v: unknown) => (typeof v === "string" && isRoleKey(v) ? ROLE_KEYS.indexOf(v) : ROLE_KEYS.length);
  return [...value].sort((a, b) => rank(a) - rank(b) || compareCodepoint(String(a), String(b)));
}

const orNull = (v: unknown) => (v === undefined ? null : v);

interface LoosePerson {
  memberId: unknown;
  roles: (key: RoleKey) => unknown;
  exactRules: unknown;
  sundayCadence: unknown;
  exempt: unknown;
  blocks: unknown;
}

function serializePerson(p: LoosePerson): unknown {
  const exactRules = Array.isArray(p.exactRules)
    ? p.exactRules
        .map((r) => (isPlainObject(r) ? { roles: looseRoleList(r.roles), count: orNull(r.count) } : r))
        .map((r) => [JSON.stringify(r), r] as const)
        .sort(([a], [b]) => compareCodepoint(a, b))
        .map(([, r]) => r)
    : orNull(p.exactRules);
  const blocks = Array.isArray(p.blocks)
    ? p.blocks
        .map((b) =>
          isPlainObject(b)
            ? { date: orNull(b.date), unavailable: orNull(b.unavailable), excludedRoles: looseRoleList(b.excludedRoles) }
            : b,
        )
        .sort((a, b) => compareCodepoint(String(isPlainObject(a) ? a.date : ""), String(isPlainObject(b) ? b.date : "")))
    : orNull(p.blocks);
  return {
    memberId: orNull(p.memberId),
    roles: ROLE_KEYS.map((k) => orNull(p.roles(k))),
    exactRules,
    sundayCadence: orNull(p.sundayCadence),
    exempt: orNull(p.exempt),
    blocks,
  };
}

function serializePresence(rule: unknown): unknown {
  if (!isPlainObject(rule)) return rule;
  return {
    ruleKey: orNull(rule.ruleKey),
    roles: looseRoleList(rule.roles),
    members: Array.isArray(rule.members) ? [...rule.members].sort((a, b) => compareCodepoint(String(a), String(b))) : orNull(rule.members),
    exclusive: orNull(rule.exclusive),
  };
}

function bySerializedKey(field: "memberId" | "ruleKey") {
  return (a: unknown, b: unknown) =>
    compareCodepoint(String(isPlainObject(a) ? a[field] : ""), String(isPlainObject(b) ? b[field] : ""));
}

/** The canonical serialization REC-6 hashes. Exported so a test can pin its exact text. */
export function canonicalFairnessContent(input: {
  schemaVersion: unknown;
  month: unknown;
  people: LoosePerson[] | unknown;
  presence: unknown;
}): string {
  const people = Array.isArray(input.people)
    ? (input.people as LoosePerson[]).map(serializePerson).sort(bySerializedKey("memberId"))
    : orNull(input.people);
  const presence = Array.isArray(input.presence)
    ? input.presence.map(serializePresence).sort(bySerializedKey("ruleKey"))
    : orNull(input.presence);
  return JSON.stringify({ schemaVersion: orNull(input.schemaVersion), month: orNull(input.month), people, presence });
}

const hashOf = (text: string) => `sha256:${sha256Hex(text)}`;

/** IF2-19 — the hash of a write body (its `source`/`expectedRev`, if present, are ignored). */
export function contentHashOfWrite(month: string, body: FairnessMonthBody): string {
  const people: LoosePerson[] = (body.people ?? []).map((p) => ({
    memberId: p.memberId,
    roles: (key) => p.roles?.[key],
    exactRules: p.exactRules,
    sundayCadence: p.sundayCadence,
    exempt: p.exempt,
    blocks: p.blocks,
  }));
  return hashOf(canonicalFairnessContent({ schemaVersion: FAIRNESS_SCHEMA_VERSION, month, people, presence: body.presence }));
}

/**
 * IF2-19 — the hash recomputed from a STORED document, as read: `member._ref` is that
 * person's `memberId` (only the reference wrapper is ignored), the six role fields map
 * back to role keys, and `_key`s, `name` and stamps are ignored. Never throws: a
 * malformed document hashes too (C4's rollback reads it without the parser). A stored
 * record is INTACT iff this equals its stored `contentHash`.
 */
export function contentHashOfStored(doc: unknown): string {
  const d = isPlainObject(doc) ? doc : {};
  const people = Array.isArray(d.people)
    ? d.people.map((item): LoosePerson => {
        const p = isPlainObject(item) ? item : {};
        const roles = isPlainObject(p.roles) ? p.roles : {};
        return {
          memberId: isPlainObject(p.member) ? p.member._ref : undefined,
          roles: (key) => roles[ROLE_FIELD[key]],
          exactRules: p.exactRules,
          sundayCadence: p.sundayCadence,
          exempt: p.exempt,
          blocks: p.blocks,
        };
      })
    : d.people;
  return hashOf(canonicalFairnessContent({ schemaVersion: d.schemaVersion, month: d.month, people, presence: d.presence }));
}

/** Intactness (REC-6): the recomputed hash equals the stored one. */
export function isIntact(doc: unknown): boolean {
  return isPlainObject(doc) && typeof doc.contentHash === "string" && contentHashOfStored(doc) === doc.contentHash;
}

// ─── The stored document (IF2-2) ─────────────────────────────────────────────

/** Every non-system field the executor writes (WR-11 sets exactly these on a replace). */
export interface FairnessMonthFields {
  schemaVersion: 1;
  month: string;
  source: LogicalRecord["source"];
  engine: LogicalRecord["engine"];
  environment: LogicalRecord["environment"];
  recordedAt: string;
  recordedBy: string;
  contentHash: string;
  people: Array<Record<string, unknown>>;
  presence: Array<Record<string, unknown>>;
}

/**
 * The document a write stores, built from a VALIDATED body: people by member id, presence
 * by rule key, blocks by date, exact rules by canonical role list, every role-key list in
 * canonical order, a minted `_key` and `_type` per item, `name` from `names` (the
 * executor's member read, WR-16) and the content hash of the body (REC-6).
 */
export function buildFairnessMonthDocument(input: {
  body: FairnessMonthBody;
  source: LogicalRecord["source"];
  engine: LogicalRecord["engine"];
  environment: LogicalRecord["environment"];
  recordedAt: string;
  recordedBy: string;
  names: ReadonlyMap<string, string>;
}): { _id: string; _type: typeof FAIRNESS_MONTH_TYPE } & FairnessMonthFields {
  const { body } = input;
  const people = [...body.people]
    .sort((a, b) => compareCodepoint(a.memberId, b.memberId))
    .map((p) => {
      const name = input.names.get(p.memberId);
      if (typeof name !== "string" || name.length === 0) {
        throw new Error(`fairnessMonth: no member name for ${p.memberId} (REC-3: no item is written without a name)`);
      }
      const roles: Record<string, Status> = {};
      for (const key of ROLE_KEYS) roles[ROLE_FIELD[key]] = p.roles[key];
      return {
        _key: personKey(p.memberId),
        _type: "fairnessPerson",
        member: { _type: "reference", _ref: p.memberId, _weak: true },
        name,
        roles,
        exactRules: p.exactRules
          .map((r) => ({ roles: canonicalRoles(r.roles), count: r.count }))
          .sort((a, b) => compareCodepoint(a.roles.join(","), b.roles.join(",")))
          .map((r) => ({ _key: exactRuleKey(r.roles), _type: "fairnessExactRule", roles: r.roles, count: r.count })),
        ...(p.sundayCadence === "alternate" ? { sundayCadence: "alternate" } : {}),
        exempt: p.exempt,
        blocks: [...p.blocks]
          .sort((a, b) => compareCodepoint(a.date, b.date))
          .map((b) => ({
            _key: blockKey(b.date),
            _type: "fairnessBlock",
            date: b.date,
            unavailable: b.unavailable,
            excludedRoles: canonicalRoles(b.excludedRoles),
          })),
      };
    });
  const presence = [...body.presence]
    .sort((a, b) => compareCodepoint(a.ruleKey, b.ruleKey))
    .map((r) => ({
      _key: presenceKey(r.ruleKey),
      _type: "fairnessPresence",
      ruleKey: r.ruleKey,
      roles: canonicalRoles(r.roles),
      members: [...r.members].sort(compareCodepoint),
      exclusive: r.exclusive,
    }));
  return {
    _id: fairnessMonthId(body.month),
    _type: FAIRNESS_MONTH_TYPE,
    schemaVersion: FAIRNESS_SCHEMA_VERSION,
    month: body.month,
    source: input.source,
    engine: input.engine,
    environment: input.environment,
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
    contentHash: contentHashOfWrite(body.month, body),
    people,
    presence,
  };
}

// ─── The stored-record parser (IF2-20, RD-2) ─────────────────────────────────

const SOURCES = ["auto", "manual", "reconstructed"] as const;
const ENGINES = ["v2", "v3"] as const;
const ENVIRONMENTS = ["production", "preview", "local"] as const;

const PARSE = {
  object: "must be an object",
  missing: "required field missing",
  schemaVersion: "unknown schemaVersion",
  enumValue: "invalid enum value",
  type: "wrong type",
  id: "does not match the month",
} as const;

/**
 * RD-2's record-schema check, the ONE definition: an unknown `schemaVersion`, a missing
 * field (a listed item missing any of its six role fields included, REC-7) or an
 * invalid enum refuses the record. Nothing more — intactness is `isIntact`, a separate
 * test a caller can run on a record this parser refuses (C4's rollback, C4 R18).
 */
export function parseStoredFairnessMonth(
  doc: unknown,
): { ok: true; record: LogicalRecord } | { ok: false; refusal: "malformed_record"; issues: FairnessIssue[] } {
  const issues: FairnessIssue[] = [];
  const refuse = () => ({ ok: false as const, refusal: "malformed_record" as const, issues });
  if (!isPlainObject(doc)) {
    issues.push({ path: "", message: PARSE.object });
    return refuse();
  }
  const str = (v: unknown, path: string, nonEmpty = false): v is string => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "string" || (nonEmpty && v.length === 0)) issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };
  const bool = (v: unknown, path: string): v is boolean => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "boolean") issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };
  const oneOf = <T extends string>(v: unknown, values: readonly T[], path: string): v is T => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (typeof v !== "string" || !(values as readonly string[]).includes(v)) issues.push({ path, message: PARSE.enumValue });
    else return true;
    return false;
  };
  const roleKeys = (v: unknown, path: string): v is RoleKey[] => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (!Array.isArray(v)) issues.push({ path, message: PARSE.type });
    else if (!v.every(isRoleKey)) issues.push({ path, message: PARSE.enumValue });
    else return true;
    return false;
  };
  const arr = (v: unknown, path: string): v is unknown[] => {
    if (v === undefined) issues.push({ path, message: PARSE.missing });
    else if (!Array.isArray(v)) issues.push({ path, message: PARSE.type });
    else return true;
    return false;
  };

  if (doc.schemaVersion === undefined) issues.push({ path: "schemaVersion", message: PARSE.missing });
  else if (doc.schemaVersion !== FAIRNESS_SCHEMA_VERSION) issues.push({ path: "schemaVersion", message: PARSE.schemaVersion });
  if (doc._type !== FAIRNESS_MONTH_TYPE) issues.push({ path: "_type", message: PARSE.enumValue });
  const monthOk = str(doc.month, "month") && isMonthString(doc.month);
  if (typeof doc.month === "string" && !isMonthString(doc.month)) issues.push({ path: "month", message: PARSE.type });
  if (str(doc._id, "_id") && monthOk && doc._id !== fairnessMonthId(doc.month as string)) {
    issues.push({ path: "_id", message: PARSE.id });
  }
  str(doc._rev, "_rev", true);
  oneOf(doc.source, SOURCES, "source");
  oneOf(doc.engine, ENGINES, "engine");
  oneOf(doc.environment, ENVIRONMENTS, "environment");
  str(doc.recordedAt, "recordedAt");
  str(doc.recordedBy, "recordedBy");
  str(doc.contentHash, "contentHash");

  const people: LogicalRecord["people"] = [];
  if (arr(doc.people, "people")) {
    doc.people.forEach((item, i) => {
      const path = idx("people", i);
      if (!isPlainObject(item)) {
        issues.push({ path, message: PARSE.object });
        return;
      }
      const member = item.member;
      let memberId = "";
      if (member === undefined) issues.push({ path: at(path, "member"), message: PARSE.missing });
      else if (!isPlainObject(member) || typeof member._ref !== "string" || member._ref.length === 0) {
        issues.push({ path: at(path, "member"), message: PARSE.type });
      } else memberId = member._ref;
      const nameOk = str(item.name, at(path, "name"), true);
      const roles = {} as Record<RoleKey, Status>;
      if (item.roles === undefined) issues.push({ path: at(path, "roles"), message: PARSE.missing });
      else if (!isPlainObject(item.roles)) issues.push({ path: at(path, "roles"), message: PARSE.type });
      else {
        const stored = item.roles;
        for (const key of ROLE_KEYS) {
          if (oneOf(stored[ROLE_FIELD[key]], ["in", "out", "exact"] as const, at(at(path, "roles"), ROLE_FIELD[key]))) {
            roles[key] = stored[ROLE_FIELD[key]] as Status;
          }
        }
      }
      const exactRules: Array<{ roles: RoleKey[]; count: number }> = [];
      if (arr(item.exactRules, at(path, "exactRules"))) {
        item.exactRules.forEach((rule, j) => {
          const rulePath = idx(at(path, "exactRules"), j);
          if (!isPlainObject(rule)) {
            issues.push({ path: rulePath, message: PARSE.object });
            return;
          }
          const rolesOk = roleKeys(rule.roles, at(rulePath, "roles"));
          if (rule.count === undefined) issues.push({ path: at(rulePath, "count"), message: PARSE.missing });
          else if (!Number.isInteger(rule.count)) issues.push({ path: at(rulePath, "count"), message: PARSE.type });
          else if (rolesOk) exactRules.push({ roles: [...(rule.roles as RoleKey[])], count: rule.count as number });
        });
      }
      if (item.sundayCadence !== undefined && item.sundayCadence !== "alternate") {
        issues.push({ path: at(path, "sundayCadence"), message: PARSE.enumValue });
      }
      const exemptOk = bool(item.exempt, at(path, "exempt"));
      const blocks: Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }> = [];
      if (arr(item.blocks, at(path, "blocks"))) {
        item.blocks.forEach((block, k) => {
          const blockPath = idx(at(path, "blocks"), k);
          if (!isPlainObject(block)) {
            issues.push({ path: blockPath, message: PARSE.object });
            return;
          }
          const dateOk = str(block.date, at(blockPath, "date"));
          const unavailableOk = bool(block.unavailable, at(blockPath, "unavailable"));
          const excludedOk = roleKeys(block.excludedRoles, at(blockPath, "excludedRoles"));
          if (dateOk && unavailableOk && excludedOk) {
            blocks.push({
              date: block.date as string,
              unavailable: block.unavailable as boolean,
              excludedRoles: [...(block.excludedRoles as RoleKey[])],
            });
          }
        });
      }
      if (memberId && nameOk && Object.keys(roles).length === 6 && exemptOk) {
        people.push({
          memberId,
          name: item.name as string,
          roles,
          exactRules,
          ...(item.sundayCadence === "alternate" ? { sundayCadence: "alternate" as const } : {}),
          exempt: item.exempt as boolean,
          blocks,
        });
      }
    });
  }

  const presence: LogicalRecord["presence"] = [];
  if (arr(doc.presence, "presence")) {
    doc.presence.forEach((rule, j) => {
      const path = idx("presence", j);
      if (!isPlainObject(rule)) {
        issues.push({ path, message: PARSE.object });
        return;
      }
      const keyOk = str(rule.ruleKey, at(path, "ruleKey"));
      const rolesOk = roleKeys(rule.roles, at(path, "roles"));
      let membersOk = false;
      if (arr(rule.members, at(path, "members"))) {
        if (!rule.members.every((m) => typeof m === "string")) issues.push({ path: at(path, "members"), message: PARSE.type });
        else membersOk = true;
      }
      const exclusiveOk = bool(rule.exclusive, at(path, "exclusive"));
      if (keyOk && rolesOk && membersOk && exclusiveOk) {
        presence.push({
          ruleKey: rule.ruleKey as string,
          roles: [...(rule.roles as RoleKey[])],
          members: [...(rule.members as string[])],
          exclusive: rule.exclusive as boolean,
        });
      }
    });
  }

  if (issues.length > 0) return refuse();
  return {
    ok: true,
    record: {
      month: doc.month as string,
      rev: doc._rev as string,
      contentHash: doc.contentHash as string,
      source: doc.source as LogicalRecord["source"],
      engine: doc.engine as LogicalRecord["engine"],
      environment: doc.environment as LogicalRecord["environment"],
      recordedAt: doc.recordedAt as string,
      people,
      presence,
    },
  };
}
