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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
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
    expect(cells().map((b) => b.textContent)).toEqual(["L7", "M8", "X9", "J10", "V11", "S12", "D13"]);
    expect(screen.getByText(/^7 – 13 sep/)).toBeTruthy();
  });

  it("enables only the days that carry a service", () => {
    mountStrip();
    const enabled = cells().filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.map((b) => b.textContent)).toEqual(["S12", "D13"]);
  });

  it("marks today with aria-current, service or not", () => {
    mountStrip();
    const current = cells().filter((b) => b.getAttribute("aria-current") === "date");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("10");
    expect((current[0] as HTMLButtonElement).disabled).toBe(true);
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
    expect(cells().map((b) => b.textContent)).toEqual(["L14", "M15", "X16", "J17", "V18", "S19", "D20"]);
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
    expect(cells().map((b) => b.textContent)).toEqual(["L24", "M25", "X26", "J27", "V28", "S29", "D30"]);
    expect(screen.getByText(/^24 – 30 ago/)).toBeTruthy();
    expect(cells().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("opens on the week of the first day when the anchor month has no today", () => {
    mountStrip({ anchorMonth: "2026-10" });
    // 1 Oct 2026 is a Thursday, so its week starts Monday 28 September.
    expect(cells().map((b) => b.textContent)).toEqual(["L28", "M29", "X30", "J1", "V2", "S3", "D4"]);
  });

  it("F1 — dots the day the signed-in member is seated in, and only that one", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    expect(cell("13 de septiembre").querySelector(".bg-positive-fg")).not.toBeNull();
    expect(cell("12 de septiembre").querySelector(".bg-positive-fg")).toBeNull();
  });

  it("dots no day when `myName` is omitted", () => {
    mountStrip();
    expect(document.querySelector(".bg-positive-fg")).toBeNull();
  });

  it("F1 — adds «te toca» to a mine cell's label, and only that cell", () => {
    mountStrip({ myName: "ana" }); // matches leads: ["Ana"] on 2026-09-13
    expect(cell("13 de septiembre").getAttribute("aria-label")).toMatch(/, te toca$/);
    expect(cell("12 de septiembre").getAttribute("aria-label")).not.toMatch(/te toca/);
  });

  it("F1 — one dot slot: today-only pulses in the neutral colour, mine-only is a static positive dot, both together share the slot", () => {
    // 10 September is `todayStr` and carries no service by default — add one seated
    // by "ana" so a single cell is both `today` and `mine` at once.
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });

    const todayMine = cell("10 de septiembre");
    const dotsInTodayMine = todayMine.querySelectorAll(".bg-positive-fg, .bg-current");
    expect(dotsInTodayMine).toHaveLength(1);
    expect(dotsInTodayMine[0].classList.contains("bg-positive-fg")).toBe(true);
    expect(dotsInTodayMine[0].classList.contains("brand-today-pulse")).toBe(true);

    const mineOnly = cell("13 de septiembre");
    const dotsInMineOnly = mineOnly.querySelectorAll(".bg-positive-fg, .bg-current");
    expect(dotsInMineOnly).toHaveLength(1);
    expect(dotsInMineOnly[0].classList.contains("bg-positive-fg")).toBe(true);
    expect(dotsInMineOnly[0].classList.contains("brand-today-pulse")).toBe(false);
  });

  it("F1 — today-only (not mine) still shows one pulsing, non-positive dot", () => {
    mountStrip(); // no myName: 10 September is today but nobody's
    const today = cell("10 de septiembre");
    const dots = today.querySelectorAll(".bg-positive-fg, .bg-current");
    expect(dots).toHaveLength(1);
    expect(dots[0].classList.contains("bg-current")).toBe(true);
    expect(dots[0].classList.contains("brand-today-pulse")).toBe(true);
  });

  it("F1 — every cell has at most two flow children (the dow/num spans); dots and the multiple mark are absolutely positioned", () => {
    const withTodayMine: Record<string, ActiveDay[]> = { ...ACTIVE, "2026-09-10": [sunday("2026-09-10")] };
    mountStrip({ myName: "ana", activeDays: withTodayMine });
    for (const b of cells()) {
      const flowChildren = Array.from(b.children).filter((c) => !c.classList.contains("absolute"));
      expect(flowChildren.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("brand.css — .brand-today-pulse", () => {
  // The same shape `litCard.test.ts` pins for `brand-lit-pass`: brand.css is outside
  // tsc and lint, and a keyframe that ends on a non-`none` transform would leave the
  // dot a containing block for every `position: fixed` descendant forever (rule 5).
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../brand.css"), "utf8");

  it("runs once, 600 ms, eased, with no per-effect reduced-motion override", () => {
    const rule = css.match(/\.brand-today-pulse\s*\{([^}]*)\}/);
    expect(rule, ".brand-today-pulse rule not found").not.toBeNull();
    expect(rule![1].match(/animation:\s*([^;]+);/)![1].trim()).toBe("brand-today-pulse 600ms var(--ease-out) 1 both");
    const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(reduced![1]).not.toMatch(/brand-today-pulse/);
  });

  it("ends its 100% frame on transform: none", () => {
    const frames = css.match(/@keyframes brand-today-pulse\s*\{([\s\S]*?)\n\}/);
    expect(frames, "brand-today-pulse keyframes not found").not.toBeNull();
    expect(frames![1].match(/100%\s*\{([^}]*)\}/)![1]).toMatch(/transform:\s*none/);
  });
});

describe("ScheduleHeader", () => {
  it("reads the anchor month in Spanish and links the adjacent months", () => {
    render(<ScheduleHeader anchorMonth="2026-09" viewMonth={null} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Septiembre 2026");
    expect(screen.getByRole("link", { name: "Mes anterior" }).getAttribute("href")).toBe("/schedule?m=2026-08");
    expect(screen.getByRole("link", { name: "Mes siguiente" }).getAttribute("href")).toBe("/schedule?m=2026-10");
  });

  it("crosses the year boundary one month at a time", () => {
    render(<ScheduleHeader anchorMonth="2026-12" viewMonth="2026-12" />);
    expect(screen.getByRole("link", { name: "Mes siguiente" }).getAttribute("href")).toBe("/schedule?m=2027-01");
  });

  it("offers «Hoy» only in browse mode", () => {
    render(<ScheduleHeader anchorMonth="2026-12" viewMonth="2026-12" />);
    expect(screen.getByRole("link", { name: "Hoy" }).getAttribute("href")).toBe("/schedule");
    cleanup();
    render(<ScheduleHeader anchorMonth="2026-09" viewMonth={null} />);
    expect(screen.queryByRole("link", { name: "Hoy" })).toBeNull();
  });

  it("leaves the month field without steppers — the arrows are the one-month step", () => {
    // R2 Task 4 ruling: `DateField`'s `onStep` pair would be a SECOND «Mes
    // anterior»/«Mes siguiente» control with the same accessible names as the
    // arrows above it. The field jumps to any month; it does not step.
    render(<ScheduleHeader anchorMonth="2026-09" viewMonth={null} />);
    expect(screen.queryByRole("button", { name: "Mes siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mes anterior" })).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("sublabels the rolling view «Próximos», and never a browsed month", () => {
    render(<ScheduleHeader anchorMonth="2026-09" viewMonth={null} />);
    expect(screen.getByText("Próximos")).toBeTruthy();
    cleanup();
    render(<ScheduleHeader anchorMonth="2026-12" viewMonth="2026-12" />);
    expect(screen.queryByText("Próximos")).toBeNull();
  });
});
