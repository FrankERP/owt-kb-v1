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
    // Scoped to CODE, not prose: the file's own comment is free to discuss
    // `data-reveal`/`transform` in English, as the brief's template does (it
    // even mentions `<main>`). Strip `//`-prefixed lines before checking for an
    // actual JSX element (other than the fragment), a `className=`, or a
    // `style=` — those must never appear outside a comment.
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/<[a-zA-Z]/);
    expect(code).not.toMatch(/className=/);
    expect(code).not.toMatch(/style=/);
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
    // The `to` frame must land on `transform: none`, not a non-none transform
    // like translate3d(0,0,0) — under `fill: both` a non-none transform stays
    // on the reveal host forever and becomes a containing block for any
    // `position: fixed` descendant (the WebKit trap CueDialog.tsx:33 documents).
    const to = kf.match(/to\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(to).toMatch(/transform:\s*none\s*;/);
  });

  it("draws the section rail with scaleY from the top", () => {
    const block = css.match(/\.brand-section-heading::before\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/transform-origin:\s*top/);
    expect(block).toMatch(/animation:\s*brand-rail-draw var\(--motion-reveal\) var\(--ease-out\) both/);
  });
});

describe("home page is the first consumer", () => {
  it("passes revealProps to the section heading, the hero card and the disclosures", () => {
    // R1: the library block (and its own revealProps(2) heading) left home for
    // /biblioteca, dropping the count from 3 to 2; Task 7 split the card grid
    // into a hero and a collapsed list, so it is 3 again — the "Esta semana"
    // heading, the lit hero wrapper, and the one site inside the disclosure map
    // that staggers every collapsed service.
    const src = read("app/(client)/page.tsx");
    expect(src).toMatch(/import \{ revealProps \} from "\.\.\/utils\/reveal"/);
    expect((src.match(/\{\.\.\.revealProps\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("/me staggers its five blocks", () => {
  it("reveals the header, the services, Kids, the availability link and Ajustes in order", () => {
    // R3: the page is "Mi semana" — identity header (0), services (1), Oasis Kids
    // (2), the link to `/me/disponibilidad` (3, the calendar itself moved there in
    // F3), Ajustes (4). The count is a floor, not an equality: the `member`-null
    // arm carries its own (3) and (4) for the same two blocks.
    const src = read("app/(client)/me/page.tsx");
    expect(src).toMatch(/import \{ revealProps \} from "@\/app\/utils\/reveal"/);
    for (const i of [0, 1, 2, 3, 4]) expect(src).toContain(`{...revealProps(${i})}`);
  });
});
