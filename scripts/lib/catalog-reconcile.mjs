const TEMPO_DROP = new Set(["alabanza", "adoración", "adoracion"]);
const TEMPO_TAGS = new Set(["up beat", "down beat"]);

export function stripDiacritics(s) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeForMatch(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, " ")   // drop (...) and [...] subtitles
    .replace(/[^a-z0-9 ]+/g, "")     // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTempoTags(names) {
  const out = [];
  const seen = new Set();
  for (const name of names) {
    const norm = stripDiacritics(name).toLowerCase().trim();
    if (TEMPO_DROP.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

export function mergeTagNames(existing, incoming) {
  return cleanTempoTags([...(existing ?? []), ...(incoming ?? [])]);
}

export function matchRow(row, existingPosts) {
  const t = normalizeForMatch(row.title);
  const candidates = existingPosts.filter((p) => normalizeForMatch(p.title) === t);
  if (candidates.length === 0) return { status: "new", matchId: null, candidateIds: [] };
  if (candidates.length === 1) return { status: "matched", matchId: candidates[0]._id, candidateIds: [candidates[0]._id] };
  const a = normalizeForMatch(row.author);
  const byAuthor = candidates.filter((p) => a && normalizeForMatch(p.author) === a);
  if (byAuthor.length === 1) return { status: "matched", matchId: byAuthor[0]._id, candidateIds: candidates.map((c) => c._id) };
  return { status: "ambiguous", matchId: null, candidateIds: candidates.map((c) => c._id) };
}

export function computeFieldUpdates(existing, row) {
  const set = {};
  const conflicts = [];
  const flags = [];

  if (row.musicalUrl) set.musicalReferenceUrl = row.musicalUrl;
  if (row.lyricsUrl)  set.lyricsVideoUrl = row.lyricsUrl;

  if (row.key && row.key !== existing.key) set.key = row.key;
  if (row.bpm != null && Number(row.bpm) !== Number(existing.bpm)) set.bpm = Number(row.bpm);
  if (row.timeSig && !existing.timeSig) set.timeSig = row.timeSig;

  if (row.title && normalizeForMatch(row.title) === normalizeForMatch(existing.title)
      && row.title !== existing.title) {
    conflicts.push({ field: "title", existing: existing.title, sheet: row.title });
  }
  if (row.author && existing.author && normalizeForMatch(row.author) === normalizeForMatch(existing.author)
      && row.author !== existing.author) {
    conflicts.push({ field: "author", existing: existing.author, sheet: row.author });
  }

  const finalTags = mergeTagNames(existing.tagNames ?? [], row.tags ?? []);
  set._tagNames = finalTags;  // runner resolves names -> refs
  if (!finalTags.some((n) => TEMPO_TAGS.has(stripDiacritics(n).toLowerCase()))) {
    flags.push("no-tempo-tag");
  }
  return { set, conflicts, flags };
}
