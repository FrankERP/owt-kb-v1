// Layout that survives TEXT-ONLY zoom (the «Máximo» text size).
//
// `app/utils/textZoom.ts` scales text to 1.6× — on native through
// `@capacitor/text-zoom`, on web through `-webkit-text-size-adjust`. Only the TEXT
// grows. Every px/rem box — grid tracks, fixed widths, paddings — stays exactly
// where it was, because the root font-size is never touched.
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
// found, with the measurement that justified it. It is a ratchet, not a proof —
// the proof was a browser, and the next change to these files should go back to
// one. A `git grep` for this file's name leads there.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

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
    const vocalCol = src.slice(src.indexOf("function VocalCol"));
    expect(vocalCol).not.toMatch(/whitespace-nowrap/);
    expect(vocalCol).toMatch(/break-words/);
  });

  it("keeps the hero header's title and its actions on separate lines rather than on top of each other", () => {
    // `min-w-0` without `truncate` shrank the title's BOX while the text kept
    // painting over the countdown and «Ensayar».
    const header = src.slice(src.indexOf("Header — day · date"), src.indexOf("function VocalCol"));
    expect(header).toMatch(/flex flex-wrap items-center justify-between/);
  });
});

describe("rows of unbreakable Spanish words wrap instead of running off the phone", () => {
  it("the availability month nav floors on its longest word, not on zero and not on the whole heading", () => {
    // Measured both failures: `flex-1` + `min-w-0` overflowed the page by 56px;
    // a plain `grow` wrapped «Siguiente» onto a second line at NORMAL size.
    const src = read("app/components/availability/AvailabilityGrid.tsx");
    const nav = src.slice(src.indexOf("{/* Navigation"));
    expect(nav).toMatch(/flex flex-wrap items-center justify-between/);
    expect(nav).toMatch(/min-w-min flex-1 text-center/);
    expect(nav, "the arrows must not be shrunk into their chevrons").toMatch(/flex shrink-0 items-center/);
  });

  it("the /me availability row wraps its count", () => {
    // «Disponibilidad» and «marcadas» are both unbreakable; side by side they
    // floor wider than a 375pt phone.
    const src = read("app/(client)/me/page.tsx");
    expect(src).toMatch(/flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl/);
  });

  it("the library search box can shrink under its own placeholder", () => {
    // A text input's intrinsic minimum is ~20 characters IN ITS OWN FONT, so it
    // grows with the text and shoved «Filtros» off the screen. Both halves matter:
    // `min-w-0` lets the flex item shrink, `size={1}` lowers the floor it shrinks
    // against.
    const src = read("app/components/LibraryIndex.tsx");
    expect(src).toMatch(/brand-search-console relative min-w-0 flex-1/);
    expect(src).toMatch(/size=\{1\}/);
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
