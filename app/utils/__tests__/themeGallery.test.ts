// Theme gallery contract guard (Child A2).
//
// Covers what can be asserted WITHOUT a browser. The three occlusion assertions —
// "the intended subject is the topmost PAINTED body child" — need real layout and
// paint, so they live in the VR harness or, under A2's recommended default, in a
// recorded manual verification. jsdom cannot substitute: it performs no layout, so it
// could only produce the DOM-order check A2 explicitly rejects.
//
// What IS asserted here is the contract an implementer could otherwise quietly break:
// the theme class, the font variables, the `<body>` backdrop, the enumerated segments,
// and — most importantly — that the route stays GATED.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { middlewareRuns } from "../routeMatcher";
import { stripComments, syntaxFor } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GALLERY = "app/(gallery)/theme-gallery/[theme]";

/** Raw source, for asserting on prose and structure alike. */
function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * Source with comments blanked — for any assertion of the form "this file does NOT
 * reference X". These files EXPLAIN why they avoid `Provider`, `useSession` and the
 * `(admin)` globals, so a raw-text check matches the explanation and fails. Reusing
 * A1's `stripComments` is the same fix A1 applied to the inventory for the same reason.
 */
function code(rel: string): string {
  return stripComments(read(rel), { syntax: syntaxFor(rel) });
}

describe("theme gallery — it is GATED, and that is the whole auth story", () => {
  it("every gallery path runs the auth middleware", () => {
    for (const p of [
      "/theme-gallery/dark/swatches",
      "/theme-gallery/light/planner",
      "/theme-gallery/sample/sample", // what routeMatcher's on-disk walk produces
    ]) {
      expect(middlewareRuns(p), `${p} must be gated`).toBe(true);
    }
  });

  it("is NOT under /auth/, which the matcher excludes", () => {
    // Both placements need no matcher edit, so "no matcher edit" justified neither.
    // Gating is the deliberate choice — this asserts the choice held.
    expect(middlewareRuns("/auth/theme-gallery/dark")).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, "app/(gallery)/auth"))).toBe(false);
  });

  it("adds no PUBLIC_ROUTES entry — routeMatcher.test.ts stays green unedited", () => {
    // If the gallery ever needs an entry there, the placement is wrong. That entry is
    // the signal, not the fix.
    expect(read("app/utils/__tests__/routeMatcher.test.ts")).not.toContain("theme-gallery");
  });
});

describe("theme gallery — the root layout contract", () => {
  const layout = read(`${GALLERY}/layout.tsx`);
  const layoutCode = code(`${GALLERY}/layout.tsx`);

  it("applies the theme to <html> from the route param", () => {
    expect(layout).toMatch(/className=\{`\$\{theme\}/);
  });

  it("applies all three font .variable classes — absent them every baseline is at fallback metrics", () => {
    for (const f of ["displayFont.variable", "bodyFont.variable", "labelFont.variable"]) {
      expect(layout).toContain(f);
    }
  });

  it("carries brand-atmosphere on <body> — 14 of the 15 classes composite over it", () => {
    // `.brand-atmosphere` IS the page wash. Without it the swatches paint over the bare
    // UA canvas, and step 4's "lightest rendered brand-atmosphere point in dark" — the
    // AA gate's own input — is not observable at all.
    expect(layout).toMatch(/<body className="[^"]*brand-atmosphere[^"]*"/);
    // Re-pointed at B-final. The gallery sits OUTSIDE the colour inventory — it is a
    // verification surface, not product colour — so its two retired utilities were never
    // B rows and no generated count would have caught them. Only a grep for remaining
    // USES did, which is why B-final runs one in addition to its three gates.
    expect(layout).toMatch(/<body className="[^"]*bg-surface-base[^"]*"/);
  });

  it("imports the (client) globals, not the (admin) ones", () => {
    // `(admin)/globals.css` is three bare @tailwind directives and carries none of the
    // @layer base font bindings.
    expect(layoutCode).toContain("(client)/globals.css");
    expect(layoutCode).not.toContain("(admin)/globals.css");
  });

  it("does NOT import Provider — it would fetch on mount and force dark", () => {
    // `(client)/layout.tsx` renders ActivityPing, which fetches. And next-themes 0.4.6
    // makes a nested ThemeProvider a pass-through, so forcedTheme would be
    // un-overridable — defeating the route's entire purpose.
    expect(layoutCode).not.toMatch(/from ["'].*utils\/Provider["']/);
  });
});

describe("theme gallery — segment validation", () => {
  const page = read(`${GALLERY}/[fixture]/page.tsx`);

  it("sets dynamicParams = false — generateStaticParams ALONE does not 404", () => {
    // dynamicParams defaults to true, and an unlisted segment would then render on
    // demand, reflecting arbitrary input into a root class attribute.
    expect(page).toMatch(/export const dynamicParams = false/);
    expect(page).toContain("generateStaticParams");
  });

  it("enumerates exactly two themes and three fixtures", () => {
    expect(read(`${GALLERY}/layout.tsx`)).toContain('["dark", "light"] as const');
    expect(page).toContain('["swatches", "dialog", "planner"] as const');
  });

  it("also calls notFound() for an unknown value reaching the component", () => {
    expect(page).toContain("notFound()");
  });
});

describe("theme gallery — the fixtures are hermetic", () => {
  const names = ["SwatchesFixture", "DialogFixture", "PlannerFixture"] as const;
  const files = names.map((f) => read(`${GALLERY}/[fixture]/fixtures/${f}.tsx`));
  const codes = names.map((f) => code(`${GALLERY}/[fixture]/fixtures/${f}.tsx`));

  it("no fixture reads a session, fetches, or touches next-auth", () => {
    for (const src of codes) {
      expect(src).not.toMatch(/useSession|next-auth/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });

  it("the planner fixture ACTIVATES full screen — it is not a prop", () => {
    // `fullScreen` is useState(false) at PlannerGrid.tsx:553, entered only via the
    // toggle at :1823. A static render never reaches createPortal(surface,
    // document.body) — the one path worth baselining.
    const planner = files[2];
    expect(planner).toContain("data-planner-fullscreen");
    expect(planner).toContain(".click()");
  });

  it("PlannerGrid.tsx itself is unmodified — no fullScreen prop was added", () => {
    const src = code("app/components/admin/PlannerGrid.tsx");
    expect(src).toMatch(/const \[fullScreen, setFullScreen\] = useState\(false\)/);
    expect(src).not.toMatch(/fullScreen\??:\s*boolean;/); // not in PlannerGridProps
  });

  it("the dialog fixture mounts CueDialogProvider directly, not Provider", () => {
    expect(codes[1]).toContain("CueDialogProvider");
    expect(codes[1]).not.toMatch(/utils\/Provider/);
  });
});
