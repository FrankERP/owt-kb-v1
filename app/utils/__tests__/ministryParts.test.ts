import { describe, expect, it } from "vitest";
import {
  MEETING_PARTS,
  MUSIC_WORDS,
  PART_ASK,
  PART_IDS,
  PART_LIMITS,
  hasFixedProgram,
  isPartMusic,
  musicChip,
  partSpec,
} from "../ministryParts";

describe("ministryParts — the one definition of a part", () => {
  it("lists the four stored parts in the order the meeting runs them", () => {
    expect(MEETING_PARTS.map((p) => p.id)).toEqual(["oracion", "dinamica1", "dinamica2", "platica"]);
    expect(MEETING_PARTS.map((p) => p.label)).toEqual(["Oración", "Dinámica 1", "Dinámica 2", "Plática"]);
  });

  it("says who holds what: one for the prayer, two per dynamic, none stored on the talk", () => {
    expect(partSpec("oracion")).toMatchObject({ people: 1, music: true, helpers: false });
    expect(partSpec("dinamica1")).toMatchObject({ people: 2, music: false, helpers: true });
    expect(partSpec("dinamica2")).toMatchObject({ people: 2, music: false, helpers: true });
    // Plática's people are the `comparte` seats, never a second copy on the line.
    expect(partSpec("platica")).toMatchObject({ people: 0, music: true, helpers: false });
  });

  it("looks a part up by OWN key only", () => {
    for (const bad of ["constructor", "toString", "__proto__", "alabanza", "", "Oracion", null, undefined, 3, {}]) {
      expect(partSpec(bad)).toBeNull();
    }
  });

  it("knows the two music answers and nothing else", () => {
    expect(isPartMusic("track")).toBe(true);
    expect(isPartMusic("alabanza")).toBe(true);
    for (const bad of ["", "Track", "none", null, undefined, 1]) expect(isPartMusic(bad)).toBe(false);
  });

  it("gives a chip only to a part that takes music", () => {
    expect(musicChip("oracion", "alabanza")).toBe(MUSIC_WORDS.oracion.alabanza.chip);
    expect(musicChip("platica", "track")).toBe(MUSIC_WORDS.platica.track.chip);
    expect(musicChip("dinamica1", "track")).toBeNull();
    expect(musicChip("oracion", null)).toBeNull();
    expect(musicChip("oracion", "radio")).toBeNull();
  });

  it("asks every part for something, and keeps Frank's 300", () => {
    for (const id of PART_IDS) expect(PART_ASK[id].length).toBeGreaterThan(20);
    expect(PART_LIMITS).toEqual({ helpers: 120, note: 300 });
  });

  it("shows the five steps, filled or not, on the Saturday meeting only", () => {
    expect(hasFixedProgram({ kind: "saturday" })).toBe(true);
    expect(hasFixedProgram({ kind: "ministry" })).toBe(false);
    expect(hasFixedProgram({ kind: null })).toBe(false);
  });
});
