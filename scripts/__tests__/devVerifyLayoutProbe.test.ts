/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

import { LAYOUT_PROBE_SOURCE } from "../lib/dev-verify/layoutProbe";

// jsdom has no layout engine — every box is 0×0 — so this pins the probe's SHAPE
// and that the source string evaluates on its own in a page, not its geometry. The
// geometry was validated in real Chromium when the flag was added (docs/DEV_VERIFY.md).
describe("dev-verify --layout probe", () => {
  it("evaluates standalone in a page and returns every field the report reads", () => {
    document.body.innerHTML = `<div class="overflow-x-auto"><div style="width:4000px">x</div></div>`;
    // jsdom implements no scrolling; the probe's pan check only needs scrollTo to exist.
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const result = (0, eval)(LAYOUT_PROBE_SOURCE) as Record<string, unknown>;
    scrollTo.mockRestore();
    expect(Object.keys(result).sort()).toEqual([
      "body", "escapers", "fullPageWidth", "html", "maxScrollX", "pageOverflowsX",
      "pseudoCandidates", "scrollingElement", "viewport",
    ]);
    expect(result.pageOverflowsX).toBe(false);
    expect(result.escapers).toEqual([]);
  });

  it("is a source string, never a function — tsx helpers would not exist in the page", () => {
    expect(typeof LAYOUT_PROBE_SOURCE).toBe("string");
    expect(LAYOUT_PROBE_SOURCE).not.toMatch(/__name|require\(|import /);
  });
});
