/**
 * The message a write route sent, when it sent one worth showing.
 *
 * Every song-editor save handler used to discard the response body and print a
 * fixed string — "Error al actualizar.", "No se pudo guardar." — which is the
 * right answer for a 500 or a dropped connection and the wrong one for a 400
 * that knows exactly what is wrong. An admin with six reference links was told
 * only that something failed.
 *
 * Returns `undefined` for anything that is not a short, human-readable string,
 * so a caller can always fall back to its own copy: a stack trace, an HTML error
 * page or a 300-character GROQ complaint must never land in a toast.
 */
const MAX = 200;

export async function writeErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = await res.json() as { error?: unknown } | null;
    const error = body?.error;
    if (typeof error !== "string") return undefined;
    const text = error.trim();
    if (text === "" || text.length > MAX) return undefined;
    // One line only. A message with newlines is a dump, not a sentence.
    return text.includes("\n") ? undefined : text;
  } catch {
    return undefined;
  }
}
