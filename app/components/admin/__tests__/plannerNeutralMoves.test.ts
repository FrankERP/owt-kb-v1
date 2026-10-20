// MCP P4 step 2 — the helpers moved out of "use client" files into neutral modules. The
// moved code is pinned by its old suites (MonthCalendar, MonthGenerator, ServicesPanel); this
// pins that the client files hand out the SAME functions (no second copy) and what each moved
// function answers, so a server caller can rely on it.
import { describe, expect, it } from "vitest";

import * as calendarClient from "../MonthCalendar";
import { dayOfWeek, longDate, monthDays, refuseSpecialOn, refuseWeekendOn, weekendNoun } from "../plannerCalendar";
import { MAX_YEAR, MIN_YEAR, SAVED_WINDOW_DAYS, buildUnavailabilityNotices, getDates, savedWindowFor } from "../plannerMonth";
import { integrityQueueFor } from "../monthPreflight";
import { buildIntegrityQueue } from "../serviceIntegrityQueue";
import { serviceCardRefs, type ServiceRole } from "../serviceCardModel";
import type { SavedRole } from "../plannerModel";

describe("plannerCalendar", () => {
  it("is what MonthCalendar re-exports, not a copy", () => {
    expect(calendarClient.monthDays).toBe(monthDays);
    expect(calendarClient.dayOfWeek).toBe(dayOfWeek);
    expect(calendarClient.longDate).toBe(longDate);
    expect(calendarClient.refuseSpecialOn).toBe(refuseSpecialOn);
    expect(calendarClient.refuseWeekendOn).toBe(refuseWeekendOn);
  });

  it("answers the month's days and weekdays at local noon", () => {
    expect(monthDays(2026, 2)).toHaveLength(28);
    expect(dayOfWeek("2026-11-01")).toBe(0);
    expect(weekendNoun("2026-11-07")).toBe("sábado");
    expect(longDate("2026-11-01")).toBe("1 de noviembre");
  });

  it("refuses a special on a stored special's date, name-blind, and a weekend holding a special", () => {
    const stored = refuseSpecialOn({
      date: "2026-11-20", weekendSelected: false, specials: [],
      existingRoles: [{ _type: "special_role", date: "2026-11-20", service_name: "Noche" }],
    });
    expect(stored).toContain("ya tiene un servicio especial guardado: «Noche»");
    expect(refuseWeekendOn({ date: "2026-11-07", specials: [{ date: "2026-11-07", name: "Boda" }] }))
      .toContain("Quítalo antes de activar ese sábado");
    expect(refuseSpecialOn({ date: "2026-11-18", weekendSelected: false, specials: [], existingRoles: [] })).toBeNull();
  });
});

describe("plannerMonth", () => {
  it("keeps the planner's bounds and window", () => {
    expect([MIN_YEAR, MAX_YEAR, SAVED_WINDOW_DAYS]).toEqual([2024, 2035, 56]);
  });

  it("lists a month's Sundays or Saturdays", () => {
    expect(getDates(2026, 11, 0)).toEqual(["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
    expect(getDates(2026, 10, 6)).toEqual(["2026-10-03", "2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31"]);
  });

  it("reports one notice per generated column, sorted by date then name", () => {
    const members = [
      { member_name: "Zoe Uno", unavailableDates: ["2026-11-08", "2026-11-20"] },
      { member_name: "Ana Dos", alias: "Ana", unavailableDates: ["2026-11-08", "2026-11-15"] },
    ];
    expect(buildUnavailabilityNotices(["2026-11-08"], ["2026-11-14"], [{ date: "2026-11-20", name: "Noche" }], members)).toEqual([
      { name: "Ana", date: "2026-11-08", service: "Dom" },
      { name: "Zoe Uno", date: "2026-11-08", service: "Dom" },
      { name: "Zoe Uno", date: "2026-11-20", service: "Noche" },
    ]);
  });

  it("windows saved roles to 56 days ending at the month's first Sunday", () => {
    const at = (date: string) => ({ _type: "sunday_role", date }) as SavedRole;
    const roles = [at("2026-09-05"), at("2026-09-06"), at("2026-11-01"), at("2026-11-08")];
    expect(savedWindowFor(2026, 11, roles).map((r) => r.date)).toEqual(["2026-09-06", "2026-11-01"]);
  });
});

describe("monthPreflight", () => {
  it("is exactly the panel's buildIntegrityQueue call over every card", () => {
    const sources = { roles: "ready", members: "ready", proposals: "ready", roleTargets: "ready", setlistTargets: "ready" } as const;
    const summaries = {
      roles: { targets: [], recordIssues: [], lockIssues: [] },
      setlists: { targets: [], recordIssues: [] },
      proposals: { records: [], serviceRefConflicts: [], targetKeyConflicts: [], recordIssues: [], draftIds: [] },
    };
    const roles = [{ _id: "role-a", _type: "sunday_role", date: "2026-11-01" }] as unknown as ServiceRole[];
    expect(integrityQueueFor({ sources, roles, summaries })).toEqual(
      buildIntegrityQueue({
        sources,
        cards: serviceCardRefs(roles, summaries),
        roles: summaries.roles,
        setlists: summaries.setlists,
        proposals: summaries.proposals,
      }),
    );
    const notReady = { ...sources, roleTargets: "error" } as const;
    expect(integrityQueueFor({ sources: notReady, roles, summaries })).toEqual(
      buildIntegrityQueue({ sources: notReady, cards: serviceCardRefs(roles, summaries), roles: summaries.roles, setlists: summaries.setlists, proposals: summaries.proposals }),
    );
  });
});
