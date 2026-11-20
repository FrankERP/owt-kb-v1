// Native-app sign-in — reading the urlencoded forms the token, revoke and
// authorize-submit endpoints take: media type, capped body (the shared reader),
// strict UTF-8. Returns null on any failure; each caller answers its own error.

import { hasMediaType, readCappedBody } from "@/app/mcp/oauth/requestBody";

export const FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

/** Far above any valid form here (a code or refresh token, a 128-char verifier, a 256-char state). */
export const APP_FORM_MAX_BYTES = 16 * 1024;

export type FormRead = { ok: true; form: URLSearchParams } | { ok: false; reason: "content_type" | "too_large" | "not_utf8" };

export async function readAppForm(request: Request): Promise<FormRead> {
  if (!hasMediaType(request.headers.get("content-type"), FORM_MEDIA_TYPE)) return { ok: false, reason: "content_type" };
  const body = await readCappedBody(request, APP_FORM_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, form: new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)) };
  } catch {
    return { ok: false, reason: "not_utf8" };
  }
}

/** A single-valued parameter; absent and empty are both null. */
export function formParam(form: URLSearchParams, name: string): string | null {
  const v = form.get(name);
  return v === null || v === "" ? null : v;
}
