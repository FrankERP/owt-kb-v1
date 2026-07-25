// Pure assembly layer for the A1 "service-integrity" summaries (§5). Each
// builder takes already-fetched arrays (canonical docs, raw draft docs, resolved
// canonical members) and returns a deterministic, JSON-serializable domain
// summary. No Sanity client, no I/O — so it is exhaustively unit-testable in
// memory and the three domains stay independent.
//
// Invariants held here:
//  - Canonical counts / duplicate detection / target grouping NEVER use the
//    application `published != false` gate; publish state is reported separately.
//  - `saturdarSongs` (Saturday setlist) is a deliberate stored typo, honored.
//  - Malformed/duplicate/draft-conflict data becomes an explicit state, never a
//    silent empty result or an arbitrary `[0]` selection.
//  - One malformed record cannot fail the whole domain response.

import {
  assessRoleTargetLock,
  roleTargetLockId,
  validateRoleTargetLock,
  type RoleTargetLockIssue,
  type RoleTargetLockState,
} from "@/app/utils/roleTargetLock";
import {
  canonicalGroupState,
  indexProposals,
  normalizeBaseId,
  resolveMembers,
  setlistContentState,
  validateProposal,
  validateRole,
  type CanonicalGroupState,
  type CanonicalMember,
  type ProposalValidation,
  type RoleType,
  type SetlistContentState,
} from "@/app/utils/serviceReadModel";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** `published !== false` — missing/true is member-visible, only explicit false hides. */
function isMemberVisible(doc: Record<string, unknown>): boolean {
  return doc.published !== false;
}

type PublicState = CanonicalGroupState | "draft_conflict";

function publicState(canonical: CanonicalGroupState, draftIds: string[]): PublicState {
  return draftIds.length > 0 ? "draft_conflict" : canonical;
}

// ── Roles domain ──────────────────────────────────────────────────────────────

export interface RoleTargetRecord {
  id: string;
  rev: string;
  type: RoleType;
  serviceDate: string | null;
  /** application publish state: `published !== false`. */
  published: boolean;
  /** raw member reference ids across all five seat paths (unique). */
  assignedRefs: string[];
  members: CanonicalMember[];
  danglingRefs: string[];
}

/** Reported lock state for one weekend target (A2 §1). */
export interface RoleTargetLockSummary {
  id: string;
  rev: string;
  /** null when the stored `state` is unusable (a malformed record). */
  state: RoleTargetLockState | null;
  /** owner role id — a plain string, never a strong reference. */
  roleId: string | null;
  /** null when the stored generation is unusable (a malformed record). */
  generation: number | null;
}

export interface RoleTarget {
  targetKey: string;
  type: RoleType;
  canonicalCount: number;
  canonicalIds: string[];
  canonicalState: CanonicalGroupState;
  publicState: PublicState;
  /** number of canonical roles at this target that are member-visible. */
  memberVisibleCount: number;
  draftIds: string[];
  records: RoleTargetRecord[];
  /**
   * True only for weekend targets. A `special_role` is its own target serialized
   * by its own revision, so it takes NO weekend lock and a missing one there is
   * never an issue.
   */
  expectsLock: boolean;
  /** Stored lock at this target's deterministic id, when one was inventoried. */
  lock: RoleTargetLockSummary | null;
  /** §1 lock issues scoped to THIS target (never another target's problem). */
  lockIssues: RoleTargetLockIssue[];
}

export interface RoleRecordIssue {
  id: string;
  kind: "invalid_role" | "draft_only";
  issues: string[];
  /** normalized base id for draft-only issues. */
  baseId?: string;
  /** raw drafts observed against this record (for invalid_role overlays). */
  draftIds?: string[];
}

export interface RoleDomainSummary {
  targets: RoleTarget[];
  recordIssues: RoleRecordIssue[];
  /**
   * Every §1 lock issue in one flat view: each target's own issues plus the
   * records whose deterministic id belongs to no canonical target (an orphan or
   * misfiled lock). Empty when no lock inventory was supplied.
   */
  lockIssues: RoleTargetLockIssue[];
}

/**
 * Unique member reference ids across all five seat paths of every *groupable*
 * canonical role. The route uses this to fetch exactly the members it must
 * resolve, then passes the resulting map to {@link buildRoleTargets}.
 */
export function collectRoleMemberRefs(canonicalRoles: unknown[]): string[] {
  const seen = new Set<string>();
  for (const role of canonicalRoles) {
    let v;
    try {
      v = validateRole(role);
    } catch {
      continue;
    }
    if (!v.groupable) continue;
    for (const ref of v.assignedRefs) seen.add(ref);
  }
  return [...seen];
}

/**
 * @param locks Inventoried `roleTargetLock` documents. `null`/omitted means the
 *   caller did not inventory locks at all: no lock state is reported and NO lock
 *   issue is invented (an empty array, by contrast, is a real inventory in which
 *   every occupied weekend target is genuinely missing its lock).
 */
export function buildRoleTargets(
  canonicalRoles: unknown[],
  rawRoleDrafts: unknown[],
  membersById: Map<string, CanonicalMember>,
  locks: unknown[] | null = null,
): RoleDomainSummary {
  const recordIssues: RoleRecordIssue[] = [];
  const lockIssues: RoleTargetLockIssue[] = [];

  // Index raw drafts by their normalized (published) base id.
  const draftsByBaseId = new Map<string, string[]>();
  for (const draft of rawRoleDrafts) {
    if (!isObj(draft) || !nonEmptyString(draft._id)) continue;
    const base = normalizeBaseId(draft._id);
    const list = draftsByBaseId.get(base) ?? [];
    list.push(draft._id);
    draftsByBaseId.set(base, list);
  }
  // Track which base ids were matched to a canonical role (groupable or invalid).
  const matchedBaseIds = new Set<string>();

  // Group groupable roles by target key; collect invalid ones as record issues.
  const byKey = new Map<string, { type: RoleType; records: RoleTargetRecord[]; ids: string[] }>();
  /** roleId -> the canonical target key that role owns (groupable roles only). */
  const ownedTargetByRoleId = new Map<string, string>();

  for (const role of canonicalRoles) {
    try {
      const doc = isObj(role) ? role : {};
      const v = validateRole(role);
      const id = nonEmptyString(doc._id) ? doc._id : "";
      if (!v.groupable || !v.targetKey) {
        const draftIds = id ? draftsByBaseId.get(id) : undefined;
        if (id) matchedBaseIds.add(id);
        recordIssues.push({
          id: id || "(unknown)",
          kind: "invalid_role",
          issues: v.issues,
          ...(draftIds && draftIds.length ? { draftIds } : {}),
        });
        continue;
      }
      matchedBaseIds.add(id);
      if (id) ownedTargetByRoleId.set(id, v.targetKey);
      const { members, danglingRefs } = resolveMembers(v.assignedRefs, membersById);
      const record: RoleTargetRecord = {
        id,
        rev: nonEmptyString(doc._rev) ? doc._rev : "",
        type: doc._type as RoleType,
        serviceDate: v.serviceDate,
        published: isMemberVisible(doc),
        assignedRefs: v.assignedRefs,
        members,
        danglingRefs,
      };
      const bucket = byKey.get(v.targetKey) ?? {
        type: doc._type as RoleType,
        records: [],
        ids: [],
      };
      bucket.records.push(record);
      bucket.ids.push(id);
      byKey.set(v.targetKey, bucket);
    } catch {
      recordIssues.push({ id: "(unknown)", kind: "invalid_role", issues: ["exception"] });
    }
  }

  // ── Weekend lock inventory (A2 §1) ──────────────────────────────────────────
  // `ownerTargetKey` answers "which canonical target does this role id own?" —
  // null means the lock owns nothing real (orphan). Each lock record is validated
  // independently, so one malformed lock is a record-level issue that cannot fail
  // an unrelated target or the domain response.
  const ownerTargetKey = (roleId: string): string | null =>
    ownedTargetByRoleId.get(roleId) ?? null;
  const lockById = new Map<string, Record<string, unknown>>();
  if (locks) {
    for (const lock of locks) {
      if (isObj(lock) && nonEmptyString(lock._id)) {
        lockById.set(lock._id, lock);
        continue;
      }
      // Structurally unusable record: report it, never silently drop it.
      lockIssues.push(...validateRoleTargetLock(lock, ownerTargetKey).issues);
    }
  }
  const consumedLockIds = new Set<string>();

  const targets: RoleTarget[] = [];
  for (const [targetKey, bucket] of byKey) {
    const draftIds: string[] = [];
    for (const id of bucket.ids) {
      const d = draftsByBaseId.get(id);
      if (d) draftIds.push(...d);
    }
    const canonicalState = canonicalGroupState(bucket.records.length);

    const expectsLock = roleTargetLockId(targetKey) !== null;
    let lock: RoleTargetLockSummary | null = null;
    let targetLockIssues: RoleTargetLockIssue[] = [];
    if (locks && expectsLock) {
      const lockId = roleTargetLockId(targetKey) as string;
      consumedLockIds.add(lockId);
      const stored = lockById.get(lockId) ?? null;
      const assessment = assessRoleTargetLock(
        { targetKey, lock: stored, canonicalRoleIds: bucket.ids },
        ownerTargetKey,
      );
      targetLockIssues = assessment.issues;
      if (stored && assessment.validation) {
        lock = {
          id: nonEmptyString(stored._id) ? stored._id : lockId,
          rev: nonEmptyString(stored._rev) ? stored._rev : "",
          state: assessment.validation.state,
          roleId: assessment.validation.roleId,
          generation: assessment.validation.generation,
        };
      }
      lockIssues.push(...targetLockIssues);
    }

    targets.push({
      targetKey,
      type: bucket.type,
      canonicalCount: bucket.records.length,
      canonicalIds: bucket.ids,
      canonicalState,
      publicState: publicState(canonicalState, draftIds),
      memberVisibleCount: bucket.records.filter((r) => r.published).length,
      draftIds,
      records: bucket.records,
      expectsLock,
      lock,
      lockIssues: targetLockIssues,
    });
  }

  // Locks at a deterministic id no canonical target claims: a still-claimed one is
  // an orphan/wrong-owner/misfiled record; a vacated one is legitimately idle.
  for (const [lockId, stored] of lockById) {
    if (consumedLockIds.has(lockId)) continue;
    lockIssues.push(...validateRoleTargetLock(stored, ownerTargetKey).issues);
  }

  // Drafts whose base id matched no canonical role at all are draft-only issues.
  for (const [base, ids] of draftsByBaseId) {
    if (matchedBaseIds.has(base)) continue;
    for (const draftId of ids) {
      recordIssues.push({ id: draftId, kind: "draft_only", issues: ["draft_only"], baseId: base });
    }
  }

  return { targets, recordIssues, lockIssues };
}

// ── Setlists domain ────────────────────────────────────────────────────────────

export type SetlistDocType = "featuredSongs" | "saturdarSongs" | "special_role";

interface InvalidEntry {
  index: number;
  key: string | null;
  reasons: string[];
}

/** Enumerate structurally invalid song entries (same principles as setlistContentState). */
function invalidSongEntries(songs: unknown): InvalidEntry[] {
  if (!Array.isArray(songs)) return [{ index: -1, key: null, reasons: ["not_an_array"] }];
  const out: InvalidEntry[] = [];
  const seen = new Set<string>();
  songs.forEach((item, index) => {
    const reasons: string[] = [];
    if (!isObj(item)) {
      out.push({ index, key: null, reasons: ["not_an_object"] });
      return;
    }
    const key = nonEmptyString(item._key) ? item._key : null;
    if (!key) reasons.push("missing_key");
    else if (seen.has(key)) reasons.push("duplicate_key");
    else seen.add(key);
    const song = item.song;
    if (!isObj(song) || !nonEmptyString(song._ref)) reasons.push("missing_song_ref");
    if (reasons.length) out.push({ index, key, reasons });
  });
  return out;
}

function countSongs(songs: unknown): { count: number; keys: string[] } {
  if (!Array.isArray(songs)) return { count: 0, keys: [] };
  const keys: string[] = [];
  for (const item of songs) {
    if (isObj(item) && nonEmptyString(item._key)) keys.push(item._key);
  }
  return { count: songs.length, keys };
}

export interface SetlistTargetRecord {
  id: string;
  rev: string;
  type: SetlistDocType;
  contentState: SetlistContentState;
  songCount: number;
  songKeys: string[];
  invalidEntries: InvalidEntry[];
}

export interface SetlistTarget {
  targetKey: string;
  type: SetlistDocType;
  canonicalCount: number;
  canonicalIds: string[];
  canonicalState: CanonicalGroupState;
  publicState: PublicState;
  /** singleton content state; `invalid` for a duplicate (ambiguous) target. */
  contentState: SetlistContentState;
  songCount: number;
  songKeys: string[];
  invalidEntries: InvalidEntry[];
  draftIds: string[];
  records: SetlistTargetRecord[];
}

export interface SetlistRecordIssue {
  id: string;
  kind: "invalid_setlist" | "draft_only";
  issues: string[];
  baseId?: string;
  draftIds?: string[];
}

export interface SetlistDomainSummary {
  targets: SetlistTarget[];
  recordIssues: SetlistRecordIssue[];
}

function setlistDocTargetKey(doc: Record<string, unknown>): { key: string | null; issues: string[] } {
  const issues: string[] = [];
  if (!nonEmptyString(doc._id) || !nonEmptyString(doc._rev)) issues.push("identity");
  const type = doc._type;
  if (type === "featuredSongs" || type === "saturdarSongs") {
    const week = doc.week;
    if (!nonEmptyString(week) || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      issues.push("date");
      return { key: null, issues };
    }
    return { key: issues.length ? null : `${type}:${week}`, issues };
  }
  if (type === "special_role") {
    return { key: nonEmptyString(doc._id) ? doc._id : null, issues };
  }
  issues.push("type");
  return { key: null, issues };
}

function makeSetlistRecord(doc: Record<string, unknown>, type: SetlistDocType): SetlistTargetRecord {
  const { count, keys } = countSongs(doc.songs);
  return {
    id: nonEmptyString(doc._id) ? doc._id : "",
    rev: nonEmptyString(doc._rev) ? doc._rev : "",
    type,
    contentState: setlistContentState(doc.songs),
    songCount: count,
    songKeys: keys,
    invalidEntries: invalidSongEntries(doc.songs),
  };
}

export function buildSetlistTargets(
  canonicalSetlists: unknown[],
  rawSetlistDrafts: unknown[],
  specialRolesWithSongs: unknown[] = [],
): SetlistDomainSummary {
  const recordIssues: SetlistRecordIssue[] = [];

  const draftsByBaseId = new Map<string, string[]>();
  for (const draft of rawSetlistDrafts) {
    if (!isObj(draft) || !nonEmptyString(draft._id)) continue;
    const base = normalizeBaseId(draft._id);
    const list = draftsByBaseId.get(base) ?? [];
    list.push(draft._id);
    draftsByBaseId.set(base, list);
  }
  const matchedBaseIds = new Set<string>();

  const byKey = new Map<string, { type: SetlistDocType; records: SetlistTargetRecord[]; ids: string[] }>();

  const consider = (raw: unknown, requireSongs: boolean) => {
    try {
      if (!isObj(raw)) {
        recordIssues.push({ id: "(unknown)", kind: "invalid_setlist", issues: ["not_an_object"] });
        return;
      }
      // Special roles only participate as setlist targets when they carry songs.
      if (requireSongs && raw.songs === undefined) return;
      const { key, issues } = setlistDocTargetKey(raw);
      const id = nonEmptyString(raw._id) ? raw._id : "";
      if (!key) {
        if (id) matchedBaseIds.add(id);
        const draftIds = id ? draftsByBaseId.get(id) : undefined;
        recordIssues.push({
          id: id || "(unknown)",
          kind: "invalid_setlist",
          issues,
          ...(draftIds && draftIds.length ? { draftIds } : {}),
        });
        return;
      }
      matchedBaseIds.add(id);
      const type = raw._type as SetlistDocType;
      const record = makeSetlistRecord(raw, type);
      const bucket = byKey.get(key) ?? { type, records: [], ids: [] };
      bucket.records.push(record);
      bucket.ids.push(id);
      byKey.set(key, bucket);
    } catch {
      recordIssues.push({ id: "(unknown)", kind: "invalid_setlist", issues: ["exception"] });
    }
  };

  for (const doc of canonicalSetlists) consider(doc, false);
  for (const doc of specialRolesWithSongs) consider(doc, true);

  const targets: SetlistTarget[] = [];
  for (const [targetKey, bucket] of byKey) {
    const draftIds: string[] = [];
    for (const id of bucket.ids) {
      const d = draftsByBaseId.get(id);
      if (d) draftIds.push(...d);
    }
    const canonicalState = canonicalGroupState(bucket.records.length);
    const single = bucket.records.length === 1 ? bucket.records[0] : null;
    targets.push({
      targetKey,
      type: bucket.type,
      canonicalCount: bucket.records.length,
      canonicalIds: bucket.ids,
      canonicalState,
      publicState: publicState(canonicalState, draftIds),
      contentState: single ? single.contentState : "invalid",
      songCount: single ? single.songCount : 0,
      songKeys: single ? single.songKeys : [],
      invalidEntries: single ? single.invalidEntries : [],
      draftIds,
      records: bucket.records,
    });
  }

  for (const [base, ids] of draftsByBaseId) {
    if (matchedBaseIds.has(base)) continue;
    for (const draftId of ids) {
      recordIssues.push({ id: draftId, kind: "draft_only", issues: ["draft_only"], baseId: base });
    }
  }

  return { targets, recordIssues };
}

// ── Proposals domain ────────────────────────────────────────────────────────────

export interface ReferencedRoleMeta {
  id: string;
  type: string;
  serviceDate: string | null;
}

export interface ProposalRecord {
  id: string;
  rev: string;
  status: string | null;
  serviceRef: string | null;
  targetKey: string | null;
  contentState: SetlistContentState;
  valid: boolean;
  issues: string[];
  referencedRole: ReferencedRoleMeta | null;
}

export interface ProposalConflict {
  key: string;
  ids: string[];
}

export interface ProposalDomainSummary {
  records: ProposalRecord[];
  serviceRefConflicts: ProposalConflict[];
  targetKeyConflicts: ProposalConflict[];
  recordIssues: ProposalRecord[];
  draftIds: string[];
}

type ValidatedWithId = ProposalValidation & { id: string };

export function buildProposalSummary(
  canonicalProposals: unknown[],
  rawProposalDrafts: unknown[],
  resolveRole: (serviceRef: string) => unknown | null,
): ProposalDomainSummary {
  const records: ProposalRecord[] = [];
  const validatedForIndex: ValidatedWithId[] = [];

  for (const raw of canonicalProposals) {
    try {
      const doc = isObj(raw) ? raw : {};
      const serviceRef = nonEmptyString(doc.service_ref) ? doc.service_ref : null;
      const role = serviceRef ? resolveRole(serviceRef) : null;
      const v = validateProposal(raw, role ?? null);
      const id = nonEmptyString(doc._id) ? doc._id : "(unknown)";

      let referencedRole: ReferencedRoleMeta | null = null;
      if (v.valid && isObj(role)) {
        const rid = nonEmptyString(role._id) ? role._id : "";
        const rdate =
          role._type === "special_role"
            ? (nonEmptyString(role.date) ? role.date : null)
            : (nonEmptyString(role.week) ? role.week : null);
        referencedRole = { id: rid, type: String(role._type ?? ""), serviceDate: rdate };
      }

      const record: ProposalRecord = {
        id,
        rev: nonEmptyString(doc._rev) ? doc._rev : "",
        status: v.status,
        serviceRef: v.serviceRef,
        targetKey: v.targetKey,
        contentState: v.contentState,
        valid: v.valid,
        issues: v.issues,
        referencedRole,
      };
      records.push(record);
      validatedForIndex.push({ ...v, id });
    } catch {
      records.push({
        id: "(unknown)",
        rev: "",
        status: null,
        serviceRef: null,
        targetKey: null,
        contentState: "invalid",
        valid: false,
        issues: ["exception"],
        referencedRole: null,
      });
    }
  }

  const { byServiceRef, byTargetKey } = indexProposals(validatedForIndex);
  const conflictsFrom = (m: Map<string, ProposalValidation[]>): ProposalConflict[] => {
    const out: ProposalConflict[] = [];
    for (const [key, list] of m) {
      if (list.length > 1) {
        out.push({ key, ids: list.map((p) => (p as ValidatedWithId).id) });
      }
    }
    return out;
  };

  const draftIds: string[] = [];
  for (const draft of rawProposalDrafts) {
    if (isObj(draft) && nonEmptyString(draft._id)) draftIds.push(draft._id);
  }

  return {
    records,
    serviceRefConflicts: conflictsFrom(byServiceRef),
    targetKeyConflicts: conflictsFrom(byTargetKey),
    recordIssues: records.filter((r) => !r.valid),
    draftIds,
  };
}
