// The before/after a song check shows (admin parity phase 3, S3): built from the writer's own
// normalized patch, so what is shown is what would be written.
import { describe, expect, it, vi } from "vitest";

// The writer module's clients are never called here: only its pure `buildSongPatch`.
vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: {}, writeClient: {} }));
vi.mock("@/app/utils/revalidate", () => ({ revalidateSongViews: () => {} }));
import { textToBody } from "@/app/utils/lyrics";
import { buildSongPatch } from "@/app/utils/songSaveCommit";
import { applySongEdits, type SongCatalog, type SongEdit, type StoredSong } from "@/app/utils/songEdits";
import { diffHunks, lineDiff, songChangeLines } from "../songChange";

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
    chords: [{ _key: "ch-g", key: "G", content: "[G]Tú estás aquí\n[D]obrando" }],
    tagRefs: ["tag-ador"],
    authorRefs: ["author-sinach"],
    referenceLinks: [{ label: "Spotify", url: "https://open.spotify.com/x" }],
    tutorials2: [],
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
  authors: [{ _id: "author-sinach", name: "Sinach", slug: "sinach" }],
};

/** The check's own pipeline: edits → writer patch → lines. */
function linesFor(edits: SongEdit[], s = song()): string[] {
  const applied = applySongEdits(s, edits, CATALOG);
  if (!applied.ok) throw new Error(applied.message);
  const ids = new Set(applied.raw.authorIds ?? []);
  const rows = CATALOG.authors.filter((a) => ids.has(a._id)).map((a) => ({ _id: a._id, name: a.name ?? "" }));
  const built = buildSongPatch(applied.raw, rows, applied.newAuthors, () => "k");
  if (!built.ok) throw new Error("writer refused");
  return songChangeLines({
    song: s,
    catalog: CATALOG,
    set: built.set,
    unset: built.unset,
    newAuthors: applied.newAuthors,
    storedArtist: "Sinach",
  });
}

describe("lineDiff / diffHunks", () => {
  it("marks only the changed lines, with one line of context and «…» between changes", () => {
    expect(lineDiff("a\nb", "a\nc").map((o) => o.kind)).toEqual(["same", "del", "add"]);
    const before = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
    const after = ["1", "X", "3", "4", "5", "Y", "7"].join("\n");
    expect(diffHunks(before, after)).toEqual(["  1", "− 2", "+ X", "  3", "  …", "  5", "− 6", "+ Y", "  7"]);
    expect(diffHunks("a\n\nb", "a\nb")).toEqual(["  a", "− (línea vacía)", "  b"]);
  });
});

describe("songChangeLines", () => {
  it("shows a field change, and nothing when an edit changes nothing", () => {
    expect(linesFor([{ op: "set", field: "key", value: "A" }])).toEqual(["Tono: G → A"]);
    expect(linesFor([{ op: "set", field: "key", value: "G" }])).toEqual([]);
  });

  it("shows a cleared URL as «(se borra)»", () => {
    expect(linesFor([{ op: "set", field: "musicalReferenceUrl", value: "" }])).toEqual([
      "Referencia musical: https://youtu.be/ref → (se borra)",
    ]);
  });

  it("shows a lyric passage as a hunk, and warns that a chart hides the lyrics (ADR-0018)", () => {
    const lines = linesFor([{ op: "lyrics", replace: "obrando", with: "obrando hoy" }]);
    expect(lines).toEqual([
      "Letra:",
      "  Tú estás aquí",
      "− obrando en este lugar",
      "+ obrando hoy en este lugar",
      "  Tú estás aquí",
      expect.stringContaining("ADR-0018"),
    ]);
  });

  it("names a new artist as one that would be created, and the rebuilt artist text", () => {
    const lines = linesFor([{ op: "authors", names: ["Sinach", "Elevation Worship"] }]);
    expect(lines).toEqual([
      "Artistas: Sinach → Sinach, Elevation Worship (se crearía el artista)",
      "Artista (texto): Sinach → Sinach, Elevation Worship",
    ]);
  });

  it("shows tags added and removed by name", () => {
    expect(linesFor([{ op: "addTag", name: "Gozo" }, { op: "removeTag", name: "Adoración" }])).toEqual(["Etiquetas: + Gozo, − Adoración"]);
  });

  it("shows a removed chart, a new chart, and what removing the last chart does to the lyrics", () => {
    const lines = linesFor([{ op: "removeChart", chartKey: "ch-g" }, { op: "addChart", key: "A", content: "[A]Hola" }]);
    expect(lines).toEqual(["Acorde en G: se elimina el acorde.", "Acorde nuevo en A:", "+ [A]Hola"]);
    const last = linesFor([{ op: "removeChart", chartKey: "ch-g" }]);
    expect(last).toEqual(["Acorde en G: se elimina el acorde.", expect.stringContaining("vuelven a ver la letra")]);
  });

  it("warns that adding the first chart hides the lyrics", () => {
    const lines = linesFor([{ op: "addChart", key: "G", content: "[G]x" }], song({ chords: [] }));
    expect(lines).toContain("Al agregar el acorde, los miembros dejan de ver la letra (ADR-0018).");
  });

  it("shows links added and removed", () => {
    expect(linesFor([{ op: "removeLink", label: "Spotify" }, { op: "addLink", label: "YouTube", url: "https://youtu.be/y" }])).toEqual([
      "Links de referencia: + YouTube (https://youtu.be/y); − Spotify (https://open.spotify.com/x)",
    ]);
  });
});
