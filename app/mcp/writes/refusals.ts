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
import type { PublishVerdictReason } from "@/app/utils/publishVerdict";
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
  // `/admin`'s planner marks such a role `invalid_lock` and read-only, and its
  // edit path runs the same coordination, so only Studio can repair it.
  lock_vacant:
    "El dato de coordinación del fin de semana está libre aunque el servicio existe; /admin no puede repararlo, corrígelo en Studio.",
  claimed_without_role: "El dato de coordinación del fin de semana no indica a qué servicio pertenece.",
  lock_wrong_owner: "El dato de coordinación del fin de semana pertenece a otro servicio.",
};

/**
 * Machine issue codes the writers' parsers and guards emit, in Spanish.
 *
 * The STATIC tokens below (`payload`, `mode`, `roles`, …) are the request
 * PARSERS' own vocabulary (`publishReadyBundle.ts`'s `parseUnpublishRequest`/
 * `parsePublishReadyRequest`, `roleWriteRequest.ts`'s `parseSwapRequest`,
 * `setlistWriteRequest.ts`'s `parseSetlistWriteRequest`) — every fixed string
 * their `fail([...])` calls can return. A schema-valid but domain-invalid
 * request (e.g. a `serviceId` the tool's own schema check missed) reaches one
 * of these; without an entry it would read as a bare, untranslated token
 * (`issueCopyCoverage.test.ts` fails if a parser gains one this map has no
 * entry for). The PARAMETERIZED families just below (`roles[0].id`, a swap's
 * `source.rev`, a setlist's `songs[2].songId`, …) cannot be exact keys here —
 * they are translated by regex in `issueSentences`, below.
 */
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
  // The publish/unpublish request parsers.
  payload: "La solicitud no tiene el formato esperado.",
  mode: "El modo de la solicitud no es válido.",
  published: "El valor de «published» en la solicitud no es válido.",
  acknowledged_blockers: "Los bloqueos reconocidos en la solicitud no son válidos.",
  roles: "La lista de servicios de la solicitud no es válida.",
  batch_size: "La solicitud incluye demasiados servicios a la vez.",
  role_id: "El id de un servicio en la solicitud no es válido.",
  duplicate_role_id: "La solicitud repite el mismo servicio más de una vez.",
  role_rev: "La revisión de un servicio en la solicitud no es válida.",
  // The swap request parser.
  kind: "El tipo de intercambio en la solicitud no es válido.",
  path: "La posición del asiento en la solicitud no es válida.",
  // The setlist-save request parser.
  type: "El tipo de servicio en la solicitud no es válido.",
  roleId: "El id del servicio en la solicitud no es válido.",
  observed: "El estado observado en la solicitud no tiene un formato válido.",
  "observed.state": "El estado observado en la solicitud no es válido.",
  "observed.id": "El id observado en la solicitud no es válido.",
  "observed.rev": "La revisión observada en la solicitud no es válida.",
  songs: "La lista de canciones de la solicitud no es válida.",
};

const SONG_LEADS_ISSUE = /^songs\[(\d+)\]\.leadIds$/;
/** A malformed song row itself (not one of its fields). */
const SONG_ROW_ISSUE = /^songs\[(\d+)\]$/;
const SONG_FIELD_LABEL: Readonly<Record<string, string>> = {
  songId: "El id",
  play_key: "El tono",
  medley_tag: "La etiqueta de medley",
};
const SONG_FIELD_ISSUE = /^songs\[(\d+)\]\.(songId|play_key|medley_tag)$/;
/** A malformed role selection itself, in a swap's `roles` pair (not one of its fields). */
const ROLE_SELECTION_ISSUE = /^roles\[(\d+)\]$/;
const ROLE_SELECTION_FIELD_LABEL: Readonly<Record<string, string>> = { id: "El id", rev: "La revisión" };
const ROLE_SELECTION_FIELD_ISSUE = /^roles\[(\d+)\]\.(id|rev)$/;
/** A malformed seat selection itself, in a swap's `source`/`target` (not one of its fields). */
const SEAT_SIDE_ISSUE = /^(source|target)$/;
const SEAT_SIDE_LABEL: Readonly<Record<string, string>> = { source: "de origen", target: "de destino" };
const SEAT_SIDE_FIELD_LABEL: Readonly<Record<string, string>> = {
  roleId: "El id del servicio",
  rev: "La revisión observada del servicio",
  path: "La posición del asiento",
  itemKey: "La clave del asiento",
};
const SEAT_SIDE_FIELD_ISSUE = /^(source|target)\.(roleId|rev|path|itemKey)$/;

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
    const songField = SONG_FIELD_ISSUE.exec(issue);
    const songRow = SONG_ROW_ISSUE.exec(issue);
    const roleField = ROLE_SELECTION_FIELD_ISSUE.exec(issue);
    const roleRow = ROLE_SELECTION_ISSUE.exec(issue);
    const seatField = SEAT_SIDE_FIELD_ISSUE.exec(issue);
    const seatSide = SEAT_SIDE_ISSUE.exec(issue);
    if (lead) {
      out.push(
        `Los líderes de la canción ${Number(lead[1]) + 1} no son válidos: solo una Noche de alabanza lleva líderes por canción, y cada uno tiene que estar en Lead.`,
      );
    } else if (songField) {
      out.push(`${SONG_FIELD_LABEL[songField[2]]} de la canción ${Number(songField[1]) + 1} no tiene un valor válido.`);
    } else if (songRow) {
      out.push(`La canción en la posición ${Number(songRow[1]) + 1} no tiene un formato válido.`);
    } else if (roleField) {
      out.push(
        `${ROLE_SELECTION_FIELD_LABEL[roleField[2]]} del servicio en la posición ${Number(roleField[1]) + 1} no tiene un valor válido.`,
      );
    } else if (roleRow) {
      out.push(`El servicio en la posición ${Number(roleRow[1]) + 1} no tiene un formato válido.`);
    } else if (seatField) {
      out.push(`${SEAT_SIDE_FIELD_LABEL[seatField[2]]} ${SEAT_SIDE_LABEL[seatField[1]]} no tiene un valor válido.`);
    } else if (seatSide) {
      out.push(`El asiento ${SEAT_SIDE_LABEL[seatSide[1]]} no tiene un formato válido.`);
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
 * Every reason `publishRowText` recognizes on the wire at all: `publishVerdict`'s
 * own reasons plus `not_found` (a missing service can appear as a row too,
 * F10). Used only to FILTER `row.reasons: string[]` down to known tokens before
 * anything else runs — an unrecognized wire token contributes nothing (never a
 * crash, never invented copy). A `Record`, not a `Set` literal: a
 * `PublishVerdictReason` this object is MISSING a key for fails `tsc` here. That
 * alone is NOT the exhaustiveness guarantee, though — see `LOOP_REASON_ORDER`
 * and the `switch` below, which is what actually forces a branch.
 */
type PublishRowReason = PublishVerdictReason | "not_found";
const KNOWN_PUBLISH_ROW_REASONS: Record<PublishRowReason, true> = {
  not_found: true,
  hard_integrity_blocker: true,
  unusable_observation: true,
  already_published: true,
  stale_revision: true,
  not_ready: true,
  blocker_set_changed: true,
};

/**
 * Every reason `publishRowText`'s loop below switches over, in the order it
 * emits copy for — every recognized reason EXCEPT `stale_revision`, which the
 * function always handles last (outside the loop), after the conditional
 * override note: its own wording depends on whether anything else was already
 * said, a fact about the whole row rather than a blocker of its own.
 *
 * This is ALSO a `Record`, so a new `PublishVerdictReason` member is a missing
 * key here too — but unlike `KNOWN_PUBLISH_ROW_REASONS` above, that is not
 * where the guarantee ends: the loop's `switch` ends in
 * `default: assertNeverPublishRowReason(reason)`, so adding the key here
 * WITHOUT adding a matching `case` in the switch still fails `tsc`, on that
 * line. A `Record`'s missing-key check alone only proves a key exists; the
 * switch is what proves it has real copy.
 */
const LOOP_REASON_ORDER: Record<Exclude<PublishRowReason, "stale_revision">, true> = {
  not_found: true,
  already_published: true,
  hard_integrity_blocker: true,
  unusable_observation: true,
  not_ready: true,
  blocker_set_changed: true,
};
const ORDERED_LOOP_REASONS = Object.keys(LOOP_REASON_ORDER) as Exclude<PublishRowReason, "stale_revision">[];

/** Unreachable as long as every `LOOP_REASON_ORDER` member has a `case` below. */
function assertNeverPublishRowReason(reason: never): never {
  throw new Error(`publishRowText: reason without copy: ${String(reason)}`);
}

/**
 * The text for one service's publish refusal. Order: «ya está publicado»
 * first (a retry of a publish that landed reads as that, not as a conflict),
 * then the blockers, then a bare stale revision.
 *
 * ALREADY PUBLISHED CHANGES WHAT THE OTHER REASONS MEAN. A live service is not
 * waiting to be published, so beside `already_published` every other blocker is
 * reported as INFORMATION ONLY — never with a "cannot publish (yet)" lead-in,
 * and never with `PUBLISH_OVERRIDE_NOTE` (there is nothing to override: this
 * service is not blocked from publishing, it already published).
 */
function publishRowText(row: PublishServiceRefusal): string[] {
  const reasons = new Set(
    row.reasons.filter((r): r is PublishRowReason => r in KNOWN_PUBLISH_ROW_REASONS),
  );
  const parts: string[] = [];
  const alreadyPublished = reasons.has("already_published");
  let blocked = false;

  for (const reason of ORDERED_LOOP_REASONS) {
    if (!reasons.has(reason)) continue;
    switch (reason) {
      case "not_found":
        // One wording for a missing service, whether it arrives as a row or as the 404.
        parts.push(CODE_COPY.not_found);
        break;
      case "already_published":
        parts.push(sentence(refusalCopy("already_published")));
        break;
      case "hard_integrity_blocker": {
        const list = blockerCopy(row.hardBlockers ?? []);
        if (alreadyPublished) {
          parts.push(
            list
              ? `Además, hay un problema de integridad: ${list}.`
              : `Además, ${refusalCopy("hard_integrity_blocker")}.`,
          );
        } else {
          parts.push(
            list
              ? `No se puede publicar por un problema de integridad: ${list}.`
              : sentence(refusalCopy("hard_integrity_blocker")),
          );
          blocked = true;
        }
        break;
      }
      case "unusable_observation":
        parts.push(
          alreadyPublished
            ? `Además, ${refusalCopy("unusable_observation")}.`
            : sentence(refusalCopy("unusable_observation")),
        );
        if (!alreadyPublished) blocked = true;
        break;
      case "not_ready": {
        const list = blockerCopy(row.workflowBlockers ?? []);
        if (alreadyPublished) {
          parts.push(list ? `Además, sigue con pendientes de flujo: ${list}.` : `Además, ${refusalCopy("not_ready")}.`);
        } else {
          parts.push(list ? `No se puede publicar todavía: ${list}.` : sentence(refusalCopy("not_ready")));
          blocked = true;
        }
        break;
      }
      case "blocker_set_changed":
        parts.push("Los bloqueos cambiaron desde que los revisaste; vuelve a leer con get_service.");
        break;
      default:
        assertNeverPublishRowReason(reason);
    }
  }
  // Overriding a live service makes no sense: never on an already-published row.
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
    // Every row's reasons were unrecognized (a future verdict reason this file
    // has not yet grown a branch for): never fall through to a bare «No se
    // escribió nada.» — fall back to the top-level code's own copy.
    return refusalResult(withNothingWritten(parts.length ? parts : [CODE_COPY[code]]), content);
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
  if (typeof details.detail === "string") content.detail = details.detail;
  if (MAINTENANCE_CODES.has(code)) {
    // The exact text, and nothing appended: the detail still travels as a code.
    return refusalResult(CODE_COPY[code], content);
  }
  const parts = [CODE_COPY[code]];
  if (typeof details.detail === "string") {
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
