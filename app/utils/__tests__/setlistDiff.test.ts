// app/utils/__tests__/setlistDiff.test.ts
import { describe, expect, it } from "vitest";
import { buildSetlistTable } from "../setlistDiff";

const row = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

describe("buildSetlistTable", () => {
  it("marks every row, using a dash where nothing moved", () => {
    // A blank cell reads as "not computed"; the dash reads as "computed,
    // unchanged" — that is what makes it scan as a standings table.
    const t = buildSetlistTable([row("a", "G"), row("b", "D")], [row("a", "G"), row("b", "D")]);
    expect(t.map((r) => r.movement?.dir)).toEqual(["same", "same"]);
  });

  it("uses absolute position deltas", () => {
    // Moving the 4th to the front lifts the other three by one. That is literally
    // true — they are played one slot earlier.
    const before = [row("a", "G"), row("b", "D"), row("c", "D"), row("d", "A")];
    const after = [row("d", "A"), row("a", "G"), row("b", "D"), row("c", "D")];
    expect(buildSetlistTable(before, after).map((r) => `${r.movement?.dir}${r.movement?.n}`))
      .toEqual(["up3", "down1", "down1", "down1"]);
  });

  it("flags a new song and lists a departed one last", () => {
    const t = buildSetlistTable([row("a", "G"), row("b", "D")], [row("a", "G"), row("c", "E")]);
    expect(t.find((r) => r.ref === "c")?.status).toBe("new");
    const gone = t[t.length - 1];
    expect(gone.ref).toBe("b");
    expect(gone.status).toBe("gone");
    expect(gone.position).toBeNull();
  });

  it("carries the old key when a song is re-keyed", () => {
    const t = buildSetlistTable([row("a", "E")], [row("a", "G")]);
    expect(t[0].previousKey).toBe("E");
  });

  it("marks only a genuinely new group as new", () => {
    const before = [row("a", "G"), row("b", "D"), row("c", "D")];
    const after = [row("a", "G"), row("b", "D", 0), row("c", "D", 0)];
    const t = buildSetlistTable(before, after);
    expect(t.filter((r) => r.groupIsNew).map((r) => r.ref)).toEqual(["b", "c"]);
  });

  it("does not re-flag a group that already existed", () => {
    const g = [row("a", "G"), row("b", "D", 0), row("c", "D", 0)];
    expect(buildSetlistTable(g, g).some((r) => r.groupIsNew)).toBe(false);
  });

  it("has no movement column for a first setlist", () => {
    expect(buildSetlistTable([], [row("a", "G")]).every((r) => r.movement === null)).toBe(true);
  });

  it("shows the tail lifting when a song is removed", () => {
    const before = [row("a", "G"), row("b", "D"), row("c", "E")];
    const after = [row("a", "G"), row("c", "E")];
    const t = buildSetlistTable(before, after);
    expect(t[0].movement).toEqual({ dir: "same", n: 0 });
    expect(t[1].movement).toEqual({ dir: "up", n: 1 });
    expect(t[2].status).toBe("gone");
  });
});
