// A meeting's fixed parts as the screens read them (ADR-0089): who answers for each, what is
// «mine», and which forms the page offers. Pure; the access decision is the writer's (W10).

import { describe, expect, it } from "vitest";
import type { MinistryEventLine, MinistryEventSeat, MinistryEventView } from "../ministryEventReads";
import { freeLines, joinNames, meetingPageOpens, partPending, partViews, writableParts } from "../jovenesPartView";

const seat = (role: string, over: Partial<MinistryEventSeat> = {}): MinistryEventSeat => ({
  _key: `s-${role}-${over.memberId ?? over.name ?? "x"}`,
  role,
  memberId: "m1",
  name: "Ana",
  photo: null,
  mine: false,
  ...over,
});

const line = (over: Partial<MinistryEventLine> = {}): MinistryEventLine => ({
  _key: "l1",
  label: "Bienvenida",
  part: null,
  memberId: null,
  name: null,
  photo: null,
  mine: false,
  second: null,
  note: null,
  music: null,
  helpers: null,
  ...over,
});

const ev = (over: Partial<Pick<MinistryEventView, "kind" | "seats" | "program">> = {}) => ({
  kind: "saturday" as string | null,
  seats: [] as MinistryEventSeat[],
  program: [] as MinistryEventLine[],
  ...over,
});

describe("partViews", () => {
  it("a Saturday lists the four parts in the order the meeting runs them, even with nothing stored", () => {
    const parts = partViews(ev());
    expect(parts.map((p) => p.id)).toEqual(["oracion", "dinamica1", "dinamica2", "platica"]);
    expect(parts.every((p) => !p.stored && !p.mine && p.people.length === 0)).toBe(true);
  });

  it("another meeting with no part line has none", () => {
    expect(partViews(ev({ kind: "ministry", program: [line()] }))).toEqual([]);
  });

  it("another meeting shows only the parts it holds, so a part is never stored and invisible — and no empty steps", () => {
    const parts = partViews(ev({ kind: "ministry", program: [line({ part: "dinamica2", label: "Dinámica 2" }), line()] }));
    expect(parts.map((p) => p.id)).toEqual(["dinamica2"]);
    expect(parts[0].stored).toBe(true);
  });

  it("another meeting has Plática as soon as someone holds a comparte seat (the email asks them for their topic)", () => {
    const member = partViews(ev({ kind: "ministry", seats: [seat("comparte", { mine: true })] }));
    expect(member.map((p) => p.id)).toEqual(["platica"]);
    expect(member[0]).toMatchObject({ mine: true, stored: false });
    // A guest typed by name has no account: the part exists so whoever edits the program fills it.
    const guest = partViews(ev({ kind: "ministry", seats: [seat("comparte", { memberId: null, name: "Invitado" })] }));
    expect(guest.map((p) => p.id)).toEqual(["platica"]);
    expect(guest[0]).toMatchObject({ mine: false, stored: false });
    expect(writableParts(guest, { editsProgram: true, published: true }).map((p) => p.id)).toEqual(["platica"]);
    expect(writableParts(guest, { editsProgram: false, published: true })).toEqual([]);
    // An empty seat is nobody.
    expect(partViews(ev({ kind: "ministry", seats: [seat("comparte", { memberId: null, name: null })] }))).toEqual([]);
  });

  it("a dinámica reads both people of its line, and is mine through either slot", () => {
    const program = [
      line({
        _key: "d1",
        part: "dinamica1",
        label: "Dinámica 1",
        memberId: "m2",
        name: "Beto",
        note: "Sillas",
        helpers: "Dani",
        second: { _key: "d1", memberId: "m3", name: "Caro", photo: "https://x/p.jpg", mine: true },
      }),
    ];
    const d1 = partViews(ev({ program }))[1];
    expect(d1.people).toEqual([
      { name: "Beto", photo: null, mine: false },
      { name: "Caro", photo: "https://x/p.jpg", mine: true },
    ]);
    expect(d1).toMatchObject({ mine: true, note: "Sillas", helpers: "Dani", music: null, stored: true });
  });

  it("Plática's people are the comparte seats — members and typed names — never its line", () => {
    const seats = [
      seat("encargado", { memberId: "m9", name: "Noemí" }),
      seat("comparte", { memberId: "m4", name: "Goma", mine: true }),
      seat("comparte", { memberId: null, name: "Pastor invitado" }),
      seat("comparte", { memberId: null, name: null }),
    ];
    const program = [line({ part: "platica", label: "Plática", memberId: "m7", name: "Nadie", note: "La fe", music: "alabanza" })];
    const platica = partViews(ev({ seats, program }))[3];
    expect(platica.people.map((p) => p.name)).toEqual(["Goma", "Pastor invitado"]);
    expect(platica).toMatchObject({ mine: true, note: "La fe", music: "alabanza", helpers: null });
  });

  it("a part that takes no music or no helpers never shows a stored one", () => {
    const program = [
      line({ _key: "a", part: "oracion", helpers: "Dani", music: "track", memberId: "m1", name: "Ana" }),
      line({ _key: "b", part: "dinamica2", music: "alabanza" }),
    ];
    const [oracion, , d2] = partViews(ev({ program }));
    expect(oracion).toMatchObject({ music: "track", helpers: null });
    expect(d2.music).toBeNull();
  });

  it("the first line of a part is the one read, as the writer reads it", () => {
    const program = [line({ _key: "a", part: "oracion", note: "primera" }), line({ _key: "b", part: "oracion", note: "segunda" })];
    expect(partViews(ev({ program }))[0].note).toBe("primera");
  });

  it("a line whose member is gone names nobody", () => {
    const program = [line({ part: "oracion", memberId: null, name: "Fantasma" })];
    expect(partViews(ev({ program }))[0].people).toEqual([]);
  });
});

describe("freeLines", () => {
  it("keeps the lines that are no part, in order", () => {
    const program = [line({ _key: "a" }), line({ _key: "b", part: "oracion" }), line({ _key: "c", label: "Anuncios" })];
    expect(freeLines(program).map((l) => l._key)).toEqual(["a", "c"]);
  });
});

describe("writableParts and partPending", () => {
  const program = [
    line({ _key: "o", part: "oracion", memberId: "me", name: "Yo", mine: true }),
    line({ _key: "d", part: "dinamica1", memberId: "me", name: "Yo", mine: true, note: "Lista" }),
  ];
  const parts = partViews(ev({ program }));

  it("a responsable is offered only their own parts; whoever edits the program, all four", () => {
    expect(writableParts(parts, { editsProgram: false, published: true }).map((p) => p.id)).toEqual(["oracion", "dinamica1"]);
    expect(writableParts(parts, { editsProgram: true, published: true })).toHaveLength(4);
    // Off a Saturday there are only the parts the meeting holds.
    expect(writableParts(partViews(ev({ kind: "ministry", program })), { editsProgram: true, published: true }).map((p) => p.id)).toEqual(["oracion", "dinamica1"]);
  });

  it("a DRAFT offers a responsable nothing (the PATCH refuses whoever cannot read it as a member); an editor still fills it", () => {
    expect(writableParts(parts, { editsProgram: false, published: false })).toEqual([]);
    expect(writableParts(parts, { editsProgram: true, published: false })).toHaveLength(4);
  });

  it("pending: my part with no description, or — where it has music — no choice yet", () => {
    const [oracion, d1, d2] = parts;
    expect(partPending(oracion)).toBe(true);
    expect(partPending(d1)).toBe(false);
    expect(partPending(d2)).toBe(false); // not mine
    expect(partPending({ ...oracion, note: "Nota", music: null })).toBe(true);
    expect(partPending({ ...oracion, note: "Nota", music: "track" })).toBe(false);
    // Oración's note is optional: choosing the music is all it owes.
    expect(partPending({ ...oracion, note: null, music: "track" })).toBe(false);
    // A dinámica has no music: its description is what it owes.
    expect(partPending({ ...d1, note: null })).toBe(true);
    // Plática owes both.
    const platica = { ...oracion, id: "platica" as const };
    expect(partPending({ ...platica, note: null, music: "track" })).toBe(true);
    expect(partPending({ ...platica, note: "Tema", music: "track" })).toBe(false);
  });
});

describe("joinNames and meetingPageOpens", () => {
  it("joins one, two and three names the Spanish way", () => {
    expect([joinNames([]), joinNames(["Pau"]), joinNames(["Pau", "Mkz"]), joinNames(["Pau", "Mkz", "Lali"])]).toEqual(["", "Pau", "Pau y Mkz", "Pau, Mkz y Lali"]);
  });

  it("the meeting's page opens today, ahead, and 30 days back — not the day before that", () => {
    expect(meetingPageOpens("2026-11-17", "2026-11-17")).toBe(true);
    expect(meetingPageOpens("2027-11-17", "2026-11-17")).toBe(true);
    expect(meetingPageOpens("2026-10-18", "2026-11-17")).toBe(true);
    expect(meetingPageOpens("2026-10-17", "2026-11-17")).toBe(false);
  });
});
