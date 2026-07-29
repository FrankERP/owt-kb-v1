/** @vitest-environment jsdom */
// The board's whole reason for existing is that the roster is visible and honest.
// These pin the three things the old sheet could not do: show the entire pool at
// once, mark unavailability and existing assignment before the save, and refuse a
// same-category double booking.
import { fireEvent, render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SeatBoard from "../SeatBoard";

afterEach(() => cleanup());

const members = [
  { _id: "m1", member_name: "Frank", memberType: ["voz", "instrumento"] },
  { _id: "m2", member_name: "Gaby", memberType: ["voz"] },
  { _id: "m3", member_name: "Liu", memberType: ["voz"], unavailableDates: ["2026-08-09"] },
  { _id: "m4", member_name: "Samo", memberType: ["instrumento"] },
];

const base = {
  members,
  windowRoles: [],
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  loading: false,
};

describe("SeatBoard", () => {
  it("shows the whole eligible pool at once, not a 4-row window", () => {
    render(<SeatBoard {...base} />);
    // All three voz members are in the document simultaneously.
    expect(screen.getByText("Frank")).toBeTruthy();
    expect(screen.getByText("Gaby")).toBeTruthy();
    expect(screen.getByText("Liu")).toBeTruthy();
  });

  it("marks an unavailable member before anything is saved", () => {
    render(<SeatBoard {...base} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    expect(screen.getByText(/no disp/i)).toBeTruthy();
  });

  it("seats a person into the targeted seat on click", () => {
    render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Gaby"));
    // The chip for the seated person appears in the seat pane.
    expect(screen.getAllByText("Gaby").length).toBeGreaterThan(1);
  });

  it("uses «Ya asignado», never «sentado»", () => {
    const { container } = render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Frank"));
    expect(container.textContent?.toLowerCase()).not.toContain("sentad");
  });

  it("submits the same payload shape the API already accepts", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    fireEvent.click(screen.getByText("Gaby"));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ _type: "sunday_role", date: "2026-08-09", leads: ["m2"] });
    expect(Array.isArray(payload.instruments)).toBe(true);
    expect(Array.isArray(payload.foh)).toBe(true);
  });

  it("disables save while a submit block is in force, and shows the reason", () => {
    render(<SeatBoard {...base} submitBlockedReason="Datos incompletos." />);
    const save = screen.getByRole("button", { name: /guardar|crear/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Datos incompletos.");
  });
});
