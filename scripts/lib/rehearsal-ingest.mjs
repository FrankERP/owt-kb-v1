// Pure half of scripts/ingest-rehearsal-mixes.mjs: folder-name parsing,
// catalog matching and the idempotent write plan. No I/O here, so the plan
// is testable and the dry run prints EXACTLY what --apply would do.
//
// Contract: abletonnl manifest.json (spec 2026-09-20-rehearsal-mixes §5):
//   set.sha1, song.name ("2. NADIE"), song.bpm_range, files[]{ path, kind,
//   target, family, peaks, active }.
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeForMatch } from "./catalog-reconcile.mjs";
import { matchSong } from "./setlist-match.mjs";

const FOLDER_RE = /^(.*?)_(\d+(?:\.\d+)?)BPM_([A-G](?:#|b)?m?)(?:\s+Project)?$/i;

export function parseFolderName(name) {
  const m = name.match(FOLDER_RE);
  if (!m) return { title: name.replace(/\s+Project$/i, "").trim(), bpm: null, tone: null };
  return { title: m[1].trim(), bpm: Number(m[2]), tone: m[3] };
}

export function songNameFromManifest(manifest) {
  return String(manifest?.song?.name ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

export function mixKey(setSha1, filePath) {
  return createHash("sha1").update(`${setSha1}${path.basename(filePath)}`).digest("hex").slice(0, 24);
}

/** Folder name first, manifest song name second; an override wins outright. */
export function matchFolder({ folderName, manifest, index, overrides }) {
  if (overrides && overrides[folderName]) return { postId: overrides[folderName] };
  const tried = [];
  for (const raw of [parseFolderName(folderName).title, songNameFromManifest(manifest)]) {
    if (!raw) continue;
    const r = matchSong(raw, index);
    tried.push({ raw, key: normalizeForMatch(raw), result: r });
    if (r?.postId) return { postId: r.postId };
  }
  const ambiguous = tried.find((t) => t.result?.candidates);
  if (ambiguous) return { unmatched: { reason: "ambiguous", candidates: ambiguous.result.candidates, tried } };
  return { unmatched: { reason: "no-match", candidates: [], tried } };
}

/**
 * The full `rehearsalMixes` array to `.set`, plus what to upload and delete.
 * Items from OTHER renders (different sourceHash) are kept verbatim from
 * `existingItems`; items of THIS render are rebuilt from the manifest, reusing
 * an asset when its sha1 equals the local file's.
 */
export function planIngest({ manifest, folderName, post, existing = [], existingItems = {}, localSha1 = {} }) {
  const setSha1 = manifest.set.sha1;
  const folder = parseFolderName(folderName);
  const tone = folder.tone ?? post.key ?? "";
  const bpm = Number.isFinite(manifest?.song?.bpm_range?.[0]) ? manifest.song.bpm_range[0] : folder.bpm ?? undefined;
  const byKey = new Map(existing.map((e) => [e._key, e]));

  const items = [];
  const uploads = [];
  const skipped = [];
  const replaced = [];
  const thisRenderKeys = new Set();

  for (const f of manifest.files) {
    const filename = path.basename(f.path);
    const _key = mixKey(setSha1, f.path);
    thisRenderKeys.add(_key);
    const prior = byKey.get(_key);
    let audioFile;
    if (prior && prior.assetId && prior.sha1 && localSha1[f.path] === prior.sha1) {
      skipped.push(_key);
      audioFile = { _type: "file", asset: { _type: "reference", _ref: prior.assetId } };
    } else {
      if (prior?.assetId) replaced.push(prior.assetId);
      const uploadIndex = uploads.length;
      uploads.push({ path: f.path, filename, uploadIndex });
      audioFile = { _type: "file", asset: { _type: "reference", uploadIndex } };
    }
    const item = { _key, _type: "rehearsalMix", kind: f.kind, tone, sourceHash: setSha1, audioFile };
    if (bpm !== undefined) item.bpm = bpm;
    if (f.kind === "up") {
      item.track = f.target;
      item.family = f.family;
      item.peaks = f.peaks;
      // Sanity has no array-of-arrays; the manifest's [[s,e], …] becomes an
      // array of { _key, s, e } objects (schema: sanity/schemas/post.ts).
      item.active = (f.active ?? []).map(([s, e], i) => ({ _key: String(i), s, e }));
    }
    items.push(item);
  }

  const kept = [];
  for (const e of existing) {
    if (e.sourceHash === setSha1) {
      if (!thisRenderKeys.has(e._key) && e.assetId) replaced.push(e.assetId);
      continue;
    }
    const full = existingItems[e._key];
    if (full) { items.push(full); kept.push(e._key); }
  }
  return { items, uploads, kept, skipped, replaced };
}
