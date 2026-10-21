// Admin parity phase 1, S1 — the three reads: `get_fairness_ledger`, `get_solver_rules`,
// `get_integrity_queue`. Each answers what its `/admin` panel shows, in Spanish, with names and never
// a member id, a rule key or a rules revision (KH-1); a failed read is the fixed tool error.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { NAME_SHAPED, NAME_SHAPED_KEYS, figures, ledgerPerson, ledgerResponse, record } from "@/app/components/admin/__tests__/v3Fixtures";
import type { MemberOption, ServiceRole } from "@/app/components/admin/serviceCardModel";
import type { IntegrityQueue } from "@/app/components/admin/serviceIntegrityQueue";
import { READ_TOOL_FAILURE_MESSAGE } from "../../reads/errors";
import { getFairnessLedgerResult } from "../getFairnessLedger";
import { getSolverRulesResult, presentSolverRules } from "../getSolverRules";
import { presentIntegrityQueue } from "../getIntegrityQueue";

const text = (out: CallToolResult) => (out.content as Array<{ text: string }>)[0]!.text;
const MEMBER_IDS = ["m-ana", "m-bruno", "m-carla", "m-dani"];

const member = (id: string, name: string, alias?: string): MemberOption => ({ _id: id, member_name: name, ...(alias ? { alias } : {}) });
const MEMBERS = [member("m-ana", "Ana López", "Ana"), member("m-bruno", "Bruno Díaz"), member("m-carla", "Carla"), member("m-dani", "Dani")];

describe("get_fairness_ledger", () => {
  const data = () => {
    const base = ledgerResponse(["2026-12"], {
      people: [
        ledgerPerson("m-ana", "Ana", {
          window: { DL: figures(150, 1, { share: 25, balance: 15 }) },
          cumulative: { DL: figures(150, 1, { share: 25, balance: 15 }) },
          tabs: { window: { DL: figures(150, 1, { share: 25, balance: 15 }) }, cumulative: { DL: figures(150, 1, { share: 25, balance: 15 }) } },
        }),
        ledgerPerson("m-bruno", "Bruno", {
          window: { DL: figures(-150, 3, { share: 15, balance: -15 }) },
          tabs: { window: { DL: figures(-150, 3, { share: 15, balance: -15 }) }, cumulative: { DL: figures(-150, 3, { share: 15, balance: -15 }) } },
        }),
      ],
    });
    return {
      ...base,
      window: [
        { month: "2026-10", record: null },
        { month: "2026-11", record: { rev: "rec-rev-11", source: "auto" as const, engine: "v3" as const, environment: "production" as const, recordedAt: "2026-10-20T17:04:00Z" } },
        { month: "2026-12", record: null },
      ],
      balanceStart: "2026-11",
      horizon: [{ month: "2026-12", record: record("2026-12", []), storedServices: 8, recordBinds: true }],
    };
  };

  it("answers the panel's rows per tab, by name, with no member id or record revision", async () => {
    const out = await getFairnessLedgerResult({ month: "2026-12" }, { load: async () => data() });
    expect(out.isError).toBeFalsy();
    const payload = out.structuredContent as { month: string; tabs: Array<{ tab: string; people: Array<{ name: string; saldo: string }> }>; ventana: string[] };
    expect(payload.month).toBe("2026-12");
    expect(payload.tabs.map((t) => t.tab)).toEqual(["Dom Lead", "Sáb Lead", "BGV", "Coro", "Total"]);
    const dl = payload.tabs[0]!.people;
    expect(dl.map((p) => p.name).sort()).toEqual(["Ana", "Bruno"]);
    expect(payload.ventana).toHaveLength(3);
    for (const surface of [text(out), JSON.stringify(out.structuredContent)]) {
      for (const id of MEMBER_IDS) expect(surface).not.toContain(id);
      expect(surface).not.toContain("rec-rev-11");
      expect(surface).not.toContain("rev-2026-12");
    }
  });

  it("a failed read (no read token, a rejected query) is the fixed tool error, never an empty ledger", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await getFairnessLedgerResult({ month: "2026-12" }, { load: async () => { throw new Error("token=secret dataset=prod"); } });
    expect(out.isError).toBe(true);
    expect(text(out)).toBe(READ_TOOL_FAILURE_MESSAGE);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret");
    errors.mockRestore();
  });
});

describe("get_solver_rules", () => {
  it("shows pools by name and every rule as a line, with no rule key, member id or revision", async () => {
    const out = await getSolverRulesResult({}, { rules: async () => ({ config: NAME_SHAPED, rev: "rules-rev-1" } as never), members: async () => MEMBERS });
    expect(out.isError).toBeFalsy();
    const payload = out.structuredContent as ReturnType<typeof presentSolverRules>;
    expect(payload.listas).toEqual([
      { lista: "Líder Domingo", nombres: ["Ana", "Bruno Díaz"] },
      { lista: "Líder Sábado", nombres: ["Carla"] },
      { lista: "Soporte", nombres: ["Dani"] },
    ]);
    expect(payload.personas).toEqual(["Ana: Sun.Lead <= 2", "Bruno: Sun.BGV <= 3 · Sat.BGV >= 0 · Sun.Lead <= 1"]);
    expect(payload.noJuntos).toEqual(["Ana ≠ Bruno en *.*"]);
    expect(payload.presencia).toEqual(["al menos uno de Carla, Dani en Sun.BGV cada semana"]);
    for (const surface of [text(out), JSON.stringify(out.structuredContent)]) {
      for (const key of [...NAME_SHAPED_KEYS, ...MEMBER_IDS, "rules-rev-1"]) expect(surface, key).not.toContain(key);
    }
  });

  it("words every clause kind the rules card shows", () => {
    const config = {
      ...NAME_SHAPED,
      restrictions: [
        {
          id: "x", person: "Eva", excludedPatterns: ["Sat.Lead"], fairness: "slack" as const, fairnessSlack: 2,
          weekExclusions: [{ id: "w", week: 3, pattern: "Sun.*" }],
          caps: [{ id: "c", pattern: "Sat.BGV", op: ">=" as const, value: 0, relative: true, relOffset: 2 }],
          sundayCadence: "alternate" as const,
        },
        { id: "y", person: "Fer", excludedPatterns: [], fairness: "exempt" as const, fairnessSlack: 0, weekExclusions: [], caps: [] },
      ],
    };
    expect(presentSolverRules(config, MEMBERS).personas).toEqual([
      "Eva: nunca Sat.Lead · sem.3: nunca Sun.* · Sat.BGV >= sem−2 · holgura 2 · no aplica con el nuevo solver · Mes por medio",
      "Fer: exenta de carga total",
    ]);
  });

  it("a pool id with no member is counted, never shown", () => {
    const config = { ...NAME_SHAPED, support: ["m-dani", "m-gone"] };
    const soporte = presentSolverRules(config, MEMBERS).listas[2];
    expect(soporte).toEqual({ lista: "Soporte", nombres: ["Dani"], sinMiembro: 1 });
    expect(JSON.stringify(soporte)).not.toContain("m-gone");
  });

  it("a failed rules read is the fixed tool error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await getSolverRulesResult({}, { rules: async () => { throw new Error("rules"); }, members: async () => MEMBERS });
    expect(text(out)).toBe(READ_TOOL_FAILURE_MESSAGE);
    vi.restoreAllMocks();
  });
});

describe("get_integrity_queue", () => {
  const entry = (over: Partial<IntegrityQueue["entries"][number]>): IntegrityQueue["entries"][number] => ({
    key: "k", domain: "roles", kind: "role_target_duplicate", ids: ["role-a", "role-b"], reasons: ["duplicate"],
    relatedIds: ["m-ana"], targetKey: "t", blocking: true, action: "select_canonical_via_operator", cardId: null, ...over,
  });
  const queue = (over: Partial<IntegrityQueue> = {}): IntegrityQueue => ({
    entries: [entry({})], byCard: {}, cardIssues: {}, incomplete: false, unproven: [], count: 1, associatedCount: 0, ...over,
  });
  const role = (id: string, date: string, type: ServiceRole["_type"] = "sunday_role") => ({ _id: id, _rev: "r", _type: type, date } as ServiceRole);

  it("lists the global queue with the panel's labels and document ids, never related ids", () => {
    const out = presentIntegrityQueue(queue(), []);
    expect(out.resumen).toBe("1 problema");
    expect(out.cola).toEqual([
      expect.objectContaining({ tipo: "Servicios duplicados en la misma fecha", motivos: ["más de un documento canónico"], ids: ["role-a", "role-b"], bloquea: true }),
    ]);
    expect(JSON.stringify(out)).not.toContain("m-ana");
  });

  it("an incomplete inventory says so and is never «sin problemas»", () => {
    const out = presentIntegrityQueue(queue({ entries: [], count: 0, incomplete: true }), []);
    expect(out.resumen).toBe("Inventario incompleto");
    expect(out.nota).toContain("incompleto");
  });

  it("with a month, lists the issues attached to that month's services in date order", () => {
    const q = queue({
      byCard: {
        "role-dec-13": [entry({ kind: "lock", reasons: ["wrong_owner"], action: "request_support", cardId: "role-dec-13" })],
        "role-dec-6": [entry({ kind: "dangling_assignment", reasons: ["dangling_assignment"], action: "repair_record_via_operator", cardId: "role-dec-6" })],
        "role-nov-29": [entry({ cardId: "role-nov-29" })],
      },
    });
    const out = presentIntegrityQueue(q, [role("role-dec-13", "2026-12-13"), role("role-nov-29", "2026-11-29"), role("role-dec-6", "2026-12-06")], "2026-12");
    expect(out.porServicio?.map((s) => s.serviceId)).toEqual(["role-dec-6", "role-dec-13"]);
    expect(out.porServicio?.[0]?.problemas[0]?.tipo).toBe("Asignación a un miembro inexistente");
  });
});
