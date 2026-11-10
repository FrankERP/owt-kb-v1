// The one client-side caller of the four Jóvenes event routes (ADR-0081). Each editor calls it
// inside its own try/finally (CLAUDE.md: client mutation handlers check `res.ok` and never close
// as success on a failure); this answers what happened, in words a pastor can read.
//
// Neutral module: no React, so the answer mapping is testable on its own.

export type EventWriteResult = { ok: true; rev: string | null } | { ok: false; message: string; stale: boolean };

const CODE_WORDS: Record<string, string> = {
  invalid_member: "Alguna persona elegida ya no está en Jóvenes (o en ese grupo).",
  invalid_time: "La hora debe ser HH:mm.",
  invalid_arrival: "La llegada debe ser HH:mm.",
  invalid_program: "Revisa el programa: cada línea necesita un nombre corto.",
  invalid_notes: "Las notas son demasiado largas.",
  invalid_title: "El título es demasiado largo.",
  already_created: "Esta reunión ya estaba creada.",
};

/** The answer's words: the server's Spanish message, else a known code's words, else a plain line. */
export function writeMessage(status: number, body: unknown): string {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof error === "string") {
    if (Object.hasOwn(CODE_WORDS, error)) return CODE_WORDS[error];
    // The Spanish refusals («No puedes editar este evento.») contain a space; codes do not.
    if (error.includes(" ")) return error;
  }
  if (status === 401) return "Tu sesión terminó; vuelve a entrar.";
  return "No se pudo guardar. Intenta de nuevo.";
}

export async function sendEventWrite(
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body: Record<string, unknown>,
): Promise<EventWriteResult> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, message: "Sin conexión. Intenta de nuevo.", stale: false };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const rev = json && typeof json === "object" ? (json as { rev?: unknown }).rev : null;
    return { ok: true, rev: typeof rev === "string" ? rev : null };
  }
  return { ok: false, message: writeMessage(res.status, json), stale: res.status === 409 };
}

/** `ministryEvent.<uuid>` → the URL token the routes take. */
export function tokenOf(id: string): string {
  return id.slice(id.indexOf(".") + 1);
}

export const eventsUrl = (ministry: string) => `/api/ministries/${ministry}/events`;
export const eventUrl = (ministry: string, id: string) => `${eventsUrl(ministry)}/${tokenOf(id)}`;
export const programUrl = (ministry: string, id: string) => `${eventUrl(ministry, id)}/program`;

/**
 * A native clock left half typed («18:--» on a desktop) reports `""` as its value, so the form
 * cannot tell it from a cleared one and would save «no time». The browser can tell (`badInput`),
 * so the editors ask it before sending: the words to show, or `null`. `ids` are the fields' ids.
 */
export function halfTypedClock(ids: readonly string[]): string | null {
  if (typeof document === "undefined") return null;
  const half = ids.some((id) => (document.getElementById(id) as HTMLInputElement | null)?.validity?.badInput === true);
  return half ? "Completa la hora o bórrala." : null;
}
