// The card items both Jóvenes pages share (2026-11-17): what crosses to the browser, what is the
// reader's, and who gets «Editar programa» — never on a meeting already held.
import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { MINISTRIES } from "@/app/ministries";

vi.mock("../ProgramEditor", () => ({ default: () => null }));

import { anyProgramEditor, jovenesMeetingItems } from "../meetingItems";

const [G1] = MINISTRIES.jovenes.groups;
const TODAY = "2026-11-17";

function ev(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: "ministryEvent.a",
    rev: "r1",
    ministry: "jovenes",
    audience: { kind: "ministry" },
    kind: "saturday",
    date: "2026-11-21",
    time: "18:10",
    arrival: "17:30",
    title: null,
    notes: null,
    place: "Oasis Tlalpan",
    lesson: null,
    published: true,
    seats: [
      { _key: "s1", role: "encargado", memberId: "m1", name: "Ana", photo: null, mine: false },
      { _key: "s2", role: "comparte", memberId: "m2", name: "Beto", photo: null, mine: true },
    ],
    program: [{ _key: "l1", label: "Dinámica", note: "10 min", memberId: "m2", name: "Beto", photo: null, mine: true }],
    createdById: null,
    createdByName: null,
    ...over,
  };
}

const opts = (isManager: boolean) => ({ isManager, people: [], today: TODAY });
const encargado = (e: MinistryEventView): MinistryEventView => ({ ...e, seats: e.seats.map((s) => ({ ...s, mine: s.role === "encargado" })) });

describe("jovenesMeetingItems", () => {
  it("sends the card only what it draws: no member id, no revision, no creator", () => {
    const [it] = jovenesMeetingItems([ev()], opts(false));
    expect(Object.keys(it.event).sort()).toEqual(["_id", "arrival", "audience", "date", "kind", "place", "time", "title"]);
    expect(JSON.stringify({ event: it.event, entry: it.entry })).not.toMatch(/m1|m2|r1/);
  });

  it("names what is the reader's, seats and program lines, and nothing when none is", () => {
    expect(jovenesMeetingItems([ev()], opts(false))[0].mine).toEqual(["Comparte", "Dinámica"]);
    const nobody = ev({ seats: ev().seats.map((s) => ({ ...s, mine: false })), program: [] });
    expect(jovenesMeetingItems([nobody], opts(false))[0].mine).toEqual([]);
  });

  it("keeps the order the meetings came in", () => {
    const items = jovenesMeetingItems([ev({ _id: "ministryEvent.b", date: "2026-11-28" }), ev()], opts(false));
    expect(items.map((i) => i.event._id)).toEqual(["ministryEvent.b", "ministryEvent.a"]);
  });

  it("«Editar programa» goes to an admin and to a whole-ministry meeting's encargado, not to a reader with another seat", () => {
    expect(isValidElement(jovenesMeetingItems([ev()], opts(true))[0].editor)).toBe(true);
    expect(isValidElement(jovenesMeetingItems([encargado(ev())], opts(false))[0].editor)).toBe(true);
    expect(jovenesMeetingItems([ev()], opts(false))[0].editor).toBeNull();
    const groupMeeting = encargado(ev({ audience: { kind: "groups", groups: [G1.id] } }));
    expect(jovenesMeetingItems([groupMeeting], opts(false))[0].editor).toBeNull();
  });

  it("a meeting already held is a record: no editor for anyone, and today's still has it", () => {
    expect(jovenesMeetingItems([ev({ date: "2026-11-14" })], opts(true))[0].editor).toBeNull();
    expect(isValidElement(jovenesMeetingItems([ev({ date: TODAY })], opts(true))[0].editor)).toBe(true);
  });
});

describe("anyProgramEditor", () => {
  it("answers whether the page must read the people to pick from", () => {
    expect(anyProgramEditor([ev()], true, TODAY)).toBe(true);
    expect(anyProgramEditor([ev()], false, TODAY)).toBe(false);
    expect(anyProgramEditor([encargado(ev())], false, TODAY)).toBe(true);
    // Only past meetings: nothing to edit, so no roster read.
    expect(anyProgramEditor([ev({ date: "2026-11-14" })], true, TODAY)).toBe(false);
    expect(anyProgramEditor([], true, TODAY)).toBe(false);
  });
});
