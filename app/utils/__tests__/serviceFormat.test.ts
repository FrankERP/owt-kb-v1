import { describe, expect, it } from "vitest";
import { WORSHIP_NIGHT_FORMAT, isWorshipNight, isWorshipNightFormat } from "@/app/utils/serviceFormat";

describe("serviceFormat", () => {
  it("accepts only the worship-night value", () => {
    expect(WORSHIP_NIGHT_FORMAT).toBe("worship_night");
    expect(isWorshipNightFormat("worship_night")).toBe(true);
    for (const v of ["Worship_night", "worship night", "", null, undefined, 1]) expect(isWorshipNightFormat(v)).toBe(false);
  });
  it("reads a role's format", () => {
    expect(isWorshipNight({ _type: "special_role", format: "worship_night" })).toBe(true);
    expect(isWorshipNight({ _type: "special_role" })).toBe(false);
    expect(isWorshipNight(null)).toBe(false);
  });
});
