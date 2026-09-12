/** @vitest-environment jsdom */
//
// «Mi semana»'s availability surface: ten weekend rows, two taps, one save.
//
// Rendered through the HOST (`MyAvailabilityPanel`), never the list alone, because
// the list is only half the contract — the toggles, the save button, the toast and
// the grid disclosure all read one `useAvailability`, and a test that mounted
// `WeekendList` with a hand-made state object would prove nothing about the thing
// `/me` ships.
//
// The revision/conflict half of that save is pinned in
// `app/components/__tests__/availabilityCalendarConflict.test.tsx`; this file is
// about the surface: what is offered, what a tap marks, what reaches the PATCH.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import MyAvailabilityPanel from "../MyAvailabilityPanel";

const toastMock = vi.fn();
vi.mock("@/app/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));
const hapticMock = vi.fn();
vi.mock("@/app/utils/haptics", () => ({ haptic: (k: string) => hapticMock(k) }));

installMotionTestEnv();
// Warm the LazyMotion feature chunk (ADR-0031), precedent Menu.test.tsx.
beforeAll(async () => { await import("@/app/components/ui/motionFeatures"); });

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  // Wednesday 9 September 2026 — the first weekend row is 12/13 sep.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-09T12:00:00-06:00"));
  fetchMock.mockReset();
  toastMock.mockReset();
  hapticMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel(serviceDates: string[] = []) {
  return render(
    <MotionProvider>
      <MyAvailabilityPanel
        initialRev="rev-1"
        initialDates={[]}
        initialNotes={[]}
        serviceDates={serviceDates}
      />
    </MotionProvider>,
  );
}

const rows = () => screen.getByRole("list").querySelectorAll("li");
const saveButton = () => screen.getByRole("button", { name: /Guarda/ }) as HTMLButtonElement;

describe("WeekendList", () => {
  it("offers the next ten weekends, this one first, Friday through Sunday", () => {
    renderPanel();
    const list = rows();
    expect(list).toHaveLength(10);
    expect(list[0].textContent).toContain("11 – 13 sep");
    // Ten weeks out: 13/14/15 November.
    expect(list[9].textContent).toContain("13 – 15 nov");
    const [fri, sat, sun] = within(list[0] as HTMLElement).getAllByRole("button");
    expect(fri.textContent).toContain("VIE");
    expect(sat.textContent).toContain("SÁB");
    expect(sun.textContent).toContain("DOM");
  });

  it("names the Friday pill in Spanish, rehearsal day before the weekend", () => {
    renderPanel();
    const first = rows()[0] as HTMLElement;
    const friday = within(first).getByRole("button", { name: /viernes, 11 de septiembre/ });
    expect(friday).toBeTruthy();
  });

  it("marks the Sunday it was told to, enables the save, and sends that date", async () => {
    renderPanel();
    const first = rows()[0] as HTMLElement;
    const sunday = within(first).getByRole("button", { name: /domingo, 13/ });

    expect(sunday.getAttribute("aria-pressed")).toBe("false");
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(sunday);
    expect(sunday.getAttribute("aria-pressed")).toBe("true");
    // Pressed means «no puedo» — the name says so, not only the fill.
    expect(sunday.getAttribute("aria-label")).toContain("no puedo");
    expect(hapticMock).toHaveBeenCalledWith("selection");
    expect(saveButton().disabled).toBe(false);
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(reply(200, { _rev: "rev-2", unavailableDates: ["2026-09-13"], unavailabilityNotes: [] }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ _rev: "rev-1", unavailableDates: ["2026-09-13"], unavailabilityNotes: [] });

    // "Guardado ✓" is the toast stack's, not an inline flash on the button.
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({ message: "Guardado ✓", tone: "ok", duration: 2500 }),
    );
    await waitFor(() => expect(screen.queryByText("Cambios sin guardar")).toBeNull());
  });

  it("tapping again un-marks the day", () => {
    renderPanel();
    const sunday = within(rows()[0] as HTMLElement).getByRole("button", { name: /domingo, 13/ });
    fireEvent.click(sunday);
    fireEvent.click(sunday);
    expect(sunday.getAttribute("aria-pressed")).toBe("false");
    expect(saveButton().disabled).toBe(true);
  });

  it("on a Saturday, the first row's VIE is a past day — disabled, and unclickable", () => {
    // Friday already happened; the weekend itself still counts (its Sunday is ahead).
    vi.setSystemTime(new Date("2026-09-12T12:00:00-06:00"));
    renderPanel();
    const first = rows()[0] as HTMLElement;
    const friday = within(first).getByRole("button", { name: /viernes, 11/ });
    expect(friday.hasAttribute("disabled")).toBe(true);

    fireEvent.click(friday);
    expect(friday.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("on a Sunday, the first row's SÁB is a past day — disabled, and unclickable", () => {
    // The weekend still counts (its Sunday is today), but the Saturday half of
    // it already happened.
    vi.setSystemTime(new Date("2026-09-13T12:00:00-06:00"));
    renderPanel();
    const first = rows()[0] as HTMLElement;
    const saturday = within(first).getByRole("button", { name: /sábado, 12/ });
    expect(saturday.hasAttribute("disabled")).toBe(true);

    fireEvent.click(saturday);
    expect(saturday.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Cambios sin guardar")).toBeNull();
  });

  it("says which day has a service, and only that day", () => {
    renderPanel(["2026-09-13"]);
    const first = rows()[0] as HTMLElement;
    expect(within(first).getByRole("button", { name: /domingo, 13/ }).getAttribute("aria-label")).toContain("hay servicio");
    expect(within(first).getByRole("button", { name: /sábado, 12/ }).getAttribute("aria-label")).not.toContain("hay servicio");
  });

  it("renders the service dot marker itself on a service day, not just its label", () => {
    renderPanel(["2026-09-13"]);
    const first = rows()[0] as HTMLElement;
    const sunday = within(first).getByRole("button", { name: /domingo, 13/ });
    const saturday = within(first).getByRole("button", { name: /sábado, 12/ });
    expect(sunday.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    expect(saturday.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it("offers «Razón» for a marked day, and it opens the note field for THAT day", () => {
    renderPanel();
    const first = rows()[0] as HTMLElement;
    expect(within(first).queryByRole("button", { name: /^Razón/ })).toBeNull();

    fireEvent.click(within(first).getByRole("button", { name: /domingo, 13/ }));
    fireEvent.click(within(first).getByRole("button", { name: /Razón/ }));

    const field = screen.getByPlaceholderText(/razón/i);
    fireEvent.change(field, { target: { value: "Viaje" } });
    expect((field as HTMLInputElement).value).toBe("Viaje");
    // The popover names the date it is pinned to.
    expect(screen.getByText(/domingo, 13 de septiembre/i)).toBeTruthy();
  });

  it("closes the note when its day is un-marked — the reason goes with the date", () => {
    renderPanel();
    const first = rows()[0] as HTMLElement;
    const sunday = within(first).getByRole("button", { name: /domingo, 13/ });

    fireEvent.click(sunday);
    fireEvent.click(within(first).getByRole("button", { name: /Razón/ }));
    expect(screen.queryByPlaceholderText(/razón/i)).not.toBeNull();

    fireEvent.click(sunday); // un-mark
    expect(screen.queryByPlaceholderText(/razón/i)).toBeNull();
  });

  it("keeps the grid closed until «Ver calendario», and inert while it is", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Ver calendario" });
    const grid = document.getElementById("availability-grid")!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(grid.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(grid.getAttribute("aria-hidden")).toBeNull();
    // The grid's own months, on the panel's one state.
    expect(within(grid).getByText("Septiembre 2026")).toBeTruthy();
  });

  it("shares one save with the grid — a day marked in the list is marked there too", () => {
    renderPanel();
    fireEvent.click(within(rows()[0] as HTMLElement).getByRole("button", { name: /domingo, 13/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ver calendario" }));

    const grid = document.getElementById("availability-grid")!;
    const day13 = within(grid).getByRole("button", { name: /domingo, 13 de septiembre, no disponible/i });
    expect(day13.className).toContain("bg-availability-fg/");
  });
});
