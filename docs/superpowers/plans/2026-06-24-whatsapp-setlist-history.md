# WhatsApp setlist history backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract past worship setlists (service date 2022→today) from a WhatsApp chat export, match each song to the Sanity catalog, and (after a gated dry-run review) write them as `featuredSongs`/`saturdarSongs` history docs so the song page's "last played, in what key" feature has data.

**Architecture:** A pure, unit-tested chat-parser lib + a pure, unit-tested catalog-matcher lib, driven by a two-phase runner (read-only dry-run report → `--apply` gated write). Mirrors the catalog-import / author-migration shape already in `scripts/`.

**Tech Stack:** Node 22, plain ESM `.mjs`, Vitest, `next-sanity` client, `unzip` (CLI) for the input.

## Global Constraints

- Node 22; plain ESM `.mjs`; Vitest (`npm run test`); commit messages contain **NO** Co-Authored-By / AI-attribution trailer.
- Sanity env in `.env.local`: `NEXT_PUBLIC_SANITY_*`, `SANITY_WRITE_TOKEN` (writes), `SANITY_API_READ_TOKEN` (reads). Scripts load it with `dotenv.config({ path: ".env.local" })`.
- History types: **`featuredSongs`** = Sunday, **`saturdarSongs`** = Saturday (the typo'd name is intentional — it's what `getSongHistory` reads). `songs[]` items are `{ _type:"setlist_song", _key, song:{_type:"reference",_ref:postId}, play_key }`. `week` = `YYYY-MM-DD` date string.
- **Input:** the chat `.txt` lives INSIDE `~/Downloads/Chat de WhatsApp con Colaboradores Alabanza.zip`. The runner extracts it to `/tmp/owt-chat/` at start. **Timestamps use U+202F** (narrow no-break space) between time and `a./p.`/`m.` — the timestamp regex must be whitespace-tolerant.
- Scope filter is on the **computed serviceDate** (≥ `2022-01-01`), not the message date. Scan all messages.
- **Never overwrite**: writes are `client.create` only; skip any `(type, week)` already in Sanity (12 reader-relevant docs: 9 featuredSongs + 3 saturdarSongs; the dedup uses the live fetch). Dry-run is the human-correction gate; the user resolves every surfaced unmatched song before apply.
- Vitest `include` already covers `scripts/**/*.test.mjs` (and `app/**/*.test.{ts,mjs}`).

---

### Task 1: Chat parser lib — `scripts/lib/whatsapp-setlists.mjs`

**Files:**
- Create: `scripts/lib/whatsapp-setlists.mjs`
- Test: `scripts/lib/__tests__/whatsapp-setlists.test.mjs`

**Interfaces — Produces:**
- `parseMessages(text): Array<{ date:"YYYY-MM-DD", sender, body }>`
- `detectSetlists(messages): Array<{ messageDate, body }>` (body has ≥3 key lines)
- `splitSections(body): Array<{ heading:string|null, lines:string[] }>`
- `parseSongLine(line): { rawName, key } | null`
- `serviceDateFor(heading:string|null, messageDate): { serviceDate, type, confidence }` where `type ∈ {"featuredSongs","saturdarSongs"}`, `confidence ∈ {"explicit","day-word","inferred","conflict"}`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/whatsapp-setlists.test.mjs`. NOTE the U+202F bytes in the first fixture are written with ` ` so the test exercises the real separator:

```js
import { describe, it, expect } from "vitest";
import { parseMessages, detectSetlists, splitSections, parseSongLine, serviceDateFor } from "../whatsapp-setlists.mjs";

const NNBSP = " ";
const sample =
  `5/1/2022, 3:06${NNBSP}p.${NNBSP}m. - Marki: amigos! canciones para este domingo!\n` +
  `Domingo 16 enero\n` +
  `Wake (D) - Hillsong Y&F\n` +
  `-No puedo callar (C)\n` +
  `Salmo 23 (C) Dirige Gaby\n` +
  `6/1/2022, 9:00${NNBSP}a.${NNBSP}m. - Ana: gracias!`;

describe("parseMessages", () => {
  it("parses U+202F timestamps, sender, multi-line body, continuation lines", () => {
    const m = parseMessages(sample);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ date: "2022-01-05", sender: "Marki" });
    expect(m[0].body.split("\n")).toHaveLength(5);
    expect(m[1]).toMatchObject({ date: "2022-01-06", sender: "Ana", body: "gracias!" });
  });
  it("does not parse ASCII-space lines as new messages (continuation safety)", () => {
    const m = parseMessages(`5/1/2022, 3:06${NNBSP}p.${NNBSP}m. - A: x\nplain continuation`);
    expect(m).toHaveLength(1);
    expect(m[0].body).toBe("x\nplain continuation");
  });
});

describe("detectSetlists", () => {
  it("keeps messages with >=3 key lines, drops the rest", () => {
    const got = detectSetlists(parseMessages(sample));
    expect(got).toHaveLength(1);
    expect(got[0].messageDate).toBe("2022-01-05");
  });
});

describe("splitSections", () => {
  it("splits a body with both Sábado and Domingo headings", () => {
    const body = `Sábado 13\nWake (D)\nNo puedo callar (C)\nDomingo 14\nSalmo 23 (C)\nDigno (A)`;
    const s = splitSections(body);
    expect(s.map(x => x.heading)).toEqual(["Sábado 13", "Domingo 14"]);
    expect(s[0].lines).toContain("Wake (D)");
    expect(s[1].lines).toContain("Salmo 23 (C)");
  });
  it("returns one headingless section when there is no day heading", () => {
    const s = splitSections(`Wake (D)\nNo puedo callar (C)\nSalmo 23 (C)`);
    expect(s).toHaveLength(1);
    expect(s[0].heading).toBeNull();
  });
});

describe("parseSongLine", () => {
  it("uses the LAST key paren and strips bullets/artist/director/tail", () => {
    expect(parseSongLine("Sólo tu amor (Need your love) - Y&F (C)")).toMatchObject({ rawName: "Sólo tu amor (Need your love)", key: "C" });
    expect(parseSongLine("-Wake (D) Dirige Gaby")).toMatchObject({ rawName: "Wake", key: "D" });
    expect(parseSongLine("Cordero y león (B) - Bethel Music 90 BPM")).toMatchObject({ rawName: "Cordero y león", key: "B" });
    expect(parseSongLine("Infinito Dios | eeyv (C)")).toMatchObject({ rawName: "Infinito Dios", key: "C" });
    expect(parseSongLine("10,000 Razones (C)")).toMatchObject({ rawName: "10,000 Razones", key: "C" });
    expect(parseSongLine("1.- Todo lo haces bien (A) - Gateway Worship")).toMatchObject({ rawName: "Todo lo haces bien", key: "A" });
    expect(parseSongLine("just some prose with no key")).toBeNull();
  });
});

describe("serviceDateFor", () => {
  it("explicit Spanish date wins; type from the weekday it lands on", () => {
    // 3 July 2022 is a Sunday
    expect(serviceDateFor("Domingo 3 de Julio", "2022-06-20")).toMatchObject({ serviceDate: "2022-07-03", type: "featuredSongs", confidence: "explicit" });
  });
  it("year rollover for a December message naming January", () => {
    expect(serviceDateFor("Domingo 2 enero", "2021-12-29").serviceDate).toBe("2022-01-02");
  });
  it("day word only -> next matching weekday on/after the message date", () => {
    // 2022-01-05 is a Wednesday; next Sunday is 2022-01-09
    expect(serviceDateFor("para este domingo", "2022-01-05")).toMatchObject({ serviceDate: "2022-01-09", type: "featuredSongs", confidence: "day-word" });
  });
  it("no date and no day word -> default Sunday, nearest on/after message date", () => {
    expect(serviceDateFor("para este fin", "2022-09-28")).toMatchObject({ type: "featuredSongs", confidence: "inferred" });
  });
  it("flags conflict when explicit date weekday contradicts the day word", () => {
    // 2022-07-03 is a Sunday, but heading says Sábado
    expect(serviceDateFor("Sábado 3 de Julio", "2022-06-20").confidence).toBe("conflict");
  });
});
```

- [ ] **Step 2: Run the tests; confirm they fail (module not found)**

Run: `npm run test -- whatsapp-setlists`
Expected: FAIL — `../whatsapp-setlists.mjs` not found.

- [ ] **Step 3: Implement the lib**

Create `scripts/lib/whatsapp-setlists.mjs`:

```js
const DATE_START = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}), /;
const KEY_PAT = /\(([A-G](#|b)?m?)\)/;
const LAST_KEY = /\(([A-G](#|b)?m?)\)(?![\s\S]*\([A-G](#|b)?m?\))/;
const DAY_HEADING = /^[\s*_]*(s[aá]bado|domingo)\b/i;
const MONTHS = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };

function stripAccents(s) { return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function ymd(y, m, d) { return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function dow(dateStr) { const [y,m,d]=dateStr.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)).getUTCDay(); }
function nextDow(fromStr, target) {
  const [y,m,d]=fromStr.split("-").map(Number);
  const base=new Date(Date.UTC(y,m-1,d));
  const add=((target - base.getUTCDay())%7+7)%7;
  return new Date(base.getTime()+add*86400000).toISOString().slice(0,10);
}

export function parseMessages(text) {
  const out = []; let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(DATE_START);
    if (m) {
      if (cur) out.push(cur);
      const year = m[3].length === 2 ? "20" + m[3] : m[3];
      const date = ymd(year, +m[2], +m[1]);
      const rest = line.slice(m[0].length);          // "TIME - SENDER: BODY" (TIME has U+202F)
      let sender = "", body = rest;
      const dash = rest.indexOf(" - ");
      if (dash >= 0) {
        const after = rest.slice(dash + 3);
        const colon = after.indexOf(": ");
        if (colon >= 0) { sender = after.slice(0, colon); body = after.slice(colon + 2); }
        else body = after;
      }
      cur = { date, sender, body };
    } else if (cur) {
      cur.body += "\n" + line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function detectSetlists(messages) {
  return messages
    .map(m => ({ messageDate: m.date, body: m.body }))
    .filter(m => m.body.split("\n").filter(l => KEY_PAT.test(l)).length >= 3);
}

export function splitSections(body) {
  const sections = []; let cur = null;
  for (const line of body.split("\n")) {
    if (DAY_HEADING.test(line) && !KEY_PAT.test(line)) {
      if (cur) sections.push(cur);
      cur = { heading: line.trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      cur = { heading: null, lines: [line] };
    }
  }
  if (cur) sections.push(cur);
  return sections.filter(s => s.lines.some(l => KEY_PAT.test(l)));
}

export function parseSongLine(line) {
  const m = line.match(LAST_KEY);
  if (!m) return null;
  let name = line.slice(0, m.index);
  name = name.replace(/^\s*[-•*]\s*/, "").replace(/^\s*\d{1,2}[.)-]+\s*/, "");  // bullet / list-number prefix (incl. "1.-" / "1)" / "1-")
  name = name.replace(/\s*\|[^|]*$/, "");                                       // "| eeyev" tail
  name = name.replace(/\s*-\s+[^-]*$/, "");                                     // trailing " - Artist"
  name = name.trim();
  return name.length >= 2 ? { rawName: name, key: m[1] } : null;
}

export function serviceDateFor(heading, messageDate) {
  const t = stripAccents(heading || "").toLowerCase();
  const hasSun = /\bdomingo\b/.test(t), hasSat = /\bsabado\b/.test(t);
  const [my, mm] = messageDate.split("-").map(Number);

  const dmMon = t.match(/\b(\d{1,2})\s*(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (dmMon) {
    const day = +dmMon[1], mon = MONTHS[dmMon[2]];
    const year = mon < mm ? (mon <= 2 && mm >= 11 ? my + 1 : my) : my;  // rollover only Dec->Jan/Feb
    const sd = ymd(year, mon, day);
    const wd = dow(sd);
    let type = wd === 6 ? "saturdarSongs" : "featuredSongs";
    let confidence = "explicit";
    if ((hasSun && wd !== 0) || (hasSat && wd !== 6)) confidence = "conflict";
    else if (hasSun) type = "featuredSongs"; else if (hasSat) type = "saturdarSongs";
    return { serviceDate: sd, type, confidence };
  }
  const dNum = t.match(/\b(sabado|domingo)\s+(\d{1,2})\b/);
  if (dNum) {
    const sd = ymd(my, mm, +dNum[2]);
    const wd = dow(sd);
    const wantSat = dNum[1] === "sabado";
    const confidence = (wantSat && wd !== 6) || (!wantSat && wd !== 0) ? "conflict" : "explicit";
    return { serviceDate: sd, type: wantSat ? "saturdarSongs" : "featuredSongs", confidence };
  }
  if (hasSun || hasSat) {
    const target = hasSat && !hasSun ? 6 : 0;
    return { serviceDate: nextDow(messageDate, target), type: target === 6 ? "saturdarSongs" : "featuredSongs", confidence: "day-word" };
  }
  return { serviceDate: nextDow(messageDate, 0), type: "featuredSongs", confidence: "inferred" };
}
```

- [ ] **Step 4: Run the tests; confirm they pass**

Run: `npm run test -- whatsapp-setlists`
Expected: PASS (all). If `parseMessages` shows 0 messages, the U+202F handling is wrong — re-check that `DATE_START` only requires the ASCII space after the comma (the U+202F is later in the line, inside `rest`, and is not parsed).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/whatsapp-setlists.mjs scripts/lib/__tests__/whatsapp-setlists.test.mjs
git commit -m "feat(setlist): WhatsApp chat parser lib with tests"
```

---

### Task 2: Catalog matcher lib — `scripts/lib/setlist-match.mjs`

**Files:**
- Create: `scripts/lib/setlist-match.mjs`
- Test: `scripts/lib/__tests__/setlist-match.test.mjs`

**Interfaces:**
- Consumes: `normalizeForMatch` from `scripts/lib/catalog-reconcile.mjs`.
- Produces:
  - `buildCatalogIndex(posts: {_id,title}[]): Map<string, string[]>` (normalized key → postIds)
  - `matchSong(rawName, index, aliases={}): { postId } | { candidates: string[] } | null`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/setlist-match.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { buildCatalogIndex, matchSong } from "../setlist-match.mjs";

const posts = [
  { _id: "p1", title: "Vives En Mí (Wake)" },
  { _id: "p2", title: "Aquí Estoy (The Stand)" },
  { _id: "p3", title: "Salmo 23" },
  { _id: "a1", title: "Amor Sin Condición" },
  { _id: "a2", title: "Amor Sin Condición (Reckless Love)" },
];

describe("buildCatalogIndex + matchSong", () => {
  const idx = buildCatalogIndex(posts);
  it("matches the English part of a bilingual title", () => {
    expect(matchSong("Wake", idx)).toEqual({ postId: "p1" });
    expect(matchSong("The Stand", idx)).toEqual({ postId: "p2" });
  });
  it("matches the Spanish part / full title", () => {
    expect(matchSong("Vives en mí", idx)).toEqual({ postId: "p1" });
    expect(matchSong("Salmo 23", idx)).toEqual({ postId: "p3" });
  });
  it("returns candidates for an ambiguous normalized name (never silent-picks)", () => {
    const r = matchSong("Amor Sin Condición", idx);
    expect(r.candidates.sort()).toEqual(["a1", "a2"]);
  });
  it("honors the alias map and returns null for a genuine miss", () => {
    expect(matchSong("Avivanos", idx, { [normalize("Avivanos")]: "p3" })).toEqual({ postId: "p3" });
    expect(matchSong("Some Unknown Song", idx)).toBeNull();
  });
});

import { normalizeForMatch as normalize } from "../catalog-reconcile.mjs";
```

- [ ] **Step 2: Run; confirm fail**

Run: `npm run test -- setlist-match`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `scripts/lib/setlist-match.mjs`:

```js
import { normalizeForMatch } from "./catalog-reconcile.mjs";

export function buildCatalogIndex(posts) {
  const index = new Map();
  const add = (s, id) => { const k = normalizeForMatch(s); if (!k) return; if (!index.has(k)) index.set(k, new Set()); index.get(k).add(id); };
  for (const p of posts) {
    add(p.title, p._id);
    const m = p.title.match(/^([^([]+)[([](.+?)[)\]]/);  // "Spanish (English)" -> both parts
    if (m) { add(m[1], p._id); add(m[2], p._id); }
  }
  return new Map([...index].map(([k, set]) => [k, [...set]]));
}

export function matchSong(rawName, index, aliases = {}) {
  const k = normalizeForMatch(rawName);
  if (!k) return null;
  if (aliases[k]) return { postId: aliases[k] };
  const ids = index.get(k);
  if (!ids) return null;
  return ids.length === 1 ? { postId: ids[0] } : { candidates: [...ids].sort() };
}
```

- [ ] **Step 4: Run; confirm pass**

Run: `npm run test -- setlist-match`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/setlist-match.mjs scripts/lib/__tests__/setlist-match.test.mjs
git commit -m "feat(setlist): bilingual catalog matcher lib with tests"
```

---

### Task 3: Runner — extract + dry-run report (Phase A)

**Files:**
- Create: `scripts/import-setlist-history.mjs`

**Interfaces:**
- Consumes: `whatsapp-setlists.mjs`, `setlist-match.mjs`, Sanity read client.
- Produces (to the catalog working dir, default `/Users/frankrocha/Downloads/ContentUpdateProject`):
  `setlist-plan.json` (array of `{ messageDate, serviceDate, type, confidence, songs:[{ rawName, key, postId|null, candidates? }] }`) and a `setlist-decisions.json` template keyed by normalized song name: unmatched → `{ action:"alias"|"skip", postId? }`; ambiguous → `{ action:"pick", postId, _candidates }`. Apply refuses until every surfaced unmatched AND ambiguous song has a valid decision.

- [ ] **Step 1: Write the runner (Phase A only)**

Create `scripts/import-setlist-history.mjs`:

```js
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
```

- [ ] **Step 2: Run the dry-run**

Run: `node scripts/import-setlist-history.mjs`
Expected: prints setlist counts by year (≈2022:53…2026:39 before splitting/dedup), the low-confidence/collision/unmatched lists; writes `setlist-plan.json` + `setlist-decisions.json` to the working dir. Nothing written to Sanity. **STOP — the controller reviews this output with the user (resolve unmatched songs, eyeball low-confidence dates) before Task 4.**

- [ ] **Step 3: Commit (script only — not the generated json, which lives in the external working dir)**

```bash
git add scripts/import-setlist-history.mjs
git commit -m "feat(setlist): dry-run extraction + reconciliation report"
```

---

### Task 4: Runner — apply (Phase B, gated production write)

**Files:**
- Modify: `scripts/import-setlist-history.mjs` (add `phaseB`)

**Interfaces:**
- Consumes: `setlist-plan.json`, `setlist-decisions.json` (user-resolved), `writeClient`.
- Produces: created `featuredSongs`/`saturdarSongs` docs.

- [ ] **Step 1: Add `phaseB` to the runner**

Append to `scripts/import-setlist-history.mjs`, before the trailing `if (!APPLY)` line:

```js
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
```

- [ ] **Step 2: Parse-check**

Run: `node --check scripts/import-setlist-history.mjs`
Expected: exit 0, no output.

- [ ] **Step 3: Apply (controller runs this, ONCE, after the user approves the dry-run + decisions)**

Run: `node scripts/import-setlist-history.mjs --apply`
Expected: `Applied: N history docs created, M skipped`. It refuses to run if any surfaced unmatched/ambiguous song is unresolved in `setlist-decisions.json`.

- [ ] **Step 4: Verify**

```bash
node --input-type=module -e '
import dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { createClient } from "next-sanity";
const c = createClient({projectId:process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,dataset:process.env.NEXT_PUBLIC_SANITY_DATASET,apiVersion:"2024-07-23",useCdn:false,token:process.env.SANITY_API_READ_TOKEN});
console.log("Sunday docs:", await c.fetch(`count(*[_type=="featuredSongs"])`));
console.log("Saturday docs:", await c.fetch(`count(*[_type=="saturdarSongs"])`));
const r = await c.fetch(`*[_type=="featuredSongs"]|order(week desc)[0]{week, "n": count(songs)}`);
console.log("most recent Sunday:", JSON.stringify(r));
'
```
Expected: counts jump by the created amount; a sample doc has a `week` + song count.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-setlist-history.mjs
git commit -m "feat(setlist): apply phase — create history docs (gated, dedup)"
```

---

## Self-Review

**Spec coverage:** parser (Task 1: parseMessages U+202F, detectSetlists, splitSections, parseSongLine last-paren, serviceDateFor explicit/day-word/inferred/conflict) ✓; bilingual matcher + ambiguity (Task 2) ✓; dry-run report with low-confidence/collision/unmatched + plan/decisions files (Task 3) ✓; gated apply with dedup + idempotency + refuse-on-unresolved (Task 4) ✓; scope filter on serviceDate, skip existing 13 weeks, never overwrite ✓; `saturdarSongs` type ✓; input from zip ✓.

**Placeholder scan:** none — every function has complete code; the only deferred work is the *human decisions* in `setlist-decisions.json` (by design, the gate), and the apply step refuses until they're resolved.

**Type consistency:** `serviceDateFor` returns `{serviceDate,type,confidence}` used identically in the runner; `matchSong` returns `{postId}|{candidates}|null` consumed consistently; plan entry shape `{messageDate,serviceDate,type,confidence,songs:[{rawName,key,postId,candidates?}]}` written in Task 3 and read in Task 4; `saturdarSongs`/`featuredSongs` spelled consistently; `setlist_song` item shape matches the schema.

**Risks:** Task 4 is the only prod write, gated behind the dry-run review + the unresolved-refusal guard. The dedup keeps the most-complete block per (type, serviceDate) and skips the existing weeks (live-fetched). The Spanish-date `serviceDateFor` is the fuzziest unit — its low-confidence rows are surfaced for human eyeballing before apply.
