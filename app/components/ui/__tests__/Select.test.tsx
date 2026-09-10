/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Select from "../Select";

afterEach(cleanup);

describe("Select", () => {
  it("is the native select, named by its label, changing through onChange", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLSelectElement>) => e.target.value);
    render(
      <Select id="mes" label="Mes" value="1" onChange={onChange}>
        <option value="1">Enero</option>
        <option value="2">Febrero</option>
      </Select>,
    );
    const sel = screen.getByLabelText("Mes") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("1");
    fireEvent.change(sel, { target: { value: "2" } });
    expect(onChange).toHaveReturnedWith("2");
  });

  it("takes aria-label without a visible label and forwards disabled", () => {
    render(
      <Select aria-label="Fecha del servicio especial" value="a" disabled onChange={() => {}}>
        <option value="a">A</option>
      </Select>,
    );
    const sel = screen.getByLabelText("Fecha del servicio especial") as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    expect(document.querySelector("select")).toBe(sel);
  });

  it("draws a chevron that is not in the accessibility tree", () => {
    render(<Select aria-label="X" value="a" onChange={() => {}}><option value="a">A</option></Select>);
    expect(document.querySelector("[data-select-chevron]")?.getAttribute("aria-hidden")).toBe("true");
  });
});
