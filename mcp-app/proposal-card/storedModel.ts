// The card over a SAVED month (admin parity phase 1, S4: docs/superpowers/plans/2026-10-21-owt-mcp-admin-parity-f1.md;
// ADR-0064): what the screen keeps between `check_service_edits_app` answers, how it reads them,
// and the chat message «Guardar» sends. Pure, so it is tested without a browser or a host.
//
// The proposal editor's rule holds (E1): the screen keeps a LIST OF EDITS, never a board it trusts;
// every gesture re-sends the whole list and shows the server's board. And the card never writes:
// «Guardar» hands the checked change sets to the chat, where Claude calls the destructive
// `save_service_edits`, so the Claude app asks before anything changes in production (F3, Q1).

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

export interface StoredCheckView {
  ok: boolean;
  month: string;
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
    board,
    lines: textLines(result?.content),
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
 * The change sets split into the calls «Guardar» sends. Normally one. Each change carries the server's
 * signed `unit` (a whole group, or a piece of `maxGroup` services of a larger one, ADR-0064), and the
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

/**
 * «Guardar»'s chat message for one part: the lines in words (what the permission prompt will show),
 * then `month` and `changes` as JSON, verbatim, so Claude passes them to `save_service_edits` unchanged.
 */
export function saveMessage(month: string, part: readonly StoredChange[], index: number, total: number): string {
  const head = total > 1
    ? `Guarda la parte ${index + 1} de ${total} de los cambios de ${monthName(month)} con save_service_edits:`
    : `Guarda estos cambios de ${monthName(month)} con save_service_edits:`;
  return [head, ...part.flatMap((c) => c.lines.map((l) => `- ${l}`)), "Pasa month y changes exactamente así:", JSON.stringify({ month, changes: part })].join("\n");
}
