# Motion M0a — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the motion system's foundation in place — tokens, the reduced-motion rule, the `motion` library behind a provider and an import boundary, and the first four primitives (Presence, Reveal, Skeleton, Button) — plus two shell fixes, so that every later phase composes primitives instead of inventing motion.

**Architecture:** Motion tokens live in `app/brand.css` `:root` as non-colour custom properties and are mirrored as Tailwind `transitionDuration`/`keyframes`/`animation` keys. Static motion (press, hover, reveal, shimmer) is CSS only. Stateful motion (exit, interruption) goes through `motion` (v13), imported ONLY from `app/components/ui/**` and `app/utils/motion*` — a scan test enforces the boundary the way `clientBoundary.test.ts` enforces ADR-0028. `app/(client)/template.tsx` remounts page content per navigation so CSS reveal keyframes replay; the `<main>` wrapper is never transformed (a transformed ancestor breaks every `position: fixed` descendant).

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 3 (`tailwind.config.ts`), `motion` 13.x, vitest + @testing-library/react (jsdom per-file), Node 22.

**Spec:** `docs/superpowers/specs/2026-09-08-premium-motion-design.md` — Part I §2–§4, §6 (M0), §7; Part III §16 findings 3 and 5, §20 M0 deltas; Part IV decisions A, C, N (partial: guard only).

## Global Constraints

- Browser floor is **iOS 15 / Safari 15** (ADR-0030): no View Transitions API, no `@starting-style`, no scroll-driven animations, no `:has()` in new CSS, no `AbortSignal.timeout`, no `Array.prototype.findLast`.
- Only `transform` and `opacity` animate. Never `height`, `width`, `top`, `box-shadow` loops, `filter: blur()`, `background-position`.
- Durations and easings come from tokens (`--motion-*`, `--ease-*`); no raw `duration-N` or `transition-all` utilities outside `app/components/ui/**` beyond the pinned baseline (13 and 13 today).
- `import … from "motion/…"` is allowed only under `app/components/ui/**` and `app/utils/motion*.ts(x)`.
- A Server Component may never CALL a value imported from a `"use client"` module (ADR-0028, `clientBoundary.test.ts`). Primitives that need no hooks are NEUTRAL modules (no `"use client"`) so both sides can render them.
- No colour is built by string concatenation; no 6-digit hex literal in TSX (`eslint.config.mjs`); no opacity modifier on a composed token.
- Every `var(--x)` referenced under `app/**` must be declared in `app/brand.css` (`brandCss.test.ts`); new custom properties go inside the FIRST `:root { … }` block.
- Any new colour-bearing class literal changes `app/utils/__tests__/__fixtures__/colour-inventory.json`; regenerate it with `node scripts/colour-inventory.mjs` in the same commit.
- Spanish UI copy; sentence case in body text; `font-label text-xs uppercase tracking-widest` for control labels.
- Never add AI attribution or `Co-Authored-By` to commits. Conventional commits, body says why.
- Before claiming done: `npx tsc --noEmit`, `npm test`, `npx eslint .` (0 errors) — all three.
- Bundle cap for the whole programme: **+25 kB gz** on first-load JS; M0a records the baseline and its own delta in `docs/MOTION.md`.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `app/brand.css` | motion tokens in `:root`; reduced-motion + `[data-motion="off"]` rule; `brand-reveal`, `brand-skeleton`, `brand-btn-sheen`, section-rail draw | 1, 2, 5, 6, 7 |
| `tailwind.config.ts` | `transitionDuration`, `transitionTimingFunction`, `keyframes`, `animation` extensions | 1 |
| `app/utils/__tests__/motionTokens.test.ts` | pins the token names, the reduced-motion rule, the Tailwind mirror | 1, 2 |
| `app/utils/motionPresets.ts` | springs and variant objects (neutral module, no `motion` import) | 3 |
| `app/components/ui/MotionProvider.tsx` | `LazyMotion` + `MotionConfig reducedMotion="user"` | 3 |
| `app/utils/Provider.tsx` | mounts `MotionProvider` | 3 |
| `app/utils/__tests__/motionImportBoundary.test.ts` | fails on a `motion/*` import outside the allowed roots | 3 |
| `app/components/ui/__tests__/motionTestSetup.ts` | `matchMedia` stub + `MotionGlobalConfig.skipAnimations` for jsdom tests | 4 |
| `app/components/ui/Presence.tsx` + test | `AnimatePresence` wrapper with `fade` / `rise` / `scale` / `sheet` | 4 |
| `app/utils/reveal.ts` + `app/(client)/template.tsx` + test | CSS-only route reveal; stagger helper; remount per navigation | 5 |
| `app/(client)/page.tsx` | first consumer of `revealProps` | 5 |
| `app/components/ui/Skeleton.tsx` + test; four `loading.tsx` | shimmer placeholder; skeleton compositions | 6 |
| `app/components/ui/Button.tsx` + test | variants, sizes, press, sheen, focus, `busy`, `href` | 7 |
| `app/components/ui/ThemeAnnouncement.tsx`, `app/(client)/error.tsx` | first two Button consumers | 7 |
| `app/components/Navbar.tsx`, `app/components/NavMenu.tsx` + `shellPolish.test.ts` | lockup `priority`; initials on `text-on-fill` | 8 |
| `app/utils/__tests__/rawMotionLiterals.test.ts` | pins `transition-all` / `duration-N` counts outside `ui/` | 9 |
| `app/(gallery)/theme-gallery/[theme]/layout.tsx` | `data-motion="off"` on `<html>` | 2 |
| `docs/adr/0031-motion-library-under-an-ios-15-floor.md`, `docs/adr/README.md` | the decision | 10 |
| `docs/MOTION.md`, `docs/README.md`, `docs/UTILITIES_AND_COMPONENTS.md`, `CLAUDE.md` | the system's documentation | 10 |

---

### Task 1: Motion tokens in `brand.css` and their Tailwind mirror

**Files:**
- Modify: `app/brand.css:6-9` (inside the first `:root {` block, right after `--brand-duration-reveal`)
- Modify: `tailwind.config.ts:165-176` (`theme.extend`, after `fontSize`)
- Create: `app/utils/__tests__/motionTokens.test.ts`

**Interfaces:**
- Produces CSS custom properties: `--motion-fast`, `--motion-base`, `--motion-slow`, `--motion-reveal`, `--motion-shimmer`, `--ease-out`, `--ease-in`, `--ease-in-out`, `--motion-rise`, `--motion-sink`.
- Produces Tailwind utilities: `duration-fast|base|slow|reveal`, `ease-out-brand|ease-in-brand|ease-in-out-brand`, `animate-rise`, `animate-shimmer`, `animate-scale-in`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/motionTokens.test.ts
// Guard for the motion token layer (spec §2.3). brand.css is outside lint and tsc,
// so an undeclared --motion-* var is dropped silently at computed-value time —
// exactly the failure brandCss.test.ts closes for colours. This file pins the
// NAMES and the Tailwind mirror, because a token that exists only in CSS can be
// misspelled in a utility with no signal from any gate.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, syntaxFor } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) =>
  stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"), { syntax: syntaxFor(rel) });

const css = read("app/brand.css");
const tailwind = read("tailwind.config.ts");

function rootBlock(src: string): string {
  const m = src.match(/:root\s*\{([^}]*)\}/);
  return m ? m[1] : "";
}

export const MOTION_TOKENS = {
  "--motion-fast": "120ms",
  "--motion-base": "200ms",
  "--motion-slow": "320ms",
  "--motion-reveal": "480ms",
  "--motion-shimmer": "1600ms",
  "--ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--ease-in-out": "cubic-bezier(0.65, 0, 0.35, 1)",
  "--motion-rise": "8px",
  "--motion-sink": "1px",
} as const;

describe("motion tokens — brand.css :root", () => {
  const root = rootBlock(css);

  it.each(Object.entries(MOTION_TOKENS))("declares %s as %s", (name, value) => {
    const re = new RegExp(`${name}\\s*:\\s*${value.replace(/[().]/g, "\\$&")}\\s*;`);
    expect(root).toMatch(re);
  });

  it("aliases the two surviving --brand-duration-* vars onto the motion tokens", () => {
    expect(root).toMatch(/--brand-duration-fast\s*:\s*var\(--motion-fast\)\s*;/);
    expect(root).toMatch(/--brand-duration-reveal\s*:\s*var\(--motion-reveal\)\s*;/);
  });

  it("declares them inside the FIRST :root block, where brandCss.test.ts's parity check reads", () => {
    for (const name of Object.keys(MOTION_TOKENS)) expect(root).toContain(name);
  });
});

describe("motion tokens — Tailwind mirror", () => {
  it("maps duration utilities onto the vars", () => {
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*fast:\s*"var\(--motion-fast\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*base:\s*"var\(--motion-base\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*slow:\s*"var\(--motion-slow\)"/);
    expect(tailwind).toMatch(/transitionDuration:\s*\{[^}]*reveal:\s*"var\(--motion-reveal\)"/);
  });

  it("maps easing utilities onto the vars", () => {
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"out-brand":\s*"var\(--ease-out\)"/);
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"in-brand":\s*"var\(--ease-in\)"/);
    expect(tailwind).toMatch(/transitionTimingFunction:\s*\{[^}]*"in-out-brand":\s*"var\(--ease-in-out\)"/);
  });

  it("declares the three keyframes and their animation utilities", () => {
    for (const k of ["rise", "shimmer", "scale-in"]) {
      expect(tailwind, `keyframes.${k}`).toMatch(new RegExp(`keyframes:\\s*\\{[\\s\\S]*"?${k}"?:\\s*\\{`));
      expect(tailwind, `animation.${k}`).toMatch(new RegExp(`animation:\\s*\\{[\\s\\S]*"?${k}"?:\\s*"${k} `));
    }
  });

  it("adds no colour key — tokenLayer.test.ts owns theme.extend.colors", () => {
    const colorsStart = tailwind.indexOf("colors: {");
    const motionStart = tailwind.indexOf("transitionDuration:");
    expect(colorsStart).toBeGreaterThan(-1);
    expect(motionStart).toBeGreaterThan(colorsStart);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/utils/__tests__/motionTokens.test.ts`
Expected: FAIL — every `declares --motion-…` case and the Tailwind cases fail (tokens absent).

- [ ] **Step 3: Add the tokens to `brand.css`**

In `app/brand.css`, replace lines 8–9:

```css
  --brand-duration-fast: 150ms;
  --brand-duration-reveal: 210ms;
```

with:

```css
  /* ---- Motion tokens (spec 2026-09-08-premium-motion-design §2.3) ----------
     Non-colour, so outside the theme-parity check in brandCss.test.ts (that guard
     classifies by VALUE shape). Pinned by motionTokens.test.ts. Only transform and
     opacity ever animate against these; see docs/MOTION.md. */
  --motion-fast: 120ms;     /* colour, hover, focus ring */
  --motion-base: 200ms;     /* press, toggles, menus, small reveals */
  --motion-slow: 320ms;     /* sheets, dialogs, tab panels, expand/collapse */
  --motion-reveal: 480ms;   /* route reveal, hero rail */
  --motion-shimmer: 1600ms; /* skeleton sweep period */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --motion-rise: 8px;       /* enter travel */
  --motion-sink: 1px;       /* press travel */

  /* The two surviving --brand-duration-* vars (ADR-0016 lists the four non-colour
     --brand-* survivors) become aliases so their 3 existing consumers move with the
     system. Values CHANGE here: 150→120 and 210→480; the beam reveal on the sign-in
     lockup is the only visible effect, and 480 is the spec's reveal duration. */
  --brand-duration-fast: var(--motion-fast);
  --brand-duration-reveal: var(--motion-reveal);
```

- [ ] **Step 4: Add the Tailwind mirror**

In `tailwind.config.ts`, after the `fontSize` block (line ~168) and before `scrollSnapType`, insert:

```ts
			// Motion tokens — mirrors of the --motion-* / --ease-* vars in brand.css so
			// utilities and CSS agree on one clock. Pinned by motionTokens.test.ts.
			// NON-COLOUR: tokenLayer.test.ts reads theme.extend.colors only.
			transitionDuration: {
				fast: "var(--motion-fast)",
				base: "var(--motion-base)",
				slow: "var(--motion-slow)",
				reveal: "var(--motion-reveal)",
			},
			transitionTimingFunction: {
				"out-brand": "var(--ease-out)",
				"in-brand": "var(--ease-in)",
				"in-out-brand": "var(--ease-in-out)",
			},
			keyframes: {
				rise: {
					from: { opacity: "0", transform: "translate3d(0, var(--motion-rise), 0)" },
					to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
				},
				"scale-in": {
					from: { opacity: "0", transform: "scale(0.96)" },
					to: { opacity: "1", transform: "scale(1)" },
				},
				shimmer: {
					from: { transform: "translate3d(-100%, 0, 0)" },
					to: { transform: "translate3d(100%, 0, 0)" },
				},
			},
			animation: {
				rise: "rise var(--motion-base) var(--ease-out) both",
				"scale-in": "scale-in var(--motion-slow) var(--ease-out) both",
				shimmer: "shimmer var(--motion-shimmer) linear infinite",
			},
```

- [ ] **Step 5: Run the test and the two guards that read these files**

Run: `npx vitest run app/utils/__tests__/motionTokens.test.ts app/utils/__tests__/brandCss.test.ts app/utils/__tests__/tokenLayer.test.ts`
Expected: PASS (brandCss's parity check treats `120ms` / `cubic-bezier(…)` / `8px` as non-colour by value shape; tokenLayer reads `colors` only).

- [ ] **Step 6: Commit**

```bash
git add app/brand.css tailwind.config.ts app/utils/__tests__/motionTokens.test.ts
git commit -m "feat(motion): motion tokens in brand.css with a Tailwind mirror

Ten non-colour custom properties (durations, easings, travel) and the
utilities that consume them, so no component carries a raw duration.
The two surviving --brand-duration-* vars become aliases."
```

---

### Task 2: Global reduced-motion rule and the gallery's motion-off switch

**Files:**
- Modify: `app/brand.css` (replace the block at lines ~891–897, the only `prefers-reduced-motion` rule)
- Modify: `app/(gallery)/theme-gallery/[theme]/layout.tsx` (the `<html>` element)
- Modify: `app/utils/__tests__/motionTokens.test.ts` (append a describe block)

**Interfaces:**
- Produces: `html[data-motion="off"]` disables all animation/transition; `@media (prefers-reduced-motion: reduce)` does the same globally.

- [ ] **Step 1: Append the failing tests**

Append to `app/utils/__tests__/motionTokens.test.ts`:

```ts
describe("reduced motion is global, not per-effect", () => {
  it("brand.css collapses every animation and transition under prefers-reduced-motion", () => {
    const m = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m, "no global reduced-motion block").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("the old beam-only override is gone — one rule, not one per effect", () => {
    expect(css).not.toMatch(/prefers-reduced-motion[\s\S]{0,200}\.brand-stage-hero::before/);
  });

  it("html[data-motion=\"off\"] applies the same collapse, for VR baselines", () => {
    expect(css).toMatch(/html\[data-motion="off"\]\s*\*,\s*html\[data-motion="off"\]\s*\*::before,\s*html\[data-motion="off"\]\s*\*::after\s*\{/);
  });

  it("the theme gallery root sets data-motion=\"off\" on <html>", () => {
    const layout = read("app/(gallery)/theme-gallery/[theme]/layout.tsx");
    expect(layout).toMatch(/<html[\s\S]*?data-motion="off"/);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run app/utils/__tests__/motionTokens.test.ts -t "reduced motion"`
Expected: FAIL on all four.

- [ ] **Step 3: Replace the reduced-motion block in `brand.css`**

Find (near the end of the file):

```css
@media (prefers-reduced-motion: reduce) {
  .brand-stage-hero::before {
    opacity: 1;
    transform: none;
    animation: none;
  }
}
```

Replace with:

```css
/* Reduced motion is a THEME, not a per-effect opt-out (spec §2.2). One rule
   collapses every animation and transition to a single frame, and the JS layer
   (MotionProvider, reducedMotion="user") reads the same query. Sheets and dialogs
   still open and close — instantly. The beam-only override this replaces is what a
   per-effect approach looks like after one effect; this is what it looks like after
   none are forgotten. `html[data-motion="off"]` is the same collapse for the theme
   gallery's visual-regression baselines, set by its root layout. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .brand-stage-hero::before {
    opacity: 1;
    transform: none;
  }
}

html[data-motion="off"] *, html[data-motion="off"] *::before, html[data-motion="off"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
html[data-motion="off"] .brand-stage-hero::before {
  opacity: 1;
  transform: none;
}
```

- [ ] **Step 4: Set the attribute in the gallery layout**

In `app/(gallery)/theme-gallery/[theme]/layout.tsx`, change the `<html` opening tag to:

```tsx
    <html
      lang="es"
      suppressHydrationWarning
      data-motion="off"
      className={`${theme} ${displayFont.variable} ${bodyFont.variable} ${labelFont.variable}`}
    >
```

- [ ] **Step 5: Run the tests plus the gallery guard**

Run: `npx vitest run app/utils/__tests__/motionTokens.test.ts app/utils/__tests__/themeGallery.test.ts app/utils/__tests__/brandCss.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/brand.css "app/(gallery)/theme-gallery/[theme]/layout.tsx" app/utils/__tests__/motionTokens.test.ts
git commit -m "feat(motion): one global reduced-motion rule, and a motion-off switch for the gallery

Replaces the single beam-only override. Under prefers-reduced-motion every
animation and transition collapses to one frame; the gallery root sets
html[data-motion=off] so visual-regression baselines never capture mid-frame."
```

---

### Task 3: `motion` dependency, `MotionProvider`, presets, and the import boundary

**Files:**
- Modify: `package.json` (dependency)
- Create: `app/utils/motionPresets.ts`
- Create: `app/components/ui/MotionProvider.tsx`
- Modify: `app/utils/Provider.tsx:41-45`
- Create: `app/utils/__tests__/motionImportBoundary.test.ts`
- Create: `app/utils/__tests__/motionPresets.test.ts`

**Interfaces:**
- Produces: `MotionProvider({ children })` — client component, renders `LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"`.
- Produces from `motionPresets.ts`: `SPRINGS.sheet | pop | settle` (`{ type: "spring"; stiffness; damping; mass? }`), `VARIANTS.fade | rise | scale | sheet` (`{ initial, animate, exit }` objects), `EXIT_MS = 160`.
- Import rule: `motion/*` only from `app/components/ui/**` and `app/utils/motion*`.

- [ ] **Step 1: Install and verify the API surface**

Run:

```bash
npm install motion@^13.2.0
node -e "import('motion/react').then(m=>console.log(['LazyMotion','domAnimation','AnimatePresence','MotionConfig','useReducedMotion','MotionGlobalConfig'].map(k=>k+':'+(k in m))))"
node -e "import('motion/react-m').then(m=>console.log('react-m default keys:', Object.keys(m).slice(0,5), 'has div:', 'div' in (m.default ?? m)))"
```

Expected: every name in the first command prints `:true`. The second prints the `m` proxy's keys and `has div: true`. **Decision rule:** if `LazyMotion` is `true`, the provider below stands as written. If `MotionGlobalConfig` is `false` on `motion/react`, use `import { MotionGlobalConfig } from "motion"` in Task 4's test setup instead (the root entry re-exports it in 12.x and 13.x). Record which spelling worked in `docs/MOTION.md` (Task 10).

- [ ] **Step 2: Write the failing boundary test**

```ts
// app/utils/__tests__/motionImportBoundary.test.ts
// The rule that makes decision A safe (spec §3): `motion` is imported ONLY by the
// primitives under app/components/ui/** and by app/utils/motion*. Feature components
// compose Presence / Reveal / Collapse / …; they never reach for `m.div` directly.
// Same shape as clientBoundary.test.ts: a repo-wide walk, a clean-tree assertion,
// and a synthetic fire-proof.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IMPORT_RE = /from\s+["'](motion|motion\/[a-z-]+|framer-motion)["']/g;

export function isAllowedMotionImporter(rel: string): boolean {
  const p = rel.split(path.sep).join("/");
  if (p.includes("/__tests__/")) return true;
  if (p.startsWith("app/components/ui/")) return true;
  if (/^app\/utils\/motion[^/]*\.tsx?$/.test(p)) return true;
  return false;
}

export function findMotionImports(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(rel); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
      const src = readFileSync(path.join(root, rel), "utf8");
      if (IMPORT_RE.test(src)) out.push(rel);
      IMPORT_RE.lastIndex = 0;
    }
  };
  walk("app");
  return out.sort();
}

describe("motion import boundary", () => {
  it("only ui/ primitives and app/utils/motion* import motion", () => {
    const offenders = findMotionImports(REPO_ROOT).filter((f) => !isAllowedMotionImporter(f));
    expect(
      offenders,
      "A feature component imports `motion` directly. Compose a primitive from " +
        "app/components/ui/ instead (Presence, Collapse, SegmentedControl…) — see docs/MOTION.md.",
    ).toEqual([]);
  });

  it("the provider itself is an importer (the walk is not vacuous)", () => {
    expect(findMotionImports(REPO_ROOT)).toContain(path.join("app", "components", "ui", "MotionProvider.tsx"));
  });

  it("FIRES on a synthetic feature-component import (the fire-proof)", () => {
    expect(isAllowedMotionImporter("app/components/DayCard.tsx")).toBe(false);
    expect(isAllowedMotionImporter("app/components/admin/PlannerGrid.tsx")).toBe(false);
    expect(isAllowedMotionImporter("app/(client)/page.tsx")).toBe(false);
  });

  it("allows exactly the two roots", () => {
    expect(isAllowedMotionImporter("app/components/ui/Presence.tsx")).toBe(true);
    expect(isAllowedMotionImporter("app/utils/motionPresets.ts")).toBe(true);
    expect(isAllowedMotionImporter("app/utils/motionless.ts")).toBe(true); // prefix rule, documented
    expect(isAllowedMotionImporter("app/utils/reveal.ts")).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing presets test**

```ts
// app/utils/__tests__/motionPresets.test.ts
import { describe, it, expect } from "vitest";
import { SPRINGS, VARIANTS, EXIT_MS } from "../motionPresets";

describe("motionPresets", () => {
  it("names the three springs from spec §2.3 with their constants", () => {
    expect(SPRINGS.sheet).toEqual({ type: "spring", stiffness: 380, damping: 36, mass: 0.9 });
    expect(SPRINGS.pop).toEqual({ type: "spring", stiffness: 520, damping: 30 });
    expect(SPRINGS.settle).toEqual({ type: "spring", stiffness: 300, damping: 28 });
  });

  it("every variant animates only opacity and transform-family keys", () => {
    const allowed = new Set(["opacity", "y", "x", "scale"]);
    for (const [name, v] of Object.entries(VARIANTS)) {
      for (const phase of ["initial", "animate", "exit"] as const) {
        for (const key of Object.keys(v[phase])) {
          expect(allowed.has(key), `${name}.${phase}.${key}`).toBe(true);
        }
      }
    }
  });

  it("exits are faster than enters (spec: enter fast, exit faster)", () => {
    expect(EXIT_MS).toBeLessThan(200);
  });

  it("is a neutral module — no motion import, so server modules may read it", () => {
    // ADR-0028: a server component may read constants from here. Guarded by the
    // presence of `type: "spring"` string literals rather than a motion type import.
    expect(SPRINGS.sheet.type).toBe("spring");
  });
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `npx vitest run app/utils/__tests__/motionImportBoundary.test.ts app/utils/__tests__/motionPresets.test.ts`
Expected: FAIL — `motionPresets` not found; the boundary's "provider is an importer" case fails.

- [ ] **Step 5: Write the presets module (neutral)**

```ts
// app/utils/motionPresets.ts
// The JS half of the motion tokens (spec §2.3). Plain objects, NO `motion` import:
// this module is neutral so a Server Component may import a constant from it
// (ADR-0028), and so the import boundary in motionImportBoundary.test.ts has one
// fewer allowed importer to reason about. Consumers under app/components/ui pass
// these straight to `m.*` props.
//
// Durations here are the same values as --motion-* in brand.css, in ms, because
// motion takes seconds/ms and cannot read a CSS var.

export const MS = {
  fast: 120,
  base: 200,
  slow: 320,
  reveal: 480,
} as const;

/** Exit is always faster than enter (spec §2.2 "enter fast, exit faster"). */
export const EXIT_MS = 160;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const SPRINGS = {
  /** Bottom sheets and the audio transport. */
  sheet: { type: "spring", stiffness: 380, damping: 36, mass: 0.9 },
  /** Badges, chips, "you" rings — a quick settle with a little overshoot. */
  pop: { type: "spring", stiffness: 520, damping: 30 },
  /** A dragged chip landing. */
  settle: { type: "spring", stiffness: 300, damping: 28 },
} as const;

type Phase = Record<string, number>;
export type Variant = { initial: Phase; animate: Phase; exit: Phase };

/** Only opacity and transform-family keys — the compositor rule (spec §2.2). */
export const VARIANTS = {
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } },
  rise: { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 4 } },
  scale: { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 } },
  /** y in percent of own height is expressed by the consumer via `style`; here y is px. */
  sheet: { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 24 } },
} as const satisfies Record<string, Variant>;

export type VariantName = keyof typeof VARIANTS;
```

- [ ] **Step 6: Write `MotionProvider`**

```tsx
// app/components/ui/MotionProvider.tsx
"use client";

// The ONE place `motion`'s feature bundle is loaded (decision A, ADR-0031).
//
// `LazyMotion` + `domAnimation` keeps the shared chunk small: primitives render
// `m.*` elements, which are inert until this provider supplies the features. `strict`
// throws in development if any file renders a full `motion.*` component — that is the
// runtime twin of motionImportBoundary.test.ts.
//
// `reducedMotion="user"` makes every `m.*` honour prefers-reduced-motion by
// dropping transform animations to instant while keeping opacity; brand.css's global
// rule covers the CSS side. Together the app never becomes static — it becomes calm.

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
```

- [ ] **Step 7: Mount it in `Provider.tsx`**

In `app/utils/Provider.tsx`, add the import after the `ThemeBootstrap` import:

```tsx
import { MotionProvider } from "@/app/components/ui/MotionProvider"
```

and replace:

```tsx
            <CueDialogProvider>{children}</CueDialogProvider>
```

with:

```tsx
            <CueDialogProvider>
              <MotionProvider>{children}</MotionProvider>
            </CueDialogProvider>
```

(Inside `CueDialogProvider` so dialogs, which portal but stay in this React tree, receive the features; `themeWiring.test.ts` pins `ThemeProvider`'s props and `<Provider>`'s document order, neither of which moves.)

- [ ] **Step 8: Run tests, types and lint**

Run: `npx vitest run app/utils/__tests__/motionImportBoundary.test.ts app/utils/__tests__/motionPresets.test.ts app/utils/__tests__/themeWiring.test.ts app/utils/__tests__/clientBoundary.test.ts && npx tsc --noEmit && npx eslint app/utils/Provider.tsx app/components/ui/MotionProvider.tsx app/utils/motionPresets.ts`
Expected: all PASS, 0 type errors, 0 lint errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json app/utils/motionPresets.ts app/components/ui/MotionProvider.tsx app/utils/Provider.tsx app/utils/__tests__/motionImportBoundary.test.ts app/utils/__tests__/motionPresets.test.ts
git commit -m "feat(motion): add motion behind a lazy provider and an import boundary

motion 13 loads its DOM feature set once in MotionProvider (LazyMotion,
strict) with reducedMotion=\"user\". A repo-wide scan test allows the
import only under app/components/ui/** and app/utils/motion*, the same
shape as the ADR-0028 client-boundary guard. Presets are a neutral module."
```

---

### Task 4: `Presence` primitive

**Files:**
- Create: `app/components/ui/__tests__/motionTestSetup.ts`
- Create: `app/components/ui/Presence.tsx`
- Create: `app/components/ui/__tests__/Presence.test.tsx`

**Interfaces:**
- Consumes: `VARIANTS`, `VariantName`, `EXIT_MS`, `MS`, `EASE_OUT`, `EASE_IN` from `app/utils/motionPresets`.
- Produces: `Presence({ show: boolean; variant?: VariantName; as?: "div" | "section" | "aside" | "li"; className?; children; onExited?: () => void; ...rest })` — renders children while `show`, animates out before unmount, forwards `data-*`/`aria-*`/`role`/`id`. Client component.
- Produces: `installMotionTestEnv()` for jsdom tests.

- [ ] **Step 1: Write the test setup helper**

```ts
// app/components/ui/__tests__/motionTestSetup.ts
// jsdom has no matchMedia and no layout, so: stub matchMedia (motion reads it for
// reducedMotion="user") and skip animations globally so assertions see FINAL state
// synchronously. Import and call once at the top of any primitive test.
import { MotionGlobalConfig } from "motion/react";

export function installMotionTestEnv() {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  MotionGlobalConfig.skipAnimations = true;
}
```

(If Task 3 Step 1 found `MotionGlobalConfig` only on the root entry, the import line is `import { MotionGlobalConfig } from "motion";` — nothing else changes.)

- [ ] **Step 2: Write the failing Presence test**

```tsx
/** @vitest-environment jsdom */
// app/components/ui/__tests__/Presence.test.tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "./motionTestSetup";
import { MotionProvider } from "../MotionProvider";
import Presence from "../Presence";

installMotionTestEnv();
afterEach(cleanup);

function Harness({ show, onExited }: { show: boolean; onExited?: () => void }) {
  return (
    <MotionProvider>
      <Presence show={show} variant="rise" role="status" data-testid="toast" onExited={onExited}>
        Guardado
      </Presence>
    </MotionProvider>
  );
}

describe("Presence", () => {
  it("renders its children when show is true, with the forwarded attributes", () => {
    render(<Harness show />);
    const el = screen.getByTestId("toast");
    expect(el).toHaveTextContent("Guardado");
    expect(el.getAttribute("role")).toBe("status");
  });

  it("renders nothing when show is false from the start", () => {
    render(<Harness show={false} />);
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("removes the element after show flips to false, and reports the exit", async () => {
    const onExited = vi.fn();
    const { rerender } = render(<Harness show onExited={onExited} />);
    expect(screen.getByTestId("toast")).toBeTruthy();
    rerender(<Harness show={false} onExited={onExited} />);
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
  });

  it("renders the requested element type", () => {
    render(
      <MotionProvider>
        <Presence show as="li" data-testid="row">fila</Presence>
      </MotionProvider>,
    );
    expect(screen.getByTestId("row").tagName).toBe("LI");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run app/components/ui/__tests__/Presence.test.tsx`
Expected: FAIL — cannot resolve `../Presence`.

- [ ] **Step 4: Write `Presence`**

```tsx
// app/components/ui/Presence.tsx
"use client";

// Mount/unmount with an exit animation (spec §4). Wraps AnimatePresence so a feature
// component writes `<Presence show={open} variant="sheet">` instead of reaching for
// `motion` — the import boundary (motionImportBoundary.test.ts) is what keeps every
// exit in the app on one clock.
//
// Only opacity and transform animate (VARIANTS is guarded for that). Interruptions
// reverse smoothly because AnimatePresence tracks the in-flight value; a
// show→hide→show within EXIT_MS never snaps.
//
// `as` is limited to block-level hosts that never carry `position: fixed` children:
// a transformed ancestor is a containing block for fixed descendants (the WebKit trap
// CueDialog.tsx documents). Toasts and FABs portal instead of nesting here.

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ComponentPropsWithoutRef } from "react";
import { EASE_IN, EASE_OUT, EXIT_MS, MS, VARIANTS, type VariantName } from "@/app/utils/motionPresets";

type Host = "div" | "section" | "aside" | "li" | "span";

type Props = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  show: boolean;
  variant?: VariantName;
  as?: Host;
  onExited?: () => void;
  children: React.ReactNode;
};

const ENTER = { duration: MS.base / 1000, ease: EASE_OUT };
const EXIT = { duration: EXIT_MS / 1000, ease: EASE_IN };

export default function Presence({ show, variant = "fade", as = "div", onExited, children, ...rest }: Props) {
  const Tag = m[as];
  const v = VARIANTS[variant];
  return (
    <AnimatePresence initial={false} onExitComplete={onExited}>
      {show && (
        <Tag
          key="presence"
          initial={v.initial}
          animate={{ ...v.animate, transition: ENTER }}
          exit={{ ...v.exit, transition: EXIT }}
          {...rest}
        >
          {children}
        </Tag>
      )}
    </AnimatePresence>
  );
}
```

If Task 3 Step 1 showed `motion/react-m` exports a default object rather than named hosts, change the import to `import m from "motion/react-m";` — the usage `m[as]` is unchanged.

- [ ] **Step 5: Run the test, the boundary, types and lint**

Run: `npx vitest run app/components/ui/__tests__/Presence.test.tsx app/utils/__tests__/motionImportBoundary.test.ts && npx tsc --noEmit && npx eslint app/components/ui`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/Presence.tsx app/components/ui/__tests__/Presence.test.tsx app/components/ui/__tests__/motionTestSetup.ts
git commit -m "feat(motion): Presence primitive — exit before unmount, four house variants

The one way a feature component animates a conditional; every other
\`{open && …}\` in later phases becomes this. Tests run with animations
skipped so they assert final state, not timing."
```

---

### Task 5: Route reveal — CSS keyframes, `revealProps`, `template.tsx`, and the home page

**Files:**
- Modify: `app/brand.css` (append before the reduced-motion block)
- Create: `app/utils/reveal.ts`
- Create: `app/(client)/template.tsx`
- Modify: `app/(client)/page.tsx:159-163`, `:217-227`, the DayCard grid wrapper at `:173`
- Create: `app/utils/__tests__/reveal.test.ts`

**Interfaces:**
- Produces: `revealProps(index = 0): { "data-reveal": ""; style: { ["--reveal-i"]: number } }` — neutral module, callable from Server Components.
- Produces CSS: `[data-reveal]` rises and fades in over `--motion-base`, delayed `calc(var(--reveal-i) * 40ms)`; `.brand-section-heading::before` draws top-to-bottom over `--motion-reveal`.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/reveal.test.ts
// Route reveal (spec §2.1 #1, §5.0). Two guards: the helper's shape, and the rule
// that the route template NEVER transforms the page wrapper — a transformed
// ancestor is a containing block for every `position: fixed` descendant (FAB,
// audio transport), the WebKit trap CueDialog.tsx:33 documents.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revealProps } from "../reveal";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("revealProps", () => {
  it("returns the data attribute and the stagger index as a CSS variable", () => {
    expect(revealProps()).toEqual({ "data-reveal": "", style: { "--reveal-i": 0 } });
    expect(revealProps(3)).toEqual({ "data-reveal": "", style: { "--reveal-i": 3 } });
  });

  it("caps the stagger so a 142-item list does not wait 5.6 seconds", () => {
    expect(revealProps(40).style["--reveal-i"]).toBe(12);
  });
});

describe("app/(client)/template.tsx", () => {
  const rel = "app/(client)/template.tsx";

  it("exists, so page content remounts per navigation and keyframes replay", () => {
    expect(existsSync(path.join(REPO_ROOT, rel))).toBe(true);
  });

  it("renders children through a fragment — no wrapper, no transform, no motion import", () => {
    const src = read(rel);
    expect(src).not.toMatch(/from\s+["']motion/);
    expect(src).not.toMatch(/data-reveal/);
    expect(src).not.toMatch(/transform|animate-|className=/);
    expect(src).toMatch(/return\s+<>\{children\}<\/>/);
  });
});

describe("brand.css reveal rules", () => {
  const css = read("app/brand.css");

  it("animates [data-reveal] on opacity and transform only, staggered by --reveal-i", () => {
    const block = css.match(/\[data-reveal\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/animation:\s*brand-reveal var\(--motion-base\) var\(--ease-out\) both/);
    expect(block).toMatch(/animation-delay:\s*calc\(var\(--reveal-i,\s*0\)\s*\*\s*40ms\)/);
    const kf = css.match(/@keyframes brand-reveal\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(kf).toMatch(/opacity/);
    expect(kf).toMatch(/translate3d\(0,\s*var\(--motion-rise\),\s*0\)/);
    expect(kf).not.toMatch(/height|width|top:|left:/);
  });

  it("draws the section rail with scaleY from the top", () => {
    const block = css.match(/\.brand-section-heading::before\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/transform-origin:\s*top/);
    expect(block).toMatch(/animation:\s*brand-rail-draw var\(--motion-reveal\) var\(--ease-out\) both/);
  });
});

describe("home page is the first consumer", () => {
  it("passes revealProps to both section headings and the card grid", () => {
    const src = read("app/(client)/page.tsx");
    expect(src).toMatch(/import \{ revealProps \} from "\.\.\/utils\/reveal"/);
    expect((src.match(/\{\.\.\.revealProps\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/utils/__tests__/reveal.test.ts`
Expected: FAIL — `../reveal` not found.

- [ ] **Step 3: Write the helper (neutral module)**

```ts
// app/utils/reveal.ts
// Route reveal, CSS-only (spec §2.1 #1). A Server Component spreads
// `{...revealProps(i)}` on a block; brand.css does the rest. Neutral module — no
// "use client", no imports — so server pages may CALL it (ADR-0028).
//
// The stagger is capped: index 12 is 480 ms, the reveal duration itself. Past that
// the eye reads the list as "loaded"; a 142-row library that staggered to the end
// would still be fading in at 5.6 s.

export const REVEAL_STAGGER_CAP = 12;

export type RevealProps = { "data-reveal": ""; style: { ["--reveal-i"]: number } };

export function revealProps(index = 0): RevealProps {
  return { "data-reveal": "", style: { "--reveal-i": Math.min(index, REVEAL_STAGGER_CAP) } };
}
```

- [ ] **Step 4: Write the template**

```tsx
// app/(client)/template.tsx
// Exists so page content REMOUNTS on every navigation (a layout persists; a
// template does not), which is what makes the [data-reveal] keyframes replay.
// It renders a fragment on purpose: any wrapper here would sit between <main> and
// the page, and a wrapper with a transform is a containing block for every
// `position: fixed` descendant (guarded by reveal.test.ts). Server component; no
// hooks; no motion import.
export default function ClientTemplate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 5: Add the CSS**

In `app/brand.css`, immediately before the `@media (prefers-reduced-motion: reduce)` block from Task 2, insert:

```css
/* ---- Route reveal (spec §2.1 #1) --------------------------------------------
   Blocks carrying [data-reveal] rise --motion-rise and fade in, staggered by the
   --reveal-i the page assigns (app/utils/reveal.ts). Only opacity and transform, so
   the element occupies its final box from first paint and CLS stays 0. `both` keeps
   the first frame at opacity 0 during the delay. Replays per navigation because
   app/(client)/template.tsx remounts the page. */
@keyframes brand-reveal {
  from {
    opacity: 0;
    transform: translate3d(0, var(--motion-rise), 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

[data-reveal] {
  animation: brand-reveal var(--motion-base) var(--ease-out) both;
  animation-delay: calc(var(--reveal-i, 0) * 40ms);
}

/* The section rail draws top-to-bottom — the beam's one appearance on ordinary pages. */
@keyframes brand-rail-draw {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}
```

Then modify the existing `.brand-section-heading::before` rule (search for it; it sets `position: absolute; inset: 0.18rem auto 0.18rem 0; width: 2px; …`) by appending two declarations inside its braces:

```css
  transform-origin: top;
  animation: brand-rail-draw var(--motion-reveal) var(--ease-out) both;
```

- [ ] **Step 6: Apply to the home page**

In `app/(client)/page.tsx`, add the import after the `SongSearchList` import:

```tsx
import { revealProps } from "../utils/reveal";
```

Change line 160 from `<div className="brand-section-heading mb-7">` to:

```tsx
        <div className="brand-section-heading mb-7" {...revealProps(0)}>
```

Change the grid wrapper (line ~173) from
`<div className={\`grid grid-cols-1 gap-6 ${totalCards > 1 ? "md:grid-cols-2" : "mx-auto max-w-3xl"}\`}>` to:

```tsx
        <div className={`grid grid-cols-1 gap-6 ${totalCards > 1 ? "md:grid-cols-2" : "mx-auto max-w-3xl"}`} {...revealProps(1)}>
```

Change the library heading wrapper (line ~218) from `<div className="mb-7 flex items-end justify-between gap-4 border-b border-ink-dim/10 pb-5">` to:

```tsx
        <div className="mb-7 flex items-end justify-between gap-4 border-b border-ink-dim/10 pb-5" {...revealProps(2)}>
```

- [ ] **Step 7: Run tests, types, lint, boundary**

Run: `npx vitest run app/utils/__tests__/reveal.test.ts app/utils/__tests__/clientBoundary.test.ts app/utils/__tests__/brandCss.test.ts && npx tsc --noEmit && npx eslint "app/(client)/page.tsx" "app/(client)/template.tsx" app/utils/reveal.ts`
Expected: PASS, 0 errors. (`style={{ "--reveal-i": n }}` type-checks because `RevealProps.style` is typed with the custom property key; React accepts custom properties in `style`.)

- [ ] **Step 8: Look at it**

Run: `npx tsx --env-file=.env.local scripts/dev-verify.ts --route / --screenshot m0a-reveal.png --viewport 1440x900 --theme dark` is for dev after push; locally, start the dev server (`.claude/launch.json` → `preview_start`), load `/`, and confirm in the browser: the heading rail draws, the card grid rises after the heading, and `document.querySelector('main').style.transform` is empty.

- [ ] **Step 9: Commit**

```bash
git add app/brand.css app/utils/reveal.ts "app/(client)/template.tsx" "app/(client)/page.tsx" app/utils/__tests__/reveal.test.ts
git commit -m "feat(motion): route reveal — sections rise, the section rail draws

CSS-only: revealProps() is a neutral helper a server page spreads on a block;
template.tsx remounts page content per navigation so keyframes replay. The
template renders a fragment, never a transformed wrapper (fixed-descendant trap)."
```

---

### Task 6: `Skeleton` primitive and the four loading skeletons

**Files:**
- Modify: `app/brand.css` (append `.brand-skeleton` before the reveal block)
- Create: `app/components/ui/Skeleton.tsx`
- Create: `app/components/ui/__tests__/Skeleton.test.tsx`
- Modify: `app/(client)/loading.tsx`, `app/(client)/me/loading.tsx`, `app/(client)/schedule/loading.tsx`, `app/(client)/posts/[slug]/loading.tsx`
- Create: `app/utils/__tests__/loadingSkeletons.test.ts`

**Interfaces:**
- Produces: `Skeleton({ className?: string; rounded?: "sm" | "md" | "lg" | "full" })` — neutral module (no hooks), renders `<div aria-hidden class="brand-skeleton …">`.
- Produces: `SkeletonGroup({ label: string; children })` — `<div role="status" aria-busy="true" aria-label={label}>`.

- [ ] **Step 1: Write the failing tests**

```tsx
/** @vitest-environment jsdom */
// app/components/ui/__tests__/Skeleton.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Skeleton, { SkeletonGroup } from "../Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("is decorative: aria-hidden, with the shimmer class and the size classes", () => {
    render(<Skeleton className="h-4 w-32" data-testid="s" />);
    const el = screen.getByTestId("s");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("brand-skeleton");
    expect(el.className).toContain("h-4 w-32");
    expect(el.className).toContain("rounded-md");
  });

  it("maps rounded to a radius utility", () => {
    render(<Skeleton rounded="full" data-testid="s" />);
    expect(screen.getByTestId("s").className).toContain("rounded-full");
  });

  it("SkeletonGroup announces itself once, as a busy status region", () => {
    render(
      <SkeletonGroup label="Cargando servicios">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    const g = screen.getByRole("status");
    expect(g.getAttribute("aria-busy")).toBe("true");
    expect(g.getAttribute("aria-label")).toBe("Cargando servicios");
  });
});
```

```ts
// app/utils/__tests__/loadingSkeletons.test.ts
// The four loading.tsx files compose Skeleton instead of hand-copying pulse blocks
// (spec §4, §5.1–§5.3). Pulse is the pre-M0 spelling; a new one fails here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = [
  "app/(client)/loading.tsx",
  "app/(client)/me/loading.tsx",
  "app/(client)/schedule/loading.tsx",
  "app/(client)/posts/[slug]/loading.tsx",
];

describe.each(FILES)("%s", (rel) => {
  const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  it("uses Skeleton and SkeletonGroup", () => {
    expect(src).toMatch(/import Skeleton, \{ SkeletonGroup \} from "[./]*components\/ui\/Skeleton"/);
    expect(src).toMatch(/<SkeletonGroup label="/);
  });
  it("carries no animate-pulse", () => {
    expect(src).not.toContain("animate-pulse");
  });
});

it("brand.css shimmer animates transform on a pseudo-element, never background-position", () => {
  const css = readFileSync(path.join(REPO_ROOT, "app/brand.css"), "utf8");
  const after = css.match(/\.brand-skeleton::after\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(after).toMatch(/animation:\s*shimmer var\(--motion-shimmer\) linear infinite/);
  expect(css).not.toMatch(/\.brand-skeleton[^{]*\{[^}]*background-position/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run app/components/ui/__tests__/Skeleton.test.tsx app/utils/__tests__/loadingSkeletons.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the CSS**

In `app/brand.css`, before the `/* ---- Route reveal` comment from Task 5, insert:

```css
/* ---- Skeleton shimmer (spec §2.1 #2) ----------------------------------------
   The loading state shares the loaded state's gesture: a beam crosses each
   placeholder every --motion-shimmer. The sweep is a pseudo-element translating on
   the compositor; the block's own background never animates. `shimmer` keyframes
   are the Tailwind mirror's (tailwind.config.ts) so the CSS and the utility agree. */
.brand-skeleton {
  position: relative;
  overflow: hidden;
  background: rgb(var(--accent-deep-rgb) / 0.18);
}

.brand-skeleton::after {
  position: absolute;
  inset: 0;
  content: "";
  pointer-events: none;
  background: linear-gradient(100deg, transparent 20%, rgb(var(--accent-rgb) / 0.14) 50%, transparent 80%);
  animation: shimmer var(--motion-shimmer) linear infinite;
}
```

Because `shimmer` is declared as a Tailwind keyframe (Task 1) it is emitted only when a utility references it. Add the keyframe to `brand.css` as well so the class works without the utility:

```css
@keyframes shimmer {
  from { transform: translate3d(-100%, 0, 0); }
  to { transform: translate3d(100%, 0, 0); }
}
```

- [ ] **Step 4: Write `Skeleton`**

```tsx
// app/components/ui/Skeleton.tsx
// Shimmer placeholder (spec §4). NEUTRAL module — no hooks, no "use client" — so
// loading.tsx files, which are Server Components, render it as JSX. Sizing comes
// from Tailwind utilities on `className`; the sweep lives in brand.css.

import type { ComponentPropsWithoutRef } from "react";

const RADIUS = { sm: "rounded", md: "rounded-md", lg: "rounded-xl", full: "rounded-full" } as const;

type Props = ComponentPropsWithoutRef<"div"> & { rounded?: keyof typeof RADIUS };

export default function Skeleton({ className = "", rounded = "md", ...rest }: Props) {
  return <div aria-hidden="true" className={`brand-skeleton ${RADIUS[rounded]} ${className}`} {...rest} />;
}

/** One live region per loading surface, so a screen reader hears "cargando" once. */
export function SkeletonGroup({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the four loading files**

`app/(client)/loading.tsx`:

```tsx
import Skeleton, { SkeletonGroup } from "../components/ui/Skeleton";

export default function HomeLoading() {
  return (
    <SkeletonGroup label="Cargando servicios de la semana" className="mx-auto max-w-7xl px-6 pt-10 mb-12">
      <Skeleton className="h-8 w-40 mx-auto mb-6" rounded="lg" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="border border-surface-accent-faint rounded-xl overflow-hidden">
            <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="p-4 md:p-5 space-y-3">
              <Skeleton className="h-3 w-14" />
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="flex items-center gap-3 py-1">
                  <Skeleton className="w-4 h-3" />
                  <Skeleton className="h-4 flex-1" style={{ width: `${60 + (j * 7) % 30}%` }} />
                  <Skeleton className="h-4 w-8" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
```

`app/(client)/me/loading.tsx`:

```tsx
import Skeleton, { SkeletonGroup } from "../../components/ui/Skeleton";

export default function MeLoading() {
  return (
    <SkeletonGroup label="Cargando tu perfil" className="mx-auto max-w-7xl px-6 pt-10 mb-12 space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-56" />
      </div>
      <div className="border border-surface-accent-faint rounded-xl overflow-hidden">
        <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="p-4 md:p-5 space-y-3">
          {[1, 2, 3, 4].map((j) => (
            <div key={j} className="flex items-center gap-3 py-1">
              <Skeleton className="w-4 h-3" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-48" rounded="lg" />
        <Skeleton className="h-48" rounded="lg" />
      </div>
    </SkeletonGroup>
  );
}
```

`app/(client)/schedule/loading.tsx`:

```tsx
import Skeleton, { SkeletonGroup } from "../../components/ui/Skeleton";

export default function ScheduleLoading() {
  return (
    <SkeletonGroup label="Cargando el calendario" className="mx-auto max-w-7xl px-6 pt-10 mb-12 space-y-6">
      <Skeleton className="h-8 w-48" rounded="lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border border-surface-accent-faint rounded-xl overflow-hidden">
            <div className="bg-surface-accent-l20-d60-sunken px-5 py-4 border-b border-accent-deep/10 space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-3" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
```

`app/(client)/posts/[slug]/loading.tsx`:

```tsx
import Skeleton, { SkeletonGroup } from "../../../components/ui/Skeleton";

export default function PostLoading() {
  return (
    <SkeletonGroup label="Cargando la canción">
      {/* Navbar placeholder — the same height classes Navbar.tsx uses (h-20 lg:h-24 + safe area). */}
      <div className="h-[calc(5rem+env(safe-area-inset-top))] lg:h-[calc(6rem+env(safe-area-inset-top))] border-b border-surface-accent-20" />
      <div className="bg-surface-overlay border-b border-surface-accent-l100-d15">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-12 flex flex-col items-center text-center space-y-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10 w-2/3 max-w-xl" />
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-3 pt-4">
            <Skeleton className="h-7 w-14" rounded="full" />
            <Skeleton className="h-7 w-20" rounded="full" />
            <Skeleton className="h-7 w-14" rounded="full" />
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <Skeleton className="h-6 w-32 mx-auto" />
        {[1, 2, 3, 4, 5].map((j) => (
          <Skeleton key={j} className="h-4" />
        ))}
      </div>
    </SkeletonGroup>
  );
}
```

- [ ] **Step 6: Regenerate the colour inventory and run everything that reads these files**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/components/ui/__tests__/Skeleton.test.tsx app/utils/__tests__/loadingSkeletons.test.ts app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/brandCss.test.ts app/utils/__tests__/clientBoundary.test.ts && npx tsc --noEmit && npx eslint "app/(client)" app/components/ui/Skeleton.tsx`
Expected: PASS, 0 errors. `git status` shows `app/utils/__tests__/__fixtures__/colour-inventory.json` modified (the removed `bg-accent-deep/20` literals).

- [ ] **Step 7: Commit**

```bash
git add app/brand.css app/components/ui/Skeleton.tsx app/components/ui/__tests__/Skeleton.test.tsx app/utils/__tests__/loadingSkeletons.test.ts "app/(client)/loading.tsx" "app/(client)/me/loading.tsx" "app/(client)/schedule/loading.tsx" "app/(client)/posts/[slug]/loading.tsx" app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Skeleton shimmer replaces the four hand-copied pulse skeletons

The loading state shares the loaded state's gesture — a beam crossing each
placeholder — and each loading surface is one aria-busy status region."
```

---

### Task 7: `Button` primitive and its first two consumers

**Files:**
- Modify: `app/brand.css` (append `.brand-btn-sheen` before the skeleton block)
- Create: `app/components/ui/Button.tsx`
- Create: `app/components/ui/__tests__/Button.test.tsx`
- Modify: `app/components/ui/ThemeAnnouncement.tsx:59-66`
- Modify: `app/(client)/error.tsx:41-56`

**Interfaces:**
- Produces: `Button` (default export), neutral module. Props: `variant?: "primary" | "secondary" | "ghost" | "danger" | "icon" | "pill"` (default `secondary`), `size?: "sm" | "md" | "lg"` (default `md`), `busy?: boolean`, `busyLabel?: string`, `href?: string` (renders `next/link`), `active?: boolean` (pill only, sets `aria-pressed`), plus native button/anchor props. Exports `buttonClass(variant, size)` for the rare site that must style a foreign element.

- [ ] **Step 1: Write the failing test**

```tsx
/** @vitest-environment jsdom */
// app/components/ui/__tests__/Button.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button, { buttonClass } from "../Button";

afterEach(cleanup);

describe("Button", () => {
  it("defaults to a secondary, medium, type=button control with a visible focus ring", () => {
    render(<Button>Guardar</Button>);
    const b = screen.getByRole("button", { name: "Guardar" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.className).toContain("focus-visible:ring-2");
    expect(b.className).toContain("border-surface-accent-30");
    expect(b.className).toContain("active:translate-y-px");
  });

  it.each([
    ["primary", "bg-surface-accent-solid"],
    ["ghost", "text-mono-500"],
    ["danger", "bg-negative-surface/60"],
    ["icon", "w-9 h-9"],
    ["pill", "rounded-full"],
  ] as const)("variant %s carries its signature class", (variant, cls) => {
    render(<Button variant={variant} aria-label="x">x</Button>);
    expect(screen.getByRole("button").className).toContain(cls);
  });

  it("primary carries the hover sheen class; no other variant does", () => {
    expect(buttonClass("primary", "md")).toContain("brand-btn-sheen");
    expect(buttonClass("secondary", "md")).not.toContain("brand-btn-sheen");
  });

  it("size lg is the 44 px touch target", () => {
    render(<Button size="lg">Publicar</Button>);
    expect(screen.getByRole("button").className).toContain("min-h-[44px]");
  });

  it("busy sets aria-busy, swaps the label, and disables the control", () => {
    render(<Button busy busyLabel="Guardando…">Guardar</Button>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b).toHaveProperty("disabled", true);
    expect(b.textContent).toContain("Guardando…");
  });

  it("href renders a link with the same classes", () => {
    render(<Button href="/" variant="primary">Ir al inicio</Button>);
    const a = screen.getByRole("link", { name: "Ir al inicio" });
    expect(a.getAttribute("href")).toBe("/");
    expect(a.className).toContain("bg-surface-accent-solid");
  });

  it("pill exposes aria-pressed from `active`", () => {
    render(<Button variant="pill" active>Oscuro</Button>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("forwards onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ok</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/ui/__tests__/Button.test.tsx`
Expected: FAIL — `../Button` not found.

- [ ] **Step 3: Add the sheen CSS**

In `app/brand.css`, before the `/* ---- Skeleton shimmer` comment, insert:

```css
/* ---- Primary button sheen (spec §2.1 #3) ------------------------------------
   Pointer devices only: a narrow highlight crosses the fill ONCE on hover, never on
   tap, never repeated while hovered (the animation runs on :hover entry and holds
   at its end state because of `both`). Transform on a pseudo-element; the button
   itself never repaints. */
.brand-btn-sheen {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

.brand-btn-sheen::after {
  position: absolute;
  inset: 0;
  z-index: -1;
  content: "";
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(100deg, transparent 30%, rgb(var(--on-fill-rgb) / 0.18) 50%, transparent 70%);
  transform: translate3d(-100%, 0, 0);
}

@media (hover: hover) {
  .brand-btn-sheen:hover::after {
    opacity: 1;
    animation: shimmer 600ms var(--ease-out) both;
  }
}
```

(`--on-fill-rgb` is declared in `brand.css` — the composed `text-on-fill` token's base; `brandCss.test.ts` confirms it.)

- [ ] **Step 4: Write `Button`**

```tsx
// app/components/ui/Button.tsx
// The house button (spec §4, §19.3). NEUTRAL module — no hooks — so Server
// Components render it as JSX and client components pass it handlers.
//
// Six variants replace the ~6 inline spellings the inventory counted across 305
// <button>s. Physics live in utilities so the 300 adopters carry no JS: press is
// `active:translate-y-px active:scale-[0.985]` over --motion-fast; the primary sheen
// is a brand.css class gated on (hover: hover); focus is always visible.
//
// `busy` is the ONLY loading affordance: aria-busy + disabled + a label swap. Never
// a spinner beside a label that says nothing.

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon" | "pill";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 select-none font-label uppercase tracking-widest " +
  "transition-[color,background-color,border-color,transform,box-shadow] duration-fast ease-out-brand " +
  "active:translate-y-px active:scale-[0.985] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "brand-btn-sheen rounded-lg bg-surface-accent-solid text-on-fill hover:bg-accent-deep/80 dark:hover:bg-accent/30",
  secondary:
    "rounded-lg border border-surface-accent-30 text-ink hover:border-accent dark:hover:border-surface-accent-30",
  ghost: "rounded-lg text-mono-500 hover:text-accent",
  danger: "rounded-lg bg-negative-surface/60 text-ink hover:bg-negative-border/60",
  icon: "rounded-lg w-9 h-9 p-0 text-mono-500 hover:text-accent hover:bg-surface-lift/5",
  pill: "rounded-full border border-surface-accent-30 text-mono-500 hover:text-accent aria-pressed:border-accent aria-pressed:text-accent aria-pressed:bg-accent/10",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-[11px] px-3 py-1",
  md: "text-xs px-4 py-2",
  lg: "text-xs px-4 min-h-[44px]",
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize, extra = ""): string {
  const s = variant === "icon" ? (size === "lg" ? "min-h-[44px] min-w-[44px]" : "") : SIZE[size];
  return `${BASE} ${VARIANT[variant]} ${s} ${extra}`.replace(/\s+/g, " ").trim();
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  busyLabel?: string;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
};

type ButtonProps = Common & Omit<ComponentPropsWithoutRef<"button">, "className" | "children"> & { href?: undefined };
type LinkProps = Common & Omit<ComponentPropsWithoutRef<"a">, "className" | "children"> & { href: string };

export default function Button(props: ButtonProps | LinkProps) {
  const { variant = "secondary", size = "md", busy = false, busyLabel, active, className = "", children } = props;
  const cls = buttonClass(variant, size, className);
  const label = busy && busyLabel ? busyLabel : children;

  if ("href" in props && typeof props.href === "string") {
    const { href, variant: _v, size: _s, busy: _b, busyLabel: _bl, active: _a, className: _c, children: _ch, ...rest } = props;
    return (
      <Link href={href} className={cls} aria-pressed={variant === "pill" ? active : undefined} {...rest}>
        {label}
      </Link>
    );
  }

  const { variant: _v, size: _s, busy: _b, busyLabel: _bl, active: _a, className: _c, children: _ch, type = "button", disabled, ...rest } =
    props as ButtonProps;
  return (
    <button
      type={type}
      className={cls}
      aria-busy={busy || undefined}
      aria-pressed={variant === "pill" ? active : undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {label}
    </button>
  );
}
```

`aria-pressed:` variants require Tailwind ≥ 3.2 (`aria-*` variants are built in); the repo is on Tailwind 3.x — confirm with `npx tailwindcss --help | head -1` if the pill test fails on class output.

- [ ] **Step 5: Adopt in `ThemeAnnouncement`**

In `app/components/ui/ThemeAnnouncement.tsx`, add `import Button from "./Button";` after the react import, and replace the dismiss `<button …>Ocultar</button>` (lines ~59–66) with:

```tsx
      <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Descartar aviso" className="shrink-0">
        Ocultar
      </Button>
```

- [ ] **Step 6: Adopt in `error.tsx`**

In `app/(client)/error.tsx`, replace `import Link from "next/link";` with `import Button from "../components/ui/Button";`, and replace the two controls in the `flex items-center gap-3` div with:

```tsx
        <Button variant="primary" onClick={reset}>
          Reintentar
        </Button>
        <Button href="/">Ir al inicio</Button>
```

- [ ] **Step 7: Regenerate the inventory, run the tests and gates**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/components/ui/__tests__/Button.test.tsx app/components/ui/__tests__/ThemeAnnouncement.test.tsx app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/lightContrast.test.ts app/utils/__tests__/clientBoundary.test.ts && npx tsc --noEmit && npx eslint app/components/ui "app/(client)/error.tsx"`
Expected: PASS, 0 errors. (If `ThemeAnnouncement.test.tsx` does not exist, drop it from the list.)

- [ ] **Step 8: Commit**

```bash
git add app/brand.css app/components/ui/Button.tsx app/components/ui/__tests__/Button.test.tsx app/components/ui/ThemeAnnouncement.tsx "app/(client)/error.tsx" app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "feat(motion): Button primitive — six variants, press physics, primary sheen, busy state

Replaces the ~6 inline spellings the inventory counted. Adopted first by
ThemeAnnouncement and the client error page; every later phase migrates the
buttons on its own routes."
```

---

### Task 8: Shell polish — lockup `priority`, initials contrast

**Files:**
- Modify: `app/components/Navbar.tsx:23-29`
- Modify: `app/components/NavMenu.tsx:129-131`
- Create: `app/utils/__tests__/shellPolish.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```ts
// app/utils/__tests__/shellPolish.test.ts
// Spec Part III findings 3 and 5: the brand mark lazy-loaded (an empty square on
// every first paint) and the initials avatar painted navy-on-navy in light.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Navbar lockup", () => {
  it("loads the brand mark with priority — it is the first thing on every page", () => {
    const src = read("app/components/Navbar.tsx");
    const img = src.match(/<Image[\s\S]*?brand-lockup-mark[\s\S]*?\/>/)?.[0] ?? "";
    expect(img).toMatch(/\bpriority\b/);
  });

  it("drops the inert height transition nothing ever changed", () => {
    expect(read("app/components/Navbar.tsx")).not.toMatch(/transition-\[height\]/);
  });
});

describe("NavMenu initials avatar", () => {
  it("paints initials in the on-fill role, which stays light on the solid disc in both themes", () => {
    const src = read("app/components/NavMenu.tsx");
    const disc = src.match(/bg-surface-accent-solid[\s\S]*?<span className="([^"]*)">\{initials\}/)?.[1] ?? "";
    expect(disc).toContain("text-on-fill");
    expect(disc).not.toContain("text-accent");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/utils/__tests__/shellPolish.test.ts`
Expected: FAIL on all three.

- [ ] **Step 3: Fix `Navbar.tsx`**

Replace the `<Image …/>` for the lockup with:

```tsx
          <Image
            src="/icons/backstage-v2-192.png"
            alt=""
            width={64}
            height={64}
            // The first thing on every page. `priority` = eager + fetchpriority=high,
            // so it never paints as an empty rounded square first (spec Part III #3).
            priority
            className="brand-lockup-mark h-12 w-12 rounded-[14px] lg:h-16 lg:w-16 lg:rounded-[18px]"
          />
```

and change the inner bar's class string `"relative z-[1] mx-auto max-w-7xl h-20 lg:h-24 transition-[height] duration-300 flex …"` to `"relative z-[1] mx-auto max-w-7xl h-20 lg:h-24 flex …"` (remove `transition-[height] duration-300` only).

- [ ] **Step 4: Fix `NavMenu.tsx`**

Change line 130 from `<span className="font-label text-xs text-accent">{initials}</span>` to:

```tsx
            <span className="font-label text-xs text-on-fill">{initials}</span>
```

- [ ] **Step 5: Run the test and the guards that read these two files**

Run: `node scripts/colour-inventory.mjs && npx vitest run app/utils/__tests__/shellPolish.test.ts app/utils/__tests__/colourInventory.test.ts app/utils/__tests__/lightContrast.test.ts app/utils/__tests__/impersonationOffsetSync.test.ts && npx tsc --noEmit && npx eslint app/components/Navbar.tsx app/components/NavMenu.tsx`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/Navbar.tsx app/components/NavMenu.tsx app/utils/__tests__/shellPolish.test.ts app/utils/__tests__/__fixtures__/colour-inventory.json
git commit -m "fix(shell): load the brand mark with priority; initials avatar readable in light

The lockup lazy-loaded and painted as an empty square on first paint in 9 of
22 captures; the initials disc painted navy text on a navy fill in light."
```

---

### Task 9: Raw-motion literal guard

**Files:**
- Create: `app/utils/__tests__/rawMotionLiterals.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Measure the baseline**

Run:

```bash
grep -rn 'transition-all' app --include='*.tsx' | grep -v __tests__ | grep -v 'app/components/ui/' | wc -l
grep -rno 'duration-[0-9]\+' app --include='*.tsx' | grep -v __tests__ | grep -v 'app/components/ui/' | wc -l
```

Expected after Tasks 7–8: `13` and `12` (Task 8 removed one `duration-300`). Use the printed numbers in Step 2.

- [ ] **Step 2: Write the test (it passes on the baseline; it FAILS on growth)**

```ts
// app/utils/__tests__/rawMotionLiterals.test.ts
// Spec §2.2 "durations from tokens, never literals". Outside app/components/ui/**
// a raw `duration-N` or `transition-all` is the pre-M0 spelling. This pins the
// count at the audited baseline so a new site fails while the backlog is paid down
// phase by phase (each phase LOWERS the numbers here in the same commit).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Audited 2026-09-08 after M0a Task 8. LOWER freely; never raise.
const BASELINE = { transitionAll: 13, rawDuration: 12 };

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (rel.includes("__tests__") || rel.startsWith(path.join("app", "components", "ui"))) continue;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith(".tsx")) out.push(rel);
    }
  };
  walk("app");
  return out;
}

export function countRawMotion(files = tsxFiles()) {
  let transitionAll = 0;
  let rawDuration = 0;
  const sites: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const a = src.match(/\btransition-all\b/g)?.length ?? 0;
    const d = src.match(/\bduration-\d+\b/g)?.length ?? 0;
    transitionAll += a;
    rawDuration += d;
    if (a || d) sites.push(`${rel} (transition-all×${a}, duration-N×${d})`);
  }
  return { transitionAll, rawDuration, sites };
}

describe("raw motion literals outside app/components/ui", () => {
  const found = countRawMotion();

  it("transition-all does not grow past the audited baseline", () => {
    expect(found.transitionAll, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE.transitionAll);
  });

  it("raw duration-N does not grow past the audited baseline", () => {
    expect(found.rawDuration, found.sites.join("\n")).toBeLessThanOrEqual(BASELINE.rawDuration);
  });

  it("the baseline is not stale — lower it when a phase pays down sites", () => {
    // Equality, so a phase that removes sites must also lower BASELINE in the same
    // commit; otherwise the guard silently gains headroom.
    expect(found.transitionAll).toBe(BASELINE.transitionAll);
    expect(found.rawDuration).toBe(BASELINE.rawDuration);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run app/utils/__tests__/rawMotionLiterals.test.ts`
Expected: PASS. If the equality case fails, replace `BASELINE` with the numbers Step 1 printed and re-run.

- [ ] **Step 4: Commit**

```bash
git add app/utils/__tests__/rawMotionLiterals.test.ts
git commit -m "test(motion): pin raw transition-all / duration-N counts outside ui/

Each later phase lowers the baseline in the same commit it migrates a route;
a new raw literal fails here instead of shipping."
```

---

### Task 10: ADR-0031, `docs/MOTION.md`, doc indexes, bundle baseline

**Files:**
- Create: `docs/adr/0031-motion-library-under-an-ios-15-floor.md`
- Modify: `docs/adr/README.md` (append one list line)
- Create: `docs/MOTION.md`
- Modify: `docs/README.md` (append table row 12)
- Modify: `docs/UTILITIES_AND_COMPONENTS.md` (new `### Motion primitives (\`app/components/ui/\`)` table before `### Admin panels`)
- Modify: `CLAUDE.md` ("Reusable utils" paragraph; "Don't-break-these" gets one line)

- [ ] **Step 1: Measure the bundle before and after**

Run on the merge-base first, then on this branch:

```bash
git stash list >/dev/null; BASE=$(git merge-base HEAD main)
git worktree add -f /tmp/owt-bundle-base "$BASE" && cd /tmp/owt-bundle-base && cp -Rc "$OLDPWD/node_modules" . && ln -s "$OLDPWD/.env.local" .env.local && npx next build 2>&1 | grep -E "First Load JS|^┌|^├ ○ /$|^├ ƒ /admin" | head -8; cd "$OLDPWD"; git worktree remove --force /tmp/owt-bundle-base
npx next build 2>&1 | grep -E "First Load JS|^┌|^├ ○ /$|^├ ƒ /admin" | head -8
```

Record the two "First Load JS shared by all" figures and the `/` and `/admin` rows. Expected delta: ≤ 20 kB (motion's `domAnimation` feature set ≈ 18 kB gz). If the delta exceeds 25 kB, stop and report — the programme's whole cap is 25 kB.

- [ ] **Step 2: Write ADR-0031**

```markdown
# ADR-0031: Motion goes through one lazily loaded library, under an iOS 15 floor

**Date:** 2026-09-08 · **Status:** Accepted

## Context

The app had no motion system: two duration tokens, one keyframe, one reduced-motion
rule, a dialog that mounted and unmounted instantly, 305 inline-styled buttons and 13
hand-rolled toasts (spec `docs/superpowers/specs/2026-09-08-premium-motion-design.md`
§1). The three things that separate "premium" from "has transitions" — exits that
complete, interruptions that reverse smoothly, elements that slide between states — are
exactly what CSS alone makes expensive: an exit needs a "closing" state and an
`animationend` handshake, an interruption snaps, a shared-element indicator needs
measurement on every render.

The browser floor is iOS 15 (ADR-0030): no View Transitions API, no `@starting-style`,
no scroll-driven animations.

## Decision

`motion` 13.x, loaded once through `app/components/ui/MotionProvider.tsx`
(`LazyMotion features={domAnimation} strict` + `MotionConfig reducedMotion="user"`),
and importable ONLY from `app/components/ui/**` and `app/utils/motion*`
(`motionImportBoundary.test.ts`). Feature components compose primitives — `Presence`,
`Collapse`, `SegmentedControl`, `Toast`, `Menu`, `CueDialog` — and never `m.*`.

Static motion stays in CSS: press, hover, focus, the route reveal, the skeleton
shimmer. Tokens live in `brand.css` `:root` (`--motion-*`, `--ease-*`) with a Tailwind
mirror (`motionTokens.test.ts`). Only `transform` and `opacity` animate.

Bundle: measured in `docs/MOTION.md`; the whole programme is capped at +25 kB gz on
first-load JS.

## Rejected

**CSS only, with hand-rolled `usePresence` and `useFlip` hooks.** Zero dependencies and
it covers enter/exit, press, sheets. It fails on interruption (open→close mid-flight
snaps), on `layoutId`-style shared indicators, and it grows a private animation library
the repo owns forever. jsdom has no `element.animate`, so every hook needs an
environment guard in tests.

**`@react-spring/web`.** Comparable physics, no `AnimatePresence` or `layoutId`
equivalent without extra code, larger surface for the team to learn.

**Importing `motion` wherever it is convenient.** One `motion.div` in a feature
component pulls the full bundle past `LazyMotion` (that is what `strict` throws on) and
puts a second clock in the app. The boundary test is what makes the dependency safe.

## Consequences

- A new animated pattern is a new primitive under `ui/`, with a test that runs under
  `MotionGlobalConfig.skipAnimations` and a gallery fixture. Never an `m.div` in a page.
- `reducedMotion="user"` plus the global CSS rule means Reduce Motion in iOS Settings
  calms the whole app; nothing needs a per-effect opt-out.
- Raising the iOS floor would unlock View Transitions for route exits (decision C
  in the spec chose enter-only for this reason); this ADR does not preclude that.
- Removing the library means rewriting every `ui/` primitive that uses `Presence`
  semantics; the boundary test lists exactly which files those are.
```

Append to `docs/adr/README.md`:

```markdown
- [ADR-0031: Motion goes through one lazily loaded library, under an iOS 15 floor](0031-motion-library-under-an-ios-15-floor.md) — why `motion` and not CSS-only hooks, why it is importable only from `ui/`, and what the reduced-motion contract is
```

- [ ] **Step 3: Write `docs/MOTION.md`**

```markdown
# Motion

The motion system introduced by `docs/superpowers/specs/2026-09-08-premium-motion-design.md`
and ADR-0031. This is the reference; the spec is the argument.

## Tokens (`app/brand.css` `:root`, mirrored in `tailwind.config.ts`)

| Token | Value | Utility | Use |
|---|---|---|---|
| `--motion-fast` | 120ms | `duration-fast` | colour, hover, focus ring |
| `--motion-base` | 200ms | `duration-base` | press, toggles, menus, small reveals |
| `--motion-slow` | 320ms | `duration-slow` | sheets, dialogs, tab panels, collapse |
| `--motion-reveal` | 480ms | `duration-reveal` | route reveal, hero rail |
| `--motion-shimmer` | 1600ms | `animate-shimmer` | skeleton sweep period |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | `ease-out-brand` | every enter |
| `--ease-in` | cubic-bezier(0.4, 0, 1, 1) | `ease-in-brand` | every exit |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | `ease-in-out-brand` | crossfades |
| `--motion-rise` | 8px | — | enter travel |
| `--motion-sink` | 1px | — | press travel |

JS twins: `app/utils/motionPresets.ts` (`MS`, `EXIT_MS`, `SPRINGS`, `VARIANTS`).
Guard: `app/utils/__tests__/motionTokens.test.ts`.

## Rules

1. **Only `transform` and `opacity` animate.** `Collapse` (M0b) is the one exception,
   on user-triggered disclosures only.
2. **Tokens, never literals.** `rawMotionLiterals.test.ts` pins `transition-all` and
   `duration-N` counts outside `ui/`; lower the baseline when you migrate a route.
3. **`motion` is imported only under `app/components/ui/**` and `app/utils/motion*`.**
   `motionImportBoundary.test.ts`. Compose a primitive instead.
4. **Reduced motion is global.** `@media (prefers-reduced-motion: reduce)` in
   `brand.css` and `reducedMotion="user"` in `MotionProvider`. Do not add per-effect
   opt-outs. `html[data-motion="off"]` is the same collapse for the theme gallery.
5. **Never transform an ancestor of a `position: fixed` element.** `template.tsx`
   renders a fragment for this reason (`reveal.test.ts`). Toasts and FABs portal.
6. **Enter fast, exit faster.** Enter 200–320 ms `--ease-out`; exit 120–160 ms `--ease-in`.
7. **Every hover effect has a press twin.** Hover-only choreography (sheen, lift) is
   gated on `@media (hover: hover)`.

## Primitives (`app/components/ui/`)

| Primitive | Module kind | Use |
|---|---|---|
| `MotionProvider` | client | mounted once in `app/utils/Provider.tsx` |
| `Presence` | client | `<Presence show={open} variant="rise">` — exit before unmount |
| `Skeleton`, `SkeletonGroup` | neutral | loading placeholders with the shimmer |
| `Button` | neutral | `variant` primary/secondary/ghost/danger/icon/pill · `size` sm/md/lg · `busy` · `href` |
| `revealProps(i)` (`app/utils/reveal.ts`) | neutral | spread on a block a page reveals; `template.tsx` replays it per navigation |

M0b adds: `CueDialog` motion, `Toast`, `Menu`, `Collapse`, `SegmentedControl`,
`SlidingIndicator`, `Switch`, `Checkbox`, `Select`, `DateField`, `NumberRoll`, `haptics`.

## Testing a primitive

```ts
/** @vitest-environment jsdom */
import { installMotionTestEnv } from "./motionTestSetup";
installMotionTestEnv(); // matchMedia stub + MotionGlobalConfig.skipAnimations
```

Assert final state, never timing. Wrap in `<MotionProvider>`.

## Bundle

| Build | First Load JS shared | `/` | `/admin` |
|---|---|---|---|
| Before M0a (merge-base `<sha>`) | `<kB>` | `<kB>` | `<kB>` |
| After M0a | `<kB>` | `<kB>` | `<kB>` |

Programme cap: +25 kB gz total. `motion` resolved the `MotionGlobalConfig` export from
`motion/react` (or `motion` — record which).

## Where the walk's findings landed

Part III of the spec catalogues every element. M0a closes findings 3 (lockup priority)
and 5 (initials contrast) — `shellPolish.test.ts`.
```

Fill the bundle table with the numbers from Step 1 and the export spelling from Task 3 Step 1 before committing (no `<…>` placeholders may remain — verify with `grep -n '<sha>\|<kB>' docs/MOTION.md`, expected empty).

- [ ] **Step 4: Index rows**

Append to the table in `docs/README.md` after row 11:

```markdown
| 12 | [`MOTION.md`](MOTION.md) | The motion system: tokens, the seven rules, the `ui/` primitives, how to test one, the bundle ledger. |
```

In `docs/UTILITIES_AND_COMPONENTS.md`, before `### Admin panels`, insert:

```markdown
### Motion primitives (`app/components/ui/`, see [MOTION.md](MOTION.md))
| Component | Purpose |
|-----------|---------|
| `MotionProvider` [C] | Loads `motion`'s DOM features once; `reducedMotion="user"`. |
| `Presence` [C] | Mount/unmount with an exit animation; variants `fade` `rise` `scale` `sheet`. |
| `Skeleton` / `SkeletonGroup` [N] | Shimmer placeholders; one `aria-busy` status region per loading surface. |
| `Button` [N] | The house button: six variants, three sizes, press physics, primary sheen, `busy`, `href`. |
| `revealProps()` (`app/utils/reveal.ts`) [N] | CSS route reveal; `app/(client)/template.tsx` replays it per navigation. |

[N] = neutral module (no `"use client"`, no hooks) — renderable from either side (ADR-0028).
```

In `CLAUDE.md`, in the "Reusable utils (don't reinvent)" paragraph, append after the `useTransientValue` entry:

```
`Button` (`app/components/ui/Button.tsx` — the ONLY button; six variants, never an inline
class string), `Presence` (every animated conditional), `Skeleton`/`SkeletonGroup` (every
loading placeholder), `revealProps` (route reveal). Motion tokens are `--motion-*` /
`--ease-*`; `motion` is importable only under `app/components/ui/**` — see `docs/MOTION.md`
and ADR-0031.
```

and in "Don't-break-these invariants" add:

```
- **`app/(client)/template.tsx` renders a fragment, never a wrapper.** A transformed
  ancestor is a containing block for every `position: fixed` descendant (FAB, audio
  transport, toasts). `reveal.test.ts` is the guard.
```

- [ ] **Step 5: Run the docs-touching guards and the full gate**

Run: `npx vitest run app/utils/__tests__/themeWiring.test.ts app/utils/__tests__/vendoredSkillDigest.test.ts 2>/dev/null; npx tsc --noEmit && npm test && npx eslint .`
Expected: 0 type errors; all tests pass; eslint 0 errors (warnings are the backlog).

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0031-motion-library-under-an-ios-15-floor.md docs/adr/README.md docs/MOTION.md docs/README.md docs/UTILITIES_AND_COMPONENTS.md CLAUDE.md
git commit -m "docs(motion): ADR-0031, MOTION.md, and the primitive inventory

Records why motion (lazy, ui/-only), the seven rules, the four M0a primitives,
how to test one, and the measured bundle delta."
```

---

### Task 11: Delivery — preview, verify, review, PR

- [ ] **Step 1: Merge into `preview` and push**

```bash
git checkout preview && git pull --ff-only origin preview && git merge --no-ff claude/premium-ui-animations-7e0204 -m "merge: motion M0a foundation into preview" && git push origin preview && git rev-parse HEAD
```

- [ ] **Step 2: Verify the dev alias moved** — dispatch the `deploy-verifier` agent with the SHA from Step 1 and the domain `dev-owt-backstage.vercel.app`; it must report the domain in `alias` and `meta.githubCommitSha` equal to the SHA. Retry ≥30 s apart up to three times; never a bash watcher.

- [ ] **Step 3: Human-eyes step on dev**

```bash
npx tsx --env-file=.env.local scripts/dev-verify.ts --route / --screenshot m0a-home-dark.png --viewport 1440x900 --theme dark
npx tsx --env-file=.env.local scripts/dev-verify.ts --route / --screenshot m0a-home-light.png --viewport 390x844 --theme light
npx tsx --env-file=.env.local scripts/dev-verify.ts --route /me --screenshot m0a-me.png --viewport 390x844 --theme dark --text
```

Confirm: the lockup is painted in every capture; the initials disc (light, phone) shows readable initials; the `/me` text artifact contains "Ocultar". Reduced motion: in the local dev server, emulate `prefers-reduced-motion: reduce` (browser tool `resize_window` with `colorScheme`, or DevTools rendering) and confirm `[data-reveal]` computed `animation-duration` is `0.01ms`.

- [ ] **Step 4: Fresh code review of the merge range** — dispatch `code-reviewer` on `main..claude/premium-ui-animations-7e0204` with the spec path and this plan path; it also carries the docs-audit checklist (bundle table filled, no placeholders, CLAUDE.md line present) and the worklog-completeness check. Fix findings; re-run gates on the final tree; scoped re-review of the fix range. The last worklog entry before the merge must be a verification, not a fix.

- [ ] **Step 5: PR to `main`**

```bash
gh pr create --base main --head claude/premium-ui-animations-7e0204 --title "feat(motion): M0a foundation — tokens, reduced motion, motion provider, Presence, Reveal, Skeleton, Button" --body "Implements docs/superpowers/plans/2026-09-08-motion-m0a-foundation.md (spec: docs/superpowers/specs/2026-09-08-premium-motion-design.md, decisions A, C, N-guard).

- Motion tokens in brand.css + Tailwind mirror; one global reduced-motion rule; gallery motion-off switch
- motion 13 behind MotionProvider (LazyMotion strict, reducedMotion=user) with an import-boundary test
- Presence, Reveal (template.tsx + revealProps), Skeleton (four loading skeletons), Button (two consumers)
- Shell: lockup priority, initials contrast
- Guards: motionTokens, motionImportBoundary, reveal, loadingSkeletons, shellPolish, rawMotionLiterals
- ADR-0031, docs/MOTION.md with the bundle ledger

Verified on dev-owt-backstage (alias + SHA), screenshots in the PR thread."
```

Wait for the `gates` check; merge; verify the production alias the same way as Step 2 with `owt-backstage.vercel.app`.

- [ ] **Step 6: Worklog** — append the dispatch entries (deploy-verifier ×2, code-reviewer ×N, any implementation-worker dispatches, `coordinator-inline` for inline work) to `.agents/log/worklog.jsonl` in the primary checkout.

---

## Self-review

**Spec coverage (M0 scope per §6 and §20):** tokens ✔ (T1), global reduced-motion ✔ (T2), gallery `data-motion="off"` ✔ (T2), `motion` + provider ✔ (T3), import boundary ✔ (T3), Presence ✔ (T4), Reveal + template ✔ (T5), Skeleton + loading skeletons ✔ (T6), Button ✔ (T7), lockup priority + initials ✔ (T8), raw-duration scan ✔ (T9), ADR-0031 + MOTION.md + inventories ✔ (T10), bundle baseline ✔ (T10 Step 1). **Deferred to M0b** (own plan): CueDialog motion + drag-to-dismiss + `closing` state, Toast/useToast, Menu, Collapse, SegmentedControl, SlidingIndicator, Switch, Checkbox, Select, DateField, NumberRoll, haptics, the `controls` gallery fixture, the label-budget test, `bottomNavOffsetSync`. `strict` on `LazyMotion` is the runtime twin of the boundary test.

**Placeholders:** `docs/MOTION.md` bundle table uses `<sha>`/`<kB>` as fill-in markers and Step 3 of Task 10 requires them replaced and greps for them. No other TBD/TODO.

**Type consistency:** `revealProps` returns `{ "data-reveal": ""; style: { "--reveal-i": number } }` in T5 test and impl; `Presence` props `show/variant/as/onExited` match test and impl; `Button` `variant/size/busy/busyLabel/href/active` and `buttonClass(variant, size, extra?)` match test and impl; `SkeletonGroup({ label, children, className })` matches; `installMotionTestEnv()` name matches across T4; `MOTION_TOKENS` values in T1 test equal the CSS in T1 Step 3 and the `docs/MOTION.md` table.
