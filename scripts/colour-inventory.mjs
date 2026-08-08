// The colour inventory — Child A1 step 1.
//
// Emits EVERY colour decision in `app/**` as stable, sorted JSON. This exists
// because hand-counting the colour surface has been wrong every single time it
// was attempted: three counts in the v23 design, and two more in the parent
// scope spec, each understated it. Downstream children (B: hex + brand-* → tokens,
// C: palette families → roles, D: light counterparts) are sized and driven by THIS
// output, never by a figure written in a document.
//
// IF THE GENERATED OUTPUT DISAGREES WITH ANY FIGURE IN ANY PLANNING DOCUMENT,
// THE OUTPUT WINS. Do not narrow a rule until a count matches a number in prose.
//
// Run:  node scripts/colour-inventory.mjs           # writes the committed artifact
//       node scripts/colour-inventory.mjs --stdout  # prints, writes nothing
//
// The committed artifact is guarded by `app/utils/__tests__/colourInventory.test.ts`,
// which fails when a live scan diverges from it.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripComments, syntaxFor } from "./lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = path.join(REPO_ROOT, "app/utils/__tests__/__fixtures__/colour-inventory.json");

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const GLOB_ROOT = "app";
const EXTENSIONS = new Set([".tsx", ".ts", ".mjs", ".css"]);

/** Named out-of-glob inputs. `tailwind.config.ts` carries a colour literal at :38
 *  and the seven `brand.*` colour keys, but sits outside `app/**`. Recording it
 *  explicitly is what stops "authoritative" from being an overstatement. */
const EXTRA_FILES = ["tailwind.config.ts"];

/** `__tests__` is excluded BY THE GLOB, not seeded as an exempt row — a row must
 *  exist to be dispositioned. Child B's codemod intersects its file set with
 *  `__tests__` separately, so colliding assertions move with the code they assert.
 *
 *  `app/(gallery)` is excluded for a different reason: it is the THEME GALLERY, a
 *  verification surface rather than product colour. Its fixtures render tokens and
 *  existing components in order to demonstrate them, so folding their `brand-*` usages
 *  and swatch literals into the inventory would put them in Children B and C's
 *  migration sets — and a Child B that tokenised the swatch fixtures would leave them
 *  demonstrating nothing.
 *
 *  CONSEQUENCE, stated because it is a real cost: the gallery's colour is unmeasured,
 *  so a fixture must never become a place where product colour hides. Fixtures render
 *  tokens and existing components; they do not introduce new literals. */
const EXCLUDED_TREES = ["__tests__", `app${path.sep}(gallery)`];

function inGlob(rel) {
  if (EXCLUDED_TREES.some((t) => rel.includes(t))) return false;
  return EXTENSIONS.has(path.extname(rel));
}

function walk(dir, acc = []) {
  for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, acc);
    else if (inGlob(rel)) acc.push(rel);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Seeded exemptions — keyed by FILE + VALUE, never by line range.
// A line-keyed seed drifts off its rows on the next unrelated edit, which is the
// same defect the snapshot key exists to avoid.
// ---------------------------------------------------------------------------

const EXEMPT_FILES = new Map([
  [
    "app/utils/emailShell.ts",
    "The email palette is deliberately light. CLAUDE.md records five failed attempts to hold a dark palette against Outlook for Mac.",
  ],
]);

const EXEMPT_VALUES = new Map([
  ["app/(client)/auth/signin/page.tsx|#4285F4", "Google brand mark — a third-party mark that must not be themed"],
  ["app/(client)/auth/signin/page.tsx|#34A853", "Google brand mark — a third-party mark that must not be themed"],
  ["app/(client)/auth/signin/page.tsx|#FBBC05", "Google brand mark — a third-party mark that must not be themed"],
  ["app/(client)/auth/signin/page.tsx|#EA4335", "Google brand mark — a third-party mark that must not be themed"],
  ["app/(client)/layout.tsx|#010b17", "Static viewport themeColor. Child E makes it theme-responsive under parent invariant 17."],
  // NOTE: `appleWebApp.statusBarStyle: "black-translucent"` on both root layouts is
  // theme-dependent but is NOT a colour literal — it is a PWA enum, so no category
  // matches it and no row exists to exempt. Seeding it would leave a value that never
  // matches a row, the defect this file's file+value keying exists to avoid. It is
  // tracked by parent invariant 17 and owned by Child E.
]);

// ---------------------------------------------------------------------------
// Categories, in PRECEDENCE order — each site gets exactly one.
//
// Syntax and location are orthogonal axes, so "most specific wins" cannot
// adjudicate them alone: fill="#4285F4" is bare hex (syntax) AND an SVG attribute
// (location). RULE: LOCATION BEATS SYNTAX, because the migration mechanism follows
// location — an SVG attribute becomes currentColor or rgb(var(…)), a class literal
// becomes a token.
//
// 11 precedes 6 and 5 deliberately: it is strictly narrower, and it is the only
// category routing a site to a VARIABLE RENAME rather than a literal swap.
// ---------------------------------------------------------------------------

const PALETTE_FAMILIES = "gray|red|yellow|green|amber|orange|purple|blue|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|fuchsia|pink|rose|lime";
const COLOUR_UTILITIES = "bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|shadow|outline|decoration|caret|accent";

/** Category 13 is handled separately — it emits three row kinds, not literals. */
const CATEGORIES = [
  { id: 12, name: "css-custom-property-triplet", syntax: /--([a-z-]+):\s*(\d{1,3}\s+\d{1,3}\s+\d{1,3})\s*;/gi, cssOnly: true },
  { id: 11, name: "arbitrary-value-var-brand", syntax: /\[[^\]]*\bvar\(--brand-[a-z-]+\)[^\]]*\]/gi },
  { id: 9, name: "runtime-colour-map", syntax: null }, // resolved by location, below
  // Only COLOUR-shaped values. `fill="none"` is not a colour decision, and counting
  // it inflates the surface Child B is sized against.
  { id: 8, name: "svg-attribute", syntax: /\b(fill|stroke|stop-color|flood-color|lighting-color)=["'](#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|currentColor|white|black)["']/gi },
  { id: 7, name: "inline-style", syntax: null }, // resolved by location, below
  { id: 6, name: "arbitrary-value-colour-no-hash", syntax: /\[[^\]]*\b(?:rgba?|hsla?)\([^\]]*\][^\]]*\]|\[[^\]]*\b(?:rgba?|hsla?)\([^)]*\)[^\]]*\]/gi },
  // Category 5 EXCLUDES rgb( immediately followed by var( — matching the lint rule
  // the parent's §9 prescribes. Without it, tailwind.config.ts's seven
  // `rgb(var(--brand-*) / <alpha-value>)` key values would land here instead of 10.
  { id: 5, name: "rgb-hsl-literal", syntax: /\b(?:rgba?|hsla?)\((?!\s*var\()[^)]*\)/gi },
  { id: 10, name: "retired-brand-colour-key", syntax: new RegExp(`\\b(?:${COLOUR_UTILITIES}|selection:bg|selection:text)-brand-(?:blackout|console|deck|beam|signal|frost|steel)(?:\\/\\d{1,3})?\\b`, "gi") },
  { id: 3, name: "raw-palette-class", syntax: new RegExp(`\\b(?:${COLOUR_UTILITIES})-(?:${PALETTE_FAMILIES})-\\d{2,3}(?:\\/\\d{1,3})?\\b`, "gi") },
  { id: 4, name: "colour-keyword", syntax: new RegExp(`\\b(?:${COLOUR_UTILITIES})-(?:white|black|transparent|current)\\b|\\bcurrentColor\\b|\\btransparent\\b`, "g") },
  { id: 1, name: "bracketed-hex", syntax: /\[#[0-9a-f]{3,8}\](?:\/\d{1,3})?/gi },
  { id: 2, name: "bare-hex", syntax: /#[0-9a-f]{3,8}\b/gi },
];

/** Utilities whose colour lives in an arbitrary value or palette suffix. */
const UTILITY_RE = new RegExp(
  `((?:[a-z-]+:)*)(${COLOUR_UTILITIES})-(?:\\[[^\\]]*\\]|[a-z]+-\\d{2,3}|white|black|transparent|brand-[a-z]+)`,
  "gi",
);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * "Normalised utility" = property + variant chain, colour removed, `dark:` PRESERVED.
 * `dark:border-[#f59e0b]` → `dark:border`, never `border`. Collapsing the variant
 * merges both sides of a light/dark pair; dropping it loses which side is dark.
 */
function normaliseUtility(text, index) {
  UTILITY_RE.lastIndex = 0;
  let m;
  while ((m = UTILITY_RE.exec(text))) {
    if (index >= m.index && index <= m.index + m[0].length) {
      return `${m[1] ?? ""}${m[2]}`;
    }
  }
  return null;
}

function lineOf(src, index) {
  return src.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function classifyLocation(src, index) {
  const before = src.slice(Math.max(0, index - 220), index);
  if (/style=\{\{[^}]*$/.test(before) || /style=\{[^}]*$/.test(before)) return 7;
  // A runtime colour map: an object property whose value IS the colour string —
  // `sunday_role: "#00bfff"`. Requires the colour to open a quoted string that is
  // a property value, which a className ternary does not satisfy.
  if (/(?:[A-Za-z_$][\w$]*|["'][^"']+["'])\s*:\s*["']$/.test(before)) return 9;
  return null;
}

function scanFile(rel) {
  const abs = path.join(REPO_ROOT, rel);
  const raw = readFileSync(abs, "utf8");
  const src = stripComments(raw, { syntax: syntaxFor(rel) });
  const isCss = rel.endsWith(".css");
  const rows = [];
  const claimed = []; // [start, end) spans already assigned, so nothing double-counts

  const overlaps = (a, b) => claimed.some(([s, e]) => a < e && b > s);

  for (const cat of CATEGORIES) {
    if (!cat.syntax) continue;
    if (cat.cssOnly && !isCss) continue;
    cat.syntax.lastIndex = 0;
    let m;
    while ((m = cat.syntax.exec(src))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;

      // Location beats syntax: a bare hex inside an inline style or a runtime map
      // is category 7 or 9, never 2.
      let id = cat.id;
      if (cat.id === 2) {
        // Bare hex only. A BRACKETED value (`[#00bfff]`) is a Tailwind arbitrary
        // value by construction — it is a class literal, never an inline style or
        // a runtime map, so relocating it by surrounding context is always wrong.
        const loc = classifyLocation(src, start);
        if (loc) id = loc;
      }

      const value = m[0];
      claimed.push([start, end]);
      rows.push({
        file: rel,
        category: id,
        categoryName: CATEGORIES.find((c) => c.id === id)?.name ?? cat.name,
        value,
        // Tailwind's opacity modifier sits OUTSIDE the bracket (`bg-[#003572]/50`),
        // so it must be captured separately or the composed-token layer has no input:
        // ~14 composed tokens exist precisely because a pair's two sides differ in
        // ALPHA, not in colour.
        alpha: (value.match(/\/(\d{1,3})$/) ?? [null, null])[1],
        utility: normaliseUtility(src, start),
        carrier: id === 8 ? m[1] : null,
        line: lineOf(src, start), // informational only — see the artifact header
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Category 13 — three row kinds. See A1 step 1.
// ---------------------------------------------------------------------------

const BRAND_CLASS_RE = /\.brand-([a-z][a-z0-9-]*)/gi;
const BRAND_CLASSNAME_RE = /\bbrand-([a-z][a-z0-9-]*)\b/gi;
const NON_COMPOSITING = new Set(["blackout", "console", "deck", "beam", "signal", "frost", "steel", "radius", "duration"]);

function ruleBodies(css) {
  // Every `{ … }` block whose selector names a .brand-* class, with the class list
  // and the body text. Body ordinal is position within the file.
  const out = [];
  const re = /([^{}]*\.brand-[^{}]*)\{([^}]*)\}/g;
  let m;
  let ordinal = 0;
  while ((m = re.exec(css))) {
    const classes = [...m[1].matchAll(/\.brand-([a-z][a-z0-9-]*)/gi)].map((x) => x[1]);
    if (!classes.length) continue;
    out.push({ ordinal: ordinal++, classes: [...new Set(classes)].sort(), body: m[2], line: lineOf(css, m.index) });
  }
  return out;
}

const BODY_HAS_COLOUR = /#[0-9a-f]{3,8}|\brgba?\(|\bhsla?\(/i;

function scanCompositingClasses(files) {
  const selectorCounts = new Map(); // "file|class" -> count
  const classNameCounts = new Map();
  const bodyRows = [];

  for (const rel of files) {
    const raw = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const src = stripComments(raw, { syntax: syntaxFor(rel) });

    if (rel.endsWith(".css")) {
      // NOT line-anchored: `.brand-admin-frame` is indented and nested inside a
      // media query, and a `^\.brand-` scan misses it entirely.
      for (const m of src.matchAll(BRAND_CLASS_RE)) {
        const k = `${rel}|${m[1]}`;
        selectorCounts.set(k, (selectorCounts.get(k) ?? 0) + 1);
      }
      for (const b of ruleBodies(src)) {
        bodyRows.push({
          file: rel,
          kind: "rule-body",
          classes: b.classes,
          ordinal: b.ordinal,
          hasColour: BODY_HAS_COLOUR.test(b.body),
          line: b.line,
        });
      }
    } else {
      for (const m of src.matchAll(BRAND_CLASSNAME_RE)) {
        if (NON_COMPOSITING.has(m[1].split("-")[0])) continue;
        const k = `${rel}|${m[1]}`;
        classNameCounts.set(k, (classNameCounts.get(k) ?? 0) + 1);
      }
    }
  }

  // Which classes carry colour ANYWHERE? Drives selector-row disposition.
  const colourful = new Set();
  for (const r of bodyRows) if (r.hasColour) for (const c of r.classes) colourful.add(c);

  const rows = [];
  for (const [k, count] of [...selectorCounts].sort()) {
    const [file, cls] = k.split("|");
    rows.push({
      file, kind: "selector", class: cls, count,
      // Only kind `selector` carries D/exempt. A class with no colour in ANY of its
      // rule bodies needs no light counterpart.
      disposition: colourful.has(cls) ? "D" : "exempt",
      reason: colourful.has(cls) ? null : "No colour in any rule body — needs no light counterpart",
    });
  }
  for (const [k, count] of [...classNameCounts].sort()) {
    const [file, cls] = k.split("|");
    // className occurrences are USAGE SITES. Never migrated, removed or rewritten —
    // a loose `brand-` match here would make brand-atmosphere a migration target,
    // and it is on <body> in both root layouts.
    rows.push({ file, kind: "className", class: cls, count, disposition: "keep", reason: "Usage site of a compositing class" });
  }
  for (const r of [...bodyRows].sort((a, b) => a.file.localeCompare(b.file) || a.ordinal - b.ordinal)) {
    rows.push({
      file: r.file, kind: "rule-body", classes: r.classes, ordinal: r.ordinal,
      disposition: r.hasColour ? "B" : "exempt",
      reason: r.hasColour ? null : "Rule body declares no colour",
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pair relation — a first-class output.
//
// Three consumers, none able to derive it from per-literal rows: A1 step 3's
// alpha-baked token criterion; Child B, which cannot map a literal to a composed
// token without its partner; and A2's AA-gate step.
// ---------------------------------------------------------------------------

function pairsFor(rows) {
  const byFileUtility = new Map();
  for (const r of rows) {
    if (!r.utility) continue;
    const bare = r.utility.replace(/(^|:)dark:/, "$1").replace(/^dark:/, "");
    const k = `${r.file}|${bare}`;
    if (!byFileUtility.has(k)) byFileUtility.set(k, { light: [], dark: [] });
    (r.utility.startsWith("dark:") ? byFileUtility.get(k).dark : byFileUtility.get(k).light)
      .push({ value: r.value, alpha: r.alpha ?? null });
  }
  const pairs = [];
  for (const [k, v] of [...byFileUtility].sort()) {
    if (!v.light.length || !v.dark.length) continue;
    const [file, utility] = k.split("|");
    const byValue = (a, b) => a.value.localeCompare(b.value);
    const light = [...v.light].sort(byValue);
    const dark = [...v.dark].sort(byValue);
    const alphaSet = (xs) => JSON.stringify([...new Set(xs.map((x) => x.alpha ?? "100"))].sort());
    pairs.push({
      file,
      utility,
      light,
      dark,
      // The single most load-bearing fact about a pair: does it differ in alpha?
      // If so it needs a COMPOSED token — a theme-invariant opacity modifier cannot
      // express "opaque navy in light, 20% cyan in dark".
      alphaDiffers: alphaSet(light) !== alphaSet(dark),
    });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Disposition for literal rows
// ---------------------------------------------------------------------------

function disposition(row) {
  const fileExempt = EXEMPT_FILES.get(row.file);
  if (fileExempt) return { disposition: "exempt", reason: fileExempt };
  const valueKey = `${row.file}|${row.value.replace(/^\[|\]$/g, "").replace(/^#/, "#")}`;
  for (const [k, reason] of EXEMPT_VALUES) {
    if (valueKey.toLowerCase().includes(k.toLowerCase().split("|")[1]) && row.file === k.split("|")[0]) {
      return { disposition: "exempt", reason };
    }
  }
  // Category 4 keywords that are already theme-agnostic are kept, not migrated.
  if (row.category === 4 && /transparent|currentColor/i.test(row.value)) {
    return { disposition: "keep", reason: "Already theme-agnostic" };
  }
  // Child C owns raw palette families and white/black; Child B owns everything else.
  if (row.category === 3 || (row.category === 4 && /-(white|black)\b/.test(row.value))) {
    return { disposition: "C", reason: null };
  }
  return { disposition: "B", reason: null };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  const files = [...walk(GLOB_ROOT), ...EXTRA_FILES].sort();

  const literalRows = [];
  for (const rel of files) {
    for (const r of scanFile(rel)) {
      const d = disposition(r);
      literalRows.push({ ...r, ...d });
    }
  }
  literalRows.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      String(a.utility).localeCompare(String(b.utility)) ||
      a.value.localeCompare(b.value) ||
      a.category - b.category,
  );

  const compositing = scanCompositingClasses(files);
  const pairs = pairsFor(literalRows);

  // The compared summary block — INSIDE the assertion, not a human-only header.
  // No key can express these totals, so they are stated and compared directly.
  const byCategory = {};
  for (const r of literalRows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  const byDisposition = {};
  for (const r of [...literalRows, ...compositing]) {
    byDisposition[r.disposition] = (byDisposition[r.disposition] ?? 0) + 1;
  }

  const summary = {
    literalRows: literalRows.length,
    filesScanned: files.length,
    filesWithColour: new Set(literalRows.map((r) => r.file)).size,
    byCategory,
    byDisposition,
    compositingClasses: new Set(compositing.filter((r) => r.kind === "selector").map((r) => r.class)).size,
    compositingSelectorOccurrences: compositing.filter((r) => r.kind === "selector").reduce((n, r) => n + r.count, 0),
    compositingClassNameOccurrences: compositing.filter((r) => r.kind === "className").reduce((n, r) => n + r.count, 0),
    compositingRuleBodies: compositing.filter((r) => r.kind === "rule-body").length,
    lightCounterpartClasses: new Set(compositing.filter((r) => r.kind === "selector" && r.disposition === "D").map((r) => r.class)).size,
    pairs: pairs.length,
    pairsDifferingInAlpha: pairs.filter((p) => p.alphaDiffers).length,
  };

  return {
    __header: [
      "GENERATED — do not edit by hand. Run `node scripts/colour-inventory.mjs`.",
      "LINE NUMBERS ARE INFORMATIONAL AND MAY BE STALE: they are emitted for humans and",
      "deliberately excluded from the guard's assertion, so an unrelated commit that shifts",
      "a line in a colour-bearing file leaves `npm test` green by design.",
      "Each child consumes the rows dispositioned TO it — never 'everything minus exempt'.",
      "An unrecognised disposition is an error, not a silent inclusion.",
    ],
    summary,
    literalRows,
    compositing,
    pairs,
  };
}

// IMPORTING THIS MODULE MUST BE PURE.
//
// An earlier revision ran `build()` and wrote the artifact at module scope. The
// guard imports this module, so importing it REWROTE the committed artifact the
// guard compares against — making the comparison vacuous and the guard incapable
// of ever failing. Verified by introducing a colour literal and watching the guard
// stay green. Side effects now run only when this file is the entry point.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const inventory = build();
  if (process.argv.includes("--stdout")) {
    console.log(JSON.stringify(inventory, null, 2));
  } else {
    writeFileSync(OUT_PATH, JSON.stringify(inventory, null, 2) + "\n");
    console.error(
      `colour-inventory: ${inventory.summary.literalRows} literal rows, ` +
        `${inventory.summary.compositingClasses} compositing classes, ` +
        `${inventory.summary.pairs} pairs → ${path.relative(REPO_ROOT, OUT_PATH)}`,
    );
  }
}

export { build };
