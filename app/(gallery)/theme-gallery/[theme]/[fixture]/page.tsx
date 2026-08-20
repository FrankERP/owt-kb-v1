// Theme gallery — the fixture segment (Child A2 steps 1 and 2).
//
// ONE FIXTURE PER ROUTE, NOT ONE PAGE PER THEME. This is the finding that split
// Child A after six review rounds, and it is settled here rather than rediscovered.
//
// An earlier design put the swatch inventory, an open `CueDialog` and a full-screen
// `PlannerGrid` on one page. Measured, they destroy each other:
//   - `PlannerGrid.tsx:1769` is `fixed inset-0 z-50 … bg-[#010b17]` — an OPAQUE
//     full-viewport overlay portalled to `document.body`, covering every swatch. It
//     also sets `body.style.overflow = "hidden"` and `inert` on body children, so the
//     swatch tree is inert and a fullPage capture degrades to one viewport.
//   - `CueDialog.tsx:235` is `fixed inset-0 z-[90]` behind `bg-scrim/[0.68]
//     backdrop-blur-md` — ABOVE the planner's z-50, painting a blurred sheet over it.
//   - `CueDialogProvider.tsx:86–89` sets `inert` on the wrapper holding `children`,
//     which contains the "⛶ Pantalla completa" button — so with a dialog already open,
//     a harness cannot click it (actionability fails on an inert element).
//
// Separate routes give each subject an unobstructed surface.

import { notFound } from "next/navigation";
import { THEMES } from "../layout";
import { SwatchesFixture } from "./fixtures/SwatchesFixture";
import { DialogFixture } from "./fixtures/DialogFixture";
import { PlannerFixture } from "./fixtures/PlannerFixture";
import { KidsPlannerFixture } from "./fixtures/KidsPlannerFixture";

const FIXTURES = ["swatches", "dialog", "planner", "kids-planner"] as const;
type Fixture = (typeof FIXTURES)[number];

/**
 * Enumerate the cross-product. Paired with `dynamicParams = false` this 404s any
 * other value — verified under `next start` for BOTH segments.
 *
 * `generateStaticParams` ALONE does not 404: `dynamicParams` defaults to `true`, and
 * an unlisted segment then renders on demand, reflecting arbitrary input into a root
 * `class` attribute.
 */
export function generateStaticParams() {
  return THEMES.flatMap((theme) => FIXTURES.map((fixture) => ({ theme, fixture })));
}

export const dynamicParams = false;

export default async function ThemeGalleryFixture({
  params,
}: {
  params: Promise<{ theme: string; fixture: string }>;
}) {
  const { theme, fixture } = await params;

  // Defence in depth. `dynamicParams = false` already 404s an unlisted segment; this
  // also covers an explicit bad value reaching the component.
  if (!THEMES.includes(theme as (typeof THEMES)[number])) notFound();
  if (!FIXTURES.includes(fixture as Fixture)) notFound();

  return (
    <main data-gallery-fixture={fixture} data-gallery-theme={theme} className="mx-auto max-w-7xl px-6 py-10">
      {fixture === "swatches" && <SwatchesFixture />}
      {fixture === "dialog" && <DialogFixture />}
      {fixture === "planner" && <PlannerFixture />}
      {fixture === "kids-planner" && <KidsPlannerFixture />}
    </main>
  );
}
