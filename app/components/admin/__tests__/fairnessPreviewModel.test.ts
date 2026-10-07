// Solver v3 C2 UI-3 … UI-6, §8 — the «Equidad · vista previa» view-model: Spanish
// labels, window chips, rows and out-group per tab, «Motivo», the X1 line, the month's
// on-screen counted Sundays and «Registrar»'s copy. Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { EligibilityResult } from "@/app/utils/fairnessEligibility";
import {
  FAIRNESS_PUT_REFUSALS,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type Figures,
  type LogicalRecord,
  type Note,
  type RoleKey,
  type Status,
} from "@/app/utils/fairnessVocabulary";
import {
  REFUSAL_COPY,
  REGISTRAR,
  cadenceLine,
  chipText,
  dayMonth,
  displayName,
  formatDates,
  monthLong,
  monthLongCapital,
  monthShort,
  motivo,
  onScreenCountedSundays,
  refusalMessage,
  resolverLines,
  tabRows,
  windowSpan,
} from "../fairnessPreviewModel";

const fig = (balanceTenths: number, seats = 0, balance = balanceTenths * 10): Figures => ({
  share: balance + seats * 100,
  received: seats * 100,
  balance,
  seats,
  tenths: { share: balanceTenths + seats * 10, balance: balanceTenths },
});

function person(memberId: string, name: string, patch: Partial<FairnessPerson> = {}): FairnessPerson {
  return {
    memberId,
    name,
    exists: true,
    window: {},
    cumulative: {},
    tabs: { window: {}, cumulative: {} },
    sang: 0,
    exempt: false,
    months: ["2026-08", "2026-09", "2026-10"].map((month) => ({ month, recorded: true, listed: true, lines: {}, held: {}, setAsides: [], notes: [] })),
    countedSundayLeads: [],
    firstRecordedIn: {},
    ...patch,
  };
}
const withNotes = (p: FairnessPerson, month: string, notes: Note[]) => ({
  ...p,
  months: p.months.map((m) => (m.month === month ? { ...m, notes } : m)),
});

function response(people: FairnessPerson[], patch: Partial<FairnessLedgerResponse> = {}): FairnessLedgerResponse {
  return {
    v: 1,
    engine: "v3",
    environment: "production",
    currentMonth: "2026-10",
    target: "2026-11",
    window: [
      { month: "2026-08", record: null },
      { month: "2026-09", record: { rev: "r9", source: "reconstructed", engine: "v2", environment: "local", recordedAt: "x" } },
      { month: "2026-10", record: { rev: "r10", source: "auto", engine: "v3", environment: "preview", recordedAt: "x" } },
    ],
    recordsSince: "2026-09",
    horizon: [{ month: "2026-11", record: null, storedServices: 0, recordBinds: false }],
    people,
    diagnostics: { duplicateTargets: [], notInRecordSeats: 0, unknownMembers: [] },
    ...patch,
  };
}

describe("labels (§8)", () => {
  it("names months and dates in Spanish", () => {
    expect([monthShort("2026-08"), monthLong("2026-11"), monthLongCapital("2026-11"), dayMonth("2026-10-25")]).toEqual([
      "ago",
      "noviembre",
      "Noviembre",
      "25 oct",
    ]);
    expect(formatDates(["2026-11-15", "2026-11-08"])).toBe("8 y 15 nov");
    expect(formatDates(["2026-10-04", "2026-09-30", "2026-10-11"])).toBe("30 sep, 4 y 11 oct");
    expect(formatDates(["2026-10-04", "2026-09-30"])).toBe("30 sep y 4 oct");
    expect(formatDates(["2026-11-01", "2026-11-08", "2026-11-15"])).toBe("1, 8 y 15 nov");
  });

  it("spans the window", () => {
    expect(windowSpan(response([]).window)).toBe("ago–oct 2026");
    expect(windowSpan([{ month: "2026-11", record: null }, { month: "2026-12", record: null }, { month: "2027-01", record: null }])).toBe(
      "nov 2026–ene 2027",
    );
  });

  it("writes the window chips, the environment suffix only on a registered month", () => {
    expect(response([]).window.map(chipText)).toEqual(["ago: sin registro, no cuenta", "sep: reconstruido", "oct: registrado · desde dev"]);
    expect(chipText({ month: "2026-10", record: { rev: "r", source: "manual", engine: "v3", environment: "local", recordedAt: "x" } })).toBe(
      "oct: registrado · local",
    );
    expect(chipText({ month: "2026-10", record: { rev: "r", source: "auto", engine: "v3", environment: "production", recordedAt: "x" } })).toBe(
      "oct: registrado",
    );
  });

  it("names a deleted member", () => {
    expect(displayName({ name: "Elena", exists: false })).toBe("Elena · ya no está en el equipo");
    expect(displayName({ name: "", exists: false })).toBe("Miembro eliminado");
  });
});

describe("«Motivo» (UI-5)", () => {
  const notes: Note[] = [
    { code: "exempt" },
    { code: "presence", line: "P:rule-ab", ruleKey: "rule-ab", members: ["m-alma", "m-bruno"] },
    { code: "role_out", line: "DL" },
    { code: "unavailable", dates: ["2026-10-04", "2026-10-11"] },
    { code: "outside_population", line: "BGV", dates: ["2026-10-04", "2026-10-18"] },
  ];
  const alma = withNotes(person("m-alma", "Alma"), "2026-10", notes);
  const nameOf = (id: string) => ({ "m-bruno": "Bruno" })[id] ?? id;

  it("keeps each tab's notes, in the closed set's order", () => {
    expect(motivo(alma, "DL", nameOf)).toBe("No estaba en la lista de Dom Lead en oct. No disponible 4 y 11 oct: esas fechas no le cuentan.");
    expect(motivo(alma, "BGV", nameOf)).toBe(
      "No disponible 4 y 11 oct: esas fechas no le cuentan. Regla de presencia con Bruno: ese lugar se reparte entre ellos. 2 lugares fuera de su lista no cuentan.",
    );
    expect(motivo(alma, "TOTAL", nameOf)).toContain("Exenta: no cuenta en Total.");
    expect(motivo(alma, "CORO", nameOf)).not.toContain("Exenta");
  });

  it("writes the same sentence once", () => {
    const twice = withNotes(withNotes(person("m-alma", "Alma"), "2026-09", [{ code: "cadence_set_aside", line: "DL", dates: ["2026-09-06"] }]), "2026-10", [
      { code: "cadence_set_aside", line: "DL", dates: ["2026-10-04"] },
    ]);
    expect(motivo(twice, "DL", nameOf)).toBe("Mes por medio: sus domingos no cuentan en Dom Lead.");
  });
});

describe("rows (UI-4)", () => {
  const people = [
    person("m-bruno", "Bruno", { tabs: { window: { BGV: fig(-3, 1) }, cumulative: { BGV: fig(5, 2) } }, sang: 2 }),
    person("m-ivan", "Iván", { tabs: { window: { BGV: fig(4) }, cumulative: {} } }),
    person("m-alma", "Alma", { tabs: { window: { BGV: fig(4), TOTAL: fig(4) }, cumulative: {} }, exempt: true }),
    person("m-carmen", "Carmen"),
  ];

  it("lists the tab's population, most owed first, ties by name in Spanish order", () => {
    const { rows, out } = tabRows(response(people), "BGV");
    expect(rows.map((r) => r.name)).toEqual(["Alma", "Iván", "Bruno"]);
    expect(rows[2]).toMatchObject({ leTocaba: "0.7", tuvo: 1, saldo: "0.3 de más", desde: "le deben 0.5", canto: 2 });
    expect(out.map((r) => r.name)).toEqual(["Carmen"]);
    expect(out[0]).toMatchObject({ leTocaba: "—", saldo: "—", desde: "—" });
  });

  it("breaks a tie by Spanish collation, not by codepoint", () => {
    // Codepoint order puts «S» (U+0053) before «Á» (U+00C1); Spanish order puts Á with A.
    const tied = [
      person("m-carmen-s", "Carmen Soto", { tabs: { window: { BGV: fig(2) }, cumulative: {} } }),
      person("m-carmen-a", "Carmen Ávila", { tabs: { window: { BGV: fig(2) }, cumulative: {} } }),
    ];
    expect(tabRows(response(tied), "BGV").rows.map((r) => r.name)).toEqual(["Carmen Ávila", "Carmen Soto"]);
  });

  it("leaves an exempt person out of Total", () => {
    expect(tabRows(response(people), "TOTAL").rows.map((r) => r.name)).toEqual([]);
    expect(tabRows(response(people), "TOTAL").out.map((r) => r.name)).toContain("Alma");
  });
});

describe("the month's on-screen counted Sundays (UI-5)", () => {
  it("counts stored counted Sunday services and one default per Sunday with no stored sunday_role", () => {
    // October 2026 Sundays: 4, 11, 18, 25.
    expect(
      onScreenCountedSundays("2026-10", [
        { _type: "sunday_role", date: "2026-10-04" },
        { _type: "sunday_role", date: "2026-10-11", countsForFairness: false },
        { _type: "special_role", date: "2026-10-18", countsForFairness: true },
        { _type: "special_role", date: "2026-10-18" },
        { _type: "special_role", date: "2026-10-23", countsForFairness: true },
        { _type: "sunday_role", date: "2026-11-01" },
      ]),
    ).toEqual([
      { date: "2026-10-04", weekend: true },
      { date: "2026-10-18", weekend: true }, // the default weekend service (no stored sunday_role)
      { date: "2026-10-18", weekend: false }, // the counted special
      { date: "2026-10-25", weekend: true },
    ]);
  });
});

describe("the X1 line (UI-5, CAD-2)", () => {
  const OUT: Record<RoleKey, Status> = {
    "Sun.Lead": "out", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out",
  };
  const item = (patch: object = {}) => ({
    memberId: "m-diego",
    roles: { ...OUT, "Sun.Lead": "in" as Status },
    exactRules: [],
    sundayCadence: "alternate" as const,
    exempt: false,
    blocks: [] as Array<{ date: string; unavailable: boolean; excludedRoles: RoleKey[] }>,
    ...patch,
  });
  const resolved = (patch: object = {}): EligibilityResult => ({ ok: true, body: { month: "2026-11", people: [item(patch)], presence: [] } });
  const diego = person("m-diego", "Diego");
  const SUNDAYS = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].map((date) => ({ date, weekend: true }));
  const line = (patch: Partial<Parameters<typeof cadenceLine>[0]> = {}) =>
    cadenceLine({ person: diego, response: response([diego]), month: "2026-11", resolved: resolved(), countedSundays: SUNDAYS, liveUnavailable: [], ...patch });

  it("is «previsto» on", () => expect(line()).toBe("En nov le toca domingo (previsto)."));

  it("rests after a Sunday led in the previous month, naming it", () => {
    expect(line({ person: { ...diego, countedSundayLeads: ["2026-09-06", "2026-10-25"] } })).toBe("En nov no dirige domingo: ya dirigió el 25 oct.");
  });

  it("rests when not on the Dom Lead list (from the resolver, never the raw tick)", () => {
    expect(line({ resolved: resolved({ roles: OUT }) })).toBe("En nov no dirige domingo: no está en la lista de Dom Lead.");
  });

  it("rests with no available Sunday, a rule-excluded Sunday counting as unavailable (A14)", () => {
    const blocks = SUNDAYS.map(({ date }, i) => ({ date, unavailable: i < 4, excludedRoles: i === 4 ? (["Sun.Lead"] as RoleKey[]) : [] }));
    expect(line({ resolved: resolved({ blocks }) })).toBe("En nov no dirige domingo: ningún domingo disponible.");
    expect(line({ liveUnavailable: SUNDAYS.map((s) => s.date) })).toBe("En nov no dirige domingo: ningún domingo disponible.");
  });

  it("never lets a rule exclusion block a counted special (LG-6, CAD-2): a special on the same Sunday keeps it available", () => {
    // One Sunday: a stored sunday_role plus a counted Sunday special; Diego is rule-excluded for Sun.Lead that week.
    const counted = onScreenCountedSundays("2026-11", [
      ...["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"].map((date) => ({ _type: "sunday_role", date, countsForFairness: false })),
      { _type: "sunday_role", date: "2026-11-01" },
      { _type: "special_role", date: "2026-11-01", countsForFairness: true },
    ]);
    expect(counted).toEqual([{ date: "2026-11-01", weekend: true }, { date: "2026-11-01", weekend: false }]);
    const blocks = [{ date: "2026-11-01", unavailable: false, excludedRoles: ["Sun.Lead"] as RoleKey[] }];
    // The weekend service is excluded; the special is not — the spec counts one available Sunday.
    expect(line({ countedSundays: counted, resolved: resolved({ blocks }) })).toBe("En nov le toca domingo (previsto).");
    // With only the weekend service the rule exclusion still takes the Sunday away.
    expect(line({ countedSundays: [counted[0]], resolved: resolved({ blocks }) })).toBe("En nov no dirige domingo: ningún domingo disponible.");
    // And an unavailability still blocks the special too.
    expect(
      line({ countedSundays: counted, resolved: resolved({ blocks: [{ ...blocks[0], unavailable: true }] }) }),
    ).toBe("En nov no dirige domingo: ningún domingo disponible.");
  });

  it("reads the record when it binds the month (A6), and says nothing when the resolver refuses", () => {
    const record: LogicalRecord = {
      month: "2026-11", rev: "r", contentHash: "h", source: "auto", engine: "v3", environment: "production", recordedAt: "x",
      people: [{ ...item({ roles: OUT }), name: "Diego" }],
      presence: [],
    };
    const bound = response([diego], { horizon: [{ month: "2026-11", record, storedServices: 4, recordBinds: true }] });
    expect(line({ response: bound })).toBe("En nov no dirige domingo: no está en la lista de Dom Lead.");
    expect(line({ resolved: { ok: false, issues: [{ code: "no_people" }], refusals: [] } })).toBeNull();
    expect(line({ resolved: resolved({ sundayCadence: undefined }) })).toBeNull();
  });
});

describe("«Registrar» copy (UI-6, §8)", () => {
  it("names the month in the button and the replace date in CDMX", () => {
    expect(REGISTRAR.button("2026-11")).toBe("Registrar elegibilidad de noviembre");
    expect(REGISTRAR.replace("2026-10-04T03:00:00.000Z")).toBe("Reemplaza el registro guardado el 3 oct.");
    expect(REGISTRAR.devEnvironment("preview")).toContain("Estás en dev");
  });

  it("maps every PUT refusal, and anything else to the fallback", () => {
    for (const code of FAIRNESS_PUT_REFUSALS) {
      expect(refusalMessage("2026-11", { details: { detail: code } })).toBe(REFUSAL_COPY[code]("2026-11"));
    }
    expect(refusalMessage("2026-11", { details: { detail: "past_month" } })).toBe(
      "Noviembre ya pasó: los meses pasados solo se registran con la reconstrucción.",
    );
    expect(refusalMessage("2026-11", { error: "invalid_request" })).toBe("No se pudo registrar. No se guardó nada; vuelve a intentar.");
    expect(refusalMessage("2026-11", null)).toBe("No se pudo registrar. No se guardó nada; vuelve a intentar.");
  });

  it("writes one line per resolver refusal kind and per issue kind", () => {
    expect(
      resolverLines("2026-11", {
        ok: false,
        issues: [{ code: "presence_roles", ruleKey: "p-1" }, { code: "presence_members", ruleKey: "p-1" }],
        refusals: [
          { person: "Alma", reason: "ambiguous" },
          { person: "Nadie", reason: "unresolved" },
          { person: "Diego", reason: "cadence_and_exact" },
          { person: "Bruno", reason: "exact_count_range" },
        ],
      }),
    ).toEqual([
      "Hay reglas con nombres que no corresponden a una sola persona: Alma, Nadie. Corrígelas antes de registrar.",
      "Diego tiene «Mes por medio» y una regla fija de Dom Lead; quita una de las dos antes de registrar.",
      "La regla fija de Bruno no da un número entero de 0 a 31 lugares en noviembre; corrígela antes de registrar.",
      "Una regla de presencia no se puede registrar (necesita de 2 a 12 personas de voz y al menos un rol; máximo 20 reglas). Revísala antes de registrar.",
    ]);
  });
});
