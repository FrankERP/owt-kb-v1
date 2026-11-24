import { describe, expect, it } from "vitest";
import { textToBody } from "@/app/utils/lyrics";
import {
  applySongEdits,
  countOccurrences,
  lyricsGate,
  lyricsRoundTrips,
  resolveAuthor,
  type SongCatalog,
  type SongEdit,
  type StoredSong,
} from "@/app/utils/songEdits";

const LYRICS = "# Coro\nTú estás aquí\nobrando en este lugar\nTú estás aquí";

function song(over: Partial<StoredSong> = {}): StoredSong {
  return {
    _id: "post-1",
    _rev: "rev-1",
    title: "Way Maker",
    key: "G",
    bpm: 68,
    timeSig: "4/4",
    body: textToBody(LYRICS),
    chords: [
      { _key: "ch-g", key: "G", content: "[G]Tú estás aquí\n[D]obrando" },
      { _key: "ch-a", key: "A", content: "[A]Tú estás aquí" },
    ],
    tagRefs: ["tag-ador", "tag-ghost"],
    authorRefs: ["author-sinach"],
    referenceLinks: [{ label: "Spotify", url: "https://open.spotify.com/x" }],
    tutorials2: [{ title: "Teclado", url: "https://t.test/k" }],
    musicalReferenceUrl: "https://youtu.be/ref",
    lyricsVideoUrl: null,
    ...over,
  };
}

const CATALOG: SongCatalog = {
  tags: [
    { _id: "tag-ador", name: "Adoración", slug: "adoracion" },
    { _id: "tag-gozo", name: "Gozo", slug: "gozo" },
  ],
  authors: [
    { _id: "author-sinach", name: "Sinach", slug: "sinach" },
    { _id: "author-hs", name: "Hillsong Worship", slug: "hillsong-worship" },
  ],
};

const apply = (edits: SongEdit[], s = song()) => applySongEdits(s, edits, CATALOG);

describe("lyricsGate (D4)", () => {
  it("accepts a body the editor writes, and reports its text", () => {
    expect(lyricsGate(textToBody(LYRICS))).toEqual({ text: LYRICS, structural: true, nfc: true });
    expect(lyricsGate([])).toEqual({ text: "", structural: true, nfc: true });
  });

  it("refuses every shape the editor's round trip would lose", () => {
    const block = (over: Record<string, unknown>) => ({
      _type: "block", _key: "b", style: "normal", markDefs: [],
      children: [{ _type: "span", _key: "s", text: "Hola", marks: [] }], ...over,
    });
    const lossy: unknown[][] = [
      [block({ style: "h2" })],
      [block({ listItem: "bullet", level: 1 })],
      [block({ markDefs: [{ _key: "l", _type: "link", href: "https://x" }] })],
      [block({ children: [{ _type: "span", _key: "s", text: "Hola", marks: ["l"] }] })],
      [block({ children: [{ _type: "span", _key: "s", text: "a *b* c", marks: [] }] })],
      [block({ children: [{ _type: "inlineThing", _key: "i" }] })],
      [block({}), { _type: "image", _key: "img", asset: { _ref: "x" } }],
    ];
    for (const body of lossy) expect(lyricsGate(body).structural).toBe(false);
    expect(lyricsGate([block({ children: [{ _type: "span", _key: "s", text: "Corazón", marks: [] }] })])).toMatchObject({
      structural: true,
      nfc: false,
    });
  });

  it("lets the formatting markers round-trip as formatting (A1)", () => {
    expect(lyricsRoundTrips("# Coro\n**fuerte** y *suave*")).toBe(true);
  });
});

describe("applySongEdits", () => {
  it("counts passages without overlap, as split does", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences(LYRICS, "Tú estás aquí")).toBe(2);
  });

  it("refuses a repeated passage with its count, and applies all or the n-th", () => {
    const twice = apply([{ op: "lyrics", replace: "Tú estás aquí", with: "Tú estás aquí, obrando" }]);
    expect(twice).toMatchObject({ ok: false });
    if (!twice.ok) expect(twice.message).toMatch(/Cambio 1: letra: «Tú estás aquí» aparece 2 veces/);
    const second = apply([{ op: "lyrics", replace: "Tú estás aquí", with: "X", nth: 2 }]);
    expect(second).toMatchObject({ ok: true, raw: { lyrics: "# Coro\nTú estás aquí\nobrando en este lugar\nX" } });
    const all = apply([{ op: "lyrics", replace: "Tú estás aquí", with: "X", all: true }]);
    expect(all).toMatchObject({ ok: true, raw: { lyrics: "# Coro\nX\nobrando en este lugar\nX" } });
    expect(apply([{ op: "lyrics", replace: "no está", with: "X" }])).toMatchObject({ ok: false });
    expect(apply([{ op: "lyrics", replace: "Tú estás aquí", with: "X", nth: 3 }])).toMatchObject({ ok: false });
  });

  it("applies edits in order and touches only the fields an edit names", () => {
    const r = apply([
      { op: "lyrics", replace: "obrando", with: "obrando hoy" },
      { op: "lyrics", replace: "hoy", with: "hoy mismo" },
    ]);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(Object.keys(r.raw)).toEqual(["lyrics"]);
    expect(r.raw.lyrics).toContain("obrando hoy mismo en este lugar");
    expect(r.lyrics).toEqual({ before: LYRICS, after: r.raw.lyrics });
  });

  it("refuses passage edits on a lossy body, lyricsAll included (A2), and on a non-NFC one only passages", () => {
    const lossy = song({ body: [...textToBody(LYRICS), { _type: "image", _key: "img" }] });
    expect(apply([{ op: "lyricsAll", text: "Nueva" }], lossy)).toMatchObject({ ok: false });
    expect(apply([{ op: "lyrics", replace: "Coro", with: "X" }], lossy)).toMatchObject({ ok: false });
    const list = song({ body: [{ ...textToBody("a")[0], listItem: "bullet", level: 1 }] });
    expect(apply([{ op: "lyricsAll", text: "Nueva" }], list)).toMatchObject({ ok: false });
    const decomposed = song({ body: textToBody("Corazón") });
    expect(apply([{ op: "lyrics", replace: "Cora", with: "X" }], decomposed)).toMatchObject({ ok: false });
    expect(apply([{ op: "lyricsAll", text: "Corazón" }], decomposed)).toMatchObject({ ok: true, raw: { lyrics: "Corazón" } });
  });

  it("keeps every other chart and its _key, edits one passage, and refuses a second chart in a key", () => {
    const r = apply([{ op: "chart", chartKey: "ch-g", replace: "[D]obrando", with: "[D]obrando hoy" }]);
    expect(r).toMatchObject({
      ok: true,
      raw: {
        chords: [
          { _key: "ch-g", key: "G", content: "[G]Tú estás aquí\n[D]obrando hoy" },
          { _key: "ch-a", key: "A", content: "[A]Tú estás aquí" },
        ],
      },
    });
    expect(apply([{ op: "addChart", key: "A", content: "[A]x" }])).toMatchObject({ ok: false });
    const added = apply([{ op: "addChart", key: "Bb", content: "[Bb]x" }]);
    expect(added).toMatchObject({ ok: true });
    if (added.ok) expect(added.raw.chords?.[2]).toEqual({ key: "Bb", content: "[Bb]x" });
    expect(apply([{ op: "removeChart", chartKey: "ch-a" }])).toMatchObject({ ok: true, raw: { chords: [{ _key: "ch-g" }] } });
    expect(apply([{ op: "chartAll", chartKey: "nope", content: "x" }])).toMatchObject({ ok: false });
  });

  it("refuses a key in Spanish notation with the hint", () => {
    const r = apply([{ op: "set", field: "key", value: "Sol" }]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toContain("Sol = G");
    expect(apply([{ op: "addChart", key: "Re", content: "x" }])).toMatchObject({ ok: false });
    expect(apply([{ op: "set", field: "key", value: "F#m" }])).toMatchObject({ ok: true, raw: { key: "F#m" } });
  });

  it("clears: a URL and bpm with an empty value, key and timeSig to empty; never the title", () => {
    expect(apply([{ op: "set", field: "musicalReferenceUrl", value: "" }])).toMatchObject({ ok: true, raw: { musicalReferenceUrl: "" } });
    expect(apply([{ op: "set", field: "bpm", value: "" }])).toMatchObject({ ok: true, raw: { bpm: "" } });
    expect(apply([{ op: "set", field: "timeSig", value: "" }])).toMatchObject({ ok: true, raw: { timeSig: "" } });
    expect(apply([{ op: "set", field: "title", value: " " }])).toMatchObject({ ok: false });
    expect(apply([{ op: "set", field: "bpm", value: "rápido" }])).toMatchObject({ ok: false });
    expect(apply([{ op: "set", field: "lyricsVideoUrl", value: "javascript:alert(1)" }])).toMatchObject({ ok: false });
  });

  it("adds and removes tags by name, keeping a reference the read could not dereference", () => {
    expect(apply([{ op: "addTag", name: "gozo" }])).toMatchObject({ ok: true, raw: { tagIds: ["tag-ador", "tag-ghost", "tag-gozo"] } });
    expect(apply([{ op: "removeTag", name: "ADORACIÓN" }])).toMatchObject({ ok: true, raw: { tagIds: ["tag-ghost"] } });
    const unknown = apply([{ op: "addTag", name: "Nueva" }]);
    expect(unknown).toMatchObject({ ok: false });
    if (!unknown.ok) expect(unknown.message).toContain("Adoración, Gozo");
    const twins = applySongEdits(song(), [{ op: "addTag", name: "Gozo" }], {
      ...CATALOG,
      tags: [...CATALOG.tags, { _id: "tag-gozo-2", name: "gozo", slug: "gozo-2" }],
    });
    expect(twins).toMatchObject({ ok: false });
  });

  it("resolves artists by name, then slug, and mints the rest for the save's transaction", () => {
    const r = apply([{ op: "authors", names: ["sinach", "Hillsong Worship", "Elevation Worship"] }]);
    expect(r).toMatchObject({
      ok: true,
      raw: { authorIds: ["author-sinach", "author-hs", "author-elevation-worship"] },
      newAuthors: [{ _id: "author-elevation-worship", name: "Elevation Worship", slug: "elevation-worship" }],
    });
    expect(apply([{ op: "authors", names: ["Sinach", "SINACH"] }])).toMatchObject({ ok: false });
    expect(resolveAuthor("Hillsong-Worship", [], CATALOG.authors)).toMatchObject({ ok: true, author: { kind: "existing", id: "author-hs" } });
    expect(resolveAuthor("中文", [], CATALOG.authors)).toMatchObject({ ok: false });
    // An id a renamed author already holds is never minted again (createIfNotExists would write nothing).
    expect(resolveAuthor("Sinach Live", [], [{ _id: "author-sinach-live", name: "Sinach (en vivo)", slug: "otro" }])).toMatchObject({ ok: false });
  });

  it("edits links and tutorials by label, refusing an ambiguous one and a stored row the writer refuses", () => {
    expect(apply([{ op: "addLink", label: "YouTube", url: "https://youtu.be/y" }])).toMatchObject({
      ok: true,
      raw: { referenceLinks: [{ label: "Spotify" }, { label: "YouTube" }] },
    });
    expect(apply([{ op: "removeTutorial", label: "teclado" }])).toMatchObject({ ok: true, raw: { tutorials: [] } });
    const twin = song({ referenceLinks: [{ label: "A", url: "https://a.test" }, { label: "a", url: "https://b.test" }] });
    expect(apply([{ op: "removeLink", label: "A" }], twin)).toMatchObject({ ok: false });
    const broken = song({ referenceLinks: [{ label: "Infinito", url: "ashttps://x" }] });
    const refused = apply([{ op: "addLink", label: "Y", url: "https://y.test" }], broken);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.message).toContain("Infinito");
    expect(
      apply([{ op: "removeLink", label: "Infinito" }, { op: "addLink", label: "Y", url: "https://y.test" }], broken),
    ).toMatchObject({ ok: true, raw: { referenceLinks: [{ label: "Y", url: "https://y.test" }] } });
  });
});
