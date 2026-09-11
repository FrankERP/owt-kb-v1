/** @vitest-environment jsdom */
// R2 Task 3 — the schedule's month header and day strip.
//
// What these assert is the WIRING: the strip's one cell per calendar day, which of
// them are reachable (a day with no service is `disabled`, so the whole month is
// legible without being clickable), which one is today, and that a pick reports the
// ISO date the sheet will be opened with. `monthStripDays` itself is tested in
// `app/utils/__tests__/agenda.test.ts` — this file never re-derives a tone.
//
// jsdom has no layout, so two things are stubbed rather than exercised:
// `scrollIntoView` (absent in jsdom entirely) and motion's drag gesture, which
// cannot be driven without pointer capture — see `SwipeStrip.test.tsx`, whose pure
// `swipeDirection` helper carries the threshold arithmetic.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { ActiveDay } from "../CalendarView";

installMotionTestEnv();

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import DayStrip from "../DayStrip";
import ScheduleHeader from "../ScheduleHeader";

beforeAll(() => {
  // Not implemented in jsdom at all — the mount-time scroll would throw.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  push.mockReset();
});

const sunday = (date: string): ActiveDay => ({ day: "Domingo", date, leads: ["Ana"] });
const saturday = (date: string): ActiveDay => ({ day: "Sábado", date, leads: ["Beto"] });
const special = (date: string): ActiveDay => ({ day: "Aniversario", date, roleId: "r1" });

// September 2026: the 5th is a Saturday, the 6th a Sunday, the 20th special.
const ACTIVE: Record<string, ActiveDay[]> = {
  "2026-09-05": [saturday("2026-09-05")],
  "2026-09-06": [sunday("2026-09-06")],
  "2026-09-20": [sunday("2026-09-20"), special("2026-09-20")],
};

function mountStrip(onPick = vi.fn(), todayStr = "2026-09-10") {
  render(
    <MotionProvider>
      <DayStrip anchorMonth="2026-09" activeDays={ACTIVE} todayStr={todayStr} onPick={onPick} />
    </MotionProvider>,
  );
  return onPick;
}

describe("DayStrip", () => {
  it("renders one cell per calendar day of the anchor month", () => {
    mountStrip();
    expect(screen.getAllByRole("button")).toHaveLength(30);
  });

  it("enables only the days that carry a service", () => {
    mountStrip();
    const enabled = screen
      .getAllByRole("button")
      .filter((b) => !(b as HTMLButtonElement).disabled)
      .map((b) => b.textContent);
    expect(enabled).toHaveLength(3);
    expect(enabled.join(" ")).toContain("5");
    expect(enabled.join(" ")).toContain("6");
    expect(enabled.join(" ")).toContain("20");
  });

  it("marks today with aria-current, service or not", () => {
    mountStrip(vi.fn(), "2026-09-10");
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "date");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("10");
    expect((current[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports the ISO date of a picked service day", () => {
    const onPick = mountStrip();
    const day6 = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.includes("6 de septiembre"))!;
    fireEvent.click(day6);
    expect(onPick).toHaveBeenCalledWith("2026-09-06");
  });

  it("never reports a day with no service", () => {
    const onPick = mountStrip();
    const day7 = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.includes("7 de septiembre"))!;
    fireEvent.click(day7);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names the services of a day in its label", () => {
    mountStrip();
    const day20 = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.includes("20 de septiembre"))!;
    expect(day20.getAttribute("aria-label")).toContain("Domingo, Aniversario");
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

  it("steps the route one month per stepper press", () => {
    render(<ScheduleHeader anchorMonth="2026-09" viewMonth={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(push).toHaveBeenCalledWith("/schedule?m=2026-10");
  });
});
