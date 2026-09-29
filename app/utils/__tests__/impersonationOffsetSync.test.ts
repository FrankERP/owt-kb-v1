// The banner/navbar offset is a two-file contract with no code path between
// the halves: `ImpersonationBanner` publishes a class and a custom property on
// <html>, and `brand.css` is the only thing that reads them. A one-sided rename
// degrades silently — the navbar falls back to the :root default and creeps
// back under the banner on a phone, where the banner is tallest — so the
// coupling gets the same kind of guard `routeMatcher.test.ts` gives its pair.
//
// The navbar is not the only thing the banner pushes down. Everything sticky or
// scroll-margined UNDER the navbar hard-codes the navbar's height, and without
// the banner in that sum it slides under the navbar by the banner's height while
// a super-admin impersonates. `--impersonation-h` cannot be the term — it is
// never 0 — so brand.css derives `--impersonation-offset`, 0 unless the class is
// on, and every under-navbar calc adds it. The sweep below finds those calcs by
// shape across app/**, so a NEW sticky-under-navbar element joins automatically:
// it fails here until it adds the offset, rather than shipping one banner-height
// short. Two readers are OUT of the sweep's reach because they read the computed
// offset in JS rather than spelling it: `SectionNav`'s hero hand-off and
// `LyricsAutoscroll` (both `getComputedStyle`, measured at mount).
//
// No class string in THIS file may interpolate inside its brackets. Tailwind's
// `content` glob reads `app/**` tests included, so a `var(${…})` written here
// would become a real CSS rule — invalid syntax that fails `next build`
// (lightningcss). The literals below are spelled out on purpose.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const component = read("app/components/ImpersonationBanner.tsx");
const css = read("app/brand.css");

/** The literal names the component publishes, read out of its own source. */
const CLASS_NAME = component.match(/const BANNER_CLASS = "([^"]+)"/)?.[1];
const VAR_NAME = component.match(/const BANNER_H_VAR = "([^"]+)"/)?.[1];

/** brand.css's gated term: 0, or the banner's height while the class is on. */
const OFFSET_VAR = "--impersonation-offset";

describe("impersonation banner ↔ navbar offset", () => {
  it("the component still declares both names", () => {
    expect(CLASS_NAME).toBe("impersonating");
    expect(VAR_NAME).toBe("--impersonation-h");
  });

  it("brand.css keys the navbar offset off the class the component adds", () => {
    expect(css).toContain(`.${CLASS_NAME} .brand-navbar`);
  });

  it("brand.css both declares and consumes the property the component sets", () => {
    // Declared, so the navbar has a sane offset before the measurement lands —
    // and so brandCss.test.ts's dangling-var guard passes by declaration.
    expect(css).toMatch(new RegExp(`${VAR_NAME}:\\s*[^;]+;`));
    expect(css).toContain(`var(${VAR_NAME})`);
  });

  it("the component actually publishes both names it declares", () => {
    // The class is the half that carries the whole rule: without it
    // `.impersonating .brand-navbar` never matches and the navbar slides back
    // under the banner, with every other assertion here still green.
    expect(component).toContain("classList.add(BANNER_CLASS)");
    expect(component).toContain("classList.remove(BANNER_CLASS)");
    expect(component).toContain("setProperty(BANNER_H_VAR");
    expect(component).toContain("removeProperty(BANNER_H_VAR");
  });
});

// ---------------------------------------------------------------------------
// Everything else under the navbar
// ---------------------------------------------------------------------------

/**
 * Every under-navbar offset in one source: a `top-[calc(`, `scroll-mt-[calc(` or
 * `max-h-[calc(100dvh` arbitrary value — any variant prefix — whose calc reads
 * `env(safe-area-inset-top` — with or without a fallback argument — which is what
 * anchoring to the navbar's top edge looks like here (the navbar pads by that
 * inset). The lookbehind keeps `bottom-[calc(` and `pt-[env(…)]` out.
 */
const UNDER_NAVBAR = /(?<![\w-])(?:top|scroll-mt|max-h)-\[calc\([^\]]*\]/g;

function underNavbarOffsets(src: string): string[] {
  return [...src.matchAll(UNDER_NAVBAR)]
    .map((m) => m[0])
    .filter((v) => /env\(safe-area-inset-top\b/.test(v))
    .filter((v) => !v.startsWith("max-h-") || v.startsWith("max-h-[calc(100dvh"));
}

/** The offset term an under-navbar value must carry: added to a top or margin, subtracted from a cap. */
const signed = (value: string) => `${value.startsWith("max-h-") ? "-" : "+"}var(${OFFSET_VAR})`;

function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(rel);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(rel);
      }
    }
  };
  walk("app");
  return out;
}

describe("impersonation banner ↔ everything sticky under the navbar", () => {
  it(`brand.css declares ${OFFSET_VAR} as 0 on :root and gates it on the component's class`, () => {
    // The FIRST :root block, the one brandCss.test.ts and motionTokens.test.ts read.
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    // `0px`, never a bare `0`: inside calc() a unitless 0 is a <number>, so
    // `<length> + 0` fails type-checking and every under-navbar offset drops.
    expect(root).toMatch(new RegExp(`${OFFSET_VAR}:\\s*0px\\s*;`));
    // Keyed off the SAME class the component adds, as a rule of its own (a `{`
    // right after the class, so the navbar's descendant rule cannot satisfy it),
    // and set to the SAME property the component measures.
    expect(css).toMatch(
      new RegExp(`^(?:html)?\\.${CLASS_NAME}\\s*\\{[^}]*${OFFSET_VAR}:\\s*var\\(${VAR_NAME}\\)\\s*;`, "m"),
    );
  });

  it(`every under-navbar calc in app/** adds var(${OFFSET_VAR})`, () => {
    const found: { file: string; value: string }[] = [];
    for (const file of appSources()) {
      for (const value of underNavbarOffsets(read(file))) found.push({ file, value });
    }

    // Non-vacuity: the sweep still sees the sites this contract was written
    // for, every kind of them, so a regex that silently stopped matching fails
    // here instead of passing an empty list.
    const files = new Set(found.map((f) => f.file));
    for (const known of [
      "app/(client)/posts/[slug]/page.tsx",
      "app/components/LibraryIndex.tsx",
      "app/components/SectionNav.tsx",
      "app/components/admin/AdminRail.tsx",
      "app/components/admin/ParticipationSidebar.tsx",
    ]) {
      expect(files, `the sweep no longer sees ${known}`).toContain(known);
    }
    expect(found.length).toBeGreaterThanOrEqual(12);
    for (const kind of ["top-[", "scroll-mt-[", "max-h-["]) {
      expect(found.some((f) => f.value.startsWith(kind)), kind).toBe(true);
    }

    // The SIGN matters: an offset pushes a top or a scroll margin DOWN (`+`) and
    // shortens a viewport-height cap (`-`). A copied term order that flips it
    // would move the element up under the navbar with the offset still present.
    const missing = found
      .filter((f) => !f.value.includes(signed(f.value)))
      .map((f) => `${f.file}: ${f.value}`);
    expect(
      missing,
      `under-navbar offsets without var(${OFFSET_VAR}) — they slide under the navbar by the banner's height while impersonating`,
    ).toEqual([]);
  });

  it("FIRE-PROOF: the sweep reports an offset that forgot the banner, and nothing else", () => {
    // Spelled out, never `${OFFSET_VAR}` inside the brackets — see the header.
    const synthetic = [
      `className="sticky top-[calc(5rem+env(safe-area-inset-top))] lg:scroll-mt-[calc(6rem+env(safe-area-inset-top)+var(--impersonation-offset))]"`,
      `className="top-[calc(6rem+env(safe-area-inset-top,0px))] lg:top-[calc(6rem+env(safe-area-inset-top,_0px))]"`,
      `className="scroll-mt-[calc(6rem+env(safe-area-inset-top)-var(--impersonation-offset))] max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-var(--impersonation-offset)-1.5rem)]"`,
      `className="bottom-[calc(1rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] top-4 max-h-[calc(100vh-2rem)]"`,
    ].join("\n");
    const offsets = underNavbarOffsets(synthetic);
    expect(offsets).toEqual([
      "top-[calc(5rem+env(safe-area-inset-top))]",
      "scroll-mt-[calc(6rem+env(safe-area-inset-top)+var(--impersonation-offset))]",
      "top-[calc(6rem+env(safe-area-inset-top,0px))]",
      "top-[calc(6rem+env(safe-area-inset-top,_0px))]",
      "scroll-mt-[calc(6rem+env(safe-area-inset-top)-var(--impersonation-offset))]",
      "max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-var(--impersonation-offset)-1.5rem)]",
    ]);
    // Forgot it, forgot it behind a fallback argument (twice), or flipped its sign.
    expect(offsets.filter((v) => !v.includes(signed(v)))).toEqual([
      "top-[calc(5rem+env(safe-area-inset-top))]",
      "top-[calc(6rem+env(safe-area-inset-top,0px))]",
      "top-[calc(6rem+env(safe-area-inset-top,_0px))]",
      "scroll-mt-[calc(6rem+env(safe-area-inset-top)-var(--impersonation-offset))]",
    ]);
  });

  it("no class string in app/** interpolates inside a var() arbitrary value", () => {
    // Tailwind extracts candidates from the raw text of every app/** file, tests
    // included, so `var(${x})` inside brackets is emitted verbatim as
    // `var(${x})` — invalid CSS that lightningcss refuses, failing `next build`.
    // Built from pieces so this file does not contain the pattern it bans.
    const banned = new RegExp(["-\\[[^\\]\\s]*var\\(", "\\$", "\\{"].join(""));
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(?:[jt]sx?|mdx)$/.test(e.name)) all.push(rel);
      }
    };
    walk("app");
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((f) => banned.test(read(f)))).toEqual([]);
    expect(banned.test(["top-[calc(1rem+var(", "$", "{X}))]"].join(""))).toBe(true);
  });
});
