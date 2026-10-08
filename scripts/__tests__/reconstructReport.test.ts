// Solver v3 C4 R11–R13 — the private Spanish table and refusal report, and the
// name-free lines stdout may carry. Every name is fictitious.
import { describe, expect, it } from "vitest";

import type { FairnessMonthBody, LogicalRecord, RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import {
  ACTION_LABEL,
  anomalyText,
  refusalLine,
  renderRefusalReport,
  renderTable,
  replaceChanges,
  statusLabel,
  targetLine,
  type TableCell,
  type TableModel,
} from "../lib/reconstructReport";
import { ANOMALY_CODES, type Anomaly, type RunRefusal } from "../lib/reconstructTypes";

const REFUSAL: RunRefusal = {
  reason: "exact_count_range",
  kind: "regla fija",
  rules: [{ ordinal: "restricción 1 de 4, tope 1", key: "d-ana" }],
  month: "2026-08",
  person: "Ana Ejemplo",
  memberIds: ["m-ana"],
  detail: "Una cuenta fija no es un entero de 0 a 31.",
  fix: "Corrige el valor en el panel de reglas.",
};
const nameOf = (id: string) => ({ "m-ana": "Ana E.", "m-beto": "Beto E.", "m-ambar": "Ámbar Ejemplo" })[id] ?? "";
const cell = (patch: Partial<TableCell> = {}): TableCell => ({ status: "out", count: null, reason: "linea", corrected: false, ...patch });
const cells = (patch: Partial<Record<RoleKey, TableCell>> = {}) =>
  ({
    "Sun.Lead": cell(),
    "Sat.Lead": cell(),
    "Sun.BGV": cell(),
    "Sat.BGV": cell(),
    "Sun.Choir": cell(),
    "Sat.Choir": cell(),
    ...patch,
  }) as Record<RoleKey, TableCell>;
const row = (memberId: string, patch: Partial<TableModel["table"][number]["rows"][number]> = {}) => ({
  memberId,
  name: nameOf(memberId),
  cells: cells(),
  joins: {},
  seats: {},
  blocked: [],
  exempt: false,
  exemptCorrected: false,
  cadence: false,
  cadenceCorrected: false,
  blocksCorrected: false,
  added: false,
  ...patch,
});
const MODEL: TableModel = {
  generatedAt: "2026-10-20T18:00:00.000Z",
  projectId: "proj-test",
  dataset: "test",
  months: ["2026-08"],
  previewRun: "2026-09",
  overridesHash: "none",
  cadenceSettings: { config: 1, overrides: 0 },
  table: [
    {
      month: "2026-08",
      action: "create",
      services: [
        { date: "2026-08-02", type: "domingo", counted: true },
        { date: "2026-08-30", type: "especial", counted: false },
      ],
      rows: [
        row("m-beto", {
          cells: cells({ "Sun.BGV": cell({ status: "exact", count: 2, reason: "correccion", corrected: true }) }),
          joins: { BGV: "2026-07" },
          seats: { BGV: 1 },
        }),
        row("m-ambar", { cells: cells({ "Sun.Lead": cell({ status: "in", reason: "tipo" }) }), joins: { DL: "2026-08" }, blocked: ["2026-08-15"] }),
      ],
      presence: [{ ordinal: "presencia 1 de 1", ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["Beto E.", "Carla E."], exclusive: false }],
    },
  ],
  preview: {
    window: ["2026-06", "2026-07", "2026-08"],
    sources: [
      { month: "2026-06", from: "none" },
      { month: "2026-07", from: "stored" },
      { month: "2026-08", from: "planned" },
    ],
    rows: [
      { memberId: "m-beto", name: "Beto E.", tabs: { BGV: 8, TOTAL: 8 } },
      { memberId: "m-ambar", name: "Ámbar Ejemplo", tabs: {} },
    ],
  },
  anomalies: [{ anomaly: { code: "person_added", month: "2026-08", memberId: "m-beto" }, text: "2026-08 · Beto E. (`m-beto`): añadida por corrección." }],
  notes: [{ ordinal: 1, memberId: "m-beto", name: "Beto E.", note: "Cantó en septiembre." }],
  notApplicable: [{ ordinal: 2, memberId: "m-ana", month: "2026-10" }],
};

describe("words and labels (R11, «Decision per month»)", () => {
  it("renders statuses as the spec words them", () => {
    expect(statusLabel("in", null)).toBe("elegible");
    expect(statusLabel("out", null)).toBe("fuera");
    expect(statusLabel("exact", 2)).toBe("fija 2");
  });
  it("labels every planned action with the spec's words", () => {
    expect(ACTION_LABEL).toEqual({
      create: "crear",
      replace: "reemplazar",
      unchanged: "sin cambios",
      skip: "sin servicios guardados: no se reconstruye",
      not_reconstruction_owned: "no lo escribió la reconstrucción: no se toca",
      record_edited: "editado después de reconstruir: no se toca",
    });
  });
});

describe("stdout lines (R12, R13)", () => {
  it("prints the target first, with the mode", () => {
    expect(targetLine("dry-run", "proj-test", "test")).toBe("reconstruct-fairness-months · proj-test · test · DRY-RUN");
    expect(targetLine("rollback-apply", "proj-test", "test")).toBe("reconstruct-fairness-months · proj-test · test · ROLLBACK-APPLY");
  });
  it("prints a refusal by ordinal, reason, kind and month — never a name, key or id", () => {
    const line = refusalLine(REFUSAL, 1, 2, "/tmp/out/rechazo.md");
    expect(line).toBe("rechazo 1 de 2 · exact_count_range · regla fija · restricción 1 de 4, tope 1 · 2026-08 · informe: /tmp/out/rechazo.md");
    for (const secret of ["Ana", "d-ana", "m-ana"]) expect(line).not.toContain(secret);
  });
  it("prints C2's index-based issues as they come", () => {
    const line = refusalLine({ ...REFUSAL, reason: "invalid_body", kind: "corrección", rules: [], issues: [{ path: "people[1].sundayCadence", message: "cadence_and_exact" }] }, 1, 1, null);
    expect(line).toBe("rechazo 1 de 1 · invalid_body · corrección · 2026-08 · people[1].sundayCadence: cadence_and_exact · sin informe");
  });
});

describe("the private refusal report (R13)", () => {
  it("names the rule by ordinal AND key, and the member by name AND id", () => {
    const text = renderRefusalReport({ generatedAt: "2026-10-20T18:00:00.000Z", refusals: [REFUSAL], nameOf });
    expect(text).toContain("## Rechazo 1 de 1 — `exact_count_range`");
    expect(text).toContain("- Regla: restricción 1 de 4, tope 1 · clave `d-ana`");
    expect(text).toContain("- Nombre en la regla: «Ana Ejemplo»");
    expect(text).toContain("- Miembro: Ana E. · `m-ana`");
    expect(text).toContain("Nada se escribió en Sanity");
  });
});

describe("the private table (R11)", () => {
  const text = renderTable(MODEL);
  it("lists the month's services with their «cuenta» flag", () => {
    expect(text).toContain("## 2026-08 — crear");
    expect(text).toContain("| 2026-08-02 | domingo | sí |");
    expect(text).toContain("| 2026-08-30 | especial | no |");
  });
  it("shows status words, reasons, «corregido», join months, seats and blocked dates per person", () => {
    expect(text).toContain("fija 2 · corrección · corregido");
    expect(text).toContain("elegible · Tipo de hoy");
    expect(text).toContain("fuera · antes de su primer servicio en esta línea");
    expect(text).toContain("| — · — · 2026-07 · — | 0 · 0 · 1 · 0 |");
    expect(text).toContain("| 2026-08-15 |");
  });
  it("sorts people with Spanish collation, then by id", () => {
    expect(text.indexOf("Ámbar Ejemplo (`m-ambar`)")).toBeLessThan(text.indexOf("Beto E. (`m-beto`)"));
  });
  it("shows the presence rules as stored, with their key, and states the limitations", () => {
    expect(text).toContain("| presencia 1 de 1 | `d-beto-carla` | Sun.BGV | Beto E., Carla E. | no |");
    expect(text).toContain("Disponibilidad: lo guardado hoy, no lo que había entonces.");
    expect(text).toContain("no puede editar una regla de presencia ni quitar una exclusión por semana");
  });
  it("shows the preview with one decimal through C2's formatter, «al día» for nothing owed, and its sources", () => {
    expect(text).toContain("| Beto E. (`m-beto`) | al día | al día | le deben 0.8 | al día | le deben 0.8 |");
    expect(text).toContain("| Ámbar Ejemplo (`m-ambar`) | al día | al día | al día | al día | al día |");
    expect(text).toContain("2026-06: sin registro (no cuenta) · 2026-07: el registro guardado · 2026-08: el plan");
  });
  it("lists anomalies, notes and the entries that do not apply to this run", () => {
    expect(text).toContain("- 2026-08 · Beto E. (`m-beto`): añadida por corrección.");
    expect(text).toContain("- entrada 1 · Beto E. (`m-beto`): Cantó en septiembre.");
    expect(text).toContain("- entrada 2 · `m-ana` · 2026-10: no aplica a esta corrida");
  });
});

describe("a replace's per-person changes against the stored record («Decision per month», R21)", () => {
  const roles = (patch: Partial<Record<RoleKey, Status>> = {}): Record<RoleKey, Status> => ({
    "Sun.Lead": "out",
    "Sat.Lead": "out",
    "Sun.BGV": "out",
    "Sat.BGV": "out",
    "Sun.Choir": "out",
    "Sat.Choir": "out",
    ...patch,
  });
  const person = (memberId: string, patch: Partial<FairnessMonthBody["people"][number]> = {}): FairnessMonthBody["people"][number] => ({
    memberId,
    roles: roles(),
    exactRules: [],
    exempt: false,
    blocks: [],
    ...patch,
  });
  const existing: Pick<LogicalRecord, "people" | "presence"> = {
    people: [
      { ...person("m-ana", { roles: roles({ "Sun.Lead": "in" }), blocks: [{ date: "2026-07-12", unavailable: true, excludedRoles: [] }] }), name: "Ana E." },
      { ...person("m-greta"), name: "Greta E." },
    ],
    presence: [],
  };
  const planned: Pick<FairnessMonthBody, "people" | "presence"> = {
    people: [
      person("m-ana", { roles: roles({ "Sun.Lead": "in", "Sun.BGV": "exact" }), exactRules: [{ roles: ["Sun.BGV"], count: 2 }], exempt: true }),
      person("m-beto", { sundayCadence: "alternate" }),
    ],
    presence: [{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }],
  };

  it("lists every person added, removed or changed, then every presence rule, by name and id", () => {
    expect(replaceChanges(existing, planned, nameOf)).toEqual([
      { kind: "person", id: "m-ana", name: "Ana E.", change: "changed", details: ["Dom. BGV: fuera → fija 2", "Exenta: no → sí", "fecha bloqueada quitada: 2026-07-12"] },
      { kind: "person", id: "m-beto", name: "Beto E.", change: "added", details: [] },
      { kind: "person", id: "m-greta", name: "Greta E.", change: "removed", details: [] },
      { kind: "presence", id: "d-beto-carla", name: "", change: "added", details: ["Sun.BGV · Beto E., m-carla · no exclusiva"] },
    ]);
  });

  it("renders them under the month, and only for a month planned «reemplazar»", () => {
    const text = renderTable({ ...MODEL, table: [{ ...MODEL.table[0], action: "replace", changes: replaceChanges(existing, planned, nameOf) }] });
    expect(text).toContain("### Cambios frente al registro guardado");
    expect(text).toContain("| Ana E. (`m-ana`) | Dom. BGV: fuera → fija 2 · Exenta: no → sí · fecha bloqueada quitada: 2026-07-12 |");
    expect(text).toContain("| Beto E. (`m-beto`) | nueva en el registro |");
    expect(text).toContain("| Greta E. (`m-greta`) | sale del registro |");
    expect(text).toContain("| presencia `d-beto-carla` | nueva en el registro · Sun.BGV · Beto E., m-carla · no exclusiva |");
    expect(renderTable(MODEL)).not.toContain("Cambios frente al registro guardado");
  });
});

describe("anomaly sentences (R13)", () => {
  it("gives every anomaly type a sentence that names the member", () => {
    for (const code of ANOMALY_CODES) {
      const anomaly: Anomaly = { code, month: "2026-08", memberId: "m-ana", line: "BGV", roleKey: "Sun.BGV", date: "2026-08-02", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", roles: ["Sun.BGV"], count: 1, held: 0, months: ["2026-08"], firstServiceDate: "2026-08-01", type: "sunday_role", roleIds: ["sun-a", "sun-b"], dates: ["2026-08-02"] };
      const text = anomalyText(anomaly, nameOf);
      expect(text.length, code).toBeGreaterThan(20);
      if (code !== "duplicate_target" && code !== "presence_no_seat") expect(text, code).toContain("Ana E.");
    }
    expect(anomalyText({ code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 }, nameOf)).toContain("regla fija = 1, tuvo 0");
    expect(anomalyText({ code: "member_gone", month: "2026-08", memberId: "m-julia" }, nameOf)).toContain("miembro eliminado o fuera de alabanza");
  });
});
