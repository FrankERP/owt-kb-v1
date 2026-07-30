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

  it("makes an instrument seat single-occupant and instrumento-only", () => {
    const bass = instrumentSeatDef("BASS");
    expect(bass).toMatchObject({ label: "Bass", category: "instrumento", max: 1, memberType: "instrumento" });
    expect(bass.id).toBe("instrumento:Bass");
  });

  it("makes a FOH seat single-occupant and foh-only", () => {
    expect(fohSeatDef("Console")).toMatchObject({
      id: "foh:Console", label: "Console", category: "foh", max: 1, memberType: "foh",
    });
  });

  it("seeds the picklists from what production actually uses", () => {
    expect(DEFAULT_INSTRUMENT_SEATS).toEqual(["Bass", "Keys", "Drums", "EG", "AG"]);
    expect(DEFAULT_FOH_SEATS).toEqual(["Console"]);
  });
});
