import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "next-sanity";
import { matchRow, computeFieldUpdates, resolveMatchCollisions } from "./lib/catalog-reconcile.mjs";

const CATALOG_DIR = process.env.CATALOG_DIR
  || "/Users/frankrocha/Downloads/ContentUpdateProject";
const INPUT = `${CATALOG_DIR}/oasis-songs.json`;
const PLAN  = `${CATALOG_DIR}/import-plan.json`;
const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});

function isSafeHttpUrl(v) {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

async function loadExisting() {
  const posts = await client.fetch(
    `*[_type=="post"]{ _id, title, author, key, bpm, timeSig, "tagNames": tags[]->name }`
  );
  return posts.map((p) => ({ ...p, tagNames: (p.tagNames ?? []).filter(Boolean) }));
}

function buildPlan(rows, existing) {
  const byId = new Map(existing.map((p) => [p._id, p]));

  // Pass 1: URL validation + match each row
  const matchResults = rows.map((row) => {
    for (const u of [row.musicalUrl, row.lyricsUrl]) {
      if (u && !isSafeHttpUrl(u)) throw new Error(`Unsafe URL in "${row.title}": ${u}`);
    }
    const m = matchRow(row, existing);
    return { row, rowAuthor: row.author, status: m.status, matchId: m.matchId, candidateIds: m.candidateIds };
  });

  // Pass 2: resolve collisions (multiple rows matched to same existing doc)
  resolveMatchCollisions(matchResults, byId);

  // Pass 3: compute field updates now that statuses are final
  return matchResults.map(({ row, status, matchId, candidateIds }) => {
    const target = matchId ? byId.get(matchId)
      : { title: "", author: "", key: "", bpm: null, timeSig: "", tagNames: [] };
    const { set, conflicts, flags } = computeFieldUpdates(target, row);
    if (status === "new") { set.title = row.title; set.author = row.author; }
    return { rowTitle: row.title, rowAuthor: row.author, status, matchId, candidateIds, set, conflicts, flags };
  });
}

async function phaseA() {
  const rows = JSON.parse(readFileSync(INPUT, "utf-8"));
  const existing = await loadExisting();
  const plan = buildPlan(rows, existing);
  const byStatus = (s) => plan.filter((p) => p.status === s);
  const byId = new Map(existing.map((p) => [p._id, p]));

  console.log(`\n=== MATCHED (update): ${byStatus("matched").length} ===`);
  for (const p of byStatus("matched")) {
    const ex = byId.get(p.matchId);
    const changes = Object.keys(p.set).filter((k) => k !== "_tagNames");
    console.log(`  ${p.rowTitle}  ->  ${ex.title} (${ex.author})`);
    if (changes.length) console.log(`      set: ${changes.map((k) => `${k}=${JSON.stringify(p.set[k])}`).join(", ")}`);
    for (const c of p.conflicts) console.log(`      CONFLICT ${c.field}: keep "${c.existing}"  (sheet "${c.sheet}")`);
    for (const f of p.flags) console.log(`      FLAG: ${f}`);
  }
  console.log(`\n=== AMBIGUOUS (resolve by editing import-plan.json matchId): ${byStatus("ambiguous").length} ===`);
  for (const p of byStatus("ambiguous"))
    console.log(`  ${p.rowTitle} (${p.rowAuthor})  ->  candidates: ${p.candidateIds.map((id) => `${id} [${byId.get(id).author}]`).join(" | ")}`);
  console.log(`\n=== NEW (create): ${byStatus("new").length} ===`);
  for (const p of byStatus("new")) console.log(`  ${p.rowTitle} (${p.rowAuthor})`);

  writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  console.log(`\nPlan written to ${PLAN}`);
}

if (!APPLY) {
  phaseA().catch((e) => { console.error(e); process.exit(1); });
}
