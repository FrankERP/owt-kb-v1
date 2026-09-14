// The header line's model (R3, spec §12.4). Two rules worth pinning: the seat
// order (the same string reaches the header and the .ics body) and that the
// EARLIEST assignment wins regardless of the caller's order.
import { describe, it, expect } from "vitest";
import { nextSeatLine, seatLabel, type SeatAssignment } from "../myWeek";

const at = (dateKey: string, day = "Domingo", seat = ""): SeatAssignment => ({ dateKey, day, seat });

describe("seatLabel", () => {
  it("orders the seats Lead · instrumento · FOH · BGV · Coro", () => {
    expect(
      seatLabel({ isLead: true, myInstrument: "Piano", myFohRole: "Audio", isBGV: true, isChorus: true }),
    ).toBe("Lead · Piano · FOH: Audio · BGV · Coro");
  });

  it("names a single seat on its own", () => {
    expect(seatLabel({ isLead: true })).toBe("Lead");
    expect(seatLabel({ myInstrument: "Batería" })).toBe("Batería");
    expect(seatLabel({ myFohRole: "Video" })).toBe("FOH: Video");
    expect(seatLabel({ isChorus: true })).toBe("Coro");
  });

  it("is empty when the projection carries no seat flag", () => {
    expect(seatLabel({})).toBe("");
  });
});

describe("nextSeatLine", () => {
  it("returns the earliest assignment, whatever order it arrives in", () => {
    const next = nextSeatLine([
      at("2026-09-26", "Sábado", "BGV"),
      at("2026-09-13", "Domingo", "Lead"),
      at("2026-10-04"),
    ]);
    expect(next).toEqual(at("2026-09-13", "Domingo", "Lead"));
  });

  it("keeps a special service's own name as the day", () => {
    expect(nextSeatLine([at("2026-12-24", "Noche de Navidad", "Lead")])?.day).toBe("Noche de Navidad");
  });

  it("is null for a member with nothing assigned", () => {
    expect(nextSeatLine([])).toBeNull();
  });

  it("ignores a row with no usable date, exactly as the page does", () => {
    expect(nextSeatLine([at(""), at("2026-09-13")])).toEqual(at("2026-09-13"));
    expect(nextSeatLine([at("")])).toBeNull();
  });
});
