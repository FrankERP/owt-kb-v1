import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createClient } from "next-sanity";
import { parseMessages, detectSetlists, splitSections, parseSongLine, serviceDateFor } from "./lib/whatsapp-setlists.mjs";
import { buildCatalogIndex, matchSong } from "./lib/setlist-match.mjs";
import { normalizeForMatch } from "./lib/catalog-reconcile.mjs";

const WORKDIR = process.env.CATALOG_DIR || "/Users/frankrocha/Downloads/ContentUpdateProject";
const ZIP = "/Users/frankrocha/Downloads/Chat de WhatsApp con Colaboradores Alabanza.zip";
const TXT_NAME = "Chat de WhatsApp con Colaboradores Alabanza.txt";
const APPLY = process.argv.includes("--apply");
const FROM = "2022-01-01";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23", useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN || process.env.SANITY_API_READ_TOKEN,
});

function rng() { return Math.random().toString(36).slice(2, 9); }

function loadChat() {
  const dir = "/tmp/owt-chat";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  execSync(`unzip -o -j ${JSON.stringify(ZIP)} ${JSON.stringify(TXT_NAME)} -d ${JSON.stringify(dir)}`, { stdio: "ignore" });
  return readFileSync(`${dir}/${TXT_NAME}`, "utf-8");
}

function buildPlan(text, index) {
  const blocks = [];
  for (const m of detectSetlists(parseMessages(text))) {
    for (const sec of splitSections(m.body)) {
      // The day word ("para este domingo") is usually in the section PROSE, not a heading.
      // Feed heading (if present) else the section's non-song lines to serviceDateFor.
      const signal = sec.heading || sec.lines.filter(l => !/\(([A-G](#|b)?m?)\)/.test(l)).join(" ");
      const { serviceDate, type, confidence } = serviceDateFor(signal, m.messageDate);
      if (serviceDate < FROM) continue;                       // scope filter on SERVICE date
      const songs = [];
      for (const line of sec.lines) {
        const parsed = parseSongLine(line);
        if (!parsed) continue;
        const hit = matchSong(parsed.rawName, index);
        songs.push({ rawName: parsed.rawName, key: parsed.key,
          postId: hit && hit.postId ? hit.postId : null,
          candidates: hit && hit.candidates ? hit.candidates : undefined });
      }
      if (songs.length) blocks.push({ messageDate: m.messageDate, serviceDate, type, confidence, songs });
    }
  }
  return blocks;
}

async function phaseA() {
  const text = loadChat();
  const posts = await client.fetch(`*[_type=="post"]{_id, title}`);
  const index = buildCatalogIndex(posts);
  const plan = buildPlan(text, index);

  // existing weeks to skip
  const existing = await client.fetch(`*[_type in ["featuredSongs","saturdarSongs"]]{ _type, "week": string(week) }`);
  const existSet = new Set(existing.map(e => `${e._type}|${(e.week||"").slice(0,10)}`));

  // distinct unmatched (no candidate) and ambiguous (multiple candidates) — BOTH need decisions
  const unmatched = new Map();   // normKey -> rawName
  const ambiguous = new Map();   // normKey -> { raw, candidates }
  for (const b of plan) for (const s of b.songs) {
    if (s.postId) continue;
    const k = normalizeForMatch(s.rawName);
    if (s.candidates) ambiguous.set(k, { raw: s.rawName, candidates: s.candidates });
    else unmatched.set(k, s.rawName);
  }
  // collisions: group blocks by (type, serviceDate)
  const groups = new Map();
  for (const b of plan) { const key = `${b.type}|${b.serviceDate}`; (groups.get(key) || groups.set(key, []).get(key)).push(b); }
  const collisions = [...groups].filter(([, v]) => v.length > 1);

  const byYear = {}, byConf = {};
  for (const b of plan) { byYear[b.serviceDate.slice(0,4)] = (byYear[b.serviceDate.slice(0,4)]||0)+1; byConf[b.confidence]=(byConf[b.confidence]||0)+1; }
  const distinctWeeks = new Set(plan.map(b => `${b.type}|${b.serviceDate}`));
  const willWrite = [...distinctWeeks].filter(k => !existSet.has(k));

  console.log(`\n=== SETLISTS: ${plan.length} blocks, ${distinctWeeks.size} distinct (type,date) (by year ${JSON.stringify(byYear)}) ===`);
  console.log(`confidence: ${JSON.stringify(byConf)}  (inferred = headless, assumed Sunday, dated to nearest upcoming Sunday — best-guess)`);
  console.log(`will create: ${willWrite.length} | skip (already in Sanity): ${distinctWeeks.size - willWrite.length}`);
  console.log(`\n=== LOW-CONFIDENCE / CONFLICT rows (eyeball dates/types) ===`);
  for (const b of plan.filter(b => b.confidence !== "explicit")) console.log(`  ${b.serviceDate} ${b.type} [${b.confidence}] msg ${b.messageDate} — ${b.songs.length} songs`);
  console.log(`\n=== COLLISIONS (${collisions.length} (type,date) with >1 block — apply keeps most-complete and PRINTS each drop) ===`);
  for (const [k, v] of collisions) console.log(`  ${k}: ${v.map(b => `${b.songs.length}@${b.messageDate}`).join(", ")}`);
  console.log(`\n=== AMBIGUOUS SONGS (${ambiguous.size}) — set action:"pick" + postId in setlist-decisions.json ===`);
  for (const [, v] of ambiguous) console.log(`  ${v.raw} -> ${JSON.stringify(v.candidates)}`);
  console.log(`\n=== DISTINCT UNMATCHED SONGS (${unmatched.size}) — set action:"alias"+postId or "skip" ===`);
  [...unmatched.values()].sort().forEach(n => console.log("  " + n));

  writeFileSync(`${WORKDIR}/setlist-plan.json`, JSON.stringify(plan, null, 2));
  const decisions = {};
  for (const [k, raw] of unmatched) decisions[k] = { _rawName: raw, action: "skip", postId: null };
  for (const [k, v] of ambiguous) decisions[k] = { _rawName: v.raw, action: "pick", postId: null, _candidates: v.candidates };
  if (!existsSync(`${WORKDIR}/setlist-decisions.json`)) writeFileSync(`${WORKDIR}/setlist-decisions.json`, JSON.stringify(decisions, null, 2));
  console.log(`\nWrote setlist-plan.json (${plan.length}) and setlist-decisions.json (${unmatched.size} unmatched + ${ambiguous.size} ambiguous). Nothing written to Sanity.`);
}

if (!APPLY) phaseA().catch(e => { console.error(e); process.exit(1); });

async function phaseB() {
  const plan = JSON.parse(readFileSync(`${WORKDIR}/setlist-plan.json`, "utf-8"));
  const decisions = existsSync(`${WORKDIR}/setlist-decisions.json`) ? JSON.parse(readFileSync(`${WORKDIR}/setlist-decisions.json`, "utf-8")) : {};

  // resolve a song to a postId: direct match → alias decision → pick decision (ambiguous). Else null (skip/add/unresolved).
  const resolve = (s) => {
    if (s.postId) return s.postId;
    const d = decisions[normalizeForMatch(s.rawName)];
    if (d && (d.action === "alias" || d.action === "pick") && d.postId) {
      if (s.candidates && !s.candidates.includes(d.postId)) return null; // pick must be one of the candidates
      return d.postId;
    }
    return null;
  };
  // refuse to apply unless EVERY surfaced unmatched AND ambiguous song has a valid decision
  const unresolved = new Set();
  for (const b of plan) for (const s of b.songs) {
    if (s.postId) continue;
    const d = decisions[normalizeForMatch(s.rawName)];
    if (s.candidates) {
      if (!(d && d.action === "pick" && d.postId && s.candidates.includes(d.postId)))
        unresolved.add(`ambiguous (need action:"pick"+valid postId): ${s.rawName}`);
    } else if (!(d && (d.action === "skip" || (d.action === "alias" && d.postId)))) {
      unresolved.add(`unmatched (need action:"alias"+postId or "skip"): ${s.rawName}`);
    }
  }
  if (unresolved.size) { console.error("Refusing to apply — resolve these in setlist-decisions.json first:\n  " + [...unresolved].join("\n  ")); process.exit(1); }

  // dedup against existing
  const existing = await client.fetch(`*[_type in ["featuredSongs","saturdarSongs"]]{ _type, "week": string(week) }`);
  const existSet = new Set(existing.map(e => `${e._type}|${(e.week||"").slice(0,10)}`));
  // within-plan dedup: keep the most-complete block per (type, serviceDate) — and PRINT every drop (never silent)
  const best = new Map();
  for (const b of plan) {
    const k = `${b.type}|${b.serviceDate}`;
    const cnt = b.songs.filter(s => resolve(s)).length;
    const prev = best.get(k);
    if (!prev) { best.set(k, { ...b, _cnt: cnt }); continue; }
    const keep = cnt > prev._cnt ? { ...b, _cnt: cnt } : prev;
    const drop = cnt > prev._cnt ? prev : { ...b, _cnt: cnt };
    console.log(`COLLISION ${k}: kept ${keep._cnt}-song block (msg ${keep.messageDate}), DROPPED ${drop._cnt}-song block (msg ${drop.messageDate})`);
    best.set(k, keep);
  }

  let created = 0, skipped = 0;
  for (const [k, b] of best) {
    if (existSet.has(k)) { skipped++; continue; }
    const songs = b.songs.map(s => ({ id: resolve(s), key: s.key })).filter(s => s.id)
      .map(s => ({ _type: "setlist_song", _key: rng(), song: { _type: "reference", _ref: s.id }, play_key: s.key }));
    if (!songs.length) { skipped++; continue; }
    await client.create({ _type: b.type, week: b.serviceDate, songs });
    created++;
  }
  console.log(`Applied: ${created} history docs created, ${skipped} skipped (existing/empty).`);
}

if (APPLY) phaseB().catch(e => { console.error(e); process.exit(1); });
