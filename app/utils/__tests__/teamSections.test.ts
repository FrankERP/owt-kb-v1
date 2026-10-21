import { describe, expect, it } from "vitest";
import { avatarSrc, defaultOpenSections, initialsOf, seatPhotos, teamSections, type TeamInput } from "../teamSections";

const team: TeamInput = {
  leads: ["Gaby"],
  bgvs: [{ member_name: "Paulina", alias: "Pau" }],
  chorus: [{ member_name: "Lupe" }],
  instruments: [{ label: "Bajo", person: "Frank" }, { label: "Keys", person: "" }],
  fohTeam: [{ label: "Audio", person: "Toño" }],
};
const ids = (s: Set<string>) => [...s].sort();

describe("teamSections", () => {
  it("builds Voces (Lead · BGV · Coro by display name), Banda and Cabina, dropping empty seats", () => {
    expect(teamSections(team)).toEqual([
      { id: "voces", label: "Voces", people: [{ name: "Gaby", role: "Lead" }, { name: "Pau", role: "BGV" }, { name: "Lupe", role: "Coro" }] },
      { id: "banda", label: "Banda", people: [{ name: "Frank", role: "Bajo" }] },
      { id: "cabina", label: "Cabina", people: [{ name: "Toño", role: "Audio" }] },
    ]);
  });
  it("leaves out a section nobody sits in", () => {
    expect(teamSections({ leads: ["Gaby"], instruments: [{ label: "Keys", person: "" }] }).map((s) => s.id)).toEqual(["voces"]);
    expect(teamSections({})).toEqual([]);
  });
});

describe("defaultOpenSections", () => {
  const sections = teamSections(team);
  it("opens the sections the viewer is seated in, over their Tipo", () => {
    expect(ids(defaultOpenSections(sections, "frank", ["voz"]))).toEqual(["banda"]);
    expect(ids(defaultOpenSections(sections, "pau", ["instrumento"]))).toEqual(["voces"]);
  });
  it("opens both when the viewer holds a seat in both", () => {
    const both = teamSections({ ...team, chorus: [{ member_name: "Frank" }] });
    expect(ids(defaultOpenSections(both, "frank", null))).toEqual(["banda", "voces"]);
  });
  it("falls back to the Tipo without a seat; leaders sing; a Tipo with no section opens nothing", () => {
    expect(ids(defaultOpenSections(sections, "nadie", ["voz", "instrumento"]))).toEqual(["banda", "voces"]);
    expect(ids(defaultOpenSections(sections, "nadie", ["sunday_lead"]))).toEqual(["voces"]);
    expect(ids(defaultOpenSections(sections, "", ["foh"]))).toEqual(["cabina"]);
    expect(ids(defaultOpenSections(sections, "nadie", ["support"]))).toEqual([]);
    expect(ids(defaultOpenSections(sections, "nadie", undefined))).toEqual([]);
  });
  it("always opens a section holding a double booking, on top of the seat or Tipo default", () => {
    const dup = teamSections({ ...team, fohTeam: [{ label: "Audio", person: "Toño" }, { label: "Luces", person: "toño " }] });
    expect(ids(defaultOpenSections(dup, "", null))).toEqual(["cabina"]);
    expect(ids(defaultOpenSections(dup, "frank", null))).toEqual(["banda", "cabina"]);
    expect(ids(defaultOpenSections(dup, "nadie", ["voz"]))).toEqual(["cabina", "voces"]);
  });
  it("never opens a section this service does not have", () => {
    expect(ids(defaultOpenSections(teamSections({ leads: ["Gaby"] }), "nadie", ["foh"]))).toEqual([]);
  });
});

describe("initialsOf / avatarSrc", () => {
  it("takes the first two letters, as MeHeader and NavMenu do", () => {
    expect(initialsOf("Toño")).toBe("TO");
    expect(initialsOf(" ana maría ")).toBe("AN");
    expect(initialsOf("")).toBe("?");
  });
  it("asks Sanity for a 96 px square JPEG crop and passes any other URL through", () => {
    expect(avatarSrc("https://cdn.sanity.io/images/p/d/abc.jpg")).toBe("https://cdn.sanity.io/images/p/d/abc.jpg?w=96&h=96&fit=crop&fm=jpg");
    expect(avatarSrc("https://cdn.sanity.io/images/p/d/abc.jpg?rect=0,0,10,10")).toBe("https://cdn.sanity.io/images/p/d/abc.jpg?rect=0,0,10,10&w=96&h=96&fit=crop&fm=jpg");
    expect(avatarSrc("https://lh3.googleusercontent.com/a/x=s96-c")).toBe("https://lh3.googleusercontent.com/a/x=s96-c");
  });
});

describe("seatPhotos", () => {
  it("keys every seat's photo by lowercased display name, first one wins, skipping blanks and missing roles", () => {
    expect(
      seatPhotos([
        null,
        {
          Lead: [{ member_name: "Gabriela", alias: "Gaby", photo: "g1" }],
          BGVs: [{ member_name: "Lupe", photo: null }],
          instruments: [{ person: "Frank", photo: "f1" }, { person: null, photo: "x" }],
          foh_team: [{ person: "Toño", photo: "t1" }],
        },
        { Chorus: [{ member_name: "Gaby", photo: "g2" }] },
      ]),
    ).toEqual({ gaby: "g1", frank: "f1", "toño": "t1" });
  });
});
