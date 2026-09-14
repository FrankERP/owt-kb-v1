// Identity for the song editors' repeatable rows (issue #69).
//
// The defect this replaces: both editors keyed reference links and tutorials by
// ARRAY POSITION. Typing was fine — the update handlers edit in place — but
// removing a middle row made React reuse each DOM node for the row that slid up
// into it, so the caret, the selection and a half-typed IME composition stayed in
// a node now showing different data.
//
// The arithmetic lives here, pure, the way `songFormCharts.ts` already does it
// for chord charts.

import { describe, it, expect } from "vitest";
import {
  addRow,
  removeRow,
  rowsFromStored,
  rowsToPayload,
  updateRow,
  type RowDraft,
} from "../songFormRows";

/** Deterministic ids, so the assertions are about identity and not randomness. */
function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("rowsFromStored", () => {
  it("adopts a stored row's `_key` as its identity and carries it along", () => {
    // Defensive only: the write routes re-mint every key, so this never round
    // trips today. It stops the module from being the reason keys are lost if a
    // projection ever starts reading them.
    const rows = rowsFromStored([{ _key: "abc123", label: "Spotify", url: "https://x" }], ids());
    expect(rows).toEqual([{ id: "abc123", _key: "abc123", label: "Spotify", url: "https://x" }]);
  });

  it("mints a local id for a row that has no `_key`, and does NOT invent one", () => {
    const rows = rowsFromStored([{ label: "Sin key", url: "https://y" }], ids());
    expect(rows[0].id).toBe("id-1");
    expect(rows[0]._key).toBeUndefined();
  });

  it("accepts `title` as the first column, because tutorials store it under that name", () => {
    expect(rowsFromStored([{ title: "Tutorial de teclado", url: "https://t" }], ids())[0].label)
      .toBe("Tutorial de teclado");
  });

  it("coerces junk to empty strings rather than rendering `undefined` in an input", () => {
    const rows = rowsFromStored([{ label: undefined, url: undefined }], ids());
    expect(rows[0]).toMatchObject({ label: "", url: "" });
  });

  it("returns [] for undefined and for an empty list", () => {
    expect(rowsFromStored(undefined)).toEqual([]);
    expect(rowsFromStored([])).toEqual([]);
  });

  it("gives every row its own id", () => {
    const rows = rowsFromStored([{ label: "a" }, { label: "b" }, { label: "c" }], ids());
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

describe("removeRow — the actual defect", () => {
  const three = (): RowDraft[] => [
    { id: "a", label: "primero", url: "1" },
    { id: "b", label: "segundo", url: "2" },
    { id: "c", label: "tercero", url: "3" },
  ];

  it("removes the MIDDLE row and leaves the survivors' identities untouched", () => {
    // This is the assertion the whole module exists for: after the removal, `c`
    // is still `c`. Keyed by position it would have become "row 2" and inherited
    // the DOM node — and the caret — of the row that was just deleted.
    const after = removeRow(three(), "b");
    expect(after.map((r) => r.id)).toEqual(["a", "c"]);
    expect(after.map((r) => r.label)).toEqual(["primero", "tercero"]);
  });

  it("leaves the list alone when the id is unknown", () => {
    expect(removeRow(three(), "nope").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("updateRow", () => {
  const rows: RowDraft[] = [
    { id: "a", label: "uno", url: "1" },
    { id: "b", label: "dos", url: "2" },
  ];

  it("edits by id, touching no other row", () => {
    const after = updateRow(rows, "b", "url", "https://nuevo");
    expect(after[1]).toEqual({ id: "b", label: "dos", url: "https://nuevo" });
    expect(after[0]).toBe(rows[0]);
  });

  it("preserves `_key` through an edit", () => {
    const withKey: RowDraft[] = [{ id: "k", _key: "k", label: "x", url: "y" }];
    expect(updateRow(withKey, "k", "label", "z")[0]._key).toBe("k");
  });

  it("returns the SAME array for an unknown id — the identity check is the point", () => {
    // Not a render optimisation: all three call sites wrap this in `setForm`,
    // which allocates a new form object either way.
    expect(updateRow(rows, "missing", "label", "x")).toBe(rows);
  });
});

describe("addRow", () => {
  it("appends an empty row that already has an identity", () => {
    const after = addRow([{ id: "a", label: "uno", url: "1" }], ids());
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual({ id: "id-1", label: "", url: "" });
  });

  it("gives two fresh rows different ids — two blank rows must not collide", () => {
    const next = ids();
    const after = addRow(addRow([], next), next);
    expect(after[0].id).not.toBe(after[1].id);
  });
});

describe("payload", () => {
  const rows: RowDraft[] = [
    { id: "local-1", label: "Spotify", url: "https://s" },
    { id: "stored", _key: "stored", label: "YouTube", url: "https://y" },
    { id: "local-2", label: "", url: "" },
  ];

  it("strips the client id and keeps `_key`", () => {
    expect(rowsToPayload(rows)).toEqual([
      { label: "Spotify", url: "https://s" },
      { _key: "stored", label: "YouTube", url: "https://y" },
      { label: "", url: "" },
    ]);
    for (const row of rowsToPayload(rows)) expect("id" in row).toBe(false);
  });

  it("keeps a blank row, which is what both editors did before this module", () => {
    expect(rowsToPayload(rows)).toHaveLength(3);
  });

});
