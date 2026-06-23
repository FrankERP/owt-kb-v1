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

function rng() { return Math.random().toString(36).slice(2, 9); }

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

async function resolveTagIds(names) {
  const out = [];
  for (const name of names) {
    let doc = await client.fetch(`*[_type=="tag" && name==$name][0]{_id}`, { name });
    if (!doc) doc = await client.create({ _type: "tag", name, slug: { _type: "slug", current: slugify(name) } });
    out.push(doc._id);
  }
  return out;
}

function refList(ids) { return ids.map((_ref) => ({ _type: "reference", _ref, _key: rng() })); }

async function phaseB() {
  const plan = JSON.parse(readFileSync(PLAN, "utf-8"));
  let created = 0, updated = 0, skipped = 0;
  for (const p of plan) {
    if (p.status === "ambiguous" && !p.matchId) { console.log(`SKIP ambiguous: ${p.rowTitle}`); skipped++; continue; }
    const { _tagNames, ...fields } = p.set;
    const tagIds = await resolveTagIds(_tagNames ?? []);
    if (p.status === "new") {
      const title = fields.title;
      await client.create({
        _type: "post", ...fields,
        slug: { _type: "slug", current: slugify(`${title}-${p.rowAuthor}`) },
        tags: refList(tagIds), publishDate: new Date().toISOString(),
      });
      created++;
    } else {
      await client.patch(p.matchId).set({ ...fields, tags: refList(tagIds) }).commit();
      updated++;
    }
  }
  console.log(`\nApplied: ${created} created, ${updated} updated, ${skipped} skipped.`);
}

if (APPLY) {
  phaseB().catch((e) => { console.error(e); process.exit(1); });
}
