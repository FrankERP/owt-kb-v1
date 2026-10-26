/** @vitest-environment jsdom */
// R2 Task 3 — the schedule's month header and week strip.
//
// What these assert is the WIRING: seven cells per view (the strip is a week strip,
// not a month scroller), which of them are reachable (a day with no service is
// `disabled`, so the week is legible without being clickable), which one is today,
// that a pick reports the ISO date the sheet will be opened with, and that a swipe
// pages the week client-side while reporting the new Monday. `weekStripDays` itself is
// tested in `app/utils/__tests__/agenda.test.ts` — this file never re-derives a tone.
//
// `SwipeStrip` is mocked: motion's drag gesture cannot be driven in jsdom (no layout,
// no pointer capture — see `SwipeStrip.test.tsx`, whose pure `swipeDirection` helper
// carries the threshold arithmetic), so the mock exposes `onSwipe` through two test
// buttons instead. They are `data-testid`-tagged so the cell queries can exclude them.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { ComponentProps, ReactNode } from "react";
import type { ActiveDay } from "../CalendarView";

installMotionTestEnv();

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const haptic = vi.fn();
vi.mock("../../utils/haptics", () => ({ haptic: (kind: string) => haptic(kind) }));

vi.mock("../ui/SwipeStrip", () => ({
  default: ({
    onSwipe,
    className,
    children,
  }: {
    onSwipe: (direction: -1 | 1) => void;
    className?: string;
    children: ReactNode;
  }) => (
    <div className={className}>
      <button type="button" data-testid="swipe-next" onClick={() => onSwipe(1)} />
      <button type="button" data-testid="swipe-prev" onClick={() => onSwipe(-1)} />
      {children}
    </div>
  ),
}));

import DayStrip from "../DayStrip";
import ScheduleHeader from "../ScheduleHeader";

afterEach(() => {
  cleanup();
  push.mockReset();
  haptic.mockReset();
});

const sunday = (date: string): ActiveDay => ({ day: "Domingo", date, leads: ["Ana"] });
const saturday = (date: string): ActiveDay => ({ day: "Sábado", date, leads: ["Beto"] });
const special = (date: string): ActiveDay => ({ day: "Aniversario", date, roleId: "r1" });

// September 2026: the 12th/19th are Saturdays, the 13th/20th Sundays, the 20th also
// carries a special. Two consecutive weeks, so a swipe has somewhere lit to land.
const ACTIVE: Record<string, ActiveDay[]> = {
  "2026-09-12": [saturday("2026-09-12")],
  "2026-09-13": [sunday("2026-09-13")],
  "2026-09-19": [saturday("2026-09-19")],
  "2026-09-20": [sunday("2026-09-20"), special("2026-09-20")],
};

/** The day cells (the round number buttons), excluding the mocked SwipeStrip's two test triggers. */
const cells = () => screen.getAllByRole("button").filter((b) => !(b as HTMLElement).dataset.testid);
const cell = (label: string) => cells().find((b) => b.getAttribute("aria-label")?.includes(label))!;
/** The dots sit UNDER the button, outside it (the «millones» pass), in the cell's wrapper. */
const dotsOf = (b: HTMLElement) => within(b.parentElement as HTMLElement).queryByTestId("day-dots");

function mountStrip(props: Partial<ComponentProps<typeof DayStrip>> = {}) {
  const onPick = props.onPick ?? vi.fn();
  render(
    <MotionProvider>
      <DayStrip
        anchorMonth="2026-09"
        activeDays={ACTIVE}
        todayStr="2026-09-10"
        {...props}
        onPick={onPick}
      />
    </MotionProvider>,
  );
  return onPick;
}

describe("DayStrip", () => {
  it("renders the seven days of today's week, Monday first", () => {
    mountStrip();
    expect(cells()).toHaveLength(7);
    // The button is the number alone (the round target); the weekday is a label above it.
    expect(cells().map((b) => b.textContent)).toEqual(["7", "8", "9", "10", "11", "12", "13"]);
    expect(cells().map((b) => b.parentElement!.firstChild!.textContent)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    expect(screen.getByText(/^7 – 13 sep/)).toBeTruthy();
  });

  it("enables only the days that carry a service", () => {
    mountStrip();
    const enabled = cells().filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.map((b) => b.textContent)).toEqual(["12", "13"]);
  });

  it("marks today with aria-current and the inset ring, service or not", () => {
    mountStrip();
    const current = cells().filter((b) => b.getAttribute("aria-current") === "date");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("10");
    expect(current[0].className).toContain("ring-ink/70");
    expect((current[0] as HTMLButtonElement).disabled).toBe(true);
    expect(cells().filter((b) => b.className.includes("ring-ink/70"))).toHaveLength(1);
  });

  it("ADR-0067 — a lit day is a neutral number with one tone dot per service under it; an empty day has none", () => {
    mountStrip();
    fireEvent.click(screen.getByTestId("swipe-next"));
    const sat = cell("19 de septiembre");
    // No fill of any kind (the «millones» pass retired the raised card too): ink text, that's all.
    expect(sat.className).not.toMatch(/\bbg-/);
    expect(sat.className).toContain("text-ink");
    const satDots = dotsOf(sat)!.children;
    expect(satDots).toHaveLength(1);
    expect(satDots[0].className).toContain("bg-warning-fg");
    // Sunday + a special on the 20th: two dots, in `activeDays` order, no corner mark.
    const both = dotsOf(cell("20 de septiembre"))!.children;
    expect(Array.from(both).map((d) => d.className)).toEqual([expect.stringContaining("bg-accent"), expect.stringContaining("bg-info-fg")]);
    expect(dotsOf(cell("16 de septiembre"))).toBeNull();
  });

  it("reports the ISO date of a picked service day, with one haptic", () => {
    const onPick = mountStrip();
    fireEvent.click(cell("13 de septiembre"));
    expect(onPick).toHaveBeenCalledWith("2026-09-13");
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("selection");
  });

  it("never reports a day with no service", () => {
    const onPick = mountStrip();
    fireEvent.click(cell("9 de septiembre"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names the services of a day in its label", () => {
    mountStrip();
    fireEvent.click(screen.getByTestId("swipe-next"));
    expect(cell("20 de septiembre").getAttribute("aria-label")).toContain("Domingo, Aniversario");
  });

  it("pages the week on a swipe and reports the new Monday — no navigation", () => {
    const onWeekChange = vi.fn();
    mountStrip({ onWeekChange });
    fireEvent.click(screen.getByTestId("swipe-next"));
    expect(cells().map((b) => b.textContent)).toEqual(["14", "15", "16", "17", "18", "19", "20"]);
    expect(onWeekChange).toHaveBeenCalledWith("2026-09-14");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(/^14 – 20 sep/)).toBeTruthy();
    // The week left today behind, so nothing is current any more.
    expect(cells().some((b) => b.getAttribute("aria-current") === "date")).toBe(false);
  });

  it("pages backwards past the month boundary, still lighting nothing it should not", () => {
    mountStrip();
    fireEvent.click(screen.getByTestId("swipe-prev"));
    fireEvent.click(screen.getByTestId("swipe-prev"));
    expect(cells().map((b) => b.textContent)).toEqual(["24", "25", "26", "27", "28", "29", "30"]);
    expect(screen.getByText(/^24 – 30 ago/)).toBeTruthy();
    expect(cells().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("opens on the week of the first day when the anchor month has no today", () => {
    mountStrip({ anchorMonth: "2026-10" });
    // 1 Oct 2026 is a Thursday, so its week starts Monday 28 September.
    expect(cells().map((b) => b.textContent)).toEqual(["28", "29", "30", "1", "2", "3", "4"]);
  });

  it("F1 — adds a green dot («tú») under the day the signed-in member is seated in, and only that one", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    // The number itself stays ink (the «millones» pass): «tú» is a fourth dot, named by the legend.
    expect(dotsOf(cell("13 de septiembre"))!.querySelector("[data-mine]")!.className).toContain("bg-positive-fg");
    expect(cell("13 de septiembre").className).not.toContain("text-positive-fg");
    expect(dotsOf(cell("12 de septiembre"))!.querySelector("[data-mine]")).toBeNull();
  });

  it("marks no day as mine when `myName` is omitted", () => {
    mountStrip();
    expect(document.querySelector("[data-mine]")).toBeNull();
  });

  it("F1 — adds «te toca» to a mine cell's label, and only that cell", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    expect(cell("13 de septiembre").getAttribute("aria-label")).toMatch(/, te toca$/);
    expect(cell("12 de septiembre").getAttribute("aria-label")).not.toMatch(/te toca/);
  });

  it("F1 — a day that is today AND mine keeps all three marks: the ring on the number, the tone dot, the green dot", () => {
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });
    const todayMine = cell("10 de septiembre");
    expect(todayMine.className).toContain("ring-ink/70");
    const dots = dotsOf(todayMine)!.children;
    expect(dots).toHaveLength(2);
    expect(dots[0].className).toContain("bg-accent");
    expect(dots[1].className).toContain("bg-positive-fg");
    expect((todayMine as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps every cell to its three flow children — weekday, number, dots — with nothing absolutely positioned", () => {
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });
    for (const b of cells()) {
      const wrap = b.parentElement!;
      expect(wrap.children.length).toBeLessThanOrEqual(3);
      expect(wrap.querySelector(".absolute")).toBeNull();
    }
  });
});

/** The header opens a `CueDialog`, so it needs the provider its real host has. */
const COUNTS = { services: "3 servicios por venir", mine: null };
function mountHeader(props: Omit<ComponentProps<typeof ScheduleHeader>, "counts"> & { counts?: ComponentProps<typeof ScheduleHeader>["counts"] }) {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <ScheduleHeader counts={COUNTS} {...props} />
      </CueDialogProvider>
    </MotionProvider>,
  );
}

describe("ScheduleHeader", () => {
  it("reads the anchor month in Spanish and links the adjacent months", () => {
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Septiembre 2026");
    expect(screen.getByRole("link", { name: "Mes anterior" }).getAttribute("href")).toBe("/schedule?m=2026-08");
    expect(screen.getByRole("link", { name: "Mes siguiente" }).getAttribute("href")).toBe("/schedule?m=2026-10");
  });

  it("crosses the year boundary one month at a time", () => {
    mountHeader({ anchorMonth: "2026-12", viewMonth: "2026-12" });
    expect(screen.getByRole("link", { name: "Mes siguiente" }).getAttribute("href")).toBe("/schedule?m=2027-01");
  });

  it("offers «Hoy» only in browse mode — twice, one per breakpoint, never beside the arrows on a phone", () => {
    mountHeader({ anchorMonth: "2026-12", viewMonth: "2026-12" });
    const todays = screen.getAllByRole("link", { name: "Hoy" });
    expect(todays.map((a) => a.getAttribute("href"))).toEqual(["/schedule", "/schedule"]);
    // The title-row copy is hidden on a phone (it would push «Septiembre» into an
    // ellipsis); the count-line copy is hidden from `sm`.
    expect(todays[0].className).toContain("hidden sm:inline-flex");
    expect(todays[1].className).toContain("sm:hidden");
    cleanup();
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(screen.queryByRole("link", { name: "Hoy" })).toBeNull();
  });

  it("carries no native month input and no second stepper pair — the arrows are the one-month step", () => {
    // R2 Task 4 ruling, kept through ADR-0067: a `DateField` `onStep` pair would be a
    // SECOND «Mes anterior»/«Mes siguiente» control with the same accessible names
    // as the arrows above it; the native month input itself is gone with the sheet.
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(document.querySelector('input[type="month"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mes anterior" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("counts the services under the month, «te toca en N» in the app's one green, and no «Próximos» label any more", () => {
    const { container } = mountHeader({ anchorMonth: "2026-09", viewMonth: null, counts: { services: "8 servicios por venir", mine: "te toca en 3" } });
    expect(container.textContent).toContain("2026 · 8 servicios por venir · te toca en 3");
    expect(screen.getByText("te toca en 3").className).toContain("text-positive-fg");
    expect(screen.queryByText("Próximos")).toBeNull();
    cleanup();
    // Nobody's seat in the window: the line stops after the count — never «te toca en 0».
    const second = mountHeader({ anchorMonth: "2026-12", viewMonth: "2026-12", counts: { services: "4 servicios", mine: null } });
    expect(second.container.textContent).toContain("4 servicios");
    expect(second.container.textContent).not.toContain("te toca");
    expect(screen.queryByText("Próximos")).toBeNull();
  });

  it("the arrows are round ring buttons, the month the display-face page title", () => {
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(screen.getByRole("link", { name: "Mes anterior" }).className).toContain("rounded-full");
    expect(screen.getByRole("heading", { level: 2 }).className).toMatch(/font-display text-\[clamp\(40px,11\.8vw,46px\)\]/);
  });

  it("ADR-0067 — the month name opens a sheet of the anchor year's twelve months as `?m=` links, the anchor pressed", () => {
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(screen.queryByRole("dialog")).toBeNull();
    const title = screen.getByRole("button", { name: /Septiembre 2026/ });
    expect(title.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(title);
    const sheet = screen.getByRole("dialog", { name: "Ir a un mes" });
    expect(within(sheet).getByText("2026")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Enero 2026" }).getAttribute("href")).toBe("/schedule?m=2026-01");
    expect(within(sheet).getByRole("link", { name: "Diciembre 2026" }).getAttribute("href")).toBe("/schedule?m=2026-12");
    expect(within(sheet).getAllByRole("link")).toHaveLength(11);
    const current = within(sheet).getByRole("button", { name: "Septiembre 2026" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(current.textContent).toBe("Sep");
    expect(title.getAttribute("aria-expanded")).toBe("true");
  });

  it("stops the year arrows at the bounds `?m=` accepts, so no pill links to a refused month", () => {
    mountHeader({ anchorMonth: "2100-06", viewMonth: "2100-06" });
    fireEvent.click(screen.getByRole("button", { name: /Junio 2100/ }));
    const sheet = screen.getByRole("dialog", { name: "Ir a un mes" });
    const next = within(sheet).getByRole("button", { name: "Año siguiente" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(within(sheet).getByText("2100")).toBeTruthy();
    expect(within(sheet).queryByText("2101")).toBeNull();
    expect((within(sheet).getByRole("button", { name: "Año anterior" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the sheet's own arrows change the year, never the month, and a pick closes it", () => {
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    fireEvent.click(screen.getByRole("button", { name: /Septiembre 2026/ }));
    const sheet = screen.getByRole("dialog", { name: "Ir a un mes" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Año anterior" }));
    expect(within(sheet).getByText("2025")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Septiembre 2025" }).getAttribute("href")).toBe("/schedule?m=2025-09");
    expect(within(sheet).getAllByRole("link")).toHaveLength(12); // nothing is the anchor in another year
    expect(within(sheet).queryByRole("button", { name: "Mes siguiente" })).toBeNull();
    // jsdom cannot navigate; the pick's own job here is to close the sheet.
    const swallow = (e: Event) => e.preventDefault();
    document.addEventListener("click", swallow);
    fireEvent.click(within(sheet).getByRole("link", { name: "Septiembre 2025" }));
    document.removeEventListener("click", swallow);
    expect(screen.getByRole("button", { name: /Septiembre 2026/ }).getAttribute("aria-expanded")).toBe("false");
  });
});
