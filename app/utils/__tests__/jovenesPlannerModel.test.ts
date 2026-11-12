import { describe, expect, it } from "vitest";
import { normalizeMinistryRoles } from "@/app/ministries";
import type { MinistryEventView } from "../ministryEventReads";
import { ledGroupsIn } from "../ministryAccess";
import {
  canCreateGroupEvent,
  canEditGroupEvent,
  editLosesAccess,
  groupEventBody,
  groupEventForm,
  groupEventProblem,
  groupEvents,
  monthRange,
  monthTitle,
  parseMonth,
  plannerLede,
  programBody,
  programForm,
  saturdayBody,
  saturdayForm,
  saturdayProblem,
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
    place: null,
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

describe("the planner's head", () => {
  it("the month as a title: the name and the year apart, capital first, «de» nowhere", () => {
    expect(monthTitle("2026-11")).toEqual({ name: "Noviembre", year: "2026" });
    expect(monthTitle("2027-01")).toEqual({ name: "Enero", year: "2027" });
  });

  it("the lede counts Saturdays, dates with a meeting, drafts of both sections and group meetings", () => {
    const rows = saturdayRows("2026-11", [
      ev({ _id: "a", date: "2026-11-14" }),
      ev({ _id: "b", date: "2026-11-21" }),
      ev({ _id: "c", date: "2026-11-28", published: false }),
    ]);
    const groups = [{ published: true }, { published: false }];
    expect(plannerLede("2026-11", rows, groups)).toEqual([
      { text: "4 sábados", strong: false },
      { text: "3 con reunión", strong: true },
      { text: "2 borradores", strong: false },
      { text: "2 de grupo", strong: false },
    ]);
  });

  it("«con reunión» counts Saturdays only: a board on a Friday is a row, not a fifth Saturday", () => {
    const rows = saturdayRows("2026-11", [
      ev({ _id: "a", date: "2026-11-07" }),
      ev({ _id: "b", date: "2026-11-14" }),
      ev({ _id: "c", date: "2026-11-21" }),
      ev({ _id: "d", date: "2026-11-28" }),
      ev({ _id: "f", date: "2026-11-20", kind: "ministry", title: "Campamento", published: false }),
    ]);
    expect(rows).toHaveLength(5);
    expect(plannerLede("2026-11", rows, []).map((p) => p.text)).toEqual(["4 sábados", "4 con reunión", "1 borrador"]);
  });

  it("an empty month says so and leaves the zero counts out", () => {
    expect(plannerLede("2026-10", saturdayRows("2026-10", []), [])).toEqual([
      { text: "5 sábados", strong: false },
      { text: "ninguno con reunión", strong: true },
    ]);
    expect(plannerLede("2026-11", saturdayRows("2026-11", [ev({ published: false })]), []).map((p) => p.text)).toEqual([
      "4 sábados",
      "1 con reunión",
      "1 borrador",
    ]);
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
      place: null,
      notes: null,
      published: false,
      seats: [],
    });
  });

  it("keeps stored keys, sends a picked seat without one, drops a cleared column, keeps extra seats", () => {
    const f = saturdayForm("2026-11-07", ev({
      seats: [seat("encargado", "m1", "Ana"), seat("apoyo", "m2", "Beto"), seat("apoyo", "m3", "Caro", false, "k-apoyo-2")],
    }));
    f.picks.apoyo = { key: f.picks.apoyo.key, member: null, name: null };
    f.picks.comparte = { key: null, member: "m4", name: null };
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

  // Plan 2026-11-10 P7: the view's `name` is a member's live name OR a typed text; only a seat with
  // no member is typed, so a member seat (extras too) is never saved back as text.
  it("a seat sends its member or its typed name, never both; a blank typed name sends no seat", () => {
    const f = saturdayForm("2026-11-07", ev({
      seats: [
        seat("encargado", null, "Emprendedores"),
        seat("apoyo", "m2", "Beto"),
        seat("apoyo", "m3", "Caro", false, "k-apoyo-2"),
        seat("encargado", null, "Goma", false, "k-encargado-2"),
      ],
    }));
    expect(f.picks.encargado).toEqual({ key: "k-encargado", member: null, name: "Emprendedores" });
    expect(f.picks.apoyo).toEqual({ key: "k-apoyo", member: "m2", name: null });
    f.picks.comparte = { key: null, member: null, name: "  Ana  " };
    expect(saturdayBody(f).seats).toEqual([
      { _key: "k-encargado", role: "encargado", name: "Emprendedores" },
      { _key: "k-apoyo", role: "apoyo", member: "m2" },
      { role: "comparte", name: "Ana" },
      { _key: "k-apoyo-2", role: "apoyo", member: "m3" },
      { _key: "k-encargado-2", role: "encargado", name: "Goma" },
    ]);
    f.picks.comparte = { key: null, member: null, name: "   " };
    f.extra = [];
    expect(saturdayBody(f).seats).toEqual([
      { _key: "k-encargado", role: "encargado", name: "Emprendedores" },
      { _key: "k-apoyo", role: "apoyo", member: "m2" },
    ]);
  });

  it("a meeting on another weekday is saved as `ministry`, never as a Saturday", () => {
    expect(saturdayBody({ ...saturdayForm("2026-11-20"), date: "2026-11-20" }).kind).toBe("ministry");
    expect(saturdayBody(saturdayForm("2026-11-14")).kind).toBe("saturday");
    const moved = saturdayForm("2026-11-07", ev({ kind: "saturday" }));
    expect(saturdayBody({ ...moved, date: "2026-11-20" }).kind).toBe("ministry");
    expect(saturdayBody({ ...saturdayForm("2026-11-07", ev({ kind: "ministry" })), date: "2026-11-14" }).kind).toBe("ministry");
  });

  it("carries the place both ways, and a cleared one as null", () => {
    const f = saturdayForm("2026-11-07", ev({ place: "Oasis Tlalpan" }));
    expect(f.place).toBe("Oasis Tlalpan");
    expect(saturdayBody({ ...f, place: " Casa Fam Varela " }).place).toBe("Casa Fam Varela");
    expect(saturdayBody({ ...f, place: " " }).place).toBeNull();
  });

  it("a cleared time or note is sent as null (the server unsets it)", () => {
    const f = saturdayForm("2026-11-07", ev({ notes: "Traer Biblia" }));
    f.time = "";
    f.notes = "  ";
    const b = saturdayBody(f);
    expect([b.time, b.notes]).toEqual([null, null]);
  });
});

describe("the clocks the editors accept", () => {
  // The sheets use the native time field, which hands back "" or HH:mm; these are the belt for
  // a value that got in another way. (They were component tests while the fields were free text.)
  it("the Saturday form: an empty or HH:mm clock passes, anything else names the field", () => {
    const date = "2026-11-14";
    expect(saturdayProblem({ date, time: "18:10", arrival: "17:30" })).toBeNull();
    expect(saturdayProblem({ date, time: "", arrival: " " })).toBeNull();
    expect(saturdayProblem({ date, time: "6pm", arrival: "17:30" })).toBe("La hora debe ser HH:mm (por ejemplo 18:10).");
    expect(saturdayProblem({ date, time: "18:10", arrival: "5:30" })).toBe("La llegada debe ser HH:mm (por ejemplo 18:10).");
  });

  it("the meeting form needs a real date first", () => {
    for (const date of ["", "2026-02-30", "14/11/2026"]) {
      expect(saturdayProblem({ date, time: "6pm", arrival: "" })).toBe("Elige la fecha.");
    }
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

  it("a Friday meeting with a title, a place and typed names", () => {
    const rows = saturdayRows("2026-11", [
      ev({
        date: "2026-11-20", kind: "ministry", time: "20:00", arrival: null, title: "Estudio «Daniel»", place: "Oasis Tlalpan",
        seats: [seat("encargado", null, "Emprendedores"), seat("comparte", null, "Ana")],
      }),
    ]);
    expect(whatsappRoster("2026-11", rows).split("\n").slice(2)).toEqual([
      "*Viernes, 20 de noviembre* — 20:00",
      "Estudio «Daniel»",
      "Lugar: Oasis Tlalpan",
      "Encargado: Emprendedores",
      "Apoyo: Sin asignar",
      "Comparte: Ana",
    ]);
  });

  it("an empty month is the header alone", () => {
    expect(whatsappRoster("2026-11", saturdayRows("2026-11", []))).toBe("*Rol de Jóvenes — noviembre de 2026*");
  });
});

describe("the groups' calendars (PR D)", () => {
  const admin = { me: "a", isManager: true, led: [] };
  const leader = { me: "l", isManager: false, led: ["otro-nivel"] };
  const one = (g: string, over: Partial<MinistryEventView> = {}) =>
    ev({ audience: { kind: "groups", groups: [g] }, kind: "group", ...over });
  const joint = (over: Partial<MinistryEventView> = {}) =>
    ev({ audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] }, kind: "joint", ...over });

  it("lists the month's group meetings by date and time, never a whole-ministry one", () => {
    const list = groupEvents("2026-11", [
      one("otro-nivel", { _id: "b", date: "2026-11-12", time: "19:00" }),
      ev({ _id: "sat", date: "2026-11-07" }),
      one("otro-nivel", { _id: "a", date: "2026-11-12", time: "18:00" }),
      joint({ _id: "c", date: "2026-11-03", time: null }),
      one("otro-nivel", { _id: "dec", date: "2026-12-01" }),
    ]);
    expect(list.map((e) => e._id)).toEqual(["c", "a", "b"]);
  });

  it("«Editar»: an admin on any; a leader on a one-group meeting of their group; a joint one only its creator", () => {
    expect(canEditGroupEvent(one("invencibles"), admin)).toBe(true);
    expect(canEditGroupEvent(one("otro-nivel"), leader)).toBe(true);
    expect(canEditGroupEvent(one("invencibles"), leader)).toBe(false);
    expect(canEditGroupEvent(joint({ createdById: "l" }), leader)).toBe(true);
    expect(canEditGroupEvent(joint({ createdById: "other" }), leader)).toBe(false);
    // The creator who no longer leads any of its groups has lost it too.
    expect(canEditGroupEvent(joint({ createdById: "l" }), { ...leader, led: ["invencibles"] })).toBe(false);
    expect(canEditGroupEvent(ev(), leader)).toBe(false);
  });

  it("«Nueva reunión de grupo»: an admin or a leader of a group", () => {
    expect(canCreateGroupEvent(admin)).toBe(true);
    expect(canCreateGroupEvent(leader)).toBe(true);
    expect(canCreateGroupEvent({ me: "m", isManager: false, led: [] })).toBe(false);
  });

  it("a new meeting starts for the leader's first group, unpublished; an existing one keeps its fields", () => {
    expect(groupEventForm("2026-11-10", leader)).toEqual({
      date: "2026-11-10", time: "", title: "", place: "", notes: "", groups: ["otro-nivel"], published: false,
    });
    expect(groupEventForm("2026-11-10", admin).groups).toEqual([]);
    const f = groupEventForm("2026-11-01", leader, joint({ date: "2026-11-20", time: "19:30", title: "Campamento", published: true }));
    expect([f.date, f.time, f.title, f.groups, f.published]).toEqual(["2026-11-20", "19:30", "Campamento", ["otro-nivel", "emprendedores"], true]);
  });

  it("says what would stop a save: no date, no group, or a leader without one of their own", () => {
    const f = groupEventForm("2026-11-10", leader);
    expect(groupEventProblem(f, leader)).toBeNull();
    expect(groupEventProblem({ ...f, date: "" }, leader)).toBe("Elige la fecha.");
    expect(groupEventProblem({ ...f, groups: [] }, leader)).toBe("Elige al menos un grupo.");
    expect(groupEventProblem({ ...f, groups: ["invencibles"] }, leader)).toBe("Incluye uno de los grupos que lideras.");
    expect(groupEventProblem({ ...f, groups: ["invencibles"] }, admin)).toBeNull();
  });

  it("refuses more than three groups, after the empty check and before the own-group one (T5a)", () => {
    const f = groupEventForm("2026-11-10", leader);
    const four = ["otro-nivel", "invencibles", "emprendedores", "adrenalin"];
    expect(groupEventProblem({ ...f, groups: four }, leader)).toBe("Elige hasta tres grupos; para todos, usa una reunión de todo Jóvenes.");
    expect(groupEventProblem({ ...f, groups: four }, admin)).toBe("Elige hasta tres grupos; para todos, usa una reunión de todo Jóvenes.");
    expect(groupEventProblem({ ...f, groups: four.slice(0, 3) }, leader)).toBeNull();
    expect(groupEventProblem({ ...f, groups: [] }, leader)).toBe("Elige al menos un grupo.");
    // Four groups none of which they lead: the count is said first.
    expect(groupEventProblem({ ...f, groups: ["invencibles", "emprendedores", "adrenalin", "guerreras"] }, leader)).toBe(
      "Elige hasta tres grupos; para todos, usa una reunión de todo Jóvenes.",
    );
    expect(groupEventProblem({ ...f, groups: ["invencibles"] }, leader)).toBe("Incluye uno de los grupos que lideras.");
  });

  it("checks the clock last, after the rules about groups", () => {
    const f = groupEventForm("2026-11-10", leader);
    expect(groupEventProblem({ ...f, time: "19:00" }, leader)).toBeNull();
    expect(groupEventProblem({ ...f, time: "7pm" }, leader)).toBe("La hora debe ser HH:mm (por ejemplo 19:30).");
    expect(groupEventProblem({ ...f, time: "7pm", groups: [] }, leader)).toBe("Elige al menos un grupo.");
  });

  it("sends the groups in registry order with no kind (the writer derives it), cleared fields as null", () => {
    const body = groupEventBody({ date: "2026-11-10", time: " ", title: " Campamento ", place: " Casa Varela ", notes: "", groups: ["emprendedores", "otro-nivel"], published: true });
    expect(body).toEqual({
      audience: { kind: "groups", groups: ["otro-nivel", "emprendedores"] },
      date: "2026-11-10",
      time: null,
      title: "Campamento",
      place: "Casa Varela",
      notes: null,
      published: true,
    });
    expect(body).not.toHaveProperty("kind");
  });

  // Per-group leadership (plan 2026-11-11 T9, ADR-0085): the screens take `viewer.led` from
  // `ledGroupsIn`, so «leads A, in B» is a viewer whose `led` holds A only.
  describe("leads Otro Nivel, in Invencibles (T9)", () => {
    const jacob = {
      me: "j",
      isManager: false,
      led: ledGroupsIn(
        {
          role: "member",
          ministries: ["jovenes"],
          managesMinistries: [],
          ministryRoles: normalizeMinistryRoles(
            [{ _key: "jovenes", ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles"], leaderOf: ["otro-nivel"] }],
            ["jovenes"],
          ),
        },
        "jovenes",
      ),
    };

    it("plans only the group they lead: the form starts on it; a form with only the other says so", () => {
      expect(jacob.led).toEqual(["otro-nivel"]);
      expect(canCreateGroupEvent(jacob)).toBe(true);
      const f = groupEventForm("2026-11-10", jacob);
      expect(f.groups).toEqual(["otro-nivel"]);
      expect(groupEventProblem({ ...f, groups: ["invencibles"] }, jacob)).toBe("Incluye uno de los grupos que lideras.");
      expect(groupEventProblem({ ...f, groups: ["otro-nivel", "invencibles"] }, jacob)).toBeNull();
    });

    it("cannot edit the other group's meeting, published or not; edits their own", () => {
      expect(canEditGroupEvent(one("invencibles", { published: true }), jacob)).toBe(false);
      expect(canEditGroupEvent(one("invencibles", { createdById: "j" }), jacob)).toBe(false);
      expect(canEditGroupEvent(one("otro-nivel"), jacob)).toBe(true);
    });

    it("editLosesAccess still warns when sharing someone else's meeting of the group they lead", () => {
      const theirs = one("otro-nivel", { createdById: "other" });
      expect(editLosesAccess(theirs, { ...groupEventForm("", jacob, theirs), groups: ["otro-nivel", "invencibles"] }, jacob)).toBe(true);
    });
  });

  it("warns a leader who would share someone else's one-group meeting, and nobody else", () => {
    const mine = one("otro-nivel", { createdById: "other" });
    const shared = { ...groupEventForm("", leader, mine), groups: ["otro-nivel", "invencibles"] };
    expect(editLosesAccess(mine, shared, leader)).toBe(true);
    expect(editLosesAccess(one("otro-nivel", { createdById: "l" }), shared, leader)).toBe(false);
    expect(editLosesAccess(mine, shared, admin)).toBe(false);
    expect(editLosesAccess(null, shared, leader)).toBe(false);
    expect(editLosesAccess(mine, { ...shared, groups: ["otro-nivel"] }, leader)).toBe(false);
  });
});
