import { normalizeForMatch } from "./catalog-reconcile.mjs";

export const ALIAS = {
  "hillsong yf": "hillsong young free",
  "bethel": "bethel music",
};

export const KEY_CANONICAL = {
  "hillsong young free": "Hillsong Young & Free",
  "bethel music": "Bethel Music",
  "en espiritu y en verdad": "En Espíritu y En Verdad",
};

export function parseAuthors(str) {
  return (str ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function dedupeKey(raw) {
  const n = normalizeForMatch(raw);
  return ALIAS[n] ?? n;
}

export function buildFreq(allRaws) {
  const freq = new Map();
  for (const raw of allRaws) {
    const key = dedupeKey(raw);
    if (!freq.has(key)) freq.set(key, new Map());
    const m = freq.get(key);
    m.set(raw, (m.get(raw) ?? 0) + 1);
  }
  return freq;
}

export function canonicalName(raw, freq) {
  const key = dedupeKey(raw);
  if (KEY_CANONICAL[key]) return KEY_CANONICAL[key];
  const counts = freq.get(key) ?? new Map([[raw, 1]]);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}
