// Layout that survives TEXT-ONLY zoom (the «Máximo» text size).
//
// `app/utils/textZoom.ts` scales text to 1.6×. BOTH paths end at the same CSS:
// `@capacitor/text-zoom` has no native `set` on iOS (only `getPreferred`), so it
// falls back to its own JS, which sets `document.body.style.webkitTextSizeAdjust`
// — the same property the web path sets. Only the TEXT grows. Every px/rem box —
// grid tracks, fixed widths, paddings — stays exactly where it was, because the
// root font-size is never touched. FONT-RELATIVE lengths (`em`, `ch`) DO follow,
// which is what makes the `em` track floor below reflow rather than sit still;
// verified in real WebKit, see the header of the first describe.
//
// A member sent screenshots on 2026-09-13: on her phone the service card was cut
// off at the right edge, the three voice columns painted on top of each other, and
// «Siguiente» sat off-screen on the availability page. Measured in a browser at
// 375px with every font-size multiplied by 1.6, the page was 56px wider than the
// viewport and a 117px box was holding 197px of «SEPTIEMBRE».
//
// WHY THIS GUARD IS A SOURCE SCAN. jsdom performs no layout: every width it
// reports is 0, so a rendering test cannot tell a fixed grid from a fluid one.
// What is pinned here is therefore the STYLE DECISION at each site the audit
// found, with the measurement that justified it. It is a ratchet, not a proof.
//
// THE PROOF WAS THE iOS SIMULATOR, driving the app's own `TextSizeControl`
// through «Normal», «Más grande» and «Máximo» in real WebKit on an iPhone 17 Pro
// (402pt): three voice columns at Normal, two at 1.4× and 1.6×, nothing painted
// outside its box, nothing clipped, and the month nav wrapping instead of pushing
// «Siguiente» off the screen. Chromium is NOT a substitute — it ignores
// `-webkit-text-size-adjust` entirely, so the in-app presets do nothing there and
// the only way to see this class of bug in a Chromium devtools session is to
// multiply every computed font-size by hand. The next change to these files
// should go back to the simulator.
//
// «Chromium» there means DESKTOP Chromium. `text-size-adjust` is a mobile-only
// feature in Blink, so the pending Android build may well honour it. Nothing here
// depends on which way that falls: if font-relative units do not follow the
// adjustment on some engine, the grid simply stays three columns and `break-words`
// plus `min-w-0` still keep the names inside their own tracks. The fix fails safe;
// only the reflow is the bonus.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// The colour scanner's stripper, shared rather than re-implemented.
import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

/**
 * Source WITHOUT comments.
 *
 * Every one of these assertions names the class it is pinning, and every fix
 * carries a comment explaining that same class — so a naive `readFileSync` made
 * two of them satisfiable by the PROSE. Verified by deleting `break-words` and
 * `size={1}` from the code and watching the guard stay green. `stripComments`
 * blanks comments while preserving offsets, so the slices below still line up.
 */
const read = (rel: string): string =>
  stripComments(readFileSync(path.join(process.cwd(), rel), "utf8"), { syntax: "js" }) as string;

describe("the voices grid reflows instead of overlapping", () => {
  const src = read("app/components/DayCard.tsx");

  it("sizes its columns from the TEXT, not from a fixed count", () => {
    // `grid-cols-3` pinned three tracks at any text size: at 1.6× each column was
    // 87px holding 167px of names. The `em` floor grows with the text, so the row
    // drops to two columns and then one.
    expect(src).toMatch(/grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,[\d.]+em\),1fr\)\)\]/);
    expect(src, "a fixed three-column voices grid is the bug").not.toMatch(/grid grid-cols-3\b/);
  });

  it("lets a name break when that one name cannot fit its column", () => {
    // Every name span carried `whitespace-nowrap`, so a name wider than its column
    // painted into the next one and was then clipped by the card's overflow-hidden.
    // Bounded at BOTH ends: `Row` below it also has a `min-w-0`, and an
    // open-ended slice let the min-w-0 assertion pass on a VocalCol that had lost
    // its own (caught by mutation-testing this file).
    const vocalCol = src.slice(src.indexOf("function VocalCol"), src.indexOf("function Row"));
    expect(vocalCol).not.toMatch(/whitespace-nowrap/);
    expect(vocalCol, "the names paragraph must be able to break a name").toMatch(
      /className="[^"]*\bbreak-words\b[^"]*"/,
    );
    // `break-words` does NOT lower min-content, so without `min-w-0` the column's
    // automatic minimum still pushes the track past its `1fr` share — the original
    // overflow, reproduced. The two are one fix.
    expect(vocalCol, "a grid item needs min-w-0 to honour its track").toMatch(/<div className="min-w-0">/);
  });

  it("wraps the hero ROW, with the actions still right-aligned", () => {
    // Both cheaper options were tried in the simulator and are worse at one end:
    // no wrap at all painted the title over the controls (the shipped bug), and
    // `break-words` without a wrap collapsed the title to one letter per line at
    // «Máximo», where the right-hand block is ~220px that cannot shrink.
    const header = src.slice(src.indexOf("t.headerBg"), src.indexOf("function VocalCol"));
    expect(header).toMatch(/flex flex-wrap items-center justify-between/);
    expect(header, "a lone item on a wrapped justify-between line goes LEFT").toMatch(
      /className="ml-auto flex flex-wrap items-center justify-end gap-2"/,
    );
    // `shrink-0` here pinned the block at pill + «Ensayar» ≈ 350px, wider than the
    // card, and the panel's `overflow-hidden` cut the button in half.
    expect(header, "the actions block must be able to shrink and stack").not.toMatch(
      /ml-auto flex shrink-0/,
    );
    expect(header).toMatch(/<div className="min-w-0">/);
  });
});

describe("rows of unbreakable Spanish words wrap instead of running off the phone", () => {
  it("the availability month nav floors on its longest word, not on zero and not on the whole heading", () => {
    // Measured both failures: `flex-1` + `min-w-0` overflowed the page by 56px;
    // a plain `grow` wrapped «Siguiente» onto a second line at NORMAL size.
    const src = read("app/components/availability/AvailabilityGrid.tsx");
    // No slicing: the anchors that used to bound this block lived in comments,
    // which `read` now blanks. Each class is pinned directly instead.
    expect(src).toMatch(/flex flex-wrap items-center justify-between gap-y-2/);
    // `gap-y-2`, not `gap-2`: a gap on BOTH axes raises the row's horizontal floor
    // by 16px, which is budget spent against the very wrap this is avoiding.
    expect(src, "the wrap gap must not cost horizontal room").not.toMatch(/justify-between gap-2\b/);
    expect(src).toMatch(/min-w-min flex-1 text-center/);
    expect(src, "the arrows must not be shrunk into their chevrons").toMatch(
      /flex shrink-0 items-center gap-1\.5/,
    );
  });

  it("the /me availability row wraps its count", () => {
    // «Disponibilidad» and «marcadas» are both unbreakable; side by side they
    // floor wider than a 375pt phone.
    const src = read("app/(client)/me/page.tsx");
    expect(src).toMatch(/flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl/);
    expect(src, "the count stays right-aligned when it wraps").toMatch(/className="ml-auto flex min-w-0 items-center/);
  });

  it("the library search box can shrink under its own placeholder", () => {
    // A text input's intrinsic minimum is ~20 characters IN ITS OWN FONT, so it
    // grows with the text and shoved «Filtros» off the screen. Both halves matter:
    // `min-w-0` lets the flex item shrink, `size={1}` lowers the floor it shrinks
    // against.
    const src = read("app/components/LibraryIndex.tsx");
    expect(src).toMatch(/brand-search-console relative min-w-0 flex-1/);
    expect(src).toMatch(/\n\s+size=\{1\}\n/);
  });
});

describe("boxes sized for text at one scale are minimums, not caps", () => {
  it("the transport's time readouts may grow past 32px", () => {
    const src = read("app/components/AudioTransport.tsx");
    expect(src).not.toMatch(/"w-8 shrink-0/);
    expect(src.match(/min-w-8 shrink-0/g) ?? []).toHaveLength(2);
  });

  it("the tab bar may actually reach the height it publishes", () => {
    // `--bottom-nav-h` is MEASURED, and toasts, the audio player and the song FAB
    // all clear themselves by it. A fixed `h-16` would have them clear 64px of a
    // taller bar.
    const src = read("app/components/BottomNav.tsx");
    expect(src).toMatch(/flex items-stretch min-h-16/);
    expect(src).not.toMatch(/flex items-stretch h-16/);
  });

  it("the schedule's month picker is not capped at 160px", () => {
    const src = read("app/components/ScheduleHeader.tsx");
    expect(src).toMatch(/kind="month"\s*\n\s*className="min-w-40 max-w-full"/);
  });
});
