import { normalizeForMatch } from "./catalog-reconcile.mjs";

export function buildCatalogIndex(posts) {
  const index = new Map();
  const add = (s, id) => { const k = normalizeForMatch(s); if (!k) return; if (!index.has(k)) index.set(k, new Set()); index.get(k).add(id); };
  for (const p of posts) {
    add(p.title, p._id);
    const m = p.title.match(/^([^([]+)[([](.+?)[)\]]/);  // "Spanish (English)" -> both parts
    if (m) { add(m[1], p._id); add(m[2], p._id); }
  }
  return new Map([...index].map(([k, set]) => [k, [...set]]));
}

export function matchSong(rawName, index, aliases = {}) {
  const k = normalizeForMatch(rawName);
  if (!k) return null;
  if (aliases[k]) return { postId: aliases[k] };
  const ids = index.get(k);
  if (!ids) return null;
  return ids.length === 1 ? { postId: ids[0] } : { candidates: [...ids].sort() };
}
