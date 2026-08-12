// Guard for Child B's token layer (slice B1).
//
// B1 is purely additive: it introduces 18 base roles and 23 composed tokens and
// REMOVES NOTHING, so nothing renders differently. That makes it the one slice
// where a bug is invisible at runtime — the tokens can be wrong, misspelled, or
// missing on one side and the app looks exactly the same until a later batch
// migrates a call site onto them and the colour quietly disappears.
//
// So this file checks the two things the browser cannot tell us yet:
//   1. Every role exists on BOTH sides — a custom property in `brand.css` AND a
//      Tailwind key. A role in only one place compiles to nothing at the use site.
//   2. No key resolves to something other than what its name says.
//
// The naming rule, and why it is not the literal rule the plan wrote:
//
//   The plan bans keys beginning with a utility prefix and lists `accent` among
//   them. Taken literally that bans `accent` and `accent-deep` — the vocabulary's
//   two most-used roles, 806 and 243 rows — so the token layer could not be built
//   at all. It is the same unsatisfiable-gate shape the plan's review found twice.
//
//   The rule's RATIONALE is precise, and it is what this file enforces: a key
//   `P-rest` where `P` is a utility prefix and `rest` is ALSO a key makes the
//   class `P-rest` silently resolve to utility `P` applied to role `rest`, rather
//   than to the key you meant. `border-accent` is the plan's own example: with a
//   key named `accent`, `.border-accent` is the border utility on the accent role,
//   and the key `border-accent` is only reachable as `.border-border-accent`.
//
//   `accent-deep` carries no such hazard: `.accent-deep` would be the accent-color
//   utility on a role named `deep`, and no `deep` key exists, so the class simply
//   is not generated — a build-time absence, not a silent substitution.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BRAND_CSS = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8");
const TW_CONFIG = readFileSync(path.join(REPO_ROOT, "tailwind.config.ts"), "utf8");

/** The Layer-1 roles: 18 from the A1 vocabulary (B1) plus 5 added in B3. Triplets. */
const BASE_ROLES = [
  "accent", "accent-deep",
  "ink", "ink-muted", "ink-dim",
  "surface-base", "surface-raised", "surface-raised-alt", "surface-console", "surface-sunken",
  "warning-fg", "warning-surface", "warning-border",
  "info-fg", "info-surface", "info-border",
  "positive-fg", "negative-fg",
  // B3 additions — see brand.css for why each exists.
  "warning-surface-deep", "info-surface-deep",
  "surface-overlay", "surface-overlay-deep", "surface-overlay-deepest",
  // B4 additions — the vocabulary's "no role here" table, decided.
  "elevation", "surface-lift", "scrim", "on-fill",
  "chart-lead", "chart-bgv", "chart-coro", "chart-especial", "chart-instr", "chart-foh",
  // Child C — the palette families. The stray-key assertion below fails without these.
  "mono-200", "mono-300", "mono-400", "mono-500",
  "mono-600", "mono-700", "mono-800", "negative-faint",
  "negative-soft", "negative-muted", "negative-strong", "negative-border",
  "negative-surface", "negative-surface-deep", "negative-surface-deepest", "warning-faint",
  "warning-soft", "warning-strong", "recency-faint", "recency-soft",
  "recency-strong", "recency-fg", "positive-soft", "positive-strong",
  "positive-deep", "availability-faint", "availability-soft", "availability-strong",
  "availability-fg", "availability-deep", "badge-violet-fg", "badge-violet-deep",
  "badge-azure-fg", "badge-azure-deep",
] as const;

/** The 23 Layer-2 composed tokens. Stored as `--<name>`, alpha already baked in. */
const COMPOSED = [
  "surface-accent-solid", "surface-accent-30", "surface-accent-hover", "edge-accent-subtle",
  "surface-accent-20", "surface-accent-faint", "surface-accent-wash",
  "surface-accent-l20-d60-sunken", "surface-accent-l100-d10", "surface-accent-l40-d20",
  "surface-accent-l30-d25", "surface-accent-l10-d4", "surface-ink-l60-d50",
  "surface-ink-l40-d100-base", "surface-accent-l25-d20", "surface-accent-l25-d15",
  "surface-ink-l70-d50", "surface-accent-l15-d4", "surface-accent-l100-d15",
  "surface-ink-l50-d35", "surface-accent-l5-d3", "surface-accent-l50-d40",
  "surface-accent-l50-d15",

  // Control affordances (2026-08-12). Composed, so alpha-baked and NOT
  // alpha-capable. One declaration each covers both themes because
  // `--ink-muted-rgb` inverts — that is the role layer doing its job.
  "placeholder",
  "edge-control",
] as const;

const UTILITY_PREFIXES = [
  "bg", "text", "border", "ring", "divide", "from", "via", "to", "fill", "stroke",
  "placeholder", "shadow", "outline", "decoration", "caret", "accent",
];

const css = stripComments(BRAND_CSS, { syntax: "css" });
const ts = stripComments(TW_CONFIG, { syntax: "js" });

/** Custom properties DECLARED in brand.css, e.g. `--accent-rgb: 0 191 255;`. */
function declaredProps(source: string): Set<string> {
  return new Set([...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

/**
 * The body of `theme.extend.colors`, isolated by brace matching.
 *
 * An earlier revision of this file sliced from `colors: {` to end-of-file and a
 * regex-matched every `key: "value"` line after it. That swept in `fontFamily`,
 * `keyframes` and the rest of the theme — the guard's first run reported `x` and
 * `start` as stray colour keys and `--font-display` as a dangling reference. The
 * block has to be delimited, not merely located.
 */
function coloursBlock(source: string): string {
  const start = source.indexOf("colors: {");
  expect(start, "theme.extend.colors not found").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i);
  }
  throw new Error("unbalanced braces in theme.extend.colors");
}

/**
 * Top-level colour keys, excluding the nested `brand` group — that group is the
 * retired layer and is asserted separately.
 */
function tailwindColourKeys(block: string): Map<string, string> {
  // Drop the nested `brand: { … }` group so its seven keys are not mistaken for roles.
  const flat = block.replace(/brand:\s*\{[^}]*\}/, "");
  const keys = new Map<string, string>();
  for (const m of flat.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?:\s*"([^"]+)"/gim)) {
    keys.set(m[1], m[2]);
  }
  return keys;
}

const DECLARED = declaredProps(css);
const COLOURS = coloursBlock(ts);
const KEYS = tailwindColourKeys(COLOURS);

describe("token layer — every role exists on BOTH sides", () => {
  it.each(BASE_ROLES)("base role `%s` is declared in brand.css as a triplet", (role) => {
    expect(DECLARED.has(`--${role}-rgb`)).toBe(true);
    // A triplet, not a colour: Tailwind's <alpha-value> needs `R G B`, and
    // `rgb(rgb(...) / 0.5)` is invalid and drops the whole declaration.
    const decl = new RegExp(`--${role}-rgb:\\s*(\\d{1,3} \\d{1,3} \\d{1,3});`).exec(css);
    expect(decl, `--${role}-rgb must be a bare "R G B" triplet`).not.toBeNull();
  });

  it.each(BASE_ROLES)("base role `%s` is a Tailwind key and IS alpha-capable", (role) => {
    expect(KEYS.get(role)).toBe(`rgb(var(--${role}-rgb) / <alpha-value>)`);
  });

  it.each(COMPOSED)("composed token `%s` is declared in brand.css", (name) => {
    expect(DECLARED.has(`--${name}`)).toBe(true);
  });

  it.each(COMPOSED)("composed token `%s` is a Tailwind key and is NOT alpha-capable", (name) => {
    // Composed tokens bake their own alpha. Emitting `<alpha-value>` here would
    // produce `rgb(rgb(var(--x) / 0.2) / <alpha>)` — invalid, silently dropped.
    expect(KEYS.get(name)).toBe(`var(--${name})`);
  });

  it("declares exactly the roles this file knows about — a new one must be registered here", () => {
    const managed = new Set<string>([...BASE_ROLES, ...COMPOSED]);
    const stray = [...KEYS.keys()].filter((k) => !managed.has(k));
    expect(stray, "add the new key to BASE_ROLES or COMPOSED").toEqual([]);
  });
});

describe("token layer — no key resolves to something other than its name", () => {
  // The real hazard, stated as an invariant: for a key `P-rest` where `P` is a
  // utility prefix, `rest` must not also be a key.
  function silentlyShadowed(keys: Iterable<string>): string[] {
    const all = new Set(keys);
    const bad: string[] = [];
    for (const key of all) {
      for (const p of UTILITY_PREFIXES) {
        if (!key.startsWith(`${p}-`)) continue;
        const rest = key.slice(p.length + 1);
        if (all.has(rest)) bad.push(`${key} (".${p}-${rest}" resolves to role "${rest}")`);
      }
    }
    return bad;
  }

  it("no shipped key is silently shadowed by a utility + role of the same spelling", () => {
    expect(silentlyShadowed(KEYS.keys())).toEqual([]);
  });

  it("FIRE-PROOF: the plan's own example is caught", () => {
    // `border-accent` alongside `accent` is exactly the case the plan describes.
    // Without this, the check above is a test nobody has ever seen fail.
    expect(silentlyShadowed(["accent", "border-accent"])).toEqual([
      'border-accent (".border-accent" resolves to role "accent")',
    ]);
  });

  it("does NOT flag `accent-deep`, which has no shadowing key", () => {
    expect(silentlyShadowed(["accent", "accent-deep"])).toEqual([]);
  });
});

describe("token layer — reference integrity from Tailwind into brand.css", () => {
  it("every custom property a Tailwind key references is declared in brand.css", () => {
    // Scoped to the colours block: `fontFamily` legitimately references
    // `--font-display` and friends, which next/font declares, not brand.css.
    const referenced = [...COLOURS.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    const dangling = [...new Set(referenced)].filter((v) => !DECLARED.has(v));
    // An undeclared var() does not error — it drops the whole declaration, so
    // the element renders with no colour at all and nothing says why.
    expect(dangling).toEqual([]);
  });

  it("composed tokens resolve through base roles, never through a retired --brand-*", () => {
    // A composed token pointing at `--brand-beam` would survive B-final's removal
    // of that declaration only by breaking silently.
    for (const name of COMPOSED) {
      const body = new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1] ?? "";
      expect(body, `--${name} has no value`).not.toBe("");
      expect(body, `--${name} must not reference a retired --brand-* colour`)
        .not.toMatch(/--brand-(blackout|console|deck|beam|signal|frost|steel)\b/);
    }
  });

  it("B-FINAL: all seven retired roles are gone from BOTH sides", () => {
    // This assertion was written inverted — "B1 removed nothing" — and flipping it here
    // is the point. Removing a key while a call site still uses it is the single unsafe
    // transition in Child B: `bg-brand-beam` with no `brand.beam` key compiles to nothing
    // and the element loses its colour in silence. So the removal was gated on three
    // generated counts reaching zero first, and this is what the far side looks like.
    for (const retired of ["blackout", "console", "deck", "beam", "signal", "frost", "steel"]) {
      expect(DECLARED.has(`--brand-${retired}`), `--brand-${retired} declaration`).toBe(false);
      expect(COLOURS, `brand.${retired} Tailwind key`).not.toContain(`--brand-${retired}`);
    }
  });

  it("B-FINAL: the four NON-colour --brand-* survive, and are still used", () => {
    // radius and duration are not colour. They are outside the codemod, the lint rule
    // and the vocabulary — and they are why the B-final gate could never demand that
    // category 11 reach zero, since 7 of its 9 rows are these.
    for (const keep of ["radius-panel", "radius-control", "duration-fast", "duration-reveal"]) {
      expect(DECLARED.has(`--brand-${keep}`), `--brand-${keep}`).toBe(true);
    }
    expect(css).toContain("var(--brand-duration-fast)");
  });
});

describe("brand.css rule bodies — B2's invariant, which later slices must not undo", () => {
  // B2 rewrote all 69 colour `rgb(var(--brand-*) …)` occurrences in rule BODIES onto
  // the new roles. The seven `--brand-*` DECLARATIONS deliberately survive until
  // B-final, so a grep for the name alone proves nothing — the invariant is about
  // where they are USED.
  //
  // Without this, a later batch could reintroduce `rgb(var(--brand-beam) / 0.2)` into
  // a rule body, every gate would stay green, and B-final would then remove the
  // declaration underneath it: the body compiles, the declaration is dropped as
  // invalid, and the element silently loses its colour.

  const OCCURRENCE = /rgb\(\s*var\((--[a-z0-9-]+)\)\s*(?:\/\s*([0-9.]+)\s*)?\)/g;
  const RETIRED_COLOUR = /^--brand-(blackout|console|deck|beam|signal|frost|steel)$/;

  /**
   * The rule bodies: everything after BOTH declaration blocks, `:root` and `.light`.
   *
   * An earlier revision sliced from the end of `:root` only, which left `.light`
   * inside "rule bodies". That is harmless today — `.light` carries just
   * `color-scheme` — but Child D fills it with the light halves of these same
   * tokens, and 20 of the 23 composed ones are spelled `rgb(var(--accent-deep-rgb) / a)`.
   * Those would have been counted, pushing the 69 past its pin and failing on
   * CORRECT work. The cheap repair then is to bump the literal, which is the
   * MEASURED_MS_PER_SEND move CLAUDE.md names as the one forbidden fix. So the
   * boundary is drawn where it belongs instead.
   */
  function ruleBodies(source: string): string {
    const rootStart = source.indexOf(":root {");
    expect(rootStart, ":root block not found").toBeGreaterThan(-1);
    const afterRoot = source.indexOf("}", rootStart) + 1;
    const lightStart = source.indexOf(".light", afterRoot);
    if (lightStart === -1) return source.slice(afterRoot);
    return source.slice(source.indexOf("}", lightStart) + 1);
  }

  function occurrences(source: string) {
    return [...source.matchAll(OCCURRENCE)].map((m) => ({ name: m[1], alpha: m[2] ?? "none" }));
  }

  const bodies = ruleBodies(css);

  it("no rule body references a retired --brand-* COLOUR variable", () => {
    const offenders = occurrences(bodies).filter((o) => RETIRED_COLOUR.test(o.name));
    expect(offenders.map((o) => `${o.name}/${o.alpha}`)).toEqual([]);
  });

  it("FIRE-PROOF: a reintroduced beam reference is caught", () => {
    const synthetic = ":root { --x: 1; }\n.a { color: rgb(var(--brand-beam) / 0.2); }";
    const offenders = occurrences(ruleBodies(synthetic)).filter((o) => RETIRED_COLOUR.test(o.name));
    expect(offenders).toEqual([{ name: "--brand-beam", alpha: "0.2" }]);
  });

  it("B-FINAL removed the seven declarations B2 had rewritten the bodies off", () => {
    // B2's invariant — no rule body references a retired colour variable — is what made
    // this removal safe. Asserted above and still asserted, because the ordering is the
    // whole argument: bodies first, declarations last.
    for (const r of ["blackout", "console", "deck", "beam", "signal", "frost", "steel"]) {
      expect(DECLARED.has(`--brand-${r}`), `--brand-${r}`).toBe(false);
    }
  });

  it("counts the migrated occurrences, alpha-free ones included", () => {
    // 69 colour occurrences moved: 65 alpha-bearing plus FOUR alpha-free. A check
    // scoped to alpha-bearing values misses the alpha-free ones entirely — and three
    // of those four were beam, including `.brand-atmosphere`'s own body wash.
    const all = occurrences(bodies).filter((o) => /^--(accent|ink|surface|warning|info|positive|negative)/.test(o.name));
    expect(all.length).toBe(69);
    expect(all.filter((o) => o.alpha === "none").length).toBe(4);
  });

  it("every rgb(var(x)) in a body names a TRIPLET — the rgb(rgb(...)) trap", () => {
    // B2's characteristic defect, and the one the rest of this file could not see.
    // Layer-2 tokens are already complete colours, so `rgb(var(--surface-accent-solid))`
    // expands to `rgb(rgb(0 191 255 / .2))` — not a valid <color>, so the browser drops
    // the whole declaration and the element renders with no colour at all.
    //
    // Nothing else catches it. The retired-reference check above passes, because the
    // name is not a --brand-* one. brandCss.test.ts's dangling-reference guard passes
    // too, because the composed token IS declared. Only the -rgb suffix distinguishes
    // "triplet, safe to wrap" from "colour, must not be wrapped".
    const wrapped = occurrences(bodies).filter((o) => !o.name.endsWith("-rgb"));
    expect(wrapped.map((o) => o.name)).toEqual([]);
  });

  it("FIRE-PROOF: a composed token wrapped in rgb() is caught", () => {
    const synthetic = ":root { --x: 1; }\n.light { color-scheme: light; }\n.a { color: rgb(var(--surface-accent-solid)); }";
    const wrapped = occurrences(ruleBodies(synthetic)).filter((o) => !o.name.endsWith("-rgb"));
    expect(wrapped.map((o) => o.name)).toEqual(["--surface-accent-solid"]);
  });

  it("does NOT touch the non-colour --brand-* four, which are outside B entirely", () => {
    // radius and duration are not colour: the vocabulary leaves them alone, they are
    // outside the codemod and outside the lint rule, and they are why the B-final gate
    // can never demand category 11 reach zero — 7 of its 9 rows are radius.
    for (const keep of ["radius-panel", "radius-control", "duration-fast", "duration-reveal"]) {
      expect(DECLARED.has(`--brand-${keep}`), `--brand-${keep} declaration`).toBe(true);
    }
    // Their USAGE splits across two files, which is why an earlier revision of this
    // test asserted all four appear in brand.css and went red: only the two duration
    // variables are used here. Both radius variables are consumed exclusively from
    // components (signin/page.tsx, DayCard.tsx) — the category-11 rows B never touches.
    expect(bodies).toContain("var(--brand-duration-fast)");
    expect(bodies).toContain("var(--brand-duration-reveal)");
    expect(bodies).not.toContain("var(--brand-radius-");
  });
});

// ---------------------------------------------------------------------------
// The gap that let a "fix" ship inert.
//
// `--placeholder` was declared correctly in both blocks and registered in
// COMPOSED above, so every guard in this file passed. It was keyed in
// tailwind.config.ts as `"placeholder"` — but `theme.extend.colors` keys are
// COLOUR names, not utility names, so that generates `text-text-placeholder`.
// The class actually written at 13 call sites, `placeholder:text-placeholder`,
// matched no colour named `placeholder` and Tailwind emitted NOTHING. No build
// error. Every site fell back to preflight `#9ca3af`, which measured 2.12:1 in
// light — worse than the 3.09:1 the change was fixing.
//
// Arithmetic over the CSS variables cannot see this, because the variables were
// right. These two assertions can.
// ---------------------------------------------------------------------------

const TAILWIND = readFileSync(path.join(REPO_ROOT, "tailwind.config.ts"), "utf8");

/** Every file under a repo-relative directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(REPO_ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(REPO_ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

/** Every key in `theme.extend.colors`. */
function colourKeys(): Set<string> {
  const start = TAILWIND.indexOf("colors: {");
  const block = TAILWIND.slice(start, TAILWIND.indexOf("\n\t\t\t},", start));
  // Quoted OR bare: `placeholder: "var(--placeholder)"` is valid TS and the more
  // natural form, and a parser that only saw quoted keys would make it invisible
  // to both assertions below — turning a guard into a false pass.
  return new Set([...block.matchAll(/^\s*"?([a-z0-9-]+)"?\s*:/gm)].map((m) => m[1]));
}

describe("colour KEYS are colour names, not utility names", () => {
  it("no key begins with a utility prefix", () => {
    // UTILITY_PREFIXES, not a second inline list that drifts from it — but a key
    // is only an offender if it is NOT itself a declared role or token. Several
    // prefixes double as legitimate colour names here: `accent` is the primary
    // brand role, so `accent-deep` is a colour, not a mistake. The mistake this
    // catches is a key naming the utility it will be used with, like the
    // `text-placeholder` that generated `text-text-placeholder` and emitted
    // nothing.
    const declared = new Set<string>([...BASE_ROLES, ...COMPOSED]);
    const offenders = [...colourKeys()].filter(
      (k) => !declared.has(k) && UTILITY_PREFIXES.some((p) => k.startsWith(`${p}-`)),
    );
    expect(
      offenders,
      "A colours key is the COLOUR name — Tailwind prepends the utility itself. " +
        'Keying "text-foo" produces `text-text-foo`, and any class written as ' +
        "`text-foo` then silently emits nothing. Name the key `foo`.",
    ).toEqual([]);
  });

  it("`border-edge-control` resolves, and the sign-in inputs still use it", () => {
    // The border was the OTHER measured failure — 1.46 dark / 1.42 light — and
    // those fields carry no affordance besides it. A rename or typo emits no CSS
    // and the outline silently disappears; the key-prefix check above catches the
    // historical mistake, not this direction.
    expect(colourKeys().has("edge-control")).toBe(true);
    const signin = readFileSync(
      path.join(REPO_ROOT, "app/(client)/auth/signin/page.tsx"), "utf8",
    );
    expect(
      (signin.match(/border-edge-control/g) ?? []).length,
      "both sign-in inputs must carry the token border",
    ).toBeGreaterThanOrEqual(1);
  });

  it("every `placeholder:text-*` class in app/ resolves to a declared colour", () => {
    const keys = colourKeys();
    const used = new Map<string, string[]>();
    for (const file of walk("app")) {
      if (!/\.tsx?$/.test(file) || file.includes("__tests__")) continue;
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const m of src.matchAll(/placeholder:text-([a-z0-9-]+(?:\/[0-9.[\]%]+)?)/g)) {
        const name = m[1].split("/")[0];
        if (!used.has(name)) used.set(name, []);
        used.get(name)!.push(file);
      }
    }
    const unresolved = [...used.entries()].filter(
      ([name]) => !keys.has(name) && !BUILTIN_COLOURS.has(name),
    );
    expect(
      unresolved.map(([n, f]) => `${n} (${f.length} site${f.length > 1 ? "s" : ""}: ${f[0]})`),
      "these placeholder classes name a colour Tailwind does not know, so they " +
        "emit no CSS and the element falls back to preflight grey",
    ).toEqual([]);
  });
});

/** Tailwind's own palette names, which need no key of ours. */
const BUILTIN_COLOURS = new Set([
  "white", "black", "transparent", "current", "inherit",
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow",
  "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
  "purple", "fuchsia", "pink", "rose",
]);


// ---------------------------------------------------------------------------
// The lint clause must cover EVERY composed token, not the families that
// happened to exist when it was written.
//
// It enumerates `surface-accent|surface-ink|edge-accent` — the naming families
// the design spec established. `--edge-control` honours that convention;
// `--placeholder` deliberately does not, and when both were added the clause
// silently stopped covering them. An opacity modifier on a composed token is
// dropped by Tailwind with no error, which is the same no-error, no-failing-test
// shape that let the first version of this fix ship inert.
// ---------------------------------------------------------------------------
describe("the composed-alpha lint clause keeps up with the registry", () => {
  it("covers every composed token", () => {
    const config = readFileSync(path.join(REPO_ROOT, "eslint.config.mjs"), "utf8");

    // Pull the token-family alternation out of the selector. Parsing the whole
    // regex back out of a JS string literal is fiddly and was wrong the first
    // time; the alternation is the part that actually has to keep up.
    const m = config.match(/\)-\(([a-z0-9|-]+)\)\[a-z0-9-\]\*/);
    expect(m, "the composed-alpha clause must still carry a token-family group").toBeTruthy();
    const families = m![1].split("|");

    const uncovered = COMPOSED.filter((t) => !families.some((f) => t === f || t.startsWith(f)));
    expect(
      uncovered,
      "these composed tokens bake their own alpha, but the lint clause's family " +
        "list would let an opacity modifier through — and Tailwind drops it " +
        "silently, so nothing else would catch it. Add them to the alternation " +
        "in eslint.config.mjs.",
    ).toEqual([]);
  });
});
