// Theme gallery — the visual baseline, plus the three assertions that need real paint.
//
// Runs under `playwright.vr.config.ts` ONLY (read-only, opt-in; ADR-0014). Named
// `.spec.ts` because `vitest.config.ts` includes `e2e/**/*.test.ts`.
//
// The screenshots are the bulk of the file but not the interesting part. The three
// `elementFromPoint` tests below are: they are the reason the gallery was split into one
// fixture per route in the first place, and a DOM-order check cannot substitute for them
// because jsdom performs no layout and no paint. "A portal node exists under
// `document.body`" passes in every broken arrangement.

import { test, expect } from "@playwright/test";

// THE ONE THING IN THE GALLERY THAT IS NOT HERMETIC, stubbed here.
//
// The song fixture's `TutorialPoster` renders YouTube's own still through `next/image`,
// so the browser asks the server for `/_next/image?url=https://i.ytimg.com/…` and the
// server goes to the internet for it. Measured: it made `dark/song` differ from its own
// baseline by 15% of all pixels between two consecutive runs — the poster had arrived in
// one and not the other. A baseline that depends on a third party's CDN answering in
// time is not a baseline, and capturing on a fast link would simply move the failure to
// whoever runs it next.
//
// Fulfilling the request with a fixed opaque tile keeps the poster BOX — its aspect
// ratio, its scrim and the ▶ button over it, which is the composition under review —
// while removing the network from the picture entirely.
const STUB_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR4nGNQ0jD+jw8zjAwFAKuYXwHojz7dAAAAAElFTkSuQmCC",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route(/\/_next\/image|i\.ytimg\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: STUB_PNG }),
  );
});

const THEMES = ["dark", "light"] as const;
const FIXTURES = ["swatches", "dialog", "planner", "kids-planner", "controls", "song", "nav"] as const;

// Full page for the fixtures that are INVENTORIES — they run past the viewport and the
// part below the fold is exactly what a reviewer needs to see. `dialog` and `planner` are
// deliberately viewport-only: both are `fixed inset-0` overlays, so a full-page capture
// would add nothing but the scroll height of the page underneath them.
const FULL_PAGE = new Set<string>(["swatches", "controls", "song", "kids-planner", "nav"]);

for (const theme of THEMES) {
  for (const fixture of FIXTURES) {
    test(`${theme}/${fixture}`, async ({ page }) => {
      await page.goto(`/theme-gallery/${theme}/${fixture}`);
      await expect(page.locator(`main[data-gallery-fixture="${fixture}"]`)).toBeVisible();
      // Web fonts settle AFTER first paint. Without this the baseline can be captured at
      // fallback metrics, which is a difference a reviewer reads as a layout regression.
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${theme}-${fixture}.png`, { fullPage: FULL_PAGE.has(fixture) });
    });
  }
}

test("swatches: the swatch surface is unobscured by any fixed body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/swatches");
  const surface = page.locator("[data-gallery-surface='swatches']");
  await expect(surface).toBeVisible();
  const covered = await page.evaluate(() => {
    const el = document.querySelector("[data-gallery-surface='swatches']")!;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 8, r.top + 8);
    return !el.contains(top);
  });
  expect(covered).toBe(false);
});

// Two elements, deliberately. `[data-cue-layer]` is the `fixed inset-0 z-[90]` LAYER
// (backdrop included) and `[role="dialog"]` is the panel inside it. The viewport centre
// is the panel on a desktop viewport but the BACKDROP on a phone — `CueDialog` is
// `items-start` below `sm`, so the panel sits at the top and a centre-point check for the
// panel fails there for a reason that is not a regression. So: the centre proves the
// layer covers the page, and the panel's own centre proves nothing paints over the panel.
test("dialog: the dialog layer is the topmost painted body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/dialog");
  await page.locator('[role="dialog"]').waitFor({ state: "visible" });
  const facts = await page.evaluate(() => {
    const centre = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const panel = document.querySelector('[role="dialog"]')!;
    const r = panel.getBoundingClientRect();
    const onPanel = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      layerOnTop: !!centre?.closest("[data-cue-layer]"),
      panelOnTop: !!onPanel?.closest('[role="dialog"]'),
    };
  });
  expect(facts).toEqual({ layerOnTop: true, panelOnTop: true });
});

// The planner's full-screen host is NOT `[data-planner-fullscreen]` — that attribute is
// on the "⛶ Pantalla completa" TOGGLE (`PlannerGrid.tsx:~2022`), and the toggle's whole
// subtree unmounts once full screen is on. The overlay portalled to `document.body`
// (`PlannerGrid.tsx:~1969`) identifies itself as a modal dialog with this label, so that
// is the honest selector. The fixture's own `data-planner-fullscreen-activated` proves
// the mount-time click fired; the paint check proves the result is actually on top.
const PLANNER_OVERLAY = '[role="dialog"][aria-label="Cuadrícula del mes en pantalla completa"]';

test("planner: the full-screen overlay is the topmost painted body child", async ({ page }) => {
  await page.goto("/theme-gallery/dark/planner");
  await page.locator(PLANNER_OVERLAY).waitFor({ state: "visible" });
  await expect(page.locator("[data-planner-fullscreen-activated='true']")).toBeAttached();
  const top = await page.evaluate(
    (selector) => document.elementFromPoint(innerWidth / 2, 24)?.closest(selector) !== null,
    PLANNER_OVERLAY,
  );
  expect(top).toBe(true);
});
