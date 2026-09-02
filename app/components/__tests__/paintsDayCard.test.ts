// The predicate the home page and DayCard now share.
//
// They used to answer "will this card paint?" separately: DayCard returned
// `null` from its own guard, and the page re-derived the same condition by hand
// to decide between the "Esta semana" grid and an empty state. A copy like that
// goes stale in silence — add a sixth seat array to the card, or filter
// `instruments` by `person` the way the render path already does, and the page
// goes back to showing a heading over nothing with every test still green.
//
// The state that made this matter: a published role whose seats were all
// cleared. That is not corrupt data — person-less seats are dropped at write
// time — so a role document can legitimately exist with nothing in it.

import { describe, it, expect } from "vitest";
import { paintsDayCard } from "../DayCard";

describe("paintsDayCard", () => {
  it("is false for a service with no setlist and no assigned seat", () => {
    expect(paintsDayCard({})).toBe(false);
    expect(paintsDayCard({ setlist: null })).toBe(false);
    expect(paintsDayCard({ setlist: { songs: [] }, leads: [], instruments: [], fohTeam: [], bgvs: [], chorus: [] })).toBe(false);
  });

  it("is true on a setlist alone — songs published before the team is named", () => {
    expect(paintsDayCard({ setlist: { songs: [{}] } })).toBe(true);
  });

  it("is true on any one of the five seat kinds alone", () => {
    expect(paintsDayCard({ leads: ["Ana"] })).toBe(true);
    expect(paintsDayCard({ instruments: [{ label: "Bajo", person: "Ana" }] })).toBe(true);
    expect(paintsDayCard({ fohTeam: [{ label: "Audio", person: "Ana" }] })).toBe(true);
    expect(paintsDayCard({ bgvs: [{ member_name: "Ana" }] })).toBe(true);
    expect(paintsDayCard({ chorus: [{ member_name: "Ana" }] })).toBe(true);
  });

  it("treats a cleared role as empty even when the document exists", () => {
    // What a saturday_role looks like after every seat is removed: the arrays
    // are present and empty, not absent.
    expect(paintsDayCard({ setlist: null, leads: [], instruments: [], fohTeam: [], bgvs: [], chorus: [] })).toBe(false);
  });
});
