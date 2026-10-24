// The card over a SAVED month (admin parity phase 1, S4: docs/superpowers/plans/2026-10-21-owt-mcp-admin-parity-f1.md;
// ADR-0066): what the screen keeps between `check_service_edits_app` answers, how it reads them,
// how it reads the card's own save, and the chat message «Mandar al chat» sends. Pure, so it is tested
// without a browser or a host.
//
// The proposal editor's rule holds (E1): the screen keeps a LIST OF EDITS, never a board it trusts;
// every gesture re-sends the whole list and shows the server's board. «Guardar» asks in the card and
// then saves through the app-only `save_service_edits_app` — the same save as the chat's, which
// re-checks every change set (ADR-0066 addendum, 2026-10-23: docs/superpowers/plans/2026-10-23-owt-mcp-card-saves.md).
// «Mandar al chat» keeps the old way: Claude calls `save_service_edits` and the Claude app asks first.

import { boardOf, textLines, type Candidate, type ServiceView } from "./editorModel";

type Seat = { service: string; row: string; member: string };

/** An edit as `check_service_edits_app` takes it (members as the month's tokens). */
export type StoredEdit =
  | { op: "place"; service: string; row: string; member: string; force?: boolean }
  | { op: "clear"; service: string; row: string; member: string }
  | { op: "move"; from: Seat; to: { service: string; row: string }; force?: boolean }
  | { op: "exchange"; a: Seat; b: Seat; force?: boolean }
  | { op: "header"; service: string; name?: string; time?: string | null; countsForFairness?: boolean };

/** One service's change set exactly as the check answered it: passed to the chat untouched. */
export type StoredChange = Record<string, unknown> & { service: string; lines: string[] };

/** The days a chat check asked the card to show (`focus`); the month is still checked whole. */
export interface Focus {
  from: string;
  to: string;
}

export interface StoredCheckView {
  ok: boolean;
  month: string;
  focus: Focus | null;
  board: ServiceView[];
  /** The server's lines: the changes in words, the groups, the warnings, the month check. */
  lines: string[];
  /** The edit list this answer judged (from the chat: what the model asked for, as tokens). */
  edits: StoredEdit[];
  changes: StoredChange[];
  /** Service ids, the server's groups (F3), singles included. */
  groups: string[][];
  /** Present when a group is larger than the server saves in one call. */
  maxGroup: number | null;
  /** A new finding no forced edit covers: the save would refuse it. */
  needsCard: boolean;
  refusal: { index: number; code: string; sentence: string } | null;
  /** For a forcible rule on the refused edit: what «¿Asignar de todos modos?» shows. */
  prompt: Array<{ where: string; sentence: string }> | null;
  candidates: Candidate[] | null;
}

/**
 * The argument lines a saved-month check adds to its TEXT for the model (which never sees
 * `structuredContent`): the card reads the same data structured, so it hides them. Mirrors
 * `SAVE_ARGS_PREFIX`/`COPY_ARGS_PREFIX` in `app/components/admin/v3Copy.ts`.
 */
export const ARGS_LINE_PREFIXES = [
  "Argumentos para save_service_edits (pásalos tal cual):",
  "Argumentos para copy_instruments (pásalos tal cual):",
] as const;
const isArgsLine = (l: string) => ARGS_LINE_PREFIXES.some((p) => l.startsWith(p));

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** One edit read back defensively; anything unrecognised is dropped, never guessed. */
function editOf(e: Obj): StoredEdit | null {
  const seat = (v: unknown): Seat | null => (isObj(v) && typeof v.service === "string" && typeof v.row === "string" && typeof v.member === "string" ? { service: v.service, row: v.row, member: v.member } : null);
  const force = e.force === true ? { force: true } : {};
  if ((e.op === "place" || e.op === "clear") && typeof e.service === "string" && typeof e.row === "string" && typeof e.member === "string") {
    return e.op === "place" ? { op: "place", service: e.service, row: e.row, member: e.member, ...force } : { op: "clear", service: e.service, row: e.row, member: e.member };
  }
  if (e.op === "move" && seat(e.from) && isObj(e.to) && typeof e.to.service === "string" && typeof e.to.row === "string") {
    return { op: "move", from: seat(e.from)!, to: { service: e.to.service, row: e.to.row }, ...force };
  }
  if (e.op === "exchange" && seat(e.a) && seat(e.b)) return { op: "exchange", a: seat(e.a)!, b: seat(e.b)!, ...force };
  if (e.op === "header" && typeof e.service === "string") {
    return {
      op: "header",
      service: e.service,
      ...(typeof e.name === "string" ? { name: e.name } : {}),
      ...(typeof e.time === "string" || e.time === null ? { time: e.time as string | null } : {}),
      ...(typeof e.countsForFairness === "boolean" ? { countsForFairness: e.countsForFairness } : {}),
    };
  }
  return null;
}

/** Whether a tool result is a saved-month check (and not a proposal or a solve). */
export function isStoredMonthResult(s: unknown): boolean {
  return isObj(s) && typeof s.month === "string" && Array.isArray(s.changes) && Array.isArray(s.board) && s.proposal === undefined;
}

export function storedCheckViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): StoredCheckView {
  const s = isObj(result?.structuredContent) ? (result!.structuredContent as Obj) : {};
  const refusal = isObj(s.refusal) ? { index: Number(s.refusal.index), code: str(s.refusal.code), sentence: str(s.refusal.sentence) } : null;
  const prompt = isObj(s.refusal) && isObj(s.refusal.prompt) ? s.refusal.prompt : null;
  const board = boardOf(s.board);
  const service = prompt ? board.find((x) => x.service === prompt.service) : undefined;
  const seat = prompt ? service?.seats.find((x) => x.row === prompt.row) : undefined;
  const where = [service?.label, seat?.label].filter(Boolean).join(" · ");
  return {
    ok: !result?.isError && s.ok === true,
    month: str(s.month),
    focus: isObj(s.focus) && typeof s.focus.from === "string" && typeof s.focus.to === "string" ? { from: s.focus.from, to: s.focus.to } : null,
    board,
    lines: textLines(result?.content).filter((l) => !isArgsLine(l)),
    edits: objects(s.edits).map(editOf).filter((e): e is StoredEdit => e !== null),
    changes: objects(s.changes)
      .filter((c) => typeof c.service === "string")
      .map((c) => ({ ...c, service: str(c.service), lines: strings(c.lines) })),
    groups: Array.isArray(s.groups) ? s.groups.map(strings) : [],
    maxGroup: typeof s.maxGroup === "number" ? s.maxGroup : null,
    needsCard: s.needsCard === true,
    refusal,
    prompt: prompt ? objects(prompt.rules).map((r) => ({ where, sentence: str(r.sentence) })) : null,
    candidates: Array.isArray(s.candidates)
      ? objects(s.candidates).map((c) => ({
          token: str(c.token),
          name: str(c.name),
          available: c.available !== false,
          blocked: typeof c.blocked === "string" ? c.blocked : null,
          rule: typeof c.rule === "string" ? c.rule : null,
        }))
      : null,
  };
}

/**
 * The services a focus shows, or null when it narrows nothing (no focus, every service in it, or
 * none — never an empty card). A service that changes always shows: «Guardar» saves it, so the
 * board never hides it. String comparison: dates are `YYYY-MM-DD`.
 */
export function focusedServices<T extends { date: string; service?: string }>(services: readonly T[], focus: Focus | null, changed: readonly string[] = []): T[] | null {
  if (!focus) return null;
  const shown = services.filter((s) => (s.date >= focus.from && s.date <= focus.to) || (s.service !== undefined && changed.includes(s.service)));
  return shown.length === 0 || shown.length === services.length ? null : shown;
}

/** The list after the server refused an edit: a forcible rule on the LAST edit is offered; anything else is dropped. */
export function afterStoredRefusal(edits: readonly StoredEdit[], check: StoredCheckView): { edits: StoredEdit[]; askForce: boolean } {
  if (!check.refusal) return { edits: [...edits], askForce: false };
  const last = check.refusal.index === edits.length - 1;
  if (check.refusal.code === "hard_rule" && last) return { edits: [...edits], askForce: true };
  return { edits: edits.filter((_, i) => i !== check.refusal!.index), askForce: false };
}

/** The last edit forced («Asignar de todos modos»): only a seat edit that places someone can be. */
export function forceStoredLast(edits: readonly StoredEdit[]): StoredEdit[] {
  const out = [...edits];
  const last = out[out.length - 1];
  if (last && (last.op === "place" || last.op === "move" || last.op === "exchange")) out[out.length - 1] = { ...last, force: true };
  return out;
}

/** The server's per-call limits, mirrored for splitting only (the server refuses past them anyway). */
export const MAX_CHANGES_PER_SAVE = 31;

/**
 * The change sets split into the saves «Guardar» makes (and the messages «Mandar al chat» sends). Normally one. Each change carries the server's
 * signed `unit` (a whole group, or a piece of `maxGroup` services of a larger one, ADR-0066), and the
 * save refuses a call that leaves out any service of a unit it names — so units are never cut here,
 * only packed. When a group is larger than `maxGroup` the parts stay that small (two pieces of one
 * group in one call would be that group again), and the card says first that a piece that fails
 * leaves the other pieces saved.
 */
export function saveParts(changes: readonly StoredChange[], maxGroup: number | null): StoredChange[][] {
  const limit = maxGroup ?? MAX_CHANGES_PER_SAVE;
  const units = new Map<string, StoredChange[]>();
  for (const c of changes) {
    const unit = strings(c.unit);
    const key = (unit.length ? unit : [c.service]).join("\u0000");
    units.set(key, [...(units.get(key) ?? []), c]);
  }
  const parts: StoredChange[][] = [];
  for (const piece of units.values()) {
    const open = parts[parts.length - 1];
    if (open && open.length + piece.length <= limit) open.push(...piece);
    else parts.push([...piece]);
  }
  return parts;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** `2026-11` → «noviembre de 2026» — string math, no `Date`. */
export function monthName(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} de ${m[1]}` : month;
}

/** «a», «a y b», «a, b y c». */
export const joinWords = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;

/**
 * A short key for one part's arguments (FNV-1a over its JSON, base 36): the message and the context
 * line both carry it, so the model takes THESE arguments — never an earlier check's line, which is
 * still in the chat with a valid MAC. `save_service_edits`' description says what to do with a key
 * whose line is not there (ask for «Guardar» again, which now saves from the card), because that is exactly when
 * the context is missing.
 */
export function argsKey(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36).padStart(7, "0").slice(-6);
}

/**
 * «Mandar al chat» (once «Guardar» itself) on a host that takes model context (Frank, 2026-10-22: the JSON in the chat «no me
 * encantó»): the chat shows the changes in words and a key; the arguments ride in the model's
 * context, on the check's own `Argumentos para save_service_edits` line, labelled with that key.
 * The host keeps only the LAST context update, so the card sends every part handed over so far
 * (`contextOf`). `saveMessage` below stays the fallback for a host without context updates.
 */
export function saveRequest(month: string, part: readonly StoredChange[], index: number, total: number): { key: string; message: string; contextLine: string } {
  const json = JSON.stringify({ month, changes: part });
  const key = argsKey(json);
  const which = total > 1 ? `la parte ${index + 1} de ${total} de ` : "";
  // The chat shows what a person would write (Frank, 2026-10-23: the instructions read «raro»). Each
  // context line is a neutral label; the one rule tying a save to the key the person asked for is
  // `CONTEXT_HEAD`, so a part the person declined is never saved because its line is still there.
  return {
    key,
    message: [`Guarda ${which}mis cambios de la tarjeta (${key}):`, ...part.flatMap((c) => c.lines.map((l) => `- ${l}`))].join("\n"),
    contextLine: `Cambios ${key} de ${monthName(month)}${total > 1 ? ` (parte ${index + 1} de ${total})` : ""}. ${ARGS_LINE_PREFIXES[0]} ${json}`,
  };
}

/** The model-only rule above the parts: save only the key the person's message names. */
export const CONTEXT_HEAD =
  "Cambios listos en la tarjeta. Guarda con save_service_edits solo los cambios cuya clave nombra el último mensaje, con los " +
  "argumentos de su línea, nunca con los de una revisión anterior; si esa clave no está aquí, no guardes y pide tocar «Guardar» otra vez.";

/** The context the card sets: the rule, then every part handed over for the current edit list, in order. */
export const contextOf = (lines: ReadonlyMap<number, string>): string =>
  [CONTEXT_HEAD, ...[...lines.entries()].sort(([a], [b]) => a - b).map(([, l]) => l)].join("\n");

/**
 * «Mandar al chat»'s message for one part: the lines in words (what the permission prompt will show),
 * then `month` and `changes` as JSON, verbatim, so Claude passes them to `save_service_edits` unchanged.
 */
export function saveMessage(month: string, part: readonly StoredChange[], index: number, total: number): string {
  const head = total > 1
    ? `Guarda la parte ${index + 1} de ${total} de los cambios de ${monthName(month)} con save_service_edits:`
    : `Guarda estos cambios de ${monthName(month)} con save_service_edits:`;
  return [head, ...part.flatMap((c) => c.lines.map((l) => `- ${l}`)), "Pasa month y changes exactamente así:", JSON.stringify({ month, changes: part })].join("\n");
}

/** What `save_service_edits_app` answered, as the card acts on it (ADR-0066 addendum). */
export interface StoredSaveView {
  /** False: no structured answer (`runWriteTool`'s own text) — whether anything was written is unknown. */
  structured: boolean;
  ok: boolean;
  /** A refusal: every one returns before the save's first write. */
  refused: boolean;
  next: "repeat_same_call" | "check_again" | null;
  /** The save's lines in the card's words (the ones written for Claude dropped or trimmed). */
  lines: string[];
}

/**
 * The save's lines that tell CLAUDE what to call next; the card says its own next step instead.
 * Mirrors `V3_STORED_EDITOR_LINES` (`repeatSame`, `recheck`, `needsCard`) in `app/components/admin/v3Copy.ts`
 * (pinned by `storedCardSave.test.tsx`), as `ARGS_LINE_PREFIXES` mirrors the argument prefixes.
 */
export const MODEL_ONLY_SAVE_LINES = [
  "Repite exactamente la misma llamada: lo que ya quedó se reconoce como «ya estaba» y se guarda el resto.",
  "Revisa el mes de nuevo con check_service_edits antes de volver a guardar.",
  "Forzar una regla por lugar solo se puede desde la tarjeta («Asignar de todos modos»); desde el chat no se fuerza nada.",
] as const;

/**
 * Tails of the save's lines that name a tool or a call; trimmed off on the card. Mirrors `changed`,
 * `notTheChecked`, `unitIncomplete` and the status `notSavedRepeat` (`V3_STORED_EDITOR_LINES`) and the
 * runner's `SERVICE_EDITOR_COPY.domain` (`app/mcp/tools/serviceEditor.ts`), pinned by `storedCardSave.test.tsx`.
 */
export const MODEL_ONLY_SAVE_TAILS = [
  " Revisa el mes de nuevo con check_service_edits.",
  " Revisa de nuevo con check_service_edits.",
  "; repite la misma llamada",
  " Manda también esos cambios, tal cual los devolvió la revisión.",
  " Repite exactamente la misma llamada: lo que ya quedó se reconoce como «ya estaba».",
] as const;

const forTheCard = (line: string): string => MODEL_ONLY_SAVE_TAILS.reduce((l, tail) => l.split(tail).join(""), line);

export function storedSaveViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): StoredSaveView {
  const s = isObj(result?.structuredContent) ? (result!.structuredContent as Obj) : null;
  return {
    structured: s !== null,
    ok: s !== null && !result?.isError && s.ok === true,
    refused: s?.refused === true,
    next: s?.next === "repeat_same_call" || s?.next === "check_again" ? s.next : null,
    lines: textLines(result?.content)
      .filter((l) => !(MODEL_ONLY_SAVE_LINES as readonly string[]).includes(l))
      .map(forTheCard),
  };
}

/** The card's own words around a save (ADR-0066 addendum). */
export const CARD_SAVE = {
  confirmHead: "¿Guardar estos cambios?",
  confirmNote: "Se guarda en la app y se avisa por correo a quien le toque, como en /admin.",
  yes: "Sí, guardar",
  no: "Cancelar",
  again: "Guardar de nuevo",
  toChat: "Mandar al chat",
  repeat: "Toca «Guardar de nuevo»: lo que ya quedó dirá «ya estaba».",
  unknown:
    "No supe si se guardó (o la app no dejó que la tarjeta guardara). Toca «Guardar de nuevo»: lo que ya quedó dirá «ya estaba». " +
    "Si sigue fallando, actualiza el conector o usa «Mandar al chat».",
  reread: "Lo que no se guardó ya no está en la tarjeta: vuelve a hacerlo sobre el mes como quedó.",
  rereadFailed: "No pude volver a leer el mes; los cambios siguen bloqueados. Toca «Descartar cambios» para leerlo de nuevo.",
  foot: "Al confirmar, la tarjeta guarda directo; Claude no interviene. Si la tarjeta no puede guardar, aparece «Mandar al chat»: Claude guarda y la app te pide permiso.",
} as const;

/** The model's context after a card save: what happened, so Claude never saves these again from an older line. */
export function savedContext(month: string, ok: boolean, lines: readonly string[]): string {
  const head = ok
    ? `La persona guardó desde la tarjeta los cambios de ${monthName(month)} (ya están guardados; no los guardes otra vez):`
    : `La tarjeta intentó guardar cambios de ${monthName(month)} y no se guardó todo; la tarjeta ya se lo dijo a la persona:`;
  return [head, ...lines].join("\n");
}

// ── Deleting services from the card (admin parity phase 2, T5) ──────────────
//
// «Borrar servicios…» (the whole month) and «Borrar este servicio» call the chat's own read-only
// `check_service_deletes`, show its lines in the card's confirmation, and «Sí, borrar» passes the
// check's list and token UNTOUCHED to the app-only `delete_services_app` — the chat's delete, which
// re-checks everything. The same rule as the save: after a delete starts, an unknown outcome keeps the
// SAME list frozen for «Borrar de nuevo» (or «Mandar al chat»); anything else reads the month again.

/** One service a delete removes, exactly as the check answered it. */
export interface DeleteEntry {
  service: string;
  baseRev: string;
  line: string;
}

export interface DeleteCheckView {
  ok: boolean;
  month: string;
  deletes: DeleteEntry[];
  token: string | null;
  kept: Array<{ label: string; reason: string }>;
  publishedSkipped: number;
  overflow: number;
  /** A refusal's words (a failed read), the card's own text otherwise. */
  lines: string[];
}

export function deleteCheckViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): DeleteCheckView {
  const s = isObj(result?.structuredContent) ? (result!.structuredContent as Obj) : {};
  const ok = !result?.isError && s.ok === true;
  return {
    ok,
    month: str(s.month),
    deletes: objects(s.deletes)
      .filter((d) => typeof d.service === "string" && typeof d.baseRev === "string" && typeof d.line === "string")
      .map((d) => ({ service: str(d.service), baseRev: str(d.baseRev), line: str(d.line) })),
    token: typeof s.token === "string" ? s.token : null,
    kept: objects(s.kept).map((k) => ({ label: str(k.label), reason: str(k.reason) })),
    publishedSkipped: typeof s.publishedSkipped === "number" ? s.publishedSkipped : 0,
    overflow: typeof s.overflow === "number" ? s.overflow : 0,
    // Only a refusal's text is shown: an answer's text carries the lines for Claude (the call, the args).
    lines: ok ? [] : textLines(result?.content).filter((l) => !isArgsLine(l) && !l.startsWith(DELETE_ARGS_LINE_PREFIX)),
  };
}

/** Mirrors `DELETE_ARGS_PREFIX` (`app/components/admin/v3Copy.ts`), pinned by `storedCardDelete.test.tsx`. */
export const DELETE_ARGS_LINE_PREFIX = "Argumentos para delete_services (pásalos tal cual):";

/** What `delete_services_app` answered, as the card acts on it. */
export interface DeleteResultView {
  /** False: no structured answer (`runWriteTool`'s own text) — what was deleted is unknown. */
  structured: boolean;
  ok: boolean;
  refused: boolean;
  next: "repeat_same_call" | "check_again" | null;
  /** Some service answered «otra edición llegó al mismo tiempo» (contention): one repeat only. */
  contention: boolean;
  /** Something may or may not have been deleted («sin confirmar», «pendiente»). */
  unsure: boolean;
  lines: string[];
}

/**
 * The delete's lines for CLAUDE (what to call next): dropped on the card. Mirrors `repeatSame` and
 * `recheck` of `V3_STORED_EDITOR_LINES.delete`, pinned by `storedCardDelete.test.tsx`.
 */
export const MODEL_ONLY_DELETE_LINES = [
  "Repite exactamente la misma llamada: lo que ya se borró contesta «ya no existe» y se borra el resto.",
  "Revisa el mes de nuevo con check_service_deletes antes de volver a borrar.",
] as const;

/** Tails that name a tool or a call; trimmed on the card (pinned by `storedCardDelete.test.tsx`). */
export const MODEL_ONLY_DELETE_TAILS = [
  " Revisa de nuevo con check_service_deletes.",
  "; repite la misma llamada UNA vez y, si vuelve a pasar, revisa el mes de nuevo",
  " (repetir la llamada ya no puede avisarles)",
  " Repite exactamente la misma llamada: lo que ya se borró contesta «ya no existe».",
] as const;

const deleteForTheCard = (line: string): string => MODEL_ONLY_DELETE_TAILS.reduce((l, tail) => l.split(tail).join(""), line);

export function deleteResultViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): DeleteResultView {
  const s = isObj(result?.structuredContent) ? (result!.structuredContent as Obj) : null;
  const statuses = s ? objects(s.services).map((x) => str(x.status)) : [];
  return {
    structured: s !== null,
    ok: s !== null && !result?.isError && s.ok === true,
    refused: s?.refused === true,
    next: s?.next === "repeat_same_call" || s?.next === "check_again" ? s.next : null,
    contention: statuses.includes("notDeletedRepeat"),
    unsure: statuses.includes("unknown") || statuses.includes("pending"),
    lines: textLines(result?.content)
      .filter((l) => !(MODEL_ONLY_DELETE_LINES as readonly string[]).includes(l))
      .map(deleteForTheCard),
  };
}

/** The card's own words around a delete. */
export const CARD_DELETE = {
  month: "Borrar servicios…",
  one: "Borrar este servicio",
  sheetHead: (month: string) => `¿Qué servicios de ${monthName(month)} borrar?`,
  sheetFocus: "Se revisa todo el mes, no solo los días que ves.",
  drafts: "Solo borradores",
  all: "También publicados",
  allNote: "Un servicio publicado le avisa por correo a su equipo «Ya no participas».",
  editsFirst: "Guarda o descarta tus cambios primero.",
  checking: "Revisando qué se borraría…",
  confirmHead: "¿Borrar estos servicios?",
  keptHead: "No se borran:",
  nothing: "No hay servicios que borrar con esta selección.",
  publishedSkipped: (n: number) => (n === 1 ? "1 servicio publicado no incluido." : `${n} servicios publicados no incluidos.`),
  overflow: (n: number) => `Quedan ${n} más: bórralos después de estos (máximo 31 a la vez).`,
  irreversible: "Esto no se puede deshacer.",
  yes: "Sí, borrar",
  no: "Cancelar",
  close: "Cerrar",
  again: "Borrar de nuevo",
  toChat: "Mandar al chat",
  repeat: "Toca «Borrar de nuevo»: lo que ya se borró dirá «ya no existe».",
  unknown:
    "No supe si se borró (o la app no dejó que la tarjeta borrara). Toca «Borrar de nuevo»: lo que ya se borró dirá «ya no existe». " +
    "Si sigue fallando, usa «Mandar al chat».",
  reread: "Revisa el mes como quedó antes de borrar otra cosa.",
  rereadFailed: "No pude volver a leer el mes; la tarjeta sigue bloqueada. Toca «Volver a leer el mes».",
  rereadButton: "Volver a leer el mes",
} as const;

/** «Mandar al chat» for a delete: the lines (what the permission prompt shows), then the arguments verbatim. */
export function deleteMessage(month: string, deletes: readonly DeleteEntry[], token: string): string {
  return [
    `Borra estos servicios de ${monthName(month)} con delete_services:`,
    ...deletes.map((d) => `- ${d.line}`),
    "Pasa month, deletes y token exactamente así:",
    JSON.stringify({ month, deletes, token }),
  ].join("\n");
}

/** The model's context after a card delete: what happened, so Claude never deletes these again from an older line. */
export function deletedContext(month: string, ok: boolean, lines: readonly string[]): string {
  const head = ok
    ? `La persona borró desde la tarjeta servicios de ${monthName(month)} (ya están borrados; no los borres otra vez):`
    : `La tarjeta intentó borrar servicios de ${monthName(month)} y no se borró todo; la tarjeta ya se lo dijo a la persona:`;
  return [head, ...lines].join("\n");
}
