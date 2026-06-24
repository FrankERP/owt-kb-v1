# Multi-author references + filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model song authors as reference documents (like tags) so songs can have multiple authors and be filtered by author, while keeping `post.author` as an auto-maintained denormalized display string.

**Architecture:** New `author` doc type + `post.authors[]` references (source of truth). A one-shot gated migration converts each post's stored `author` string into author docs+refs using a two-map canonicalization pipeline. Read UI (song-page chips, `/author` pages) reads `authors[]`; the API routes recompute the denormalized `author` string from `authorIds`. Mirrors the existing `tag` system throughout.

**Tech Stack:** Next.js App Router (TS), Sanity (`next-sanity`), plain ESM `.mjs` for scripts + the shared slugify, Vitest, Tailwind.

## Global Constraints

- Node 22; UI copy is **Spanish**; commit messages contain **NO** Co-Authored-By / AI-attribution trailer.
- Palette: navy `#001f3f`/`#00162e`, cyan `#00bfff`, muted `#C8D8EB`; reuse `font-label`/`font-body`/`font-display`.
- `authors[]` is the source of truth; `post.author` is a derived display string the API routes recompute. Routes branch on `if (body.authorIds != null)` → recompute author+authors and IGNORE any submitted `author`; else legacy `author` handling untouched.
- **Phase order (do not reorder):** (1) schema → (2) migration apply → (3) read UI → (4) editor + API. Steps 3–4 must not ship before step 2.
- Canonicalization pipeline (verified against live data): `dedupeKey(raw) = ALIAS[normalizeForMatch(raw)] ?? normalizeForMatch(raw)`; `canonicalName(raw) = KEY_CANONICAL[dedupeKey(raw)] ?? deterministicPick(dedupeKey)`. `ALIAS = {"hillsong yf":"hillsong young free","bethel":"bethel music"}`; `KEY_CANONICAL = {"hillsong young free":"Hillsong Young & Free","bethel music":"Bethel Music","en espiritu y en verdad":"En Espíritu y En Verdad"}`; `deterministicPick` = most-frequent raw spelling (ties → lexicographically smallest).
- Expected migration outcome (verified): **35 author docs**, **18** recomputed display strings, idempotent (patches only). Migration NEVER rewrites slugs, never touches body/audio/chords/tags/links.
- `normalizeForMatch` **deletes** punctuation (`Hillsong Y&F` → `hillsong yf`). The shared `slugifyAuthor` lives at `app/utils/slugifyAuthor.mjs` and is imported by BOTH the authors route and the migration.
- Tests: Vitest (`npm run test`). Sanity reads/writes via `.env.local` (`NEXT_PUBLIC_SANITY_*`, `SANITY_WRITE_TOKEN`); load it with `dotenv.config({ path: ".env.local" })` in scripts.
- The catalog working dir is `/Users/frankrocha/Downloads/ContentUpdateProject` (`oasis-songs.json`).

---

### Task 1: Schema — `author` type, `post.authors[]`, interface, preview fix

**Files:**
- Create: `sanity/schemas/author.ts`
- Modify: `sanity/schema.ts`
- Modify: `sanity/schemas/post.ts` (add `authors` field after the `tags` field; fix preview; drop dead import line 1)
- Modify: `app/utils/interface.tsx` (Post + new Author interface)

**Interfaces:**
- Produces: `author` doc type (`name`, `slug`); `post.authors` = array of references to `author`; `Post.authors?: Array<{ _id: string; name: string; slug: { current: string } }>`.

- [ ] **Step 1: Create the author schema**

Create `sanity/schemas/author.ts` (mirror `sanity/schemas/tag.ts`):

```ts
import { defineType } from "sanity";

export const author = defineType({
	name: "author",
	title: "Author",
	type: "document",
	fields: [
		{
			name: "name",
			title: "Author Name",
			type: "string",
		},
		{
			name: "slug",
			title: "Slug",
			type: "slug",
			options: {
				source: "name",
				maxLength: 96,
			},
		},
	],
});
```

- [ ] **Step 2: Register it in the schema**

In `sanity/schema.ts`, add the import after the `tag` import and add `author` to the `types` array:

```ts
import { author } from './schemas/author';
```
and change the types array to include `author` right after `tag`:
```ts
  types: [post, tag, author, featuredSongs, saturdaySongs, saturdayRole, sundayRole, teamMembers, specialRole, loginEvent, setlistProposal],
```

- [ ] **Step 3: Add `authors[]` to post, fix preview, drop dead import**

In `sanity/schemas/post.ts`:

(a) delete line 1 `import { title } from "process";` (dead import).

(b) Add a new field immediately after the `tags` field's closing `},` (the field whose `of` references `{ type: "tag" }`):

```ts
		{
			name: "authors",
			title: "Authors",
			type: "array",
			of: [
				{
					type: "reference",
					to: [{ type: "author" }],
				},
			],
		},
```

(c) Fix the preview to omit the dash when author is blank. Replace the `prepare` body:

```ts
		prepare(selection:any) {
			const {title, author} = selection;
			return {
				title: author ? `${title} - ${author}` : title,
			};
		}
```

- [ ] **Step 4: Extend the interfaces**

In `app/utils/interface.tsx`, add to the `Post` interface after the `tags: Array<Tag>;` line:

```ts
  authors?: Array<Author>;
```

and add a new interface after the `Tag` interface:

```ts
export interface Author {
  name: string;
  slug: { current: string };
  _id: string;
  postCount?: number;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Deploy schema**

The two new doc relationships are additive and the Content Lake is schemaless — no deploy is required for the migration to write `author` docs. Use the `sanity:deploy-schema` skill only if you want the fields visible in Studio. (Controller handles deploy separately; do not block on it.)

- [ ] **Step 7: Commit**

```bash
git add sanity/schemas/author.ts sanity/schema.ts sanity/schemas/post.ts app/utils/interface.tsx
git commit -m "feat(author): add author document type and post.authors references"
```

---

### Task 2: Shared `slugifyAuthor` helper + tests

**Files:**
- Create: `app/utils/slugifyAuthor.mjs`
- Test: `app/utils/__tests__/slugifyAuthor.test.mjs`

**Interfaces:**
- Produces: `slugifyAuthor(name: string): string` — diacritic-transliterating, lowercased, `&`→space, non-alphanumerics→`-`, collapsed. Imported by the authors route AND the migration.

- [ ] **Step 1: Write the failing test**

Create `app/utils/__tests__/slugifyAuthor.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { slugifyAuthor } from "../slugifyAuthor.mjs";

describe("slugifyAuthor", () => {
  it("transliterates diacritics (NFD), not deletes them", () => {
    expect(slugifyAuthor("Un Corazón")).toBe("un-corazon");
    expect(slugifyAuthor("En Espíritu y En Verdad")).toBe("en-espiritu-y-en-verdad");
  });
  it("collapses & and repeated separators to a single dash", () => {
    expect(slugifyAuthor("Hillsong Young & Free")).toBe("hillsong-young-free");
  });
  it("lowercases and trims edge dashes", () => {
    expect(slugifyAuthor("  Chris Tomlin  ")).toBe("chris-tomlin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- slugifyAuthor`
Expected: FAIL — module `../slugifyAuthor.mjs` not found.

- [ ] **Step 3: Implement the helper**

Create `app/utils/slugifyAuthor.mjs`:

```js
export function slugifyAuthor(name) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip combining marks: á -> a
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")       // any run of non-alphanumerics -> one dash
    .replace(/^-+|-+$/g, "")           // trim edge dashes
    .slice(0, 96);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- slugifyAuthor`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/slugifyAuthor.mjs app/utils/__tests__/slugifyAuthor.test.mjs
git commit -m "feat(author): shared slugifyAuthor helper with tests"
```

---

### Task 3: Author canonicalization + parse pure lib + tests

**Files:**
- Create: `scripts/lib/author-canon.mjs`
- Test: `scripts/lib/__tests__/author-canon.test.mjs`

**Interfaces:**
- Consumes: `normalizeForMatch` from `scripts/lib/catalog-reconcile.mjs`.
- Produces:
  - `parseAuthors(str: string): string[]`
  - `dedupeKey(raw: string): string`
  - `buildFreq(allRaws: string[]): Map<string, Map<string,number>>`
  - `canonicalName(raw: string, freq: Map): string`
  - exported `ALIAS`, `KEY_CANONICAL`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/author-canon.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { parseAuthors, dedupeKey, buildFreq, canonicalName } from "../author-canon.mjs";

describe("parseAuthors", () => {
  it("splits on commas only; trims; drops empties; keeps & / y / Y names whole", () => {
    expect(parseAuthors("Matt Redman, En Espíritu Y En Verdad")).toEqual(["Matt Redman", "En Espíritu Y En Verdad"]);
    expect(parseAuthors("Hillsong Y&F")).toEqual(["Hillsong Y&F"]);
    expect(parseAuthors("Majo y Dan")).toEqual(["Majo y Dan"]);
    expect(parseAuthors("Marcos Witt, Marco Barrientos, Marcos Vidal")).toEqual(["Marcos Witt", "Marco Barrientos", "Marcos Vidal"]);
    expect(parseAuthors("")).toEqual([]);
    expect(parseAuthors(undefined)).toEqual([]);
  });
});

describe("dedupeKey", () => {
  it("collapses spelling aliases via ALIAS (after normalize deletes '&')", () => {
    expect(dedupeKey("Hillsong Y&F")).toBe("hillsong young free");
    expect(dedupeKey("Hillsong Young & Free")).toBe("hillsong young free");
    expect(dedupeKey("Bethel")).toBe("bethel music");
    expect(dedupeKey("Bethel Music")).toBe("bethel music");
  });
  it("collapses case/accent variants without an ALIAS entry", () => {
    expect(dedupeKey("En Espíritu Y En Verdad")).toBe(dedupeKey("En Espíritu y En Verdad"));
  });
  it("keeps genuinely distinct similar names apart", () => {
    const keys = new Set(["Marcos Witt", "Marco Barrientos", "Marcos Vidal"].map(dedupeKey));
    expect(keys.size).toBe(3);
  });
});

describe("canonicalName", () => {
  it("pins canonical display names per dedupeKey (no regression of the canonical-spelled member)", () => {
    const freq = buildFreq(["Hillsong Y&F", "Hillsong Y&F", "Hillsong Young & Free"]);
    expect(canonicalName("Hillsong Y&F", freq)).toBe("Hillsong Young & Free");
    expect(canonicalName("Hillsong Young & Free", freq)).toBe("Hillsong Young & Free");
  });
  it("pins EEYEV to the lowercase form regardless of input spelling", () => {
    const freq = buildFreq(["En Espíritu Y En Verdad", "En Espíritu y En Verdad"]);
    expect(canonicalName("En Espíritu Y En Verdad", freq)).toBe("En Espíritu y En Verdad");
    expect(canonicalName("En Espíritu y En Verdad", freq)).toBe("En Espíritu y En Verdad");
  });
  it("falls back to most-frequent raw for unmapped multi-spelling keys (tie -> lexicographic)", () => {
    const freq = buildFreq(["Foo Bar", "Foo  Bar", "Foo Bar"]); // both normalize to same key
    expect(canonicalName("Foo Bar", freq)).toBe("Foo Bar");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- author-canon`
Expected: FAIL — module `../author-canon.mjs` not found.

- [ ] **Step 3: Implement the lib**

Create `scripts/lib/author-canon.mjs`:

```js
import { normalizeForMatch } from "./catalog-reconcile.mjs";

export const ALIAS = {
  "hillsong yf": "hillsong young free",
  "bethel": "bethel music",
};

export const KEY_CANONICAL = {
  "hillsong young free": "Hillsong Young & Free",
  "bethel music": "Bethel Music",
  "en espiritu y en verdad": "En Espíritu y En Verdad",
};

export function parseAuthors(str) {
  return (str ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function dedupeKey(raw) {
  const n = normalizeForMatch(raw);
  return ALIAS[n] ?? n;
}

export function buildFreq(allRaws) {
  const freq = new Map();
  for (const raw of allRaws) {
    const key = dedupeKey(raw);
    if (!freq.has(key)) freq.set(key, new Map());
    const m = freq.get(key);
    m.set(raw, (m.get(raw) ?? 0) + 1);
  }
  return freq;
}

export function canonicalName(raw, freq) {
  const key = dedupeKey(raw);
  if (KEY_CANONICAL[key]) return KEY_CANONICAL[key];
  const counts = freq.get(key) ?? new Map([[raw, 1]]);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- author-canon`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/author-canon.mjs scripts/lib/__tests__/author-canon.test.mjs
git commit -m "feat(author): canonicalization + parse library with tests"
```

---

### Task 4: Migration runner (dry-run report + apply) and run it

**Files:**
- Create: `scripts/migrate-authors.mjs`

**Interfaces:**
- Consumes: `author-canon.mjs`, `catalog-reconcile.mjs` (`matchRow`), `app/utils/slugifyAuthor.mjs`, `.env.local`, `oasis-songs.json`.
- Produces: `author` docs + `post.authors[]` refs + recomputed `post.author` strings in Sanity.

- [ ] **Step 1: Write the runner (Phase A dry-run + Phase B apply)**

Create `scripts/migrate-authors.mjs`:

```js
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
```

- [ ] **Step 2: Run the dry-run**

Run: `node scripts/migrate-authors.mjs`
Expected: prints `AUTHOR DOCS … 35 (expected 35)`, `total changed: 18`, and a divergence list with `[ADD] Somos Libres`, `[ADD] Vamos A Cantar`, `[CONFLICT] Dios Está Aquí`. Nothing written. **STOP and have the controller review this output with the user before Step 3.**

- [ ] **Step 3: Record approved additions (after operator OK)**

Once the operator approves the 2 additions, uncomment the two `APPROVED_ADDITIONS` entries in the script exactly as shown (keeping `Dios Está Aquí` OUT — stored value kept). Commit this as part of Step 5.

- [ ] **Step 4: Apply (one-shot, gated)**

Run: `node scripts/migrate-authors.mjs --apply`
Expected: `Applied: 35 author docs, 127 posts patched.`
Then verify:
```bash
node --input-type=module -e 'import("dotenv/config");' 2>/dev/null; node --input-type=module -e '
import dotenv from "dotenv"; dotenv.config({ path: ".env.local" });
import { createClient } from "next-sanity";
const c = createClient({projectId:process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,dataset:process.env.NEXT_PUBLIC_SANITY_DATASET,apiVersion:"2024-07-23",useCdn:false,token:process.env.SANITY_WRITE_TOKEN});
console.log("author docs:", await c.fetch(`count(*[_type=="author"])`));
console.log("posts with authors[]:", await c.fetch(`count(*[_type=="post" && count(authors)>0])`));
'
```
Expected: `author docs: 35`, `posts with authors[]: 127`. **Run --apply exactly once** (re-running patches the same posts idempotently, but only do so deliberately).

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-authors.mjs
git commit -m "feat(author): one-shot migration of stored author strings to author refs"
```

---

### Task 5: `/api/content/authors` route (GET list + POST create)

**Files:**
- Create: `app/api/content/authors/route.ts`

**Interfaces:**
- Consumes: `slugifyAuthor` from `@/app/utils/slugifyAuthor.mjs`.
- Produces: `GET /api/content/authors` → `[{_id,name,slug}]`; `POST` `{name}` → created author `{201}`.

- [ ] **Step 1: Create the route (mirror `app/api/content/tags/route.ts`)**

Create `app/api/content/authors/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { slugifyAuthor } from "@/app/utils/slugifyAuthor.mjs";

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authors = await serverClient.fetch(
    `*[_type == "author"] | order(name asc) { _id, name, slug }`
  );
  return NextResponse.json(authors);
}

export async function POST(req: NextRequest) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { name } = await req.json() as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const slug = slugifyAuthor(name.trim());
  const author = await writeClient.create({
    _type: "author",
    name: name.trim(),
    slug: { _type: "slug", current: slug },
  });
  return NextResponse.json(author, { status: 201 });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the `@/app/utils/slugifyAuthor.mjs` import resolves from a route — the import-path validation called out in the spec).

- [ ] **Step 3: Commit**

```bash
git add app/api/content/authors/route.ts
git commit -m "feat(author): GET/POST /api/content/authors route"
```

---

### Task 6: Song page — fetch `authors[]` and render clickable chips

**Files:**
- Modify: `app/(client)/posts/[slug]/page.tsx` (GROQ projection; author chips in the hero)

**Interfaces:**
- Consumes: `post.authors` (Task 1).

- [ ] **Step 1: Add `authors[]` to the GROQ projection**

In `app/(client)/posts/[slug]/page.tsx`, in the `getPost` query, after the `author,` line add:

```
      authors[] -> { _id, slug, name },
```

- [ ] **Step 2: Render author chips in the hero**

In the hero section, the author is rendered as:

```tsx
          {post?.author && (
            <p className="font-body text-lg text-[#C8D8EB]/60 mb-8">
              {post.author}
            </p>
          )}
```

Replace that block with: chips when `authors[]` exists, falling back to the plain string otherwise:

```tsx
          {post?.authors && post.authors.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 mb-8">
              {post.authors.map((a, i) => (
                <span key={a._id} className="font-body text-lg text-[#C8D8EB]/60">
                  <Link href={`/author/${a.slug.current}`} className="hover:text-[#00bfff] transition-colors">
                    {a.name}
                  </Link>
                  {i < post.authors!.length - 1 && <span className="text-[#C8D8EB]/30">,</span>}
                </span>
              ))}
            </div>
          ) : post?.author ? (
            <p className="font-body text-lg text-[#C8D8EB]/60 mb-8">{post.author}</p>
          ) : null}
```

(`Link` is already imported in this file.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verify (controller)**

Start `npm run dev`, open a multi-author song (e.g. *Cordero Y León*) — authors render as separate clickable chips linking to `/author/[slug]`.

- [ ] **Step 5: Commit**

```bash
git add "app/(client)/posts/[slug]/page.tsx"
git commit -m "feat(author): clickable author chips on the song page"
```

---

### Task 7: `/author` index + `/author/[slug]` pages

**Files:**
- Create: `app/components/AuthorSearchList.tsx`
- Create: `app/(client)/author/page.tsx`
- Create: `app/(client)/author/[slug]/page.tsx`

**Interfaces:**
- Consumes: `Author` interface (Task 1), `SongSearchList` (existing).

- [ ] **Step 1: Create the author index list component**

Create `app/components/AuthorSearchList.tsx` (a simpler sibling of `TagSearchList` — no pinned section):

```tsx
"use client";

import { useState, useMemo } from "react";
import { Author } from "../utils/interface";
import Link from "next/link";

type SortMode = "popular" | "alpha";

export default function AuthorSearchList({ authors }: { authors: Author[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const isSearching = query.trim().length > 0;

  const totalSongs = useMemo(
    () => authors.reduce((sum, a) => sum + (a.postCount ?? 0), 0),
    [authors]
  );

  const grid = useMemo(() => {
    const base = isSearching
      ? authors.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
      : authors;
    return [...base].sort((a, b) =>
      sort === "alpha" ? a.name.localeCompare(b.name) : (b.postCount ?? 0) - (a.postCount ?? 0)
    );
  }, [query, sort, authors, isSearching]);

  return (
    <div className="mx-auto max-w-7xl px-6 pt-8 pb-20 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-baseline gap-4 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{authors.length}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">artistas</span>
          </div>
          <span className="text-gray-700 text-sm">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-3xl text-[#00bfff]">{totalSongs}</span>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">canciones</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 overflow-hidden">
            {(["popular", "alpha"] as SortMode[]).map((mode, i) => (
              <button key={mode} onClick={() => setSort(mode)}
                className={`px-3 py-1.5 font-label text-[10px] uppercase tracking-widest transition-colors duration-150 ${i > 0 ? "border-l border-[#003572]/20 dark:border-[#00bfff]/15" : ""} ${sort === mode ? "bg-[#00bfff]/15 text-[#00bfff]" : "text-gray-500 hover:text-gray-300 hover:bg-[#00bfff]/5"}`}>
                {mode === "popular" ? "Popular" : "A–Z"}
              </button>
            ))}
          </div>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar..."
            className="font-label px-3 py-1.5 rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 bg-transparent focus:outline-none focus:border-[#00bfff] text-sm placeholder:text-gray-600 transition-colors w-36 sm:w-48" />
        </div>
      </div>

      {grid.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {grid.map((a) => (
            <Link key={a._id} href={`/author/${a.slug.current}`}>
              <div className="relative group overflow-hidden rounded-xl border border-[#003572]/20 dark:border-[#00bfff]/10 p-4 hover:border-[#003572]/50 dark:hover:border-[#00bfff]/40 hover:shadow-lg hover:shadow-[#00bfff]/10 transition-all duration-200 cursor-pointer">
                <h3 className="font-display text-sm mb-1 group-hover:text-[#00bfff] transition-colors duration-200 leading-snug">
                  {a.name}
                </h3>
                <p className="font-label text-[10px] uppercase tracking-widest text-gray-600">
                  {a.postCount ?? 0} {(a.postCount ?? 0) === 1 ? "canción" : "canciones"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-24 text-gray-600">
          <p className="font-label text-sm uppercase tracking-widest">No se encontraron artistas</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the author index page (mirror `app/(client)/tag/page.tsx`)**

Create `app/(client)/author/page.tsx`:

```tsx
import Navbar from "@/app/components/Navbar";
import AuthorSearchList from "@/app/components/AuthorSearchList";
import { Author } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getAllAuthors() {
  const query = `
    *[_type == "author"] | order(name asc) {
      name,
      slug,
      _id,
      "postCount": count(*[_type == "post" && ^._id in authors[]._ref])
    }
  `;
  return await client.fetch(query);
}

export const revalidate = 60;

const page = async () => {
  const authors: Author[] = await getAllAuthors();
  return (
    <div>
      <Navbar title="Artistas" tags schedule />
      <AuthorSearchList authors={authors} />
    </div>
  );
};

export default page;
```

- [ ] **Step 3: Create the per-author page (mirror `app/(client)/tag/[slug]/page.tsx`)**

Create `app/(client)/author/[slug]/page.tsx` — identical to the tag `[slug]` page except the GROQ references an author by slug and the hero copy:

```tsx
import Navbar from "@/app/components/Navbar";
import SongSearchList from "@/app/components/SongSearchList";
import { Post } from "@/app/utils/interface";
import { client } from "@/sanity/lib/client";

async function getPostsByAuthor(slug: string) {
  const query = `
    *[_type == "post" && references(*[_type == "author" && slug.current == $authorSlug]._id)] {
      _id, _createdAt, title, author, slug, publishDate, excerpt, timeSig, bpm, key,
      tags[] -> { _id, slug, name }
    }
  `;
  return await client.fetch(query, { authorSlug: slug });
}

async function getAuthorName(slug: string) {
  return client.fetch(`*[_type=="author" && slug.current==$slug][0].name`, { slug });
}

export const revalidate = 60;

interface Params { params: Promise<{ slug: string }>; }

const page = async ({ params }: Params) => {
  const { slug } = await params;
  const [posts, name]: [Array<Post>, string | null] = await Promise.all([
    getPostsByAuthor(slug),
    getAuthorName(slug),
  ]);

  return (
    <div>
      <Navbar title={name ?? slug} tags schedule />
      <div className="relative overflow-hidden border-b border-[#003572]/15 dark:border-[#00bfff]/10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-32 bg-[#00bfff]/10 rounded-full blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 py-10 flex flex-col items-center gap-2 text-center">
          <p className="font-display text-4xl sm:text-5xl text-[#00bfff] leading-none">{name ?? slug}</p>
          <p className="font-label text-xs uppercase tracking-widest text-gray-500">
            {posts.length} {posts.length === 1 ? "canción" : "canciones"}
          </p>
        </div>
      </div>
      <div className="pt-8">
        <SongSearchList posts={posts} />
      </div>
    </div>
  );
};

export default page;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verify (controller)**

In `npm run dev`: `/author` lists all 35 artists with counts; clicking one opens `/author/[slug]` showing that artist's songs; a multi-artist song appears under each of its artists.

- [ ] **Step 6: Commit**

```bash
git add app/components/AuthorSearchList.tsx "app/(client)/author/page.tsx" "app/(client)/author/[slug]/page.tsx"
git commit -m "feat(author): /author index and /author/[slug] filter pages"
```

---

### Task 8: API routes accept `authorIds` and recompute the denormalized string

**Files:**
- Modify: `app/api/content/posts/route.ts` (POST: `authorIds` branch + slug from recomputed string; GET: add `authors[]->`)
- Modify: `app/api/content/posts/[id]/route.ts` (PATCH: `authorIds` branch)

**Interfaces:**
- Consumes: client editors send `authorIds?: string[]` (Tasks 9–10).
- Produces: posts written with `authors` refs + a recomputed `author` string when `authorIds` is present.

- [ ] **Step 1: Add a shared author-name lookup + POST handling**

In `app/api/content/posts/route.ts`:

(a) Add to the GET projection (after `author,`):
```
      authors[]->{ _id, name },
```

(b) Add to the POST body type (after `tagIds?: string[];`):
```ts
    authorIds?: string[];
```

(c) Before the slug is computed, resolve the denormalized author string from `authorIds` when present. Replace the slug + create block. Current:
```ts
  const slugBase = `${body.title}-${body.author ?? ""}`.toLowerCase()
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 96);

  const doc = await writeClient.create({
    _type: "post",
    title: body.title.trim(),
    author: body.author?.trim() ?? "",
```
Replace with:
```ts
  let authorStr = body.author?.trim() ?? "";
  let authorRefs: Array<{ _type: "reference"; _ref: string; _key: string }> = [];
  if (body.authorIds != null) {
    const names: Array<{ _id: string; name: string }> = await writeClient.fetch(
      `*[_type=="author" && _id in $ids]{ _id, name }`, { ids: body.authorIds }
    );
    const byId = new Map(names.map((n) => [n._id, n.name]));
    authorStr = body.authorIds.map((id) => byId.get(id)).filter(Boolean).join(", ");
    authorRefs = body.authorIds.map((id) => ({ _type: "reference", _ref: id, _key: rng() }));
  }

  const slugBase = `${body.title}-${authorStr}`.toLowerCase()
    .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 96);

  const doc = await writeClient.create({
    _type: "post",
    title: body.title.trim(),
    author: authorStr,
    authors: authorRefs,
```
(Leave the rest of the `create({...})` object unchanged.)

- [ ] **Step 2: Add PATCH handling in the [id] route**

In `app/api/content/posts/[id]/route.ts`:

(a) Add to the body type (after `tagIds?: string[];`):
```ts
    authorIds?: string[];
```

(b) The current author patch line is:
```ts
  if (body.author    != null) patch.author = body.author.trim();
```
Replace it with the `authorIds`-precedence branch:
```ts
  if (body.authorIds != null) {
    const names: Array<{ _id: string; name: string }> = await writeClient.fetch(
      `*[_type=="author" && _id in $ids]{ _id, name }`, { ids: body.authorIds }
    );
    const byId = new Map(names.map((n) => [n._id, n.name]));
    patch.author = body.authorIds.map((id) => byId.get(id)).filter(Boolean).join(", ");
    patch.authors = body.authorIds.map((id) => ({ _type: "reference", _ref: id, _key: rng() }));
  } else if (body.author != null) {
    patch.author = body.author.trim();
  }
```
(`rng()` already exists in both route files.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/content/posts/route.ts app/api/content/posts/[id]/route.ts
git commit -m "feat(author): routes accept authorIds and recompute denormalized author"
```

---

### Task 9: Admin editor (`SongFormModal`) author multi-select + create

**Files:**
- Modify: `app/components/admin/SongFormModal.tsx` (FormState, blankForm, songToForm, buildPayload, the Artista field → author multi-select with create)
- Modify: `app/components/admin/ContentPanel.tsx` (load authors, pass `allAuthors` + `canCreateAuthor`)
- Modify: `app/components/admin/SetlistEditor.tsx` (same props, mirroring how it passes tags)

**Interfaces:**
- Consumes: `GET/POST /api/content/authors`; submits `authorIds: string[]` to the posts routes.

- [ ] **Step 1: FormState + mappers**

In `app/components/admin/SongFormModal.tsx`:
- In `FormState`, replace `author: string;` with `authorIds: string[];`.
- In `blankForm()`, replace `author: ""` with `authorIds: []`.
- In `songToForm(song)`, replace `author: song.author ?? ""` with `authorIds: song.authors?.map((a: any) => a._id) ?? []`.
- In `buildPayload(form)`, replace `author: form.author,` with `authorIds: form.authorIds,`.
- Add an author multi-select component identical in structure to the existing tag selector. Add the props `allAuthors: SongTag[]` and `canCreateAuthor: (name: string) => Promise<SongTag | null>` to the component signature (reuse the `SongTag` shape `{_id,name,slug}`), plus local state mirroring tags: `const [localAuthors, setLocalAuthors] = useState(allAuthors)`, `const [authorSearch, setAuthorSearch] = useState("")`, `const [creatingAuthor, setCreatingAuthor] = useState(false)`, a `toggleAuthor(id)` (same shape as `toggleTag`), and a `handleCreateAuthor` (copy of `handleCreateTag` using `canCreateAuthor`/`authorSearch`/`setLocalAuthors`/`authorIds`).
- Replace the "Artista" text input block:
```tsx
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Artista</label>
          <input className={inputCls} value={form.author} onChange={set("author")} placeholder="Artista / Banda" />
        </div>
```
with an author picker mirroring the tags block (search input that also offers "+ Crear" when no exact match, and toggle chips for `localAuthors`), writing to `form.authorIds`.

- [ ] **Step 2: Parent wiring (ContentPanel + SetlistEditor)**

In both `ContentPanel.tsx` and `SetlistEditor.tsx`, wherever they currently fetch `allTags` and define `canCreateTag` (passing them to `SongFormModal`), add the analogous `allAuthors` (from `GET /api/content/authors`) and `canCreateAuthor` (POST to `/api/content/authors`, same shape as the tag creator), and pass both as the new props.

- [ ] **Step 3: Typecheck + manual verify**

Run: `npx tsc --noEmit` (expect no errors). Then in `npm run dev` as a manager: open the admin song form, confirm the author multi-select lists authors, lets you toggle several, create a new one, and that saving persists `authors[]` and the recomputed `author` string (reload the song page; chips reflect the selection).

- [ ] **Step 4: Commit**

```bash
git add app/components/admin/SongFormModal.tsx app/components/admin/ContentPanel.tsx app/components/admin/SetlistEditor.tsx
git commit -m "feat(author): admin song form author multi-select with create"
```

---

### Task 10: Public editor (`EditSongButton`) author multi-select (filter+toggle only)

**Files:**
- Modify: `app/components/EditSongButton.tsx` (FormState, postToForm, buildPayload, Artista field → author multi-select; load authors)

**Interfaces:**
- Consumes: `GET /api/content/authors`; submits `authorIds` to `PATCH /api/content/posts/[id]`.

- [ ] **Step 1: FormState + mappers + picker**

In `app/components/EditSongButton.tsx`:
- In `FormState`, replace `author: string;` with `authorIds: string[];`.
- In `postToForm(post)`, replace `author: post.author ?? ""` with `authorIds: post.authors?.map((a) => a._id) ?? []`.
- In `buildPayload(form)`, replace `author: form.author, ` with `authorIds: form.authorIds,`.
- Load authors like tags are loaded (lazy `fetch("/api/content/authors")` into `authors` state; mirror the existing `tags`/`tagSearch`/`toggleTag` filter+toggle UI — **no create flow**, matching this editor's tag behavior).
- Replace the free-text "Artista" input with the author filter+toggle picker writing to `form.authorIds`.
- Ensure the song page passes `post.authors` into this component: it already receives `post` (Task 6 added `authors[]->{_id,slug,name}` to the song-page GROQ), so `postToForm` can read `post.authors`.

- [ ] **Step 2: Typecheck + manual verify**

Run: `npx tsc --noEmit` (expect no errors). In `npm run dev`, open a song as a manager via the inline edit button, confirm the author picker pre-selects the song's current authors, lets you toggle, and saving updates `authors[]` + the recomputed string + the chips.

- [ ] **Step 3: Commit**

```bash
git add app/components/EditSongButton.tsx
git commit -m "feat(author): public song editor author multi-select"
```

---

## Self-Review

**Spec coverage:**
- Data model (`author` type, `post.authors[]`, kept `author` string, interface) → Task 1.
- Shared `slugifyAuthor` (one source, both consumers) → Task 2; consumed in Tasks 4 & 5.
- Canonicalization pipeline (ALIAS/KEY_CANONICAL/deterministicPick, parse) → Task 3.
- Gated migration (stored-string conversion, xlsx divergence surfacing, approved additions, idempotent apply) → Task 4.
- `/api/content/authors` → Task 5.
- Song-page chips + GROQ → Task 6.
- `/author` + `/author/[slug]` (ISR 60, no generateStaticParams) → Task 7.
- Routes `authorIds` branch + GET projection + slug-from-recomputed-string → Task 8.
- Editors: free-text removed, always send `authorIds`, create only in `SongFormModal` → Tasks 9 (admin, with create) & 10 (public, filter+toggle).
- Preview fix + dead-import cleanup → Task 1. TypeGen not wired (interface edit only) → Task 1.

**Phase ordering:** Tasks 1 (schema) → 4 (migrate) → 6/7 (read UI) → 8/9/10 (editor+API) honor the spec's mandated order. Tasks 2/3/5 are leaf utilities/routes with no app-visible effect until consumed.

**Placeholder scan:** the editor Tasks 9/10 describe mirroring the existing tag selector rather than re-pasting its full JSX — acceptable because the source (`SongFormModal.tsx` tag block, `EditSongButton.tsx` tag block) exists in the repo and the deltas (author* names, no-create in EditSongButton) are explicit. Every novel unit (schema, slugify, canon lib, migration, authors route, chips, pages, route branches) has complete code.

**Type consistency:** `authorIds: string[]` is the form/payload field across Tasks 8–10; `authors[]->{_id,name(,slug)}` is the GROQ shape; `slugifyAuthor`, `dedupeKey`, `canonicalName`, `parseAuthors`, `buildFreq` signatures match between Task 3 (definition) and Task 4 (use). `Author` interface (Task 1) used by Task 7.

**Risks:** Task 4 is the only writer to prod and is gated by a dry-run the controller reviews with the user before `--apply`. Tasks 9/10 are the largest; if a reviewer rejects one editor independently they don't block the other.
