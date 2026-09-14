/**
 * Identity for the song editors' REPEATABLE ROWS — reference links and tutorials.
 *
 * Both editors used to key these rows by array position (`key={i}`,
 * `` key={`link-${i}`} ``). Typing was unaffected — the update handlers edit in
 * place, so neither the length nor the order moves mid-word — but REMOVING a row
 * in the middle makes React reuse each DOM node for the row that slid up into its
 * position. The caret, the selection and a half-finished IME composition stay in
 * a node that is now showing different data (issue #69).
 *
 * The fix is the one `songFormCharts.ts` already made for chord charts, and this
 * module is deliberately its sibling: every row carries a client `id` used as the
 * React key, and the payload builders strip it. Sanity's own `_key` is preserved
 * where a stored row has one, because array-of-object writes need it — see
 * CLAUDE.md's invariants.
 *
 * PURE. No React, no DOM: the editors hold the drafts in their own form state and
 * the arithmetic is tested directly.
 */

export type RowDraft = {
  /** React key. The stored `_key` when there is one, else a local id. */
  id: string;
  /** Sanity's own key, present only on a row that came back from the dataset. */
  _key?: string;
  label: string;
  url: string;
};

/** What a row looks like in Sanity and on the wire — no client `id`. */
export type RowPayload = {
  _key?: string;
  label: string;
  url: string;
};

type StoredRow = { _key?: string; label?: string; url?: string; title?: string };

/**
 * A fresh row identity. Exported because a state updater must be PURE and this
 * one is not — the editors mint the id before calling `setForm`, the way
 * `songFormCharts.ts`'s consumers already do.
 */
export function newRowId(): string {
  return `local-${Math.random().toString(36).slice(2, 9)}`;
}

const defaultLocalId = newRowId;

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Adopt stored rows as drafts.
 *
 * `title` is accepted as an alias for `label` because tutorials store their first
 * column under that name while reference links use `label`; one shape here keeps
 * both editors on one module rather than two near-copies.
 */
export function rowsFromStored(
  rows: StoredRow[] | undefined,
  nextLocalId: () => string = defaultLocalId,
): RowDraft[] {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const storedKey = asText(row._key);
    const _key = storedKey || undefined;
    return {
      id: _key ?? nextLocalId(),
      ...(_key ? { _key } : {}),
      label: asText(row.label) || asText(row.title),
      url: asText(row.url),
    };
  });
}

/** A fresh empty row, with an identity from birth. */
export function addRow(rows: RowDraft[], nextLocalId: () => string = defaultLocalId): RowDraft[] {
  return [...rows, { id: nextLocalId(), label: "", url: "" }];
}

/** Remove BY ID, never by index — the whole point of the module. */
export function removeRow(rows: RowDraft[], id: string): RowDraft[] {
  return rows.filter((row) => row.id !== id);
}

/** Edit BY ID. Returns the same array when the id is unknown. */
export function updateRow(rows: RowDraft[], id: string, field: "label" | "url", value: string): RowDraft[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== id) return row;
    changed = true;
    return { ...row, [field]: value };
  });
  return changed ? next : rows;
}

/**
 * Strip the client id for the wire, keeping `_key` where the row has one.
 *
 * Unlike `chartsToPayload` this drops NOTHING, and that is preserved behaviour
 * rather than a judgement: both editors sent blank rows before this module
 * existed. Worth knowing what happens to one, because it is not "an empty link
 * gets saved" — `isSafeHttpUrl("")` is false, so the write route 400s the WHOLE
 * request and the admin loses every other edit in the form with it. That is a
 * pre-existing defect of its own, not something to fix by quietly changing what
 * this function returns.
 *
 * `_key` is defensive here. Both write routes re-mint a key for every row on
 * every save, and no projection in `app/**` even reads these arrays' keys back,
 * so a stored `_key` never actually makes the round trip today — unlike chords,
 * which are projected with theirs. Keeping it costs nothing and stops this from
 * being the reason a future projection change loses keys.
 */
export function rowsToPayload(rows: RowDraft[]): RowPayload[] {
  return rows.map((row) => {
    const out: RowPayload = { label: row.label, url: row.url };
    if (row._key) out._key = row._key;
    return out;
  });
}
