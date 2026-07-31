import { describe, it, expect } from "vitest";
import { SERVICE_LABEL } from "@/app/components/admin/serviceCardModel";
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
    // `m1` has the alias `Frankie`: the alias wins everywhere a name is
    // pre-resolved to a string.
    expect(r.leads).toEqual(["Frankie"]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }, { member_name: "Jakey", alias: undefined }]);
    expect(r.chorus).toEqual([{ member_name: "Gaby", alias: undefined }]);
    expect(r.instruments).toEqual([{ label: "Guitarra", person: "Jakey" }]);
    expect(r.fohTeam).toEqual([{ label: "Sonido", person: "Frankie" }]);
  });

  it("labels saturday_role as Sábado", () => {
    expect(draftToDayCardProps({ ...baseDraft, _type: "saturday_role" }, members).day).toBe("Sábado");
  });

  it("pins the label mapping explicitly (fact 26): sunday_role -> Domingo, saturday_role -> Sábado", () => {
    expect(draftToDayCardProps({ ...baseDraft, _type: "sunday_role" }, members).day).toBe("Domingo");
    expect(draftToDayCardProps({ ...baseDraft, _type: "saturday_role" }, members).day).toBe("Sábado");
  });

  it("labels special_role as Especial, NOT Domingo — the old ternary called every non-Saturday draft a Sunday", () => {
    // `DayCard` reads this as a plain `string` and falls back to SPECIAL_THEME /
    // setlist type "special" for an unrecognised label, so widening the union is
    // safe (see `DayCardData.day`).
    expect(draftToDayCardProps({ ...baseDraft, _type: "special_role" }, members).day).toBe("Especial");
  });

  it("comes from the shared SERVICE_LABEL record, so all three labels agree with the rest of the app", () => {
    for (const type of ["sunday_role", "saturday_role", "special_role"] as const) {
      expect(draftToDayCardProps({ ...baseDraft, _type: type }, members).day).toBe(SERVICE_LABEL[type]);
    }
  });

  it("prefers the alias over the full name in every pre-resolved string", () => {
    // `bgvs`/`chorus` stay OBJECTS and let `DayCard` apply the same rule, so only
    // these three carry a resolved display name.
    const r = draftToDayCardProps(
      {
        ...baseDraft,
        leads: ["m1"],
        instruments: [{ instrument: "Guitarra", personId: "m1" }],
        foh: [{ role: "Sonido", personId: "m1" }],
      },
      members,
    );
    expect(r.leads).toEqual(["Frankie"]);
    expect(r.instruments[0].person).toBe("Frankie");
    expect(r.fohTeam[0].person).toBe("Frankie");
  });

  it("falls back to the full name when there is no alias, or it is blank", () => {
    const blank = [{ _id: "m9", member_name: "Guadalupe", alias: "   " }];
    const r = draftToDayCardProps({ ...baseDraft, leads: ["m9"], bgvs: [], chorus: [], instruments: [], foh: [] }, blank);
    expect(r.leads).toEqual(["Guadalupe"]);
    // And with no alias field at all (`m2`).
    expect(draftToDayCardProps({ ...baseDraft, leads: ["m2"] }, members).leads).toEqual(["Gaby"]);
  });

  it("drops ids with no matching member without crashing", () => {
    const r = draftToDayCardProps({ ...baseDraft, leads: ["ghost"], bgvs: ["ghost", "m2"] }, members);
    expect(r.leads).toEqual([]);
    expect(r.bgvs).toEqual([{ member_name: "Gaby", alias: undefined }]);
  });
});
