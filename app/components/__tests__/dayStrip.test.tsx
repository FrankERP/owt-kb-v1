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

/** The day cells, excluding the mocked SwipeStrip's two test triggers. */
const cells = () => screen.getAllByRole("button").filter((b) => !(b as HTMLElement).dataset.testid);
const cell = (label: string) => cells().find((b) => b.getAttribute("aria-label")?.includes(label))!;

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
    expect(cells().map((b) => b.textContent)).toEqual(["Lun7", "Mar8", "Mié9", "Jue10", "Vie11", "Sáb12", "Dom13"]);
    expect(screen.getByText(/^7 – 13 sep/)).toBeTruthy();
  });

  it("enables only the days that carry a service", () => {
    mountStrip();
    const enabled = cells().filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.map((b) => b.textContent)).toEqual(["Sáb12", "Dom13"]);
  });

  it("marks today with aria-current and the inset ring, service or not", () => {
    mountStrip();
    const current = cells().filter((b) => b.getAttribute("aria-current") === "date");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("10");
    expect(current[0].className).toContain("ring-accent/50");
    expect((current[0] as HTMLButtonElement).disabled).toBe(true);
    expect(cells().filter((b) => b.className.includes("ring-accent/50"))).toHaveLength(1);
  });

  it("ADR-0067 — a lit day is a neutral cell with one tone dot per service; an empty day has none", () => {
    mountStrip();
    fireEvent.click(screen.getByTestId("swipe-next"));
    const sat = cell("19 de septiembre");
    expect(sat.className).toContain("bg-surface-card");
    expect(sat.className).not.toMatch(/bg-warning|text-warning|bg-accent-deep|bg-info/);
    const satDots = within(sat).getByTestId("day-dots").children;
    expect(satDots).toHaveLength(1);
    expect(satDots[0].className).toContain("bg-warning-fg");
    // Sunday + a special on the 20th: two dots, in `activeDays` order, no corner mark.
    const both = within(cell("20 de septiembre")).getByTestId("day-dots").children;
    expect(Array.from(both).map((d) => d.className)).toEqual([expect.stringContaining("bg-accent"), expect.stringContaining("bg-info-fg")]);
    expect(within(cell("16 de septiembre")).queryByTestId("day-dots")).toBeNull();
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
    expect(cells().map((b) => b.textContent)).toEqual(["Lun14", "Mar15", "Mié16", "Jue17", "Vie18", "Sáb19", "Dom20"]);
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
    expect(cells().map((b) => b.textContent)).toEqual(["Lun24", "Mar25", "Mié26", "Jue27", "Vie28", "Sáb29", "Dom30"]);
    expect(screen.getByText(/^24 – 30 ago/)).toBeTruthy();
    expect(cells().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("opens on the week of the first day when the anchor month has no today", () => {
    mountStrip({ anchorMonth: "2026-10" });
    // 1 Oct 2026 is a Thursday, so its week starts Monday 28 September.
    expect(cells().map((b) => b.textContent)).toEqual(["Lun28", "Mar29", "Mié30", "Jue1", "Vie2", "Sáb3", "Dom4"]);
  });

  it("F1 — paints the number positive («tú») on the day the signed-in member is seated in, and only that one", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    expect(cell("13 de septiembre").querySelector(".text-positive-fg")!.textContent).toBe("13");
    expect(cell("12 de septiembre").querySelector(".text-positive-fg")).toBeNull();
  });

  it("marks no day as mine when `myName` is omitted", () => {
    mountStrip();
    expect(document.querySelector(".text-positive-fg")).toBeNull();
  });

  it("F1 — adds «te toca» to a mine cell's label, and only that cell", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    expect(cell("13 de septiembre").getAttribute("aria-label")).toMatch(/, te toca$/);
    expect(cell("12 de septiembre").getAttribute("aria-label")).not.toMatch(/te toca/);
  });

  it("F1 — a day that is today AND mine keeps both marks: the ring on the cell, the positive number, the tone dot", () => {
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });
    const todayMine = cell("10 de septiembre");
    expect(todayMine.className).toContain("ring-accent/50");
    expect(todayMine.querySelector(".text-positive-fg")!.textContent).toBe("10");
    expect(within(todayMine).getByTestId("day-dots").children[0].className).toContain("bg-accent");
    expect((todayMine as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps every cell to its three flow children — weekday, number, dots — with nothing absolutely positioned", () => {
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });
    for (const b of cells()) {
      expect(b.children.length).toBeLessThanOrEqual(3);
      expect(b.querySelector(".absolute")).toBeNull();
    }
  });
});

/** The header opens a `CueDialog`, so it needs the provider its real host has. */
function mountHeader(props: ComponentProps<typeof ScheduleHeader>) {
  return render(
    <MotionProvider>
      <CueDialogProvider>
        <ScheduleHeader {...props} />
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

  it("offers «Hoy» only in browse mode", () => {
    mountHeader({ anchorMonth: "2026-12", viewMonth: "2026-12" });
    expect(screen.getByRole("link", { name: "Hoy" }).getAttribute("href")).toBe("/schedule");
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

  it("sublabels the rolling view «Próximos», and never a browsed month", () => {
    mountHeader({ anchorMonth: "2026-09", viewMonth: null });
    expect(screen.getByText("Próximos")).toBeTruthy();
    cleanup();
    mountHeader({ anchorMonth: "2026-12", viewMonth: "2026-12" });
    expect(screen.queryByText("Próximos")).toBeNull();
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
