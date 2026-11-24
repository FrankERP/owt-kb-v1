// Pure half of scripts/set-album-art.mjs (ADR-0088): which listed songs get a cover, which
// get their cover SWAPPED, and which are left alone. It decides a production write, so it
// lives here where scripts/lib/__tests__/album-art-plan.test.mjs can pin it.

export const ASSET_ID = /^image-[0-9a-f]{40}-\d+x\d+-(jpg|png)$/;

/**
 * The list is data, so it is checked whole before anything is read: a malformed row must
 * stop the run, never be skipped into a partial load nobody notices.
 * Returns the first problem as a sentence, or null.
 */
export function albumArtListProblem(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return "expected a non-empty array of { id, asset }.";
  const seen = new Set();
  for (const t of targets) {
    const row = JSON.stringify(t);
    if (typeof t?.id !== "string" || !t.id || t.id.startsWith("drafts.") || typeof t?.asset !== "string" || !ASSET_ID.test(t.asset)) {
      return `bad row ${row} — need a published song id and a JPEG/PNG image asset id.`;
    }
    if (t.replaces !== undefined && (typeof t.replaces !== "string" || !ASSET_ID.test(t.replaces) || t.replaces === t.asset)) {
      return `bad row ${row} — "replaces" must be ANOTHER image asset id (the cover this loader wrote before).`;
    }
    if (seen.has(t.id)) return `song ${t.id} is listed twice.`;
    seen.add(t.id);
  }
  return null;
}

/**
 * targets:  [{ id, asset, replaces?, title?, album?, artist? }]
 * docs:     [{ _id, _rev, title, current }]   current = albumArt.asset._ref or null
 * draftIds: ids of open drafts ("drafts.<id>")
 * assetIds: ids of the listed image assets that exist
 *
 * One rule decides a swap: a song that already has a cover keeps it UNLESS the row names
 * that exact asset in `replaces`. So only a cover this loader wrote itself is ever changed;
 * one an editor chose in the Studio is a different asset and is reported, never touched.
 */
export function planAlbumArt({ targets, docs, draftIds, assetIds }) {
  const byId = new Map(docs.map((d) => [d._id, d]));
  const drafts = new Set(draftIds);
  const assets = new Set(assetIds);
  const writes = [];
  const skipped = [];
  const count = { add: 0, swap: 0, same: 0, kept: 0, draft: 0, asset: 0, missing: 0 };
  for (const t of targets) {
    const doc = byId.get(t.id);
    const name = doc?.title ?? t.title ?? t.id;
    if (!doc) { count.missing++; skipped.push({ id: t.id, name, why: "missing" }); continue; }
    const current = doc.current ?? null;
    if (current === t.asset) { count.same++; continue; }
    if (current && current !== t.replaces) { count.kept++; skipped.push({ id: t.id, name, why: "kept", current }); continue; }
    if (drafts.has(`drafts.${t.id}`)) { count.draft++; skipped.push({ id: t.id, name, why: "draft" }); continue; }
    if (!assets.has(t.asset)) { count.asset++; skipped.push({ id: t.id, name, why: "asset" }); continue; }
    if (current) count.swap++; else count.add++;
    writes.push({ ...t, title: doc.title ?? t.title, _rev: doc._rev, previous: current });
  }
  return { writes, skipped, count };
}
