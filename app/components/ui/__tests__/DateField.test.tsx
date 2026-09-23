/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DateField from "../DateField";

afterEach(cleanup);

describe("DateField", () => {
  it("is the native date input, named by its label", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.value);
    render(<DateField kind="date" id="f" label="Fecha" value="2026-09-13" onChange={onChange} />);
    const input = screen.getByLabelText("Fecha") as HTMLInputElement;
    expect(input.type).toBe("date");
    fireEvent.change(input, { target: { value: "2026-09-14" } });
    expect(onChange).toHaveReturnedWith("2026-09-14");
  });

  it("month kind with onStep draws Anterior/Siguiente and reports the delta", () => {
    const onStep = vi.fn();
    render(<DateField kind="month" aria-label="Ir al mes" value="2026-09" onChange={() => {}} onStep={onStep} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([-1, 1]);
    expect((screen.getByLabelText("Ir al mes") as HTMLInputElement).type).toBe("month");
  });

  it("disables the stepper arrows too — the field is ONE control, not an input plus two buttons", () => {
    // A caller that disables the field while a month loads must not be left with
    // two live arrows paging the month out from under the request in flight.
    const onStep = vi.fn();
    render(<DateField kind="month" aria-label="Mes" value="2026-09" disabled onChange={() => {}} onStep={onStep} />);
    for (const name of ["Mes anterior", "Mes siguiente"]) {
      const arrow = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(arrow.disabled).toBe(true);
      fireEvent.click(arrow);
    }
    expect(onStep).not.toHaveBeenCalled();
  });

  it("forwards min, max and disabled to the input", () => {
    render(<DateField kind="date" aria-label="F" value="2026-09-01" min="2026-09-01" max="2026-09-30" disabled onChange={() => {}} />);
    const input = screen.getByLabelText("F") as HTMLInputElement;
    expect(input.min).toBe("2026-09-01");
    expect(input.max).toBe("2026-09-30");
    expect(input.disabled).toBe(true);
  });

  it("time kind is the native time input", () => {
    const onChange = vi.fn((e: React.ChangeEvent<HTMLInputElement>) => e.target.value);
    render(<DateField kind="time" id="t" label="Hora" value="09:00" onChange={onChange} />);
    const input = screen.getByLabelText("Hora") as HTMLInputElement;
    expect(input.type).toBe("time");
    fireEvent.change(input, { target: { value: "18:45" } });
    expect(onChange).toHaveReturnedWith("18:45");
  });
});
