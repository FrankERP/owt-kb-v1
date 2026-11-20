import { describe, expect, it } from "vitest";
import { hasNotices, meetingNotices, snapshotOf, type MeetingSnapshot } from "../ministryEventNotices";

const TODAY = "2026-11-17";
const ref = (id: string) => ({ _type: "reference", _ref: id, _weak: true });

/** A meeting's document fields, as stored (and as a write is about to store them). */
function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    audience: { kind: "ministry" },
    published: true,
    date: "2026-11-21",
    seats: [
      { _key: "s1", role: "encargado", member: ref("noemi") },
      { _key: "s2", role: "comparte", member: ref("ana") },
    ],
    program: [
      { _key: "l1", label: "Oración", part: "oracion", member: ref("jacob") },
      { _key: "l2", label: "Dinámica 1", part: "dinamica1", member: ref("andy"), member2: ref("gaby") },
    ],
    ...over,
  };
}
const snap = (over: Record<string, unknown> = {}): MeetingSnapshot => snapshotOf(doc(over));
const ctx = { actorId: "noemi", today: TODAY };
const ids = (n: ReturnType<typeof meetingNotices>) => n.assigned.map((a) => a.memberId).sort();

describe("snapshotOf", () => {
  it("reads seats, both slots of a line, the part and the music", () => {
    const s = snap({ program: [{ _key: "l1", label: "x", part: "oracion", member: ref("jacob"), music: "alabanza", note: " hola " }] });
    expect(s.ministryWide).toBe(true);
    expect(s.seats).toEqual([
      { role: "encargado", member: "noemi", name: null },
      { role: "comparte", member: "ana", name: null },
    ]);
    expect(s.lines).toEqual([{ key: "l1", part: "oracion", label: "x", members: ["jacob"], music: "alabanza", note: "hola" }]);
  });

  it("reads anything malformed as absent, never as a person", () => {
    const s = snapshotOf({
      audience: "ministry",
      published: "true",
      date: 20261121,
      seats: [null, "x", { role: 3, member: "jacob" }, { role: "comparte", name: "Ana" }],
      program: [{ part: "constructor", member: { _ref: "" }, member2: ref("a"), music: "radio" }, 7],
    });
    expect(s).toMatchObject({ ministryWide: false, published: false, date: "" });
    expect(s.seats).toEqual([
      { role: "", member: null, name: null },
      { role: "comparte", member: null, name: "Ana" },
    ]);
    expect(s.lines).toEqual([{ key: "i0", part: null, label: "", members: ["a"], music: null, note: null }]);
  });

  it("counts a person once when both slots name them", () => {
    expect(snap({ program: [{ _key: "l", part: "dinamica1", member: ref("a"), member2: ref("a") }] }).lines[0].members).toEqual(["a"]);
  });
});

describe("meetingNotices — who is told they were assigned", () => {
  it("a create already published announces everyone but the actor", () => {
    const n = meetingNotices(null, snap(), ctx);
    expect(ids(n)).toEqual(["ana", "andy", "gaby", "jacob"]);
    expect(n.moved).toBe(false);
    expect(n.assigned.find((a) => a.memberId === "andy")?.roles).toEqual([
      { kind: "part", id: "dinamica1", label: "Dinámica 1", partners: ["gaby"] },
    ]);
    expect(n.assigned.find((a) => a.memberId === "ana")?.roles).toEqual([{ kind: "seat", id: "comparte", label: "comparte", partners: [] }]);
  });

  it("a publish (draft before) announces everyone", () => {
    expect(ids(meetingNotices(snap({ published: false }), snap(), ctx))).toEqual(["ana", "andy", "gaby", "jacob"]);
  });

  it("an edit of a published meeting announces only the new pairs", () => {
    const after = snap({
      seats: [
        { _key: "s1", role: "encargado", member: ref("noemi") },
        { _key: "s2", role: "comparte", member: ref("ana") },
        { _key: "s3", role: "apoyo", member: ref("jacob") },
      ],
    });
    const n = meetingNotices(snap(), after, ctx);
    // Jacob already had Oración; only his new seat is news.
    expect(n.assigned).toEqual([{ memberId: "jacob", roles: [{ kind: "seat", id: "apoyo", label: "apoyo", partners: [] }] }]);
  });

  it("an edit that changes nobody announces nothing", () => {
    const n = meetingNotices(snap(), snap({ program: [...(doc().program as unknown[]), { _key: "l9", label: "Anuncios" }] }), ctx);
    expect(n.assigned).toEqual([]);
    expect(hasNotices(n)).toBe(false);
  });

  it("a person moved to another part hears about the new part only", () => {
    const after = snap({ program: [{ _key: "l1", label: "Oración", part: "oracion", member: ref("andy") }, { _key: "l2", label: "Dinámica 1", part: "dinamica1", member: ref("andy"), member2: ref("gaby") }] });
    const n = meetingNotices(snap(), after, ctx);
    expect(n.assigned).toEqual([{ memberId: "andy", roles: [{ kind: "part", id: "oracion", label: "Oración", partners: [] }] }]);
  });

  it("a free line counts by its key, with its own label", () => {
    const after = snap({ program: [...(doc().program as unknown[]), { _key: "l9", label: "Anuncios", member: ref("goma") }] });
    expect(meetingNotices(snap(), after, ctx).assigned).toEqual([
      { memberId: "goma", roles: [{ kind: "line", id: "l9", label: "Anuncios", partners: [] }] },
    ]);
  });

  it("a new date announces everyone again and says it moved", () => {
    const n = meetingNotices(snap(), snap({ date: "2026-11-28" }), ctx);
    expect(ids(n)).toEqual(["ana", "andy", "gaby", "jacob"]);
    expect(n.moved).toBe(true);
    expect(n.assigned.every((a) => a.moved === true)).toBe(true);
  });

  it("someone the same write adds was never told the old date: theirs is not «cambió de fecha»", () => {
    const after = snap({ date: "2026-11-28", seats: [...(doc().seats as unknown[]), { _key: "sx", role: "apoyo", member: ref("nueva") }] });
    const n = meetingNotices(snap(), after, ctx);
    expect(n.moved).toBe(true);
    expect(n.assigned.find((a) => a.memberId === "nueva")).not.toHaveProperty("moved");
    expect(n.assigned.find((a) => a.memberId === "ana")).toMatchObject({ moved: true });
  });

  it("never the actor, never a typed name", () => {
    const after = snap({ seats: [{ _key: "s1", role: "encargado", member: ref("noemi") }, { _key: "s2", role: "comparte", name: "Ana sin cuenta" }], program: [] });
    expect(meetingNotices(null, after, ctx).assigned).toEqual([]);
  });

  it("a draft, a past meeting and a group's meeting announce nobody", () => {
    expect(hasNotices(meetingNotices(null, snap({ published: false }), ctx))).toBe(false);
    expect(hasNotices(meetingNotices(null, snap({ date: "2026-11-16" }), ctx))).toBe(false);
    expect(hasNotices(meetingNotices(null, snap({ audience: { kind: "groups", groups: ["otro-nivel"] } }), ctx))).toBe(false);
    expect(hasNotices(meetingNotices(null, snap({ date: "pronto" }), ctx))).toBe(false);
  });

  it("today still counts", () => {
    expect(ids(meetingNotices(null, snap({ date: TODAY }), ctx))).toEqual(["ana", "andy", "gaby", "jacob"]);
  });

  it("an unpublish announces nobody", () => {
    expect(meetingNotices(snap(), snap({ published: false }), ctx).assigned).toEqual([]);
  });

  it("two people in one seat role are each other's partners", () => {
    const after = snap({ seats: [{ _key: "a", role: "comparte", member: ref("ana") }, { _key: "b", role: "comparte", member: ref("beto") }], program: [] });
    const n = meetingNotices(null, after, ctx);
    expect(n.assigned).toEqual([
      { memberId: "ana", roles: [{ kind: "seat", id: "comparte", label: "comparte", partners: ["beto"] }] },
      { memberId: "beto", roles: [{ kind: "seat", id: "comparte", label: "comparte", partners: ["ana"] }] },
    ]);
  });
});

describe("meetingNotices — the music request", () => {
  const asking = (over: Record<string, unknown> = {}) =>
    snap({ program: [{ _key: "l1", label: "Oración", part: "oracion", member: ref("jacob"), music: "alabanza", note: "Algo suave" }], ...over });
  const plain = (over: Record<string, unknown> = {}) =>
    snap({ program: [{ _key: "l1", label: "Oración", part: "oracion", member: ref("jacob"), music: "track" }], ...over });

  it("a request that appears is said, with the note and who asks", () => {
    expect(meetingNotices(plain(), asking(), { actorId: "jacob", today: TODAY }).music).toEqual([
      { part: "oracion", asks: true, note: "Algo suave", members: ["jacob"], names: [] },
    ]);
  });

  it("a request that goes away is said too, without the note", () => {
    expect(meetingNotices(asking(), plain(), { actorId: "jacob", today: TODAY }).music).toEqual([
      { part: "oracion", asks: false, note: null, members: ["jacob"], names: [] },
    ]);
  });

  it("no change, no notice", () => {
    expect(meetingNotices(asking(), asking(), ctx).music).toEqual([]);
    expect(meetingNotices(plain(), plain(), ctx).music).toEqual([]);
  });

  it("a draft's request is said when it is published, and withdrawn when unpublished", () => {
    expect(meetingNotices(asking({ published: false }), asking(), ctx).music.map((m) => m.asks)).toEqual([true]);
    expect(meetingNotices(asking(), asking({ published: false }), ctx).music.map((m) => m.asks)).toEqual([false]);
  });

  it("a request on a re-dated meeting is said again", () => {
    expect(meetingNotices(asking(), asking({ date: "2026-11-28" }), ctx).music.map((m) => m.asks)).toEqual([true]);
  });

  it("Plática's request names whoever holds comparte, typed names included", () => {
    const after = snap({
      seats: [{ _key: "a", role: "comparte", member: ref("ana") }, { _key: "b", role: "comparte", name: "Pastor invitado" }],
      program: [{ _key: "p", label: "Plática", part: "platica", music: "alabanza", note: "Tema: identidad" }],
    });
    expect(meetingNotices(snap({ program: [] }), after, ctx).music).toEqual([
      { part: "platica", asks: true, note: "Tema: identidad", members: ["ana"], names: ["Pastor invitado"] },
    ]);
  });

  it("a past meeting, a draft and a group's meeting never ask", () => {
    expect(meetingNotices(null, asking({ date: "2026-11-01" }), ctx).music).toEqual([]);
    expect(meetingNotices(null, asking({ published: false }), ctx).music).toEqual([]);
    expect(meetingNotices(null, asking({ audience: { kind: "groups", groups: ["otro-nivel"] } }), ctx).music).toEqual([]);
  });

  it("music on a dynamic is never a request", () => {
    const after = snap({ program: [{ _key: "d", label: "Dinámica 1", part: "dinamica1", member: ref("andy"), music: "alabanza" }] });
    expect(meetingNotices(null, after, ctx).music).toEqual([]);
  });
});
