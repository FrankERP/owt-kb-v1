// Ingest abletonnl rehearsal mixes into post.rehearsalMixes[] (spec
// 2026-09-20-rehearsal-mixes §7). Dry-run by default; --apply writes.
//
//   node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs <root>
//   node --env-file=.env.local scripts/ingest-rehearsal-mixes.mjs <root> --apply
//
// <root> holds one folder per song, each with abletonnl's manifest.json and
// the MP3s it names. Optional <root>/matches.json = { "<folder>": "<post _id>" }
// overrides matching. Unmatched folders go to <root>/unmatched.json; nothing
// is written for them. Re-running is safe: keys are deterministic, an asset
// whose sha1 already matches is not re-uploaded, and items from other
// renders of the same song are kept.
//
// Uses the existing SANITY_WRITE_TOKEN / SANITY_API_READ_TOKEN — no new secret.
import { createClient } from "next-sanity";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCatalogIndex } from "./lib/setlist-match.mjs";
import { matchFolder, planIngest } from "./lib/rehearsal-ingest.mjs";

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
const root = argv.find((a) => !a.startsWith("--"));
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
if (!root || !existsSync(root)) {
  console.error("Usage: ingest-rehearsal-mixes.mjs <root> [--apply]");
  process.exit(1);
}
const apply = argv.includes("--apply");
if (apply && !process.env.SANITY_WRITE_TOKEN) {
  console.error("SANITY_WRITE_TOKEN is not set — cannot --apply.");
  process.exit(1);
}

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}
const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: process.env.SANITY_API_READ_TOKEN });
const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: process.env.SANITY_WRITE_TOKEN });

console.log(`ingest-rehearsal-mixes\n  project: ${projectId}\n  dataset: ${dataset}\n  root:    ${root}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const overridesPath = path.join(root, "matches.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const posts = await reader.fetch(`*[_type == "post"]{ _id, title, key }`);
const index = buildCatalogIndex(posts);
const postById = new Map(posts.map((p) => [p._id, p]));

const sha1Of = (file) => createHash("sha1").update(readFileSync(file)).digest("hex");

const folders = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, "manifest.json")))
  .map((d) => d.name)
  .sort();
console.log(`  Carpetas con manifest.json: ${folders.length}`);

const unmatched = {};
const failures = [];
let totalUploads = 0, totalBytes = 0, totalSkipped = 0, totalReplaced = 0, written = 0;

for (const folderName of folders) {
  const dir = path.join(root, folderName);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (!manifest?.set?.sha1 || !Array.isArray(manifest.files)) {
    console.log(`  ! ${folderName}: manifest sin set.sha1 o files — se omite`);
    continue;
  }
  const m = matchFolder({ folderName, manifest, index, overrides });
  if (!m.postId) {
    unmatched[folderName] = m.unmatched;
    console.log(`  ? ${folderName}: ${m.unmatched.reason}${m.unmatched.candidates.length ? " → " + m.unmatched.candidates.join(", ") : ""}`);
    continue;
  }
  const post = postById.get(m.postId);
  if (!post) {
    console.log(`  ! ${folderName}: matches.json apunta a ${m.postId}, que no existe`);
    unmatched[folderName] = { reason: "override-not-found", candidates: [] };
    continue;
  }
  // Resolve file paths relative to the folder when the manifest's absolute path moved with the SSD.
  for (const f of manifest.files) {
    if (!existsSync(f.path)) f.path = path.join(dir, path.basename(f.path));
  }
  const missing = manifest.files.filter((f) => !existsSync(f.path));
  if (missing.length) {
    console.log(`  ! ${folderName}: faltan ${missing.length} archivo(s) — se omite: ${missing.map((f) => path.basename(f.path)).join(", ")}`);
    continue;
  }
  const uploadedThisFolder = [];
  try {
    const existingRaw = await reader.fetch(
      `*[_type == "post" && _id == $id][0].rehearsalMixes[]{ ..., "assetId": audioFile.asset._ref, "sha1": audioFile.asset->sha1hash }`,
      { id: post._id },
    ) ?? [];
    const existing = existingRaw.map(({ _key, sourceHash, assetId, sha1 }) => ({ _key, sourceHash, assetId, sha1 }));
    const existingItems = Object.fromEntries(
      existingRaw.map(({ assetId, sha1, ...item }) => [item._key, item]),
    );
    const localSha1 = Object.fromEntries(manifest.files.map((f) => [f.path, sha1Of(f.path)]));

    const plan = planIngest({ manifest, folderName, post, existing, existingItems, localSha1 });
    const bytes = plan.uploads.reduce((n, u) => n + readFileSync(u.path).length, 0);
    totalUploads += plan.uploads.length; totalBytes += bytes; totalSkipped += plan.skipped.length; totalReplaced += plan.replaced.length;
    console.log(`  ${apply ? "+" : "="} ${folderName} → ${post.title} (${post._id}): ${plan.items.length} items, sube ${plan.uploads.length} (${(bytes / 1e6).toFixed(1)} MB), reusa ${plan.skipped.length}, conserva ${plan.kept.length}, reemplaza ${plan.replaced.length}`);

    if (!apply) continue;
    const assetIds = [];
    for (const u of plan.uploads) {
      const contentType = path.extname(u.filename).toLowerCase() === ".mp3" ? "audio/mpeg" : "application/octet-stream";
      const asset = await writer.assets.upload("file", readFileSync(u.path), { filename: u.filename, contentType });
      assetIds[u.uploadIndex] = asset._id;
      uploadedThisFolder.push(asset._id);
    }
    const items = plan.items.map((i) =>
      i.audioFile?.asset?.uploadIndex !== undefined
        ? { ...i, audioFile: { _type: "file", asset: { _type: "reference", _ref: assetIds[i.audioFile.asset.uploadIndex] } } }
        : i,
    );
    await writer.patch(post._id).set({ rehearsalMixes: items }).commit();
    written += 1;
    for (const id of plan.replaced) {
      try { await writer.delete(id); } catch (e) { console.log(`    (no se pudo borrar ${id}: ${e.message})`); }
    }
  } catch (e) {
    console.log(`  ! ${folderName}: falló — ${e.message}`);
    failures.push(folderName);
    for (const id of uploadedThisFolder) {
      try { await writer.delete(id); } catch (delErr) { console.log(`    (no se pudo borrar el asset huérfano ${id}: ${delErr.message})`); }
    }
    continue;
  }
}

if (Object.keys(unmatched).length) {
  writeFileSync(path.join(root, "unmatched.json"), JSON.stringify(unmatched, null, 2));
  console.log(`\n  Sin casar: ${Object.keys(unmatched).length} → ${path.join(root, "unmatched.json")} (añade matches.json para resolverlos)`);
}
if (failures.length) {
  console.log(`\n  Fallaron: ${failures.length} → ${failures.join(", ")} (revisa el error arriba y vuelve a correr; es seguro)`);
}
console.log(`\n  Total: sube ${totalUploads} archivos (${(totalBytes / 1e6).toFixed(1)} MB), reusa ${totalSkipped}, reemplaza ${totalReplaced}${apply ? `, escribió ${written} canciones` : ""}`);
console.log(apply
  ? "\nDONE. La ficha (/api/song) muestra los mixes de inmediato; /posts/[slug] dentro de 1 h (revalidate = 3600)."
  : "\nDRY-RUN. Vuelve a correr con --apply para escribir.");
