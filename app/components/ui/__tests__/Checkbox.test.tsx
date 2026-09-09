/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Checkbox from "../Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a real native checkbox named by its visible label", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.checked);
    render(<Checkbox checked={false} onChange={onChange}>Omitir</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Omitir" });
    expect(screen.getByLabelText("Omitir")).toBe(box);
    fireEvent.click(box);
    expect(onChange).toHaveReturnedWith(true);
  });

  it("takes aria-label when there is no visible label, and forwards disabled", () => {
    render(<Checkbox aria-label="Omitir 2026-09-13" checked disabled onChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: "Omitir 2026-09-13" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it("draws the mark with a transform-only reveal, never display", () => {
    render(<Checkbox checked onChange={() => {}}>Sí</Checkbox>);
    const box = document.querySelector("[data-checkbox-box]")!;
    const mark = document.querySelector("[data-checkbox-mark]")!;
    expect(box.className).toMatch(/peer-checked:\[&>svg\]:scale-100/);
    expect(mark.getAttribute("class")).toMatch(/\bscale-0\b/);
    expect(box.className + mark.getAttribute("class")).not.toMatch(/peer-checked:block|hidden/);
  });

  it("aligns the label row by align, defaulting to center", () => {
    render(<Checkbox checked onChange={() => {}}>Sí</Checkbox>);
    const label = screen.getByRole("checkbox").closest("label")!;
    const box = document.querySelector("[data-checkbox-box]")!;
    const labelTokens = label.className.split(/\s+/);
    const boxTokens = box.className.split(/\s+/);
    expect(labelTokens).toContain("items-center");
    expect(labelTokens).not.toContain("items-start");
    expect(boxTokens).not.toContain("mt-0.5");
  });

  it("align=\"start\" sits the box on the label's first text line", () => {
    render(<Checkbox align="start" checked onChange={() => {}}>Sí</Checkbox>);
    const label = screen.getByRole("checkbox").closest("label")!;
    const box = document.querySelector("[data-checkbox-box]")!;
    const labelTokens = label.className.split(/\s+/);
    const boxTokens = box.className.split(/\s+/);
    expect(labelTokens).toContain("items-start");
    expect(labelTokens).not.toContain("items-center");
    expect(boxTokens).toContain("mt-0.5");
  });
});
