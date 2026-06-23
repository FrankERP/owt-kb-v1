# Dual reference links + Música/Letras Practicar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each song a musical-reference video and an optional Spanish-lyrics video, display both on the song page, offer Música/Letras choices on the set-level Practicar button, and import the 120-song catalog into Sanity as a safe upsert.

**Architecture:** Two new `url` fields on the `post` schema (`musicalReferenceUrl`, `lyricsVideoUrl`); all readers prefer them and fall back to legacy `referenceLinks`/`tutorials2`. A pure, unit-tested reconcile library (`scripts/lib/catalog-reconcile.mjs`) drives a two-phase import runner (dry-run report → apply). UI work extends the song page, the Practicar button/menu, the practice-playlist API, and the song editor.

**Tech Stack:** Next.js (App Router), Sanity (`next-sanity`), TypeScript for app code, plain ESM `.mjs` for standalone scripts, Vitest for tests, Tailwind for styling, Python venv (openpyxl) only to convert the xlsx to JSON.

## Global Constraints

- Node 22 LTS (repo `.nvmrc` + engines).
- Commit messages: **never** add a Co-Authored-By / AI-attribution trailer.
- UI copy is **Spanish**. Sentence/label casing follows existing components.
- Palette: dark navy backgrounds `#001f3f` / `#00162e`, cyan accent `#00bfff`, muted text `#C8D8EB`. Reuse existing `font-label` / `font-body` / `font-display` classes.
- The import must **never** modify `body`/lyrics, `audioTracks`, `chords`, `tutorials2`, or `referenceLinks` on existing docs.
- Field-write policy on a matched song: always set the two URLs (skip absent/`"n/a"`); `key` and `bpm` sheet-wins-on-difference; `timeSig` fill-if-empty; `title`/`author` keep-and-report; `tags` union then drop `Alabanza`/`Adoración`.
- Tests use Vitest (`npm run test`). Place new tests under `__tests__/` next to the code.
- Sanity writes use `writeClient` (`SANITY_WRITE_TOKEN`); reads use a token client. Env is in `.env.local`.
- Working catalog files live in `~/Downloads/ContentUpdateProject/` (`oasis-songs.xlsx`, `.venv/`).

---

### Task 1: Add the two URL fields to the schema and the `Post` type

**Files:**
- Modify: `sanity/schemas/post.ts` (insert after the `key` field, ~line 51)
- Modify: `app/utils/interface.tsx:22` (add to `Post`)

**Interfaces:**
- Produces: `post.musicalReferenceUrl: url`, `post.lyricsVideoUrl: url`; `Post.musicalReferenceUrl?: string`, `Post.lyricsVideoUrl?: string`.

- [ ] **Step 1: Add the schema fields**

In `sanity/schemas/post.ts`, immediately after the `key` field object (the one ending at the `},` on line 51), insert:

```ts
		{
			name: 'musicalReferenceUrl',
			title: 'Musical reference (URL)',
			description: 'YouTube musical reference mix — what musicians rehearse with.',
			type: 'url',
		},
		{
			name: 'lyricsVideoUrl',
			title: 'Spanish lyrics video (URL)',
			description: 'YouTube video with the Spanish lyrics the team sings. Optional.',
			type: 'url',
		},
```

- [ ] **Step 2: Extend the `Post` interface**

In `app/utils/interface.tsx`, add after line 22 (`referenceLinks?: …`):

```ts
  musicalReferenceUrl?: string;
  lyricsVideoUrl?: string;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from these files.

- [ ] **Step 4: Deploy the schema**

Use the `sanity:deploy-schema` skill (or run the project's schema deploy). Verify the two fields appear on the Post document in the Studio.

- [ ] **Step 5: Commit**

```bash
git add sanity/schemas/post.ts app/utils/interface.tsx
git commit -m "feat(song): add musicalReferenceUrl and lyricsVideoUrl fields"
```

---

### Task 2: Pure reconcile library + tests

**Files:**
- Create: `scripts/lib/catalog-reconcile.mjs`
- Test: `scripts/lib/__tests__/catalog-reconcile.test.mjs`

**Interfaces:**
- Consumes: nothing (pure functions over plain objects).
- Produces (all exported from `catalog-reconcile.mjs`):
  - `stripDiacritics(s: string): string`
  - `normalizeForMatch(s: string): string`
  - `cleanTempoTags(names: string[]): string[]`
  - `mergeTagNames(existing: string[], incoming: string[]): string[]`
  - `matchRow(row, existingPosts): { status: 'matched'|'ambiguous'|'new', matchId: string|null, candidateIds: string[] }`
  - `computeFieldUpdates(existing, row): { set: Record<string,unknown>, conflicts: Array<{field,existing,sheet}>, flags: string[] }`
  - Row shape: `{ title, author, key, bpm, timeSig, tags: string[], musicalUrl: string|null, lyricsUrl: string|null }`
  - Existing post shape: `{ _id, title, author, key, bpm, timeSig, tagNames: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/catalog-reconcile.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import {
  stripDiacritics, normalizeForMatch, cleanTempoTags,
  mergeTagNames, matchRow, computeFieldUpdates,
} from "../catalog-reconcile.mjs";

describe("normalizeForMatch", () => {
  it("lowercases, strips accents, drops subtitles and punctuation", () => {
    expect(normalizeForMatch("Cielo Y Tierra")).toBe(normalizeForMatch("Cielo y Tierra"));
    expect(normalizeForMatch("Sólo En Jesús")).toBe(normalizeForMatch("Solo En Jesús"));
    expect(normalizeForMatch("Donde Tú Estás (Where You Are)")).toBe(normalizeForMatch("Donde Tú Estás"));
    expect(normalizeForMatch("10,000 Razones (10,000 Reasons [Bless The Lord])")).toBe("10000 razones");
  });
});

describe("cleanTempoTags", () => {
  it("drops Alabanza/Adoración and dedupes, keeping tempo", () => {
    expect(cleanTempoTags(["Down Beat", "Alabanza", "Su Nombre"])).toEqual(["Down Beat", "Su Nombre"]);
    expect(cleanTempoTags(["Up Beat", "Adoración", "Up Beat"])).toEqual(["Up Beat"]);
  });
});

describe("mergeTagNames", () => {
  it("unions existing + incoming, then strips Alabanza/Adoración", () => {
    expect(mergeTagNames(["Up Beat", "Poder"], ["Up Beat", "Alabanza", "Promesas"]))
      .toEqual(["Up Beat", "Poder", "Promesas"]);
  });
});

describe("matchRow", () => {
  const existing = [
    { _id: "a", title: "Amor Sin Condición", author: "Marco Barrientos" },
    { _id: "b", title: "Amor Sin Condición (Reckless Love)", author: "Cory Asbury" },
    { _id: "c", title: "Cielo y Tierra", author: "Conquistando Fronteras" },
  ];
  it("matches one candidate by normalized title", () => {
    const r = matchRow({ title: "Cielo Y Tierra", author: "" }, existing);
    expect(r.status).toBe("matched");
    expect(r.matchId).toBe("c");
  });
  it("disambiguates a title collision by author", () => {
    const r = matchRow({ title: "Amor Sin Condición (Reckless Love)", author: "Cory Asbury" }, existing);
    expect(r.status).toBe("matched");
    expect(r.matchId).toBe("b");
  });
  it("flags ambiguous when author cannot disambiguate", () => {
    const r = matchRow({ title: "Amor Sin Condición", author: "Desconocido" }, existing);
    expect(r.status).toBe("ambiguous");
    expect(r.candidateIds.sort()).toEqual(["a", "b"]);
  });
  it("returns new when no candidate", () => {
    expect(matchRow({ title: "Es Navidad", author: "" }, existing).status).toBe("new");
  });
});

describe("computeFieldUpdates", () => {
  const existing = { _id: "x", title: "Donde Tú Estás", author: "Conquistando Fronteras",
    key: "C", bpm: 70, timeSig: "", tagNames: ["Up Beat", "Poder"] };
  it("always sets the two URLs, sheet-wins on key/bpm, fills timeSig, never changes title", () => {
    const row = { title: "Donde Tú Estás (Where You Are)", author: "Conquistando Fronteras",
      key: "D", bpm: null, timeSig: "4/4", tags: ["Down Beat", "Alabanza"],
      musicalUrl: "https://youtu.be/m", lyricsUrl: null };
    const { set, conflicts } = computeFieldUpdates(existing, row);
    expect(set.musicalReferenceUrl).toBe("https://youtu.be/m");
    expect(set).not.toHaveProperty("lyricsVideoUrl");
    expect(set.key).toBe("D");
    expect(set).not.toHaveProperty("bpm");
    expect(set.timeSig).toBe("4/4");
    expect(set).not.toHaveProperty("title");
    expect(conflicts.some((c) => c.field === "title")).toBe(true);
  });
  it("flags a song left with no tempo tag", () => {
    const ex = { ...existing, tagNames: [] };
    const row = { title: "Desde Mi Interior", author: "", key: "", bpm: null, timeSig: "",
      tags: ["Rendición", "Gracia de Dios"], musicalUrl: null, lyricsUrl: null };
    const { flags } = computeFieldUpdates(ex, row);
    expect(flags).toContain("no-tempo-tag");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- scripts/lib`
Expected: FAIL — module `../catalog-reconcile.mjs` not found.

- [ ] **Step 3: Implement the library**

Create `scripts/lib/catalog-reconcile.mjs`:

```js
const TEMPO_DROP = new Set(["alabanza", "adoración", "adoracion"]);
const TEMPO_TAGS = new Set(["up beat", "down beat"]);

export function stripDiacritics(s) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeForMatch(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, " ")   // drop (...) and [...] subtitles
    .replace(/[^a-z0-9 ]+/g, " ")    // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTempoTags(names) {
  const out = [];
  const seen = new Set();
  for (const name of names) {
    const norm = stripDiacritics(name).toLowerCase().trim();
    if (TEMPO_DROP.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

export function mergeTagNames(existing, incoming) {
  return cleanTempoTags([...(existing ?? []), ...(incoming ?? [])]);
}

export function matchRow(row, existingPosts) {
  const t = normalizeForMatch(row.title);
  const candidates = existingPosts.filter((p) => normalizeForMatch(p.title) === t);
  if (candidates.length === 0) return { status: "new", matchId: null, candidateIds: [] };
  if (candidates.length === 1) return { status: "matched", matchId: candidates[0]._id, candidateIds: [candidates[0]._id] };
  const a = normalizeForMatch(row.author);
  const byAuthor = candidates.filter((p) => a && normalizeForMatch(p.author) === a);
  if (byAuthor.length === 1) return { status: "matched", matchId: byAuthor[0]._id, candidateIds: candidates.map((c) => c._id) };
  return { status: "ambiguous", matchId: null, candidateIds: candidates.map((c) => c._id) };
}

export function computeFieldUpdates(existing, row) {
  const set = {};
  const conflicts = [];
  const flags = [];

  if (row.musicalUrl) set.musicalReferenceUrl = row.musicalUrl;
  if (row.lyricsUrl)  set.lyricsVideoUrl = row.lyricsUrl;

  if (row.key && row.key !== existing.key) set.key = row.key;
  if (row.bpm != null && Number(row.bpm) !== Number(existing.bpm)) set.bpm = Number(row.bpm);
  if (row.timeSig && !existing.timeSig) set.timeSig = row.timeSig;

  if (row.title && normalizeForMatch(row.title) === normalizeForMatch(existing.title)
      && row.title !== existing.title) {
    conflicts.push({ field: "title", existing: existing.title, sheet: row.title });
  }
  if (row.author && existing.author && normalizeForMatch(row.author) === normalizeForMatch(existing.author)
      && row.author !== existing.author) {
    conflicts.push({ field: "author", existing: existing.author, sheet: row.author });
  }

  const finalTags = mergeTagNames(existing.tagNames ?? [], row.tags ?? []);
  set._tagNames = finalTags;  // runner resolves names -> refs
  if (!finalTags.some((n) => TEMPO_TAGS.has(stripDiacritics(n).toLowerCase()))) {
    flags.push("no-tempo-tag");
  }
  return { set, conflicts, flags };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- scripts/lib`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/catalog-reconcile.mjs scripts/lib/__tests__/catalog-reconcile.test.mjs
git commit -m "feat(import): pure catalog reconcile library with tests"
```

---

### Task 3: xlsx→JSON converter + import runner Phase A (dry-run report)

**Files:**
- Create: `scripts/catalog/xlsx-to-json.py`
- Create: `scripts/import-catalog.mjs`

**Interfaces:**
- Consumes: `catalog-reconcile.mjs` (Task 2); `.env.local` (`NEXT_PUBLIC_SANITY_*`, `SANITY_WRITE_TOKEN`).
- Produces: a console report and `import-plan.json` (written to the catalog working folder). Plan entry shape: `{ rowTitle, rowAuthor, status, matchId, candidateIds, set, conflicts, flags }`.

- [ ] **Step 1: Write the xlsx→JSON converter**

Create `scripts/catalog/xlsx-to-json.py`:

```python
import json, sys
import openpyxl

src = sys.argv[1] if len(sys.argv) > 1 else "oasis-songs.xlsx"
out = sys.argv[2] if len(sys.argv) > 2 else "oasis-songs.json"

wb = openpyxl.load_workbook(src)
ws = wb.active

def na(v):
    if v is None: return None
    s = str(v).strip()
    return None if s == "" or s.lower() == "n/a" else s

rows = []
for r in range(2, ws.max_row + 1):
    title = na(ws.cell(r, 1).value)
    if not title:
        continue
    tags_raw = ws.cell(r, 6).value or ""
    rows.append({
        "title": title,
        "author": na(ws.cell(r, 2).value) or "",
        "key": na(ws.cell(r, 3).value) or "",
        "bpm": na(ws.cell(r, 4).value),
        "timeSig": na(ws.cell(r, 5).value) or "",
        "tags": [t.strip() for t in str(tags_raw).split(",") if t.strip()],
        "musicalUrl": na(ws.cell(r, 8).value),
        "lyricsUrl": na(ws.cell(r, 9).value),
    })

with open(out, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)
print(f"Wrote {len(rows)} rows to {out}")
```

- [ ] **Step 2: Generate the JSON dump**

Run (uses the existing venv):

```bash
cd ~/Downloads/ContentUpdateProject && \
  ./.venv/bin/python3 /Users/frankrocha/Documents/Builds/owt-kb-v1/scripts/catalog/xlsx-to-json.py \
  oasis-songs.xlsx oasis-songs.json
```

Expected: `Wrote 120 rows to oasis-songs.json`.

- [ ] **Step 3: Write the import runner (Phase A)**

Create `scripts/import-catalog.mjs`:

```js
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "next-sanity";
import { matchRow, computeFieldUpdates } from "./lib/catalog-reconcile.mjs";

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
  return rows.map((row) => {
    for (const u of [row.musicalUrl, row.lyricsUrl]) {
      if (u && !isSafeHttpUrl(u)) throw new Error(`Unsafe URL in "${row.title}": ${u}`);
    }
    const m = matchRow(row, existing);
    const target = m.matchId ? byId.get(m.matchId)
      : { title: "", author: "", key: "", bpm: null, timeSig: "", tagNames: [] };
    const { set, conflicts, flags } = computeFieldUpdates(target, row);
    if (m.status === "new") { set.title = row.title; set.author = row.author; }
    return { rowTitle: row.title, rowAuthor: row.author, status: m.status,
      matchId: m.matchId, candidateIds: m.candidateIds, set, conflicts, flags };
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
```

- [ ] **Step 4: Run the dry-run against live Sanity**

Run: `node scripts/import-catalog.mjs`
Expected: prints MATCHED / AMBIGUOUS / NEW buckets; writes `import-plan.json`. Manually confirm: *Amor Sin Condición* appears AMBIGUOUS; *Cielo Y Tierra* matches *Cielo y Tierra*; *Desde Mi Interior* shows `FLAG: no-tempo-tag`; counts look sane (≈55 matched/ambiguous, rest new).

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog/xlsx-to-json.py scripts/import-catalog.mjs
git commit -m "feat(import): xlsx-to-json converter and dry-run reconcile report"
```

---

### Task 4: Import runner Phase B (apply)

**Files:**
- Modify: `scripts/import-catalog.mjs` (add tag resolution + apply path)

**Interfaces:**
- Consumes: `import-plan.json` (Task 3), `writeClient`.
- Produces: created/patched `post` docs and created `tag` docs in Sanity.

- [ ] **Step 1: Add tag resolution + apply to the runner**

Append to `scripts/import-catalog.mjs`, before the trailing `if (!APPLY)` block:

```js
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
```

Note: the existing `if (!APPLY) { phaseA()... }` block stays as-is directly above this.

- [ ] **Step 2: Resolve ambiguous rows**

Open `import-plan.json`; for each `"status": "ambiguous"` entry, set `"matchId"` to the correct candidate `_id` (e.g. *Amor Sin Condición (Reckless Love)* → the Cory Asbury `_id`) and change `"status"` to `"matched"`. Re-run Phase A is **not** needed — Phase B reads the edited plan.

- [ ] **Step 3: Apply**

Run: `node scripts/import-catalog.mjs --apply`
Expected: `Applied: N created, M updated, 0 skipped.`

- [ ] **Step 4: Verify in Sanity**

Run a spot check:

```bash
node -e 'import("dotenv/config").then(async()=>{const{createClient}=await import("next-sanity");const c=createClient({projectId:process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,dataset:process.env.NEXT_PUBLIC_SANITY_DATASET,apiVersion:"2024-07-23",useCdn:false,token:process.env.SANITY_WRITE_TOKEN});const r=await c.fetch(`*[_type=="post" && defined(musicalReferenceUrl)]{title,musicalReferenceUrl,lyricsVideoUrl,"t":tags[]->name}|order(title asc)[0...5]`);console.log(JSON.stringify(r,null,2));})'
```

Expected: songs show `musicalReferenceUrl`, optional `lyricsVideoUrl`, and no `Alabanza`/`Adoración` in tags.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-catalog.mjs
git commit -m "feat(import): apply phase — upsert posts and resolve tags"
```

---

### Task 5: Practice-playlist API — `mode` param with fallback

**Files:**
- Create: `app/utils/practiceVideo.ts`
- Test: `app/utils/__tests__/practiceVideo.test.ts`
- Modify: `app/api/practice-playlist/route.ts`

**Interfaces:**
- Produces: `pickPracticeVideoUrl(song, mode): string | null` where `mode: "musica" | "letras"` and `song: { musicalReferenceUrl?, lyricsVideoUrl?, referenceLinks?: {url}[], tutorials2?: {url}[] }`.

- [ ] **Step 1: Write the failing test**

Create `app/utils/__tests__/practiceVideo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickPracticeVideoUrl } from "../practiceVideo";

describe("pickPracticeVideoUrl", () => {
  const song = {
    musicalReferenceUrl: "https://youtu.be/MUS",
    lyricsVideoUrl: "https://youtu.be/LYR",
    referenceLinks: [{ url: "https://youtu.be/LEGACY" }],
  };
  it("musica mode uses the musical reference", () => {
    expect(pickPracticeVideoUrl(song, "musica")).toBe("https://youtu.be/MUS");
  });
  it("letras mode uses the lyrics video", () => {
    expect(pickPracticeVideoUrl(song, "letras")).toBe("https://youtu.be/LYR");
  });
  it("letras falls back to musical when no lyrics video", () => {
    expect(pickPracticeVideoUrl({ musicalReferenceUrl: "https://youtu.be/MUS" }, "letras"))
      .toBe("https://youtu.be/MUS");
  });
  it("falls back to legacy referenceLinks when no new fields", () => {
    expect(pickPracticeVideoUrl({ referenceLinks: [{ url: "https://youtu.be/LEGACY" }] }, "musica"))
      .toBe("https://youtu.be/LEGACY");
  });
  it("returns null when nothing is available", () => {
    expect(pickPracticeVideoUrl({}, "musica")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- practiceVideo`
Expected: FAIL — `../practiceVideo` not found.

- [ ] **Step 3: Implement the helper**

Create `app/utils/practiceVideo.ts`:

```ts
type PracticeSong = {
  musicalReferenceUrl?: string;
  lyricsVideoUrl?: string;
  referenceLinks?: Array<{ url: string }>;
  tutorials2?: Array<{ url: string }>;
};

export function pickPracticeVideoUrl(song: PracticeSong, mode: "musica" | "letras"): string | null {
  const legacy = [...(song.referenceLinks ?? []), ...(song.tutorials2 ?? [])].map((l) => l.url);
  const musical = song.musicalReferenceUrl ?? legacy[0] ?? null;
  if (mode === "letras") return song.lyricsVideoUrl ?? musical;
  return musical;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- practiceVideo`
Expected: PASS.

- [ ] **Step 5: Wire the helper into the route**

In `app/api/practice-playlist/route.ts`:

Add the import after the existing imports:

```ts
import { pickPracticeVideoUrl } from "@/app/utils/practiceVideo";
```

Replace the request-body destructure (currently `const { ids } = …`) with:

```ts
  const { ids, mode } = (await req.json()) as { ids?: string[]; mode?: "musica" | "letras" };
  const pickMode: "musica" | "letras" = mode === "letras" ? "letras" : "musica";
```

Extend the GROQ projection to fetch the new fields:

```ts
    `*[_type == "post" && _id in $ids]{ _id, musicalReferenceUrl, lyricsVideoUrl, referenceLinks[]{url}, tutorials2[]{url} }`,
```

Replace the per-song candidate loop body (the `const candidates = …` block through its inner `for`) with:

```ts
    const url = pickPracticeVideoUrl(s, pickMode);
    const vid = ytId(url ?? undefined);
    if (vid && !videoIds.includes(vid)) videoIds.push(vid);
```

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npm run test -- practiceVideo`
Expected: no type errors; tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/utils/practiceVideo.ts app/utils/__tests__/practiceVideo.test.ts app/api/practice-playlist/route.ts
git commit -m "feat(practice): mode-aware playlist with lyrics->musical fallback"
```

---

### Task 6: Practicar button — two-item menu

**Files:**
- Modify: `app/components/PracticePlaylistButton.tsx`

**Interfaces:**
- Consumes: `POST /api/practice-playlist` with `{ ids, mode }` (Task 5).

- [ ] **Step 1: Replace the component with a menu**

Rewrite `app/components/PracticePlaylistButton.tsx`:

```tsx
"use client";

import { useState } from "react";

// Opens a YouTube playlist of the setlist's songs for personal practice.
// Two modes: "musica" (musical reference) or "letras" (Spanish lyrics, falling
// back to the musical reference per song).
export default function PracticePlaylistButton({ songIds, accent }: { songIds: string[]; accent: string }) {
  const [state, setState] = useState<"idle" | "loading" | "empty">("idle");
  const [open, setOpen] = useState(false);

  async function go(mode: "musica" | "letras") {
    setOpen(false);
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/practice-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: songIds, mode }),
      });
      const { url } = (await res.json()) as { url: string | null };
      if (url) { window.open(url, "_blank", "noopener"); setState("idle"); }
      else { setState("empty"); setTimeout(() => setState("idle"), 2500); }
    } catch { setState("idle"); }
  }

  const label = state === "loading" ? "Abriendo…" : state === "empty" ? "Sin videos" : "Practicar";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={state === "loading"}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Practicar el set en YouTube"
        style={{ color: accent, borderColor: `${accent}55`, background: `${accent}14` }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full border font-label text-[10px] uppercase tracking-widest transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 min-w-[220px] rounded-xl border border-[#00bfff]/25 bg-[#00162e] overflow-hidden shadow-lg">
          <button role="menuitem" type="button" onClick={() => go("musica")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors border-b border-[#00bfff]/10">
            <span className="font-label text-sm text-white">🎵 Música</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">referencia musical</span>
          </button>
          <button role="menuitem" type="button" onClick={() => go("letras")}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#00bfff]/10 transition-colors">
            <span className="font-label text-sm text-white">🎤 Letras</span>
            <span className="font-body text-[11px] text-[#C8D8EB]/60">letra en español</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verify**

Start the app (`npm run dev`), open a setlist that renders the Practicar button, click it, confirm the menu shows Música / Letras and each opens a YouTube playlist tab.

- [ ] **Step 4: Commit**

```bash
git add app/components/PracticePlaylistButton.tsx
git commit -m "feat(practice): Practicar menu with Música and Letras options"
```

---

### Task 7: Song page — two-card reference display

**Files:**
- Modify: `app/(client)/posts/[slug]/page.tsx` (GROQ ~line 33; section gate ~line 108/114; reference section ~lines 243-268)

**Interfaces:**
- Consumes: `post.musicalReferenceUrl`, `post.lyricsVideoUrl`.

- [ ] **Step 1: Fetch the new fields**

In the GROQ query, after `referenceLinks[]{ label, url },` (line 33) add:

```
      musicalReferenceUrl,
      lyricsVideoUrl,
```

- [ ] **Step 2: Update the section gate**

Replace line 108:

```ts
  const hasRefLinks  = (post?.referenceLinks?.length ?? 0) > 0;
```

with:

```ts
  const hasMusicalRef = !!post?.musicalReferenceUrl;
  const hasLyricsVid  = !!post?.lyricsVideoUrl;
  const hasRefLinks   = hasMusicalRef || hasLyricsVid || (post?.referenceLinks?.length ?? 0) > 0;
```

- [ ] **Step 3: Replace the reference section UI**

Replace the whole `{hasRefLinks && ( … )}` block (lines ~244-268) with:

```tsx
        {hasRefLinks && (
          <section id="referencia">
            <SectionHeader>Versión de referencia</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
              {(post.musicalReferenceUrl || (post.referenceLinks?.[0]?.url)) && (
                <a href={post.musicalReferenceUrl || post.referenceLinks![0].url}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 hover:border-[#00bfff]/50 hover:bg-[#00bfff]/5 transition-colors group">
                  <span className="flex items-center justify-center w-11 h-11 rounded-full bg-[#00bfff]/12 text-[#00bfff] shrink-0">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-sm font-semibold group-hover:text-[#00bfff] transition-colors">Referencia musical</span>
                    <span className="block font-body text-xs text-[#C8D8EB]/60 dark:text-[#C8D8EB]/50">Para ensayar — músicos</span>
                  </span>
                </a>
              )}
              {post.lyricsVideoUrl && (
                <a href={post.lyricsVideoUrl}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#003572]/25 dark:border-[#00bfff]/15 hover:border-[#00bfff]/50 hover:bg-[#00bfff]/5 transition-colors group">
                  <span className="flex items-center justify-center w-11 h-11 rounded-full bg-[#00bfff]/12 text-[#00bfff] shrink-0">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
                  </span>
                  <span className="flex-1">
                    <span className="block font-display text-sm font-semibold group-hover:text-[#00bfff] transition-colors">Versión con letra</span>
                    <span className="block font-body text-xs text-[#C8D8EB]/60 dark:text-[#C8D8EB]/50">Letra en español</span>
                  </span>
                </a>
              )}
            </div>
          </section>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify**

In `npm run dev`, open a song that has a lyrics video (e.g. *Alaba (Praise)*) — both cards show; open one without (e.g. *Así Eres Tú (Way Maker)*) — only the musical card shows.

- [ ] **Step 6: Commit**

```bash
git add "app/(client)/posts/[slug]/page.tsx"
git commit -m "feat(song): two-card musical/lyrics reference display"
```

---

### Task 8: Editor support for the two fields

**Files:**
- Modify: `app/components/EditSongButton.tsx` (`FormState`, `postToForm`, `buildPayload`, JSX after the reference-links block ~line 357)
- Modify: `app/api/content/posts/[id]/route.ts` (accept + patch the fields)
- Modify: `app/api/content/posts/route.ts` (accept + create the fields)

**Interfaces:**
- Consumes: `post.musicalReferenceUrl`, `post.lyricsVideoUrl`.
- Produces: PATCH/POST bodies carry `musicalReferenceUrl`, `lyricsVideoUrl`.

- [ ] **Step 1: Extend the form state and mappers**

In `app/components/EditSongButton.tsx`:

`FormState` (after `referenceLinks: …;`):

```ts
  musicalReferenceUrl: string;
  lyricsVideoUrl: string;
```

`postToForm` return (after `referenceLinks: post.referenceLinks ?? [],`):

```ts
    musicalReferenceUrl: post.musicalReferenceUrl ?? "",
    lyricsVideoUrl:      post.lyricsVideoUrl ?? "",
```

`buildPayload` return (after `referenceLinks: form.referenceLinks,`):

```ts
    musicalReferenceUrl: form.musicalReferenceUrl.trim(),
    lyricsVideoUrl:      form.lyricsVideoUrl.trim(),
```

- [ ] **Step 2: Add the inputs to the form**

In `app/components/EditSongButton.tsx`, immediately after the Reference Links `</div>` that closes the block at line 357, insert:

```tsx
                {/* Musical & lyrics reference videos */}
                <div className="space-y-2">
                  <label className="font-label text-xs uppercase tracking-widest text-gray-500">Referencia musical (URL)</label>
                  <input className={inputCls} value={form.musicalReferenceUrl}
                    onChange={(e) => setForm((f) => ({ ...f, musicalReferenceUrl: e.target.value }))}
                    placeholder="https://youtu.be/…" />
                </div>
                <div className="space-y-2">
                  <label className="font-label text-xs uppercase tracking-widest text-gray-500">Video con letra en español (URL)</label>
                  <input className={inputCls} value={form.lyricsVideoUrl}
                    onChange={(e) => setForm((f) => ({ ...f, lyricsVideoUrl: e.target.value }))}
                    placeholder="https://youtu.be/…" />
                </div>
```

- [ ] **Step 3: Accept and patch the fields in the [id] route**

In `app/api/content/posts/[id]/route.ts`, add to the body type (after `referenceLinks?: …;`):

```ts
    musicalReferenceUrl?: string;
    lyricsVideoUrl?: string;
```

Add validation after the existing URL checks (after line 43):

```ts
  for (const u of [body.musicalReferenceUrl, body.lyricsVideoUrl]) {
    if (u != null && u !== "" && !isSafeHttpUrl(u)) {
      return NextResponse.json({ error: "reference URLs must use http(s)" }, { status: 400 });
    }
  }
```

Add to the patch builder (after the `referenceLinks` block, ~line 61):

```ts
  if (body.musicalReferenceUrl != null) patch.musicalReferenceUrl = body.musicalReferenceUrl || undefined;
  if (body.lyricsVideoUrl != null)      patch.lyricsVideoUrl = body.lyricsVideoUrl || undefined;
```

- [ ] **Step 4: Accept and create the fields in the create route**

In `app/api/content/posts/route.ts`, add to the body type (after `referenceLinks?: …;`, line 47):

```ts
    musicalReferenceUrl?: string;
    lyricsVideoUrl?: string;
```

Add the same validation loop after the `referenceLinks` check (after line 57), then add to `writeClient.create({…})` (after the `referenceLinks:` mapping):

```ts
    musicalReferenceUrl: body.musicalReferenceUrl?.trim() || undefined,
    lyricsVideoUrl: body.lyricsVideoUrl?.trim() || undefined,
```

Also extend the GET projection (line 26) to include `musicalReferenceUrl, lyricsVideoUrl,`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verify**

In `npm run dev`, edit a song as a manager: set a lyrics URL, save, reload the song page, confirm the "Versión con letra" card now appears.

- [ ] **Step 7: Commit**

```bash
git add app/components/EditSongButton.tsx app/api/content/posts/[id]/route.ts app/api/content/posts/route.ts
git commit -m "feat(song): edit musical & lyrics reference URLs"
```

---

## Self-Review

**Spec coverage:**
- Data model (two url fields, legacy kept) → Task 1.
- Import dry-run + reconcile + field policy + tag cleanup → Tasks 2–4.
- Practicar Música/Letras with fallback → Tasks 5–6.
- Two-card display → Task 7.
- Editor maintainability → Task 8.
- Testing (normalize/match/tag/playlist) → Tasks 2 & 5; manual dry-run → Task 3/4.

**Type consistency:** `pickPracticeVideoUrl(song, mode)`, `matchRow`, `computeFieldUpdates`, `mergeTagNames`, `normalizeForMatch` used with the same signatures everywhere. `set._tagNames` produced in Task 2 and consumed in Task 4. `musicalReferenceUrl`/`lyricsVideoUrl` spelled identically across schema, type, GROQ, API, UI.

**Notes / risks:**
- Existing non-catalog songs keep working via the legacy fallback in Tasks 5 & 7.
- The dry-run (Task 3, manual gate) must be eyeballed before `--apply` (Task 4).
- `node scripts/import-catalog.mjs` requires `SANITY_WRITE_TOKEN` in `.env.local`.
