/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

import { LAYOUT_PROBE_SOURCE } from "../lib/dev-verify/layoutProbe";

// jsdom has no layout engine — every box is 0×0 — so this pins the probe's SHAPE,
// that the source string evaluates on its own in a page, and that it never scrolls;
// not its geometry. The geometry was validated in headless Chromium on 2026-10-06
// (the cases are listed in docs/DEV_VERIFY.md's `--layout` row).
describe("dev-verify --layout probe", () => {
  it("evaluates standalone in a page and returns every field the report reads", () => {
    document.body.innerHTML = `<div class="overflow-x-auto"><div style="width:4000px">x</div></div>`;
    // It must only READ: a scroll would queue a `scroll` event and close an open Menu.
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const result = (0, eval)(LAYOUT_PROBE_SOURCE) as Record<string, unknown>;
    expect(scrollTo).not.toHaveBeenCalled();
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
    // …and only reads: no scroll of any kind (a scroll event closes an open Menu).
    expect(LAYOUT_PROBE_SOURCE).not.toMatch(/scroll(To|By|IntoView)\(|scroll(Left|Top)\s*=/);
  });
});
