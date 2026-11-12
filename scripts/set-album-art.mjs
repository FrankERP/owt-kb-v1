// One-off, re-runnable: give songs their ALBUM cover (`post.albumArt`, ADR-0087) from a
// list of `{ id, asset, replaces? }` rows, `data/album-art-2026-11-12.json` by default.
//
// History of that list (Frank, 2026-11-12). He asked for album covers instead of YouTube
// stills; the first list matched 138 of 148 songs against Deezer's public search, he said
// «Guarda las 138», and it was applied at 03:29Z. Then: «si puedes hacer que la fuente
// principal de las imágenes sea multitracks.com, estaría mejor». The list is now all 148
// songs: 127 take the cover MultiTracks shows for their album (82 images), and the 21 that
// MultiTracks does not carry keep the Deezer cover they already have. Every image is a
// Sanity image asset already, checked against its source before the list was written.
//
// Why a script and not the Sanity connector: the connector validates a patch against the
// DEPLOYED schema, which does not know `albumArt` until this branch's schema is deployed;
// the Content Lake itself is schemaless, and this is the same raw patch every other
// one-off here makes.
//
// Safety: dry-run by default; `--apply` needs Frank's explicit consent. Writes ONLY
// `albumArt`, ONLY on the listed songs, each patch pinned to the revision it read
// (`ifRevisionId`). A song with no cover gets one. A song that HAS a cover keeps it unless
// its row names that exact asset in `replaces` — the cover the first load wrote — so a
// swap only ever undoes this loader's own earlier write, and a cover an editor chose in the
// Studio is reported and left alone (`scripts/lib/album-art-plan.mjs`). A song with an open
// draft is skipped too (publishing that draft later would drop the field — publish or
// discard the draft, then re-run). A listed asset that does not exist is skipped.
// Undo: the backup file holds each song's previous cover (`previous`, null = it had none).
//
//   node --env-file=.env.local scripts/set-album-art.mjs
//   node --env-file=.env.local scripts/set-album-art.mjs --apply
//   node --env-file=.env.local scripts/set-album-art.mjs --file=scripts/data/<other>.json [--apply]
import { createClient } from "next-sanity";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { albumArtListProblem, planAlbumArt } from "./lib/album-art-plan.mjs";

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

const targets = JSON.parse(readFileSync(file, "utf8"));
const problem = albumArtListProblem(targets);
if (problem) {
  console.error(`${file}: ${problem}`);
  process.exit(1);
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
  reader.fetch(`*[_type == "post" && _id in $ids]{ _id, _rev, title, "current": albumArt.asset._ref }`, { ids }),
  reader.fetch(`*[_id in $ids]._id`, { ids: ids.map((id) => `drafts.${id}`) }),
  reader.fetch(`*[_type == "sanity.imageAsset" && _id in $ids]._id`, { ids: [...new Set(targets.map((t) => t.asset))] }),
]);
const { writes, skipped, count } = planAlbumArt({ targets, docs, draftIds, assetIds });

const WHY = {
  missing: () => "no existe como canción publicada — no se escribe",
  kept: (s) => `tiene otra portada (${s.current}) que esta carga no puso — no se toca`,
  draft: () => "tiene un borrador abierto — no se escribe",
  asset: () => "la imagen de la lista no existe — no se escribe",
};
for (const s of skipped) console.log(`  ! ${s.name}: ${WHY[s.why](s)}`);
console.log(`  ${count.add} portadas nuevas · ${count.swap} por cambiar · ${count.same} ya tienen esta portada · ${count.kept} con otra portada · ${count.draft} con borrador · ${count.asset} sin imagen · ${count.missing} no existen`);
if (!writes.length) { console.log(`\nNothing to write.`); process.exit(0); }
if (!apply) {
  for (const w of writes) console.log(`  ${w.previous ? "~" : "+"} ${w.title}${w.album ? `  ←  ${w.album}${w.artist ? ` (${w.artist})` : ""}` : ""}`);
  console.log(`\nDRY-RUN complete — no write was made. ${count.add} song(s) would get a cover (+), ${count.swap} would have theirs changed (~).`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}
if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-album-art.json`);
// `previous` is the whole undo: the asset the song pointed at before, or null for none.
writeFileSync(backupPath, JSON.stringify(writes.map(({ id, _rev, asset, previous }) => ({ id, _rev, asset, previous })), null, 2));
console.log(`\n  backup:  ${writes.length} id(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
// One transaction per 50 songs: a chunk lands whole or not at all, and a song edited since
// the read fails its chunk loudly (`ifRevisionId`) instead of being overwritten. A re-run
// picks up exactly what is left, because a song already on its listed cover is skipped.
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
// Read back what the list is FOR: each listed song on its listed cover, not merely «has one».
const [back, library] = await Promise.all([
  reader.fetch(`*[_type == "post" && _id in $ids]{ _id, "current": albumArt.asset._ref }`, { ids }),
  reader.fetch(`{
    "covered": count(*[_type == "post" && !(_id in path("drafts.**")) && defined(albumArt)]),
    "songs": count(*[_type == "post" && !(_id in path("drafts.**"))])
  }`),
]);
const want = new Map(targets.map((t) => [t.id, t.asset]));
const onList = back.filter((d) => d.current === want.get(d._id)).length;
console.log(`\n  read-back: ${onList}/${targets.length} of this list are on their listed cover · ${library.covered}/${library.songs} songs in the library have one`);
