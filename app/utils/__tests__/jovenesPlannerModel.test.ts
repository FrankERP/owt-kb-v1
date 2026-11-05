import { describe, expect, it } from "vitest";
import type { MinistryEventView } from "../ministryEventReads";
import {
  monthRange,
  parseMonth,
  programBody,
  programForm,
  saturdayBody,
  saturdayForm,
  saturdayRows,
  saturdaysOfMonth,
  shiftMonth,
  showsProgramEditor,
  whatsappRoster,
} from "../jovenesPlannerModel";

function ev(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: "ministryEvent.x",
    rev: "r1",
    ministry: "jovenes",
    audience: { kind: "ministry" },
    kind: "saturday",
    date: "2026-11-07",
    time: "18:10",
    arrival: "17:30",
    title: null,
    notes: null,
    published: true,
    seats: [],
    program: [],
    createdById: null,
    createdByName: null,
    ...over,
  };
}

const seat = (role: string, memberId: string | null, name: string | null, mine = false, _key = `k-${role}`) =>
  ({ _key, role, memberId, name, mine });

describe("months", () => {
  it("parses ?mes and falls back on anything else", () => {
    expect(parseMonth("2026-12", "2026-11")).toBe("2026-12");
    for (const bad of [undefined, "2026-13", "2026-1", "x", ["2026-12"]]) expect(parseMonth(bad, "2026-11")).toBe("2026-11");
  });

  it("shifts across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it("bounds a month by its real last day", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("lists the Saturdays", () => {
    expect(saturdaysOfMonth("2026-11")).toEqual(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"]);
    expect(saturdaysOfMonth("2026-08")).toEqual(["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22", "2026-08-29"]);
  });
});

describe("saturdayRows", () => {
  it("keeps every Saturday, adds another date's whole-ministry meeting, drops group events and other months", () => {
    const rows = saturdayRows("2026-11", [
      ev({ _id: "a", date: "2026-11-14" }),
      ev({ _id: "b", date: "2026-11-20", kind: "ministry" }),
      ev({ _id: "c", date: "2026-11-21", audience: { kind: "groups", groups: ["otro-nivel"] }, kind: "group" }),
      ev({ _id: "d", date: "2026-12-05" }),
    ]);
    expect(rows.map((r) => [r.date, r.events.map((e) => e._id)])).toEqual([
      ["2026-11-07", []],
      ["2026-11-14", ["a"]],
      ["2026-11-20", ["b"]],
      ["2026-11-21", []],
      ["2026-11-28", []],
    ]);
  });
});

describe("the Saturday editor's body", () => {
  it("a new Saturday starts with the usual times, unpublished, every seat empty", () => {
    const f = saturdayForm("2026-11-07");
    expect([f.time, f.arrival, f.published]).toEqual(["18:10", "17:30", false]);
    expect(saturdayBody(f)).toEqual({
      audience: { kind: "ministry" },
      kind: "saturday",
      date: "2026-11-07",
      time: "18:10",
      arrival: "17:30",
      title: null,
      notes: null,
      published: false,
      seats: [],
    });
  });

  it("keeps stored keys, sends a picked seat without one, drops a cleared column, keeps extra seats", () => {
    const f = saturdayForm("2026-11-07", ev({
      seats: [seat("encargado", "m1", "Ana"), seat("apoyo", "m2", "Beto"), seat("apoyo", "m3", "Caro", false, "k-apoyo-2")],
    }));
    f.picks.apoyo = { key: f.picks.apoyo.key, member: null };
    f.picks.comparte = { key: null, member: "m4" };
    expect(saturdayBody(f).seats).toEqual([
      { _key: "k-encargado", role: "encargado", member: "m1" },
      { role: "comparte", member: "m4" },
      { _key: "k-apoyo-2", role: "apoyo", member: "m3" },
    ]);
  });

  // Review finding (PR C): every save sent `saturday`, so editing the notes of a quarterly pastors'
  // board (`kind: "ministry"`) silently turned it into a Saturday.
  it("an existing meeting keeps its stored kind; a new one is a Saturday", () => {
    expect(saturdayBody(saturdayForm("2026-11-20", ev({ kind: "ministry" }))).kind).toBe("ministry");
    expect(saturdayBody(saturdayForm("2026-11-07", ev({ kind: "saturday" }))).kind).toBe("saturday");
    expect(saturdayBody(saturdayForm("2026-11-07")).kind).toBe("saturday");
  });

  it("a cleared time or note is sent as null (the server unsets it)", () => {
    const f = saturdayForm("2026-11-07", ev({ notes: "Traer Biblia" }));
    f.time = "";
    f.notes = "  ";
    const b = saturdayBody(f);
    expect([b.time, b.notes]).toEqual([null, null]);
  });
});

describe("the program body", () => {
  it("round-trips stored lines and leaves blank ones out", () => {
    const form = programForm([
      { _key: "l1", label: "Oración", memberId: "m1", name: "Ana", mine: false, note: null },
    ]);
    form.push({ key: null, label: " Dinámica ", member: null, note: " 10 min " });
    form.push({ key: null, label: "   ", member: "m2", note: "" });
    expect(programBody(form)).toEqual([
      { _key: "l1", label: "Oración", member: "m1" },
      { label: "Dinámica", note: "10 min" },
    ]);
  });
});

describe("showsProgramEditor (cosmetic; the server decides)", () => {
  it("an admin on anything; the encargado or apoyo of a whole-ministry meeting; nobody else", () => {
    const groupEvent = ev({ audience: { kind: "groups", groups: ["otro-nivel"] }, seats: [seat("encargado", "me", "Yo", true)] });
    expect(showsProgramEditor(groupEvent, true)).toBe(true);
    expect(showsProgramEditor(groupEvent, false)).toBe(false);
    expect(showsProgramEditor(ev({ seats: [seat("encargado", "me", "Yo", true)] }), false)).toBe(true);
    expect(showsProgramEditor(ev({ seats: [seat("apoyo", "me", "Yo", true)] }), false)).toBe(true);
    expect(showsProgramEditor(ev({ seats: [seat("comparte", "me", "Yo", true)] }), false)).toBe(false);
    expect(showsProgramEditor(ev({ seats: [seat("encargado", "x", "Otro")] }), false)).toBe(false);
  });
});

describe("whatsappRoster", () => {
  it("writes the month's meetings with their seats, and «Sin asignar» for an empty column", () => {
    const rows = saturdayRows("2026-11", [
      ev({ date: "2026-11-07", seats: [seat("encargado", "m1", "Ana"), seat("comparte", "m2", "Beto")], notes: "Traer Biblia" }),
      ev({ _id: "y", date: "2026-11-14", time: null, arrival: null, published: false }),
    ]);
    expect(whatsappRoster("2026-11", rows)).toBe(
      [
        "*Rol de Jóvenes — noviembre de 2026*",
        "",
        "*Sábado, 7 de noviembre* — 18:10 · llegada 17:30",
        "Encargado: Ana",
        "Apoyo: Sin asignar",
        "Comparte: Beto",
        "Notas: Traer Biblia",
        "",
        "*Sábado, 14 de noviembre*",
        "Encargado: Sin asignar",
        "Apoyo: Sin asignar",
        "Comparte: Sin asignar",
      ].join("\n"),
    );
  });

  it("an empty month is the header alone", () => {
    expect(whatsappRoster("2026-11", saturdayRows("2026-11", []))).toBe("*Rol de Jóvenes — noviembre de 2026*");
  });
});
