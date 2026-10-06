// app/components/admin/fairnessPreviewModel.ts
//
// The «Equidad · vista previa» panel's pure view-model (solver v3 C2 UI-3 … UI-6, §8):
// month and date labels, the window chips, the five tabs' rows and out-group, the
// «Motivo» line per person, the X1 line for a «Mes por medio» person on the Dom Lead tab,
// the month's on-screen counted Sundays, and every Spanish string the panel and
// «Registrar» show. NEUTRAL (ADR-0028): no React, no I/O, so every rule is unit-tested
// without a DOM. Figures are formatted ONLY through `fairnessFormat.ts` from the GET's
// tenths — never from hundredths (A17).

import { countsForFairness } from "@/app/utils/countsForFairness";
import { cadenceStates } from "@/app/utils/fairnessLedger";
import { formatFairnessTenths, saldoWords } from "@/app/utils/fairnessFormat";
import type { EligibilityResult } from "@/app/utils/fairnessEligibility";
import {
  FAIRNESS_PUT_REFUSALS,
  NOTE_CODES,
  shiftMonth,
  tabOfLine,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type FairnessPutRefusal,
  type Figures,
  type LineKey,
  type Note,
  type RoleKey,
  type TabKey,
} from "@/app/utils/fairnessVocabulary";
import { completeSundaySpine } from "./serviceRuleContext";

// ─── Months and dates, in Spanish (no `Date`, no `Intl`: fixed and testable) ──

const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11" → "nov". */
export const monthShort = (month: string) => SHORT[Number(month.slice(5, 7)) - 1] ?? month;
/** "2026-11" → "noviembre". */
export const monthLong = (month: string) => LONG[Number(month.slice(5, 7)) - 1] ?? month;
/** "2026-11" → "Noviembre". */
export const monthLongCapital = (month: string) => {
  const long = monthLong(month);
  return long.charAt(0).toUpperCase() + long.slice(1);
};
/** "2026-08" → "ago 2026". */
export const monthYear = (month: string) => `${monthShort(month)} ${month.slice(0, 4)}`;

/** "2026-11-08" → "8 nov". */
export const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${monthShort(date.slice(0, 7))}`;

/** ["2026-11-08", "2026-11-15"] → "8 y 15 nov"; across months → "30 sep y 4 oct". */
export function formatDates(dates: readonly string[]): string {
  const groups: Array<{ month: string; days: number[] }> = [];
  for (const date of [...dates].sort()) {
    const month = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.days.push(Number(date.slice(8, 10)));
    else groups.push({ month, days: [Number(date.slice(8, 10))] });
  }
  const parts = groups.map((g) => `${joinY(g.days.map(String))} ${monthShort(g.month)}`);
  // "y" joins the last two items once: «30 sep y 4 oct», but «30 sep, 4 y 11 oct».
  return groups.every((g) => g.days.length === 1) ? joinY(parts) : parts.join(", ");
}

function joinY(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** The window's span: "ago–oct 2026", or "nov 2026–ene 2027" across a year. */
export function windowSpan(window: FairnessLedgerResponse["window"]): string {
  const first = window[0]?.month;
  const last = window[window.length - 1]?.month;
  if (!first || !last) return "";
  return first.slice(0, 4) === last.slice(0, 4) ? `${monthShort(first)}–${monthYear(last)}` : `${monthYear(first)}–${monthYear(last)}`;
}

// ─── Copy (§8) ───────────────────────────────────────────────────────────────

export const COPY = {
  disclosure: "Equidad · vista previa",
  banner: "Vista previa: Auto todavía no usa este saldo",
  subheader: (span: string) => `Saldo de ${span} (3 meses). "Le deben" = le tocaba más de lo que tuvo.`,
  loading: "Cargando el saldo de equidad…",
  error: "No se pudo leer el saldo de equidad.",
  retry: "Reintentar",
  empty: "Todavía no hay meses registrados: el saldo empieza con el primer registro.",
  outGroup: (n: number) => `Fuera de esta línea (${n})`,
  deleted: "Miembro eliminado",
  footer:
    "Le tocaba = su parte de los lugares de cada servicio que cuenta para equidad, repartida entre quienes estaban en la lista y disponibles ese día. Los lugares fijos (reglas fijas, mes por medio, mínimo de voz) no se reparten. Lo que a unos se les debe, otros lo tienen de más: la suma siempre da cero.",
  totalFooter: "Total = Dom Lead + Sáb Lead + BGV + Coro. Cantó = todos sus lugares de voz, incluidos los fijos. Instrumentos y FOH no cuentan.",
  columns: { persona: "Persona", leTocaba: "Le tocaba", tuvo: "Tuvo", saldo: "Saldo (3 meses)", desde: (since: string) => `Desde ${since}`, motivo: "Motivo", canto: "Cantó" },
} as const;

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "DL", label: "Dom Lead" },
  { key: "SL", label: "Sáb Lead" },
  { key: "BGV", label: "BGV" },
  { key: "CORO", label: "Coro" },
  { key: "TOTAL", label: "Total" },
];

const TAB_LABEL: Record<Exclude<TabKey, "TOTAL">, string> = { DL: "Dom Lead", SL: "Sáb Lead", BGV: "BGV", CORO: "Coro" };

export const ROLE_LABEL: Readonly<Record<RoleKey, string>> = {
  "Sun.Lead": "Dom Lead",
  "Sat.Lead": "Sáb Lead",
  "Sun.BGV": "Dom BGV",
  "Sat.BGV": "Sáb BGV",
  "Sun.Choir": "Dom Coro",
  "Sat.Choir": "Sáb Coro",
};

/** A window chip (§8): «{ago}: registrado» · «{sep}: reconstruido» · «{oct}: sin registro, no cuenta». */
export function chipText(entry: FairnessLedgerResponse["window"][number]): string {
  const month = monthShort(entry.month);
  if (!entry.record) return `${month}: sin registro, no cuenta`;
  if (entry.record.source === "reconstructed") return `${month}: reconstruido`;
  const suffix = entry.record.environment === "preview" ? " · desde dev" : entry.record.environment === "local" ? " · local" : "";
  return `${month}: registrado${suffix}`;
}

/** The display name: a deleted member reads «{nombre} · ya no está en el equipo», or «Miembro eliminado». */
export function displayName(person: Pick<FairnessPerson, "name" | "exists">): string {
  if (person.exists) return person.name;
  return person.name ? `${person.name} · ya no está en el equipo` : COPY.deleted;
}

// ─── Notes → «Motivo» (UI-5) ─────────────────────────────────────────────────

function lineLabel(line: LineKey | undefined): string {
  if (!line) return "";
  return TAB_LABEL[tabOfLine(line)];
}

function noteSentence(note: Note, month: string, nameOf: (id: string) => string, self: string): string {
  const mes = monthShort(month);
  switch (note.code) {
    case "unrecorded_month":
      return `${mes}: sin registro, no cuenta.`;
    case "not_listed":
      return `No aparece en el registro de ${mes}.`;
    case "role_out":
      return `No estaba en la lista de ${lineLabel(note.line)} en ${mes}.`;
    case "unavailable":
      return `No disponible ${formatDates(note.dates)}: esas fechas no le cuentan.`;
    case "rule_excluded":
      return `Excluido por regla el ${formatDates(note.dates)}.`;
    case "exact":
      return `Regla fija: ${note.roles.map((k) => ROLE_LABEL[k]).join(" + ")} = ${note.count} por mes; esos lugares no se reparten.`;
    case "exact_clamped":
      return `Regla fija de ${note.count}, pero solo estuvo disponible ${note.available} ${note.available === 1 ? "vez" : "veces"} en ${mes}.`;
    case "cadence_set_aside":
      return "Mes por medio: sus domingos no cuentan en Dom Lead.";
    case "cadence_no_sunday_saturday":
      return `En ${mes} no dirigió domingo; su sábado cuenta en Sáb Lead.`;
    case "floor_seat":
      return `Un lugar de ${mes} fue por el mínimo de voz y no cuenta.`;
    case "presence": {
      const others = note.members.filter((id) => id !== self).map(nameOf);
      return `Regla de presencia con ${joinY(others)}: ese lugar se reparte entre ellos.`;
    }
    case "outside_population":
      return note.dates.length === 1
        ? "1 lugar fuera de su lista no cuenta."
        : `${note.dates.length} lugares fuera de su lista no cuentan.`;
    case "second_seat":
      return `Estaba dos veces en el servicio del ${formatDates(note.dates)}: solo cuenta su primer lugar.`;
    case "exempt":
      return "Exenta: no cuenta en Total.";
  }
}

/** The lines a tab shows (LG-14): BGV folds every presence sub-line; Total is every line. */
export function tabIncludesLine(tab: TabKey, line: LineKey): boolean {
  return tab === "TOTAL" || tabOfLine(line) === tab;
}

/** One «Motivo» line: the person's window notes for this tab, in the closed set's order, each once. */
export function motivo(person: FairnessPerson, tab: TabKey, nameOf: (id: string) => string): string {
  const items: Array<{ order: number; month: string; text: string }> = [];
  for (const m of person.months) {
    for (const note of m.notes) {
      if (note.line && !tabIncludesLine(tab, note.line)) continue;
      if (note.code === "exempt" && tab !== "TOTAL") continue;
      items.push({ order: NOTE_CODES.indexOf(note.code), month: m.month, text: noteSentence(note, m.month, nameOf, person.memberId) });
    }
  }
  items.sort((a, b) => a.order - b.order || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return [...new Set(items.map((i) => i.text))].join(" ");
}

// ─── Rows (UI-4) ─────────────────────────────────────────────────────────────

export interface PreviewRow {
  memberId: string;
  name: string;
  leTocaba: string;
  tuvo: number;
  saldo: string;
  desde: string;
  motivo: string;
  canto: number;
  balance: number;
}

/** The tab's rows (people in its population at least once in the window), most owed first, and the rest. */
export function tabRows(
  response: FairnessLedgerResponse,
  tab: TabKey,
  extraMotivo: (person: FairnessPerson) => string = () => "",
): { rows: PreviewRow[]; out: PreviewRow[] } {
  const names = new Map(response.people.map((p) => [p.memberId, displayName(p)]));
  const nameOf = (id: string) => names.get(id) ?? COPY.deleted;
  const row = (p: FairnessPerson, figures: Figures | undefined): PreviewRow => {
    const cumulative = p.tabs.cumulative[tab];
    const why = [motivo(p, tab, nameOf), extraMotivo(p)].filter(Boolean).join(" ");
    return {
      memberId: p.memberId,
      name: displayName(p),
      leTocaba: figures ? formatFairnessTenths(figures.tenths.share) : "—",
      tuvo: figures ? figures.seats : 0,
      saldo: figures ? saldoWords(figures.tenths.balance) : "—",
      desde: cumulative ? saldoWords(cumulative.tenths.balance) : "—",
      motivo: why,
      canto: p.sang,
      balance: figures ? figures.balance : 0,
    };
  };
  const inTab = (p: FairnessPerson) => p.tabs.window[tab] !== undefined && !(tab === "TOTAL" && p.exempt);
  const rows = response.people
    .filter(inTab)
    .map((p) => row(p, p.tabs.window[tab]))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "es"));
  const out = response.people
    .filter((p) => !inTab(p))
    .map((p) => row(p, undefined))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { rows, out };
}

// ─── The X1 line for a «Mes por medio» person (UI-5, CAD-2) ──────────────────

/**
 * The month's counted Sunday services from the on-screen state (display only, «previsto»):
 * every stored counted Sunday-dated service, plus one weekend default for each Sunday of
 * the month with no stored `sunday_role`. One entry per service; a date may repeat. Each
 * entry carries whether it is a WEEKEND service (a stored `sunday_role` or the default) or
 * a special: a rule exclusion applies to weekend services only (C2 LG-6, C3 CAD-2), so the
 * X1 line must be able to tell them apart.
 */
export type OnScreenCountedSunday = { date: string; weekend: boolean };

export function onScreenCountedSundays(
  month: string,
  stored: ReadonlyArray<{ _type: string; date: string; countsForFairness?: boolean }>,
): OnScreenCountedSunday[] {
  const sundays = completeSundaySpine(month);
  const out: OnScreenCountedSunday[] = [];
  const withSundayRole = new Set<string>();
  for (const s of stored) {
    const date = s.date.slice(0, 10);
    if (!sundays.includes(date)) continue;
    if (s._type === "sunday_role") withSundayRole.add(date);
    if ((s._type === "sunday_role" || s._type === "special_role") && countsForFairness({ _type: s._type, countsForFairness: s.countsForFairness })) {
      out.push({ date, weekend: s._type === "sunday_role" });
    }
  }
  for (const sunday of sundays) if (!withSundayRole.has(sunday)) out.push({ date: sunday, weekend: true });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(b.weekend) - Number(a.weekend)));
}

/**
 * «En {nov} …» for a «Mes por medio» person, or `null` when she has none this month or
 * the month's eligibility cannot be told: the record when it binds (A6), else the
 * resolver's output over the on-screen state — never the raw pool tick. A resolver
 * `ok: false` omits the line (CAD-2; «Registrar» and C6 refuse that state anyway).
 */
export function cadenceLine(input: {
  person: FairnessPerson;
  response: FairnessLedgerResponse;
  month: string;
  resolved: EligibilityResult | null;
  countedSundays: readonly OnScreenCountedSunday[];
  liveUnavailable: readonly string[];
}): string | null {
  const horizon = input.response.horizon.find((h) => h.month === input.month);
  const source = horizon?.recordBinds && horizon.record ? horizon.record.people : input.resolved?.ok ? input.resolved.body.people : null;
  if (!source) return null;
  const item = source.find((p) => p.memberId === input.person.memberId);
  if (!item || item.sundayCadence !== "alternate") return null;
  const previous = shiftMonth(input.month, -1);
  const led = input.person.countedSundayLeads.filter((d) => d.slice(0, 7) === previous);
  // LG-6: unavailability blocks any counted service; a rule exclusion blocks weekend services only
  // (never a special — parent A13), so a Sunday with a counted special stays available to her.
  const blocked = ({ date, weekend }: OnScreenCountedSunday) =>
    input.liveUnavailable.includes(date) ||
    item.blocks.some((b) => b.date === date && (b.unavailable || (weekend && b.excludedRoles.includes("Sun.Lead"))));
  const [state] = cadenceStates({
    ledCountedSundayPreviousMonth: led.length > 0,
    months: [
      {
        month: input.month,
        eligible: item.roles["Sun.Lead"] === "in",
        availableCountedSundays: input.countedSundays.filter((d) => !blocked(d)).length,
      },
    ],
  });
  const mes = monthShort(input.month);
  switch (state.reason) {
    case "on":
      return `En ${mes} le toca domingo (previsto).`;
    case "led_previous_month":
      return `En ${mes} descansa: dirigió domingo el ${dayMonth(led[led.length - 1])}.`;
    case "not_eligible":
      return `En ${mes} descansa: no está en la lista de Dom Lead.`;
    default:
      return `En ${mes} descansa: ningún domingo disponible.`;
  }
}

// ─── «Registrar» (UI-6, §8) ──────────────────────────────────────────────────

export const REGISTRAR = {
  button: (month: string) => `Registrar elegibilidad de ${monthLong(month)}`,
  body: (month: string) =>
    `Se guarda quién está en cada lista de ${monthLong(month)}, sus reglas y sus fechas no disponibles, tal como están en pantalla. El saldo de los próximos meses se calcula con este registro.`,
  unsaved: "Las reglas tienen cambios sin guardar; se registran tal como están en pantalla.",
  replace: (recordedAt: string) => `Reemplaza el registro guardado el ${recordedAtLabel(recordedAt)}.`,
  frozenCreate: (month: string) =>
    `${monthLongCapital(month)} ya tiene servicios guardados: este será su registro. Mientras tenga servicios no se podrá reemplazar, y la reconstrucción no lo cambiará.`,
  devEnvironment: (environment: "preview" | "local") =>
    `Estás en ${environment === "preview" ? "dev" : "local"}: este registro se guarda en los datos reales del equipo y no se puede borrar desde la app.`,
  confirm: "Registrar",
  cancel: "Cancelar",
  success: "Registrado ✓",
  monthHasServices: (month: string) => `${monthLongCapital(month)} ya tiene servicios guardados: su registro ya no se puede reemplazar.`,
  failed: "No se pudo registrar. No se guardó nada; vuelve a intentar.",
} as const;

/** A record's `recordedAt` (an instant) as the CDMX day it was saved: «3 oct». */
function recordedAtLabel(iso: string): string {
  const day = new Date(iso).toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? dayMonth(day) : iso;
}

/** One line per PUT refusal (IF2-6); keyed on the union, so a new code fails `tsc`. */
export const REFUSAL_COPY: Readonly<Record<FairnessPutRefusal, (month: string) => string>> = {
  record_exists: (m) => `Otro administrador registró ${monthLong(m)} mientras tanto. Recarga para ver su registro.`,
  record_missing: (m) => `El registro de ${monthLong(m)} cambió mientras tanto. Recarga y vuelve a intentar.`,
  stale_revision: (m) => `El registro de ${monthLong(m)} cambió mientras tanto. Recarga y vuelve a intentar.`,
  month_has_services: (m) => REGISTRAR.monthHasServices(m),
  past_month: (m) => `${monthLongCapital(m)} ya pasó: los meses pasados solo se registran con la reconstrucción.`,
  engine_not_v3: () => "Registrar aplica con el nuevo solver. Recarga la página.",
  member_unknown: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
  member_not_worship: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
  tipo_mismatch: () => "Cambió el equipo mientras tanto (un miembro o su Tipo). Recarga y vuelve a intentar.",
};

/** The message for a PUT answer that is not a 200: by `details.detail`, else the fallback. */
export function refusalMessage(month: string, body: unknown): string {
  const detail = (body as { details?: { detail?: unknown } } | null)?.details?.detail;
  return typeof detail === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(detail)
    ? REFUSAL_COPY[detail as FairnessPutRefusal](month)
    : REGISTRAR.failed;
}

/** The resolver's refusals and issues as the dialog's lines (§8). */
export function resolverLines(month: string, result: Extract<EligibilityResult, { ok: false }>): string[] {
  const lines: string[] = [];
  const names = (reasons: string[]) => result.refusals.filter((r) => reasons.includes(r.reason)).map((r) => r.person);
  const unresolved = names(["unresolved", "ambiguous"]);
  if (unresolved.length) lines.push(`Hay reglas con nombres que no corresponden a una sola persona: ${unresolved.join(", ")}. Corrígelas antes de registrar.`);
  for (const person of names(["cadence_and_exact"])) {
    lines.push(`${person} tiene «Mes por medio» y una regla fija de Dom Lead; quita una de las dos antes de registrar.`);
  }
  for (const person of names(["overlapping_exact"])) {
    lines.push(`${person} tiene dos reglas fijas que cubren el mismo rol; deja solo una antes de registrar.`);
  }
  for (const person of names(["exact_count_range"])) {
    lines.push(`La regla fija de ${person} no da un número entero de 0 a 31 lugares en ${monthLong(month)}; corrígela antes de registrar.`);
  }
  for (const person of names(["no_tipo"])) lines.push(`${person} está en las reglas pero no tiene Tipo; asígnale uno o corrige la regla.`);
  for (const person of names(["presence_member_not_listed"])) {
    lines.push(`${person} está en una regla de presencia pero no canta (su Tipo no incluye voz); corrige la regla o su Tipo.`);
  }
  const codes = new Set(result.issues.map((i) => i.code));
  if (["presence_members", "presence_roles", "presence_rule_id", "too_many_presence"].some((c) => codes.has(c as never))) {
    lines.push("Una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala antes de registrar.");
  }
  if (codes.has("no_people")) lines.push("No hay nadie con Tipo de voz en el equipo: no hay nada que registrar.");
  if (codes.has("too_many_people")) lines.push("Hay más de 100 personas de voz: el registro no las admite.");
  return lines;
}
