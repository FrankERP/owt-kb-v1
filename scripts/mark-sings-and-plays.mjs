// One-off: mark the members who lead while they play as «Canta y toca a la vez»
// (`teamMembers.singsAndPlays: true`, ADR-0078), so Auto keeps seating them on
// their instrument once the seat-clash rule ships. Frank asked for exactly
// these two on 2026-10-30: himself (Lead + EG) and Mkz (Lead + Bass) — the only
// voz + instrumento pairs in every roster stored since 2026-07.
//
// Safety: dry-run by default; `--apply` needs Frank's explicit consent. Writes
// ONLY the two ids below, ONLY the one field, each patch pinned to the revision
// it read (`ifRevisionId`), each document backed up first. A member without
// both Tipos, or already marked, is reported and left alone.
//
//   node --env-file=.env.local scripts/mark-sings-and-plays.mjs
//   node --env-file=.env.local scripts/mark-sings-and-plays.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const TARGETS = [
  { id: "7e910c94-9134-4bbf-9227-d2f3a8e87ea7", alias: "Frank" },
  { id: "70a3ebfc-4996-414d-98df-73f32f8e7063", alias: "Mkz" },
];

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
for (const a of argv) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const apply = argv.includes("--apply");
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

const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: readToken });

console.log(`mark-sings-and-plays`);
console.log(`  project: ${projectId}\n  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const docs = await reader.fetch(
  `*[_type == "teamMembers" && _id in $ids]{ _id, _rev, alias, member_name, memberType, singsAndPlays }`,
  { ids: TARGETS.map((t) => t.id) },
);
const writes = [];
for (const t of TARGETS) {
  const doc = docs.find((d) => d._id === t.id);
  if (!doc) { console.log(`  ! ${t.alias} (${t.id}): no existe — no se escribe`); continue; }
  const types = doc.memberType ?? [];
  if (!types.includes("voz") || !types.includes("instrumento")) {
    console.log(`  ! ${doc.alias ?? doc.member_name}: Tipo [${types.join(", ")}] no tiene Voz e Instrumento — no se escribe`);
    continue;
  }
  if (doc.singsAndPlays === true) { console.log(`  = ${doc.alias ?? doc.member_name}: ya marcado — no se toca`); continue; }
  console.log(`  + ${doc.alias ?? doc.member_name} (${doc._id}, rev ${doc._rev}): singsAndPlays ${doc.singsAndPlays ?? "(ausente)"} → true`);
  writes.push(doc);
}

if (!writes.length) { console.log(`\nNothing to write.`); process.exit(0); }
if (!apply) {
  console.log(`\nDRY-RUN complete — no write was made. ${writes.length} member(s) would be patched.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}
if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-sings-and-plays.json`);
writeFileSync(backupPath, JSON.stringify(writes, null, 2));
console.log(`\n  backup:  ${writes.length} document(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
for (const doc of writes) {
  const res = await writer.patch(doc._id).ifRevisionId(doc._rev).set({ singsAndPlays: true }).commit();
  console.log(`  wrote:   ${doc.alias ?? doc.member_name} -> rev ${res._rev}`);
}
const after = await reader.fetch(`*[_type == "teamMembers" && _id in $ids]{ alias, singsAndPlays }`, { ids: TARGETS.map((t) => t.id) });
console.log(`\n  read-back: ${after.map((d) => `${d.alias}=${d.singsAndPlays}`).join(", ")}`);
