// NO IMPORTS, by design: `sanity/schemas/worshipTeam.ts` imports this module,
// and the embedded Studio (`/studio`) bundles every schema into a browser build
// that no CI gate builds. A server-only import here would leak into that bundle
// unseen. Same contract as `app/mcp/oauth/documentTypes.ts`; guarded by
// `ministrySchemaSync.test.ts`.

/**
 * Code-level ministry registry. Adding a ministry is a code change on
 * purpose: every new ministry brings its own rules and UI anyway.
 * The third ministry (Pastores de jóvenes) arrived 2026-10-27, so the
 * generalization ADR-0019 deferred starts here — ADR-0075.
 *
 * A GROUP is a part of a ministry closed to the others (ADR-0075 §2). Its id
 * is stored on people and, later, on meetings; its name is display only, so a
 * name can change without losing who is in which group.
 */
export const MINISTRIES = {
  worship: { id: "worship", name: "Alabanza", groups: [] },
  kids: { id: "kids", name: "Oasis Kids", groups: [] },
  jovenes: {
    id: "jovenes",
    name: "Jóvenes",
    groups: [
      { id: "otro-nivel", name: "Otro Nivel" },
      { id: "invencibles", name: "Invencibles" },
      { id: "emprendedores", name: "Emprendedores" },
    ],
  },
} as const;

export type MinistryId = keyof typeof MINISTRIES;

/** Every ministry the code can READ. Registering one here makes a stored id
 *  mean something; it does NOT make it writable — see ASSIGNABLE_MINISTRY_IDS. */
export const ALL_MINISTRY_IDS = Object.keys(MINISTRIES) as MinistryId[];

/**
 * The ministries a write may store and the admin form and Studio may offer.
 *
 * Kept apart from ALL_MINISTRY_IDS on purpose (ADR-0075, access plan §3.1/§4.1):
 * code older than the `jovenes` entry reads a stored `["jovenes"]` as WORSHIP
 * (unknown ids are dropped and an empty list falls back to worship). So the
 * release that teaches production to READ `jovenes` ships before any deployment
 * can WRITE it — and `preview` writes the production dataset. `jovenes` joins
 * this list only in the PR that adds its write side.
 */
export const ASSIGNABLE_MINISTRY_IDS: MinistryId[] = ["worship", "kids"];

/** Ministries whose level and groups live in `teamMembers.ministryRoles`.
 *  Worship's level stays the legacy `role`; Kids' admin stays `managesMinistries`. */
export const LEVELED_MINISTRY_IDS: MinistryId[] = ["jovenes"];

export const MINISTRY_LEVELS = ["member", "leader", "admin"] as const;
export type MinistryLevel = (typeof MINISTRY_LEVELS)[number];

/** One person's level and groups in one leveled ministry, as the read sees it. */
export type MinistryRole = { ministry: MinistryId; level: MinistryLevel; groups: string[] };

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

/** Same prototype-safe membership test, for a group id inside one ministry. */
export function isGroupId(ministry: MinistryId, x: unknown): x is string {
  return typeof x === "string" && MINISTRIES[ministry].groups.some((g) => g.id === x);
}

function isLevel(x: unknown): x is MinistryLevel {
  return typeof x === "string" && (MINISTRY_LEVELS as readonly string[]).includes(x);
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
/**
 * "Is this member part of the worship team", with NO super-admin bypass.
 *
 * Use this for a NOTIFICATION AUDIENCE. `WORSHIP_MEMBER_GROQ_FILTER` below adds
 * an `$all` arm so a super-admin can SEE every member in an admin list; being
 * able to see someone is not a reason to email or push at them, and binding
 * `$all: true` on an audience would mail the whole Kids roster about worship
 * setlists.
 *
 * Same storage contract as everywhere else: absent or empty `ministries` means
 * worship, because that is every member who predates the Kids feature. A bare
 * `"worship" in ministries` here would silence the entire existing team.
 */
export const WORSHIP_AUDIENCE_GROQ_FILTER =
  '(!defined(ministries) || count(ministries) == 0 || "worship" in ministries)';

export const WORSHIP_MEMBER_GROQ_FILTER = `($all || ${WORSHIP_AUDIENCE_GROQ_FILTER.slice(1, -1)})`;

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
  const allowed = field === "ministries" ? ASSIGNABLE_MINISTRY_IDS : MANAGEABLE_MINISTRY_IDS;
  if (!value.every((m): m is MinistryId => allowed.includes(m as MinistryId))) return "Invalid ministry";
  if (field === "ministries" && value.length === 0) return "Elige al menos un ministerio.";
  return null;
}

/**
 * THE one reading of a stored `teamMembers.ministryRoles`, given the member's
 * NORMALIZED `ministries`. Fails closed at every step — a dropped item leaves
 * the person a plain member of that ministry, with no level and no groups:
 *
 * 1. Not an array → `[]`. An item whose ministry is not leveled, or that the
 *    person is not a member of, is dropped: a level grants nothing without
 *    membership (ADR-0075 «the trap»).
 * 2. A `level` outside MINISTRY_LEVELS drops the item.
 * 3. `groups`: kept only if a group of that ministry; de-duplicated.
 * 4. Two stored items naming one ministry → BOTH dropped, even if one of them is
 *    malformed: there is no guessing which one was meant.
 */
export function normalizeMinistryRoles(raw: unknown, ministries: readonly MinistryId[]): MinistryRole[] {
  if (!Array.isArray(raw)) return [];
  const items = raw.filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null);
  const named = (m: unknown) => items.filter((i) => i.ministry === m).length;
  const parsed: MinistryRole[] = [];
  for (const item of items) {
    const { ministry, level, groups } = item;
    if (named(ministry) !== 1) continue;
    if (!isMinistryId(ministry) || !LEVELED_MINISTRY_IDS.includes(ministry)) continue;
    if (!ministries.includes(ministry)) continue;
    if (!isLevel(level)) continue;
    const kept = Array.isArray(groups) ? groups.filter((g) => isGroupId(ministry, g)) : [];
    parsed.push({ ministry, level, groups: [...new Set(kept)] });
  }
  return parsed;
}
