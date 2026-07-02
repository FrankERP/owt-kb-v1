// scripts/backfill-song-fields.mjs
// Backfill missing key / bpm / timeSig on song docs from the source catalog.
// The original import plan predated the bpm/timeSig columns, so those two
// fields never reached Sanity for some songs (key did). This fills ONLY empty
// fields — it never overwrites a value already present — matched to source rows
// by the same normalized title+author logic the importer uses.
// Dry-run by default; pass --apply to write.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { createClient } from "next-sanity";
import { matchRow } from "./lib/catalog-reconcile.mjs";

const CATALOG_DIR = process.env.CATALOG_DIR || "/Users/frankrocha/Downloads/ContentUpdateProject";
const INPUT = `${CATALOG_DIR}/oasis-songs.json`;
const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});

const rows = JSON.parse(readFileSync(INPUT, "utf-8"));
const existing = await client.fetch(`*[_type=="post"]{ _id, title, author, key, bpm, timeSig }`);
const byId = new Map(existing.map((p) => [p._id, p]));

// Build the fill plan: for each source row, find its matched doc and fill only
// the fields that are currently empty on that doc.
const plan = [];
for (const row of rows) {
  const m = matchRow(row, existing);
  if (m.status !== "matched" || !m.matchId) continue;
  const doc = byId.get(m.matchId);
  if (!doc) continue;
  const set = {};
  if (!doc.key && row.key) set.key = row.key;
  if (doc.bpm == null && row.bpm != null && !Number.isNaN(Number(row.bpm))) set.bpm = Number(row.bpm);
  if (!doc.timeSig && row.timeSig) set.timeSig = row.timeSig;
  if (Object.keys(set).length > 0) plan.push({ id: doc._id, title: doc.title, set });
}

console.log(`Source rows: ${rows.length} | posts: ${existing.length}`);
console.log(`Docs needing a backfill: ${plan.length}\n`);
for (const p of plan) {
  console.log(`  ${p.title}  ->  ${Object.entries(p.set).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
}

if (!plan.length) { console.log("\nNothing to backfill."); process.exit(0); }
if (!APPLY) { console.log("\nDry-run. Re-run with --apply to write these fills."); process.exit(0); }

let tx = client.transaction();
for (const p of plan) tx = tx.patch(p.id, (patch) => patch.set(p.set));
await tx.commit();
console.log(`\nBackfilled ${plan.length} song(s).`);
