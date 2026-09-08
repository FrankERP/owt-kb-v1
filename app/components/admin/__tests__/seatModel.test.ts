// app/components/admin/__tests__/seatModel.test.ts
//
// The seat vocabulary is a closed list with one spelling per seat. Free text is
// what produced 7 spellings of 5 instruments in production; these tests are the
// gate that keeps a second spelling from ever being created.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  normalizeSeatName,
  occupantFitsSeat,
  SEAT_MEMBER_TYPE,
} from "../seatModel";

describe("normalizeSeatName", () => {
  it("collapses every production spelling onto one canonical form", () => {
    expect(normalizeSeatName("Drums ")).toBe("Drums");
    expect(normalizeSeatName("BASS")).toBe("Bass");
    expect(normalizeSeatName("bass")).toBe("Bass");
    expect(normalizeSeatName("  eg ")).toBe("EG");
    expect(normalizeSeatName("Keys")).toBe("Keys");
  });

  it("trims and collapses whitespace in an unknown seat, keeping the admin's casing", () => {
    // A new seat is allowed; a second SPELLING of an existing one is not.
    expect(normalizeSeatName("  Violín   Eléctrico ")).toBe("Violín Eléctrico");
  });

  it("returns an empty string for junk input instead of throwing", () => {
    expect(normalizeSeatName(undefined)).toBe("");
    expect(normalizeSeatName(null)).toBe("");
    expect(normalizeSeatName("   ")).toBe("");
  });
});

describe("seat definitions", () => {
  it("gives the three voice seats the voz pool and no hard cap", () => {
    expect(VOICE_SEATS.map((s) => s.id)).toEqual(["lead", "bgv", "coro"]);
    for (const seat of VOICE_SEATS) {
      expect(seat.category).toBe("voz");
      expect(seat.memberType).toBe("voz");
      // Unbounded pending the soft maximum (spec §12 open item).
      expect(seat.max).toBeNull();
    }
  });

  it("never caps an instrument seat — two drummers on one Drums seat is real", () => {
    const bass = instrumentSeatDef("BASS");
    // `max: null` is deliberate — the team runs two drummers on one Drums seat.
    expect(bass).toMatchObject({ label: "Bass", category: "instrumento", max: null, memberType: "instrumento" });
    expect(bass.id).toBe("instrumento:Bass");
  });

  it("never caps a FOH seat either", () => {
    expect(fohSeatDef("Console")).toMatchObject({
      id: "foh:Console", label: "Console", category: "foh", max: null, memberType: "foh",
    });
  });

  it("seeds the picklists from what production actually uses", () => {
    expect(DEFAULT_INSTRUMENT_SEATS).toEqual(["Bass", "Keys", "Drums", "EG", "AG"]);
    expect(DEFAULT_FOH_SEATS).toEqual(["Console"]);
  });
});

// `SEAT_MEMBER_TYPE` restates what every `SeatDef` already carries, so that the
// grid — which holds a `GridRow` with a category, not a `SeatDef` — can ask the
// same question the picker asks. Restating a fact is how two answers drift
// apart, which is what ADR-0029 is about, so the equality is pinned rather than
// left true by inspection.
describe("SEAT_MEMBER_TYPE agrees with every SeatDef", () => {
  it("matches the three voice seats", () => {
    for (const def of VOICE_SEATS) {
      expect(SEAT_MEMBER_TYPE[def.category], def.id).toBe(def.memberType);
    }
  });

  it("matches every default instrument and FOH seat", () => {
    for (const name of DEFAULT_INSTRUMENT_SEATS) {
      const def = instrumentSeatDef(name);
      expect(SEAT_MEMBER_TYPE[def.category], def.id).toBe(def.memberType);
    }
    for (const name of DEFAULT_FOH_SEATS) {
      const def = fohSeatDef(name);
      expect(SEAT_MEMBER_TYPE[def.category], def.id).toBe(def.memberType);
    }
  });

  it("matches a NEW seat too — the list is closed against duplicates, not growth", () => {
    const def = instrumentSeatDef("Cajón");
    expect(SEAT_MEMBER_TYPE[def.category]).toBe(def.memberType);
  });
});

describe("occupantFitsSeat", () => {
  it("accepts a member carrying the seat's Tipo", () => {
    expect(occupantFitsSeat({ memberType: ["voz"] }, "voz")).toBe(true);
    expect(occupantFitsSeat({ memberType: ["voz", "instrumento"] }, "instrumento")).toBe(true);
  });

  it("rejects a Tipo that does not include this seat's", () => {
    expect(occupantFitsSeat({ memberType: ["voz"] }, "instrumento")).toBe(false);
    expect(occupantFitsSeat({ memberType: ["instrumento"] }, "foh")).toBe(false);
  });

  it("rejects an absent or empty Tipo — the state clearing it produces", () => {
    expect(occupantFitsSeat(undefined, "voz")).toBe(false);
    expect(occupantFitsSeat({}, "voz")).toBe(false);
    expect(occupantFitsSeat({ memberType: [] }, "voz")).toBe(false);
  });

  it("does not treat a lead SUBTYPE as a seat Tipo", () => {
    // `sunday_lead` is a solver-pool subtype, not a seat requirement: the Lead
    // seat asks for `voz`, exactly as `rankCandidates` does.
    expect(occupantFitsSeat({ memberType: ["sunday_lead"] }, "voz")).toBe(false);
  });
});
