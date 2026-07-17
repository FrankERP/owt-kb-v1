/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "../useFocusTrap";

// jsdom does no layout, so HTMLElement.offsetParent is always null. The hook's
// visibility filter (el.offsetParent !== null) would then treat every element as
// hidden. Shim offsetParent to a truthy value while these tests run so rendered,
// attached nodes count as visible — matching real-browser behavior.
let originalOffsetParent: PropertyDescriptor | undefined;
beforeAll(() => {
  originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentNode; },
  });
});
afterAll(() => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});
afterEach(() => cleanup());

function Dialog({ active }: { active: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div>
      <button data-testid="trigger">trigger</button>
      {active && (
        <div ref={ref} tabIndex={-1} data-testid="dialog">
          <button data-testid="first">first</button>
          <button data-testid="second">second</button>
          <button data-testid="last">last</button>
        </div>
      )}
    </div>
  );
}

describe("useFocusTrap (jsdom)", () => {
  it("moves focus into the dialog on open", () => {
    const { getByTestId, rerender } = render(<Dialog active={false} />);
    getByTestId("trigger").focus();
    expect(document.activeElement).toBe(getByTestId("trigger"));

    rerender(<Dialog active={true} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("moves focus without scrolling the page", () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");

    render(<Dialog active={true} />);

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    focusSpy.mockRestore();
  });

  it("wraps Tab from the last focusable to the first", () => {
    const { getByTestId } = render(<Dialog active={true} />);
    getByTestId("last").focus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    const { getByTestId } = render(<Dialog active={true} />);
    getByTestId("first").focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });

  it("leaves a middle Tab to the browser (does not force-move focus)", () => {
    const { getByTestId } = render(<Dialog active={true} />);
    getByTestId("first").focus();

    fireEvent.keyDown(document, { key: "Tab" });
    // Not the last item, so the hook does not intercept — focus stays put in jsdom
    // (which performs no native tab movement).
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("restores focus to the opener when the dialog closes", () => {
    const { getByTestId, rerender } = render(<Dialog active={false} />);
    const trigger = getByTestId("trigger");
    trigger.focus();

    rerender(<Dialog active={true} />);
    expect(document.activeElement).toBe(getByTestId("first")); // focus moved in

    rerender(<Dialog active={false} />);
    expect(document.activeElement).toBe(trigger); // ...and restored on close
  });

  it("does not steal focus while inactive", () => {
    const { getByTestId } = render(<Dialog active={false} />);
    getByTestId("trigger").focus();
    expect(document.activeElement).toBe(getByTestId("trigger"));
  });
});
