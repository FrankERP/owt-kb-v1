import { describe, expect, it } from "vitest";
import type { MinistryEventView } from "../ministryEventReads";
import {
  bookForm,
  bookProblem,
  bookRows,
  classBody,
  classForm,
  groupRosters,
  plannableGroups,
  shiftPreview,
  splitRoster,
  swapCandidates,
  type ClassView,
} from "../jovenesClassesModel";
import type { LessonTrack } from "../ministryLesson";

let n = 0;
function cls(date: string, over: { series?: string; track?: LessonTrack; done?: boolean; group?: string; title?: string } = {}): ClassView {
  return {
    _id: `ministryEvent.00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    rev: "r",
    ministry: "jovenes",
    audience: { kind: "groups", groups: [over.group ?? "otro-nivel"] },
    kind: "group",
    date,
    time: "11:40",
    arrival: null,
    title: over.title ?? null,
    notes: null,
    place: "Oasis Tepepan",
    lesson: { series: over.series ?? "El Caos Dentro de Mi", track: over.track ?? "libro", done: over.done ?? false },
    published: true,
    seats: [],
    program: [],
    createdById: null,
    createdByName: null,
  };
}
const plain = (date: string): MinistryEventView => ({ ...cls(date), lesson: null });

describe("jovenesClassesModel", () => {
  it("an admin plans every group, a leader the groups they lead", () => {
    const all = [{ id: "otro-nivel", name: "Otro Nivel" }, { id: "invencibles", name: "Invencibles" }];
    expect(plannableGroups(all, { me: "a", isManager: true, led: [] })).toEqual(all);
    expect(plannableGroups(all, { me: "j", isManager: false, led: ["invencibles"] })).toEqual([all[1]]);
  });

  it("groups one group's classes by roster, the one with the next class first, counting held classes only", () => {
    const old = [cls("2026-05-03", { series: "Amar es para valientes", done: true })];
    const now = [
      cls("2026-11-08", { done: true }),
      cls("2026-11-15"),
      cls("2026-11-22", { track: "sin_clase" }),
      cls("2026-11-29"),
    ];
    const other = [cls("2026-11-15", { group: "invencibles" }), plain("2026-11-15")];
    const rosters = groupRosters([...old, ...now, ...other], "otro-nivel", "2026-11-12");
    expect(rosters.map((r) => [r.series, r.held, r.total, r.classes.length])).toEqual([
      ["El Caos Dentro de Mi", 1, 3, 4],
      ["Amar es para valientes", 1, 1, 1],
    ]);
    const split = splitRoster(rosters[0], "2026-11-12");
    expect(split.past.map((c) => c.date)).toEqual(["2026-11-08"]);
    expect(split.months.map((m) => [m.month, m.classes.length])).toEqual([["2026-11", 3]]);
  });

  it("previews «Recorrer» by the writer's rule: classes move, «No hubo clase» dates stay and are hopped", () => {
    const c6 = cls("2026-11-22", { title: "Cap 6" });
    const c7 = cls("2026-11-29", { title: "Cap 7" });
    const camp = cls("2026-12-06", { track: "sin_clase" });
    const c8 = cls("2026-12-13", { title: "Cap 8" });
    const [r] = groupRosters([cls("2026-11-15"), c6, c7, camp, c8], "otro-nivel", "2026-11-01");
    const next = plain("2026-12-20");
    const p = shiftPreview(r, c6, [next]);
    expect(p.ids).toEqual([c6._id, c7._id, c8._id]);
    expect(p.moves.map((m) => [m.title, m.to])).toEqual([
      ["Cap 6", "2026-11-29"],
      ["Cap 7", "2026-12-13"],
      ["Cap 8", "2026-12-20"],
    ]);
    expect(p.collisions).toEqual(["2026-12-20"]);
  });

  it("offers to trade only open classes of the same roster", () => {
    const a = cls("2026-11-15");
    const b = cls("2026-11-22");
    const [r] = groupRosters([a, b, cls("2026-11-29", { done: true }), cls("2026-12-06", { track: "sin_clase" })], "otro-nivel", "2026-11-01");
    expect(swapCandidates(r, a).map((c) => c._id)).toEqual([b._id]);
  });

  it("a class body carries one encargado (member or typed), the lesson, and titles a «No hubo clase»", () => {
    const f = { ...classForm("otro-nivel", "2026-11-15", "El Caos"), responsable: { member: null, name: " Todos " } };
    expect(f.time).toBe("11:40");
    expect(f.place).toBe("Oasis Tepepan");
    expect(classBody(f)).toMatchObject({
      audience: { kind: "groups", groups: ["otro-nivel"] },
      seats: [{ role: "encargado", name: "Todos" }],
      lesson: { series: "El Caos", track: "libro", done: false },
      title: null,
    });
    expect(classBody({ ...f, track: "sin_clase" }).title).toBe("No hubo clase");
    expect(classBody({ ...f, responsable: { member: "m1", name: null } }, "k1").seats).toEqual([{ _key: "k1", role: "encargado", member: "m1" }]);
    expect(classBody({ ...f, responsable: { member: null, name: null } }).seats).toEqual([]);
  });

  it("«Nuevo libro» builds «Cap N» rows every N days with the rotation, at most 60", () => {
    const f = {
      ...bookForm("otro-nivel", "2026-11-15"),
      series: "El Caos Dentro de Mi",
      firstChapter: 5,
      count: 6,
      rotation: [{ member: "rebe", name: null }, { member: null, name: "Todos" }],
    };
    expect(bookProblem(f)).toBeNull();
    const rows = bookRows(f);
    expect(rows.map((r) => [r.title, r.date, r.responsable.member ?? r.responsable.name])).toEqual([
      ["Cap 5", "2026-11-15", "rebe"],
      ["Cap 6", "2026-11-22", "Todos"],
      ["Cap 7", "2026-11-29", "rebe"],
      ["Cap 8", "2026-12-06", "Todos"],
      ["Cap 9", "2026-12-13", "rebe"],
      ["Cap 10", "2026-12-20", "Todos"],
    ]);
    expect(bookProblem({ ...f, count: 61 })).toMatch(/60/);
    expect(bookProblem({ ...f, series: " " })).not.toBeNull();
  });
});
