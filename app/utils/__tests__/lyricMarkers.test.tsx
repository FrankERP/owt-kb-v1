/** @vitest-environment jsdom */
// R6 Task 6: the lyric block's repeat markers dim, and the eyebrow token is the
// one spelling shared by the song page and ChordChart.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dimRepeatMarkers, LYRIC_EYEBROW, LYRIC_EYEBROW_BLOCK } from "../lyricMarkers";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(cleanup);

describe("dimRepeatMarkers", () => {
  it("dims every // marker and leaves the words alone", () => {
    render(<p>{dimRepeatMarkers("Santo, santo // es el Señor //")}</p>);
    expect(screen.getAllByLabelText("repetir")).toHaveLength(2);
    expect(screen.getByText(/Santo, santo/)).toBeTruthy();
  });

  it("leaves a marker-free string exactly as it came", () => {
    expect(dimRepeatMarkers("Santo es el Señor")).toBe("Santo es el Señor");
  });

  it("passes non-string nodes through untouched", () => {
    const el = <em key="x">x</em>;
    expect(dimRepeatMarkers(el)).toBe(el);
  });

  it("walks an array of children, dimming only its strings", () => {
    const { container } = render(
      <p>{dimRepeatMarkers(["Canta // otra vez", <strong key="s">fuerte</strong>])}</p>,
    );
    expect(screen.getAllByLabelText("repetir")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
  });

  it("is a neutral module — the eyebrow is a token string, not a component", () => {
    expect(LYRIC_EYEBROW).toContain("uppercase");
  });
});

// A SOURCE test, because the defect it guards is invisible to jsdom: jsdom performs
// no cascade, so a `p` whose margins are zeroed by `prose-p:!mt-0` renders exactly
// like a `div` whose margins apply. What can be checked without a browser is which
// ELEMENT the eyebrow is rendered through.
describe("the lyric eyebrow is a div, never a p", () => {
  const page = readFileSync(
    path.join(REPO_ROOT, "app/(client)/posts/[slug]/page.tsx"),
    "utf8",
  );
  const blockMap = page.slice(page.indexOf("block: {"), page.indexOf("types: {"));

  it("renders every heading level through a div carrying LYRIC_EYEBROW_BLOCK", () => {
    for (const level of ["h1", "h2", "h3", "h4"]) {
      expect(blockMap, `${level} must render a div`).toContain(
        `${level}: ({ children }) => <div className={LYRIC_EYEBROW_BLOCK}>{children}</div>`,
      );
    }
  });

  it("never renders the eyebrow through a p — prose-p: would zero its margins", () => {
    expect(blockMap).not.toMatch(/<p className=\{(?:LYRIC_EYEBROW|EYEBROW)/);
  });

  it("the gallery fixture reproduces the page's wrapper, character for character", () => {
    const wrapper =
      "prose prose-sm sm:prose dark:prose-invert prose-p:leading-relaxed prose-p:!mt-0 prose-p:!mb-0 max-w-[62ch] mx-auto";
    const fixture = readFileSync(
      path.join(
        REPO_ROOT,
        "app/(gallery)/theme-gallery/[theme]/[fixture]/fixtures/SongPracticeFixture.tsx",
      ),
      "utf8",
    );
    expect(page).toContain(wrapper);
    expect(fixture, "a different wrapper would not reproduce the cascade").toContain(wrapper);
    expect(fixture).toContain("<div className={LYRIC_EYEBROW_BLOCK}>");
  });

  it("LYRIC_EYEBROW_BLOCK is the token plus its margins, in one place", () => {
    expect(LYRIC_EYEBROW_BLOCK.startsWith(LYRIC_EYEBROW)).toBe(true);
    expect(LYRIC_EYEBROW_BLOCK).toContain("!mt-6");
  });
});
