/** @vitest-environment jsdom */
// The collapsed service (R1 Task 7, spec §12.1). Home shows the next service in
// full and every other one through this: one line — day · date and the countdown
// — that opens onto the ordinary card.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { SetlistSong } from "@/app/utils/interface";

installMotionTestEnv();

vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet: vi.fn() }) }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Ana", alias: "Ani", role: "member" } } }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import DayCardDisclosure from "../DayCardDisclosure";

// Warm the LazyMotion feature chunk (ADR-0031), precedent Collapse.test.tsx.
beforeAll(async () => { await import("@/app/components/ui/motionFeatures"); });

const song: SetlistSong = {
  _id: "s1", title: "Canción s1", author: "Oasis", slug: { current: "s1" }, timeSig: "4/4", bpm: "", key: "G", play_key: "G",
} as SetlistSong;

function mount() {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <DayCardDisclosure day="Sábado" date="2026-09-19" setlist={{ week: "2026-09-19", songs: [song] }} leads={["Ana"]} />
      </CueDialogProvider>
    </MotionProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.useRealTimers();
});

function longPress(el: Element) {
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(450); });
  fireEvent.pointerUp(el, { isPrimary: true });
}

describe("DayCardDisclosure", () => {
  it("collapses the service to one line: day · date and the countdown", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0)); // 2026-09-08 local
    mount();
    const trigger = screen.getByRole("button", { name: /Sábado/ });
    // jsdom's ICU renders es-MX `month: short` as "19 sep"; only the day number
    // is stable across ICU builds, so the month is matched case-insensitively.
    expect(trigger.textContent).toMatch(/Sábado\s*·\s*19\s*sep/i);
    expect(trigger.textContent).toContain("en 11 días");
  });

  it("opens onto the card, and the setlist lives inside the collapsed region", () => {
    mount();
    const trigger = screen.getByRole("button", { name: /Sábado/ });
    const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(within(region).getByText("Canción s1")).toBeTruthy();
    // Closed = mounted but unreachable: that is what lets a full card sit here.
    expect(region.getAttribute("aria-hidden")).toBe("true");
    expect(region.hasAttribute("inert")).toBe(true);

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(region.getAttribute("aria-hidden")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

// R7 Task 4 (spec §12.8): the collapsed row's long-press quick actions.
describe("DayCardDisclosure quick actions", () => {
  it("a long press opens a sheet titled with the row's own day · date, and the row does not expand", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0));
    mount();
    const trigger = screen.getByRole("button", { name: /Sábado/ });
    longPress(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/Sábado\s*·\s*19\s*sep/i);
    expect(within(dialog).getByRole("button", { name: "Ver en calendario" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Añadir a mi calendario" })).toBeTruthy();
  });

  it("«Ver en calendario» pushes /schedule", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0));
    mount();
    longPress(screen.getByRole("button", { name: /Sábado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ver en calendario" }));
    expect(push).toHaveBeenCalledWith("/schedule");
  });

  it("«Añadir a mi calendario» downloads this service's .ics", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0));
    const created: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => { created.push(b); return "blob:mock"; });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    longPress(screen.getByRole("button", { name: /Sábado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Añadir a mi calendario" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0].type).toContain("text/calendar");
    click.mockRestore();
  });
});
