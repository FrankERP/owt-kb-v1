// The proposal card's view model (MCP Apps, S1 of
// docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md): what `solve_month` answered,
// read from its own result and nothing else. Pure, so it is tested without a browser.
//
// The card only SHOWS what the result carries: every name, label and line here is server text,
// and anything the result does not carry is not invented. Editing (S4) is `editorModel.ts`; a
// SAVED month's check (`check_service_edits`, admin parity S4) is read by `storedModel.ts`.

import { isStoredMonthResult, monthName, storedCheckViewOf, type StoredEdit } from "./storedModel";

export interface CardRow {
  label: string;
  names: string[];
}

export interface CardService {
  label: string;
  /** False for a service the solve showed but that will not be created (taken, blocked…). */
  planned: boolean;
  rows: CardRow[];
}

export interface CardFairness {
  name: string;
  tabs: { tab: string; enEstePlan: number; queda: string }[];
}

export type CardView =
  | { kind: "waiting" }
  /** A refusal (`isError`), or a result the card cannot read: the server's own lines. */
  | { kind: "refused"; lines: string[] }
  | { kind: "unreadable"; lines: string[] }
  /** A saved month's check: its services as the check left them, its lines, and the edits it judged. */
  | { kind: "storedMonth"; title: string; month: string; services: CardService[]; lines: string[]; edits: StoredEdit[]; changed: number }
  | {
      kind: "proposal";
      title: string;
      /** The stored proposal's handle (what the editor and «Cargar» act on), when it was stored. */
      handle: string | null;
      /** 1 for a solve; a saved edit's revision otherwise. */
      revision: number;
      /** «Guardada hasta …», «No se pudo guardar…» or «No hay nada que crear». */
      status: string;
      stored: boolean;
      services: CardService[];
      unfilled: { service: string; seat: string }[];
      notices: string[];
      /** The solver's stage lines (all proven, or which stage was not and why). */
      stages: string[];
      /** Services the solve did not plan, each with the planner's reasons. */
      leftOut: { service: string; reasons: string[] }[];
      refusedSpecials: { name: string; day: string; reason: string }[];
      unavailability: { name: string; service: string; day: string }[];
      fairness: CardFairness[];
    };

const TIME_ZONE = "America/Mexico_City";

/** `["2027-01","2027-02"]` → «enero y febrero de 2027»; across a year end, each with its year. */
export function monthsTitle(months: readonly string[]): string {
  const named = months
    .filter((m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m))
    .map((m) => ({
      year: m.slice(0, 4),
      // Noon UTC on the 15th: no zone can move it into another month.
      name: new Date(`${m}-15T12:00:00Z`).toLocaleDateString("es-MX", { timeZone: TIME_ZONE, month: "long" }),
    }));
  if (named.length === 0) return "Propuesta";
  if (named.length === 2 && named[0].year === named[1].year) {
    return `Propuesta de ${named[0].name} y ${named[1].name} de ${named[0].year}`;
  }
  return `Propuesta de ${named.map((n) => `${n.name} de ${n.year}`).join(" y ")}`;
}

/** An instant as «27 de octubre, 15:04» in CDMX — the same wording the text answer uses. */
export function expiryLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("es-MX", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("es-MX", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${date}, ${time}`;
}

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** A service date (`YYYY-MM-DD`) as «9 ene», as the text answer prints it (`dayLabel`) — string math, no `Date`. */
export function dayOf(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? SHORT_MONTHS[Number(m[1]) - 1] : undefined;
  return m && month ? `${Number(m[2])} ${month}` : iso;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** The seat groups in the order the planner shows them, labelled as the text answer labels them. */
const SEAT_GROUPS: readonly [key: string, label: string][] = [
  ["Lead", "Lead"],
  ["BGV", "BGV"],
  ["Coro", "Coro"],
  ["instrumentos", "Instrumentos"],
  ["FOH", "FOH"],
];

/** The text blocks of a tool result, as one list of lines. */
function textLines(content: unknown): string[] {
  return objects(content)
    .filter((c) => c.type === "text")
    .flatMap((c) => str(c.text).split("\n"))
    .filter((l) => l.trim() !== "");
}

/**
 * The view for one `solve_month` result. A refusal (or any result that is not a proposal)
 * shows the server's own lines, never a reconstruction.
 */
export function cardViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): CardView {
  if (!result) return { kind: "waiting" };
  const s = result.structuredContent;
  if (result.isError || !isObj(s) || s.ok !== true) {
    const lines = textLines(result.content);
    // Only `isError` is a refusal; anything else the card cannot read keeps the server's text
    // under a neutral heading (it may well be a stored proposal).
    if (result.isError) return { kind: "refused", lines: lines.length ? lines : ["No se pudo planear el mes."] };
    return { kind: "unreadable", lines: lines.length ? lines : ["La respuesta está en el chat."] };
  }

  if (isStoredMonthResult(s)) {
    const view = storedCheckViewOf(result);
    return {
      kind: "storedMonth",
      title: `Servicios de ${monthName(view.month)}`,
      month: view.month,
      services: view.board.map((svc) => ({
        label: svc.label || "Servicio",
        planned: svc.editable,
        rows: svc.seats.map((seat) => ({ label: seat.label, names: seat.members.map((m) => m.name) })).filter((r) => r.names.length > 0),
      })),
      lines: view.lines,
      edits: view.edits,
      changed: view.changes.length,
    };
  }

  // A `revise_proposal` answer: the edited version's board, by the same names.
  if (Array.isArray(s.board) && !Array.isArray(s.services)) {
    const revision = typeof s.revision === "number" ? s.revision : 1;
    return {
      kind: "proposal",
      title: `Propuesta · versión ${revision}`,
      handle: str(s.proposal) || null,
      revision,
      status: str(s.expiresAt) ? `Guardada hasta el ${expiryLabel(str(s.expiresAt))}` : "",
      stored: true,
      services: objects(s.board).map((svc) => ({
        label: str(svc.label) || "Servicio",
        planned: svc.editable === true,
        rows: objects(svc.seats)
          .map((seat) => ({ label: str(seat.label), names: objects(seat.members).map((m) => str(m.name)) }))
          .filter((r) => r.names.length > 0),
      })),
      unfilled: [],
      notices: textLines(result.content),
      stages: [],
      leftOut: [],
      refusedSpecials: [],
      unavailability: [],
      fairness: [],
    };
  }

  const services: CardService[] = objects(s.services).map((svc) => {
    const seats = isObj(svc.seats) ? svc.seats : {};
    return {
      label: str(svc.service) || "Servicio",
      planned: svc.planned === true,
      rows: SEAT_GROUPS.map(([key, label]) => ({ label, names: strings(seats[key]) })).filter((r) => r.names.length > 0),
    };
  });

  const stored = s.stored === true;
  const expires = str(s.expiresAt);
  const status = stored && expires
    ? `Guardada hasta el ${expiryLabel(expires)}`
    : services.some((x) => x.planned)
      ? "No se pudo guardar esta propuesta; vuelve a pedir el mes."
      : "No hay nada que crear en este mes.";

  return {
    kind: "proposal",
    title: monthsTitle(strings(s.months)),
    handle: stored ? str(s.proposal) || null : null,
    revision: 1,
    status,
    stored,
    services,
    unfilled: objects(s.unfilled).map((u) => ({ service: str(u.service), seat: str(u.seat) })),
    notices: strings(s.notices),
    stages: strings(s.stages),
    leftOut: objects(s.leftOut).map((l) => ({ service: str(l.service), reasons: strings(l.reasons) })),
    refusedSpecials: objects(s.refusedSpecials).map((r) => ({ name: str(r.name), day: dayOf(str(r.date)), reason: str(r.reason) })),
    unavailability: objects(s.unavailability).map((u) => ({ name: str(u.name), service: str(u.service), day: dayOf(str(u.date)) })),
    fairness: objects(s.fairness).map((p) => ({
      name: str(p.name),
      tabs: objects(p.tabs).map((t) => ({
        tab: str(t.tab),
        enEstePlan: typeof t.enEstePlan === "number" ? t.enEstePlan : 0,
        queda: str(t.queda),
      })),
    })),
  };
}
