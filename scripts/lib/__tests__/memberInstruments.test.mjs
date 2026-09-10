import { describe, it, expect } from "vitest";
import { INSTRUMENT_SEATS, normalizeSeatName, proposeInstruments } from "../memberInstruments.mjs";

const member = (id, name, memberType, instruments) => ({ _id: id, member_name: name, memberType, instruments });
const role = (seats) => ({ instruments: seats.map(([instrument, ref]) => ({ instrument, person: ref ? { _ref: ref } : null })) });

describe("normalizeSeatName (mirror of seatModel.ts)", () => {
  it("collapses case and whitespace onto the canonical five", () => {
    expect(normalizeSeatName(" keys")).toBe("Keys");
    expect(normalizeSeatName("DRUMS")).toBe("Drums");
    expect(normalizeSeatName("eg")).toBe("EG");
    expect(normalizeSeatName("Piano")).toBe("Piano"); // unknown keeps its casing
  });
  it("mirrors DEFAULT_INSTRUMENT_SEATS", () => {
    expect(INSTRUMENT_SEATS).toEqual(["Bass", "Keys", "Drums", "EG", "AG"]);
  });
});

describe("proposeInstruments", () => {
  const members = [
    member("a", "Ana", ["instrumento"], undefined),
    member("b", "Beto", ["instrumento"], ["Keys"]),
    member("c", "Carla", ["instrumento"], undefined),
    member("d", "Dora", ["voz"], undefined),
  ];
  const roles = [
    role([["keys", "a"], ["Drums", "a"], ["Piano", "a"]]),
    role([["Keys", "b"], ["Bass", "d"]]),
    role([["Drums", "a"], [" drums ", null]]),
  ];

  it("groups by person, normalizes, counts evidence, and restricts to the closed list", () => {
    const { proposals } = proposeInstruments(members, roles);
    const ana = proposals.find((p) => p.id === "a");
    expect(ana.proposed).toEqual(["Keys", "Drums"]);
    expect(ana.evidence).toEqual({ Keys: 1, Drums: 2 });
    expect(ana.action).toBe("write");
  });

  it("never touches a member with a stored value", () => {
    const { proposals } = proposeInstruments(members, roles);
    expect(proposals.find((p) => p.id === "b").action).toBe("skip-stored");
  });

  it("skips a Tipo-instrumento member with no history rather than writing []", () => {
    const { proposals } = proposeInstruments(members, roles);
    expect(proposals.find((p) => p.id === "c").action).toBe("skip-no-history");
  });

  it("lists members who held seats without the Tipo separately, and unknown labels", () => {
    const { noTipo, unrecognised } = proposeInstruments(members, roles);
    expect(noTipo).toEqual([{ id: "d", name: "Dora", seen: ["Bass"] }]);
    expect(unrecognised).toEqual([{ label: "Piano", count: 1 }]);
  });
});
