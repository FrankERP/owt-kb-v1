// app/mcp/writes/refusals.ts — the Spanish refusal every MCP write tool returns
// (P3 step 7). NEUTRAL: no `server-only`, no Sanity import.
//
// Two builders, one shape:
//
//   { isError: true,
//     content: [{ type: "text", text }],
//     structuredContent: { refused: true, code, detail?, services?, issues? } }
//
//  - `refusalFor(outcome)` translates a `*Commit` domain refusal — exactly the
//    `{ ok: false, status, body }` the admin route would have sent. `code` is
//    the route's own top-level `body.error`, so an inherited gate (§ «Admin
//    surface gates», `inherited` rows) refuses with the route's code.
//  - `admissionRefusal(code, detail, text)` is for a refusal the TOOL makes
//    before it calls the domain (the `mirror` rows). `code` comes from the
//    writers' own vocabulary and `detail` names the gate (`invalid_content`,
//    `duplicate_song`, `cross_month`, `duplicate_special_identity`,
//    `lock:missing_lock`, …).
//
// EVERY TEXT ENDS WITH «No se escribió nada.» — with two exceptions, both from
// the legacy-lock maintenance write (`resolveOwnedCoordination`), which can
// COMMIT before it refuses:
//   - `bootstrap_completed_reload`: something WAS written (a coordination
//     document), but not the change;
//   - `bootstrap_outcome_unknown`: whether it was written is unknown.
// A body whose `error` is not a registered service code (the recovery-only
// `503 unknown_outcome`, which no tool requests) is never «No se escribió
// nada.» either: it reads as the runner's unknown-outcome text.
//
// A PUBLISH REFUSAL IS KEYED ON ITS PER-SERVICE REASONS (F10). The publish
// writer answers a service refused only for `not_ready` or `already_published`
// with a top-level `409 stale_revision`, and puts the real reasons in
// `details.services[].reasons`. Read by its top-level code alone, a blocker
// would read as "re-read and retry". So the order is: `details.services[]
// .reasons` first, then `details.guard` (the commit race), then the
// assertion-stage keys, and only then the top-level code. Blocker copy is the
// admin's own `PUBLISH_SKIP_COPY` and `publishRefusal.ts`'s `refusalCopy` —
// the same words `get_service` shows — never retyped here.
//
// Nothing from the dataset's internals reaches a text: `details` carries the
// writers' own machine codes (reasons, blockers, issues, details), and ids are
// never copied into the text. No Sanity message ever travels in a refusal body.

import type { CallToolResult } from "@modelcontextprotocol/server";
import { SERVICE_ERROR_CODES, type ServiceErrorCode } from "@/app/utils/serviceMutation";
import type { CommitOutcome } from "@/app/utils/commitOutcome";
import { PUBLISH_SKIP_COPY } from "@/app/components/admin/serviceCardModel";
import type { PublishSkipReason } from "@/app/components/admin/publishSelection";
import { refusalCopy } from "../reads/publishRefusal";
import { WRITE_UNKNOWN_OUTCOME_MESSAGE } from "./runWriteTool";

/** The sentence every refusal that wrote nothing ends with. */
export const NOTHING_WRITTEN = "No se escribió nada.";

/** A maintenance write landed, the change did not. Deliberately NOT «No se escribió nada.». */
export const BOOTSTRAP_COMPLETED_RELOAD_MESSAGE =
  "Se reparó un dato interno de coordinación del servicio, pero tu cambio NO se aplicó. Vuelve a leer con get_service y reintenta.";

/** Whether a maintenance write landed is unknown. Deliberately NOT «No se escribió nada.». */
export const BOOTSTRAP_OUTCOME_UNKNOWN_MESSAGE =
  "No se pudo confirmar una reparación interna. No reintentes; revísalo en /admin.";

/** The re-read instruction a stale observation gets. */
export const STALE_COPY = "El servicio cambió desde que lo leíste; vuelve a leer con get_service.";

/**
 * Appended to a publish refusal that names blockers (step 9's wording). A
 * workflow blocker can be overridden only in `/admin`; an integrity blocker
 * cannot be overridden at all. It is here, beside the blocker copy, so a tool
 * never adds it a second time.
 */
export const PUBLISH_OVERRIDE_NOTE =
  "Publicar con bloqueos de flujo sólo se puede hacer en /admin; los de integridad no se pueden forzar.";

/** One sentence per registered code. `tsc` fails here when the writers gain a code. */
const CODE_COPY: Record<ServiceErrorCode, string> = {
  idempotency_mismatch: "Esa solicitud de creación ya se usó con otros datos.",
  idempotency_key_retired:
    "Esa solicitud de creación pertenece a un servicio eliminado y no se puede reutilizar.",
  bootstrap_completed_reload: BOOTSTRAP_COMPLETED_RELOAD_MESSAGE,
  bootstrap_outcome_unknown: BOOTSTRAP_OUTCOME_UNKNOWN_MESSAGE,
  target_has_orphaned_dependencies:
    "El destino ya tiene historial de setlist o de propuestas, que no se adopta automáticamente.",
  role_date_has_dependencies: "La fecha actual o la nueva tienen historial de setlist o de propuestas.",
  role_has_dependencies: "El servicio tiene historial de setlist o de propuestas.",
  legacy_approval_unverified: "La propuesta está aprobada pero no tiene un recibo de aprobación verificable.",
  stale_revision: STALE_COPY,
  ambiguous_target:
    "El servicio no corresponde a un único documento (hay duplicados); corrígelo en /admin o en Studio.",
  integrity_conflict:
    "Los datos guardados del servicio no pasan una verificación de integridad; revísalo en /admin o en Studio.",
  invalid_request: "La solicitud no es válida.",
  forbidden: "No tienes permiso para este cambio.",
  not_found: "El servicio no existe; vuelve a buscarlo con list_services.",
};

/** The two codes whose text is complete on its own and never ends with «No se escribió nada.». */
const MAINTENANCE_CODES: ReadonlySet<ServiceErrorCode> = new Set([
  "bootstrap_completed_reload",
  "bootstrap_outcome_unknown",
]);

/**
 * `details.detail` values the four writers and their loaders emit, in Spanish.
 * An unknown detail is not translated; it still travels in `structuredContent`.
 */
const DETAIL_COPY: Readonly<Record<string, string>> = {
  // The setlist writer's observed-target comparison and commit conflict.
  concurrent_creation: "Alguien creó el setlist mientras tanto.",
  revision_moved: "Alguien guardó un cambio mientras tanto.",
  target_vanished: "El setlist que leíste ya no existe.",
  identity_mismatch: "El setlist guardado ya no es el que leíste.",
  revision_mismatch: "El setlist se guardó otra vez desde que lo leíste.",
  target_identity: "No se pudo identificar el documento que se iba a escribir.",
  // The write-target loaders.
  setlist_draft_conflict:
    "Hay un borrador de Studio sobre este setlist; descártalo o publícalo en Studio y vuelve a leer.",
  setlist_malformed: "El setlist guardado está mal formado.",
  role_draft_conflict:
    "Hay un borrador de Studio sobre este servicio; descártalo o publícalo en Studio y vuelve a leer.",
  role_malformed: "El registro del servicio está mal formado.",
  // The swap writer.
  hidden_saturday_chorus:
    "Un sábado con Coro guardado no se puede intercambiar (el Coro no se muestra en sábado); corrígelo en Studio.",
  role_unresolved: "No se pudo resolver uno de los servicios.",
  seat_arrays: "Los asientos guardados de uno de los servicios están mal formados.",
  // The unpublish writer.
  unexpected_type: "El documento no es un servicio que se pueda publicar u ocultar.",
  // The weekend coordination token (`planOwnedLock`).
  not_a_weekend_target: "El dato de coordinación no corresponde a un servicio de fin de semana.",
  lock_vacant: "El dato de coordinación del fin de semana está libre; guárdalo una vez desde /admin.",
  claimed_without_role: "El dato de coordinación del fin de semana no indica a qué servicio pertenece.",
  lock_wrong_owner: "El dato de coordinación del fin de semana pertenece a otro servicio.",
};

/** Machine issue codes the writers' parsers and guards emit, in Spanish. */
const ISSUE_COPY: Readonly<Record<string, string>> = {
  incompatible_team_topology:
    "No se puede intercambiar el equipo completo entre un sábado y un servicio que no es sábado.",
  incompatible_section_topology: "El Coro no se puede intercambiar con un sábado (el sábado no tiene Coro).",
  identical_selection: "Los dos servicios son el mismo.",
  rev_disagreement: "Se enviaron dos revisiones distintas para el mismo servicio.",
  songs_length: "Un setlist admite como máximo 60 canciones.",
  _type: "El documento no es un servicio de alabanza.",
  date: "El servicio no tiene una fecha válida.",
  week: "La fecha del servicio no es válida.",
};

const SONG_LEADS_ISSUE = /^songs\[(\d+)\]\.leadIds$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isServiceErrorCode(v: unknown): v is ServiceErrorCode {
  return typeof v === "string" && (SERVICE_ERROR_CODES as readonly string[]).includes(v);
}

/** A copy fragment (`"el servicio no existe"`) as a sentence (`"El servicio no existe."`). */
function sentence(fragment: string): string {
  const trimmed = fragment.trim();
  if (!trimmed) return "";
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** Joins the sentences and ends them with «No se escribió nada.», exactly once. */
function withNothingWritten(parts: string[]): string {
  const text = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (text.endsWith(NOTHING_WRITTEN)) return text;
  return text ? `${text} ${NOTHING_WRITTEN}` : NOTHING_WRITTEN;
}

function issueSentences(issues: readonly string[]): string[] {
  const out: string[] = [];
  const untranslated: string[] = [];
  for (const issue of issues) {
    const lead = SONG_LEADS_ISSUE.exec(issue);
    if (lead) {
      out.push(
        `Los líderes de la canción ${Number(lead[1]) + 1} no son válidos: solo una Noche de alabanza lleva líderes por canción, y cada uno tiene que estar en Lead.`,
      );
    } else if (ISSUE_COPY[issue]) {
      out.push(ISSUE_COPY[issue]);
    } else {
      untranslated.push(issue);
    }
  }
  if (untranslated.length) out.push(`Detalle técnico: ${untranslated.join(", ")}.`);
  return out;
}

// ── The publish writer's per-service rows ───────────────────────────────────

/** A per-service rejection row as the publish writer reports it, reduced to machine codes. */
export interface PublishServiceRefusal {
  id: string;
  reasons: string[];
  hardBlockers?: string[];
  workflowBlockers?: string[];
}

function publishRows(details: Record<string, unknown>): PublishServiceRefusal[] | null {
  if (!Array.isArray(details.services)) return null;
  const rows: PublishServiceRefusal[] = [];
  for (const raw of details.services) {
    if (!isObj(raw) || typeof raw.id !== "string" || !Array.isArray(raw.reasons)) continue;
    const row: PublishServiceRefusal = { id: raw.id, reasons: strings(raw.reasons) };
    if (Array.isArray(raw.hardBlockers)) row.hardBlockers = strings(raw.hardBlockers);
    if (Array.isArray(raw.workflowBlockers)) row.workflowBlockers = strings(raw.workflowBlockers);
    rows.push(row);
  }
  return rows.length ? rows : null;
}

function blockerCopy(codes: readonly string[]): string {
  return codes
    .map((code) => (code in PUBLISH_SKIP_COPY ? PUBLISH_SKIP_COPY[code as PublishSkipReason] : code))
    .join("; ");
}

/**
 * The text for one service's publish refusal. Order: «ya está publicado»
 * first (a retry of a publish that landed reads as that, not as a conflict),
 * then the blockers with no retry advice, then a bare stale revision.
 */
function publishRowText(row: PublishServiceRefusal): string[] {
  const reasons = new Set(row.reasons);
  const parts: string[] = [];
  if (reasons.has("not_found")) parts.push(sentence(refusalCopy("not_found")));
  if (reasons.has("already_published")) parts.push(sentence(refusalCopy("already_published")));

  let blocked = false;
  if (reasons.has("hard_integrity_blocker")) {
    const list = blockerCopy(row.hardBlockers ?? []);
    parts.push(
      list
        ? `No se puede publicar por un problema de integridad: ${list}.`
        : sentence(refusalCopy("hard_integrity_blocker")),
    );
    blocked = true;
  }
  if (reasons.has("unusable_observation")) {
    parts.push(sentence(refusalCopy("unusable_observation")));
    blocked = true;
  }
  if (reasons.has("not_ready")) {
    const list = blockerCopy(row.workflowBlockers ?? []);
    parts.push(list ? `No se puede publicar todavía: ${list}.` : sentence(refusalCopy("not_ready")));
    blocked = true;
  }
  if (reasons.has("blocker_set_changed")) {
    parts.push("Los bloqueos cambiaron desde que los revisaste; vuelve a leer con get_service.");
  }
  if (blocked) parts.push(PUBLISH_OVERRIDE_NOTE);

  if (reasons.has("stale_revision")) {
    // Alone, it is the re-read instruction. Beside a blocker or «ya está
    // publicado», it is only a fact: re-reading will not clear a blocker.
    parts.push(
      parts.length ? "Además, el servicio cambió desde que lo leíste." : STALE_COPY,
    );
  }
  return parts;
}

// ── The builders ────────────────────────────────────────────────────────────

/** A domain refusal: the failure branch of a `*Commit` outcome. */
export type DomainRefusal = Extract<CommitOutcome<unknown>, { ok: false }>;

export interface RefusalContent extends Record<string, unknown> {
  refused: true;
  code: string;
  detail?: string;
  services?: PublishServiceRefusal[];
  issues?: string[];
}

function refusalResult(text: string, content: RefusalContent): CallToolResult {
  return { isError: true, content: [{ type: "text", text }], structuredContent: content };
}

/**
 * The Spanish tool result for a `*Commit` refusal. Reads, in order,
 * `details.services[].reasons` (the publish writer), `details.guard` (a publish
 * commit race), the assertion-stage keys, and only then the top-level code with
 * its `details.detail` and `details.issues`.
 */
export function refusalFor(outcome: DomainRefusal): CallToolResult {
  const body: Record<string, unknown> = isObj(outcome.body) ? outcome.body : {};
  const details: Record<string, unknown> = isObj(body.details) ? body.details : {};

  if (!isServiceErrorCode(body.error)) {
    // Not a refusal this contract knows (the recovery-only 503): never claim
    // that nothing was written.
    return refusalResult(WRITE_UNKNOWN_OUTCOME_MESSAGE, { refused: true, code: "unknown_outcome" });
  }
  const code = body.error;
  const issues = strings(details.issues);
  const content: RefusalContent = { refused: true, code };
  if (issues.length) content.issues = issues;

  // 1. The publish writer's per-service reasons (F10).
  const rows = publishRows(details);
  if (rows) {
    content.services = rows;
    const parts = rows.length === 1 ? publishRowText(rows[0]) : rows.flatMap(publishRowText);
    return refusalResult(withNothingWritten(parts), content);
  }

  // 2. The publish commit race: the guard bundle lost to a concurrent edit.
  if (typeof details.guard === "string") {
    content.detail = details.guard;
    return refusalResult(withNothingWritten([STALE_COPY]), content);
  }

  // 3. The publish writer's assertion stage.
  for (const key of ["assertionIssues", "mergeIssues", "planIssues"] as const) {
    if (key in details) {
      content.detail = key;
      return refusalResult(
        withNothingWritten([
          CODE_COPY.integrity_conflict,
          "La verificación de revisiones que protege la publicación no se pudo construir (un documento relacionado está incompleto).",
        ]),
        content,
      );
    }
  }

  // 4. Everything else, by the top-level code.
  if (MAINTENANCE_CODES.has(code)) {
    return refusalResult(CODE_COPY[code], content);
  }
  const parts = [CODE_COPY[code]];
  if (typeof details.detail === "string") {
    content.detail = details.detail;
    if (DETAIL_COPY[details.detail]) parts.push(DETAIL_COPY[details.detail]);
  } else if (Array.isArray(details.rawDrafts) && details.rawDrafts.length) {
    parts.push(DETAIL_COPY.role_draft_conflict);
  } else if (Array.isArray(details.danglingRefs) && details.danglingRefs.length) {
    parts.push("Una de las personas que se moverían ya no existe como miembro.");
  }
  parts.push(...issueSentences(issues));
  return refusalResult(withNothingWritten(parts), content);
}

/**
 * A refusal the tool makes itself, before calling the domain (an admission or
 * input gate). `text` names the service and the gate; «No se escribió nada.»
 * is appended — nothing has been written, because the domain was never called.
 */
export function admissionRefusal(
  code: ServiceErrorCode,
  detail: string,
  text: string,
  extra: { issues?: string[] } = {},
): CallToolResult {
  const content: RefusalContent = { refused: true, code, detail };
  if (extra.issues?.length) content.issues = [...extra.issues];
  return refusalResult(withNothingWritten([text]), content);
}
