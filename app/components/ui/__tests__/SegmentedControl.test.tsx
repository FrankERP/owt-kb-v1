/** @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../MotionProvider";
import SegmentedControl from "../SegmentedControl";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

const OPTIONS = [
  { value: "calendar", label: "Calendario" },
  { value: "list", label: "Lista" },
  { value: "agenda", label: "Agenda" },
] as const;

type View = (typeof OPTIONS)[number]["value"];

function mount(value: View | null, onChange = vi.fn()) {
  render(
    <MotionProvider>
      <SegmentedControl label="Vista" value={value} onChange={onChange} options={OPTIONS} />
    </MotionProvider>,
  );
  return onChange;
}

// A real controlled parent: `value` lives in state and actually re-renders on
// every `onChange`, unlike a static `vi.fn()` mock. Keyboard navigation reads
// the (possibly stale, possibly fresh) `value` prop on every key event, so
// only this shape exercises the guard against a landing-on-the-checked-option
// keyboard move the way a live app would.
function StatefulControl({
  initial,
  onChangeSpy,
}: {
  initial: View;
  onChangeSpy: (value: View) => void;
}) {
  const [value, setValue] = useState<View>(initial);
  return (
    <MotionProvider>
      <SegmentedControl
        label="Vista"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChangeSpy(v);
        }}
        options={OPTIONS}
      />
    </MotionProvider>
  );
}

describe("SegmentedControl", () => {
  it("is a radiogroup whose checked option is the only tab stop", () => {
    mount("list");
    const group = screen.getByRole("radiogroup", { name: "Vista" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects on click and reports the value", () => {
    const onChange = mount("calendar");
    fireEvent.click(screen.getByRole("radio", { name: "Lista" }));
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("arrows move the selection with wrap; Home/End jump; focus follows", () => {
    const onChangeSpy = vi.fn();
    render(<StatefulControl initial="agenda" onChangeSpy={onChangeSpy} />);
    const radio = (name: string) => screen.getByRole("radio", { name });

    radio("Agenda").focus();
    expect(document.activeElement).toBe(radio("Agenda"));

    // Wrap forward: last option -> first.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("calendar");
    expect(document.activeElement).toBe(radio("Calendario"));

    // Wrap backward: first option -> last.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("agenda");
    expect(document.activeElement).toBe(radio("Agenda"));

    // Plain (non-wrap) previous, twice: last -> middle -> first.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("list");
    expect(document.activeElement).toBe(radio("Lista"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("calendar");
    expect(document.activeElement).toBe(radio("Calendario"));

    // End jumps from the first option straight to the last.
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("agenda");
    expect(document.activeElement).toBe(radio("Agenda"));

    // Home jumps from the last option straight to the first.
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(onChangeSpy).toHaveBeenLastCalledWith("calendar");
    expect(document.activeElement).toBe(radio("Calendario"));
  });

  it("Home on the already-checked, already-focused option fires no onChange and leaves focus put", () => {
    // Regression coverage for the review finding: keyboard navigation that
    // resolves to the option already checked (and already focused) in a
    // normal, re-rendering controlled parent must be a genuine no-op — no
    // onChange, no haptic — the same guard a click on the checked option
    // already has.
    const onChangeSpy = vi.fn();
    render(<StatefulControl initial="calendar" onChangeSpy={onChangeSpy} />);
    const calendario = screen.getByRole("radio", { name: "Calendario" });
    calendario.focus();

    fireEvent.keyDown(document.activeElement!, { key: "Home" });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(calendario);
  });

  it("renders no thumb and no tab stop when nothing is selected yet", () => {
    mount(null);
    expect(document.querySelector("[data-segmented-thumb]")).toBeNull();
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("draws the thumb inside the checked option only", () => {
    mount("list");
    const thumbs = document.querySelectorAll("[data-segmented-thumb]");
    expect(thumbs).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Lista" }).contains(thumbs[0])).toBe(true);
  });

  it("uses ariaLabel, badge and busy per option", () => {
    render(
      <MotionProvider>
        <SegmentedControl
          label="Filtro"
          value="pending"
          onChange={() => {}}
          options={[
            { value: "all", label: "Todas" },
            { value: "pending", label: "Pendientes", badge: 3, busy: true },
          ]}
        />
      </MotionProvider>,
    );
    const pending = screen.getByRole("radio", { name: /Pendientes/ });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.textContent).toContain("3");
  });
});
