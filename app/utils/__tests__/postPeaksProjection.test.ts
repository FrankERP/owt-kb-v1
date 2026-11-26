// `rehearsalMixes[].peaks` is 600 numbers per mix, ~25 KB per song. Only the
// two SINGLE-SONG reads may project it; a list read that did would ship
// 142 × 25 KB of numbers nobody renders (spec 2026-09-20-rehearsal-mixes §6).
// The native app's module holds a list read AND a single-song read in one file, so it is
// judged query by query below instead of by file.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_MIX_AUDIO_QUERY, APP_SONG_QUERY, APP_SONGS_QUERY } from "../appSongs";

const ALLOWED = new Set(["app/api/song/[id]/route.ts", "app/(client)/posts/[slug]/page.tsx"]);
const APP_MODULE = "app/utils/appSongs.ts";

describe("post GROQ reads", () => {
  const files = execSync('git ls-files "app/**/*.ts" "app/**/*.tsx" "sanity/**/*.ts"', { encoding: "utf8" })
    .split("\n").filter((f) => f && !f.includes("__tests__"));
  const postReaders = files.filter((f) => /_type\s*==\s*"post"/.test(readFileSync(f, "utf8")));

  it("finds the readers this guard is about", () => {
    expect(postReaders).toEqual(expect.arrayContaining([...ALLOWED]));
  });

  it("projects peaks only in the two single-song reads", () => {
    const offenders = postReaders.filter((f) => !ALLOWED.has(f) && f !== APP_MODULE && /\bpeaks\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the app's list read projects no mixes; its single-song read projects peaks and no address", () => {
    expect(postReaders).toContain(APP_MODULE);
    expect(APP_SONGS_QUERY).not.toMatch(/peaks|rehearsalMixes/);
    const match = APP_SONG_QUERY.match(/rehearsalMixes\[\]\s*\{[^}]*\}/);
    expect(match).toBeTruthy();
    expect(match![0]).toMatch(/\bpeaks\b/);
    expect(match![0]).not.toMatch(/asset->url/);
    expect(APP_SONG_QUERY.match(/asset->url/g)).toEqual(["asset->url"]); // one asset address: the cover's
    expect(APP_SONG_QUERY).toContain("albumArt.asset->url");
    // The address is read by ONE query, for one mix, behind the guard of its own route.
    expect(APP_MIX_AUDIO_QUERY).toMatch(/rehearsalMixes\[_key == \$key\]\[0\]\.audioFile\.asset->url/);
    expect(APP_MIX_AUDIO_QUERY).not.toMatch(/peaks/);
  });

  it("both single-song reads project the mixes with peaks and active", () => {
    for (const f of ALLOWED) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/rehearsalMixes\[\]\s*\{[^}]*peaks[^}]*active[^}]*\}/);
    }
  });

  it("neither single-song read ships the raw CDN URL to the client (decision D2 — every URL is the session-gated /api/audio/… route)", () => {
    for (const f of ALLOWED) {
      const src = readFileSync(f, "utf8");
      const match = src.match(/rehearsalMixes\[\]\s*\{[^}]*\}/);
      expect(match).toBeTruthy();
      expect(match![0]).not.toMatch(/asset->url/);
    }
  });
});
