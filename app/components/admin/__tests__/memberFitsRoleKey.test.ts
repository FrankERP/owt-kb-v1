// Solver v3 C2 WR-5 / RES-1 — `memberFitsRoleKey`, the one "does the current Tipo fit
// this v3 role key" predicate the record writer and the eligibility resolver share.
import { describe, expect, it } from "vitest";

import { ROLE_KEYS } from "@/app/utils/fairnessVocabulary";
import { memberFitsRoleKey } from "../plannerModel";

const fits = (memberType: string[] | undefined) => ROLE_KEYS.filter((k) => memberFitsRoleKey({ memberType }, k));

describe("memberFitsRoleKey (C2 WR-5)", () => {
  it("a Sunday lead fits every role key", () => {
    expect(fits(["voz", "sunday_lead"])).toEqual([...ROLE_KEYS]);
  });

  it("a Saturday lead fits Sat.Lead and every BGV and Choir key, never Sun.Lead", () => {
    expect(fits(["voz", "saturday_lead"])).toEqual(["Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("support fits BGV and Choir only", () => {
    expect(fits(["voz", "support"])).toEqual(["Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("nothing fits without voz, or with no Tipo at all (ADR-0029)", () => {
    expect(fits(["sunday_lead", "support"])).toEqual([]);
    expect(fits(["voz"])).toEqual([]);
    expect(fits([])).toEqual([]);
    expect(fits(undefined)).toEqual([]);
    expect(ROLE_KEYS.some((k) => memberFitsRoleKey(undefined, k))).toBe(false);
  });
});
