import { describe, expect, it } from "vitest";
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

  it("maps a boundary Saturday to the following Sunday's owning month and week", () => {
    expect(ruleContextForTarget("saturday_role", "2026-02-28")).toMatchObject({
      owningSunday: "2026-03-01",
      month: "2026-03",
      week: 1,
      addressable: true,
    });
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
