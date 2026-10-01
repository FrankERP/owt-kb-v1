import { describe, expect, it } from "vitest";
import { trailingSaturday, weekForColumn } from "../plannerModel";
import {
  allWeekendTargetsAddressable,
  completeSundaySpine,
  ruleContextForTarget,
} from "../serviceRuleContext";

describe("serviceRuleContext", () => {
  it("builds the complete Sunday spine for an explicit calendar month", () => {
    expect(completeSundaySpine("2026-03")).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
      "2026-03-22",
      "2026-03-29",
    ]);
    expect(completeSundaySpine("invalid")).toEqual([]);
  });

  // D16 amended by ADR-0048 (T1): the trailing Saturday is week weeks + 1.
  // Feb 28 2026 used to resolve through the Sunday after it, 1 March, to
  // March's week 1 — a rule derived from the NEXT month's spine, which the
  // solver, the request and every other helper no longer agree with. It is
  // February's trailing Saturday (last Sunday 22 + 6), so it is February's
  // week 5, over February's spine, and no Sunday owns it.
  it("maps a boundary Saturday — the trailing Saturday — to its OWN month's week weeks + 1", () => {
    expect(ruleContextForTarget("saturday_role", "2026-02-28")).toEqual({
      owningSunday: null,
      month: "2026-02",
      sundayDates: ["2026-02-01", "2026-02-08", "2026-02-15", "2026-02-22"],
      week: 5,
      addressable: true,
    });
    expect(ruleContextForTarget("saturday_role", "2026-10-31")).toMatchObject({
      owningSunday: null,
      month: "2026-10",
      sundayDates: ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"],
      week: 5,
      addressable: true,
    });
    expect(allWeekendTargetsAddressable([{ type: "saturday_role", date: "2026-10-31" }])).toBe(true);
  });

  it("maps every other Saturday through the Sunday after it, exactly as before", () => {
    // The eve of an in-month Sunday, including a month whose first Saturday is
    // the 1st (Sat 1 Aug 2026 → Sun 2 Aug, week 1).
    expect(ruleContextForTarget("saturday_role", "2026-10-03")).toEqual({
      owningSunday: "2026-10-04",
      month: "2026-10",
      sundayDates: ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"],
      week: 1,
      addressable: true,
    });
    expect(ruleContextForTarget("saturday_role", "2026-10-24")).toMatchObject({
      owningSunday: "2026-10-25", month: "2026-10", week: 4, addressable: true,
    });
    expect(ruleContextForTarget("saturday_role", "2026-08-01")).toMatchObject({
      owningSunday: "2026-08-02", month: "2026-08", week: 1, addressable: true,
    });
    // November 2026 has no trailing Saturday (29 + 6 is 5 Dec); its last
    // Saturday is the eve of its fifth Sunday.
    expect(ruleContextForTarget("saturday_role", "2026-11-28")).toMatchObject({
      owningSunday: "2026-11-29", month: "2026-11", week: 5, addressable: true,
    });
  });

  it("agrees with weekForColumn over its own spine on every Saturday of two years", () => {
    // The grid hands `ctx.sundayDates` to `weekForColumn` (`sundayDatesForColumn`
    // in MonthGenerator → PlannerGrid → ruleEnforcement), so the week the context
    // names and the week the rules are judged in must be the same number.
    const eve = (sun: string) => {
      const d = new Date(`${sun}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let trailing = 0;
    for (let y = 2026; y <= 2027; y++) {
      for (let mo = 1; mo <= 12; mo++) {
        const month = `${y}-${String(mo).padStart(2, "0")}`;
        const spine = completeSundaySpine(month);
        const saturdays = spine.map(eve).filter((sat) => sat.startsWith(month));
        const last = trailingSaturday(spine);
        if (last) {
          saturdays.push(last);
          trailing += 1;
        }
        for (const date of saturdays) {
          const ctx = ruleContextForTarget("saturday_role", date);
          expect(ctx?.month, date).toBe(month);
          expect(ctx?.addressable, date).toBe(true);
          expect(weekForColumn({ type: "saturday_role", date }, ctx!.sundayDates), date).toBe(ctx!.week);
        }
      }
    }
    expect(trailing).toBeGreaterThan(0); // the sweep reached the case it exists for
  });

  it("maps Sunday directly and gives specials no week context", () => {
    expect(ruleContextForTarget("sunday_role", "2026-03-29")).toMatchObject({
      month: "2026-03",
      week: 5,
      addressable: true,
    });
    expect(ruleContextForTarget("special_role", "2026-03-29")).toBeNull();
  });

  it("fails closed when a weekend type/date is not addressable", () => {
    const invalidSaturday = ruleContextForTarget("saturday_role", "2026-03-03");
    expect(invalidSaturday).toMatchObject({ week: null, addressable: false });
    expect(allWeekendTargetsAddressable([
      { type: "sunday_role", date: "2026-03-08" },
      { type: "saturday_role", date: "2026-03-03" },
    ])).toBe(false);
  });
});
