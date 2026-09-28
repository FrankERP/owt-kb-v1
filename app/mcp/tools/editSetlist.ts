// MCP tool `edit_setlist` (P3 step 11): replace ONE service's setlist through
// the same domain writer `/admin`'s setlist editor calls — `saveSetlist`
// (`app/utils/setlistSaveCommit.ts`) — via the write foundation's
// `runWriteTool`/`callDomain` (step 7), producing the body the editor would send
// for the same intent.
//
// INPUT (strict). `{ serviceId, roleRev, observed, rows }`: `roleRev` and
// `observed` are `get_service`'s `observations.roleRev` / `observations.setlist`,
// verbatim. The schema accepts all six of P1's observation shapes, so an echoed
// `draft_overlay` gets a Spanish refusal instead of the SDK's English validation
// error; only `none` and `single` are writable (P1's ruling, docs/MCP.md). A row
// is a stored row named by its `_key` (`rowKey`) or a new row named by its song
// (`songId`); the translation is `../writes/setlistRows.ts`. `key` is at most 24
// characters (E-key). Every shape check runs again inside the handler, so a
// direct call — every test in this file's suite — refuses in Spanish with zero
// reads.
//
// RESOLUTION (the tool's pre-read; plan step 11, § «Admin surface gates»):
//   1. `loadCanonicalRole(serviceId)` must be one canonical service role, at
//      `roleRev`. That check is the tool's own and stricter than `/admin`: it
//      also covers a special in `none` state (whose observation has no rev) and
//      a weekend role whose date moved (the tool derives the week from the role,
//      so it would otherwise write the new date's setlist).
//   2. kind, week (`storedRoleDate`) and whether it is a worship night — which,
//      as in the writer, only a special can be.
//   3. the stored rows through the WRITER's own loader
//      (`loadWeekendSetlistTarget` / `loadSpecialSetlistTarget`). A loader
//      failure is refused with the route's own code (`refusalFor` over the same
//      `serviceError` the writer builds).
//   4. `compareObservedTarget`, the writer's own comparison: a mismatch is the
//      writer's own `stale_revision` refusal, byte for byte, before any body is
//      built.
//   5. `observed.rowKeys` must equal the stored `_key`s, in order.
//   6. E1, the editor's content gate: `setlistContentState` over
//      `record?.songs ?? []` (ruling P3-R3: an absent field is `empty`), with a
//      resolver answered by ONE `loadSongTitles` read — a published `post`.
//      `invalid` refuses with the editor's own copy, imported. After 4–5, so a
//      stale observation is reported as stale first, as the route orders it.
//   7. E4: every new `songId` must be a published `post`.
//   Then the translation (E3, E5, E6, E-key, F6) and, on a worship night only,
//   E7: every lead id the body sends, carried or explicit, must be a canonical
//   member. On any other service E7 is skipped (ruling P3-R24): an explicit
//   leader list there is forwarded whatever it names, the writer's
//   `validateSongLeads` refuses the whole request, and the tool words that
//   refusal itself (F6). Checking membership first would name a missing member
//   and advise changing `leads`, a fix F6 refuses as well.
//
// THE CALL. `{ week, type, roleId?, observed: { state, id?, rev? }, songs }`,
// with `roleId` only for a special, as `/admin` passes it. It goes through
// `saveSetlist`, which parses it with `parseSetlistWriteRequest` (D1), so every
// inherited gate refuses with the route's code through `refusalFor`.
//
// THE REPORT (after a commit; every read through `safeReportRead`, so none can
// turn a committed edit into «No se pudo confirmar…»):
//   - the rows as written (`effects.songs`), named by `get_service`'s own
//     presenter (`setlistContent`);
//   - notifications from the `effects` descriptors (`setlistSaveNotifications`);
//   - the repeat hint: the editor's own history read and fold;
//   - D8: a read-back through the same loaders. `observations` (the new
//     `roleRev` and setlist observation) are returned ONLY when the read-back is
//     exactly what this edit wrote — every row field by field against
//     `effects.songs`, a special's role otherwise unchanged, a weekend role still
//     at `roleRev`. Otherwise `changedAgainAfterSave: true` with the read-back as
//     `current`, and no observation; a failed read-back gives
//     `observations: null` with «vuelve a leer con get_service».
//
// `revalidateSetlistSave()` touches `/`, `/schedule` and the song pages; the text
// says so plainly.

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isCanonicalDocumentId, isRevisionString, storedRoleDate } from "@/app/utils/roleWriteRequest";
import { loadCanonicalMemberIds, loadCanonicalRole, type StoredRole } from "@/app/utils/roleWriteOps";
import { loadSpecialSetlistTarget, loadWeekendSetlistTarget } from "@/app/utils/serviceWriteTargets";
import {
  compareObservedTarget,
  setlistTypeForKind,
  SETLIST_SONGS_MAX,
  type ObservedTarget,
  type WeekendSetlistType,
} from "@/app/utils/setlistWriteRequest";
import { setlistContentState } from "@/app/utils/serviceReadModel";
import { SETLIST_READ_ISSUE_COPY } from "@/app/utils/setlistReadContract";
import { saveSetlist, type SetlistSaveEffects } from "@/app/utils/setlistSaveCommit";
import { serviceError, type ServiceErrorCode } from "@/app/utils/serviceMutation";
import type { CommitOutcome } from "@/app/utils/commitOutcome";
import { isWorshipNight } from "@/app/utils/serviceFormat";
import { leadSeatIds, songItemLeadIds, SONG_LEADS_MAX } from "@/app/utils/songLeads";
import { recentSongUses, weeksAgoIso } from "@/app/utils/setlistRecentSongs";
import { derivePublishState } from "@/app/components/admin/serviceReadiness";
import { serviceKindOf, setlistContent, type ServiceKind, type SetlistRow, type SetlistRun } from "../reads/servicePresenter";
import { loadSongTitles, type SongTitleLookup } from "../reads/songTitles";
import { loadRecentSetlists } from "../reads/recentSetlists";
import { admissionRefusal, NOTHING_WRITTEN, refusalFor, STALE_COPY, type RefusalContent } from "../writes/refusals";
import { runWriteTool, safeReportRead, WRITE_REREAD_RULE } from "../writes/runWriteTool";
import {
  OUTBOX_SWEEP_NOTE,
  audienceMember,
  memberLabel,
  resolveNotifications,
  safeMemberLookup,
  setlistSaveNotifications,
} from "../writes/reports";
import {
  buildSetlistBodyRows,
  isKeptRow,
  type SetlistBodyRow,
  type SetlistRowInput,
  type SetlistRowRefusal,
} from "../writes/setlistRows";
import { swapServiceLabel } from "../writes/swapAdmission";

// ── Input ───────────────────────────────────────────────────────────────────

/** The writer stores a longer `play_key` as blank (F11); the schema counts the raw string. */
export const SETLIST_KEY_MAX = 24;

const SERVICE_ID_MESSAGE = "serviceId no es un id de servicio válido; usa el que devuelve get_service.";
const ROLE_REV_MESSAGE = "roleRev no es una revisión válida; usa observations.roleRev de get_service.";
const OBSERVED_ID_MESSAGE = "observed.id no es válido; pasa observations.setlist de get_service tal cual.";
const OBSERVED_REV_MESSAGE = "observed.rev no es válido; pasa observations.setlist de get_service tal cual.";
const ROW_KEY_MESSAGE = "rowKey debe ser la clave de una fila guardada (observations.setlist.rowKeys de get_service).";
const SONG_ID_MESSAGE = "songId no es un id de canción válido; usa el que devuelve search_songs.";
export const KEY_MESSAGE = `key admite como máximo ${SETLIST_KEY_MAX} caracteres.`;
const MEDLEY_MESSAGE = "medleyTag no puede estar vacío; en una fila guardada usa null para quitar el enlace de medley.";
const LEAD_ID_MESSAGE = "leads lleva ids de miembros (los que devuelve get_service).";
const LEADS_MAX_MESSAGE = `leads admite como máximo ${SONG_LEADS_MAX} líderes por canción.`;
const LEADS_DISTINCT_MESSAGE = "leads no puede nombrar dos veces al mismo líder.";

/** The Spanish messages above: a shape refusal shows them as they are. */
const OWN_MESSAGES: ReadonlySet<string> = new Set([
  SERVICE_ID_MESSAGE,
  ROLE_REV_MESSAGE,
  OBSERVED_ID_MESSAGE,
  OBSERVED_REV_MESSAGE,
  ROW_KEY_MESSAGE,
  SONG_ID_MESSAGE,
  KEY_MESSAGE,
  MEDLEY_MESSAGE,
  LEAD_ID_MESSAGE,
  LEADS_MAX_MESSAGE,
  LEADS_DISTINCT_MESSAGE,
]);

const KEY = z.string().max(SETLIST_KEY_MAX, { message: KEY_MESSAGE });
const MEDLEY_TAG = z.string().refine((value) => value.trim().length > 0, { message: MEDLEY_MESSAGE });
const LEADS = z
  .array(z.string().refine(isCanonicalDocumentId, { message: LEAD_ID_MESSAGE }))
  .max(SONG_LEADS_MAX, { message: LEADS_MAX_MESSAGE })
  .refine((ids) => new Set(ids).size === ids.length, { message: LEADS_DISTINCT_MESSAGE });

const KEPT_ROW = z
  .object({
    rowKey: z.string().min(1, { message: ROW_KEY_MESSAGE }),
    key: KEY.nullable().optional(),
    medleyTag: MEDLEY_TAG.nullable().optional(),
    leads: LEADS.optional(),
  })
  .strict();

const NEW_ROW = z
  .object({
    songId: z.string().refine(isCanonicalDocumentId, { message: SONG_ID_MESSAGE }),
    key: KEY.optional(),
    medleyTag: MEDLEY_TAG.optional(),
    leads: LEADS.optional(),
  })
  .strict();

/** P1's six observation shapes (`SetlistObservation`), each strict. */
const OBSERVED = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }).strict(),
  z
    .object({
      state: z.literal("single"),
      id: z.string().refine(isCanonicalDocumentId, { message: OBSERVED_ID_MESSAGE }),
      rev: z.string().refine(isRevisionString, { message: OBSERVED_REV_MESSAGE }),
      rowKeys: z.array(z.string().nullable()),
    })
    .strict(),
  z.object({ state: z.literal("ambiguous"), ids: z.array(z.string()) }).strict(),
  z.object({ state: z.literal("draft_overlay"), draftIds: z.array(z.string()) }).strict(),
  z.object({ state: z.literal("invalid") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);

export const EDIT_SETLIST_INPUT = z
  .object({
    serviceId: z.string().refine(isCanonicalDocumentId, { message: SERVICE_ID_MESSAGE }),
    roleRev: z.string().refine(isRevisionString, { message: ROLE_REV_MESSAGE }),
    observed: OBSERVED,
    rows: z.array(z.union([KEPT_ROW, NEW_ROW])).max(SETLIST_SONGS_MAX),
  })
  .strict();

export type EditSetlistArgs = z.infer<typeof EDIT_SETLIST_INPUT>;
type Observed = EditSetlistArgs["observed"];

export const EDIT_SETLIST_DESCRIPTION =
  "Edita el setlist de UN servicio del equipo de alabanza, exactamente como el editor de setlist de /admin → " +
  "Servicios: reemplaza la lista completa por las filas que envías, en ese orden. Una fila guardada se nombra " +
  "por su rowKey (observations.setlist.rowKeys de get_service) y conserva su tonalidad, su enlace de medley y " +
  "sus líderes salvo que envíes key, medleyTag o leads (null quita la tonalidad o el enlace; leads: [] quita " +
  "los líderes). Una fila nueva se nombra por songId (de search_songs) y empieza vacía. Una fila guardada que no " +
  "envías se quita. No se puede añadir una canción que ya está en el setlist. key admite hasta 24 caracteres. " +
  "Un enlace de medley solo une canciones contiguas: envía la misma medleyTag en filas vecinas; un enlace que no " +
  "puede quedar junto se rechaza. Solo una Noche de alabanza lleva líderes por canción (uno o dos, que tienen " +
  "que estar en Lead). Necesita dos observaciones de get_service: roleRev (observations.roleRev) y observed " +
  "(observations.setlist), con serviceId (observations.roleId); pásalas SIN CAMBIOS, tal como llegaron; nunca " +
  "las construyas a mano. Rechaza cualquier setlist que /admin no abriría: solo escribe sobre uno en estado none " +
  "o single, nunca sobre ambiguous, draft_overlay, invalid o unknown, ni sobre uno con filas guardadas inválidas " +
  "(sin _key, con _key repetida o con una canción que no existe). Si el servicio o el setlist cambió desde que lo " +
  "leíste, no escribe nada y lo explica. En un servicio publicado avisa de inmediato, sin " +
  "confirmación, por push «Setlist de la semana» a los miembros con preferencia de setlist «todos» y a los " +
  "asignados a un servicio publicado esa semana, y encola un correo agrupado a los participantes (después de " +
  "la ventana de agrupación); un borrador no avisa a nadie. /, /schedule y las páginas de canciones se " +
  "actualizan. La respuesta trae las canciones repetidas en las últimas semanas y, si el setlist quedó tal cual " +
  "se escribió, la observación nueva (observations) para la próxima escritura; si cambió otra vez justo después de " +
  "guardar, trae changedAgainAfterSave y current en su lugar: setlist es lo que se escribió; current.setlist es lo " +
  "que hay ahora. " +
  WRITE_REREAD_RULE;

// ── Copy ────────────────────────────────────────────────────────────────────

/** P1's four observation states the writer cannot take (docs/MCP.md). */
const UNWRITABLE_OBSERVATION: Readonly<
  Record<"draft_overlay" | "ambiguous" | "invalid" | "unknown", { code: ServiceErrorCode; text: string }>
> = {
  draft_overlay: {
    code: "integrity_conflict",
    text: "Hay un borrador de Studio sobre este setlist; descártalo o publícalo en Studio y vuelve a leer.",
  },
  ambiguous: {
    code: "ambiguous_target",
    text: "Hay más de un setlist para este servicio; corrígelo en /admin o Studio.",
  },
  invalid: { code: "integrity_conflict", text: "El registro del setlist es inválido." },
  unknown: { code: "invalid_request", text: "La lectura falló; vuelve a leer." },
};

export const SONG_LOOKUP_FAILED_TEXT = "No se pudieron comprobar las canciones; vuelve a intentar.";

export const NOT_WORSHIP_NIGHT_TEXT =
  "Solo una Noche de alabanza lleva líderes por canción; este servicio no lo es.";

export const READ_BACK_FAILED_TEXT =
  "No se pudo releer el setlist después de guardar; vuelve a leer con get_service antes de otra escritura.";

export const CHANGED_AGAIN_TEXT =
  "El setlist o el servicio cambió otra vez después de guardar (setlist es lo que se escribió; current.setlist es " +
  "lo que hay ahora); vuelve a leer con get_service antes de otra escritura.";

const FRESH_OBSERVATION_TEXT = "La observación nueva va en observations, para la próxima escritura.";

// ── Shape ───────────────────────────────────────────────────────────────────

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

type ZodIssueLike = { code?: string; message?: string; path?: PropertyKey[]; errors?: unknown };

/** The first issue this file wrote the message of, digging into the row union's matching branch. */
function ownMessage(issues: readonly ZodIssueLike[], rows: unknown): string | null {
  for (const issue of issues) {
    if (issue.message && OWN_MESSAGES.has(issue.message)) return issue.message;
    if (issue.code === "invalid_union" && Array.isArray(issue.errors)) {
      const path = issue.path ?? [];
      const row = path[0] === "rows" && typeof path[1] === "number" && Array.isArray(rows) ? rows[path[1]] : null;
      // The branch the caller meant: a kept row names `rowKey`, a new one `songId`.
      const branch = isObj(row) ? ("rowKey" in row ? 0 : "songId" in row ? 1 : -1) : -1;
      const nested = branch >= 0 ? (issue.errors as ZodIssueLike[][])[branch] : null;
      const found = nested ? ownMessage(nested, rows) : null;
      if (found) return found;
    }
  }
  return null;
}

/** The Spanish refusal for input the schema refuses (a direct call; the SDK refuses it first otherwise). */
function shapeRefusal(error: z.ZodError, args: unknown): CallToolResult {
  const issues = error.issues as unknown as ZodIssueLike[];
  // More than 60 rows: the route's own refusal, byte for byte.
  if (issues.some((issue) => issue.code === "too_big" && issue.path?.length === 1 && issue.path[0] === "rows")) {
    return refusalFor({ ok: false, ...serviceError("invalid_request", { details: { issues: ["songs_length"] } }) });
  }
  const rows = isObj(args) ? args.rows : undefined;
  const own = ownMessage(issues, rows);
  if (own) return admissionRefusal("invalid_request", "invalid_input", own);
  const first = issues[0]?.path ?? [];
  const text =
    first[0] === "rows" && typeof first[1] === "number"
      ? `La fila ${first[1] + 1} de rows no tiene un formato válido: una fila guardada es { rowKey, key?, medleyTag?, leads? } y una nueva es { songId, key?, medleyTag?, leads? }.`
      : first[0] === "observed"
        ? "observed no tiene un formato válido; pasa observations.setlist de get_service tal cual."
        : "La solicitud no tiene el formato esperado: { serviceId, roleRev, observed, rows }.";
  return admissionRefusal("invalid_request", "invalid_input", text);
}

// ── Refusals ────────────────────────────────────────────────────────────────

type DomainRefusal = Extract<CommitOutcome<unknown>, { ok: false }>;

function withContent(result: CallToolResult, extra: Record<string, unknown>): CallToolResult {
  return { ...result, structuredContent: { ...(result.structuredContent ?? {}), ...extra } };
}

function withText(result: CallToolResult, text: string): CallToolResult {
  return { ...result, content: [{ type: "text", text }] };
}

/** A refusal built exactly as the writer builds it, so the text and code are the route's. */
function writerRefusal(code: ServiceErrorCode, details: Record<string, unknown>): CallToolResult {
  return refusalFor({ ok: false, ...serviceError(code, { details }) } as DomainRefusal);
}

/** «Title» for a song, or its id in quotes when the title is unknown. */
function songLabel(songId: string | undefined, titles: SongTitleLookup | null): string {
  if (!songId) return "la canción";
  const title = titles?.byId.get(songId)?.title;
  return `«${title ?? songId}»`;
}

/** A row-translation refusal, in Spanish. Titles are named when the lookup has them. */
function rowRefusal(refusal: SetlistRowRefusal, titles: SongTitleLookup | null): CallToolResult {
  const song = songLabel(refusal.songId, titles);
  const where = `fila ${refusal.position}`;
  const content = {
    position: refusal.position,
    ...(refusal.rowKey ? { rowKey: refusal.rowKey } : {}),
    ...(refusal.songId ? { songId: refusal.songId } : {}),
  };
  let text: string;
  switch (refusal.detail) {
    case "unknown_row_key":
      text = `La ${where} nombra rowKey «${refusal.rowKey}», que no está en el setlist que leíste; usa las claves de observations.setlist.rowKeys de get_service.`;
      break;
    case "duplicate_row_key":
      text = `rowKey «${refusal.rowKey}» aparece más de una vez en rows (${where}); cada fila guardada va una sola vez.`;
      break;
    case "duplicate_song":
      text = `${song} ya está en el setlist.`;
      break;
    case "stored_key_too_long":
      text = `La tonalidad guardada de ${song} pasa de ${SETLIST_KEY_MAX} caracteres (solo Studio puede escribirla así); envía key en esa fila para reemplazarla, o null para quitarla.`;
      break;
    case "key_too_long":
      text = `La tonalidad de ${song} pasa de ${SETLIST_KEY_MAX} caracteres.`;
      break;
    case "medley_not_adjacent":
      text = `El enlace de medley de ${song} no se puede aplicar: las canciones enlazadas tienen que quedar juntas.`;
      break;
  }
  return withContent(admissionRefusal("invalid_request", refusal.detail, text), content);
}

// ── The run's context ───────────────────────────────────────────────────────

interface EditContext {
  args: EditSetlistArgs;
  role: StoredRole;
  kind: ServiceKind;
  week: string;
  /** Null for a special (its role document is the setlist). */
  setlistType: WeekendSetlistType | null;
  /** As the writer decides it: only a special can be a worship night. */
  worshipNight: boolean;
  titles: SongTitleLookup;
  body: { songs: SetlistBodyRow[] };
}

/** The observation the writer takes: P1's `single`/`none` without the row keys. */
function observedTarget(observed: Observed): ObservedTarget {
  return observed.state === "single" ? { state: "single", id: observed.id, rev: observed.rev } : { state: "none" };
}

/** The exact domain body — the editor's shape; `roleId` only for a special. */
export function editSetlistBody(input: {
  week: string;
  kind: ServiceKind;
  serviceId: string;
  observed: ObservedTarget;
  songs: SetlistBodyRow[];
}) {
  return {
    week: input.week,
    type: input.kind,
    ...(input.kind === "special" ? { roleId: input.serviceId } : {}),
    observed: input.observed,
    songs: input.songs,
  };
}

function rowKeysOf(songs: unknown): (string | null)[] {
  return Array.isArray(songs)
    ? songs.map((item) => (isObj(item) && typeof item._key === "string" && item._key ? item._key : null))
    : [];
}

// ── The tool ────────────────────────────────────────────────────────────────

/** The tool's whole behaviour, callable without a server (the route registers it below). */
export async function editSetlistResult(args: EditSetlistArgs): Promise<CallToolResult> {
  return runWriteTool("edit_setlist", async ({ callDomain }) => {
    // ── Before any read ────────────────────────────────────────────────────
    const shape = EDIT_SETLIST_INPUT.safeParse(args);
    if (!shape.success) return shapeRefusal(shape.error, args);
    const input = shape.data;
    const { observed } = input;

    if (observed.state !== "none" && observed.state !== "single") {
      const refusal = UNWRITABLE_OBSERVATION[observed.state];
      return admissionRefusal(refusal.code, `observed_${observed.state}`, refusal.text);
    }
    if (observed.state === "single") {
      const keys = observed.rowKeys;
      if (keys.some((key) => key === null) || new Set(keys).size !== keys.length) {
        // A stored row with no unique `_key`: the editor's `invalid_content` (E1).
        return admissionRefusal("integrity_conflict", "invalid_content", SETLIST_READ_ISSUE_COPY.invalid_content);
      }
    }
    const observedKeys = new Set(observed.state === "single" ? observed.rowKeys : []);
    const seen = new Set<string>();
    for (const [index, row] of input.rows.entries()) {
      if (!isKeptRow(row)) continue;
      const position = index + 1;
      if (seen.has(row.rowKey)) return rowRefusal({ detail: "duplicate_row_key", position, rowKey: row.rowKey }, null);
      seen.add(row.rowKey);
      if (!observedKeys.has(row.rowKey)) return rowRefusal({ detail: "unknown_row_key", position, rowKey: row.rowKey }, null);
    }

    // ── 1. The service, at the revision the caller read ────────────────────
    const lookup = await loadCanonicalRole(input.serviceId);
    if (lookup.state === "none") {
      return withContent(writerRefusal("not_found", { roleId: input.serviceId }), { serviceId: input.serviceId });
    }
    if (lookup.state !== "single" || !lookup.role) {
      return withContent(writerRefusal("ambiguous_target", { roleId: input.serviceId, state: lookup.state }), {
        serviceId: input.serviceId,
      });
    }
    const role = lookup.role;
    const kind = serviceKindOf(role._type);
    if (!kind) return withContent(writerRefusal("not_found", { roleId: input.serviceId }), { serviceId: input.serviceId });
    if (role._rev !== input.roleRev) return admissionRefusal("stale_revision", "role_revision", STALE_COPY);

    // ── 2. What the role says ──────────────────────────────────────────────
    const week = storedRoleDate(role);
    if (!week) {
      return admissionRefusal(
        "integrity_conflict",
        "date",
        "El servicio no tiene una fecha válida; revísalo en /admin → Servicios.",
      );
    }
    const setlistType = setlistTypeForKind(kind);
    const worshipNight = !setlistType && isWorshipNight(role);

    // ── 3. The stored rows, through the writer's own loader ────────────────
    const load = setlistType
      ? await loadWeekendSetlistTarget(setlistType, week)
      : await loadSpecialSetlistTarget(input.serviceId, week);
    if (!load.ok) return writerRefusal(load.failure.code, load.failure.details);
    const { server, record } = load.target;

    // ── 4. The observation must still be exactly current ───────────────────
    const target = observedTarget(observed);
    const mismatch = compareObservedTarget(target, server);
    if (mismatch) {
      return writerRefusal("stale_revision", { detail: mismatch, week, type: kind, observed: target, server });
    }

    // ── 5. …row for row ─────────────────────────────────────────────────────
    // Ruling P3-R3: an absent `songs` field is an empty setlist, as the editor reads it.
    const storedSongs: unknown = record?.songs ?? [];
    const storedKeys = rowKeysOf(storedSongs);
    const observedRowKeys = observed.state === "single" ? observed.rowKeys : [];
    if (JSON.stringify(storedKeys) !== JSON.stringify(observedRowKeys)) {
      return admissionRefusal(
        "stale_revision",
        "row_keys_mismatch",
        `${STALE_COPY} Las filas del setlist ya no son las que leíste.`,
      );
    }

    // ── 6. E1, the editor's content gate, and 7. E4 ────────────────────────
    const storedRows: readonly unknown[] = Array.isArray(storedSongs) ? storedSongs : [];
    const songIds = new Set<string>();
    for (const item of storedRows) {
      if (isObj(item) && isObj(item.song) && typeof item.song._ref === "string") songIds.add(item.song._ref);
    }
    for (const row of input.rows) if (!isKeptRow(row)) songIds.add(row.songId);
    const titles = await loadSongTitles([...songIds]);
    if (!titles.ok) return admissionRefusal("integrity_conflict", "song_lookup_failed", SONG_LOOKUP_FAILED_TEXT);
    if (setlistContentState(storedSongs, (id) => titles.byId.has(id)) === "invalid") {
      return admissionRefusal("integrity_conflict", "invalid_content", SETLIST_READ_ISSUE_COPY.invalid_content);
    }
    for (const [index, row] of input.rows.entries()) {
      if (isKeptRow(row) || titles.byId.has(row.songId)) continue;
      return withContent(
        admissionRefusal(
          "invalid_request",
          "unknown_song",
          `«${row.songId}» no es una canción del catálogo; usa un id que devuelva search_songs.`,
        ),
        { position: index + 1, songId: row.songId },
      );
    }

    // ── The translation (E3, E5, E6, E-key, F6) ────────────────────────────
    let tag = 0;
    const translated = buildSetlistBodyRows({
      stored: storedRows,
      rows: input.rows as SetlistRowInput[],
      worshipNight,
      newTag: () => `medley-${++tag}`,
    });
    if (!translated.ok) return rowRefusal(translated.refusal, titles);

    // ── E7: every lead id the body sends is a canonical member ─────────────
    // A worship night only. Anywhere else a row carries `leadIds` only when it
    // names leaders explicitly, which the writer refuses whoever they are (F6):
    // checking membership first would advise a fix F6 refuses too (P3-R24).
    const leadIds = worshipNight ? [...new Set(translated.songs.flatMap((row) => row.leadIds ?? []))] : [];
    if (leadIds.length) {
      const members = await loadCanonicalMemberIds(leadIds);
      for (const [index, row] of translated.songs.entries()) {
        const gone = (row.leadIds ?? []).filter((id) => !members.has(id));
        if (!gone.length) continue;
        const source = input.rows[index]!;
        return withContent(
          admissionRefusal(
            "invalid_request",
            "lead_not_member",
            `${capitalize(songLabel(row.songId, titles))} nombra como líder a alguien que ya no existe como miembro; cámbialo con leads en esa fila.`,
          ),
          {
            position: index + 1,
            ...(isKeptRow(source) ? { rowKey: source.rowKey } : {}),
            songId: row.songId,
            memberIds: gone,
          },
        );
      }
    }

    const context: EditContext = {
      args: input,
      role,
      kind,
      week,
      setlistType,
      worshipNight,
      titles,
      body: { songs: translated.songs },
    };
    const body = editSetlistBody({ week, kind, serviceId: input.serviceId, observed: target, songs: translated.songs });
    const outcome = await callDomain(() => saveSetlist(body));
    if (!outcome.ok) return leadsAwareRefusal(outcome, context);
    return editReport(context, outcome.effects);
  });
}

const LEAD_ISSUE = /^songs\[(\d+)\]\.leadIds$/;

/**
 * A domain refusal. A `songs[i].leadIds` issue gets the tool's own words: on a
 * service that is not a worship night, F6's sentence; on a worship night, the
 * leaders who are no longer in Lead, named, with the row they sit on. The code
 * and the issues stay the route's.
 */
async function leadsAwareRefusal(outcome: DomainRefusal, context: EditContext): Promise<CallToolResult> {
  const base = refusalFor(outcome);
  const content = (base.structuredContent ?? {}) as Partial<RefusalContent>;
  const rows = (content.issues ?? [])
    .map((issue) => LEAD_ISSUE.exec(issue))
    .filter((match): match is RegExpExecArray => !!match)
    .map((match) => Number(match[1]));
  if (content.code !== "invalid_request" || !rows.length) return base;

  if (!context.worshipNight) return withText(base, `${NOT_WORSHIP_NIGHT_TEXT} ${NOTHING_WRITTEN}`);

  // Measured against the Lead this call read; if a leader of every refused row
  // is missing from it, name them. Otherwise (Lead changed in between, or the
  // list is malformed) the route's own words stay.
  const lead = leadSeatIds(context.role.Lead);
  const offending = rows.map((index) => {
    const row = context.body.songs[index];
    return { index, row, gone: (row?.leadIds ?? []).filter((id) => !lead.has(id)) };
  });
  if (offending.some((entry) => !entry.row || entry.gone.length === 0)) return base;
  const names = await safeMemberLookup([...new Set(offending.flatMap((entry) => entry.gone))]);
  const parts = offending.map(({ index, row, gone }) => {
    const source = context.args.rows[index];
    const where = source && isKeptRow(source) ? `fila ${source.rowKey}` : `posición ${index + 1}`;
    const who = gone.map((id) => memberLabel(audienceMember(id, names))).join(" y ");
    return `${who} ya no ${gone.length > 1 ? "están" : "está"} en Lead (${songLabel(row!.songId, context.titles)}, ${where}).`;
  });
  return withText(
    base,
    `${parts.join(" ")} Cambia leads en esas filas o vuelve a leer con get_service. ${NOTHING_WRITTEN}`,
  );
}

// ── D8: the fresh observation ───────────────────────────────────────────────

/** The fields of one stored row this edit wrote, as the read side sees them. */
function rowFacts(item: unknown) {
  const row = isObj(item) ? item : {};
  const song = isObj(row.song) ? row.song : {};
  return {
    _key: row._key ?? null,
    song: song._ref ?? null,
    play_key: row.play_key ?? null,
    medley_tag: row.medley_tag ?? null,
    leads: Array.isArray(row.leads)
      ? row.leads.map((lead) => (isObj(lead) ? { _key: lead._key ?? null, _ref: lead._ref ?? null } : null))
      : [],
  };
}

/** True when `readBack` holds exactly the rows written, in order, field by field. */
export function rowsMatchWrite(written: readonly unknown[], readBack: unknown): boolean {
  if (!Array.isArray(readBack) || readBack.length !== written.length) return false;
  return JSON.stringify(written.map(rowFacts)) === JSON.stringify(readBack.map(rowFacts));
}

/** Object keys sorted; `null`/`undefined` dropped (GROQ projects an absent field as `null`). */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      out[key] = comparable(v);
    }
    return out;
  }
  return value;
}

/** Every role field except `_rev` and `songs`: what a role edit after the save would change. */
function roleWithoutSetlist(role: StoredRole): string {
  const copy: Record<string, unknown> = { ...(role as unknown as Record<string, unknown>) };
  delete copy._rev;
  delete copy.songs;
  return JSON.stringify(comparable(copy));
}

type FreshObservation =
  | {
      kind: "exact";
      observations: {
        roleRev: string;
        setlist: { state: "single"; id: string; rev: string; rowKeys: (string | null)[] };
      };
    }
  | { kind: "changed"; role: StoredRole | null; songs: readonly unknown[] | null }
  | { kind: "failed" };

/** Re-reads the service and its setlist through the same loaders, and compares. */
async function freshObservation(context: EditContext, effects: SetlistSaveEffects): Promise<FreshObservation> {
  const serviceId = context.args.serviceId;
  const read = await safeReportRead("setlist read-back", () =>
    Promise.all([
      loadCanonicalRole(serviceId),
      context.setlistType
        ? loadWeekendSetlistTarget(context.setlistType, context.week)
        : loadSpecialSetlistTarget(serviceId, context.week),
    ]),
  );
  if (!read.ok) return { kind: "failed" };
  const [roleLookup, load] = read.value;
  const roleNow = roleLookup.state === "single" ? roleLookup.role : null;
  if (!load.ok) return { kind: "changed", role: roleNow, songs: null };
  const { server, record } = load.target;
  // A special's role IS its setlist document: the loader's own copy of it.
  const specialRole: StoredRole | null = "role" in load.target ? (load.target.role as StoredRole) : null;
  // A loaded target has rows to report: a `single` setlist whose `songs` is not
  // an array reads as `[]`, exactly as `get_service` reads it
  // (`observeServiceSetlist`), never as `null` (ruling P3-R24).
  const songsNow: readonly unknown[] = Array.isArray(record?.songs) ? (record.songs as unknown[]) : [];

  if (server.state !== "single" || server.id !== effects.setlistId || !rowsMatchWrite(effects.songs, record?.songs)) {
    return { kind: "changed", role: roleNow, songs: songsNow };
  }
  // A special: a role edit after the save lands on the same document and the
  // same rev, so every other field must still be what step 1 read. A weekend:
  // the role must still be at the revision the caller read.
  const roleUnchanged = specialRole
    ? specialRole._rev === server.rev && roleWithoutSetlist(specialRole) === roleWithoutSetlist(context.role)
    : !!roleNow && roleNow._rev === context.args.roleRev;
  if (!roleUnchanged) return { kind: "changed", role: specialRole ?? roleNow, songs: songsNow };
  return {
    kind: "exact",
    observations: {
      roleRev: specialRole ? specialRole._rev : (roleNow as StoredRole)._rev,
      setlist: { state: "single", id: server.id, rev: server.rev, rowKeys: rowKeysOf(effects.songs) },
    },
  };
}

// ── The report ──────────────────────────────────────────────────────────────

export interface RepeatedSong {
  songId: string;
  title: string | null;
  /** The most recent other service (`YYYY-MM-DD`) in the editor's 8-week window that has this song. */
  lastUsed: string;
}

type SetlistView = { rows: SetlistRow[]; runs: SetlistRun[] };

function songRefsOf(songs: readonly unknown[] | null): string[] {
  const out: string[] = [];
  for (const item of songs ?? []) {
    if (isObj(item) && isObj(item.song) && typeof item.song._ref === "string") out.push(item.song._ref);
  }
  return out;
}

async function editReport(context: EditContext, effects: SetlistSaveEffects): Promise<CallToolResult> {
  const [fresh, hint] = await Promise.all([
    freshObservation(context, effects),
    safeReportRead("repeat hint", () => loadRecentSetlists(weeksAgoIso(8))),
  ]);

  // Titles: the pre-read's lookup covers every written song; a read-back that
  // changed may name others.
  const extra =
    fresh.kind === "changed" ? songRefsOf(fresh.songs).filter((id) => !context.titles.byId.has(id)) : [];
  const extraTitles = extra.length ? await safeReportRead("song titles", () => loadSongTitles(extra)) : null;
  const titles: SongTitleLookup = extraTitles
    ? {
        ok: extraTitles.ok && extraTitles.value.ok,
        byId: new Map([...context.titles.byId, ...(extraTitles.ok ? extraTitles.value.byId : [])]),
      }
    : context.titles;

  // ONE member read: the notification audiences and every leader named.
  const pending = setlistSaveNotifications(effects);
  const memberIds = new Set(pending.flatMap((entry) => entry.memberIds));
  if (context.worshipNight) {
    for (const item of effects.songs) for (const id of songItemLeadIds(item)) memberIds.add(id);
    if (fresh.kind === "changed") for (const item of fresh.songs ?? []) for (const id of songItemLeadIds(item)) memberIds.add(id);
  }
  const members = await safeMemberLookup([...memberIds]);
  const notifications = await resolveNotifications(pending, members.byId);
  const sweepNote = effects.notice ? OUTBOX_SWEEP_NOTE : null;

  const written: SetlistView = setlistContent(effects.songs, context.worshipNight, members, titles);

  let repeatedSongs: RepeatedSong[] | undefined;
  if (hint.ok) {
    const recent = recentSongUses(hint.value, context.week);
    repeatedSongs = [];
    for (const id of new Set(songRefsOf(effects.songs))) {
      if (recent[id]) repeatedSongs.push({ songId: id, title: titles.byId.get(id)?.title ?? null, lastUsed: recent[id] });
    }
  }

  // ── Text ───────────────────────────────────────────────────────────────
  const label = swapServiceLabel(context.role);
  const count = effects.songs.length;
  const lines: string[] = [
    `${effects.created ? "Setlist creado" : "Setlist guardado"} para ${label}: ${count} ${count === 1 ? "canción" : "canciones"}. /, /schedule y las páginas de canciones se actualizan.`,
  ];
  let notificationNote: string | undefined;
  if (!effects.subject) notificationNote = "ninguna (ningún servicio es dueño de esa semana)";
  else if (effects.subject.published === false) notificationNote = "ninguna (servicio en borrador)";
  if (notificationNote) lines.push(`Notificaciones: ${notificationNote}.`);
  else lines.push(...notifications.map((n) => n.summary));
  if (sweepNote) lines.push(sweepNote);
  if (repeatedSongs?.length) {
    lines.push(
      `Repetidas en las últimas semanas: ${repeatedSongs
        .map((song) => `«${song.title ?? song.songId}» (${song.lastUsed})`)
        .join(", ")}.`,
    );
  }
  if (fresh.kind === "exact") lines.push(FRESH_OBSERVATION_TEXT);
  else if (fresh.kind === "changed") lines.push(CHANGED_AGAIN_TEXT);
  else lines.push(READ_BACK_FAILED_TEXT);

  const name =
    context.kind === "special" && typeof context.role.service_name === "string" ? context.role.service_name : null;
  const current =
    fresh.kind === "changed"
      ? {
          ...(fresh.role ? { published: derivePublishState(fresh.role.published) } : {}),
          setlist: fresh.songs ? setlistContent(fresh.songs, context.worshipNight, members, titles) : null,
        }
      : null;

  return {
    content: [{ type: "text", text: lines.join(" ") }],
    structuredContent: {
      ok: true,
      serviceId: context.args.serviceId,
      kind: context.kind,
      date: context.week,
      ...(name !== null ? { name } : {}),
      published: derivePublishState(context.role.published),
      created: effects.created,
      setlist: written,
      notifications,
      ...(notificationNote ? { notificationNote } : {}),
      ...(sweepNote ? { sweepNote } : {}),
      ...(repeatedSongs ? { repeatedSongs } : {}),
      ...(fresh.kind === "exact" ? { observations: fresh.observations } : {}),
      ...(fresh.kind === "failed" ? { observations: null } : {}),
      ...(fresh.kind === "changed" ? { changedAgainAfterSave: true, current } : {}),
    },
  };
}

/** Registers `edit_setlist` on a per-request MCP server. */
export function registerEditSetlist(server: McpServer): void {
  server.registerTool(
    "edit_setlist",
    {
      title: "Editar el setlist de un servicio",
      description: EDIT_SETLIST_DESCRIPTION,
      inputSchema: EDIT_SETLIST_INPUT,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => editSetlistResult(args),
  );
}
