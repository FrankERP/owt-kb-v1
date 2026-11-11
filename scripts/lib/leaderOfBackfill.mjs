// Pure half of scripts/backfill-jovenes-leader-of.mjs (plan
// docs/superpowers/plans/2026-11-11-jovenes-per-group-leadership.md §6, §11 N4 and N9; ADR-0085).
//
// WHAT IT PLANS. Every stored Jóvenes LEADER item whose `leaderOf` is ABSENT (the key is missing,
// or its value is null/undefined — §4.4's one meaning) gets `leaderOf` = its groups that are group
// ids, de-duplicated, in registry order: today's meaning (L1) said out loud, so nobody's access
// changes. Everything else is left exactly as it is and REPORTED.
//
// It NEVER re-implements the normalizer: it imports `app/ministries.ts` (no imports by design, so
// Node 22 loads it directly) and reads with its L1/L2 switch. `ledGroups` below is `ledGroupsIn`
// (`app/utils/ministryAccess.ts`) over that normalized item — a few lines, because the app module
// imports through the `@/` alias Node cannot resolve; `scripts/__tests__/leaderOfBackfill.test.ts`
// pins the two equal on the same fixtures (N4).
//
// LIFETIME (N4): this file, the script and its test exist only in PR 1's tree. The step-4 dry run
// runs from PR 1's tree (production's code); PR 2 deletes all three together with the switch.

import {
  ABSENT_LEADER_OF,
  MINISTRIES,
  normalizeMinistries,
  normalizeMinistryRoles,
} from "../../app/ministries.ts";

const MINISTRY = "jovenes";

/** The read: every member document that stores levels — published, `drafts.*` and `versions.*`. */
export const LEADER_OF_QUERY =
  '*[_type == "teamMembers" && defined(ministryRoles)]{ _id, _rev, member_name, alias, ministries, ministryRoles }';

/** §4.4: "absent" is one thing everywhere — no key, or a null/undefined value. */
export const isAbsent = (v) => v === undefined || v === null;

/** Which document this is: the published one, a Studio draft, or a Content Release version (N9). */
export function documentKind(id) {
  if (typeof id !== "string") return "unknown";
  if (id.startsWith("drafts.")) return "draft";
  if (id.startsWith("versions.")) return "version";
  return "published";
}

/** A `_key` the script can address in a patch path (`ministryRoles[_key=="…"]`). */
const ADDRESSABLE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * `ledGroupsIn(accessFromDoc(doc), "jovenes")` with the read's L1/L2 switch: the groups this stored
 * document leads, read through the app's own normalizer. `absentLeaderOf` defaults to the switch's
 * PR 1 value, so with no argument this is exactly what production reads today.
 */
export function ledGroups(doc, absentLeaderOf = ABSENT_LEADER_OF) {
  const ministries = normalizeMinistries(doc?.ministries);
  if (!ministries.includes(MINISTRY)) return [];
  const item = normalizeMinistryRoles(doc?.ministryRoles, ministries, absentLeaderOf).find((r) => r.ministry === MINISTRY);
  return item?.level === "leader" && Array.isArray(item.leaderOf) ? [...item.leaderOf] : [];
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * THE CHECK (§6): the documents whose led groups differ between L1 and L2, computed on NORMALIZED
 * reads. PR 2 (which flips the read to L2) may not merge to `preview` until this is empty on
 * production data, by a fresh dry run right before that merge.
 */
export function leaderOfCheck(docs) {
  return docs
    .filter((d) => !sameSet(ledGroups(d, "all"), ledGroups(d, "none")))
    .map((d) => ({ id: d._id, kind: documentKind(d._id), name: nameOf(d), l1: ledGroups(d, "all"), l2: ledGroups(d, "none") }));
}

function nameOf(doc) {
  const name = typeof doc?.member_name === "string" ? doc.member_name : "";
  const alias = typeof doc?.alias === "string" && doc.alias.trim() ? ` («${doc.alias.trim()}»)` : "";
  return `${name || "(sin nombre)"}${alias}`;
}

const REGISTRY_ORDER = MINISTRIES[MINISTRY].groups.map((g) => g.id);

/**
 * Plans the backfill over the documents read by `LEADER_OF_QUERY`. Pure: writes nothing.
 *
 * @returns {{
 *   patches: Array<{ id: string, rev: string, kind: string, name: string, path: string, groups: unknown, leaderOf: string[] }>,
 *   skips: Array<{ id: string, kind: string, name: string, reason: string }>,
 *   check: ReturnType<typeof leaderOfCheck>,
 *   checkAfter: ReturnType<typeof leaderOfCheck>,
 *   totals: { documents: number, leaders: number, planned: number, skipped: number },
 * }}
 */
export function planLeaderOfBackfill(docs) {
  const patches = [];
  const skips = [];
  let leaders = 0;
  for (const doc of docs) {
    const id = doc?._id;
    const kind = documentKind(id);
    const name = nameOf(doc);
    const skip = (reason) => skips.push({ id, kind, name, reason });
    const items = (Array.isArray(doc?.ministryRoles) ? doc.ministryRoles : []).filter(
      (i) => typeof i === "object" && i !== null && i.ministry === MINISTRY,
    );
    if (items.length === 0) continue;
    if (items.length > 1) {
      // The read drops both (normalizeMinistryRoles rule 4): a person fixes which one was meant.
      skip(`${items.length} elementos de Jóvenes en ministryRoles (la lectura descarta ambos; corregir a mano)`);
      continue;
    }
    const item = items[0];
    if (item.level !== "leader") {
      if (!isAbsent(item.leaderOf)) skip(`leaderOf guardado en un nivel «${String(item.level)}» (la lectura lo ignora)`);
      continue;
    }
    leaders += 1;
    if (!normalizeMinistries(doc.ministries).includes(MINISTRY)) {
      skip("no está en Jóvenes por ministries (el nivel no da nada)");
      continue;
    }
    if (!isAbsent(item.leaderOf)) {
      skip(`ya tiene leaderOf ${JSON.stringify(item.leaderOf)} (se deja como está)`);
      continue;
    }
    if (kind === "version") {
      // N9: a Content Release version is reported, never written here; it keeps the check above 0
      // until a person discards or fixes it (with Frank's consent) before PR 2.
      skip("documento de una Content Release (versions.*): no se escribe; descartarlo o corregirlo a mano antes de PR 2");
      continue;
    }
    if (typeof item._key !== "string" || !ADDRESSABLE_KEY.test(item._key)) {
      // The one case that can keep the check above 0 with groups: L1 leads all, L2 nothing.
      skip(`elemento sin _key utilizable (${JSON.stringify(item._key ?? null)}): volver a guardarlo en «Personas» antes de PR 2`);
      continue;
    }
    const stored = Array.isArray(item.groups) ? item.groups : [];
    const leaderOf = REGISTRY_ORDER.filter((g) => stored.includes(g));
    if (leaderOf.length === 0) {
      skip("líder sin grupos válidos (hoy no lidera nada; tampoco después)");
      continue;
    }
    patches.push({ id, rev: doc._rev, kind, name, path: `ministryRoles[_key=="${item._key}"].leaderOf`, groups: item.groups, leaderOf });
  }
  const after = applyPlanned(docs, patches);
  return {
    patches,
    skips,
    check: leaderOfCheck(docs),
    checkAfter: leaderOfCheck(after),
    totals: { documents: docs.length, leaders, planned: patches.length, skipped: skips.length },
  };
}

/** The documents as they would read once these patches land (for the projected check and the test). */
export function applyPlanned(docs, patches) {
  const byId = new Map(patches.map((p) => [p.id, p]));
  return docs.map((doc) => {
    const p = byId.get(doc._id);
    if (!p) return doc;
    const key = /_key=="([^"]+)"/.exec(p.path)[1];
    return {
      ...doc,
      ministryRoles: doc.ministryRoles.map((i) => (i && i._key === key && i.ministry === MINISTRY ? { ...i, leaderOf: [...p.leaderOf] } : i)),
    };
  });
}
