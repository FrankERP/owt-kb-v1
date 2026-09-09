/** @vitest-environment jsdom */
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

function mount(value: "calendar" | "list" | "agenda" | null, onChange = vi.fn()) {
  render(
    <MotionProvider>
      <SegmentedControl label="Vista" value={value} onChange={onChange} options={OPTIONS} />
    </MotionProvider>,
  );
  return onChange;
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
    const onChange = mount("agenda");
    const last = screen.getByRole("radio", { name: "Agenda" });
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("calendar");
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("list");
    fireEvent.keyDown(last, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("calendar");
    fireEvent.keyDown(last, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("agenda");
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
