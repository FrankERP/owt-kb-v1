import { describe, expect, it } from "vitest";
import { seatIconKind } from "../SeatIcon";

describe("seatIconKind", () => {
  it("gives every voice the microphone", () => {
    for (const seat of ["Lead", "BGV", "BGVs", "Coro"]) expect(seatIconKind(seat)).toBe("mic");
  });

  it("gives each instrument its own glyph, the three string seats one guitar", () => {
    expect(seatIconKind("Keys")).toBe("keys");
    expect(seatIconKind("Drums")).toBe("drum");
    for (const seat of ["EG", "AG", "Bass"]) expect(seatIconKind(seat)).toBe("guitar");
    expect(seatIconKind("Console")).toBe("sliders");
  });

  it("reads a seat through the one normalizer, so spelling and case do not matter", () => {
    expect(seatIconKind("  keys ")).toBe("keys");
    expect(seatIconKind("eg")).toBe("guitar");
  });

  it("falls back to the section for a seat the list does not know, and to the note outside one", () => {
    expect(seatIconKind("Audio", "cabina")).toBe("sliders");
    expect(seatIconKind("Pantallas", "cabina")).toBe("sliders");
    expect(seatIconKind("Solista", "voces")).toBe("mic");
    expect(seatIconKind("Saxofón", "banda")).toBe("note");
    expect(seatIconKind("Saxofón")).toBe("note");
  });
});
