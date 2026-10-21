// The month proposal (P4 on solver v3, D6) as pure builders and a strict parser. No Sanity
// client: `proposalStore.ts` writes what `buildProposal` returns and reads through
// `parseProposal`, so the shape is testable without I/O.
//
// What is stored. The immutable fields are written once, at solve: origin, principal,
// `createdAt`, `expiresAt` (+7 days), `engine`, the bound rules `rev` (absent = the defaults),
// `months`, `requestId`, and ONE JSON string `payload` — the frozen confirm entries (CF-2), the
// drafts with each one's solve-time preflight state, and the horizon's stored service ids at
// solve. `digest` is the SHA-256 of all of those together, so a record whose header or payload
// was altered after the solve reads as no record at all (D10). The one mutable field is the JSON
// string `state` = `{ recordsDone, created: { localId → roleId } }`: facts that only grow, merged
// by union (`mergeState`), never a lease.
//
// Why JSON strings and not structured fields: the payload is written once and parsed on every
// load, so it needs no `_key`s, no Studio sub-schema, and adds no attribute paths to the dataset.
// The id is dotted (`mcpProposal.<handle>`), so an untokened read never serves it.
//
// A build is refused unless its own output parses: whatever is written can be read back.
//
// REVISIONS (the MCP proposal editor, plan T2.2, ADR-0062). Frank's hand edit is stored as a NEW
// record, never by mutating this one: the payload stays digest-bound and immutable, so
// `apply_schedule` needs no lease. A revision's header adds `parent` (the handle it was made
// from), `revision` (2…30) and `root` (the lineage's revision-1 handle, which keys the screen's
// member tokens), all three digest-bound; a solve's record carries none of them and reads as
// revision 1, its own root. Its payload is v2: v1's fields plus the WAIVERS Frank confirmed (a
// finding key and the rule's sentence — `apply_schedule` refuses a proposal with waivers unless
// its call repeats each one), the BASELINE (the solve's own findings, warnings forever), whether
// the month check judged it (`checked`; false = «sin revisar») and the screen's `saveId` (a lost
// answer's retry finds its own child). The parser pairs them strictly: a v1 payload with no
// lineage, a v2 payload with all three fields; anything else reads as no record. A v1 record's
// digest list is exactly the one every record already in the dataset was signed with.
//
// `state` gains `supersededBy`: the child that replaced this record, written in the SAME
// transaction that creates the child, and kept by every later merge (`mergeState`), so an apply's
// `state` retry can never clear or replace it.

import { createHash } from "node:crypto";

import { ROLE_TYPES } from "@/app/utils/serviceReadModel";
import { isSpecialRoleType } from "@/app/utils/roleWriteRequest";
import type { DraftCard } from "@/app/components/admin/plannerModel";
import type { ConfirmOutcome, V3ConfirmEntry } from "@/app/components/admin/v3Confirm";
import type { MonthState } from "@/app/components/admin/v3MonthSources";
import type { TargetPreflightState } from "@/app/components/admin/serviceReadiness";
import { MCP_PROPOSAL_TYPE, PROPOSAL_FIELDS } from "./documentTypes";
import { isProposalHandle, isProposalId, proposalIdOf } from "./handle";

export const PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROPOSAL_MAX_MONTHS = 2;
export const PROPOSAL_MAX_DRAFTS = 40;
export const PROPOSAL_MAX_PAYLOAD_BYTES = 1_000_000;

const MONTH_STATES = ["bound", "recorded_unbound", "unrecorded", "anchored_unrecorded"] as const satisfies readonly MonthState[];
const CONFIRM_OUTCOMES = ["created", "replaced", "unchanged"] as const satisfies readonly ConfirmOutcome[];
const PREFLIGHT_STATES = ["checking", "unknown", "exists", "blocked", "creatable"] as const satisfies readonly TargetPreflightState[];
// Exhaustive both ways: a new member of any of the three unions fails the typecheck here.
type Exhaustive<A extends readonly string[], U extends string> = [U] extends [A[number]] ? true : never;
const EXHAUSTIVE: [
  Exhaustive<typeof MONTH_STATES, MonthState>,
  Exhaustive<typeof CONFIRM_OUTCOMES, ConfirmOutcome>,
  Exhaustive<typeof PREFLIGHT_STATES, TargetPreflightState>,
] = [true, true, true];
void EXHAUSTIVE;

export interface ProposalDraft {
  draft: DraftCard;
  atSolve: TargetPreflightState;
  reasons: string[];
}

/** A revision's lineage limits: the solve is revision 1; a save that would make revision 31 is refused. */
export const PROPOSAL_MAX_REVISION = 30;
export const PROPOSAL_MAX_WAIVERS = 200;
export const PROPOSAL_MAX_BASELINE = 500;
export const WAIVER_SENTENCE_MAX = 300;

export type FindingKind = "exclusion" | "week_exclusion" | "pair";
const FINDING_KINDS = ["exclusion", "week_exclusion", "pair"] as const satisfies readonly FindingKind[];

/**
 * One rule breach on a board, keyed ONCE (plan T2.2): the rule by its kind and config ordinal
 * (`restriction[i].pattern[k]`, `restriction[i].week[j]`, `conflict[i]` — never a config key,
 * C6 KH-1), the service by its draft `localId`, and the seat: a per-seat rule's row and member, or
 * a pair's two members (sorted, no row — an exchange inside the column keeps the key).
 */
export interface FindingKey {
  kind: FindingKind;
  rule: string;
  service: string;
  row: string | null;
  members: string[];
}

/** A finding Frank confirmed («Asignar de todos modos»), with the rule's sentence as he read it. */
export interface Waiver {
  key: FindingKey;
  sentence: string;
}

interface PayloadCore {
  entries: V3ConfirmEntry[];
  drafts: ProposalDraft[];
  /** The horizon's stored role ids at solve, from the snapshot's canonical rows (apply's check (c)). */
  storedServiceIds: string[];
}

export interface ProposalPayloadV1 extends PayloadCore {
  v: 1;
}

export interface ProposalPayloadV2 extends PayloadCore {
  v: 2;
  waivers: Waiver[];
  /** The solve's own findings, computed once at the lineage's first revision and copied verbatim. */
  baseline: FindingKey[];
  /** Whether the month check judged this board; `false` = «sin revisar» (E7). */
  checked: boolean;
  /** The saving screen's id for this save, so a retry after a lost answer finds its own child. */
  saveId: string;
}

export type ProposalPayload = ProposalPayloadV1 | ProposalPayloadV2;

export interface ProposalState {
  recordsDone: boolean;
  /** `localId` → the created role's `_id`. */
  created: Record<string, string>;
  /** The handle of the revision that replaced this record (T2.2's save transaction). */
  supersededBy?: string;
}

/** A revision's place in its lineage; absent on a solve's record (revision 1, its own root). */
export interface ProposalLineage {
  parent: string;
  revision: number;
  root: string;
}

export interface ProposalHeader {
  origin: string;
  /** The member id (`sub`) of the super-admin who solved it. */
  principal: string;
  createdAt: string;
  expiresAt: string;
  engine: "v3";
  /** The stored rules' `_rev` the plan was solved under; `null` = the document was absent. */
  rulesRev: string | null;
  months: string[];
  requestId: string;
  /** Absent on a solve's record. */
  lineage?: ProposalLineage;
}

export interface NewProposalDocument {
  _id: string;
  _type: typeof MCP_PROPOSAL_TYPE;
  origin: string;
  principal: string;
  createdAt: string;
  expiresAt: string;
  engine: "v3";
  rulesRev?: string;
  months: string[];
  requestId: string;
  parent?: string;
  revision?: number;
  root?: string;
  payload: string;
  digest: string;
  state: string;
}

export interface StoredProposal {
  id: string;
  rev: string;
  header: ProposalHeader;
  payload: ProposalPayload;
  state: ProposalState;
}

export const EMPTY_STATE: ProposalState = Object.freeze({ recordsDone: false, created: Object.freeze({}) }) as ProposalState;

// ── Digest ────────────────────────────────────────────────────────────────────

/**
 * SHA-256 over every immutable field, in one fixed order. A solve's record signs exactly the list
 * every record already stored was signed with; a revision appends its lineage, so altering
 * `parent`, `revision` or `root` makes it read as no record.
 */
export function proposalDigest(header: ProposalHeader, payload: string): string {
  const base: unknown[] = [
    header.origin, header.principal, header.createdAt, header.expiresAt, header.engine,
    header.rulesRev, header.months, header.requestId, payload,
  ];
  const canonical = JSON.stringify(
    header.lineage ? [...base, header.lineage.parent, header.lineage.revision, header.lineage.root] : base,
  );
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// ── Shape checks ──────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const hasOnly = (o: Obj, required: readonly string[], optional: readonly string[] = []) =>
  required.every((k) => k in o) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

const DRAFT_REQUIRED = [
  "localId", "creationRequestId", "_type", "date", "exists", "isExisting", "skipped", "countsForFairness",
  "leads", "bgvs", "chorus", "instruments", "foh",
] as const;

function validSlot(v: unknown, label: "instrument" | "role"): boolean {
  return isObj(v) && hasOnly(v, ["id", label, "personId"]) && isStr(v.id) && typeof v[label] === "string" && isStr(v.personId);
}

function validDraft(v: unknown, months: readonly string[]): v is DraftCard {
  if (!isObj(v) || !hasOnly(v, DRAFT_REQUIRED, ["service_name"])) return false;
  if (!isStr(v.localId) || !isStr(v.creationRequestId)) return false;
  if (!(ROLE_TYPES as readonly unknown[]).includes(v._type)) return false;
  if (typeof v.date !== "string" || !DAY_RE.test(v.date) || !months.includes(v.date.slice(0, 7))) return false;
  for (const k of ["exists", "isExisting", "skipped", "countsForFairness"] as const) if (typeof v[k] !== "boolean") return false;
  if (!isStrArray(v.leads) || !isStrArray(v.bgvs) || !isStrArray(v.chorus)) return false;
  if (!Array.isArray(v.instruments) || !v.instruments.every((s) => validSlot(s, "instrument"))) return false;
  if (!Array.isArray(v.foh) || !v.foh.every((s) => validSlot(s, "role"))) return false;
  // A3: a special always carries its name; a weekend never does.
  const special = isSpecialRoleType(v._type);
  if (special ? !(typeof v.service_name === "string" && v.service_name.trim().length > 0) : "service_name" in v) return false;
  return true;
}

function validEntry(v: unknown, month: string): v is V3ConfirmEntry {
  if (!isObj(v) || !hasOnly(v, ["month", "state", "write", "expects"])) return false;
  if (v.month !== month || !(MONTH_STATES as readonly unknown[]).includes(v.state)) return false;
  if (!isObj(v.write) || v.write.month !== month) return false;
  return Array.isArray(v.expects) && v.expects.length > 0 && v.expects.every((x) => (CONFIRM_OUTCOMES as readonly unknown[]).includes(x));
}

function validMonths(v: unknown): v is string[] {
  return isStrArray(v) && v.length >= 1 && v.length <= PROPOSAL_MAX_MONTHS && v.every((m) => MONTH_RE.test(m))
    && new Set(v).size === v.length && v.every((m, i) => i === 0 || m > v[i - 1]);
}

const RULE_ID: Record<FindingKind, RegExp> = {
  exclusion: /^restriction\[\d{1,4}\]\.pattern\[\d{1,4}\]$/,
  week_exclusion: /^restriction\[\d{1,4}\]\.week\[\d{1,4}\]$/,
  pair: /^conflict\[\d{1,4}\]$/,
};
const SAVE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validFindingKey(v: unknown, localIds: ReadonlySet<string>): v is FindingKey {
  if (!isObj(v) || !hasOnly(v, ["kind", "rule", "service", "row", "members"])) return false;
  if (!(FINDING_KINDS as readonly unknown[]).includes(v.kind)) return false;
  const kind = v.kind as FindingKind;
  if (typeof v.rule !== "string" || !RULE_ID[kind].test(v.rule)) return false;
  if (typeof v.service !== "string" || !localIds.has(v.service)) return false;
  if (!isStrArray(v.members) || !v.members.every(isStr)) return false;
  if (kind === "pair") {
    return v.row === null && v.members.length === 2 && v.members[0] < v.members[1];
  }
  return isStr(v.row) && v.members.length === 1;
}

/** One finding key as a string: the identity two keys share exactly when they are the same finding. */
export function findingKeyText(k: FindingKey): string {
  return JSON.stringify([k.kind, k.rule, k.service, k.row, k.members]);
}

/** The payload string, parsed and checked against `months` and its version; `null` on any deviation. */
export function parsePayload(text: unknown, months: readonly string[], version: 1 | 2 = 1): ProposalPayload | null {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > PROPOSAL_MAX_PAYLOAD_BYTES) return null;
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!isObj(o) || o.v !== version) return null;
  const v2 = ["waivers", "baseline", "checked", "saveId"] as const;
  if (!hasOnly(o, version === 1 ? ["v", "entries", "drafts", "storedServiceIds"] : ["v", "entries", "drafts", "storedServiceIds", ...v2])) return null;
  if (!Array.isArray(o.entries) || o.entries.length !== months.length || !o.entries.every((e, i) => validEntry(e, months[i]))) return null;
  if (!Array.isArray(o.drafts) || o.drafts.length > PROPOSAL_MAX_DRAFTS) return null;
  const localIds = new Set<string>();
  const requestIds = new Set<string>();
  for (const p of o.drafts) {
    if (!isObj(p) || !hasOnly(p, ["draft", "atSolve", "reasons"])) return null;
    if (!validDraft(p.draft, months)) return null;
    if (!(PREFLIGHT_STATES as readonly unknown[]).includes(p.atSolve) || !isStrArray(p.reasons)) return null;
    if (localIds.has(p.draft.localId) || requestIds.has(p.draft.creationRequestId)) return null;
    localIds.add(p.draft.localId);
    requestIds.add(p.draft.creationRequestId);
  }
  if (!isStrArray(o.storedServiceIds) || new Set(o.storedServiceIds).size !== o.storedServiceIds.length) return null;
  if (version === 2) {
    if (!Array.isArray(o.waivers) || o.waivers.length > PROPOSAL_MAX_WAIVERS) return null;
    const waived = new Set<string>();
    for (const w of o.waivers) {
      if (!isObj(w) || !hasOnly(w, ["key", "sentence"]) || !validFindingKey(w.key, localIds)) return null;
      if (!isStr(w.sentence) || w.sentence.length > WAIVER_SENTENCE_MAX) return null;
      const text = findingKeyText(w.key);
      if (waived.has(text)) return null;
      waived.add(text);
    }
    if (!Array.isArray(o.baseline) || o.baseline.length > PROPOSAL_MAX_BASELINE || !o.baseline.every((k) => validFindingKey(k, localIds))) return null;
    if (typeof o.checked !== "boolean" || typeof o.saveId !== "string" || !SAVE_ID_RE.test(o.saveId)) return null;
  }
  return o as unknown as ProposalPayload;
}

/** The state string; every `created` key must be a draft of the payload. */
export function parseState(text: unknown, payload: ProposalPayload): ProposalState | null {
  if (typeof text !== "string") return null;
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!isObj(o) || !hasOnly(o, ["recordsDone", "created"], ["supersededBy"]) || typeof o.recordsDone !== "boolean" || !isObj(o.created)) return null;
  if ("supersededBy" in o && !isProposalHandle(o.supersededBy)) return null;
  const localIds = new Set(payload.drafts.map((d) => d.draft.localId));
  for (const [k, v] of Object.entries(o.created)) if (!localIds.has(k) || !isStr(v)) return null;
  return {
    recordsDone: o.recordsDone,
    created: { ...(o.created as Record<string, string>) },
    ...(typeof o.supersededBy === "string" ? { supersededBy: o.supersededBy } : {}),
  };
}

/**
 * Facts only grow: `recordsDone` is OR'd and `created` is a union (the stored side wins a clash).
 * `supersededBy` is written once, by the save transaction: the STORED value wins over any incoming
 * one, so an apply's `state` retry can never clear or replace it.
 */
export function mergeState(stored: ProposalState, next: ProposalState): ProposalState {
  const supersededBy = stored.supersededBy ?? next.supersededBy;
  return {
    recordsDone: stored.recordsDone || next.recordsDone,
    created: { ...next.created, ...stored.created },
    ...(supersededBy ? { supersededBy } : {}),
  };
}

export const stateText = (s: ProposalState): string =>
  JSON.stringify({ recordsDone: s.recordsDone, created: s.created, ...(s.supersededBy ? { supersededBy: s.supersededBy } : {}) });

// ── Build and parse ───────────────────────────────────────────────────────────

export type BuildProposalResult = { ok: true; doc: NewProposalDocument } | { ok: false; reason: "invalid" };

/** What a revision adds to `buildProposal`'s input (T2.2). */
export interface RevisionInput {
  lineage: ProposalLineage;
  /** The base's own expiry: a revision never extends the 7 days of its solve. */
  expiresAt: string;
  waivers: Waiver[];
  baseline: FindingKey[];
  checked: boolean;
  saveId: string;
}

export function buildProposal(input: {
  handle: string;
  origin: string;
  principal: string;
  nowMs: number;
  rulesRev: string | null;
  months: string[];
  requestId: string;
  payload: PayloadCore;
  /** Present only for a revision (the editor's save); a solve passes none. */
  revision?: RevisionInput;
}): BuildProposalResult {
  const rev = input.revision;
  const header: ProposalHeader = {
    origin: input.origin,
    principal: input.principal,
    createdAt: new Date(input.nowMs).toISOString(),
    expiresAt: rev ? rev.expiresAt : new Date(input.nowMs + PROPOSAL_TTL_MS).toISOString(),
    engine: "v3",
    rulesRev: input.rulesRev,
    months: [...input.months],
    requestId: input.requestId,
    ...(rev ? { lineage: { ...rev.lineage } } : {}),
  };
  const core = { entries: input.payload.entries, drafts: input.payload.drafts, storedServiceIds: input.payload.storedServiceIds };
  const payload = rev
    ? JSON.stringify({ v: 2, ...core, waivers: rev.waivers, baseline: rev.baseline, checked: rev.checked, saveId: rev.saveId })
    : JSON.stringify({ v: 1, ...core });
  const doc: NewProposalDocument = {
    _id: proposalIdOf(input.handle),
    _type: MCP_PROPOSAL_TYPE,
    origin: header.origin,
    principal: header.principal,
    createdAt: header.createdAt,
    expiresAt: header.expiresAt,
    engine: header.engine,
    ...(header.rulesRev === null ? {} : { rulesRev: header.rulesRev }),
    months: header.months,
    requestId: header.requestId,
    ...(header.lineage ? { parent: header.lineage.parent, revision: header.lineage.revision, root: header.lineage.root } : {}),
    payload,
    digest: proposalDigest(header, payload),
    state: stateText(EMPTY_STATE),
  };
  return parseProposal({ ...doc, _rev: "unwritten" }) ? { ok: true, doc } : { ok: false, reason: "invalid" };
}

/**
 * A stored record, or `null` for anything that is not exactly what `buildProposal` writes
 * (plus a `_rev`): wrong id or type, a field outside `PROPOSAL_FIELDS`, a bad header, a digest
 * that does not match, a payload or state outside the schema. D10 answers every `null` alike.
 */
export function parseProposal(raw: unknown): StoredProposal | null {
  if (!isObj(raw)) return null;
  const known = ["_id", "_type", "_rev", ...PROPOSAL_FIELDS];
  // GROQ projects an absent field as `null`: an absent `rulesRev` is the defaults.
  if (Object.keys(raw).some((k) => !known.includes(k) && raw[k] !== null && raw[k] !== undefined)) return null;
  if (!isProposalId(raw._id) || raw._type !== MCP_PROPOSAL_TYPE || !isStr(raw._rev)) return null;
  if (!isStr(raw.origin) || !isStr(raw.principal) || !isIso(raw.createdAt) || !isIso(raw.expiresAt)) return null;
  if (raw.engine !== "v3" || !validMonths(raw.months) || !isStr(raw.requestId) || !isStr(raw.digest)) return null;
  const rulesRev = raw.rulesRev === undefined || raw.rulesRev === null ? null : raw.rulesRev;
  if (rulesRev !== null && !isStr(rulesRev)) return null;
  // The lineage: all three fields or none (a solve's record), never a mix.
  const given = (["parent", "revision", "root"] as const).filter((k) => raw[k] !== undefined && raw[k] !== null);
  if (given.length !== 0 && given.length !== 3) return null;
  let lineage: ProposalLineage | undefined;
  if (given.length === 3) {
    const revision = raw.revision;
    if (!isProposalHandle(raw.parent) || !isProposalHandle(raw.root)) return null;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 2 || revision > PROPOSAL_MAX_REVISION) return null;
    lineage = { parent: raw.parent, revision, root: raw.root };
  }
  const header: ProposalHeader = {
    origin: raw.origin, principal: raw.principal, createdAt: raw.createdAt, expiresAt: raw.expiresAt,
    engine: "v3", rulesRev, months: [...raw.months], requestId: raw.requestId, ...(lineage ? { lineage } : {}),
  };
  if (typeof raw.payload !== "string" || proposalDigest(header, raw.payload) !== raw.digest) return null;
  const payload = parsePayload(raw.payload, header.months, lineage ? 2 : 1);
  if (!payload) return null;
  const state = parseState(raw.state, payload);
  if (!state) return null;
  return { id: raw._id, rev: raw._rev, header, payload, state };
}

/** D10: the record is this deployment's, this principal's, and not expired. */
export function admitsProposal(p: StoredProposal, at: { origin: string; principal: string; nowMs: number }): boolean {
  return p.header.origin === at.origin && p.header.principal === at.principal && Date.parse(p.header.expiresAt) > at.nowMs;
}
