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
// and — most importantly — that the route stays INERT. It is PUBLIC as of
// ADR-0017; what protects it is that it reads nothing, not that it is gated.

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

describe("theme gallery — it is PUBLIC, and inertness is the whole auth story", () => {
  // SUPERSEDED BY ADR-0017. Child A2 chose to gate this route and left these
  // assertions to force a conversation before anyone opened it. That worked —
  // the conversation happened, over seven adversarial review rounds — so these
  // are REWRITTEN to record the new decision rather than deleted. A2's reasoning
  // was tier-and-cost (gating let it drop four containment mechanisms and ship at
  // Standard), not a property of the route.

  it("every gallery path is PUBLIC — no session required", () => {
    for (const p of [
      "/theme-gallery/dark/swatches",
      "/theme-gallery/light/planner",
      "/theme-gallery/sample/sample", // what routeMatcher's on-disk walk produces
    ]) {
      expect(middlewareRuns(p), `${p} must be public`).toBe(false);
    }
  });

  it("opens the SEGMENT, not the prefix", () => {
    // The `(?:/|$)` anchor is the difference between opening a route and opening
    // everything that starts with its name.
    expect(middlewareRuns("/theme-gallery-secrets")).toBe(true);
    expect(middlewareRuns("/theme-galleryX")).toBe(true);
    expect(middlewareRuns("/a/theme-gallery/x")).toBe(true);
  });

  it("is still NOT under /auth/ — the rejected alternative", () => {
    // Placing it under the already-excluded /auth/ prefix would have produced
    // IDENTICAL exposure while hiding it from the auth boundary. ADR-0017 takes
    // the visible route on purpose.
    expect(existsSync(path.join(REPO_ROOT, "app/(gallery)/auth"))).toBe(false);
  });

  it("carries a PUBLIC_ROUTES entry, and that entry is the DECISION", () => {
    // A2's version asserted the opposite — that no such entry existed, because
    // "that entry is the signal, not the fix". It is now the fix, and the signal
    // to watch for is an entry with no ADR behind it.
    const rm = read("app/utils/__tests__/routeMatcher.test.ts");
    expect(rm).toContain('"/theme-gallery/sample/sample"');
    expect(rm, "the entry must carry its rationale").toContain("ADR-0017");
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
    // makes a nested ThemeProvider a pass-through, so the app's theme would be
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

  // WIDENED at ADR-0017. This guard is now the entire disclosure argument: the
  // route is public, so "it reads nothing" is what protects it, and the previous
  // version checked only the three FIXTURE files for only two patterns. It missed
  // layout.tsx, page.tsx, and any Sanity client entirely.
  //
  // STATED LIMIT, so nobody reads more into it than it checks: this is one level
  // deep. It would not catch a fixture importing a component that fetches. That
  // gap is bounded today — every API route stays gated, so a client-side fetch
  // from an anonymous visit gets a 307 — but a SERVER-side read would bake real
  // data into public prerendered HTML, where a 307 is irrelevant.
  it("NOTHING in the gallery reads data — the whole reason it can be public", () => {
    const files = [
      `${GALLERY}/layout.tsx`,
      `${GALLERY}/[fixture]/page.tsx`,
      ...names.map((f) => `${GALLERY}/[fixture]/fixtures/${f}.tsx`),
    ];
    for (const rel of files) {
      const src = code(rel);   // comments stripped: these files EXPLAIN what they avoid
      expect(src, `${rel} must not read a session`).not.toMatch(/useSession|next-auth|getServerSession|requireActive/);
      expect(src, `${rel} must not fetch`).not.toMatch(/\bfetch\(/);
      expect(src, `${rel} must not reach Sanity`).not.toMatch(/serverClient|operationalClient|writeClient|@\/sanity|groq/);
      expect(src, `${rel} must not read env`).not.toMatch(/process\.env/);
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
