/** @vitest-environment jsdom */
// app/components/ui/__tests__/SwipeStrip.test.tsx
//
// jsdom cannot drive motion's `drag` gesture with layout — `dragConstraints`/
// `dragElastic` never resolve to real pixel geometry, so the "swipeDirection"/
// "shouldPage" and drag-vs-click suites below test the exported pure helpers
// directly for the threshold/velocity/lock arithmetic itself. The click-swallow
// suite (bottom) DOES drive motion's real `PanSession` with actual DOM
// pointer/click events — no layout is needed for that part, only a real
// `isPrimary` pointer, `pageX`/`pageY` past the 3px distance threshold, and a
// tick per animation frame so motion's `frame` scheduler (which the drag
// gesture's mount, `onDragStart`, and `onDragEnd` are all batched through)
// flushes. AnimatedList's sibling test only asserts render shape for a
// harder case (real layout math) that this trick can't help with.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../MotionProvider";
import SwipeStrip, { shouldPage, swipeDirection } from "../SwipeStrip";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

/** One tick of motion's `frame` scheduler, which batches gesture mount and callbacks. */
const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A real, primary pointer event with the page coordinates motion's PanSession reads. */
function pointerEvent(x: number) {
  return { pointerId: 1, isPrimary: true, clientX: x, clientY: 0, pageX: x, pageY: 0, button: 0 };
}

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

describe("shouldPage", () => {
  it("a y-locked drag never pages, no matter how far or fast", () => {
    expect(shouldPage("y", -200, -900, 64)).toBe(0);
    expect(shouldPage("y", 200, 900, 64)).toBe(0);
  });

  it("defers to swipeDirection when the lock is x", () => {
    expect(shouldPage("x", -120, 0, 64)).toBe(1);
    expect(shouldPage("x", 120, 0, 64)).toBe(-1);
    expect(shouldPage("x", 20, 0, 64)).toBe(0);
  });

  it("defers to swipeDirection before any lock is reported (null)", () => {
    expect(shouldPage(null, -120, 0, 64)).toBe(1);
    expect(shouldPage(null, 20, 0, 64)).toBe(0);
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

describe("SwipeStrip — a drag must not click", () => {
  it("swallows the click that follows a real drag, then lets the next tap through", async () => {
    const onClick = vi.fn();
    render(
      <MotionProvider>
        <SwipeStrip onSwipe={() => {}}>
          <button onClick={onClick}>Lunes</button>
        </SwipeStrip>
      </MotionProvider>,
    );
    const button = screen.getByRole("button");
    const host = button.parentElement as HTMLElement;

    // The drag gesture's own listeners attach in an effect, one tick after
    // render — give it two frames to be sure it has mounted before dragging.
    await raf();
    await raf();

    fireEvent.pointerDown(host, pointerEvent(0));
    // Past motion's 3px distance threshold, so this is a real drag, not a tap.
    fireEvent.pointerMove(document, pointerEvent(10));
    await raf(); // flushes PanSession's onStart -> onDragStart (sets dragged.current)
    fireEvent.pointerUp(document, pointerEvent(10));
    // The browser fires `click` synchronously right after `pointerup`, in the
    // same task — well before onDragEnd, which motion defers to the next
    // animation frame (see the file header). Firing it here, before any
    // `await`, reproduces that order.
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    // onDragEnd's frame.postRender callback, and then its setTimeout(0) reset.
    await raf();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The ref is clear again: an unrelated later tap is untouched.
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a plain click (no drag) reaches the child's onClick", async () => {
    const onClick = vi.fn();
    render(
      <MotionProvider>
        <SwipeStrip onSwipe={() => {}}>
          <button onClick={onClick}>Martes</button>
        </SwipeStrip>
      </MotionProvider>,
    );
    const button = screen.getByRole("button");

    await raf();
    await raf();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
