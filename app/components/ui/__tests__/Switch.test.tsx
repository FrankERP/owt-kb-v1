/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "../MotionProvider";
import Switch from "../Switch";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("Switch", () => {
  it("is a named role=switch that reports the flipped value", () => {
    const onChange = vi.fn();
    render(<MotionProvider><Switch aria-label="Mostrar acordes" checked={false} onChange={onChange} /></MotionProvider>);
    const sw = screen.getByRole("switch", { name: "Mostrar acordes" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<MotionProvider><Switch aria-label="Setlist" checked disabled onChange={onChange} /></MotionProvider>);
    fireEvent.click(screen.getByRole("switch", { name: "Setlist" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the knob at its resting position without waiting for the feature chunk", () => {
    render(<MotionProvider><Switch aria-label="On" checked onChange={() => {}} /></MotionProvider>);
    const knob = document.querySelector<HTMLElement>("[data-switch-knob]")!;
    expect(knob.style.transform).toMatch(/translateX\(20px\)/);
  });
});
