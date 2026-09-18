// The one spec that runs the gallery with motion ON (`#motion`), and the only one that
// can see the trap it exists for.
//
// A transformed ancestor becomes the containing block for every `position: fixed`
// descendant, so a dialog that is `fixed inset-0` stops being viewport-anchored the
// moment anything above it animates a transform — it lands inside that ancestor's box
// instead. Nothing in the three gates can observe this: `tsc` types it fine, jsdom
// computes no layout, and a final-frame screenshot shows the dialog already at rest
// (the transform, if any, is gone by then). It takes a real browser, mid-animation.
//
// `#motion` is read by `GalleryMotion.tsx`, which removes `data-motion` in a layout
// effect so this page — and only this page — animates for real.

import { test, expect } from "@playwright/test";

test("the sheet's enter never runs under a transformed ancestor", async ({ page }, testInfo) => {
  await page.goto("/theme-gallery/dark/dialog#motion");
  const dialog = page.locator('[role="dialog"]');
  await dialog.waitFor({ state: "attached" });

  // Both frames are attached as EVIDENCE, not compared: a mid-animation capture is
  // inherently timing-dependent and would be a flaky baseline. The assertions below are
  // on computed style and geometry, which are not.
  await testInfo.attach("t0", { body: await page.screenshot(), contentType: "image/png" });
  // Raced against 400 ms (`--motion-slow` is 320 ms, plus slack). An infinite animation —
  // a spinner, a looping shimmer — never resolves `finished`, and an unraced wait would
  // then burn the 30 s test timeout. Nothing asserted below depends on this wait; only
  // the honesty of the `tEnd` attachment does.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished)),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ]),
  );
  await testInfo.attach("tEnd", { body: await page.screenshot(), contentType: "image/png" });

  const facts = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')!;
    let el = d.parentElement;
    const transformed: string[] = [];
    while (el && el !== document.documentElement) {
      if (getComputedStyle(el).transform !== "none") transformed.push(el.tagName);
      el = el.parentElement;
    }
    const r = d.getBoundingClientRect();
    return {
      transformed,
      inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    };
  });

  expect(facts.transformed).toEqual([]);
  expect(facts.inside).toBe(true);
});
