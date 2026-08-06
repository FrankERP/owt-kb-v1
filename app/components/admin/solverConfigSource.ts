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
import type { SolverConfig } from "./plannerModel";
import { solverConfigFromDocument } from "@/app/utils/solverConfigWriteRequest";

export const SOLVER_CONFIG_ENDPOINT = "/api/admin/solver-config";

export type SolverConfigSource =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "absent"; config: SolverConfig }
  | { status: "ready"; rev: string; config: SolverConfig };

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
  return { status: "ready", rev, config: solverConfigFromDocument(body.config) };
}

/**
 * Why a POST failed, in the admin's language — branching on the machine code
 * (`serviceMutation.ts`), never on the prose.
 */
export function saveFailure(status: number, body: unknown): { message: string; stale: boolean } {
  const code = isObj(body) && typeof body.error === "string" ? body.error : "";
  if (code === "stale_revision") return { message: SAVE_STALE_MESSAGE, stale: true };
  if (code === "not_found") return { message: SAVE_ABSENT_MESSAGE, stale: false };
  if (code === "invalid_request") return { message: SAVE_REJECTED_MESSAGE, stale: false };
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
