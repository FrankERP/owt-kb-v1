// MCP OAuth core — reading a POST body from the internet, capped. Neutral: no
// `server-only`, no Sanity, nothing from the grant store — the public register
// route imports it, and its import-closure guard must stay as small as it is.
//
// Registration, the consent POST and the token endpoint used to carry three
// byte-identical copies of this. Each route still owns its own cap, its own
// media type and its own error response; only the mechanics live here.

/**
 * True when the `Content-Type` header's media type is `mediaType` — compared
 * case-insensitively, with any parameters (`; charset=UTF-8`, which many HTTP
 * clients add) ignored. An absent header is never a match.
 */
export function hasMediaType(header: string | null, mediaType: string): boolean {
  if (!header) return false;
  return header.split(";")[0]?.trim().toLowerCase() === mediaType.toLowerCase();
}

export type CappedBody = { ok: true; bytes: Uint8Array } | { ok: false };

/**
 * The request body, or `ok: false` when it is larger than `maxBytes`. Two caps:
 * a DECLARED `Content-Length` over the limit is refused without reading
 * anything, and the read itself stops — and cancels the stream — the moment
 * more than `maxBytes` have actually arrived, so a lying or absent
 * `Content-Length` cannot get a larger body through. A declared length that is
 * not a number is ignored; the read cap still applies.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<CappedBody> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const n = Number(declaredLength);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
