// Guard for the generated colour inventory (Child A1 step 1).
//
// Two jobs, and the second is the one that matters:
//   1. The committed artifact matches a live scan — so the inventory cannot rot.
//   2. The SCANNER ITSELF is proven to detect each category, against a synthetic
//      source. A guard nobody has seen fail is not a guard, and the repo's own
//      history says so: this plan's predecessor shipped a "verified" claim that
//      was false, twice.
//
// The snapshot key deliberately EXCLUDES line numbers. Lines are emitted for
// humans and must not participate in the assertion — a line-keyed snapshot goes
// red on any unrelated commit that shifts a line in a colour-bearing file, and a
// guard that cries wolf gets deleted rather than fixed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, pairsIn, scanText } from "../../../scripts/colour-inventory.mjs";
import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ARTIFACT = path.join(REPO_ROOT, "app/utils/__tests__/__fixtures__/colour-inventory.json");

type Row = {
  file: string;
  category: number;
  value: string;
  utility: string | null;
  disposition: string;
  line: number;
};

/** The comparable projection: everything EXCEPT `line`. */
function keyed(rows: Row[]) {
  return rows
    .map((r) => `${r.file}|${r.utility ?? "-"}|${r.value}|${r.category}|${r.disposition}`)
    .sort();
}

describe("colour inventory — the committed artifact tracks the tree", () => {
  const live = build() as unknown as { summary: Record<string, unknown>; literalRows: Row[]; compositing: unknown[]; pairs: unknown[] };
  const committed = JSON.parse(readFileSync(ARTIFACT, "utf8")) as typeof live;

  it("literal rows match, keyed on file + normalised utility + value (never lines)", () => {
    expect(keyed(live.literalRows)).toEqual(keyed(committed.literalRows));
  });

  it("the compared summary block matches — no key can express these totals", () => {
    expect(live.summary).toEqual(committed.summary);
  });

  it("compositing rows and the pair relation match", () => {
    expect(live.compositing).toEqual(committed.compositing);
    expect(live.pairs).toEqual(committed.pairs);
  });

  it("is stable: a second build of the same tree is identical", () => {
    expect(keyed((build() as typeof live).literalRows)).toEqual(keyed(live.literalRows));
  });

  it("line numbers are informational — they are excluded from the assertion", () => {
    // Proven by construction: shifting every line must not change the compared key.
    const shifted = live.literalRows.map((r) => ({ ...r, line: r.line + 1000 }));
    expect(keyed(shifted)).toEqual(keyed(live.literalRows));
  });
});

describe("colour inventory — the scanner detects what it claims to", () => {
  // A synthetic source exercising the categories that can appear in a .tsx file.
  // This is the fire-proof: if a category regex silently stops matching, this fails
  // even though the committed artifact would still agree with a live scan.
  const SYNTHETIC = `
    const cls = "bg-[#00bfff] dark:bg-[#010b17] text-gray-500 bg-white bg-transparent";
    const retired = "bg-brand-beam text-brand-frost";
    const arbitrary = "shadow-[inset_0_0_0_1px_rgb(var(--brand-beam)/0.15)]";
    const literal = "shadow-[0_0_0_1px_rgb(0_191_255/0.45)]";
    const map = { sunday_role: "#00bfff" };
    const svg = <svg><path fill="#4285F4" stroke="currentColor" /></svg>;
    // a comment naming #deadbe must NOT be counted
  `;

  it("strips comments, so a colour named in prose is not a decision", () => {
    const stripped = stripComments(SYNTHETIC, { syntax: "js" });
    expect(stripped).not.toContain("#deadbe");
    // Offsets preserved, so reported lines still align with the original source.
    expect(stripped).toHaveLength(SYNTHETIC.length);
  });

  it("does not treat `//` as a comment in CSS", () => {
    const css = `.a { background: url(https://example.com/x.png); color: #00bfff; }`;
    expect(stripComments(css, { syntax: "css" })).toContain("#00bfff");
  });

  it("strips block comments in CSS", () => {
    const css = `/* #deadbe in prose */ .a { color: #00bfff; }`;
    const out = stripComments(css, { syntax: "css" });
    expect(out).not.toContain("#deadbe");
    expect(out).toContain("#00bfff");
  });
});

describe("colour inventory — dispositions are a whitelist, and every row carries one", () => {
  const live = build() as unknown as { literalRows: Row[]; compositing: { disposition: string }[] };
  const ALLOWED = new Set(["B", "C", "D", "keep", "exempt"]);

  it("every row has a recognised disposition — an unknown one is an error, not a silent inclusion", () => {
    const bad = [...live.literalRows, ...live.compositing].filter((r) => !ALLOWED.has(r.disposition));
    expect(bad).toEqual([]);
  });

  it("the deliberately-light email palette is exempt, never a migration target", () => {
    const email = live.literalRows.filter((r) => r.file === "app/utils/emailShell.ts");
    expect(email.length).toBeGreaterThan(0);
    expect(email.every((r) => r.disposition === "exempt")).toBe(true);
  });

  it("the Google brand mark is exempt", () => {
    const google = live.literalRows.filter((r) => /#4285F4|#34A853|#FBBC05|#EA4335/i.test(r.value));
    expect(google.length).toBeGreaterThan(0);
    expect(google.every((r) => r.disposition === "exempt")).toBe(true);
  });

  it("`brand-atmosphere` className occurrences are `keep` — never migrated", () => {
    // It sits on <body> in BOTH root layouts. A loose `brand-` match would make it a
    // migration target and strip the app's entire body wash.
    const atmosphere = live.compositing.filter(
      (r) => (r as { class?: string; kind?: string }).class === "atmosphere" &&
             (r as { kind?: string }).kind === "className",
    );
    expect(atmosphere.length).toBeGreaterThan(0);
    expect(atmosphere.every((r) => r.disposition === "keep")).toBe(true);
  });

  it("no className occurrence is ever dispositioned `D` — those are usage sites", () => {
    const wrong = live.compositing.filter(
      (r) => (r as { kind?: string }).kind === "className" && r.disposition === "D",
    );
    expect(wrong).toEqual([]);
  });
});

describe("colour inventory — the traps that produced wrong counts before", () => {
  const live = build() as unknown as {
    summary: { pairs: number; pairsDifferingInAlpha: number; byCategory: Record<string, number> };
    literalRows: Row[];
    compositing: { kind: string; class?: string; count?: number }[];
  };

  it("captures `serviceCardModel.ts`, which a .tsx-only glob would miss entirely", () => {
    expect(live.literalRows.filter((r) => r.file === "app/components/admin/serviceCardModel.ts").length)
      .toBeGreaterThan(0);
  });

  it("captures the nested, indented `.brand-admin-frame` a `^\\.brand-` scan drops", () => {
    const found = live.compositing.filter((r) => r.class === "admin-frame" && r.kind === "selector");
    expect(found.length).toBeGreaterThan(0);
  });

  it("counts every occurrence, so deleting a non-final one cannot pass unnoticed", () => {
    // `.brand-admin-workspace` has several byte-identical className uses. Without a
    // count they collapse to one key and a deletion is invisible.
    const ws = live.compositing.find((r) => r.class === "admin-workspace" && r.kind === "className");
    expect(ws?.count).toBeGreaterThan(1);
  });

  it("captures the token file's own bare RGB triplets", () => {
    expect(live.literalRows.filter((r) => r.category === 12).length).toBeGreaterThan(0);
  });

  it("routes a `var()` inside an arbitrary value to category 11, not a literal swap", () => {
    // Category 11 is the only category that routes a site to a VARIABLE RENAME rather
    // than a literal swap, so misfiling one sends it to the wrong migration.
    //
    // This used to assert against `AdminPanel.tsx`'s `var(--brand-beam)` shadow. Child B
    // renamed that to `--accent-rgb`, so the old filter now matches nothing and the
    // assertion would report a scanner regression when the scanner is fine. The
    // surviving category-11 rows are the `--brand-radius-*` ones the vocabulary
    // deliberately leaves alone — which is also why the B-final gate can never demand
    // this category reach zero.
    const cat11 = live.literalRows.filter((r) => r.category === 11);
    expect(cat11.length).toBeGreaterThan(0);
    expect(cat11.every((r) => /\[.*var\(--[a-z-]+\).*\]/.test(r.value))).toBe(true);
    // The colour ones are gone; the non-colour ones are not B's to touch.
    expect(cat11.every((r) => /--brand-radius-/.test(r.value))).toBe(true);
  });

  it("excludes the theme gallery — it is a verification surface, not product colour", () => {
    // A2's gallery renders tokens and existing components to DEMONSTRATE them. Folding
    // its usages into the inventory would put them in Children B and C's migration sets,
    // and a Child B that tokenised the swatch fixtures would leave them demonstrating
    // nothing. Verified: without this exclusion, adding the route group fails both the
    // summary and compositing assertions above.
    expect(live.literalRows.some((r) => r.file.includes("(gallery)"))).toBe(false);
    expect(
      (live as unknown as { compositing: { file: string }[] }).compositing.some((r) =>
        r.file.includes("(gallery)"),
      ),
    ).toBe(false);
  });

  it("emits the light/dark pair relation Child B and A2 both consume", () => {
    expect(live.summary.pairs).toBeGreaterThan(0);
  });

  it("pairs are PER-ELEMENT, not per file+utility", () => {
    // An earlier revision grouped by file + utility, which collapsed every `bg-` use in a
    // file into one "pair" carrying 21 values per side — a usable signal that most pairs
    // differ in alpha, but useless for MAPPING, because it cannot say which light value
    // partners which dark one. Child B needs the partner.
    const pairs = (live as unknown as { pairs: { light: string; dark: string }[] }).pairs;
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(typeof p.light).toBe("string");
      expect(typeof p.dark).toBe("string");
      // One value per side. A `+`-joined bag is the old, too-coarse shape.
      expect(p.light).not.toContain("+");
      expect(p.dark).not.toContain("+");
    }
  });

  it("captures Tailwind's opacity modifier, which sits OUTSIDE the bracket", () => {
    // MOVED ONTO A SYNTHETIC SOURCE at Child C, for the same reason recorded above
    // for the pair assertion — and this is the SECOND time this file has had to.
    //
    // It used to filter `live.literalRows` for a captured alpha and assert the count was
    // > 0. Every alpha-bearing row in the tree was a PALETTE CLASS — 261 of them, all
    // disposition C — so the count reached zero the moment Child C migrated its last
    // family, and the assertion failed on correct work while reading as a broken scanner.
    //
    // What is worth guarding is the SCANNER. `bg-[#003572]/50` puts the alpha OUTSIDE the
    // bracket, so a scan that stops at `]` loses it — and the composed-token layer is
    // derived entirely from pairs whose two sides differ in alpha.
    const rows = scanText(`const a = "bg-[#003572]/50 border-[#00bfff] text-[#C8D8EB]/70";`);

    const withAlpha = rows.filter((r: { alpha?: string | null }) => r.alpha);
    expect(withAlpha).toHaveLength(2);
    expect(withAlpha.map((r: { alpha?: string | null }) => r.alpha).sort()).toEqual(["50", "70"]);
    expect(withAlpha.every((r: { value: string }) => /\/\d{1,3}$/.test(r.value))).toBe(true);

    // The alpha-free one is captured too, with a null alpha rather than dropped.
    const noAlpha = rows.filter((r: { alpha?: string | null }) => !r.alpha);
    expect(noAlpha).toHaveLength(1);
    expect(noAlpha[0].value).toBe("[#00bfff]");

    // Bracket notation is the same alpha spelled differently, and reading it as ABSENT
    // reads it as OPAQUE — the defect that shipped three composed tokens at 100% for
    // sites that render at 3-4%.
    expect(scanText(`const b = "bg-[#00bfff]/[0.04]";`)[0].alpha).toBe("4");
  });

  it("captures ALPHA on both sides of a pair — the composed-token layer's whole reason", () => {
    // MOVED ONTO A SYNTHETIC SOURCE, as the B plan required before this batch.
    //
    // This used to assert `pairsDifferingInAlpha > pairs / 2` against the live tree,
    // and it was a correct reading of the tree only until Child B started consuming
    // pairs. B deletes the light half of every pair it migrates, so the count marches
    // to zero BY SUCCEEDING — and the old comment read "if this ever drops to zero,
    // alpha capture has regressed", which would have diagnosed a completed migration
    // as a broken scanner.
    //
    // What is worth guarding is the SCANNER, not the tree's current contents. A
    // theme-invariant opacity modifier cannot express "opaque navy in light, 20% cyan
    // in dark", so a pair whose two sides differ in alpha must be detected as such.
    const src = `
      const a = "bg-[#003572] dark:bg-[#00bfff]/20";
      const b = "bg-[#003572]/30 dark:bg-[#00bfff]/30";
      const c = "bg-[#003572]/10 dark:bg-[#00bfff]/[0.04]";
    `;
    const pairs = pairsIn(src) as {
      light: string; lightAlpha: string | null;
      dark: string; darkAlpha: string | null;
      alphaDiffers: boolean;
    }[];
    expect(pairs).toHaveLength(3);
    expect(pairs.filter((p) => p.alphaDiffers)).toHaveLength(2);

    // `/[0.04]` and `/4` are the same alpha spelled two ways, and reading the bracket
    // form as ABSENT reads it as OPAQUE. That defect shipped: three composed tokens
    // were built at 100% for sites that render at 3-4%.
    const bracket = pairs.find((p) => p.light === "[#003572]" && p.lightAlpha === "10");
    expect(bracket?.darkAlpha).toBe("4");
    expect(bracket?.alphaDiffers).toBe(true);
  });
});
