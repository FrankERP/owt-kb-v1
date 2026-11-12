/** @vitest-environment jsdom */
// The folded service (R1 Task 7, spec §12.1; a CARD since ADR-0088). Home shows the next
// service in full and every other one through this: a card head — the date leaf, the day,
// the clock, the countdown, who leads as faces — that opens onto the service's sheet.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
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

// `DayCard` raises a toast from its quick-actions sheet (F3), so it needs the stack
// its real host mounts app-wide in `app/utils/Provider.tsx`.
function mount(extra: Partial<Parameters<typeof DayCardDisclosure>[0]> = {}) {
  return render(
    <MotionProvider>
      <ToastProvider>
        <CueDialogProvider>
          <DayCardDisclosure day="Sábado" date="2026-09-19" setlist={{ week: "2026-09-19", songs: [song] }} leads={["Ana"]} {...extra} />
        </CueDialogProvider>
      </ToastProvider>
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
  it("summarizes the folded card — who leads, how many songs — with no «tú» chip for a service you do not serve", () => {
    mount({ leads: ["Ana", "Gaby"] });
    const row = screen.getByRole("button", { expanded: false });
    expect(row.textContent).toContain("Lead Ana y Gaby");
    expect(row.textContent).toContain("1 canción");
    expect(within(row).queryByText(/^Tú ·/)).toBeNull();
  });

  it("says «Setlist pendiente» for a team published before its songs, and shows who leads as faces", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0)); // before the service: only a coming one is pending
    mount({ leads: ["Ana", "Gaby"], setlist: { week: "2026-09-19", songs: [] }, photos: { ana: "https://lh3.googleusercontent.com/a/ana" } });
    const row = screen.getByRole("button", { expanded: false });
    expect(row.textContent).toContain("Setlist pendiente");
    expect(row.textContent).not.toMatch(/canci[oó]n/);
    // One face per lead: Ana's photo, Gaby's initials.
    expect(row.querySelectorAll("img")).toHaveLength(1);
    expect(within(row).getByText("GA")).toBeTruthy();
    // A screen reader hears it too: the label is the head's whole summary.
    expect(row.getAttribute("aria-label")).toMatch(/Lead Ana y Gaby, setlist pendiente$/);
  });

  it("folds its summary away as the card opens — a span, because it lives inside the head's button", () => {
    mount({ leads: ["Ana", "Gaby"] });
    const trigger = screen.getByRole("button", { expanded: false });
    const facts = within(trigger).getByText(/Lead Ana y Gaby/).closest("[style]") as HTMLElement;
    // Phrasing content only inside a <button>: no <div> anywhere in the head.
    expect(trigger.querySelector("div")).toBeNull();
    expect(facts.tagName).toBe("SPAN");
    expect(facts.getAttribute("aria-hidden")).toBeNull();
    // No `space-y` on the column the summary sits in: a closed Collapse would keep its gap.
    expect(facts.parentElement!.className).not.toMatch(/space-y/);
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // The opened sheet says «Diriges»/«Setlist» itself; the summary is on its way out.
    const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(region.getAttribute("aria-hidden")).toBeNull();
  });

  it("gives a booth seat the booth's glyph beside «Tú», whatever the seat is called", () => {
    mount({ leads: ["Gaby"], fohTeam: [{ label: "Stream", person: "Ani" }] });
    const chip = screen.getByText("Tú · Stream");
    // Sliders (three lines with knobs), not the unknown-seat note.
    const withSection = chip.querySelector("svg")!.innerHTML;
    cleanup();
    mount({ leads: ["Gaby"], fohTeam: [{ label: "Console", person: "Ani" }] });
    expect(screen.getByText("Tú · Console").querySelector("svg")!.innerHTML).toBe(withSection);
  });

  it("chips the seats you hold, matched by the session's display name", () => {
    mount({ leads: ["Ani"], instruments: [{ label: "Keys", person: "ani" }] });
    const row = screen.getByRole("button", { expanded: false });
    expect(within(row).getByText("Tú · Lead, Keys").className).toContain("text-positive-fg");
  });

  it("folds the service into one card head: the date as a leaf, the day as the title, the countdown", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0)); // 2026-09-08 local
    const { container } = mount();
    const trigger = screen.getByRole("button", { name: /Sábado/ });
    // The leaf is decorative — the head's own label says the date — and reads «Sáb 19 sep».
    const leaf = trigger.querySelector("time")!;
    expect(leaf.getAttribute("datetime")).toBe("2026-09-19");
    expect(leaf.getAttribute("aria-hidden")).toBe("true");
    expect(leaf.textContent).toMatch(/Sáb\s*19\s*sep/i);
    expect(trigger.getAttribute("aria-label")).toMatch(/^Sábado, 19 sep/i);
    expect(trigger.getAttribute("aria-label")).toContain("en 11 días");
    expect(trigger.textContent).toMatch(/en 11 días/i);
    // ADR-0088: a card with an edge and the day's rail, the title in the display face, uppercase.
    expect(container.querySelector("article.brand-surface")).toBeTruthy();
    expect(container.querySelector(".w-\\[3px\\]")!.className).toContain("animate-rail-draw");
    const title = within(trigger).getByText("Sábado", { selector: "span" });
    expect(title.className).toContain("font-display");
    expect(title.className).toContain("uppercase");
  });

  it("carries the clock: the standing time of a weekend service, a special's own, none for a special without one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0));
    mount();
    expect(screen.getByRole("button", { name: /Sábado/ }).textContent).toMatch(/18:00/);
    cleanup();
    mount({ day: "Campamento", roleId: "special-1", time: "18:45" });
    expect(screen.getByRole("button", { name: /Campamento/ }).textContent).toMatch(/18:45/);
    cleanup();
    mount({ day: "Campamento", roleId: "special-1" });
    expect(screen.getByRole("button", { name: /Campamento/ }).textContent).not.toMatch(/\d\d:\d\d/);
  });

  it("opened, the card draws the sheet's body alone — no second heading repeats the day", () => {
    mount();
    const trigger = screen.getByRole("button", { name: /Sábado/ });
    const region = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    // `hidden`: the closed region is inert and aria-hidden, which role queries skip.
    expect(within(region).queryByRole("heading", { level: 3, hidden: true })).toBeNull();
    expect(within(region).getByRole("heading", { level: 4, name: /^Setlist/, hidden: true })).toBeTruthy();
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

  // R7 final wave: the disclosure's own UID must equal `/me`'s `<_id>@owt`
  // form for the same service document, or a member's export from the two
  // surfaces creates two calendar entries for one service. The id goes in RAW —
  // a mixed-case Sanity `_id` here, since `/me` exports the `_id` untouched and
  // case-folding it would mint that second entry.
  it("the .ics UID is the RAW `<serviceId>@owt`, case included", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 8, 8, 9, 0, 0));
    let text = "";
    const createObjectURL = vi.fn((b: Blob) => {
      void b.text().then((t) => { text = t; });
      return "blob:mock";
    });
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <MotionProvider>
        <ToastProvider>
          <CueDialogProvider>
            <DayCardDisclosure
              day="Sábado"
              date="2026-09-19"
              serviceId="Abc123"
              setlist={{ week: "2026-09-19", songs: [song] }}
              leads={["Ana"]}
            />
          </CueDialogProvider>
        </ToastProvider>
      </MotionProvider>,
    );
    longPress(screen.getByRole("button", { name: /Sábado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Añadir a mi calendario" }));
    // Flush the Blob#text() microtask queued above.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(text).toContain("UID:Abc123@owt");
    click.mockRestore();
  });
});
