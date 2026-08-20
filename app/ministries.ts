/**
 * Code-level ministry registry. Adding a ministry is a code change on
 * purpose: every new ministry brings its own rules and UI anyway.
 * Generic per-ministry schemas are deliberately deferred until a THIRD
 * ministry exists — see ADR-0019.
 */
export const MINISTRIES = {
  worship: { id: "worship", name: "Alabanza" },
  kids: { id: "kids", name: "Oasis Kids" },
} as const;

export type MinistryId = keyof typeof MINISTRIES;

export const ALL_MINISTRY_IDS = Object.keys(MINISTRIES) as MinistryId[];

/**
 * Membership test, NOT `x in MINISTRIES`. The `in` operator walks the prototype
 * chain, so `"constructor"`, `"toString"` and `"__proto__"` all pass it —
 * verified: `node -e '...' ` prints true for all three. This function validates
 * an AUTH field, and a member stored with `ministries: ["toString"]` belongs to
 * no ministry at all, which strands them in a redirect bounce with no
 * self-service recovery. Array membership has no prototype hole.
 */
export function isMinistryId(x: unknown): x is MinistryId {
  return typeof x === "string" && (ALL_MINISTRY_IDS as string[]).includes(x);
}

/**
 * THE one definition of "which ministries does this stored value mean".
 *
 * Absent or empty ⇒ `["worship"]`: every member predating the kids feature is a
 * worship member, which is what makes this a no-migration change. Non-array or
 * junk entries are dropped (a bare string would otherwise satisfy
 * `"worshipkids".includes("worship")`).
 *
 * EVERY reader goes through this — the member snapshot, the admin form's
 * checkbox seed, and any GROQ-side filter's TypeScript counterpart. Open-coding
 * the rule per call site is how the admin form came to display "no ministries"
 * for a worship member, one save away from revoking their access.
 */
export function normalizeMinistries(v: unknown): MinistryId[] {
  const known = Array.isArray(v) ? v.filter(isMinistryId) : [];
  return known.length > 0 ? known : ["worship"];
}

/**
 * The GROQ counterpart of `normalizeMinistries`, for worship admin reads of
 * `teamMembers`. Interpolate into a filter and bind `$all`:
 *
 *   `*[_type == "teamMembers" && ${WORSHIP_MEMBER_GROQ_FILTER}]`, { all }
 *
 * `$all` is true for `super-admin` ONLY — they are the single role that can edit
 * `ministries`, so filtering their view would leave a Kids-only member
 * permanently uneditable through the UI. Plain `admin`/`content-editor` are
 * worship-scoped and see worship members only.
 *
 * The `!defined` / `count(...) == 0` arms are NOT belt-and-braces: they are the
 * storage contract (absent ⇒ worship). A bare `"worship" in ministries` would
 * hide every member who predates the kids feature — which is all of them.
 */
export const WORSHIP_MEMBER_GROQ_FILTER =
  '($all || !defined(ministries) || count(ministries) == 0 || "worship" in ministries)';

/** Ministries a member can be granted management of. Worship management lives
 *  in the legacy admin/content-editor roles, and NO guard reads a "worship"
 *  entry here — storing one would be a lie in the data. */
export const MANAGEABLE_MINISTRY_IDS: MinistryId[] = ["kids"];

/**
 * Validates a ministry array arriving at a WRITE boundary. Returns an error
 * string, or null when the value may be stored. Both member routes call it, so
 * POST and PATCH cannot drift apart.
 *
 * An explicitly EMPTY `ministries` array is rejected, and that is the whole
 * point of this function. `[].every(isMinistryId)` is vacuously `true`, so a
 * naive check accepts it; `normalizeMinistries` then reads `[]` back as
 * `["worship"]`. The net effect of unticking every box on a Kids volunteer —
 * the natural gesture for "take them out of Kids" — would be to hand them the
 * entire worship catalog while the form shows nothing ticked. Absent means
 * worship because of history; empty must never be stored at all.
 *
 * `managesMinistries: []` stays legal: "manages nothing" is a real, safe state
 * and the only way to revoke management.
 */
export function validateMinistryWrite(
  field: "ministries" | "managesMinistries",
  value: unknown,
): string | null {
  if (!Array.isArray(value)) return "Invalid ministry";
  const allowed = field === "ministries" ? ALL_MINISTRY_IDS : MANAGEABLE_MINISTRY_IDS;
  if (!value.every((m): m is MinistryId => allowed.includes(m as MinistryId))) return "Invalid ministry";
  if (field === "ministries" && value.length === 0) return "Elige al menos un ministerio.";
  return null;
}
