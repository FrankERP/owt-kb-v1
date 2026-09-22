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
 * Items from OTHER renders (different sourceHash — another set, or the same
 * set at another transposition) are kept verbatim from
 * `existingItems`; items of THIS render are rebuilt from the manifest, reusing
 * an asset when its sha1 equals the local file's.
 */
const NOTE_INDEX = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const NOTE_LABEL = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const noteRoot = (k) => NOTE_INDEX[String(k ?? "").match(/^([A-G][#b]?)/)?.[1]] ?? -1;

export function renderSemitones(manifest) {
  // Absent means an untransposed render (manifests before 2026-09-21 had no
  // `transpose`). Anything PRESENT must be an integer number — a null, "" or
  // "x" would otherwise coerce to 0 and claim the untransposed render's rows.
  const raw = manifest?.transpose?.semitones;
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error(`manifest.transpose.semitones is not an integer: ${JSON.stringify(raw)}`);
  return raw;
}

export function renderHash(manifest) {
  const semis = renderSemitones(manifest);
  return semis ? `${manifest.set.sha1}:${semis > 0 ? "+" : ""}${semis}` : manifest.set.sha1;
}

/**
 * The key a transposed render SOUNDS in: the set's key (from the .als file
 * name, `…_69BPM_Ab.als`) moved by the manifest's semitones. The render folder
 * must be named for that key — a folder that still says the source key would
 * store rows a semitone off, so the mismatch is an error, never a guess.
 */
export function transposedTone(manifest, folderTone) {
  const semis = renderSemitones(manifest);
  if (!semis) return folderTone ?? null;
  const source = parseFolderName(path.basename(String(manifest.set.path ?? ""), ".als")).tone;
  const sourceRoot = noteRoot(source);
  if (sourceRoot < 0) {
    if (folderTone) return folderTone;
    throw new Error("transposed render: neither the set file name nor the folder carries a key");
  }
  const minor = /m$/.test(source);
  const expected = NOTE_LABEL[(((sourceRoot + semis) % 12) + 12) % 12] + (minor ? "m" : "");
  if (folderTone && noteRoot(folderTone) !== noteRoot(expected)) {
    throw new Error(`transposed render: set is in ${source} ${semis > 0 ? "+" : ""}${semis} → ${expected}, but the folder says ${folderTone}`);
  }
  return folderTone ?? expected;
}

export function planIngest({ manifest, folderName, post, existing = [], existingItems = {}, localSha1 = {} }) {
  // A transposed render of the SAME set is another render: it must not claim
  // (and drop) the untransposed one's items, so the hash carries the semitones.
  // Untransposed renders keep the bare set sha1 — every existing row matches.
  const setSha1 = renderHash(manifest);
  const folder = parseFolderName(folderName);
  const tone = transposedTone(manifest, folder.tone) ?? post.key ?? "";
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
