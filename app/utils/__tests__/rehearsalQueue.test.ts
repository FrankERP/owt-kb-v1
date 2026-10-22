import { describe, expect, it } from "vitest";
import { buildRehearsalQueue, pickQueueMix, type QueueMix } from "../rehearsalQueue";

const full = (tone: string): QueueMix => ({ _key: `full-${tone}`, kind: "full", tone });
const up = (tone: string, family: string, track: string): QueueMix => ({ _key: `${family}-${track}-${tone}`, kind: "up", tone, family, track });

describe("pickQueueMix", () => {
  const mixes = [full("A"), full("Bb"), up("Bb", "electric", "EG 2"), up("Bb", "electric", "EG 1"), up("Bb", "keys", "Piano"), full("Ab")];

  it("plays the set's key, or the nearest rendered one (B → Bb)", () => {
    expect(pickQueueMix(mixes, "A", null)?._key).toBe("full-A");
    expect(pickQueueMix(mixes, "B", null)?._key).toBe("full-Bb");
  });

  it("matches the key enharmonically (A# answers a Bb render)", () => {
    expect(pickQueueMix(mixes, "A#", null)?._key).toBe("full-Bb");
  });

  it("picks the family's FIRST track in collation order, and falls back to the full band", () => {
    expect(pickQueueMix(mixes, "Bb", "electric")?._key).toBe("electric-EG 1-Bb");
    expect(pickQueueMix(mixes, "A", "electric")?._key).toBe("full-A");
    expect(pickQueueMix(mixes, "Bb", "drums")?._key).toBe("full-Bb");
  });

  it("with no full-band render in that key, takes the key's first mix", () => {
    expect(pickQueueMix([up("D", "keys", "Piano")], "D", null)?._key).toBe("keys-Piano-D");
  });

  it("returns null for a song with no mixes", () => {
    expect(pickQueueMix([], "D", null)).toBeNull();
  });
});

describe("buildRehearsalQueue", () => {
  const songs = [
    { _id: "a", title: "Nadie", slug: { current: "nadie" }, play_key: "D" },
    { _id: "b", title: "Lavado", slug: { current: "lavado" }, play_key: "B" },
    { _id: "c", title: "Cruz", slug: null, play_key: "", key: "F" },
  ];

  it("keeps setlist order, routes every URL through /api/audio, and names the skipped songs", () => {
    const { tracks, skipped } = buildRehearsalQueue(songs, { a: [full("D")], c: [full("F"), full("E")] }, null);
    expect(tracks).toEqual([
      { url: "/api/audio/a/full-D", title: "Banda completa", tone: "D", songTitle: "Nadie", songSlug: "nadie" },
      { url: "/api/audio/c/full-F", title: "Banda completa", tone: "F", songTitle: "Cruz", songSlug: "" },
    ]);
    expect(skipped).toEqual(["Lavado"]);
  });

  it("labels an instrument mix by its track name", () => {
    const { tracks } = buildRehearsalQueue([songs[0]], { a: [full("D"), up("D", "keys", "Piano")] }, "keys");
    expect(tracks[0].title).toBe("Piano");
  });
});
