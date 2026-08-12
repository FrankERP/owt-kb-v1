// SOURCE-TEXT guards on Child E's wiring.
//
// All of these assert on source rather than on render, and every one of them
// covers a failure that is SILENT in production:
//
//  - drop `defaultTheme="dark"` and the whole team flips to light the moment
//    `forcedTheme` goes — a rendering test passes just as happily either way;
//  - drop the `ThemeBootstrap` mount and every member loses their theme, with
//    nothing failing anywhere;
//  - add the migration script to one layout and forget the other, and admin
//    routes ship a terminal light state with a green suite;
//  - miss one of the four sign-out sites and a member leaves their mirror behind
//    for the next person on a shared phone.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const CLIENT_LAYOUT = "app/(client)/layout.tsx";
const ADMIN_LAYOUT = "app/(admin)/layout.tsx";
const GALLERY_LAYOUT = "app/(gallery)/theme-gallery/[theme]/layout.tsx";

describe("Provider.tsx", () => {
  const src = read("app/utils/Provider.tsx");

  it('declares defaultTheme="system" EXPLICITLY', () => {
    expect(
      src,
      "The default must be written out rather than inferred. next-themes computes " +
        'defaultTheme = enableSystem ? "system" : "light", so an omitted default is ' +
        "only accidentally right, and it silently becomes LIGHT the day enableSystem " +
        "is flipped back.",
    ).toMatch(/defaultTheme="system"/);
  });

  it("mounts ThemeBootstrap and WRAPS children with it", () => {
    // Wrapping, not rendering beside: the /me control reads the literal themePref
    // from its context, and props cannot reach a component several layers below.
    expect(src).toMatch(/<ThemeBootstrap>/);
    expect(src).toMatch(/<\/ThemeBootstrap>/);
    expect(src).toMatch(/import \{ ThemeBootstrap \}/);
  });

  it("declares enableSystem={true} — inseparable from the system default", () => {
    // With enableSystem false, applyTheme is `i === "system" && n && (c = x())`,
    // so nothing resolves: the applier strips light/dark and adds a literal
    // `system` class. No theme class at all, no error, nothing logged.
    expect(
      src,
      'defaultTheme="system" without enableSystem={true} puts every member with no ' +
        "stored preference into a class-less document. Parent §9 names this trap.",
    ).toMatch(/enableSystem=\{true\}/);
  });

  it("THE THREE DEFAULT COPIES AGREE — the guard Child E asked Child F to build", () => {
    // The default cannot be shared as one constant: useTheme() exposes no
    // defaultTheme, and the third copy lives inside a string of JavaScript that
    // runs before hydration. So it is asserted as a SET. Miss any one and the
    // rollout is partial in a way nothing else would catch — most dangerously
    // copy 2, which would re-pin the legacy-mirror cohort to dark on every load,
    // invisibly, against the new default.
    const code = (f: string) =>
      read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // 1 — the provider
    expect(code("app/utils/Provider.tsx"), "copy 1 of 3").toMatch(/defaultTheme="system"/);

    // 2 — ThemeBootstrap's unset-with-a-mirror repair
    expect(
      code("app/components/ThemeBootstrap.tsx"),
      "copy 2 of 3 — the unset-with-a-mirror repair must hand setTheme the SAME " +
        "default as the provider, or the legacy-mirror cohort is silently excluded " +
        "from the rollout",
      // Matches the ref form too: setTheme must NOT be an effect dependency (its
      // identity changes on every theme change in next-themes), so the call site
      // goes through a latest-ref rather than the destructured binding.
    ).toMatch(/setTheme(Ref\.current)?\("system"\)/);

    // 3 — the migration script's catch. This one cannot carry the literal: it
    // resolves the device, because a hardcoded value would exclude the
    // storage-blocked population from a follow-the-system default.
    const script = code("app/utils/themePref.ts");
    expect(script, "copy 3 of 3 — must resolve the device").toMatch(/prefers-color-scheme/);
    // Capture the whole template literal — the script body is full of semicolons,
    // so anything terminating at the first `;` reads only its opening clause.
    expect(
      script.match(/THEME_MIGRATION_SCRIPT\s*=\s*`[^`]*`/)?.[0] ?? "",
      "copy 3 of 3 — the catch must not hardcode a theme as its PRIMARY answer; " +
        "matchMedia resolves it, with a literal only as the inner-throw fallback",
    ).toMatch(/matchMedia\("\(prefers-color-scheme: dark\)"\)\.matches\?"dark":"light"/);
  });

  it("has NO forcedTheme — E4's lever, and the whole point of Child E", () => {
    // Comments stripped: this file explains at length why forcedTheme was removed
    // and how to roll it back, and the guard must not read that as the attribute.
    const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(
      code,
      "forcedTheme back on ThemeProvider makes light mode unreachable again — " +
        "which IS the documented rollback, but it must be a deliberate act, not " +
        "something that creeps back in.",
    ).not.toMatch(/forcedTheme=/);
  });
});

describe("the legacy-mirror reconciliation script", () => {
  it.each([
    ["client", CLIENT_LAYOUT],
    ["admin", ADMIN_LAYOUT],
  ])("is rendered by the %s root layout", (_name, file) => {
    expect(
      read(file),
      `${file} must render THEME_MIGRATION_SCRIPT. Added to one layout and ` +
        "forgotten in the other, the forgotten side ships a terminal light state " +
        "for the legacy-mirror cohort with the whole suite green.",
    ).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*THEME_MIGRATION_SCRIPT\s*\}\}/);
  });

  it.each([
    ["client", CLIENT_LAYOUT],
    ["admin", ADMIN_LAYOUT],
  ])("runs BEFORE <Provider> in %s document order", (_name, file) => {
    const src = read(file);
    const script = src.indexOf("THEME_MIGRATION_SCRIPT");
    const provider = src.indexOf("<Provider>");
    expect(script).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(-1);
    expect(
      script,
      "document order is the whole mechanism: next-themes injects its seed inside " +
        "its own provider, so this script only wins by sitting above <Provider>.",
    ).toBeLessThan(provider);
  });

  it("is NOT in the gallery root layout, which has no Provider and no member", () => {
    const src = read(GALLERY_LAYOUT);
    expect(src).not.toMatch(/THEME_MIGRATION_SCRIPT/);
  });
});

describe("clearThemeMirror() at sign-out", () => {
  // Walk app/ once, excluding tests, and find every file that calls signOut(.
  function appFiles(dir = "app"): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, entry);
      if (rel.includes("__tests__") || entry === "node_modules") continue;
      if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...appFiles(rel));
      else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(rel);
    }
    return out;
  }

  // Comments stripped before matching: `themePref.ts` and `ThemeBootstrap.tsx`
  // both DISCUSS signOut() at length in their own documentation, and a guard that
  // cannot tell prose from a call would name them as sign-out entry points.
  const code = (f: string) =>
    read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const signOutFiles = appFiles().filter((f) => /\bsignOut\(/.test(code(f)));

  it("is called at EXACTLY four sign-out sites", () => {
    // Scoped to files that actually sign out. ThemeBootstrap calls it too — the
    // durable unset-with-a-mirror repair — and that call is asserted separately
    // rather than folded into this count, so the two cannot mask each other.
    const calls = signOutFiles
      .map((f) => (code(f).match(/clearThemeMirror\(\)/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(
      calls,
      "A new sign-out path needs clearThemeMirror() — add the call, then update " +
        "this count. Do NOT just bump the number: without the clear, a member who " +
        "signs out leaves theme=light behind, the next member on that device is " +
        "painted light, and ThemeBootstrap correctly does nothing because their " +
        "themePref is unset. Their only escape is to pick Dark, which destroys the " +
        "unset signal Child F depends on.",
    ).toBe(4);
  });

  it("no file that calls signOut( is missing the clear", () => {
    const missing = signOutFiles.filter((f) => !/clearThemeMirror/.test(code(f)));
    expect(
      missing,
      "these files sign out without clearing the theme mirror",
    ).toEqual([]);
  });

  it("found the four known sign-out entry points", () => {
    // If this changes, the count above needs revisiting with it — not silently.
    expect(signOutFiles.sort()).toEqual(
      [
        "app/(client)/auth/not-a-member/page.tsx",
        "app/components/BottomNav.tsx",
        "app/components/NavMenu.tsx",
        "app/components/SignOutButton.tsx",
      ].sort(),
    );
  });

  it("ThemeBootstrap calls it exactly once — the unset-with-a-mirror repair", () => {
    // Counted separately from the four above so neither can mask the other: this
    // one is the every-load durable repair, not a sign-out.
    const src = code("app/components/ThemeBootstrap.tsx");
    expect((src.match(/clearThemeMirror\(\)/g) ?? []).length).toBe(1);
    // And it must be preceded by setTheme(<the default>): the setTheme makes
    // next-themes' state truthful and paints the class, the clear then removes the
    // key it just wrote. Clear-only leaves next-themes holding the stale value;
    // setTheme-only pins the unset population to a mirror and defeats the default.
    // Child F moved the literal here from "dark" to "system" — this is the seventh
    // E-era guard the F plan should have listed as inverting, found by running them.
    const setDefault = Math.max(
      src.indexOf('setTheme("system")'),
      src.indexOf('setThemeRef.current("system")'),
    );
    const clear = src.indexOf("clearThemeMirror()");
    expect(setDefault, "the repair must hand setTheme the current default").toBeGreaterThan(-1);
    expect(setDefault, 'setTheme("system") must precede clearThemeMirror()').toBeLessThan(clear);
  });

  it("clears BEFORE signOut() runs, in every one of them", () => {
    for (const f of signOutFiles) {
      const src = code(f);
      const clear = src.indexOf("clearThemeMirror()");
      const out = src.indexOf("signOut(", src.indexOf("onClick"));
      expect(clear, `${f}: clearThemeMirror() must precede signOut()`).toBeLessThan(out);
    }
  });
});

describe("GET /api/me still returns its whole projection", () => {
  const src = read("app/api/me/route.ts");

  it("gained themePref", () => {
    expect(src).toMatch(/themePref/);
  });

  it("did NOT narrow — all eight original fields survive", () => {
    // Nothing in app/ GETs this route, so a narrowing would be caught by no other
    // test and no gate. The field list is the contract.
    for (const field of [
      "_id", "member_name", "alias", "email", "role", "memberType",
      "photoUrl", "hasPassword",
    ]) {
      expect(src, `GET /api/me must still project ${field}`).toMatch(
        new RegExp(`\\b${field}\\b`),
      );
    }
  });
});
