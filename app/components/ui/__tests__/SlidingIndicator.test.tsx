/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../MotionProvider";
import SlidingIndicator, { useActiveIntoView } from "../SlidingIndicator";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

function Bar({ active }: { active: "a" | "b" }) {
  return (
    <MotionProvider>
      <div>
        {(["a", "b"] as const).map((id) => (
          <Item key={id} id={id} active={active === id} />
        ))}
      </div>
    </MotionProvider>
  );
}
function Item({ id, active }: { id: string; active: boolean }) {
  const ref = useActiveIntoView(active);
  return (
    <button ref={ref} type="button" data-item={id} className="relative">
      {id}
      {active && <SlidingIndicator id="bar" />}
    </button>
  );
}

describe("SlidingIndicator", () => {
  it("renders exactly one indicator, inside the active item, aria-hidden", () => {
    const { rerender } = render(<Bar active="a" />);
    let ind = document.querySelectorAll("[data-sliding-indicator]");
    expect(ind).toHaveLength(1);
    expect(document.querySelector('[data-item="a"]')?.contains(ind[0])).toBe(true);
    expect(ind[0].getAttribute("aria-hidden")).toBe("true");
    rerender(<Bar active="b" />);
    ind = document.querySelectorAll("[data-sliding-indicator]");
    expect(ind).toHaveLength(1);
    expect(document.querySelector('[data-item="b"]')?.contains(ind[0])).toBe(true);
  });

  it("does not scroll on mount, even though the first item starts active", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<Bar active="a" />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("scrolls the newly active item into view, inline centre, on activation only", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(<Bar active="a" />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<Bar active="b" />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ inline: "center", block: "nearest" }));
  });

  it("scrolls again on re-activation (b then back to a)", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(<Bar active="a" />);
    rerender(<Bar active="b" />);
    rerender(<Bar active="a" />);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
