// The empty link row that used to cost an admin the whole form.
//
// Pressing «Agregar link de referencia» and then not typing left a row with no
// label and no URL. `isSafeHttpUrl("")` is false — `new URL("")` throws — so both
// write routes rejected the ENTIRE request: the lyrics, the chord charts, the
// tags and the title edited in the same form were all discarded, and the only
// thing on screen was "Error al actualizar."
//
// The contract now follows `normalizeChordCharts`, which has always dropped a
// chart whose content is blank rather than failing the save.

import { describe, it, expect } from "vitest";
import { normalizeLinkRows, isSafeHttpUrl } from "../linkRowWrite";

const LINKS = {
  type: "referenceLink",
  labelField: "label",
  humanName: "Links de referencia",
  mintKey: () => "k",
} as const;

const TUTORIALS = {
  type: "tutorial",
  labelField: "title",
  humanName: "Tutoriales",
  mintKey: () => "k",
} as const;

describe("the blank row is dropped, not rejected", () => {
  it("drops a row with neither label nor URL", () => {
    const out = normalizeLinkRows([{ label: "", url: "" }], LINKS);
    expect(out).toEqual({ ok: true, rows: [] });
  });

  it("drops it from the MIDDLE without disturbing the rows around it", () => {
    const out = normalizeLinkRows(
      [
        { label: "Spotify", url: "https://open.spotify.com/x" },
        { label: "", url: "" },
        { label: "YouTube", url: "https://youtu.be/y" },
      ],
      LINKS,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows.map((r) => r.label)).toEqual(["Spotify", "YouTube"]);
  });

  it("treats whitespace as blank — a space is not a link", () => {
    expect(normalizeLinkRows([{ label: "   ", url: "  " }], LINKS)).toEqual({ ok: true, rows: [] });
  });

  it("drops the blank tutorial row too, where the first column is `title`", () => {
    expect(normalizeLinkRows([{ title: "", url: "" }], TUTORIALS)).toEqual({ ok: true, rows: [] });
  });
});

describe("a row the admin actually typed into still fails, and says which one", () => {
  it("names the label when the URL is missing", () => {
    const out = normalizeLinkRows([{ label: "Spotify", url: "" }], LINKS);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    // The old message was "referenceLinks must use http(s)" for any row, so an
    // admin with six links had to guess which one.
    expect(out.error).toContain("Spotify");
    expect(out.error).toMatch(/https?:\/\//);
  });

  it("names the label when the URL is not http(s)", () => {
    const out = normalizeLinkRows([{ label: "Raro", url: "javascript:alert(1)" }], LINKS);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Raro");
  });

  it("still fails a URL-only row, and falls back to the list's name", () => {
    // No label to quote, but the admin typed a URL, so silently dropping it
    // would be the worse surprise.
    const out = normalizeLinkRows([{ label: "", url: "notaurl" }], LINKS);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("Links de referencia");
  });
});

describe("shape", () => {
  it("mints a `_key` per row and writes the schema's own field name", () => {
    let n = 0;
    const out = normalizeLinkRows(
      [{ label: "A", url: "https://a.test" }, { label: "B", url: "https://b.test" }],
      { ...LINKS, mintKey: () => `k${++n}` },
    );
    expect(out).toEqual({
      ok: true,
      rows: [
        { _type: "referenceLink", _key: "k1", label: "A", url: "https://a.test" },
        { _type: "referenceLink", _key: "k2", label: "B", url: "https://b.test" },
      ],
    });
  });

  it("writes tutorials under `title`, which is what the schema stores", () => {
    const out = normalizeLinkRows([{ title: "Teclado", url: "https://t.test" }], TUTORIALS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]).toEqual({ _type: "tutorial", _key: "k", title: "Teclado", url: "https://t.test" });
  });

  it("trims what it stores", () => {
    const out = normalizeLinkRows([{ label: "  Spotify  ", url: " https://a.test " }], LINKS);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows[0]).toMatchObject({ label: "Spotify", url: "https://a.test" });
  });

  it("absent means an empty list, not an error", () => {
    expect(normalizeLinkRows(undefined, LINKS)).toEqual({ ok: true, rows: [] });
    expect(normalizeLinkRows(null, LINKS)).toEqual({ ok: true, rows: [] });
  });

  it("refuses a non-list and a non-object row rather than guessing", () => {
    expect(normalizeLinkRows("nope", LINKS).ok).toBe(false);
    expect(normalizeLinkRows([null], LINKS).ok).toBe(false);
    expect(normalizeLinkRows([42], LINKS).ok).toBe(false);
  });
});

describe("isSafeHttpUrl keeps the protocol guard it always had", () => {
  it("accepts http and https only", () => {
    expect(isSafeHttpUrl("https://a.test")).toBe(true);
    expect(isSafeHttpUrl("http://a.test")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,x")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});
