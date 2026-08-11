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
import { readFileSync } from "node:fs";
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
  "elevation",
  "chart-lead", "chart-bgv", "chart-coro", "chart-especial", "chart-instr", "chart-foh",
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

  it("B1 removed nothing: all seven retired roles still exist on both sides", () => {
    // The single unsafe transition in Child B is removing a key while a call site
    // still uses it. B1 must not have started that.
    for (const retired of ["blackout", "console", "deck", "beam", "signal", "frost", "steel"]) {
      expect(DECLARED.has(`--brand-${retired}`), `--brand-${retired} declaration`).toBe(true);
      expect(ts, `brand.${retired} Tailwind key`).toContain(`${retired}: "rgb(var(--brand-${retired})`);
    }
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

  it("the seven declarations still exist — B2 rewrote bodies, B-final removes these", () => {
    for (const r of ["blackout", "console", "deck", "beam", "signal", "frost", "steel"]) {
      expect(DECLARED.has(`--brand-${r}`), `--brand-${r}`).toBe(true);
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
