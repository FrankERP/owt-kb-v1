// One-off, re-runnable: give songs their ALBUM cover (`post.albumArt`, ADR-0087) from a
// list of `{ id, asset }` pairs. Frank asked for album covers instead of YouTube stills on
// 2026-11-12 and said «Guarda las 138» for the first list, `data/album-art-2026-11-12.json`
// (matched against Deezer's public search; the 102 images were already uploaded as Sanity
// image assets, and each stored asset was compared pixel by pixel with its source).
//
// Why a script and not the Sanity connector: the connector validates a patch against the
// DEPLOYED schema, which does not know `albumArt` until this branch's schema is deployed;
// the Content Lake itself is schemaless, and this is the same raw patch every other
// one-off here makes.
//
// Safety: dry-run by default; `--apply` needs Frank's explicit consent. Writes ONLY
// `albumArt`, ONLY on the listed songs, each patch pinned to the revision it read
// (`ifRevisionId`). It NEVER replaces a cover: a song that already has one is reported
// and left alone, so a cover set by hand in the Studio survives a re-run. A song with an
// open draft is skipped too (publishing that draft later would drop the field — publish
// or discard the draft, then re-run). A listed asset that does not exist is skipped.
// Undo: `unset(["albumArt"])` on the ids in the backup file.
//
//   node --env-file=.env.local scripts/set-album-art.mjs
//   node --env-file=.env.local scripts/set-album-art.mjs --apply
//   node --env-file=.env.local scripts/set-album-art.mjs --file=scripts/data/<other>.json [--apply]
import { createClient } from "next-sanity";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "album-art-2026-11-12.json");

const argv = process.argv.slice(2);
let apply = false;
let file = DEFAULT_FILE;
for (const a of argv) {
  if (a === "--apply") apply = true;
  else if (a.startsWith("--file=") && a.length > "--file=".length) file = a.slice("--file=".length);
  else {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const BACKUP_DIR = process.env.SR_BACKFILL_BACKUP_DIR || ".backfill-backups";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
const readToken = process.env.SANITY_API_READ_TOKEN;
const writeToken = process.env.SANITY_WRITE_TOKEN;
if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}

// The list is data, so it is checked before anything is read: a malformed row must stop
// the run, never be skipped into a partial load nobody notices.
const ASSET_ID = /^image-[0-9a-f]{40}-\d+x\d+-(jpg|png)$/;
const targets = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(targets) || targets.length === 0) {
  console.error(`${file}: expected a non-empty array of { id, asset }.`);
  process.exit(1);
}
const seen = new Set();
for (const t of targets) {
  if (typeof t?.id !== "string" || !t.id || t.id.startsWith("drafts.") || typeof t?.asset !== "string" || !ASSET_ID.test(t.asset)) {
    console.error(`${file}: bad row ${JSON.stringify(t)} — need a published song id and a JPEG/PNG image asset id.`);
    process.exit(1);
  }
  if (seen.has(t.id)) {
    console.error(`${file}: song ${t.id} is listed twice.`);
    process.exit(1);
  }
  seen.add(t.id);
}

// `raw`, with a token: the draft check below needs to SEE drafts, and an untokened read
// would answer «no drafts» with no error.
const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "raw", token: readToken || writeToken });

console.log(`set-album-art`);
console.log(`  project: ${projectId}\n  dataset: ${dataset}\n  list:    ${file} (${targets.length} songs)`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}`);
if (!readToken && !writeToken) console.log(`  ! no token: open drafts are INVISIBLE to this run — the draft check proves nothing`);
console.log("");

const ids = targets.map((t) => t.id);
const [docs, draftIds, assetIds] = await Promise.all([
  reader.fetch(`*[_type == "post" && _id in $ids]{ _id, _rev, title, "has": defined(albumArt) }`, { ids }),
  reader.fetch(`*[_id in $ids]._id`, { ids: ids.map((id) => `drafts.${id}`) }),
  reader.fetch(`*[_type == "sanity.imageAsset" && _id in $ids]._id`, { ids: [...new Set(targets.map((t) => t.asset))] }),
]);
const byId = new Map(docs.map((d) => [d._id, d]));
const drafts = new Set(draftIds);
const assets = new Set(assetIds);

const writes = [];
const count = { missing: 0, draft: 0, asset: 0, has: 0 };
for (const t of targets) {
  const doc = byId.get(t.id);
  const name = doc?.title ?? t.title ?? t.id;
  if (!doc) { count.missing++; console.log(`  ! ${name} (${t.id}): no existe como canción publicada — no se escribe`); continue; }
  if (drafts.has(`drafts.${t.id}`)) { count.draft++; console.log(`  ! ${name}: tiene un borrador abierto — no se escribe`); continue; }
  if (!assets.has(t.asset)) { count.asset++; console.log(`  ! ${name}: la imagen ${t.asset} no existe — no se escribe`); continue; }
  if (doc.has) { count.has++; continue; }
  writes.push({ ...t, _rev: doc._rev, title: doc.title });
}

console.log(`  ${writes.length} por escribir · ${count.has} ya tienen portada · ${count.draft} con borrador · ${count.asset} sin imagen · ${count.missing} no existen`);
if (!writes.length) { console.log(`\nNothing to write.`); process.exit(0); }
if (!apply) {
  for (const w of writes) console.log(`  + ${w.title}${w.album ? `  ←  ${w.album}${w.artist ? ` (${w.artist})` : ""}` : ""}`);
  console.log(`\nDRY-RUN complete — no write was made. ${writes.length} song(s) would get a cover.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}
if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-album-art.json`);
// The field was absent on every one of these, so the ids and revisions ARE the backup.
writeFileSync(backupPath, JSON.stringify(writes.map(({ id, _rev, asset }) => ({ id, _rev, asset })), null, 2));
console.log(`\n  backup:  ${writes.length} id(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
// One transaction per 50 songs: a chunk lands whole or not at all, and a song edited since
// the read fails its chunk loudly (`ifRevisionId`) instead of being overwritten. A re-run
// picks up exactly what is left, because a song with a cover is skipped.
const CHUNK = 50;
let written = 0;
for (let i = 0; i < writes.length; i += CHUNK) {
  const chunk = writes.slice(i, i + CHUNK);
  const tx = writer.transaction();
  for (const w of chunk) {
    tx.patch(w.id, { ifRevisionID: w._rev, set: { albumArt: { _type: "image", asset: { _type: "reference", _ref: w.asset } } } });
  }
  await tx.commit();
  written += chunk.length;
  console.log(`  wrote:   ${written}/${writes.length}`);
}
const after = await reader.fetch(`{
  "listed": count(*[_type == "post" && _id in $ids && defined(albumArt)]),
  "all": count(*[_type == "post" && !(_id in path("drafts.**")) && defined(albumArt)]),
  "songs": count(*[_type == "post" && !(_id in path("drafts.**"))])
}`, { ids });
console.log(`\n  read-back: ${after.listed}/${targets.length} of this list have a cover · ${after.all}/${after.songs} songs in the library`);
