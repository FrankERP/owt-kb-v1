import "server-only";

// Native-app sign-in — the person checks the confirmation page and the POST
// both run (ADR-0091, spec §3.1 step 2, §10 A15), in one place so the two
// cannot drift: a live, non-impersonating session whose LIVE access is
// active, on a browser that is not Android 11 or older.

import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { androidVersionAllows } from "./androidGate";

export type AuthorizePersonCheck =
  | { ok: true; sanityId: string }
  | { ok: false; reason: "no_session" | "impersonating" | "inactive" | "android_too_old" | "unavailable" };

export async function checkAuthorizePerson(headers: Pick<Headers, "get">): Promise<AuthorizePersonCheck> {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!session) return { ok: false, reason: "no_session" };
  if (session.user.isImpersonating) return { ok: false, reason: "impersonating" };
  try {
    if (!(await getMemberAccess(session.user.sanityId)).active) return { ok: false, reason: "inactive" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!androidVersionAllows(headers).ok) return { ok: false, reason: "android_too_old" };
  return { ok: true, sanityId: session.user.sanityId };
}

/** What each refusal tells the person (Spanish UI). */
export const AUTHORIZE_REFUSAL_TEXT: Record<Exclude<AuthorizePersonCheck, { ok: true }>["reason"], { title: string; body: string }> = {
  no_session: { title: "Inicia sesión", body: "Vuelve a la app y toca Entrar otra vez." },
  impersonating: { title: "Suplantación activa", body: "Termina la suplantación antes de entrar a la app." },
  inactive: { title: "Acceso desactivado", body: "Tu acceso a Backstage está desactivado." },
  android_too_old: {
    title: "Android 12 o más nuevo",
    body: "La app de Backstage necesita Android 12 o más nuevo. Puedes seguir usando Backstage en el navegador.",
  },
  unavailable: { title: "No disponible", body: "No se pudo entrar en este momento. Intenta de nuevo en un rato." },
};
