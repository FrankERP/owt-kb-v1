// app/utils/__tests__/appSongs.test.ts — the native app's Biblioteca and song shapes: the title
// split, the artist line, covers only from Sanity, lyrics and charts as two fields, https links.
import { describe, expect, it } from "vitest";
import { APP_MIX_AUDIO_QUERY, APP_SONG_QUERY, APP_SONGS_QUERY, MIX_BARS, buildAppSong, buildAppSongs, mixAudioUrl } from "../appSongs";

const COVER = "https://cdn.sanity.io/images/p/d/abc-600x600.png";

describe("buildAppSongs", () => {
  it("shapes a row: split title, joined artist, sized covers, numeric bpm, tags", () => {
    const [song] = buildAppSongs([
      {
        _id: "s1", _createdAt: "2026-01-02T03:04:05Z", title: " Cordero y León (Lion and The Lamb) ", author: "Leeland",
        slug: "cordero-y-leon", key: "G", bpm: "90", timeSig: "4/4", cover: COVER,
        authors: ["Leeland", "Bethel Music", null],
        tags: [{ slug: "up-beat", name: "Up beat" }, { slug: null, name: "x" }, null],
      },
    ]);
    expect(song).toEqual({
      id: "s1", slug: "cordero-y-leon", title: "Cordero y León", original: "Lion and The Lamb",
      artist: "Leeland · Bethel Music", key: "G", bpm: 90, timeSig: "4/4",
      cover: `${COVER}?w=160&h=160&fit=crop&fm=jpg`, coverLarge: `${COVER}?w=640&h=640&fit=crop&fm=jpg`,
      tags: [{ slug: "up-beat", name: "Up beat" }], addedAt: "2026-01-02T03:04:05Z",
    });
  });

  it("leaves out a row with no id, slug or title, and survives null input", () => {
    expect(buildAppSongs([null, { _id: "a", title: "T" }, { _id: "b", slug: "b" }, { slug: "c", title: "C" }])).toEqual([]);
    expect(buildAppSongs(null)).toEqual([]);
  });

  it("drops a cover that is not Sanity's and a bpm that is not a number", () => {
    const [song] = buildAppSongs([{ _id: "s", slug: "s", title: "S", cover: "https://example.com/x.jpg", bpm: "rápido" }]);
    expect(song).toMatchObject({ cover: null, coverLarge: null, bpm: null, artist: null, original: null, tags: [] });
  });
});

describe("buildAppSong", () => {
  const base = { _id: "s1", slug: "s", title: "Santo" };

  it("carries the lyric in the editor's plain format, charts as written, and https links once", () => {
    const song = buildAppSong({
      ...base,
      body: [
        { _type: "block", _key: "a", style: "h3", markDefs: [], children: [{ _type: "span", _key: "a1", text: "Coro", marks: [] }] },
        { _type: "block", _key: "b", style: "normal", markDefs: [], children: [{ _type: "span", _key: "b1", text: "Santo, santo", marks: [] }] },
      ],
      chords: [{ key: "G", content: "  [G]Santo [D/F#]santo" }, { key: null, content: "G  D\nSanto" }, { key: "A", content: "   " }, null],
      musicalReferenceUrl: "https://youtu.be/a",
      lyricsVideoUrl: "http://insecure.example/x",
      referenceLinks: [{ label: "Spotify", url: "https://open.spotify.com/x" }, { label: "otra vez", url: "https://youtu.be/a" }, { label: "js", url: "javascript:alert(1)" }],
      tutorials2: [{ title: null, url: "https://youtu.be/t" }],
    });
    expect(song?.lyrics).toBe("# Coro\nSanto, santo");
    expect(song?.charts).toEqual([
      { key: "G", content: "  [G]Santo [D/F#]santo", chordPro: true },
      { key: null, content: "G  D\nSanto", chordPro: false },
    ]);
    expect(song?.links).toEqual([
      { kind: "reference", label: "Referencia musical", url: "https://youtu.be/a" },
      { kind: "reference", label: "Spotify", url: "https://open.spotify.com/x" },
      { kind: "tutorial", label: "Tutorial", url: "https://youtu.be/t" },
    ]);
  });

  it("answers null lyrics, no charts and no links for a bare song; null for no song", () => {
    expect(buildAppSong(base)).toMatchObject({ lyrics: null, charts: [], links: [], mixes: [], preferredFamily: null });
    expect(buildAppSong(null)).toBeNull();
    expect(buildAppSong({ _id: "x" })).toBeNull();
  });
});

describe("buildAppSong — rehearsal mixes", () => {
  const base = { _id: "s1", title: "Santo", slug: "santo" };
  const mix = (over: Record<string, unknown>) => ({ _key: "k", kind: "up", track: "3-Bass", family: "bass", tone: "G", hasAudio: true, ...over });

  it("lists them as the web's player does: full first, families in order, tracks by number, no Ableton number in the label", () => {
    const song = buildAppSong({
      ...base,
      rehearsalMixes: [
        mix({ _key: "d", track: "7-Drums", family: "drums" }),
        mix({ _key: "k2", track: "12-Keys 2", family: "keys" }),
        mix({ _key: "k1", track: "2-Keys 1", family: "keys" }),
        mix({ _key: "f", kind: "full", track: null, family: null }),
        mix({ _key: "x", track: "9-Click", family: null }),
      ],
    });
    expect(song?.mixes.map((m) => [m.key, m.label, m.family, m.familyLabel])).toEqual([
      ["f", "Banda completa", "full", "Banda completa"],
      ["k1", "Keys 1", "keys", "Teclado"],
      ["k2", "Keys 2", "keys", "Teclado"],
      ["d", "Drums", "drums", "Batería"],
      ["x", "Click", "other", "Otros"],
    ]);
  });

  it("leaves out a mix that cannot play, and a repeated key", () => {
    const song = buildAppSong({
      ...base,
      rehearsalMixes: [
        mix({ _key: "a" }),
        mix({ _key: "a", track: "4-Bass 2" }),
        mix({ _key: "b", hasAudio: false }),
        mix({ _key: "c", hasAudio: null }),
        mix({ _key: null }),
        mix({ _key: "e", kind: "down" }),
        null,
      ],
    });
    expect(song?.mixes.map((m) => m.key)).toEqual(["a"]);
  });

  it("reduces the envelope to MIX_BARS heights of 0–100, and carries no address", () => {
    const peaks = Array.from({ length: 600 }, (_, i) => (i < 300 ? 255 : 0));
    const song = buildAppSong({ ...base, rehearsalMixes: [mix({ peaks, audioFile: { url: "https://cdn.sanity.io/x.mp3" } }), mix({ _key: "n", peaks: null, tone: " " })] });
    const [withPeaks, without] = song!.mixes;
    expect(withPeaks.bars).toHaveLength(MIX_BARS);
    expect(withPeaks.bars[0]).toBe(100);
    expect(withPeaks.bars[MIX_BARS - 1]).toBe(0);
    expect(without).toMatchObject({ bars: [], tone: null });
    expect(JSON.stringify(song)).not.toContain("cdn.sanity.io/x.mp3");
  });

  it("names the family of the reader's FIRST instrument, or none", () => {
    expect(buildAppSong({ ...base, instruments: ["EG", "Bass"] })?.preferredFamily).toBe("electric");
    expect(buildAppSong({ ...base, instruments: ["Voz"] })?.preferredFamily).toBeNull();
    expect(buildAppSong({ ...base, instruments: ["toString"] })?.preferredFamily).toBeNull();
    expect(buildAppSong({ ...base, instruments: null })?.preferredFamily).toBeNull();
  });
});

describe("mixAudioUrl", () => {
  it("accepts only an https file on Sanity's CDN", () => {
    expect(mixAudioUrl("https://cdn.sanity.io/files/p/d/abc.mp3")).toBe("https://cdn.sanity.io/files/p/d/abc.mp3");
    for (const bad of [null, undefined, 3, "", "nada", "http://cdn.sanity.io/files/a.mp3", "https://cdn.sanity.io.evil.example/a.mp3", "https://evil.example/cdn.sanity.io/a.mp3", "https://user@evil.example/a.mp3"]) {
      expect(mixAudioUrl(bad)).toBeNull();
    }
  });
});

describe("the queries", () => {
  it("bind the mix's song and key as parameters", () => {
    expect(APP_MIX_AUDIO_QUERY).toContain("slug.current == $slug");
    expect(APP_MIX_AUDIO_QUERY).toContain("_key == $key");
    expect(APP_SONG_QUERY).toContain("_id == $me");
    expect(APP_SONG_QUERY).not.toContain("audioFile.asset->url");
  });


  it("bind the slug as a parameter and read the cover from the song itself", () => {
    expect(APP_SONG_QUERY).toContain("slug.current == $slug");
    expect(APP_SONGS_QUERY).toContain("albumArt.asset->url");
  });
});
