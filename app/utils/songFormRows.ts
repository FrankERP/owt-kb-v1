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

function defaultLocalId(): string {
  return `local-${Math.random().toString(36).slice(2, 9)}`;
}

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
 * Unlike `chartsToPayload` this drops NOTHING: a link whose fields are both
 * blank is the editor's own "I am about to type here" row, and silently
 * discarding it on save would be a different surprise. Callers that want the
 * empty rows gone should say so.
 */
export function rowsToPayload(rows: RowDraft[]): RowPayload[] {
  return rows.map((row) => {
    const out: RowPayload = { label: row.label, url: row.url };
    if (row._key) out._key = row._key;
    return out;
  });
}

/** `rowsToPayload` with the wholly-empty rows removed. */
export function rowsToPayloadCompact(rows: RowDraft[]): RowPayload[] {
  return rowsToPayload(rows.filter((row) => row.label.trim() !== "" || row.url.trim() !== ""));
}
