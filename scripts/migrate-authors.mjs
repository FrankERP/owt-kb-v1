import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { createClient } from "next-sanity";
import { parseAuthors, dedupeKey, buildFreq, canonicalName } from "./lib/author-canon.mjs";
import { matchRow, normalizeForMatch } from "./lib/catalog-reconcile.mjs";
import { slugifyAuthor } from "../app/utils/slugifyAuthor.mjs";

const CATALOG_DIR = process.env.CATALOG_DIR || "/Users/frankrocha/Downloads/ContentUpdateProject";
const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});

function rng() { return Math.random().toString(36).slice(2, 9); }

// Operator-approved xlsx co-author ADDITIONS (superset cases surfaced by the dry-run).
// Empty until the operator approves the dry-run; then fill with the exact post titles.
const APPROVED_ADDITIONS = {
  // "Somos Libres": ["Matt Redman", "En Espíritu y En Verdad"],
  // "Vamos A Cantar (Sing Sing Sing)": ["En Espíritu y En Verdad", "Chris Tomlin"],
};

async function loadPosts() {
  return client.fetch(`*[_type=="post"]{_id, title, author}`);
}

function canonicalAuthorsFor(post, freq) {
  // base = stored string, canonicalized + de-duped (order preserved)
  const base = [];
  const seen = new Set();
  for (const raw of parseAuthors(post.author)) {
    const cn = canonicalName(raw, freq);
    const k = dedupeKey(cn);
    if (!seen.has(k)) { seen.add(k); base.push(cn); }
  }
  // approved xlsx additions override base entirely (already canonical, ordered)
  const override = APPROVED_ADDITIONS[(post.title || "").trim()];
  if (override) {
    const out = []; const s = new Set();
    for (const cn of override) { const k = dedupeKey(cn); if (!s.has(k)) { s.add(k); out.push(cn); } }
    return out;
  }
  return base;
}

async function phaseA() {
  const posts = await loadPosts();
  const allRaws = posts.flatMap((p) => parseAuthors(p.author));
  const freq = buildFreq(allRaws);

  // distinct canonical authors
  const docs = new Map(); // dedupeKey -> canonical name
  for (const raw of allRaws) docs.set(dedupeKey(raw), canonicalName(raw, freq));

  console.log(`\n=== AUTHOR DOCS to create/lookup: ${docs.size} (expected 35) ===`);
  for (const [k, name] of [...docs].sort((a, b) => a[1].localeCompare(b[1]))) {
    console.log(`  "${name}"   (key ${k}, slug ${slugifyAuthor(name)})`);
  }

  console.log(`\n=== DISPLAY STRINGS that change ===`);
  let changed = 0;
  for (const p of posts) {
    const recomputed = canonicalAuthorsFor(p, freq).join(", ");
    if (recomputed !== (p.author || "").trim()) { changed++; console.log(`  "${p.author}"  ->  "${recomputed}"  (${p.title})`); }
  }
  console.log(`  total changed: ${changed} (expected 18 before any approved additions)`);

  // xlsx divergence surfacing (read-only)
  const rows = JSON.parse(readFileSync(`${CATALOG_DIR}/oasis-songs.json`, "utf-8"));
  console.log(`\n=== xlsx vs stored author divergences (review before approving additions) ===`);
  for (const r of rows) {
    const m = matchRow({ title: r.title, author: r.author }, posts);
    if (m.status !== "matched") continue;
    const post = posts.find((p) => p._id === m.matchId);
    const xset = new Set(parseAuthors(r.author).map(dedupeKey));
    const sset = new Set(parseAuthors(post.author).map(dedupeKey));
    const extra = [...xset].filter((x) => !sset.has(x));
    const dropped = [...sset].filter((x) => !xset.has(x));
    if (!extra.length && !dropped.length) continue;
    const kind = dropped.length ? "CONFLICT" : "ADD";
    console.log(`  [${kind}] "${post.title}"  stored "${post.author}"  vs xlsx "${r.author}"`);
  }
  console.log(`\n(Phase A only — nothing written. Re-run with --apply after approval.)`);
}

async function resolveAuthorId(name) {
  const slug = slugifyAuthor(name);
  let doc = await client.fetch(`*[_type=="author" && slug.current==$slug][0]{_id}`, { slug });
  if (!doc) doc = await client.create({ _type: "author", name, slug: { _type: "slug", current: slug } });
  return doc._id;
}

async function phaseB() {
  const posts = await loadPosts();
  const allRaws = posts.flatMap((p) => parseAuthors(p.author));
  const freq = buildFreq(allRaws);

  // pre-create all distinct author docs (idempotent: lookup by slug first)
  const idByName = new Map();
  for (const raw of allRaws) {
    const name = canonicalName(raw, freq);
    if (!idByName.has(name)) idByName.set(name, await resolveAuthorId(name));
  }
  // also ensure any approved-addition names exist
  for (const names of Object.values(APPROVED_ADDITIONS))
    for (const name of names) if (!idByName.has(name)) idByName.set(name, await resolveAuthorId(name));

  let patched = 0;
  for (const p of posts) {
    const names = canonicalAuthorsFor(p, freq);
    const authors = names.map((name) => ({ _type: "reference", _ref: idByName.get(name), _key: rng() }));
    await client.patch(p._id).set({ authors, author: names.join(", ") }).commit();
    patched++;
  }
  console.log(`Applied: ${idByName.size} author docs, ${patched} posts patched.`);
}

(APPLY ? phaseB() : phaseA()).catch((e) => { console.error(e); process.exit(1); });
