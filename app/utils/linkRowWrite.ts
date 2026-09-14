/**
 * Server-side normalisation for the song editors' LINK ROWS — `referenceLinks`
 * on both write routes, and `tutorials2` on the PATCH route.
 *
 * THE DEFECT THIS EXISTS FOR. Both routes validated every row with
 * `isSafeHttpUrl(l.url)`, and `new URL("")` throws, so an EMPTY row — the one an
 * admin gets by pressing «Agregar link de referencia» and then not typing —
 * failed validation and 400'd the WHOLE request. Not the row: the request. The
 * lyrics, the chord charts, the tags and the title edited in the same form were
 * all discarded, and the only thing on screen was "Error al actualizar."
 *
 * The fix follows the precedent already in this codebase rather than inventing
 * one: `normalizeChordCharts` drops a chart whose content is blank (`if
 * (raw.content.trim() === "") continue;`) instead of rejecting the save. A row
 * with no label and no URL carries no information, so there is nothing to reject
 * — it is simply not written.
 *
 * A row that carries a LABEL but no usable URL is a different case and still
 * fails, because the admin typed something and deserves to know it did not
 * survive. The error names the label so they can find it, instead of saying only
 * that some link, somewhere, was wrong.
 */

export type LinkRowWrite = {
  _type: string;
  _key: string;
  /** `label` for a reference link, `title` for a tutorial. */
  [field: string]: string;
};

export type NormalizeLinkRowsResult =
  | { ok: true; rows: LinkRowWrite[] }
  | { ok: false; error: string };

type RawRow = { url?: unknown; label?: unknown; title?: unknown };

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * @param labelField the schema's name for the first column — `referenceLink`
 *        stores `label`, `tutorial` stores `title`.
 * @param humanName what to call one of these in an error an admin will read.
 */
export function normalizeLinkRows(
  input: unknown,
  {
    type,
    labelField,
    humanName,
    mintKey,
  }: { type: string; labelField: "label" | "title"; humanName: string; mintKey: () => string },
): NormalizeLinkRowsResult {
  if (input == null) return { ok: true, rows: [] };
  if (!Array.isArray(input)) return { ok: false, error: `${humanName}: se esperaba una lista` };

  const rows: LinkRowWrite[] = [];

  for (const item of input as RawRow[]) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `${humanName}: una fila no es válida` };
    }
    const label = asText(item[labelField]).trim();
    const url = asText(item.url).trim();

    // Wholly blank: the «Agregar» row nobody filled in. Dropped, exactly as a
    // blank chord chart is — never a reason to lose the rest of the form.
    if (label === "" && url === "") continue;

    if (!isSafeHttpUrl(url)) {
      return {
        ok: false,
        error: label
          ? `«${label}» necesita una URL que empiece con http:// o https://`
          : `${humanName}: hay una URL que no empieza con http:// o https://`,
      };
    }

    rows.push({ _type: type, _key: mintKey(), [labelField]: label, url });
  }

  return { ok: true, rows };
}
