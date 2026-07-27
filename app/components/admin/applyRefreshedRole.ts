// Adopt the committed revision a guarded role edit returns.
//
// A2's edit route answers with the stored document at the revision it just
// committed. The panel used to discard that and rely on a follow-up reload, which
// is fine until the reload fails: the card then keeps its PRE-write `_rev`, and
// the operator's very next save is refused with a conflict we caused ourselves, on
// data that is actually healthy. Adopting the returned document closes that hole —
// the card stays usable even when the refresh does not land.
//
// Deliberately conservative: anything that is not recognisably the edited role is
// ignored and the existing state is left for the reload to correct. A wrong local
// revision is worse than a missing one, because it is submitted with confidence.

import { ROLE_TYPES } from "@/app/utils/serviceReadModel";

/** The minimum a response must carry to be adopted as a role's new state. */
export interface RefreshedRole {
  _id: string;
  _rev: string;
  _type: string;
  [key: string]: unknown;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Extract the committed role from a mutation response body, or null.
 *
 * Null is the safe answer: the caller keeps what it had and lets the reload
 * correct it. In particular a body with no `_rev` — the shape the route returned
 * before it re-read after commit — yields null rather than a role with a missing
 * revision.
 */
export function refreshedRoleFromResponse(body: unknown): RefreshedRole | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const doc = body as Record<string, unknown>;
  if (!nonEmptyString(doc._id) || !nonEmptyString(doc._rev)) return null;
  if (!nonEmptyString(doc._type) || !(ROLE_TYPES as readonly string[]).includes(doc._type)) return null;
  return doc as unknown as RefreshedRole;
}

/**
 * Replace the matching loaded role with the refreshed document.
 *
 * Returns the SAME array reference when nothing changes, so an unrelated response
 * cannot trigger a re-render. The refreshed document REPLACES rather than merges:
 * a merge would keep a seat the commit removed, leaving the card showing an
 * assignment the server no longer has.
 */
export function applyRefreshedRole<T extends { _id: string }>(
  roles: readonly T[],
  refreshed: RefreshedRole | null,
): T[] {
  if (!refreshed) return roles as T[];
  let found = false;
  const next = roles.map((role) => {
    if (role._id !== refreshed._id) return role;
    found = true;
    return refreshed as unknown as T;
  });
  return found ? next : (roles as T[]);
}
