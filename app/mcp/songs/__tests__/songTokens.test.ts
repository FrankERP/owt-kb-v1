// The song tools' two HMACs (admin parity phase 3, S3, D5/D6): what each binds, the create token's
// age, and the deterministic id a retry reuses.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  CREATE_TOKEN_TTL_S,
  checkSongCreateToken,
  sameSongEditsToken,
  songCreateId,
  songCreateToken,
  songEditsToken,
} = await import("../songTokens");

const KEY = new TextEncoder().encode("k".repeat(48));
const OTHER = new TextEncoder().encode("o".repeat(48));
const EDITS = [{ op: "set", field: "key", value: "A" }];
const SONG = { title: "Nueva", key: "G" };
const LINES = ["Tono: G → A"];
const NOW = 1_800_000_000;

describe("the edit token", () => {
  it("binds the song, the revision and the edit list, under its own key", () => {
    const token = songEditsToken(KEY, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sameSongEditsToken(KEY, token, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES })).toBe(true);
    expect(sameSongEditsToken(KEY, token, { songId: "post-2", rev: "rev-1", edits: EDITS, lines: LINES })).toBe(false);
    expect(sameSongEditsToken(KEY, token, { songId: "post-1", rev: "rev-2", edits: EDITS, lines: LINES })).toBe(false);
    expect(sameSongEditsToken(KEY, token, { songId: "post-1", rev: "rev-1", edits: [{ ...EDITS[0], value: "B" }], lines: LINES })).toBe(false);
    expect(sameSongEditsToken(OTHER, token, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES })).toBe(false);
    expect(sameSongEditsToken(KEY, "", { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES })).toBe(false);
  });

  it("binds the rendered result: the same edits resolving differently do not pass", () => {
    const token = songEditsToken(KEY, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES });
    expect(sameSongEditsToken(KEY, token, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: ["Tono: G → Bb"] })).toBe(false);
  });

  it("does not depend on the order of an edit's keys (canonical JSON)", () => {
    const a = songEditsToken(KEY, { songId: "post-1", rev: "rev-1", edits: [{ op: "set", field: "key", value: "A" }], lines: LINES });
    const b = songEditsToken(KEY, { songId: "post-1", rev: "rev-1", edits: [{ value: "A", field: "key", op: "set" }], lines: LINES });
    expect(a).toBe(b);
  });

  it("is never the create token's MAC over the same input (each has its own label)", () => {
    const create = songCreateToken(KEY, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES }, NOW).split(".")[1];
    expect(create).not.toBe(songEditsToken(KEY, { songId: "post-1", rev: "rev-1", edits: EDITS, lines: LINES }));
  });
});

describe("the create token", () => {
  it("binds the song as checked and carries its issue time", () => {
    const token = songCreateToken(KEY, SONG, NOW);
    expect(token.startsWith(`${NOW}.`)).toBe(true);
    const ok = checkSongCreateToken(KEY, token, SONG, NOW + 60);
    expect(ok).toEqual({ ok: true, id: songCreateId(token) });
    expect(checkSongCreateToken(KEY, token, { ...SONG, key: "A" }, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(checkSongCreateToken(OTHER, token, SONG, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("dies after thirty minutes, and refuses one issued in the future", () => {
    const token = songCreateToken(KEY, SONG, NOW);
    expect(checkSongCreateToken(KEY, token, SONG, NOW + CREATE_TOKEN_TTL_S).ok).toBe(true);
    expect(checkSongCreateToken(KEY, token, SONG, NOW + CREATE_TOKEN_TTL_S + 1)).toEqual({ ok: false, reason: "expired" });
    const future = songCreateToken(KEY, SONG, NOW + 600);
    expect(checkSongCreateToken(KEY, future, SONG, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("cannot have its issue time moved: the time is inside the MAC", () => {
    const [, mac] = songCreateToken(KEY, SONG, NOW).split(".");
    expect(checkSongCreateToken(KEY, `${NOW + 1000}.${mac}`, SONG, NOW + 1000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses malformed tokens", () => {
    for (const bad of ["", "abc", `${NOW}`, `${NOW}.`, `x.${"a".repeat(43)}`, `${NOW}.a.b`]) {
      expect(checkSongCreateToken(KEY, bad, SONG, NOW).ok, bad).toBe(false);
    }
  });

  it("names one stable id per token: post-mcp- and 24 hex", () => {
    const token = songCreateToken(KEY, SONG, NOW);
    expect(songCreateId(token)).toMatch(/^post-mcp-[0-9a-f]{24}$/);
    expect(songCreateId(token)).toBe(songCreateId(token));
    expect(songCreateId(songCreateToken(KEY, SONG, NOW + 1))).not.toBe(songCreateId(token));
  });
});
