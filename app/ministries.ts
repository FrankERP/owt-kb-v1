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
 * code older than a ministry's registry entry reads a stored id it does not know
 * as WORSHIP (unknown ids are dropped and an empty list falls back to worship).
 * So the release that teaches production to READ a new ministry ships before
 * any deployment can WRITE it — and `preview` writes the production dataset.
 * `jovenes` became readable in production 2026-10-28 (PR #212) and joined this
 * list in the next release. A fourth ministry follows the same two steps.
 */
export const ASSIGNABLE_MINISTRY_IDS: MinistryId[] = ["worship", "kids", "jovenes"];

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

export function isLevel(x: unknown): x is MinistryLevel {
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

/**
 * Validates `ministryRoles` arriving at a WRITE boundary, against the
 * `ministries` of the SAME request. Returns an error string, or null when the
 * value may be stored. Both member routes call it.
 *
 * `ministries` must be in the request and name every item's ministry,
 * explicitly. Judging against the STORED value instead is the trap: absent
 * `ministries` means worship, so a level written next to an absent list would
 * be a Jóvenes admin who is, on every read, a worship member and no Jóvenes
 * member at all — and the read would silently ignore the level it was given.
 *
 * Strict where `normalizeMinistryRoles` is forgiving: the read drops what it
 * cannot use, the write refuses it, so nothing malformed is ever stored. An item
 * carries exactly `ministry`, `level` and `groups` (the form strips the stored
 * `_key`/`_type`; the route adds them back).
 */
export function validateMinistryRolesWrite(value: unknown, ministries: unknown): string | null {
  if (!Array.isArray(value)) return "Niveles de ministerio inválidos.";
  if (!Array.isArray(ministries)) return "Para guardar un nivel de ministerio envía también los ministerios.";
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "Niveles de ministerio inválidos.";
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "groups,level,ministry") return "Niveles de ministerio inválidos.";
    const { ministry, level, groups } = item as Record<string, unknown>;
    if (!isMinistryId(ministry) || !LEVELED_MINISTRY_IDS.includes(ministry)) return "Ministerio sin niveles.";
    if (seen.has(ministry)) return "Un solo nivel por ministerio.";
    seen.add(ministry);
    if (!ministries.includes(ministry)) return `Para darle un nivel en ${MINISTRIES[ministry].name} tiene que pertenecer a ${MINISTRIES[ministry].name}.`;
    if (!isLevel(level)) return "Nivel inválido.";
    if (!Array.isArray(groups) || !groups.every((g) => isGroupId(ministry, g))) return "Grupo inválido.";
    if (new Set(groups).size !== groups.length) return "Grupo repetido.";
    if (level === "leader" && groups.length === 0) return "Un líder necesita al menos un grupo.";
  }
  return null;
}

/**
 * A VALIDATED `ministryRoles` (see above) as stored: `_key` = the ministry, so a
 * person holds at most one item per ministry and a patch can address it as
 * `ministryRoles[_key=="jovenes"]`; `_type` = the Studio's object name, so the
 * Studio never flags the items as unknown.
 */
export function ministryRolesForStorage(items: readonly MinistryRole[]) {
  return items.map(({ ministry, level, groups }) => ({
    _key: ministry, _type: "ministryRole" as const, ministry, level, groups: [...groups],
  }));
}

/**
 * The stale levels a write that sets `ministries` WITHOUT `ministryRoles` must
 * clear: one path per leveled ministry the new list leaves out. The read already
 * ignores such an item; clearing it keeps an old level from reviving if the
 * ministry is ticked again later.
 */
export function droppedMinistryRolePaths(ministries: readonly string[]): string[] {
  return LEVELED_MINISTRY_IDS.filter((id) => !ministries.includes(id)).map((id) => `ministryRoles[_key=="${id}"]`);
}

/** The answer both writers of `role` give (members API 400, Studio validation). */
export const WORSHIP_ROLE_NEEDS_WORSHIP = "Un rol de Alabanza (admin o editor) requiere ser de Alabanza.";

/**
 * True when `role` is a worship MANAGEMENT role and `ministries` (as stored:
 * absent or empty = worship) leave the person outside worship.
 *
 * `requireActiveManager` — every worship admin route — reads `role` alone, with
 * no ministry check. So a Jóvenes admin given `admin` by mistake would become a
 * worship admin, catalog and schedule included. The members API refuses a
 * request that CHANGES role or ministries into this state; the Studio refuses to
 * publish it (ADR-0075, access plan §3.4). `super-admin` spans every ministry by
 * design and is never caught; `member` grants nothing.
 */
export function worshipRoleWithoutWorship(role: unknown, ministries: unknown): boolean {
  return (role === "admin" || role === "content-editor") && !normalizeMinistries(ministries).includes("worship");
}
