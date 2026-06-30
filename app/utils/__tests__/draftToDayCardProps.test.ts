import { describe, it, expect } from "vitest";
import { draftToDayCardProps } from "../draftToDayCardProps";

const members = [
  { _id: "m1", member_name: "Frank", alias: "Frankie" },
  { _id: "m2", member_name: "Gaby" },
  { _id: "m3", member_name: "Jakey" },
];

const baseDraft = {
  _type: "sunday_role" as const,
  date: "2026-07-05",
  leads: ["m1"],
  bgvs: ["m2", "m3"],
  chorus: ["m2"],
  instruments: [{ instrument: "Guitarra", personId: "m3" }],
  foh: [{ role: "Sonido", personId: "m1" }],
};

describe("draftToDayCardProps", () => {
  it("maps a Sunday draft's ids to DayCard names/objects", () => {
    const r = draftToDayCardProps(baseDraft, members);
    expect(r.day).toBe("Domingo");
    expect(r.date).toBe("2026-07-05");
    expect(r.leads).toEqual(["Frank"]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }, { member_name: "Jakey", alias: undefined }]);
    expect(r.chorus).toEqual([{ member_name: "Gaby", alias: undefined }]);
    expect(r.instruments).toEqual([{ label: "Guitarra", person: "Jakey" }]);
    expect(r.fohTeam).toEqual([{ label: "Sonido", person: "Frank" }]);
  });

  it("labels saturday_role as Sábado", () => {
    expect(draftToDayCardProps({ ...baseDraft, _type: "saturday_role" }, members).day).toBe("Sábado");
  });

  it("drops ids with no matching member without crashing", () => {
    const r = draftToDayCardProps({ ...baseDraft, leads: ["ghost"], bgvs: ["ghost", "m2"] }, members);
    expect(r.leads).toEqual([]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }]);
  });
});
