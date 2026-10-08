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

/** «Dom Lead», «Sáb Lead», «BGV», «Coro»; a presence sub-line «BGV ({regla})». */
export function lineLabel(line: string, n: Pick<V3Names, "rule">): string {
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

/** C5's literal `PIN_CAP = 250` (gcf_v3/owt_v3/constants.py), mirrored once (RQ-6, `v3PinCapSync.test.ts`). */
export const V3_PIN_CAP = 250;

const NO_NAMES: V3Names = { person: (id) => id, rule: (id) => id, service: (id) => id };
