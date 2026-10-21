// The proposal card's view model (MCP Apps, S1 of
// docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md): what `solve_month` answered,
// read from its own result and nothing else. Pure, so it is tested without a browser.
//
// The card only SHOWS. It never judges, stores or sends anything back (plan E1): every name,
// label and line here is server text, and anything the result does not carry is not invented.

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
  | { kind: "refused"; lines: string[] }
  | {
      kind: "proposal";
      title: string;
      /** «Guardada hasta …», «No se pudo guardar…» or «No hay nada que crear». */
      status: string;
      stored: boolean;
      services: CardService[];
      unfilled: { service: string; seat: string }[];
      notices: string[];
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
    return { kind: "refused", lines: lines.length ? lines : ["No se pudo planear el mes."] };
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
    status,
    stored,
    services,
    unfilled: objects(s.unfilled).map((u) => ({ service: str(u.service), seat: str(u.seat) })),
    notices: strings(s.notices),
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
