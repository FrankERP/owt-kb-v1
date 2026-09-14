/** @vitest-environment jsdom */
// The long-press gesture (spec §12.8, decision L): 450 ms of a still finger opens
// the row's quick actions, and nothing else does — a scroll, a drag or a short tap
// all leave the row's own tap behaviour untouched.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useLongPress from "../useLongPress";

function Host({ onLongPress, onClick }: { onLongPress: () => void; onClick?: () => void }) {
  const lp = useLongPress(onLongPress);
  return (
    <button type="button" onClick={onClick} {...lp}>
      fila
    </button>
  );
}

function mount(onLongPress: () => void, onClick?: () => void) {
  render(<Host onLongPress={onLongPress} onClick={onClick} />);
  return screen.getByRole("button", { name: "fila" });
}

const down = (el: Element, extra: Record<string, unknown> = {}) =>
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 10, clientY: 10, ...extra });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLongPress", () => {
  it("fires after 450 ms of a still primary pointer", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    vi.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a 300 ms press", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(el, { isPrimary: true });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("is cancelled by a move beyond 8 px", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    fireEvent.pointerMove(el, { isPrimary: true, clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("survives a move inside the 8 px slop", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    fireEvent.pointerMove(el, { isPrimary: true, clientX: 13, clientY: 12 });
    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("is cancelled by a scroll — a touch scroll must never open the sheet", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    fireEvent.scroll(window);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("is cancelled when the pointer leaves the row", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    fireEvent.pointerLeave(el, { isPrimary: true });
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("swallows the click after a fired press, once", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const el = mount(onLongPress, onClick);
    down(el);
    vi.advanceTimersByTime(450);
    fireEvent.pointerUp(el, { isPrimary: true });
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();

    // The NEXT tap is an ordinary tap again.
    down(el);
    fireEvent.pointerUp(el, { isPrimary: true });
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("opens on a desktop right-click and prevents the native menu", () => {
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    const prevented = !fireEvent.contextMenu(el, { pointerType: "mouse", button: 2 });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("prevents a touch contextmenu without firing a second time", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const el = mount(onLongPress);
    down(el);
    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    const prevented = !fireEvent.contextMenu(el, { pointerType: "touch" });
    expect(prevented).toBe(true);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("suppresses the iOS callout and text selection on the row", () => {
    const el = mount(vi.fn());
    expect(el.style.userSelect).toBe("none");
    expect(el.style.webkitUserSelect || el.style.getPropertyValue("-webkit-user-select")).toBe("none");
  });
});
