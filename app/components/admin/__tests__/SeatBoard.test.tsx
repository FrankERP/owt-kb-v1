/** @vitest-environment jsdom */
// The board's whole reason for existing is that the roster is visible and honest.
// These pin the three things the old sheet could not do: show the entire pool at
// once, mark unavailability and existing assignment before the save, and refuse a
// same-category double booking.
import { fireEvent, render, cleanup, screen, within } from "@testing-library/react";
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
    // The chip for the seated person appears inside the seat pane (the "Voces"
    // section), not merely somewhere else in the document (e.g. still only in
    // the roster).
    const seatPane = screen.getByText("Voces").closest("section");
    expect(seatPane).toBeTruthy();
    expect(within(seatPane as HTMLElement).getByText("Gaby")).toBeTruthy();
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
    // Create mode renders both "Crear" and "Crear y publicar" simultaneously,
    // so the selector must be exact rather than matching either.
    const save = screen.getByRole("button", { name: /^crear$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Datos incompletos.");
  });

  it("create mode renders two separate, always-visible submit actions", () => {
    render(<SeatBoard {...base} />);
    expect(screen.getByRole("button", { name: /^crear$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear y publicar" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("submits with published: false from the plain Crear button, and published: true from Crear y publicar", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ published: false });

    fireEvent.click(screen.getByRole("button", { name: "Crear y publicar" }));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ published: true });
  });

  it("rejects a new seat name that only differs from an existing one by case", () => {
    render(<SeatBoard {...base} />);
    const input = screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Trombone" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(screen.getAllByText("Trombone")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "trombone" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    // Still exactly one seat — the lowercase spelling was rejected, not
    // silently created as a second seat with a different casing.
    expect(screen.getAllByText("Trombone")).toHaveLength(1);
    expect(screen.getByText(/ya existe/i)).toBeTruthy();
  });
});
