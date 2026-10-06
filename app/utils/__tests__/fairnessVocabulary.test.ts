// Solver v3 C2 IF2-1 — the vocabulary every C2 surface shares. The canonical role
// order is a contract (the record, the hash, the expansion and the wire carry it),
// and month arithmetic is integers only — never a `Date` (LG-12, LG-16).
import { describe, expect, it } from "vitest";

import {
  FAIRNESS_PUT_REFUSALS,
  FAIRNESS_WRITE_REFUSALS,
  NOTE_CODES,
  ROLE_KEYS,
  ROLE_LINE,
  SET_ASIDE_REASONS,
  canonicalRoles,
  compareCodepoint,
  isMonthString,
  isRoleKey,
  isStatus,
  monthFromIndex,
  monthIndex,
  roleClassOf,
  shiftMonth,
  tabOfLine,
} from "../fairnessVocabulary";

describe("fairness vocabulary (C2 IF2-1)", () => {
  it("names the six role keys in the canonical role order", () => {
    expect([...ROLE_KEYS]).toEqual(["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir"]);
  });

  it("maps every role key to its line", () => {
    expect(ROLE_LINE).toEqual({
      "Sun.Lead": "DL",
      "Sat.Lead": "SL",
      "Sun.BGV": "BGV",
      "Sat.BGV": "BGV",
      "Sun.Choir": "CORO",
      "Sat.Choir": "CORO",
    });
  });

  it("folds every presence sub-line into the BGV tab", () => {
    expect(tabOfLine("DL")).toBe("DL");
    expect(tabOfLine("CORO")).toBe("CORO");
    expect(tabOfLine("P:any-rule")).toBe("BGV");
  });

  it("orders and de-duplicates role lists canonically", () => {
    expect(canonicalRoles(["Sat.Choir", "Sun.Lead", "Sat.Choir", "Sun.BGV"])).toEqual(["Sun.Lead", "Sun.BGV", "Sat.Choir"]);
  });

  it("classifies seats Lead, BGV, Choir", () => {
    expect(ROLE_KEYS.map(roleClassOf)).toEqual(["Lead", "Lead", "BGV", "BGV", "Choir", "Choir"]);
  });

  it("guards role keys and statuses", () => {
    expect(isRoleKey("Sat.Choir")).toBe(true);
    expect(isRoleKey("Sat.choir")).toBe(false);
    expect(isRoleKey(undefined)).toBe(false);
    expect(isStatus("exact")).toBe(true);
    expect(isStatus("maybe")).toBe(false);
  });

  it("does month arithmetic on integers, across year boundaries", () => {
    expect(isMonthString("2026-11")).toBe(true);
    expect(isMonthString("2026-13")).toBe(false);
    expect(monthFromIndex(monthIndex("2026-01") - 1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("2027-01", -3)).toBe("2026-10");
  });

  it("compares by codepoint, never by locale", () => {
    expect(["b", "B", "a", "Á"].sort(compareCodepoint)).toEqual(["B", "a", "b", "Á"]);
  });

  it("keeps the closed lists of codes the copy tables are keyed on", () => {
    expect(FAIRNESS_PUT_REFUSALS).toHaveLength(9);
    expect(FAIRNESS_WRITE_REFUSALS).toEqual([
      ...FAIRNESS_PUT_REFUSALS,
      "not_past_month",
      "not_reconstruction_owned",
      "record_edited",
      "invalid_body",
    ]);
    expect(NOTE_CODES).toHaveLength(14);
    expect(SET_ASIDE_REASONS).toEqual(["second_seat", "exact", "cadence", "not_in_record", "outside_population", "floor"]);
  });
});
