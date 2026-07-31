// app/utils/normalizeLabel.ts
//
// The ONE normalization for a user-typed label that participates in a service's
// IDENTITY: a special service's `service_name`, and an instrument/FOH seat
// label.
//
// **NFC + trim + collapse internal whitespace, and NOTHING else.** Case and
// accents are meaningful: `Vigilia` and `vigilia` are two different specials and
// the server treats them as two. `loadTargetOccupancy` filters canonical
// specials by this exact string (`roleWriteOps.ts`), against the creation
// receipt's identity `special_role:${date}:${name}`
// (`roleCreationReceipt.ts`). A `.toLowerCase()` (or a stripped accent) on
// either side would silently diverge from the server's identity: a second
// special whose name differs only in case would find no occupant, no 409 would
// fire, and the first document would be orphaned in silence.
//
// Pure and dependency-free ON PURPOSE. This used to be hand-copied in three
// places — `roleCreationReceipt.ts` (module-private), `roleWriteRequest.ts`
// (module-private) and inline in `roleWriteOps.ts` — and the planner grid needs
// a fourth copy on the CLIENT to key a special's collision check. It cannot
// import the definition from `roleCreationReceipt.ts`: that module is
// server-only and imports `node:crypto`, which a client import would drag into
// the bundle. So the definition lives here, importable from both sides, and the
// server modules import it rather than re-stating it.

/**
 * NFC + trim + collapse internal whitespace. Case and accents are meaningful.
 * Returns `null` for a non-string or for a value that normalizes to empty —
 * the shape the write path's validation needs ("absent" vs "present").
 */
export function normalizeLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const out = v.normalize("NFC").trim().replace(/\s+/g, " ");
  return out.length ? out : null;
}

/**
 * The same normalization as a total function over strings: an absent or blank
 * name collapses to `""`. This is the shape a COLLISION key needs — two
 * nameless specials on one date must collide with each other, so they have to
 * share a key rather than each getting a `null` that compares unequal.
 */
export function normalizeServiceName(v: unknown): string {
  return normalizeLabel(v) ?? "";
}
