// "Unsaved changes" in the stored month editor, and the phantom that would not
// clear.
//
// `buildStoredGridRows` stamps `writeLabel` on every row it rebuilds from a
// stored document; `PlannerGrid`'s add-instrument / add-FOH buttons mint
// `{ id, label, category, target }` without one. The dirty check was
// `JSON.stringify(rows) !== JSON.stringify(initialStoredRows)`, so the moment
// an added seat row was SAVED and reloaded the two shapes differed by that one
// key forever: the editor insisted there was unsaved work that was in fact
// stored, disabling «+ Nuevo servicio» and both swap controls and raising a
// prompt reading "descarta 0 servicios". Recovery was close-and-reopen.

import { describe, expect, it } from "vitest";

import { storedRowsDiffer } from "../storedRoleReadModel";
import type { StoredGridRow } from "../storedRoleReadModel";

const localRow = (id: string, label: string): StoredGridRow =>
  ({ id, label, category: "instrumento", target: 1 });

/** What the same row looks like after a save + reload. */
const reloadedRow = (id: string, label: string): StoredGridRow =>
  ({ id, label, writeLabel: label, category: "instrumento", target: 1 });

describe("storedRowsDiffer", () => {
  it("does NOT report a difference for a row that only gained writeLabel on reload", () => {
    // The bug: this is the same row, saved and read back.
    expect(storedRowsDiffer([localRow("instrumento:Cajón", "Cajón")], [reloadedRow("instrumento:Cajón", "Cajón")]))
      .toBe(false);
  });

  it("still reports an added row", () => {
    expect(storedRowsDiffer(
      [reloadedRow("instrumento:Bass", "Bass"), localRow("instrumento:Cajón", "Cajón")],
      [reloadedRow("instrumento:Bass", "Bass")],
    )).toBe(true);
  });

  it("still reports a removed row", () => {
    expect(storedRowsDiffer(
      [reloadedRow("instrumento:Bass", "Bass")],
      [reloadedRow("instrumento:Bass", "Bass"), reloadedRow("instrumento:Cajón", "Cajón")],
    )).toBe(true);
  });

  it("still reports a relabelled row", () => {
    expect(storedRowsDiffer(
      [localRow("instrumento:Bass", "Bajo")],
      [reloadedRow("instrumento:Bass", "Bass")],
    )).toBe(true);
  });

  it("still reports a reordered row — position is the write order", () => {
    const a = reloadedRow("instrumento:Bass", "Bass");
    const b = reloadedRow("instrumento:Keys", "Keys");
    expect(storedRowsDiffer([a, b], [b, a])).toBe(true);
  });

  it("still reports a changed target", () => {
    expect(storedRowsDiffer(
      [{ ...reloadedRow("instrumento:Bass", "Bass"), target: 2 }],
      [reloadedRow("instrumento:Bass", "Bass")],
    )).toBe(true);
  });

  it("says two empty lists are the same", () => {
    expect(storedRowsDiffer([], [])).toBe(false);
  });
});
