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

// Every key is REQUIRED on the predicate, so a call site that forgets one is a
// compile error rather than a silently-false answer. That is the whole point of
// sharing it, so the tests spell out all six too.
type Card = Parameters<typeof paintsDayCard>[0];
const EMPTY: Card = {
  setlist: null,
  leads: undefined,
  instruments: undefined,
  fohTeam: undefined,
  bgvs: undefined,
  chorus: undefined,
};
const card = (over: Partial<Card>): Card => ({ ...EMPTY, ...over });

describe("paintsDayCard", () => {
  it("is false for a service with no setlist and no assigned seat", () => {
    expect(paintsDayCard(EMPTY)).toBe(false);
    expect(paintsDayCard(card({ setlist: undefined }))).toBe(false);
  });

  it("is true on a setlist alone — songs published before the team is named", () => {
    expect(paintsDayCard(card({ setlist: { songs: [{}] } }))).toBe(true);
  });

  it("is true on any one of the five seat kinds alone", () => {
    expect(paintsDayCard(card({ leads: ["Ana"] }))).toBe(true);
    expect(paintsDayCard(card({ instruments: [{ label: "Bajo", person: "Ana" }] }))).toBe(true);
    expect(paintsDayCard(card({ fohTeam: [{ label: "Audio", person: "Ana" }] }))).toBe(true);
    expect(paintsDayCard(card({ bgvs: [{ member_name: "Ana" }] }))).toBe(true);
    expect(paintsDayCard(card({ chorus: [{ member_name: "Ana" }] }))).toBe(true);
  });

  it("treats a cleared role as empty even when the document exists", () => {
    // What a saturday_role looks like after every seat is removed: the arrays
    // are present and empty, not absent.
    expect(
      paintsDayCard({ setlist: { songs: [] }, leads: [], instruments: [], fohTeam: [], bgvs: [], chorus: [] }),
    ).toBe(false);
  });
});
