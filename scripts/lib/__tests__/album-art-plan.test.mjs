import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ASSET_ID, albumArtListProblem, planAlbumArt } from "../album-art-plan.mjs";

const asset = (n, size = "568x568") => `image-${String(n).padStart(40, "0")}-${size}-jpg`;
const A = asset(1);
const B = asset(2);
const C = asset(3);
const doc = (id, current = null) => ({ _id: id, _rev: `rev-${id}`, title: `Song ${id}`, current });
const plan = (targets, docs, { drafts = [], assets = [A, B, C] } = {}) =>
  planAlbumArt({ targets, docs, draftIds: drafts, assetIds: assets });

describe("albumArtListProblem", () => {
  it("accepts a plain row and a row that names the cover it replaces", () => {
    expect(albumArtListProblem([{ id: "s1", asset: A }, { id: "s2", asset: B, replaces: A }])).toBeNull();
  });
  it("refuses an empty list, a draft id, a non-image asset and a duplicate song", () => {
    expect(albumArtListProblem([])).toMatch(/non-empty/);
    expect(albumArtListProblem([{ id: "drafts.s1", asset: A }])).toMatch(/bad row/);
    expect(albumArtListProblem([{ id: "s1", asset: "file-abc-pdf" }])).toMatch(/bad row/);
    expect(albumArtListProblem([{ id: "s1", asset: A }, { id: "s1", asset: B }])).toMatch(/listed twice/);
  });
  it("refuses a `replaces` that is not another image asset", () => {
    expect(albumArtListProblem([{ id: "s1", asset: A, replaces: A }])).toMatch(/replaces/);
    expect(albumArtListProblem([{ id: "s1", asset: A, replaces: "yes" }])).toMatch(/replaces/);
    expect(albumArtListProblem([{ id: "s1", asset: A, replaces: null }])).toMatch(/replaces/);
  });
});

describe("planAlbumArt", () => {
  it("gives a cover to a song that has none, remembering there was nothing before", () => {
    const { writes, count } = plan([{ id: "s1", asset: A }], [doc("s1")]);
    expect(writes).toEqual([{ id: "s1", asset: A, title: "Song s1", _rev: "rev-s1", previous: null }]);
    expect(count).toMatchObject({ add: 1, swap: 0 });
  });

  it("swaps a cover ONLY when the row names the asset the song has now", () => {
    const { writes, count } = plan([{ id: "s1", asset: B, replaces: A }], [doc("s1", A)]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: "s1", asset: B, previous: A, _rev: "rev-s1" });
    expect(count).toMatchObject({ add: 0, swap: 1 });
  });

  it("leaves a cover somebody else chose: a different asset, or no `replaces` at all", () => {
    const other = plan([{ id: "s1", asset: B, replaces: A }], [doc("s1", C)]);
    expect(other.writes).toEqual([]);
    expect(other.count.kept).toBe(1);
    expect(other.skipped).toEqual([{ id: "s1", name: "Song s1", why: "kept", current: C }]);

    const plain = plan([{ id: "s1", asset: B }], [doc("s1", A)]);
    expect(plain.writes).toEqual([]);
    expect(plain.count.kept).toBe(1);
  });

  it("is a no-op on a song already on its listed cover, so a re-run writes only what is left", () => {
    const { writes, skipped, count } = plan(
      [{ id: "s1", asset: B, replaces: A }, { id: "s2", asset: B, replaces: A }],
      [doc("s1", B), doc("s2", A)],
    );
    expect(writes.map((w) => w.id)).toEqual(["s2"]);
    expect(skipped).toEqual([]);
    expect(count).toMatchObject({ same: 1, swap: 1 });
  });

  it("skips a missing song, a song with an open draft and a row whose image does not exist", () => {
    const { writes, skipped, count } = plan(
      [{ id: "gone", asset: A, title: "Gone" }, { id: "s2", asset: A }, { id: "s3", asset: B, replaces: A }],
      [doc("s2"), doc("s3", A)],
      { drafts: ["drafts.s2"], assets: [A] },
    );
    expect(writes).toEqual([]);
    expect(skipped.map((s) => [s.id, s.why])).toEqual([["gone", "missing"], ["s2", "draft"], ["s3", "asset"]]);
    expect(skipped[0].name).toBe("Gone");
    expect(count).toMatchObject({ missing: 1, draft: 1, asset: 1, add: 0, swap: 0 });
  });

  it("does not count an open draft against a song that needs no write", () => {
    const { count } = plan([{ id: "s1", asset: A }], [doc("s1", A)], { drafts: ["drafts.s1"] });
    expect(count).toMatchObject({ same: 1, draft: 0 });
  });
});

describe("the committed list (scripts/data/album-art-2026-11-12.json)", () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "album-art-2026-11-12.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));

  it("is well formed", () => {
    expect(albumArtListProblem(rows)).toBeNull();
  });

  it("says where each cover came from, and only a MultiTracks row replaces an earlier cover", () => {
    for (const r of rows) {
      expect(r.source, r.title).toMatch(/^(multitracks:\d+|deezer)$/);
      expect(ASSET_ID.test(r.asset), r.title).toBe(true);
      if (r.source === "deezer") expect(r.replaces, r.title).toBeUndefined();
    }
  });

  it("gives every song of one MultiTracks album the same image", () => {
    const bySource = new Map();
    for (const r of rows.filter((x) => x.source !== "deezer")) {
      if (!bySource.has(r.source)) bySource.set(r.source, r.asset);
      expect(r.asset, r.title).toBe(bySource.get(r.source));
    }
  });
});
