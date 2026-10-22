// app/components/admin/v3Copy.ts
//
// Solver v3 C6 §7 — EVERY Spanish line the v3 planner shows, keyed on codes. Nothing else in C6
// writes copy. Registry groups (C5's `gcf_v3/owt_v3/codes.json`) are mirrored in
// `V3_COPY_BY_GROUP`, each entry declaring the parameters it reads, so `v3CodesSync.test.ts` can fail
// on a missing code, an extra code or an undeclared parameter (NT-4). C6-own lines (§7.3's own,
// §7.6–§7.9, and the ST/SP/WN/HZ/RQ/NT rows) live in `V3_LINES` and the typed maps below; the maps
// keyed on C2's unions make a new C2 code without copy a `tsc` error.
//
// Parameters are rendered by the caller's `V3Names`: a member id → alias or name, a rule id → its
// card's label (never the id, never a config key — KH-1), a service id → «domingo 8 nov».

import { dayLabel } from "./plannerModel";
import type { capValueForMonth } from "./serviceRuleContext";
import type { V3TransportReason } from "./v3Wire";
import type { FairnessPutRefusal } from "@/app/utils/fairnessVocabulary";
import type { EligibilityIssueCode, EligibilityRefusalReason } from "@/app/utils/fairnessEligibility";

// ─── Formatting ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

export function monthNameCap(month: string): string {
  const n = monthName(month);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * The heading of a planned stretch, naming every month in it: «Noviembre 2026», «Noviembre y
 * diciembre 2026», or «Diciembre 2026 y enero 2027» across a year. The grid uses it for the whole
 * horizon (a two-month plan headed by its first month alone read as if the second were not in it)
 * and each calendar for its own month, so the two always spell a month the same way.
 */
export function horizonTitle(horizon: readonly string[]): string {
  const year = (ym: string) => ym.slice(0, 4);
  const [first, second] = horizon;
  if (!second) return `${monthNameCap(first)} ${year(first)}`;
  return year(first) === year(second)
    ? `${monthNameCap(first)} y ${monthName(second)} ${year(first)}`
    : `${monthNameCap(first)} ${year(first)} y ${monthName(second)} ${year(second)}`;
}

export function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function monthsList(months: readonly string[], capitalFirst = false): string {
  return joinEs(months.map((m, i) => (capitalFirst && i === 0 ? monthNameCap(m) : monthName(m))));
}

/** «8 y 15 nov»; across months «31 oct y 7 nov»; the month abbreviation after each month's last day. */
export function datesList(dates: readonly string[]): string {
  const sorted = [...dates].sort();
  const items = sorted.map((d, i) => {
    const [day, abbr] = dayLabel(d).split(" ");
    const lastOfMonth = i === sorted.length - 1 || sorted[i + 1].slice(0, 7) !== d.slice(0, 7);
    return lastOfMonth ? `${day} ${abbr}` : day;
  });
  return joinEs(items);
}

export interface V3Names {
  /** A member id → alias, else name; an unknown id → «alguien que ya no está en la lista». */
  person(id: string): string;
  /** A wire rule id → the card's label (`v3RuleIds.ts`); never the id itself. */
  rule(id: string): string;
  /** A service id → «domingo 8 nov» / «sábado 7 nov» / «{nombre} 12 nov». */
  service(id: string): string;
}

/** «Dom Lead», «Sáb Lead», «BGV», «Coro», «Total» (the Total stage pair, ADR-0058); a presence
 *  sub-line «BGV ({regla})». */
export function lineLabel(line: string, n: Pick<V3Names, "rule">): string {
  if (line === "TOTAL") return "Total";
  if (line === "DL") return "Dom Lead";
  if (line === "SL") return "Sáb Lead";
  if (line === "BGV") return "BGV";
  if (line === "CORO") return "Coro";
  if (line.startsWith("P:")) return `BGV (${n.rule(line.slice(2))})`;
  return line;
}

type Params = Readonly<Record<string, unknown>>;
const s = (p: Params, k: string) => String(p[k] ?? "");
const list = (p: Params, k: string): string[] => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);

export interface CodeCopy {
  /** The parameters `render` reads — each must be declared by the code in C5's registry (NT-4). */
  params: readonly string[];
  render(p: Params, n: V3Names): string;
}
const fixed = (text: string): CodeCopy => ({ params: [], render: () => text });

/** A code C5 lists in no group — runtime only (NT-4): a line, never nothing. */
export function unknownCodeLine(code: string): string {
  return `El solver informó algo que el planificador no reconoce (${code}).`;
}

// ─── §7.1 Stages ────────────────────────────────────────────────────────────

const STAGE: Record<string, CodeCopy> = {
  rules: fixed("Reglas"),
  fill: fixed("Llenado"),
  cadence: fixed("Mes por medio"),
  compensation: fixed("Sábado de compensación"),
  voice_floor: fixed("Mínimo de voz"),
  dl_floor: fixed("Domingo cada dos meses"),
  sunday_cap: fixed("Un domingo al mes"),
  saturday_cap: fixed("Un sábado al mes"),
  no_consecutive: fixed("Domingos no seguidos"),
  "balance_max:{line}": { params: ["line"], render: (p, n) => `Equidad ${lineLabel(s(p, "line"), n)}: el más pendiente` },
  "balance_sq:{line}": { params: ["line"], render: (p, n) => `Equidad ${lineLabel(s(p, "line"), n)}: reparto` },
  tiebreak: fixed("Desempate"),
};
const STAGE_STATUS: Record<string, CodeCopy> = {
  proven: fixed("probado"),
  unproven: fixed("no probado"),
  not_run: fixed("no ejecutado"),
};
const STAGE_REASON: Record<string, CodeCopy> = {
  budget: fixed("Se acabó el tiempo antes de empezarla."),
  no_solution_in_limit: fixed("No encontró un plan dentro de su límite."),
  stopped_earlier: fixed("Una etapa anterior terminó la corrida."),
};
export const V3_UNPROVEN_EXPLANATION =
  "\"No probado\": el plan es válido, pero el solver no alcanzó a comprobar que fuera el mejor en esa etapa.";
export const V3_NOT_RUN_TAIL = "Las etapas no ejecutadas conservan el plan de la etapa anterior. Revísalo antes de crear.";
export const V3_STAGE_REASON_LINE = (reason: string): string =>
  STAGE_REASON[reason]?.render({}, NO_NAMES) ?? unknownCodeLine(reason);

export function stageLabel(id: string, n: V3Names): string {
  for (const tpl of ["balance_max", "balance_sq"] as const) {
    if (id.startsWith(`${tpl}:`)) return STAGE[`${tpl}:{line}`].render({ line: id.slice(tpl.length + 1) }, n);
  }
  return STAGE[id]?.render({}, n) ?? unknownCodeLine(id);
}

export function stageStatusLabel(status: string): string {
  return STAGE_STATUS[status]?.render({}, NO_NAMES) ?? unknownCodeLine(status);
}

// ─── §7.2 Missed protections ────────────────────────────────────────────────

const MISSED_CAUSE: Record<string, CodeCopy> = {
  unavailable: fixed("no tenía fechas disponibles"),
  pins: fixed("por lo que ya estaba puesto"),
  rule: fixed("una regla lo impedía"),
  capacity: fixed("no alcanzan los lugares (ver aviso de capacidad)"),
  higher_priority: fixed("cumplirlo rompía algo más importante"),
  not_proven: fixed("el solver no alcanzó a comprobar si había otra opción"),
};
const withCause = (base: string, p: Params) => {
  const cause = MISSED_CAUSE[s(p, "cause")];
  return cause ? `${base.replace(/\.$/, "")} — ${cause.render({}, NO_NAMES)}.` : base;
};
const MISSED: Record<string, CodeCopy> = {
  cadence_on_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no dirigió domingo en ${monthName(s(p, "month"))}, su mes de dirigir («Mes por medio»).`, p) },
  cadence_off_led: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirigió domingo en ${monthName(s(p, "month"))}, su mes sin domingo («Mes por medio»).`, p) },
  compensation_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no tiene su sábado de compensación en ${monthName(s(p, "month"))}.`, p) },
  voice_floor_missed: { params: ["person", "month", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no canta en ningún servicio de ${monthName(s(p, "month"))}.`, p) },
  dl_floor_missed: { params: ["person", "month1", "month2", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} no dirige domingo ni en ${monthName(s(p, "month1"))} ni en ${monthName(s(p, "month2"))}.`, p) },
  sunday_cap_exceeded: { params: ["person", "month", "count", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige ${s(p, "count")} domingos en ${monthName(s(p, "month"))}; lo normal es uno.`, p) },
  saturday_cap_exceeded: { params: ["person", "month", "count", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige ${s(p, "count")} sábados en ${monthName(s(p, "month"))}; lo normal es uno.`, p) },
  consecutive_sundays: { params: ["person", "dates", "cause"], render: (p, n) => withCause(`${n.person(s(p, "person"))} dirige domingos seguidos: ${datesList(list(p, "dates"))}.`, p) },
};

export function missedLine(m: { code: string } & Record<string, unknown>, n: V3Names): string {
  return MISSED[m.code]?.render(m, n) ?? unknownCodeLine(m.code);
}

// ─── §7.3 Notices ───────────────────────────────────────────────────────────

const NOTICE: Record<string, CodeCopy> = {
  dl_capacity: {
    params: ["months", "seats", "people"],
    render: (p) => `Capacidad de Dom Lead en ${monthsList(list(p, "months"))}: ${s(p, "seats")} domingos para ${s(p, "people")} personas. No alcanza para que todas dirijan al menos un domingo cada dos meses.`,
  },
  exact_clamped: {
    params: ["rule", "person", "month", "value", "available"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» pide ${s(p, "value")} en ${monthName(s(p, "month"))}, pero ${n.person(s(p, "person"))} solo está disponible ${s(p, "available")}: se ajustó a ${s(p, "available")}.`,
  },
  min_clamped: {
    params: ["rule", "person", "month", "value", "available"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» pide al menos ${s(p, "value")} en ${monthName(s(p, "month"))}, pero ${n.person(s(p, "person"))} solo está disponible ${s(p, "available")}: se ajustó a ${s(p, "available")}.`,
  },
  presence_not_applicable: {
    params: ["rule", "service"],
    render: (p, n) => `«${n.rule(s(p, "rule"))}» no aplica el ${n.service(s(p, "service"))}: nadie de esa regla está disponible.`,
  },
};

export function noticeLine(code: string, params: Params, n: V3Names): string {
  return NOTICE[code]?.render(params, n) ?? unknownCodeLine(code);
}

// ─── §7.4 Unfilled seats and rule breaks ───────────────────────────────────

const UNFILLED: Record<string, CodeCopy> = {
  no_possible_lead: fixed("Nadie puede dirigir este servicio"),
  no_candidate: fixed("Sin candidatos disponibles: quienes podían ya tienen otro lugar en este servicio"),
  rules: fixed("Se dejó vacío: llenarlo rompía más reglas"),
  fill_not_proven: fixed("Se dejó vacío: el solver no alcanzó a llenarlo"),
};
export function V3_UNFILLED_MARKER(reason: string): string {
  return UNFILLED[reason]?.render({}, NO_NAMES) ?? unknownCodeLine(reason);
}
export const noPossibleLeadNotice = (service: string): string => `Nadie puede dirigir el ${service}: quedó sin líder.`;

const VIOLATION_CAUSE: Record<string, CodeCopy> = {
  pins: fixed(" — por lo que ya estaba puesto."),
  forced: fixed(" — no había forma de cumplirla junto con las demás reglas."),
};
const breakWithCause = (base: string, p: Params) =>
  `${base}${VIOLATION_CAUSE[s(p, "cause")]?.render({}, NO_NAMES) ?? "."}`;
const VIOLATION: Record<string, CodeCopy> = {
  mandatory_lead: { params: ["service", "cause"], render: (p, n) => breakWithCause(`El ${n.service(s(p, "service"))} quedó sin líder aunque alguien podía dirigir`, p) },
  count: { params: ["rule", "person", "month", "observed", "limit", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» en ${monthName(s(p, "month"))}: quedó en ${s(p, "observed")} (pide ${s(p, "limit")})`, p) },
  pair: { params: ["rule", "service", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» el ${n.service(s(p, "service"))}`, p) },
  presence: { params: ["rule", "service", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}» el ${n.service(s(p, "service"))}`, p) },
  consecutive: { params: ["rule", "person", "weekends", "cause"], render: (p, n) => breakWithCause(`No se cumplió «${n.rule(s(p, "rule"))}»: ${n.person(s(p, "person"))} quedó en fines de semana seguidos (${datesList(list(p, "weekends"))})`, p) },
};
export const V3_CEILING_UNPROVEN = "Puede que el solver haya cedido más reglas de las necesarias: no alcanzó a comprobarlo.";

/** A rule break. `mandatory_lead` is rendered from its own code by `{servicio}` — its `rule` is never looked up. */
export function violationLine(v: { code: string } & Record<string, unknown>, n: V3Names): string {
  return VIOLATION[v.code]?.render(v, n) ?? unknownCodeLine(v.code);
}

// ─── §7.5 Solver refusals ───────────────────────────────────────────────────

const plannerBug = (code: string): CodeCopy => ({
  params: ["field"],
  render: (p) => `El solver rechazó la solicitud por un error del planificador (${code}${p.field ? `: ${s(p, "field")}` : ""}). No se aplicó nada.`,
});
const adminFault = (code: string): CodeCopy => fixed(`No se pudo usar el solver (${code}). No se aplicó nada; avisa a quien administra la app.`);
const ERROR: Record<string, CodeCopy> = {
  timeout: fixed("El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar."),
  contract_mismatch: fixed("El solver no reconoce esta versión del planificador. Recarga la página; no se aplicó nada."),
  invalid_request: plannerBug("invalid_request"),
  unknown_person: plannerBug("unknown_person"),
  unknown_service: plannerBug("unknown_service"),
  pin_conflict: { params: [], render: () => "El solver rechazó la solicitud por un error del planificador (pin_conflict). No se aplicó nada." },
  invalid_json: { params: [], render: () => "El solver rechazó la solicitud por un error del planificador (invalid_json). No se aplicó nada." },
  too_many_pins: { params: ["count", "cap"], render: (p) => `El plan tiene ${s(p, "count")} lugares fijados y el solver acepta hasta ${s(p, "cap")}. Planea 1 mes o apaga «Solo llenar vacíos».` },
  unauthorized: adminFault("unauthorized"),
  misconfigured: adminFault("misconfigured"),
  method_not_allowed: adminFault("method_not_allowed"),
  internal_error: adminFault("internal_error"),
};

export function refusalLine(code: string, params: Params): string {
  return ERROR[code]?.render(params, NO_NAMES) ?? unknownCodeLine(code);
}

// ─── §7.7's registry groups (shown only through panel reasons) ──────────────

export const V3_CADENCE_STATE: Record<string, CodeCopy> = {
  on: fixed("le toca"),
  off: fixed("no dirige domingo"),
  out: fixed("no dirige domingo: no está en la lista de Dom Lead"),
};
export const V3_COMPENSATION: Record<string, CodeCopy> = {
  given: fixed("tiene su sábado de compensación"),
  missed: fixed("no tuvo su sábado de compensación"),
  not_applicable: fixed(""),
};

/** The groups of C5's registry C6 shows, each mirrored code for code (NT-4). */
export const V3_COPY_BY_GROUP = {
  error: ERROR,
  stage: STAGE,
  stage_status: STAGE_STATUS,
  stage_reason: STAGE_REASON,
  violation: VIOLATION,
  violation_cause: VIOLATION_CAUSE,
  unfilled_reason: UNFILLED,
  missed: MISSED,
  missed_cause: MISSED_CAUSE,
  notice: NOTICE,
  cadence_state: V3_CADENCE_STATE,
  compensation: V3_COMPENSATION,
} as const;
export type V3CopyGroup = keyof typeof V3_COPY_BY_GROUP;
/** Never shown, excluded from the sync BY NAME (NT-4). */
export const V3_HIDDEN_GROUPS = ["limit", "violation_rule"] as const;

// ─── §7.6 Route and client outcomes ─────────────────────────────────────────

export const V3_ROUTE_COPY = {
  versionMismatch: "El solver cambió de versión mientras planeabas. Recarga la página; no se aplicó nada.",
  timeout: "El solver tardó demasiado. No se aplicó nada. Prueba con 1 mes o vuelve a intentar.",
  connection: "No se pudo hablar con el solver. No se aplicó nada. Vuelve a intentar.",
  configuration: (motivo: string) => `No se pudo usar el solver (${motivo}). No se aplicó nada; avisa a quien administra la app.`,
  handshake: "El solver no respetó los lugares fijados; no se aplicó nada.",
  ledgerFailed: "No se pudo leer el saldo de equidad. Auto no corrió; vuelve a intentar.",
} as const;

/** `unknown_service` is the client's own configuration outcome: an assignment id the request did not send (AD-5). */
export function transportLine(reason: V3TransportReason | "unknown_service"): string {
  if (reason === "timeout") return V3_ROUTE_COPY.timeout;
  if (reason === "unreachable" || reason === "http_status" || reason === "not_json") return V3_ROUTE_COPY.connection;
  return V3_ROUTE_COPY.configuration(reason);
}

// ─── §7.9 Resolver refusals (C2 IF2-15) ─────────────────────────────────────

const AUTO = "No se puede correr Auto: ";

/**
 * One line per IF2-15 `refusals` item, keyed on ITS union: a reason C2 adds without copy fails
 * `tsc`. `exactLeadLabel` is the card label of the person's exact `Sun.Lead` rule when the caller
 * found one (only `cadence_and_exact` reads it).
 */
export const V3_RESOLVER_REFUSAL: Record<EligibilityRefusalReason, (person: string, month: string, exactLeadLabel: string | null) => string> = {
  unresolved: (p) => `${AUTO}«${p}» en las reglas no coincide con nadie. Corrige el nombre en la regla.`,
  ambiguous: (p) => `${AUTO}«${p}» en las reglas coincide con más de una persona. Corrige el nombre en la regla.`,
  no_tipo: (p) => `${AUTO}«${p}» en las reglas no tiene Tipo. Corrige el nombre en la regla.`,
  cadence_and_exact: (p, _m, label) => cadenceAndExactLine(p, label ?? "regla fija"),
  overlapping_exact: (p) => `${AUTO}${p} tiene dos números fijos para el mismo rol. Deja una sola regla.`,
  exact_count_range: (p, m) => `${AUTO}la regla fija de ${p} no da un número entero de 0 a 31 lugares en ${monthName(m)}. Corrígela.`,
  presence_member_not_listed: (p) => `${AUTO}${p} está en una regla de presencia pero no canta (su Tipo no incluye voz). Corrige la regla o su Tipo.`,
};

const PRESENCE_ISSUE = `${AUTO}una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala.`;
/** One line per IF2-15 `issues` item, keyed on ITS union. An issue's `ruleKey` is never rendered (KH-1). */
export const V3_RESOLVER_ISSUE: Record<EligibilityIssueCode, string> = {
  presence_members: PRESENCE_ISSUE,
  presence_roles: PRESENCE_ISSUE,
  presence_rule_id: PRESENCE_ISSUE,
  too_many_presence: PRESENCE_ISSUE,
  no_people: `${AUTO}no hay nadie con Tipo de voz en el equipo.`,
  too_many_people: `${AUTO}hay más de 100 personas de voz.`,
};

function cadenceAndExactLine(person: string, ruleLabel: string): string {
  return `${AUTO}${person} tiene «Mes por medio» y además un número fijo de Dom Lead («${ruleLabel}»). Quita una de las dos.`;
}

// ─── §7.3's own lines: IF2-17 refusals ──────────────────────────────────────

type CapRefusalReason = Extract<ReturnType<typeof capValueForMonth>, { ok: false }>["reason"];
/** Keyed on IF2-17's `reason` union: a reason C2 adds without copy fails `tsc` (RQ-5). */
export const V3_CAP_REFUSAL: Record<CapRefusalReason, (ruleLabel: string, months: readonly string[]) => string> = {
  not_whole: (rule, months) => `${AUTO}«${rule}» no da un número entero de lugares en ${monthsList(months)}. Corrige su número.`,
  negative: (rule) => `${AUTO}«${rule}» pide un número negativo de lugares. Corrige su número.`,
};

// ─── §7.8 Confirm ───────────────────────────────────────────────────────────

const conflictLine = (m: string) =>
  `Otro administrador registró o cambió la elegibilidad de ${monthName(m)} mientras planeabas. No se creó nada; vuelve a correr Auto.`;
const teamLine = () => "Cambió el equipo mientras planeabas (un miembro o su Tipo). No se creó nada; vuelve a correr Auto.";

/** Keyed on IF2-6's PUT union: every code the route can answer has a line, at compile time. */
export const V3_CONFIRM_REFUSAL: Record<FairnessPutRefusal, (month: string) => string> = {
  record_exists: conflictLine,
  stale_revision: conflictLine,
  record_missing: conflictLine,
  month_has_services: (m) => `Se guardaron servicios en ${monthName(m)} mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.`,
  past_month: (m) => `${monthNameCap(m)} ya pasó mientras planeabas. No se creó ningún servicio; vuelve a correr Auto.`,
  engine_not_v3: () => "El solver cambió de versión. Recarga la página; no se creó nada.",
  member_unknown: teamLine,
  member_not_worship: teamLine,
  tipo_mismatch: teamLine,
};

// ─── §7.7 Panel reasons ─────────────────────────────────────────────────────

export const V3_PANEL_REASON = {
  cadenceOn: (month: string) => `Mes por medio: le toca en ${monthName(month)}.`,
  cadenceOff: (month: string) => `Mes por medio: no dirige domingo en ${monthName(month)}.`,
  compensation: (month: string) => `Sábado de compensación en ${monthName(month)}.`,
  unavailable: (dates: readonly string[]) => `No disponible ${datesList(dates)}: esas fechas no le cuentan.`,
  fixedRule: (ruleLabel: string) => `Su número lo fija «${ruleLabel}».`,
  pins: (n: number) => `Los pines tomaron ${n} lugares.`,
  exempt: "Exenta: fuera de Total y del mínimo de voz.",
} as const;

// ─── C6's own lines (§7.3, §7.6, §7.8 and the ST/SP/WN/HZ/RQ/NT rows) ───────

export const V3_LINES = {
  // HZ-7, HZ-9 (also CF-1's ceiling line, unchanged)
  horizonPast: "Auto no planea meses que ya pasaron. Crea esos servicios a mano.",
  horizonCeiling: (month: string, limit: string) =>
    `Auto no planea más de 12 meses adelante: ${monthNameCap(month)} queda fuera. Elige un mes hasta ${monthName(limit)}.`,
  // ST-1, ST-5, ST-6
  storedReadFailed: (months: readonly string[]) =>
    `No se pudieron leer los servicios guardados de ${monthsList(months)}. Auto no corrió; vuelve a intentar.`,
  storedEmptySeats: (n: number) =>
    `Los servicios guardados no se tocan: sus ${n} lugares de voz vacíos se quedan vacíos. Llénalos en «Editar mes».`,
  storedNonMember: (service: string) =>
    `${service.charAt(0).toUpperCase()}${service.slice(1)}: un lugar guardado es de alguien que ya no está en la lista; no se envió al solver.`,
  storedDoubleSeat: (person: string, service: string, role: string) =>
    `${person} está dos veces en el ${service} guardado; se envió solo como ${role} y su saldo cuenta solo ese lugar.`,
  // ST-8 banners
  allBound: (months: readonly string[]) =>
    `${monthsList(months, true)} ya tienen servicios guardados y elegibilidad registrada: se planea con esas listas, sus reglas fijas, de presencia y de semanas, y estas casillas no aplican.`,
  bound: (month: string, recordedOn: string) =>
    `${monthNameCap(month)} ya tiene servicios guardados y elegibilidad registrada (${recordedOn}): se planea con esa lista y sus reglas fijas, de presencia y de semanas; las casillas y esas reglas en pantalla no aplican a ${monthName(month)}. Como ya tiene servicios guardados, ese registro ya no se puede cambiar.`,
  recordedUnbound: (month: string, recordedOn: string) =>
    `${monthNameCap(month)} tiene elegibilidad registrada (${recordedOn}) pero ningún servicio guardado: se planea con las casillas en pantalla y, al crear, ese registro se reemplaza.`,
  anchoredUnrecorded: (month: string) =>
    `${monthNameCap(month)} ya tiene servicios guardados pero no tiene elegibilidad registrada: se planea con las casillas en pantalla y, al crear, se registra con ellas. Como ya tiene servicios guardados, ese registro ya no se podrá cambiar.`,
  // ST-9
  autoConfirm: (months: readonly string[]) =>
    `Esto reemplazará toda asignación de voz (Lead, BGV, Coro) que el solver pueda resolver en ${monthsList(months)}. Los servicios guardados no se tocan.`,
  // SP-5, SP-6, SP-7
  prefillNotRun: "Los especiales que cuentan para equidad no se llenaron porque Auto no corrió.",
  prefillDone: "Los especiales que cuentan para equidad se llenaron primero (Lead y BGV, por saldo) y el solver acomodó los fines de semana alrededor de ellos.",
  secondTier: (person: string, service: string, motivo: string) =>
    `${person} dirige el ${service} aunque ${motivo}: nadie más podía dirigirlo.`,
  motivoCadence: "es su mes sin domingo («Mes por medio»)",
  motivoSundayCap: (month: string) => `ya dirige otro domingo en ${monthName(month)}`,
  motivoSaturdayCap: (month: string) => `ya dirige otro sábado en ${monthName(month)}`,
  motivoConsecutive: "dirige el domingo anterior o el siguiente",
  // RQ-4
  horizonDisagreement: (m1: string, m2: string, which: "Exenta" | "Mes por medio", person: string) =>
    `${monthNameCap(m1)} y ${monthName(m2)} tienen distinto «${which}» para ${person} (uno viene del registro). Planea 1 mes.`,
  // RQ-5
  relativeZero: (ruleLabel: string, month: string, sundays: number) =>
    `${ruleLabel} queda en 0 en ${monthName(month)} (tiene ${sundays} domingos).`,
  weekNotApplicable: (ruleLabel: string, month: string, week: number) =>
    `${ruleLabel} no aplica en ${monthName(month)}: ese mes no tiene semana ${week}.`,
  recordedExactLabel: (month: string) => `regla fija registrada de ${monthName(month)}`,
  recordedPresenceLabel: "regla de presencia registrada",
  // RQ-6
  pinCap: (n: number, max: number) =>
    `El plan tiene ${n} lugares fijados (guardados, especiales y del tablero) y el solver acepta hasta ${max}. Planea 1 mes o apaga «Solo llenar vacíos».`,
  boardNonMember: (seat: string) =>
    `No se puede usar «Solo llenar vacíos»: en ${seat} hay alguien que ya no está en la lista de miembros. Quítalo de ese lugar y vuelve a intentarlo.`,
  // RQ-10
  tooLarge: (what: "servicios" | "personas" | "reglas", n: number, max: number) =>
    `El plan es demasiado grande para el solver (${what}: ${n} de ${max}). Planea 1 mes.`,
  // WN-2
  cadenceName: (person: string, motivo: string) =>
    `No se puede correr Auto: «Mes por medio» de «${person}» no corresponde a una sola persona (${motivo}). Corrige el nombre en la regla.`,
  cadenceNameNone: "no coincide con nadie",
  cadenceNameMany: (n: number) => `coincide con ${n} personas`,
  cadenceAndExact: cadenceAndExactLine,
  // WN-3
  saturdayPool: "Con el nuevo solver, «Líderes Sábado» ya no aparta un líder para cada sábado: quien esté solo ahí dirige únicamente sábados.",
  // WN-1 month naming (beside C3's unchanged heading and sentences)
  monthsPrefix: (months: readonly string[]) => monthsList(months, true),
  // NT-1
  runLine: (months: readonly string[], services: number, stored: number) =>
    `Plan de ${months.length} ${months.length === 1 ? "mes" : "meses"}: ${monthsList(months)} · ${services} servicios (${stored} guardados, se respetan tal cual).`,
  allProven: "Todas las etapas quedaron probadas.",
  stageNotProven: (label: string, status: string) => `${label}: ${status}`,
  seeStages: "Ver etapas",
  ruleTableTitle: "Reglas enviadas (id, tipo, posición en la configuración)",
  // CF-6, CF-8, CF-10 and §7.8's other lines
  recordOtherFailure: "No se pudo registrar la elegibilidad. No se creó nada; pulsa «Reintentar».",
  draftsOutsideHorizon: (months: readonly string[]) =>
    `La vista previa tiene servicios fuera de ${monthsList(months)}. No se creó nada; vuelve a previsualizar.`,
  pastAfterDrafts: (month: string) =>
    `${monthNameCap(month)} ya pasó mientras planeabas, así que no se creó nada más. Lo ya creado se queda; completa lo que falta en «Editar mes».`,
  monthComplete: (month: string, c: number, t: number) => `${monthNameCap(month)}: ${c} de ${t} creados.`,
  monthPartial: (month: string, c: number, t: number, f: number) => `${monthNameCap(month)}: ${c} de ${t} creados; ${f} fallaron.`,
  monthNotAttempted: (month: string, previous: string) =>
    `${monthNameCap(month)}: no se intentó porque ${monthName(previous)} quedó incompleto.`,
  retry: (n: number) => `Reintentar (${n} pendientes)`,
  twoMonthSummary: (m1: string, a: number, m2: string, b: number) =>
    `${monthNameCap(m1)}: ${a} · ${monthNameCap(m2)}: ${b}. Se crean como borradores; publícalos después.`,
  incompleteTitle: "El plan quedó incompleto",
  incompleteBody: (gaps: ReadonlyArray<{ month: string; missing: number }>) =>
    gaps.map((g) => `${monthNameCap(g.month)}: faltan ${g.missing} servicios.`).join(" ") +
    " Si sales, se quedan así; puedes completarlos en «Editar mes».",
  leave: "Salir así",
  stay: "Seguir aquí",
  draftConflict: "Alguien más cambió esas fechas: recarga y revisa.",
  // EQ-3 — the two plan columns (U5)
  colEnEstePlan: "En este plan",
  colQueda: "Queda",
  // EQ-7 — the ledger's diagnostics, in the derived history's own wording
  diagDuplicates: (list: string) => `Servicios duplicados en una fecha — no cuenta ninguno: ${list}`,
  diagNotInRecord: (n: number) => `Lugares de personas que no están en el registro de su mes — no cuentan: ${n}`,
  diagUnknownMembers: (n: number) => `Miembros asignados sin ficha — no cuentan: ${n}`,
} as const;

// ─── MCP P4: the connector's twins (`solve_month`, `apply_schedule`) ─────────
//
// The browser's confirm lines say «No se creó nada» and «Otro administrador…» because its session
// lives in memory and CF-7 never resends a landed PUT. A connector apply may span several calls, any
// of which may be killed or lose its answer, so its lines obey R-OBS and R-CALL (plan step 6): a
// negative claim is about THIS call only, and only when the call knows it; a lost answer is
// «sin confirmar», never «falló»; a conflict may be another call of the same proposal, never
// «otro administrador». `mcpCopyHygiene` in the tool tests pins the forbidden phrases.

const NO_WRITE_THIS_CALL = "En esta llamada no se escribió nada.";
const RESOLVE_AGAIN = "vuelve a correr solve_month";
const connectorConflictLine = (m: string) =>
  `El registro de elegibilidad de ${monthName(m)} cambió desde que se resolvió esta propuesta. ${NO_WRITE_THIS_CALL} ` +
  `Si otra llamada de apply_schedule con esta propuesta está en curso, vuelve a llamarla en un momento; si no, ${RESOLVE_AGAIN}.`;
const connectorTeamLine = () =>
  `Cambió el equipo desde que se resolvió esta propuesta (un miembro o su Tipo). ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`;

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  roles: "los servicios",
  members: "los miembros",
  rules: "las reglas",
  snapshot: "el estado de los servicios",
  proposals: "las propuestas",
  roleTargets: "los destinos de servicio",
  setlistTargets: "los setlists",
};

export const V3_CONNECTOR_LINES = {
  noWriteThisCall: NO_WRITE_THIS_CALL,
  // Both tools
  engineNotV3: "El conector solo planea con el solver v3 y este servidor no lo está usando.",
  noPrincipal: "No se pudo identificar quién llama; vuelve a conectar el conector.",
  sources: (sources: readonly string[]) =>
    `No se pudieron leer ${joinEs(sources.map((s) => SOURCE_NAMES[s] ?? s))}. Vuelve a intentar.`,
  // solve_month
  invalid: {
    month: "month debe ser un mes YYYY-MM entre 2024 y 2035.",
    months: "months debe ser 1 o 2.",
    exclusion_not_weekend_of_horizon:
      "Cada fecha excluida debe ser un domingo (en excludeSundays) o un sábado (en excludeSaturdays) de los meses pedidos, sin repetir.",
    special_not_in_horizon: "Cada especial debe caer en un día de los meses pedidos.",
    no_columns: "Con esas exclusiones no queda ningún servicio que planear.",
  } as Readonly<Record<string, string>>,
  noProposalStored: "No se guardó ninguna propuesta.",
  timeBudget: "Se acabó el tiempo de esta llamada antes de llamar al solver. No se guardó ninguna propuesta; vuelve a correr solve_month.",
  nothingToCreate: "Ningún servicio planeado se puede crear (todos están ocupados o bloqueados), así que no se guardó ninguna propuesta.",
  storeFailed: "No pude guardar la propuesta; vuelve a correr solve_month.",
  handle: (handle: string, expires: string) =>
    `Propuesta ${handle} (vence ${expires}). Para crear estos servicios como borradores, llama apply_schedule con esa propuesta.`,
  refusedSpecial: (date: string, reason: string) => `Especial del ${dayLabel(date)} no agregado: ${reason}`,
  leftOut: (service: string, reasons: string) => `${service}: no se planeó (${reasons}).`,
  unfilled: (service: string, seat: string) => `${service}: ${seat} sin cubrir.`,
  unavailable: (name: string, service: string) => `${name} no está disponible el ${service}.`,
  fairness: (name: string, tabs: readonly string[]) => `${name}: ${tabs.join(" · ")}`,
  fairnessTab: (label: string, seats: number, queda: string) => `${label} ${seats} en este plan, queda ${queda}`,
  // apply_schedule, phases 0–3
  proposalNotFound: "No encontré esa propuesta o ya venció. Vuelve a correr solve_month.",
  proposalReadFailed: `No se pudo leer la propuesta; vuelve a intentar. ${NO_WRITE_THIS_CALL}`,
  rulesChanged: `Las reglas del planificador cambiaron desde que se resolvió esta propuesta. ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`,
  targetLost: (service: string, reasons: string) => `${service} ya no se puede crear (${reasons}).`,
  specialTaken: (service: string, refusal: string) => `${service}: ${refusal}`,
  storedChanged: (months: readonly string[]) =>
    `Cambiaron los servicios guardados de ${monthsList(months)} desde que se resolvió esta propuesta.`,
  resolveAgain: `${NO_WRITE_THIS_CALL} Vuelve a correr solve_month: el nuevo plan toma lo guardado como fijo.`,
  exists: (services: readonly string[]) => `Ya existen: ${joinEs(services)}.`,
  // phase 4, the records
  recordRefusal: {
    record_exists: connectorConflictLine,
    stale_revision: connectorConflictLine,
    record_missing: connectorConflictLine,
    month_has_services: (m) =>
      `${monthNameCap(m)} ya tiene servicios guardados que esta propuesta no creó, así que su registro ya no se puede reemplazar. ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`,
    past_month: (m) => `${monthNameCap(m)} ya pasó desde que se resolvió esta propuesta. ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`,
    engine_not_v3: () => `El solver cambió de versión. ${NO_WRITE_THIS_CALL}`,
    member_unknown: connectorTeamLine,
    member_not_worship: connectorTeamLine,
    tipo_mismatch: connectorTeamLine,
  } satisfies Record<FairnessPutRefusal, (month: string) => string>,
  recordInvalid: `El registro de elegibilidad de la propuesta fue rechazado como inválido. ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`,
  recordUnknown:
    "No pude confirmar si el registro de elegibilidad quedó guardado; volver a llamar apply_schedule es seguro (si quedó, responde sin cambios).",
  guardPast: (m: string) => `${monthNameCap(m)} ya pasó desde que se resolvió esta propuesta. ${NO_WRITE_THIS_CALL} Vuelve a correr solve_month.`,
  recordsSaved: (months: readonly string[]) => `El registro de elegibilidad de ${monthsList(months)} quedó guardado.`,
  // phase 4, per service
  serviceCreated: (s: string) => `${s}: creado.`,
  serviceAlready: (s: string) => `${s}: ya estaba creado (confirmado por su recibo).`,
  serviceDeleted: (s: string) => `${s}: creado y luego eliminado en /admin; esta propuesta no lo vuelve a crear.`,
  serviceModified: (s: string) => `${s}: creado y luego modificado en /admin.`,
  serviceRefused: (s: string, why: string) => `${s}: rechazado. ${why}`,
  serviceUnknown: (s: string) => `${s}: sin confirmar; vuelve a llamar apply_schedule (si quedó creado se reconoce por su recibo).`,
  servicePending: (s: string) => `${s}: pendiente; vuelve a llamar apply_schedule.`,
  serviceBlocked: (s: string) => `${s}: bloqueado porque un servicio anterior fue rechazado; vuelve a correr solve_month.`,
  serviceNotPlanned: (s: string) => `${s}: no se planeó (su fecha estaba bloqueada al resolver).`,
  monthHeader: (m: string) => `${monthNameCap(m)}:`,
  cutoffNothing:
    "Esta llamada llegó a su límite de tiempo antes de crear un servicio nuevo. Vuelve a llamar apply_schedule; si vuelve a pasar, avísale a quien administra la app.",
  complete: "Listo: todos los servicios de la propuesta están creados como borradores. Revísalos y publícalos en /admin.",
  // phase 5
  stateSaveFailed: "No pude guardar el avance; volver a llamar apply_schedule es seguro: lo creado se reconoce por su recibo.",
} as const;

/**
 * The MCP proposal editor (docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md): the month
 * check's lines (E5, grouped «Reglas del mes», «Servicios incompletos», «Equidad»), the per-seat
 * rule warnings and waivers (T2.2), and the editor tools' and apply's new answers. People by name
 * and rules by their card label (`V3Names`) — never a rule key or an id (C6 U8, KH-1).
 */
export const V3_EDITOR_LINES = {
  // The month check (E5)
  groupRules: "Reglas del mes:",
  groupServices: "Servicios incompletos:",
  groupFairness: "Equidad (lugares en el plan contra lo que le tocaba):",
  groupSeatRules: "Reglas por lugar:",
  count: (rule: string, month: string, op: "==" | "<=" | ">=", observed: number, limit: number, available: number) => {
    const asks = op === "==" ? `pide ${limit}` : op === ">=" ? `pide al menos ${limit}` : `pide como máximo ${limit}`;
    const short = op !== "<=" && available < limit ? `; solo estaba disponible ${available}` : "";
    return `«${rule}» en ${monthName(month)}: quedó en ${observed} (${asks}${short}).`;
  },
  pair: (rule: string, service: string) => `«${rule}» el ${service}: quedaron juntos.`,
  presence: (rule: string, service: string) => `«${rule}» el ${service}: no quedó nadie de la regla.`,
  noLead: (service: string) => `El ${service} quedó sin Lead.`,
  seats: (service: string, seat: string, held: number, target: number) => `${service}: ${seat} ${held} de ${target}.`,
  unavailableSeated: (name: string, service: string) => `${name} está en el ${service} y marcó que no puede ese día.`,
  fairShare: (name: string, month: string, seats: number, share: string) =>
    `${name} en ${monthName(month)}: ${seats} ${seats === 1 ? "lugar" : "lugares"}; le tocaban ${share}.`,
  uncountedSpecials: "Los especiales que no cuentan para equidad no se revisan contra las reglas del mes.",
  allClear: "Todo cuadra con las reglas del mes.",
  unchecked: "Sin revisar: no pude leer el registro de equidad, así que la revisión del mes quedó incompleta.",
  uncheckedBuild: "Sin revisar: no pude armar la revisión del mes con las reglas guardadas.",
  omittedLedger: "No revisé «Mes por medio», «Domingo cada dos meses», las demás protecciones del solver ni la equidad (necesitan el registro de equidad).",
  ledgerToday: "Las protecciones se revisan según el registro de equidad de hoy.",
  // The replay's refusals (T2.3; R1–R14 of the P4 plan)
  notEligible: "Ese id no es de un miembro del equipo de alabanza con el Tipo de este lugar.",
  replay: {
    unknown_service: "Ese servicio no está en la propuesta.",
    column_not_created: "Ese servicio no se va a crear con esta propuesta; no se puede editar.",
    unknown_row: "Ese lugar no existe en el planificador.",
    row_not_on_column: "Ese lugar no existe en este servicio.",
    already_in_cell: "Ya está en esta casilla",
    member_not_in_cell: "Esa persona no está en ese lugar.",
    same_seat: "El origen y el destino son el mismo lugar.",
    judge_disagreement: "No pude confirmar esta regla; no se guardó nada.",
    server_error: "No pude preparar las reglas de este servicio; no se guardó nada.",
  },
  cellLimit: (n: number) => `Una casilla admite como máximo ${n} personas.`,
  tooManyEdits: (n: number) => `Se aceptan como máximo ${n} cambios por llamada.`,
  // Per-seat rules (T2.2)
  solverWarning: (sentence: string, where: string) => `${where}: ${sentence} (lo traía el plan del solver).`,
  appeared: (sentence: string, where: string) => `${where}: ${sentence} (apareció sin que editaras).`,
  waived: (sentence: string, where: string) => `${where}: ${sentence} (asignado de todos modos).`,
  dormant: (sentence: string, where: string) => `${where}: ${sentence} (asignado de todos modos; sin efecto por ahora).`,
  dropped: (sentence: string, where: string) => `${where}: ${sentence} (ya no aplica: ese lugar cambió).`,
  needsConfirm: (sentence: string, where: string) => `${where}: ${sentence}`,
  forceNotice: "Lo que tú fuerces aparece en el permiso al cargar; lo que el solver ya traía o lo que cambió solo se muestra como aviso.",
  // Tools
  saved: (handle: string, revision: number) => `Guardé la versión ${revision} de la propuesta: ${handle}. Para crear estos servicios como borradores, llama apply_schedule con esa propuesta.`,
  savedUnchecked: "Se guardó «sin revisar».",
  superseded: (handle: string) => `Esta propuesta ya fue reemplazada por una versión más nueva: ${handle}. Usa esa.`,
  startedApplying: "Esta propuesta ya empezó a crear servicios, así que ya no se puede editar. Termina de cargarla o vuelve a correr solve_month.",
  revisionLimit: "Esta propuesta ya tiene 30 versiones; vuelve a correr solve_month para seguir editando.",
  mustResolve: "Esta propuesta ya no se puede cargar tal cual; hay que volver a generar el mes con solve_month antes de editarla.",
  editRefused: (index: number, why: string) => `El cambio ${index + 1} no se aplicó: ${why}`,
  confirmFirst: "Estos cambios rompen reglas que hay que confirmar antes de guardar:",
  staleCheck: "Algo cambió desde la revisión (los miembros o las reglas); revisa de nuevo lo que hay que confirmar:",
  ambiguousName: (name: string, options: readonly string[]) =>
    options.length ? `«${name}» puede ser ${joinEs(options)}; usa el nombre completo.` : `No encontré a «${name}» en el equipo de alabanza.`,
  unknownSeat: (seat: string) => `No reconozco el lugar «${seat}».`,
  noSecret: "El conector no está configurado para editar propuestas; avisa a quien administra la app.",
  saveFailed: "No pude guardar la versión; vuelve a intentar. No se guardó nada.",
  saveConflict: "Otra edición de esta propuesta llegó al mismo tiempo; vuelve a intentar.",
  saveUnknown: "No pude confirmar si la versión se guardó. Vuelve a guardar los mismos cambios: si ya quedó, se reconoce y no se crea otra.",
  // apply_schedule (Q1, E3)
  applySuperseded: (handle: string) =>
    `Esta propuesta fue reemplazada por una versión más nueva: ${handle}. ${NO_WRITE_THIS_CALL} Carga la versión más nueva.`,
  applySupersededContinuing: (handle: string) =>
    `Esta propuesta fue reemplazada por ${handle}, pero ya había creado servicios, así que se termina de cargar esta.`,
  applyRevision: (revision: number) => `Versión ${revision} de la propuesta.`,
  applyUnchecked: "Esta versión se guardó «sin revisar»: la revisión del mes no se pudo completar.",
  applyWaiversMissing: (n: number) =>
    `Esta versión tiene ${n === 1 ? "un lugar asignado" : `${n} lugares asignados`} de todos modos contra una regla. ${NO_WRITE_THIS_CALL} Vuelve a llamar apply_schedule repitiendo en waivers exactamente estos (lugares y nombres como están hoy):`,
  applyWaiverItem: (service: string, members: string, rule: string) => `${service} · ${members} · ${rule}`,
} as const;

/**
 * The MCP editor over a SAVED month (admin parity phase 1, S2): `check_service_edits`,
 * `check_service_edits_app` and `save_service_edits`. The change lines are what the Claude app's
 * permission prompt shows before anything is written (F4), so they name people and seats in words.
 */
/**
 * The argument lines of a saved-month check (ADR-0066): the Claude app hands the model only a tool
 * answer's TEXT, so the change sets ride in the text too. The card hides lines with these prefixes
 * (`mcp-app/proposal-card/storedModel.ts` mirrors them; `storedMonthCard.test.tsx` pins the pair).
 */
export const SAVE_ARGS_PREFIX = "Argumentos para save_service_edits (pásalos tal cual):";
export const COPY_ARGS_PREFIX = "Argumentos para copy_instruments (pásalos tal cual):";

export const V3_STORED_EDITOR_LINES = {
  // The change lines (F4)
  seatChange: (service: string, seat: string, enters: readonly string[], leaves: readonly string[]) => {
    const parts = [
      enters.length ? `${enters.length === 1 ? "entra" : "entran"} ${joinEs(enters)}` : "",
      leaves.length ? `${leaves.length === 1 ? "sale" : "salen"} ${joinEs(leaves)}` : "",
    ].filter(Boolean);
    return `${service} · ${seat}: ${parts.join("; ")}`;
  },
  rename: (service: string, from: string, to: string) => `${service} · nombre: «${from}» → «${to}»`,
  time: (service: string, from: string | null, to: string | null) => `${service} · hora: ${from ?? "sin hora"} → ${to ?? "sin hora"}`,
  counts: (service: string, to: boolean) => `${service} · Cuenta para equidad: ${to ? "sí" : "no"}`,
  forced: (sentence: string, where: string) => `${where}: ${sentence} (asignado de todos modos).`,
  reforced: (sentence: string, where: string) => `${where}: ${sentence} (asignado de todos modos; ya estaba rota antes de este cambio).`,
  baseline: (sentence: string, where: string) => `${where}: ${sentence} (ya estaba así antes de este cambio).`,
  // The judge's refusals beyond the replay's
  judge: {
    not_editable: "Ese servicio no se puede editar desde el chat (su documento no está listo para editarse); hazlo en /admin.",
    unknown_service: "Ese servicio no es de este mes.",
    date_changed: "Desde el chat no se cambia la fecha de un servicio; hazlo en /admin.",
    type_changed: "El tipo de servicio no se puede cambiar.",
    header_invalid: "El nombre o la hora del servicio no son válidos (solo un especial lleva nombre y hora).",
    past_counts: "«Cuenta para equidad» no se puede cambiar en un mes que ya pasó.",
    unknown_row: "Ese lugar no existe en este mes (desde el chat solo se editan los lugares que ya existen).",
  },
  needsCard: "Forzar una regla por lugar solo se puede desde la tarjeta («Asignar de todos modos»); desde el chat no se fuerza nada.",
  noChanges: "No hay cambios: así está guardado.",
  readOnlyMonth: "Este mes no se puede editar desde el chat ahora: el inventario de servicios no cuadra. Revisa la cola de integridad (get_integrity_queue) o edítalo en /admin.",
  untranslated: (n: number) => `${n === 1 ? "Un servicio" : `${n} servicios`} de este mes no se pueden leer como el planificador los lee; no aparecen aquí.`,
  checkHead: (n: number) => `${n === 1 ? "Un servicio cambia" : `${n} servicios cambian`}. Para guardar, llama save_service_edits con los argumentos de la última línea, tal cual:`,
  /** The model sees only the text of a tool answer, never `structuredContent`: the save's arguments travel here. */
  saveArgs: (json: string) => `${SAVE_ARGS_PREFIX} ${json}`,
  groupNote: (labels: readonly string[]) => `${joinEs(labels)} se guardan juntos, uno tras otro (alguien sale de uno y entra a otro).`,
  groupTooBig: (n: number, max: number) =>
    `Estos cambios ligan ${n} servicios (gente que sale de uno y entra a otro); se pueden guardar como máximo ${max} ligados por llamada. Guarda esos cambios en partes: en cada llamada, los cambios que comparten el mismo unit.`,
  unitIncomplete: (missing: readonly string[]) =>
    `Estos cambios se revisaron junto con ${joinEs(missing)} (alguien sale de uno y entra a otro) y se guardan juntos. ${NO_WRITE_THIS_CALL} Manda también esos cambios, tal cual los devolvió la revisión.`,
  // The save
  noneToSave: "Todo ya estaba guardado así; no se escribió nada.",
  changed: (services: readonly string[]) =>
    `${joinEs(services)} ${services.length === 1 ? "cambió" : "cambiaron"} desde que lo revisaste (alguien lo editó o se guardó su setlist). ${NO_WRITE_THIS_CALL} Revisa el mes de nuevo con check_service_edits.`,
  notTheChecked: (service: string) =>
    `Los cambios de ${service} no son los que se revisaron (o cambiaron los nombres o las reglas). ${NO_WRITE_THIS_CALL} Revisa de nuevo con check_service_edits.`,
  waiverMissing: (sentence: string, where: string) => `${where}: ${sentence}`,
  waiverMissingHead: `Estos cambios rompen reglas por lugar que solo se pueden forzar desde la tarjeta. ${NO_WRITE_THIS_CALL}`,
  refusedAll: (service: string, why: string) => `${service}: ${why} ${NO_WRITE_THIS_CALL}`,
  status: {
    already: "ya estaba",
    saved: "guardado",
    savedNoticesUnknown: "guardado, avisos sin confirmar",
    unknown: "sin confirmar",
    pending: "pendiente (no se empezó)",
    notSavedRepeat: "no se guardó: otra edición llegó al mismo tiempo; repite la misma llamada",
    notSavedRecheck: (why: string) => `no se guardó: ${why}; revisa el mes de nuevo`,
    notSavedGroup: "no se guardó (otro servicio de su grupo no se pudo guardar)",
  },
  reason: {
    stale_revision: "alguien lo cambió mientras se guardaba",
    not_found: "ese servicio ya no existe",
    integrity_conflict: "sus datos no cuadran (revisa la cola de integridad)",
    ambiguous_target: "hay más de un documento para ese servicio",
    dependency_conflict: "otro documento depende de él",
    invalid_request: "la petición no es válida",
    forbidden: "no está permitido",
    bootstrap_completed_reload: "su documento se acaba de reparar",
  } as Record<string, string>,
  line: (service: string, status: string) => `${service}: ${status}.`,
  savedHead: "Resultado del guardado:",
  noticesUnknown: "Algunos servicios quedaron guardados pero no pude confirmar sus avisos por correo; revisa que el equipo reciba el aviso.",
  repeatSame: "Repite exactamente la misma llamada: lo que ya quedó se reconoce como «ya estaba» y se guarda el resto.",
  recheck: "Revisa el mes de nuevo con check_service_edits antes de volver a guardar.",
  stoppedGroup: "Me detuve: un servicio de un grupo ya guardado a medias no se pudo guardar.",
  whereNow: (name: string, services: readonly string[]) =>
    services.length ? `${name} quedó en ${joinEs(services)}.` : `${name} ya no está en ningún servicio del mes.`,
  storedNotice: "Los servicios publicados avisan por correo a su equipo como en /admin.",
  songLeadGone: (service: string, name: string) => `${service}: ${name} dirige una canción del setlist y ya no está en el Lead.`,
  headerOnlySpecial: "Solo un servicio especial tiene nombre y hora.",
  nothingToCheck: "No hay nada que revisar: manda edits (cambios) o copy (una copia de instrumentos).",
  // Copy instruments (S3): the check's lines, then the write's
  copy: {
    head: (from: string, to: string) => `Copiar los instrumentos de ${from} a ${to} (reemplaza los que tiene ${to}):`,
    seat: (service: string, seat: string, names: readonly string[]) => `${service} · ${seat}: ${joinEs(names)}`,
    cleared: (service: string, seat: string) => `${service} · ${seat}: queda vacío`,
    empty: (service: string) => `${service} queda sin instrumentos.`,
    nothing: (service: string) => `${service} ya tiene esos mismos instrumentos; no hay nada que copiar.`,
    alone: "La copia de instrumentos se revisa sola: no la mezcles con otros cambios en la misma revisión.",
    noSource: "No encuentro el servicio de origen.",
    sameService: "El origen y el destino son el mismo servicio.",
    sourceUnreadable: "El servicio de origen no se puede leer como lo lee el planificador; copia desde /admin.",
    checkHead: "Para copiarlos, llama copy_instruments con los argumentos de la última línea, tal cual:",
    args: (json: string) => `${COPY_ARGS_PREFIX} ${json}`,
    needsCard: `Esta copia rompería una regla por lugar, y una copia no se fuerza desde el chat: hazla en /admin («Copiar instrumentos») o cambia antes esos lugares. ${NO_WRITE_THIS_CALL}`,
    notTheChecked: (service: string) =>
      `La copia a ${service} no es la que se revisó (o cambiaron los instrumentos, los nombres o las reglas). ${NO_WRITE_THIS_CALL} Revisa de nuevo con check_service_edits.`,
    done: (from: string, to: string) => `Copié los instrumentos de ${from} a ${to}.`,
    already: (service: string) => `${service} ya tenía esos instrumentos; no se escribió nada.`,
    unknown: "No pude confirmar si la copia se guardó. Repite exactamente la misma llamada: si ya quedó, contestará que ya estaba.",
    repeat: "No se copió: otra edición llegó al mismo tiempo. Repite la misma llamada.",
    recheck: (why: string) => `No se copió: ${why}. Revisa de nuevo con check_service_edits.`,
  },
  // Create a service (S3)
  create: {
    created: (service: string) =>
      `Creé ${service}, sin publicar y sin nadie asignado. Para llenarlo usa check_service_edits; para publicarlo, publish_service.`,
    already: (service: string) => `${service} ya estaba creado con estos mismos datos (esta misma llamada ya lo había creado); no se escribió nada.`,
    exists: (service: string) => `Ya existe ${service}. No se escribió nada.`,
    unknown: "No pude confirmar si el servicio se creó. Repite exactamente la misma llamada: si ya quedó, contestará que ya estaba.",
    refused: (why: string) => `No se creó el servicio: ${why}. No se escribió nada.`,
    badDate: "La fecha no es válida (YYYY-MM-DD).",
    badWeekday: (type: "sunday" | "saturday") => `Esa fecha no es ${type === "sunday" ? "domingo" : "sábado"}.`,
    needsName: "Un servicio especial necesita nombre.",
    badTime: "La hora debe ser HH:mm.",
    onlySpecial: "Solo un servicio especial lleva nombre, hora o formato de Noche de alabanza.",
    retired: "Este mismo servicio se creó y se borró varias veces desde el chat; créalo en /admin.",
  },
} as const;

/** C5's literal `PIN_CAP = 250` (gcf_v3/owt_v3/constants.py), mirrored once (RQ-6, `v3PinCapSync.test.ts`). */
export const V3_PIN_CAP = 250;

const NO_NAMES: V3Names = { person: (id) => id, rule: (id) => id, service: (id) => id };
