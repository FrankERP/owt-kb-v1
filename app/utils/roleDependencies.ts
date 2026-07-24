// Confirmed date/deletion dependency inventory (Service Readiness A2 §3) — pure.
//
// Normal create/move/delete NEVER cascades, adopts, migrates, archives, or
// deletes service history. This module answers only one question: "what history
// already exists at the affected target(s)?" — inventory and decision, no
// mutation, no Sanity client, no I/O. It operates over already-fetched arrays so
// every refusal rule is exhaustively unit-testable in memory.
//
// Why an explicit inventory rather than `references(roleId)`:
//   - weekend setlists are DATE-keyed (`featuredSongs:<week>` /
//     `saturdarSongs:<week>`) and hold no reference to the role at all, so a
//     reference query cannot see them;
//   - a destination proposal must block even when it references another role or
//     no role at all, so `service_ref` alone is not sufficient either.
// Hence both the date/target-key indexes and `service_ref` are consulted, across
// every proposal status, plus malformed/dangling records and raw drafts.
//
// Fail-closed by construction: anything that cannot be cleanly classified but
// touches the role or a scope date is reported as a dependency, and inputs that
// cannot be turned into a complete scope set return `usable: false` so the
// caller refuses instead of proceeding on a partial inventory.

import {
  ROLE_TYPES,
  proposalTargetKey,
  setlistTargetKey,
  type RoleType,
} from "@/app/utils/serviceReadModel";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";
import type { DependencyErrorCode, DependencyRef } from "@/app/utils/serviceMutation";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

const SERVICE_KIND_OF: Record<RoleType, "sunday" | "saturday" | "special"> = {
  sunday_role: "sunday",
  saturday_role: "saturday",
  special_role: "special",
};

export type RoleDependencyOperation = "create" | "move" | "delete";

export interface DependencyScope {
  /** `target` for a create, `old`/`new` for the two sides of a move or a delete. */
  scope: "target" | "old" | "new";
  roleType: RoleType;
  date: string;
  /** Null for a create (the role does not exist yet). */
  roleId: string | null;
  /** `featuredSongs:<week>` / `saturdarSongs:<week>`, or the special role id. */
  setlistTargetKey: string | null;
  /** `sunday:<date>` / `saturday:<date>`, or `special:<roleId>`. */
  proposalTargetKey: string | null;
}

export interface RoleDependencyInput {
  operation: RoleDependencyOperation;
  /** The stored role for `move`/`delete`. */
  role?: unknown;
  /** The requested target for `create`. */
  target?: { roleType: RoleType; date: string };
  /** The proposed new date for `move`. */
  newDate?: string | null;
  canonicalSetlists?: unknown[];
  rawSetlistDrafts?: unknown[];
  canonicalProposals?: unknown[];
  rawProposalDrafts?: unknown[];
  /** Documents that hold a strong reference to the role (e.g. `references($id)`). */
  unknownReferences?: unknown[];
}

export interface RoleDependencyInventory {
  /** The §3 refusal code this operation would return. */
  code: DependencyErrorCode;
  /**
   * False when the inputs could not be turned into a complete scope set. The
   * caller MUST refuse the operation — an unusable inventory is not "no
   * dependencies found".
   */
  usable: boolean;
  /** Issue tags: role | role_type | role_id | date | target | new_date. */
  issues: string[];
  scopes: DependencyScope[];
  dependencies: DependencyRef[];
  hasDependencies: boolean;
}

const CODE_OF: Record<RoleDependencyOperation, DependencyErrorCode> = {
  create: "target_has_orphaned_dependencies",
  move: "role_date_has_dependencies",
  delete: "role_has_dependencies",
};

function makeScope(
  scope: DependencyScope["scope"],
  roleType: RoleType,
  date: string,
  roleId: string | null,
): DependencyScope {
  const isSpecial = roleType === "special_role";
  return {
    scope,
    roleType,
    date,
    roleId,
    // A special service stores its songs on the role itself, so its "setlist
    // target" is the role id; a create has no id yet, hence no orphan history.
    setlistTargetKey: isSpecial ? roleId : setlistTargetKey(roleType, date, roleId ?? ""),
    proposalTargetKey:
      isSpecial && !roleId ? null : proposalTargetKey(SERVICE_KIND_OF[roleType], date, roleId ?? ""),
  };
}

/** Canonical target key of a weekend setlist document (`type:week`). */
function setlistDocKey(doc: unknown): string | null {
  if (!isObj(doc)) return null;
  const type = doc._type;
  if (type !== "featuredSongs" && type !== "saturdarSongs") return null;
  if (!nonEmptyString(doc._id)) return null;
  const week = serviceDayKey(doc.week);
  return week ? `${type}:${week}` : null;
}

interface ProposalFacts {
  id: string;
  serviceRef: string | null;
  date: string | null;
  status: string | null;
  targetKey: string | null;
}

function proposalFacts(doc: unknown): ProposalFacts | null {
  if (!isObj(doc) || !nonEmptyString(doc._id)) return null;
  const serviceRef = nonEmptyString(doc.service_ref) ? doc.service_ref : null;
  const date = serviceDayKey(doc.service_date);
  const kindKnown =
    doc.service_type === "sunday" || doc.service_type === "saturday" || doc.service_type === "special";
  const targetKey =
    kindKnown && date && serviceRef
      ? proposalTargetKey(doc.service_type as string, date, serviceRef)
      : null;
  return {
    id: doc._id,
    serviceRef,
    date,
    status: typeof doc.status === "string" ? doc.status : null,
    targetKey,
  };
}

/**
 * Inventory every dependency that blocks a create/move/delete, returning the
 * exact ids/types that populate `target_has_orphaned_dependencies`,
 * `role_date_has_dependencies`, and `role_has_dependencies`.
 */
export function inventoryRoleDependencies(input: RoleDependencyInput): RoleDependencyInventory {
  const issues: string[] = [];
  const scopes: DependencyScope[] = [];
  const code = CODE_OF[input.operation] ?? "role_has_dependencies";

  let roleId: string | null = null;
  let roleType: RoleType | null = null;
  let roleDoc: Record<string, unknown> | null = null;

  if (input.operation === "create") {
    const target = input.target;
    if (!isObj(target)) {
      issues.push("target");
    } else {
      roleType = (ROLE_TYPES as readonly unknown[]).includes(target.roleType)
        ? (target.roleType as RoleType)
        : null;
      if (!roleType) issues.push("role_type");
      const date = serviceDayKey(target.date);
      if (!date) issues.push("date");
      if (roleType && date) scopes.push(makeScope("target", roleType, date, null));
    }
  } else {
    roleDoc = isObj(input.role) ? input.role : null;
    if (!roleDoc) {
      issues.push("role");
    } else {
      roleType = (ROLE_TYPES as readonly unknown[]).includes(roleDoc._type)
        ? (roleDoc._type as RoleType)
        : null;
      if (!roleType) issues.push("role_type");
      roleId = nonEmptyString(roleDoc._id) ? roleDoc._id : null;
      if (!roleId) issues.push("role_id");
      const date = serviceDayKey(roleType === "special_role" ? roleDoc.date : roleDoc.week);
      if (!date) issues.push("date");
      if (roleType && roleId && date) {
        scopes.push(makeScope("old", roleType, date, roleId));
        if (input.operation === "move") {
          const newDate = serviceDayKey(input.newDate);
          if (!newDate) issues.push("new_date");
          else if (newDate !== date) scopes.push(makeScope("new", roleType, newDate, roleId));
        }
      } else if (input.operation === "move" && !serviceDayKey(input.newDate)) {
        issues.push("new_date");
      }
    }
  }

  const usable = issues.length === 0 && scopes.length > 0;
  const dependencies: DependencyRef[] = [];
  const seen = new Set<string>();

  const add = (ref: DependencyRef) => {
    if (seen.has(ref.id)) return;
    seen.add(ref.id);
    dependencies.push(ref);
  };

  // ── Setlists: date-keyed, so only an explicit key match can find them ──────
  const scanSetlists = (rows: unknown[] | undefined, kind: "canonical_setlist" | "raw_setlist_draft") => {
    if (!Array.isArray(rows)) return;
    for (const scope of scopes) {
      if (!scope.setlistTargetKey) continue;
      for (const row of rows) {
        const key = setlistDocKey(row);
        if (!key || key !== scope.setlistTargetKey) continue;
        const doc = row as Record<string, unknown>;
        const songCount = Array.isArray(doc.songs) ? doc.songs.length : 0;
        add({
          id: doc._id as string,
          type: doc._type as string,
          kind,
          scope: scope.scope,
          // An EMPTY setlist still blocks: normal create/move never adopts history.
          detail: `songs:${songCount}`,
        });
      }
    }
  };

  // ── Proposals: matched through BOTH indexes, across every status ───────────
  const scanProposals = (rows: unknown[] | undefined, raw: boolean) => {
    if (!Array.isArray(rows)) return;
    for (const scope of scopes) {
      for (const row of rows) {
        const facts = proposalFacts(row);
        if (!facts) continue;
        const ownedByRole = !!(roleId && facts.serviceRef === roleId);
        if (facts.targetKey) {
          // Well-formed: a destination match blocks even when the proposal
          // references another role, or a role that no longer exists.
          if (facts.targetKey !== scope.proposalTargetKey && !ownedByRole) continue;
          add({
            id: facts.id,
            type: "setlistProposal",
            kind: raw ? "raw_proposal_draft" : "proposal",
            scope: scope.scope,
            detail: `status:${facts.status ?? "unknown"}`,
          });
          continue;
        }
        // Malformed / dangling / missing-role record: fail closed and report it
        // whenever it touches this role or one of the affected dates.
        if (!ownedByRole && facts.date !== scope.date) continue;
        add({
          id: facts.id,
          type: "setlistProposal",
          kind: raw ? "raw_proposal_draft" : "malformed_proposal",
          scope: scope.scope,
          detail: `status:${facts.status ?? "unknown"}`,
        });
      }
    }
  };

  scanSetlists(input.canonicalSetlists, "canonical_setlist");
  scanSetlists(input.rawSetlistDrafts, "raw_setlist_draft");
  scanProposals(input.canonicalProposals, false);
  scanProposals(input.rawProposalDrafts, true);

  // ── Special embedded songs ────────────────────────────────────────────────
  // Deletion destroys them, so they are a dependency. A date MOVE keeps them
  // (they travel with the role), so they are not.
  if (
    input.operation === "delete" &&
    roleType === "special_role" &&
    roleId &&
    roleDoc &&
    Array.isArray(roleDoc.songs) &&
    roleDoc.songs.length > 0
  ) {
    add({
      id: roleId,
      type: "special_role",
      kind: "special_songs",
      scope: "role",
      detail: `songs:${roleDoc.songs.length}`,
    });
  }

  // ── Unknown strong references ─────────────────────────────────────────────
  if (Array.isArray(input.unknownReferences)) {
    for (const row of input.unknownReferences) {
      if (!isObj(row) || !nonEmptyString(row._id)) continue;
      if (row._id === roleId) continue;
      add({
        id: row._id,
        type: nonEmptyString(row._type) ? row._type : "unknown",
        kind: "unknown_reference",
        scope: "role",
      });
    }
  }

  return { code, usable, issues, scopes, dependencies, hasDependencies: dependencies.length > 0 };
}
