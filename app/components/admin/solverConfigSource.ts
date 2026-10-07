// app/components/admin/solverConfigSource.ts
//
// The shared rule set as the CLIENT sees it — four states, and the reason they
// are four and not two.
//
// ─── The failure this file exists to make unrepresentable ────────────────────
//
// The natural client shape is `const config = fetched ?? DEFAULT_SOLVER_CONFIG`
// inside a try/catch. It turns a TRANSIENT FETCH FAILURE into "the rules are the
// seeded defaults": the panel then shows a rule set nobody wrote, one edit plus
// Guardar replaces the shared document wholesale, and because these are hard
// blocks (E6, on the planner grid), enforcement silently
// degrades to whatever the defaults say in the meantime. The live rules exist in
// exactly one place; that trade is not recoverable.
//
// So "the document does not exist" and "the read failed" are DIFFERENT STATES
// and this union never lets them meet:
//
//   loading  — nothing known yet. Enforce nothing, save nothing.
//   error    — the read failed. Enforce nothing, save nothing, SAY SO.
//   absent   — the document genuinely does not exist. Fall back to
//              `DEFAULT_SOLVER_CONFIG` **in memory only**; there is no `rev`, so
//              a save is not merely refused by policy — it is unrepresentable.
//   ready    — the document exists. This IS the team's rule set, `rev` and all.
//
// **`rev` lives on `ready` alone, and that is load-bearing.** `save` demands a
// `rev`, so no amount of refactoring can produce a call that writes the defaults
// over the shared document: there is nothing to pass. The route refuses a create
// as a second, independent lock (`app/api/admin/solver-config/route.ts`).
//
// Pure — no React, no `fetch`. `useSolverConfig.ts` is the hook that drives it.

import { DEFAULT_SOLVER_CONFIG } from "./solverConfigDefaults";
import { capLabel, type SolverConfig } from "./plannerModel";
import {
  SOLVER_CONFIG_VERSION,
  exactCapOverlaps,
  solverConfigFromDocument,
} from "@/app/utils/solverConfigWriteRequest";

export const SOLVER_CONFIG_ENDPOINT = "/api/admin/solver-config";

export type SolverConfigSource =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "absent"; config: SolverConfig }
  /**
   * `configVersion` is the document shape the SERVER said it speaks (C3 §6.2) —
   * a GET or POST echo without one reads as 1, the pre-C3 shape. When it differs
   * from this bundle's `SOLVER_CONFIG_VERSION` the panel refuses to save
   * (`isOutdatedSource`): this bundle would drop or rewrite what it cannot read.
   */
  | { status: "ready"; rev: string; config: SolverConfig; configVersion: number };

export type SolverConfigSaveResult =
  | { ok: true }
  /** `stale` ⇒ somebody else wrote first; the only failure a reload can fix. */
  | { ok: false; message: string; stale: boolean };

export interface SolverConfigController {
  source: SolverConfigSource;
  /** Re-run the GET. The answer to a stale `_rev`, and to a failed read. */
  reload: () => void;
  /** Replace the shared document. A `rev` is required, so only `ready` can call it. */
  save: (config: SolverConfig, rev: string) => Promise<SolverConfigSaveResult>;
}

// ─── Spanish copy, in one place ──────────────────────────────────────────────
//
// Both the components and their tests read these, so a message can never be
// asserted in one wording and rendered in another.

export const READ_FAILED_MESSAGE =
  "No se pudieron cargar las reglas compartidas. No se puede guardar hasta que carguen.";
export const SAVE_NETWORK_MESSAGE =
  "No se pudieron guardar las reglas: sin conexión con el servidor.";
export const SAVE_STALE_MESSAGE =
  "Alguien más cambió las reglas primero. Recarga las reglas y vuelve a aplicar tu cambio.";
export const SAVE_ABSENT_MESSAGE =
  "Las reglas compartidas aún no existen en el servidor. Solo el script de siembra puede crearlas.";
export const SAVE_FORBIDDEN_MESSAGE = "No tienes permiso para cambiar las reglas compartidas.";
export const SAVE_REJECTED_MESSAGE = "El servidor rechazó las reglas y no guardó nada.";
export const SAVE_FAILED_MESSAGE = "No se pudieron guardar las reglas.";
/** The route refused this tab's version (C3 §6.2). No reload button: reloading the PAGE is the fix. */
export const SAVE_OUTDATED_TAB_MESSAGE =
  "Esta pestaña tiene una versión anterior del planificador y no guardó nada. Recarga la página y vuelve a aplicar tu cambio.";
/** The server echoed another version: saving is off until the page is reloaded (C3 §6.2). */
export const PLANNER_UPDATED_MESSAGE =
  "El planificador se actualizó. Recarga la página para poder guardar las reglas.";

// ─── One exact count per person per role (parent A38), in Spanish ─────────────
//
// `{rol}` names a role key the way the rule form's pattern list names the
// single-role patterns (`MonthGenerator`'s `PATTERNS`); `{regla}` is the other
// cap's `capLabel`, the text its chip shows.

/** The five role keys `rolesOfPattern` answers with, as the admin reads them. */
export const EXACT_ROLE_LABEL: Readonly<Record<string, string>> = {
  "Sun.Lead": "Dom Lead",
  "Sat.Lead": "Sáb Lead",
  "Sun.BGV": "Dom BGV",
  "Sat.BGV": "Sáb BGV",
  "Sun.Choir": "Dom Coro",
};
const roleLabel = (role: string) => EXACT_ROLE_LABEL[role] ?? role;

/** Under a cap row of the rule form that would make a second exact count. */
export function exactOverlapFormMessage(input: { role: string; person: string; rule: string }): string {
  return `Ya hay un número fijo para ${roleLabel(input.role)} de ${input.person} («${input.rule}»). Quita uno de los dos.`;
}

/** On each card of a pair already stored (saved before C3). */
export function exactOverlapCardMessage(role: string): string {
  return `Dos números fijos para ${roleLabel(role)}: quita uno para poder guardar.`;
}

/** The route refused the save at `restrictions[i].caps[j]:exact_overlap`. */
export function exactOverlapRefusalMessage(input: { role: string; person: string; rule: string }): string {
  return `Hay dos números fijos para ${roleLabel(input.role)} de ${input.person} («${input.rule}»). Quita uno y guarda de nuevo; no se guardó nada.`;
}

/** Only for a refusal the client cannot pair: a body this panel did not build. */
const EXACT_OVERLAP_UNPAIRED_MESSAGE =
  "Hay dos números fijos para un mismo rol de una persona. Quita uno y guarda de nuevo; no se guardó nada.";

const EXACT_OVERLAP_ISSUE = /^restrictions\[(\d+)\]\.caps\[(\d+)\]:exact_overlap$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A GET response as a state.
 *
 * A non-OK response, an unparseable body, or a `present: true` document with no
 * usable `_rev` all answer `error` — NEVER `absent`, and never a config. A
 * document we cannot name a revision for is one we must not overwrite, and
 * saying "absent" about it is how the seed script's refuse-if-exists guard and
 * this client end up disagreeing about the same document.
 */
export function sourceFromGet(ok: boolean, body: unknown): SolverConfigSource {
  if (!ok || !isObj(body)) return { status: "error", message: READ_FAILED_MESSAGE };
  if (body.present === false) return { status: "absent", config: DEFAULT_SOLVER_CONFIG };
  if (body.present !== true) return { status: "error", message: READ_FAILED_MESSAGE };
  const rev = typeof body.rev === "string" && body.rev.length ? body.rev : null;
  if (rev === null) return { status: "error", message: READ_FAILED_MESSAGE };
  // Normalised through the SAME reader the route uses, because this payload
  // crossed a wire and a partially-`undefined` config white-screens the config
  // step's own first render (`MemberPool`, `RuleBuilder` iterate it raw).
  return {
    status: "ready",
    rev,
    config: solverConfigFromDocument(body.config),
    // No version, or not a number, is the pre-C3 server: version 1.
    configVersion: typeof body.configVersion === "number" ? body.configVersion : 1,
  };
}

/** A `ready` source whose server speaks another config version — saving is off (C3 §6.2). */
export function isOutdatedSource(source: SolverConfigSource): boolean {
  return source.status === "ready" && source.configVersion !== SOLVER_CONFIG_VERSION;
}

/** The pair the route refused, named from the config this tab SENT (C3 §6.2). */
function exactOverlapRefusal(sent: SolverConfig | undefined, restriction: number, cap: number): string {
  const pairs = sent ? exactCapOverlaps(sent) : [];
  const pair = pairs.find((p) => p.later.restriction === restriction && p.later.cap === cap) ?? pairs[0];
  const firstCap = pair && sent?.restrictions[pair.first.restriction]?.caps[pair.first.cap];
  if (!pair || !firstCap) return EXACT_OVERLAP_UNPAIRED_MESSAGE;
  return exactOverlapRefusalMessage({ role: pair.roles[0], person: pair.person, rule: capLabel(firstCap) });
}

/**
 * Why a POST failed, in the admin's language — branching on the machine code
 * (`serviceMutation.ts`), never on the prose.
 *
 * `sent` is the config the POST carried: an `:exact_overlap` refusal is named
 * by running `exactCapOverlaps` over it (C3 §6.2) — the same function the route
 * ran, so the pair it names is the pair the route refused.
 */
export function saveFailure(
  status: number,
  body: unknown,
  sent?: SolverConfig,
): { message: string; stale: boolean } {
  const code = isObj(body) && typeof body.error === "string" ? body.error : "";
  if (code === "stale_revision") return { message: SAVE_STALE_MESSAGE, stale: true };
  if (code === "not_found") return { message: SAVE_ABSENT_MESSAGE, stale: false };
  if (code === "invalid_request") {
    const details = isObj(body) && isObj(body.details) ? body.details : {};
    const issues = Array.isArray(details.issues)
      ? details.issues.filter((i): i is string => typeof i === "string")
      : [];
    // `stale: false` on both: «Recargar reglas» would re-read through this same
    // bundle, which can never produce a body the route accepts.
    if (issues.includes("configVersion")) return { message: SAVE_OUTDATED_TAB_MESSAGE, stale: false };
    for (const issue of issues) {
      const m = EXACT_OVERLAP_ISSUE.exec(issue);
      if (m) return { message: exactOverlapRefusal(sent, Number(m[1]), Number(m[2])), stale: false };
    }
    return { message: SAVE_REJECTED_MESSAGE, stale: false };
  }
  if (status === 403) return { message: SAVE_FORBIDDEN_MESSAGE, stale: false };
  return { message: `${SAVE_FAILED_MESSAGE} (error ${status})`, stale: false };
}

/**
 * The rules the **rule panel** shows and lets an admin edit — `null` when there
 * is nothing honest to show.
 *
 * `absent` yields the defaults so a fresh environment still has something to
 * look at and seed from; `loading`/`error` yield `null`, and the panel renders
 * the reason instead. Returning the defaults there is the collapse this whole
 * module exists to prevent.
 */
export function editableConfig(source: SolverConfigSource): SolverConfig | null {
  if (source.status === "ready" || source.status === "absent") return source.config;
  return null;
}

/** Key-order-independent JSON, so "has this changed?" cannot turn on field order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Do these two rule sets say the same thing?
 *
 * By CONTENT and not by reference, so an edit undone by hand goes back to
 * "Guardado" instead of offering to write a document that would not change —
 * and so a save's canonical round trip (the server re-orders nothing, but it
 * does drop blanks and de-duplicate) settles rather than reading as dirty.
 */
export function sameSolverConfig(a: SolverConfig, b: SolverConfig): boolean {
  return stableJson(a) === stableJson(b);
}
