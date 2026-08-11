// Structural guard for the token file (Child A1 step 4).
//
// `app/brand.css` is outside LINT — `eslint.config.mjs` loads no CSS processor,
// so `npx eslint app/brand.css` reports 0 errors and `tsc` never reads it. It is
// NOT ungated: `app/components/admin/__tests__/participationAlongside.test.tsx`
// reads it and pins `.brand-admin-frame`, `.brand-admin-shell` and
// `[data-route-main]:has(.planner-wide)`. What has NO enforcement is its
// TOKEN/THEME STRUCTURE, and that is what this file adds.
//
// The failure being closed is silent. An undeclared `var()` is invalid at
// computed-value time, so the whole declaration is DROPPED — `.brand-atmosphere`'s
// body wash and every inset highlight simply vanish, with tsc, eslint and vitest
// all green.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments, syntaxFor } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Emitted at runtime by `next/font` via its `.variable` classes, and declared in
 *  neither `brand.css` nor `tailwind.config.ts`. Named explicitly rather than
 *  scoped away by a `--brand-` prefix: a prefix scope would make the synthetic
 *  fire-proof below vacuous, because a scratch `var(--nonexistent)` would fall
 *  outside the guard's attention entirely. */
const EXTERNALLY_DECLARED = new Set(["--font-display", "--font-body", "--font-label"]);

/** Non-colour custom properties. Theme parity is colour-scoped, so these are
 *  outside the assertion — an unscoped parity check would demand a nonsensical
 *  `.light --brand-radius-panel`. */
const NON_COLOUR = new Set([
  "--brand-radius-panel",
  "--brand-radius-control",
  "--brand-duration-fast",
  "--brand-duration-reveal",
]);

/** The reference set spans the inventory's glob MINUS `__tests__` — without that
 *  exclusion this guard's own synthetic fixtures poison the set it asserts against —
 *  plus `tailwind.config.ts`, which references the same variables one file over. */
function referenceFiles(): string[] {
  const out: string[] = [];
  const exts = new Set([".tsx", ".ts", ".mjs", ".css"]);
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (rel.includes("__tests__")) continue;
      if (e.isDirectory()) walk(rel);
      else if (exts.has(path.extname(rel))) out.push(rel);
    }
  };
  walk("app");
  out.push("tailwind.config.ts");
  return out.sort();
}

function read(rel: string): string {
  const raw = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  return stripComments(raw, { syntax: syntaxFor(rel) });
}

/** Declarations come from `brand.css` ONLY.
 *
 *  `tailwind.config.ts` declares ZERO custom properties — it only references them.
 *  Treating it as a declaration source makes every `--brand-*` self-declaring, so
 *  after a rename the reference at `AdminPanel.tsx` stays green and the admin-tab
 *  ring vanishes: the guard would be permanently green against the exact failure
 *  it exists to catch. */
function declaredProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z][a-z0-9-]*)\s*:/gi)].map((m) => m[1]));
}

function referencedProperties(src: string): string[] {
  return [...src.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)/gi)].map((m) => m[1]);
}

/** Colour-scoped: classify DECLARED variables by value shape, and treat an
 *  UNDECLARED reference as a colour unless it is on the externally-declared list. */
function isColourProperty(name: string, css: string): boolean {
  if (EXTERNALLY_DECLARED.has(name)) return false;
  if (NON_COLOUR.has(name)) return false;
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`, "i"));
  if (!m) return true; // undeclared → treat as a colour, so the guard can fire
  return /^\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}\s*$/.test(m[1]) || /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i.test(m[1]);
}

// ---------------------------------------------------------------------------
// (a) Reference integrity — ACTIVE NOW
// ---------------------------------------------------------------------------

describe("brand.css — (a) every colour var() referenced is declared", () => {
  const css = read("app/brand.css");
  const declared = declaredProperties(css);

  it("is green against the real tree today", () => {
    const dangling: string[] = [];
    for (const rel of referenceFiles()) {
      for (const name of referencedProperties(read(rel))) {
        if (declared.has(name) || EXTERNALLY_DECLARED.has(name)) continue;
        if (!isColourProperty(name, css)) continue;
        dangling.push(`${rel} → ${name}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("sees references OUTSIDE the token files — a file-scoped set cannot", () => {
    // These two are the only live colour `var(--brand-*)` references in the app, and
    // both name variables Child B retires. A guard that reads only brand.css and
    // tailwind.config.ts stays green while Child B's rename silently drops them.
    const admin = read("app/components/admin/AdminPanel.tsx");
    const adminPage = read("app/(client)/admin/page.tsx");
    expect(referencedProperties(admin)).toContain("--brand-beam");
    expect(referencedProperties(adminPage)).toContain("--brand-signal");
  });

  it("FIRES on an undeclared colour reference (synthetic — the fire-proof)", () => {
    const synthetic = ".x { box-shadow: 0 0 0 1px rgb(var(--brand-nonexistent) / 0.15); }";
    const dangling = referencedProperties(synthetic).filter(
      (n) => !declared.has(n) && !EXTERNALLY_DECLARED.has(n) && isColourProperty(n, css),
    );
    expect(dangling).toEqual(["--brand-nonexistent"]);
  });

  it("does NOT fire on the three next/font variables, which are declared elsewhere", () => {
    const config = read("tailwind.config.ts");
    const fontRefs = referencedProperties(config).filter((n) => n.startsWith("--font-"));
    expect(fontRefs.length).toBeGreaterThan(0);
    expect(fontRefs.every((n) => EXTERNALLY_DECLARED.has(n))).toBe(true);
  });

  it("tailwind.config.ts declares nothing — it belongs to the reference set only", () => {
    expect(declaredProperties(read("tailwind.config.ts")).size).toBe(0);
  });

  // A `var()`-integrity guard cannot see Tailwind UTILITY references:
  // `selection:bg-brand-beam/35` consumes the `brand.beam` KEY, not a `var()`.
  // Deleting that key silently drops the utility on both root layouts. That guard
  // belongs to Child B, which is the change that removes the key.
  it("records that utility references are out of scope, and where they are covered", () => {
    const client = read("app/(client)/layout.tsx");
    // Re-pointed by Child B: the utility is now `selection:bg-accent`. The POINT of
    // this assertion is unchanged and is not about the spelling — a utility class
    // references its custom property through Tailwind's config, never directly, so
    // it can never appear in this file's `var()` references. That is why the
    // reference-integrity scan above cannot see utility usage, and why the category-10
    // count in the inventory is what covers it instead.
    expect(client).toContain("selection:bg-accent");
    expect(referencedProperties(client)).not.toContain("--accent-rgb");
  });
});

// ---------------------------------------------------------------------------
// (b) Theme parity — AUTHORED, DORMANT until Child D
// ---------------------------------------------------------------------------

/** Self-activates on ".light declares >= 1 custom property".
 *
 *  Step 5 adds only `color-scheme`, which is not a custom property, so this stays
 *  dormant here and binds in Child D. Landing it active today would go red against
 *  every colour `:root` property — this plan failing its own done-gate.
 *
 *  THE TRIGGER MATCHES THE SELECTOR FORM, SO THE FORM IS BINDING ON CHILD D: if D
 *  hardens `.light` to `:root.light` for specificity, it must update this matcher in
 *  the same change or the guard silently un-arms forever. */
function lightBlock(css: string): string | null {
  const m = css.match(/(^|\})\s*\.light\s*\{([^}]*)\}/);
  return m ? m[2] : null;
}

function customProperties(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z][a-z0-9-]*)\s*:/gi)].map((m) => m[1]));
}

function rootBlock(css: string): string {
  const m = css.match(/:root\s*\{([^}]*)\}/);
  return m ? m[1] : "";
}

function parityViolations(css: string): string[] {
  const light = lightBlock(css);
  if (light === null) return [];
  const lightProps = customProperties(light);
  if (lightProps.size === 0) return []; // dormant
  const rootProps = [...customProperties(rootBlock(css))].filter((n) => isColourProperty(n, css));
  const out: string[] = [];
  for (const n of rootProps) if (!lightProps.has(n)) out.push(`:root declares ${n} with no .light counterpart`);
  for (const n of lightProps) if (!rootProps.includes(n)) out.push(`.light declares ${n} with no :root counterpart`);
  return out.sort();
}

describe("brand.css — (b) theme parity, dormant until .light carries custom properties", () => {
  const css = read("app/brand.css");

  it("is dormant today: .light exists but declares no custom property", () => {
    expect(lightBlock(css)).not.toBeNull();
    expect(customProperties(lightBlock(css) ?? "").size).toBe(0);
    expect(parityViolations(css)).toEqual([]);
  });

  it("FIRES on a synthetic .light block with a missing counterpart (the fire-proof)", () => {
    const synthetic = `
      :root { --brand-beam: 18 200 244; --brand-frost: 215 231 246; --brand-radius-panel: 16px; }
      .light { --brand-beam: 0 100 200; }
    `;
    // --brand-frost has no counterpart; --brand-radius-panel is non-colour and must
    // NOT be demanded, or the guard would insist on a nonsensical light radius.
    const v = parityViolations(synthetic);
    expect(v).toEqual([":root declares --brand-frost with no .light counterpart"]);
  });

  it("FIRES in the other direction too — a .light-only property is undefined in dark", () => {
    const synthetic = `
      :root { --brand-beam: 18 200 244; }
      .light { --brand-beam: 0 100 200; --brand-invented: 1 2 3; }
    `;
    expect(parityViolations(synthetic)).toEqual([".light declares --brand-invented with no :root counterpart"]);
  });

  it("the allowlist starts EMPTY — colour scoping already excludes the non-colour four", () => {
    // `--brand-signal` must never be allowlisted: it is a colour Child B retires, and
    // allowlisting a colour as "theme-invariant" is the drift class this guard catches.
    expect(isColourProperty("--brand-signal", css)).toBe(true);
    for (const n of NON_COLOUR) expect(isColourProperty(n, css)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 5 — the `.light` branch, and its source order
// ---------------------------------------------------------------------------

describe("brand.css — the .light colour-scheme branch", () => {
  const css = read("app/brand.css");

  it("declares color-scheme on both :root and .light", () => {
    expect(rootBlock(css)).toMatch(/color-scheme:\s*dark/);
    expect(lightBlock(css)).toMatch(/color-scheme:\s*light/);
  });

  it("declares .light AFTER :root — equal specificity makes source order the whole override", () => {
    // Both selectors are (0,1,0). A `.light` block placed above `:root` passes every
    // other gate in this file and themes nothing.
    expect(css.indexOf(".light")).toBeGreaterThan(css.indexOf(":root"));
  });
});
