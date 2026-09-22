import { describe, expect, it } from "vitest";
import { buildCatalogIndex } from "../setlist-match.mjs";
import { matchFolder, mixKey, parseFolderName, planIngest, renderHash, songNameFromManifest, transposedTone } from "../rehearsal-ingest.mjs";

const manifest = {
  set: { path: "/ssd/Amor sin Condición_144BPM_G Project/x.als", sha1: "aaaa1111" },
  song: { name: "2. AMOR SIN CONDICIÓN", bpm_range: [144, 144] },
  files: [
    { path: "/out/Amor - Full.mp3", kind: "full", target: null },
    { path: "/out/Amor - EG 1 UP.mp3", kind: "up", target: "EG 1", family: "electric", peaks: [0, 255], active: [[1, 2]] },
    { path: "/out/Amor - Keys 2 UP.mp3", kind: "up", target: "Keys 2", family: "keys", peaks: [9, 9], active: [] },
  ],
};
const posts = [
  { _id: "p1", title: "Amor sin condición" },
  { _id: "p2", title: "Amor sin condición (Unconditional)" },
  { _id: "p3", title: "Gracias, Dios" },
];

describe("parseFolderName", () => {
  it("reads title, bpm and tone from the render folder convention", () => {
    expect(parseFolderName("Amor sin Condición_144BPM_G Project")).toEqual({ title: "Amor sin Condición", bpm: 144, tone: "G" });
    expect(parseFolderName("Gracias, Dios_130BPM_Db")).toEqual({ title: "Gracias, Dios", bpm: 130, tone: "Db" });
    expect(parseFolderName("Praise_127BPM_A")).toEqual({ title: "Praise", bpm: 127, tone: "A" });
  });
  it("returns nulls when the suffix is missing", () => {
    expect(parseFolderName("Tomaste mi lugar")).toEqual({ title: "Tomaste mi lugar", bpm: null, tone: null });
  });
});

describe("songNameFromManifest", () => {
  it("strips the set's ordinal prefix", () => {
    expect(songNameFromManifest(manifest)).toBe("AMOR SIN CONDICIÓN");
    expect(songNameFromManifest({ song: { name: "FIEL" } })).toBe("FIEL");
  });
});

describe("mixKey", () => {
  it("is deterministic on set sha1 + file basename only", () => {
    const a = mixKey("aaaa1111", "/out/Amor - EG 1 UP.mp3");
    expect(a).toBe(mixKey("aaaa1111", "/elsewhere/Amor - EG 1 UP.mp3"));
    expect(a).not.toBe(mixKey("bbbb2222", "/out/Amor - EG 1 UP.mp3"));
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("matchFolder", () => {
  const index = buildCatalogIndex(posts);
  it("matches an unambiguous title from the folder name", () => {
    expect(matchFolder({ folderName: "Gracias, Dios_130BPM_Db", manifest: { song: { name: "3. GRACIAS DIOS" } }, index, overrides: {} }))
      .toEqual({ postId: "p3" });
  });
  it("reports candidates when the folder AND the manifest name are ambiguous", () => {
    const r = matchFolder({ folderName: "Amor sin Condición_144BPM_G Project", manifest, index, overrides: {} });
    expect(r.unmatched.reason).toBe("ambiguous");
    expect(r.unmatched.candidates).toEqual(["p1", "p2"]);
  });
  it("an override wins outright", () => {
    expect(matchFolder({ folderName: "Amor sin Condición_144BPM_G Project", manifest, index, overrides: { "Amor sin Condición_144BPM_G Project": "p1" } }))
      .toEqual({ postId: "p1" });
  });
  it("reports no-match when nothing resolves", () => {
    const r = matchFolder({ folderName: "Canción Nueva_90BPM_C", manifest: { song: { name: "1. CANCIÓN NUEVA" } }, index, overrides: {} });
    expect(r.unmatched.reason).toBe("no-match");
  });
});

describe("planIngest", () => {
  const folderName = "Amor sin Condición_144BPM_G Project";
  const post = { _id: "p1", key: "A" };

  it("plans one item per file with deterministic keys, tone from the folder, bpm from the manifest", () => {
    const plan = planIngest({ manifest, folderName, post, existing: [] });
    expect(plan.items).toHaveLength(3);
    expect(plan.uploads).toHaveLength(3);
    const eg = plan.items.find((i) => i.track === "EG 1");
    expect(eg).toMatchObject({ _type: "rehearsalMix", kind: "up", family: "electric", tone: "G", bpm: 144, peaks: [0, 255], active: [{ _key: "0", s: 1, e: 2 }], sourceHash: "aaaa1111" });
    expect(eg._key).toBe(mixKey("aaaa1111", "Amor - EG 1 UP.mp3"));
    expect(eg.audioFile).toEqual({ _type: "file", asset: { _type: "reference", uploadIndex: 1 } });
    const full = plan.items.find((i) => i.kind === "full");
    expect(full.track).toBeUndefined(); expect(full.peaks).toBeUndefined();
    expect(plan.uploads[1]).toEqual({ path: "/out/Amor - EG 1 UP.mp3", filename: "Amor - EG 1 UP.mp3", uploadIndex: 1 });
  });

  it("falls back to the post's key when the folder has no tone", () => {
    const plan = planIngest({ manifest, folderName: "Amor sin Condición", post, existing: [] });
    expect(plan.items[0].tone).toBe("A");
  });

  it("skips the upload when the same key already holds an asset with the same sha1", () => {
    const key = mixKey("aaaa1111", "Amor - EG 1 UP.mp3");
    const existing = [{ _key: key, sourceHash: "aaaa1111", assetId: "file-abc-mp3", sha1: "SHA_EG1" }];
    const plan = planIngest({ manifest, folderName, post, existing, localSha1: { "/out/Amor - EG 1 UP.mp3": "SHA_EG1" } });
    expect(plan.skipped).toEqual([key]);
    expect(plan.uploads.map((u) => u.filename)).toEqual(["Amor - Full.mp3", "Amor - Keys 2 UP.mp3"]);
    const eg = plan.items.find((i) => i._key === key);
    expect(eg.audioFile).toEqual({ _type: "file", asset: { _type: "reference", _ref: "file-abc-mp3" } });
    expect(plan.replaced).toEqual([]);
  });

  it("replaces a changed file under the same key and lists its old asset for deletion", () => {
    const key = mixKey("aaaa1111", "Amor - EG 1 UP.mp3");
    const existing = [{ _key: key, sourceHash: "aaaa1111", assetId: "file-old-mp3", sha1: "OLD" }];
    const plan = planIngest({ manifest, folderName, post, existing, localSha1: { "/out/Amor - EG 1 UP.mp3": "NEW" } });
    expect(plan.replaced).toEqual(["file-old-mp3"]);
    expect(plan.uploads.map((u) => u.filename)).toContain("Amor - EG 1 UP.mp3");
  });

  it("keeps items from OTHER renders (another sourceHash) untouched, and drops stale items of THIS render", () => {
    const stale = mixKey("aaaa1111", "Amor - Bass UP.mp3");
    const existing = [
      { _key: "otherkey", sourceHash: "zzzz9999", assetId: "file-z-mp3", sha1: "Z" },
      { _key: stale, sourceHash: "aaaa1111", assetId: "file-stale-mp3", sha1: "S" },
    ];
    const plan = planIngest({ manifest, folderName, post, existing, existingItems: { otherkey: { _key: "otherkey", kind: "up", track: "X", sourceHash: "zzzz9999" } } });
    expect(plan.kept).toEqual(["otherkey"]);
    expect(plan.items.some((i) => i._key === "otherkey")).toBe(true);
    expect(plan.items.some((i) => i._key === stale)).toBe(false);
    expect(plan.replaced).toEqual(["file-stale-mp3"]);
  });

  it("a transposed render of the same set is ANOTHER render: it keeps the untransposed items and hashes apart", () => {
    const transposed = { ...manifest, transpose: { semitones: -1, suffix: "-1" },
      files: manifest.files.map((f) => ({ ...f, path: f.path.replace("Amor -", "Amor -1 -") })) };
    const original = mixKey("aaaa1111", "Amor - Full.mp3");
    const existing = [{ _key: original, sourceHash: "aaaa1111", assetId: "file-orig-mp3", sha1: "O" }];
    const plan = planIngest({ manifest: transposed, folderName: "Amor sin Condición_144BPM_Gb", post, existing,
      existingItems: { [original]: { _key: original, kind: "full", tone: "G", sourceHash: "aaaa1111" } } });
    expect(renderHash(transposed)).toBe("aaaa1111:-1");
    expect(renderHash(manifest)).toBe("aaaa1111");
    expect(plan.kept).toEqual([original]);
    expect(plan.replaced).toEqual([]);
    const mine = plan.items.filter((i) => i.sourceHash === "aaaa1111:-1");
    expect(mine).toHaveLength(3);
    expect(mine.every((i) => i.tone === "Gb")).toBe(true);
    expect(new Set(plan.items.map((i) => i._key)).size).toBe(4);
  });

  describe("transposed renders", () => {
    const tp = (semitones, setPath = "/ssd/x/Amor sin Condición_144BPM_G.als") => ({ ...manifest, set: { ...manifest.set, path: setPath }, transpose: { semitones } });

    it("derives the sounding key from the set file name and the semitones, and accepts a folder that agrees", () => {
      expect(transposedTone(tp(-1), "Gb")).toBe("Gb");
      expect(transposedTone(tp(-1), "F#")).toBe("F#");
      expect(transposedTone(tp(2), null)).toBe("A");
      expect(transposedTone(tp(0), "G")).toBe("G");
      expect(transposedTone(tp(-1, "/ssd/x/Amor_144BPM_Gm.als"), null)).toBe("Gbm");
    });

    it("refuses a folder still named for the SOURCE key — rows would be a semitone off", () => {
      expect(() => transposedTone(tp(-1), "G")).toThrow(/set is in G -1 → Gb, but the folder says G/);
      expect(() => planIngest({ manifest: tp(1), folderName: "Amor sin Condición_144BPM_G", post })).toThrow(/folder says G/);
    });

    it("refuses a malformed semitones value instead of hashing as the untransposed render", () => {
      expect(() => renderHash({ ...manifest, transpose: { semitones: "x" } })).toThrow(/not an integer/);
      expect(() => renderHash({ ...manifest, transpose: { semitones: 0.5 } })).toThrow(/not an integer/);
      expect(renderHash({ ...manifest, transpose: {} })).toBe("aaaa1111");
    });

    it("stores the sounding key on every row of a transposed render", () => {
      const plan = planIngest({ manifest: tp(-1), folderName: "Amor sin Condición_144BPM_Gb", post });
      expect(plan.items.every((i) => i.tone === "Gb" && i.sourceHash === "aaaa1111:-1")).toBe(true);
    });
  });
});
