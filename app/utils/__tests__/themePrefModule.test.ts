// Guards on `app/utils/themePref.ts` itself.
//
// Two of these cover constraints that no other test in Child E can see, and both
// fail SILENTLY in production if broken:
//
//  - a stray `"use client"` turns THEME_MIGRATION_SCRIPT into a client reference
//    rather than a string, so the two Server Component layouts render a `<script>`
//    with nothing usable in it, and the legacy-mirror reconciliation never runs;
//  - an unguarded `localStorage` call in `clearThemeMirror()` throws inside four
//    sign-out `onClick` handlers, aborting them BEFORE `signOut()` — the "Salir"
//    button silently stops working, permanently, for storage-blocked browsers.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isThemePref,
  clearThemeMirror,
  hasThemeMirror,
  fetchThemePref,
  THEME_MIGRATION_SCRIPT,
  THEME_MIRROR_KEY,
  THEME_MIGRATED_KEY,
} from "../themePref";

const SOURCE = readFileSync(
  path.join(process.cwd(), "app/utils/themePref.ts"),
  "utf8",
);

/** Everything before the first import — where a directive would have to live. */
function prologue(): string {
  return SOURCE.slice(0, SOURCE.search(/^(import|export)\b/m))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .trim();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("themePref.ts — module-level constraints", () => {
  it('carries NO "use client" directive', () => {
    expect(
      prologue(),
      'themePref.ts must stay server-importable: (client)/layout.tsx and ' +
        "(admin)/layout.tsx are Server Components that import THEME_MIGRATION_SCRIPT " +
        "as a string. Under a client boundary it becomes a client reference and the " +
        "reconciliation script renders empty.",
    ).toBe("");
  });

  it("every localStorage access is wrapped in try/catch", () => {
    // Count accesses and catches rather than eyeballing: a future helper that
    // forgets its guard should fail here, not in a member's browser.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const accesses = code.match(/localStorage\./g) ?? [];
    const catches = code.match(/\}\s*catch\b/g) ?? [];
    expect(accesses.length, "expected localStorage helpers to exist").toBeGreaterThan(0);
    expect(
      catches.length,
      "every localStorage access in this file must be guarded — an unguarded " +
        "removeItem() in clearThemeMirror() aborts the sign-out handler before " +
        "signOut() is reached",
    ).toBeGreaterThanOrEqual(accesses.length - 1);
  });
});

describe("isThemePref", () => {
  it.each(["dark", "light", "system"])("accepts %s", (v) => {
    expect(isThemePref(v)).toBe(true);
  });

  it('accepts "system" ONLY because Child F flipped enableSystem alongside it', () => {
    // These two facts are one change. With enableSystem={false}, next-themes
    // resolves nothing: it strips light/dark and adds a literal `system` class,
    // leaving no theme class at all while Sanity stores "system" and nothing
    // logs. So the literal set and the provider flag are asserted together —
    // legalising the value without the flag is the landmine parent §9 names.
    expect(isThemePref("system")).toBe(true);
    const provider = readFileSync(
      path.join(process.cwd(), "app/utils/Provider.tsx"), "utf8",
    );
    expect(
      provider,
      '"system" is an accepted themePref, so enableSystem MUST be true — ' +
        "otherwise every member who chooses it lands in a class-less document.",
    ).toMatch(/enableSystem=\{true\}/);
  });

  it.each([undefined, null, "", "sepia", 1, true, {}])("rejects %o", (v) => {
    expect(isThemePref(v)).toBe(false);
  });
});

describe("the migration script", () => {
  it("clears the mirror UNCONDITIONALLY — not only when it reads light", () => {
    expect(THEME_MIGRATION_SCRIPT).toContain(`removeItem("${THEME_MIRROR_KEY}")`);
    expect(
      THEME_MIGRATION_SCRIPT,
      "the rule is 'clear any value this codebase did not write'. An unrecognised " +
        "value is WORSE than a light one: 'system' under enableSystem={false} yields " +
        "a class-less document, not merely a light page.",
    ).not.toMatch(/===\s*"light"|==\s*"light"/);
  });

  it("runs once per browser, behind the migration flag", () => {
    expect(THEME_MIGRATION_SCRIPT).toContain(`getItem("${THEME_MIGRATED_KEY}")`);
    expect(THEME_MIGRATION_SCRIPT).toContain(`setItem("${THEME_MIGRATED_KEY}","1")`);
  });

  it("adds the dark class in its catch — the storage-blocked class-less document", () => {
    // With forcedTheme gone, next-themes' seed puts its WHOLE apply inside a
    // localStorage try. A blocked browser would otherwise get neither dark nor
    // light, and all 94 dark: utilities would stop applying at once.
    expect(THEME_MIGRATION_SCRIPT).toMatch(/catch\s*\([^)]*\)\s*\{[^}]*classList\.add\("dark"\)/);
  });

  it("is a single expression with no line breaks, safe to inline in a layout", () => {
    expect(THEME_MIGRATION_SCRIPT).not.toContain("\n");
  });

  it("does not write the mirror — a clear, never setTheme('dark')", () => {
    // Writing "dark" would pin the whole unset population and defeat Child F's
    // staged rollout: "no mirror" is what makes an unset member follow a new default.
    expect(THEME_MIGRATION_SCRIPT).not.toMatch(
      new RegExp(`setItem\\("${THEME_MIRROR_KEY}"`),
    );
  });
});

describe("storage helpers fail soft when localStorage throws", () => {
  function throwingStorage() {
    return {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
      removeItem: () => { throw new DOMException("blocked", "SecurityError"); },
    };
  }

  it("clearThemeMirror does not propagate — sign-out must still reach signOut()", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(() => clearThemeMirror()).not.toThrow();
  });

  it('hasThemeMirror resolves to "no mirror" rather than throwing', () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(hasThemeMirror()).toBe(false);
  });

  it("hasThemeMirror is true only when a value is actually stored", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(hasThemeMirror()).toBe(false);
    store.set(THEME_MIRROR_KEY, "light");
    expect(hasThemeMirror()).toBe(true);
    clearThemeMirror();
    expect(hasThemeMirror()).toBe(false);
  });
});

describe("fetchThemePref — a failed fetch is NOT 'unset'", () => {
  it("reports ok:false on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    expect(await fetchThemePref()).toEqual({ ok: false, pref: undefined });
  });

  it("reports ok:false when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchThemePref()).toEqual({ ok: false, pref: undefined });
  });

  it("reads through a null body — GET /api/me can return null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    expect(await fetchThemePref()).toEqual({ ok: true, pref: undefined });
  });

  it("reports ok:true with an undefined pref for a genuinely unset member", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alias: "x" }) }));
    expect(await fetchThemePref()).toEqual({ ok: true, pref: undefined });
  });

  it("drops an unrecognised stored value rather than passing it to setTheme", async () => {
    // "system" was the fixture here until Child F legalised it; "sepia" keeps the
    // property under test — an unknown literal must never reach setTheme, which
    // has no falsy guard and would persist it for the next load.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themePref: "sepia" }) }));
    expect(await fetchThemePref()).toEqual({ ok: true, pref: undefined });
  });

  it("passes 'system' through now that it is a legal stored value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themePref: "system" }) }));
    expect(await fetchThemePref()).toEqual({ ok: true, pref: "system" });
  });

  it("returns the literal for a member who chose one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ themePref: "light" }) }));
    expect(await fetchThemePref()).toEqual({ ok: true, pref: "light" });
  });
});

describe("the theme announcement writes nothing to the server", () => {
  const SRC = readFileSync(
    path.join(process.cwd(), "app/components/ui/ThemeAnnouncement.tsx"),
    "utf8",
  );
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("issues no fetch and no PATCH — dismissal is client-side only", () => {
    // Same property Child E guarded on the control's mount path, for the same
    // reason: nothing about reading or dismissing a banner may remove a member
    // from the never-chosen population.
    expect(code).not.toMatch(/fetch\s*\(/);
    expect(code).not.toMatch(/themePref/);
    expect(code).not.toMatch(/PATCH/);
  });

  it("wraps every localStorage access, and fails soft toward SHOWING", () => {
    const accesses = code.match(/localStorage\./g) ?? [];
    const catches = code.match(/\}\s*catch\b/g) ?? [];
    expect(accesses.length).toBeGreaterThan(0);
    expect(
      catches.length,
      "a throw here must not break /me; showing the banner twice is the acceptable failure",
    ).toBeGreaterThanOrEqual(accesses.length);
  });

  it("anchors to the control rather than saying 'below'", () => {
    // ThemeControl renders well below the fold on /me, past the service cards,
    // the availability calendar and ProfilePanel.
    expect(code).toMatch(/href="#tema"/);
    const control = readFileSync(
      path.join(process.cwd(), "app/components/ui/ThemeControl.tsx"), "utf8",
    );
    expect(control, "the anchor needs a target").toMatch(/id="tema"/);
  });
});
