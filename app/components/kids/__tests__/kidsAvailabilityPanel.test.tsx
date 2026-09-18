/** @vitest-environment jsdom */
// app/components/kids/__tests__/kidsAvailabilityPanel.test.tsx
//
// R6 Task 3: the panel's flashes moved to the one toast stack (the 409 conflict
// message is HELD, not flashed — see the component's own doc comment on `save`),
// month navigation moved to `DateField kind="month"` + `onStep`, and each day
// cell is now a pill `Button` whose `aria-pressed` IS the marked state.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/app/components/ui/Toast";
import KidsAvailabilityPanel, { type AvailabilityMember } from "../KidsAvailabilityPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withProviders = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

const member: AvailabilityMember = {
  _id: "mem-1",
  _rev: "rev-1",
  member_name: "Ana Pérez",
  unavailableDates: [],
  unavailabilityNotes: [],
};

describe("KidsAvailabilityPanel", () => {
  it("holds the 409 conflict message until something replaces it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/kids/members/${member._id}/availability` && init?.method === "PATCH") {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            _rev: "rev-2",
            unavailableDates: ["2026-09-05"],
            unavailabilityNotes: [],
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    withProviders(<KidsAvailabilityPanel initialMembers={[member]} />);

    const day = screen.getAllByRole("button", { pressed: false })[0];
    fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));

    // The persisted conflict message — copied verbatim from save()'s :151-155.
    // The toast viewport mirrors it into a sr-only alert region too, so this
    // asserts at least one match rather than a single unique node.
    await waitFor(() => {
      const matches = screen.getAllByText(/cambió mientras editabas — tus cambios NO se guardaron/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("steps the month with the DateField arrows", async () => {
    withProviders(<KidsAvailabilityPanel initialMembers={[member]} />);

    const monthInput = screen.getByLabelText("Mes") as HTMLInputElement;
    const before = monthInput.value;

    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));

    await waitFor(() => expect(monthInput.value).not.toBe(before));
  });

  it("marks a day through a pill Button with aria-pressed", async () => {
    withProviders(<KidsAvailabilityPanel initialMembers={[member]} />);

    const day = screen.getAllByRole("button", { pressed: false })[0];
    fireEvent.click(day);
    expect(day.getAttribute("aria-pressed")).toBe("true");
  });
});
