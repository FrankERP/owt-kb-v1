/** @vitest-environment jsdom */
// app/components/ui/__tests__/SwipeStrip.test.tsx
//
// jsdom cannot drive motion's `drag` gesture — there is no layout, so
// `dragConstraints`/`dragElastic` never resolve, and no real pointer capture, so a
// pointerdown/move/up sequence never reaches motion's `PanSession`. AnimatedList's
// sibling test only asserts render shape for the same reason. This suite instead
// tests the exported pure `swipeDirection` helper directly (the actual
// threshold/velocity decision `onDragEnd` delegates to) and render-smokes the
// component to prove it mounts, forwards children, and accepts a real DOM drag
// prop set without throwing.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MotionProvider } from "../MotionProvider";
import SwipeStrip, { swipeDirection } from "../SwipeStrip";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("swipeDirection", () => {
  it("pages forward past the distance threshold (dragged left)", () => {
    expect(swipeDirection(-120, 0, 64)).toBe(1);
  });

  it("pages back past the distance threshold (dragged right)", () => {
    expect(swipeDirection(120, 0, 64)).toBe(-1);
  });

  it("does nothing short of both thresholds", () => {
    expect(swipeDirection(20, 0, 64)).toBe(0);
    expect(swipeDirection(-20, 0, 64)).toBe(0);
  });

  it("pages forward on a fast flick even under the distance threshold", () => {
    expect(swipeDirection(-10, -800, 64)).toBe(1);
  });

  it("pages back on a fast flick even under the distance threshold", () => {
    expect(swipeDirection(10, 800, 64)).toBe(-1);
  });

  it("is exact at the threshold boundary — equal offset does not page", () => {
    expect(swipeDirection(-64, 0, 64)).toBe(0);
    expect(swipeDirection(64, 0, 64)).toBe(0);
  });

  it("defaults its threshold to SWIPE.distance when not passed", () => {
    expect(swipeDirection(-100, 0)).toBe(1);
    expect(swipeDirection(-40, 0)).toBe(0);
  });
});

describe("SwipeStrip", () => {
  it("renders its children inside the draggable host", () => {
    render(
      <MotionProvider>
        <SwipeStrip onSwipe={() => {}}>
          <span>Semana del 8 al 14</span>
        </SwipeStrip>
      </MotionProvider>,
    );
    expect(screen.getByText("Semana del 8 al 14").textContent).toBe("Semana del 8 al 14");
  });

  it("applies the passed className and keeps vertical scroll available (touch-action: pan-y)", () => {
    const { container } = render(
      <MotionProvider>
        <SwipeStrip onSwipe={() => {}} className="week-strip">
          <span>x</span>
        </SwipeStrip>
      </MotionProvider>,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.className).toContain("week-strip");
    expect(host.style.touchAction).toBe("pan-y");
  });
});
