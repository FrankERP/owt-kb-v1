// Solver v3 C4 — the dry run over the fictitious world (R23), end to end through the
// runner, C2's builders (real GROQ), resolver, ledger and validator. Every expectation
// below is hand-derived from the world's comments; a red one is a finding about the
// code or the world, never a value to re-capture. Every name is fictitious.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SolverConfig } from "@/app/components/admin/plannerModel";
import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import type { RoleKey, Status } from "@/app/utils/fairnessVocabulary";
import { validateReconstructionBody } from "../lib/reconstructDecide";
import { hypotheticalConfig } from "../lib/reconstructInference";
import type { WritePlanContent } from "../lib/reconstructPlanFile";
import { ANOMALY_CODES } from "../lib/reconstructTypes";
import { ENV, harness, type Harness } from "./__fixtures__/reconstructHarness";
import {
  JULY_RECONSTRUCTED,
  MEMBERS,
  MONTHS,
  WORLD_CONFIG,
  cap,
  member,
  restriction,
  storedRecord,
  worldDocs,
} from "./__fixtures__/reconstructWorld";

const OUT: Record<RoleKey, Status> = {
  "Sun.Lead": "out",
  "Sat.Lead": "out",
  "Sun.BGV": "out",
  "Sat.BGV": "out",
  "Sun.Choir": "out",
  "Sat.Choir": "out",
};
const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});

const planOf = (h: Harness) => h.readPlan().content as WritePlanContent;
const bodyOf = (plan: WritePlanContent, month: string) => {
  const body = plan.months.find((m) => m.month === month)?.body;
  if (!body) throw new Error(`no body for ${month}`);
  return body;
};
const personOf = (plan: WritePlanContent, month: string, id: string) => bodyOf(plan, month).people.find((p) => p.memberId === id);
const withConfig = (patch: (c: SolverConfig) => SolverConfig) => worldDocs({ config: patch(structuredClone(WORLD_CONFIG)) });
const withoutTime = (text: string) => text.split("\n").filter((line) => !line.includes('"generatedAt"')).join("\n");
/** R12, R13: a refusal's lines are on stdout, after the target line; stderr stays empty. */
const refusalLines = (h: Harness) => {
  expect(h.err).toEqual([]);
  return h.out.filter((l) => l.startsWith("rechazo "));
};

describe("the fictitious world's dry run", () => {
  it("plans each month with the executor's own decision and writes the backup, the table and the plan — no Sanity write", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS, ["--overrides", h.overridesFile])).toBe(0);
    const plan = planOf(h);
    expect(plan.months.map((m) => [m.month, m.action])).toEqual([
      ["2026-06", "not_reconstruction_owned"],
      ["2026-07", "replace"],
      ["2026-08", "create"],
      ["2026-09", "record_edited"],
    ]);
    expect(readdirSync(path.dirname(h.planPath())).sort()).toEqual(["backup-2026-07.json", "plan.json", "tabla.md"]);
    expect(plan.months[1]).toMatchObject({ existing: { id: "fairnessMonth.2026-07", rev: "rev-jul", source: "reconstructed" }, backup: { file: "backup-2026-07.json" } });
    expect(plan.months[1].body?.expectedRev).toBe("rev-jul");
    expect(plan.months[2]).toMatchObject({ existing: null, backup: null });
    expect(plan.months[2].body?.expectedRev).toBeNull();
    expect(plan.inputs).toEqual({ projectId: "proj-test", dataset: "test", months: ["2026-06", "2026-07", "2026-08", "2026-09"], previewRun: "2026-10", overridesHash: expect.stringMatching(/^sha256:/) });
    expect(h.lake.commits).toEqual([]);
    expect(h.out[0]).toBe("reconstruct-fairness-months · proj-test · test · DRY-RUN");
    expect(h.out).toContain("«Mes por medio» encontrados: 1 en las reglas · 0 en correcciones");
    expect(h.out).toContain("miembros eliminados o fuera de alabanza con lugares: 1");
    expect(h.out.some((l) => l.startsWith("2026-08 · crear · personas 6 · "))).toBe(true);
  });

  it("builds its one read client with the token, the published perspective and no CDN — and no write client (R3, R19)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS);
    expect(h.configs).toEqual([
      { projectId: "proj-test", dataset: "test", apiVersion: "2024-07-23", token: "test-read-token", perspective: "published", useCdn: false },
    ]);
  });

  it("warns loudly when it finds no «Mes por medio» in the rules or the corrections (A2)", async () => {
    const h = make(withConfig((c) => ({ ...c, restrictions: c.restrictions.filter((r) => r.id !== "c9p4") })));
    expect(await h.dryRun(MONTHS)).toBe(0);
    expect(h.out).toContain("«Mes por medio» encontrados: 0 en las reglas · 0 en correcciones");
    expect(h.out.some((l) => l.startsWith("⚠ AVISO: ningún «Mes por medio»"))).toBe(true);
  });

  it("records what Tipo, join months, the cadence setting and the corrections say (R3–R9)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    expect(bodyOf(plan, "2026-08").people.map((p) => p.memberId)).toEqual(["kidsMember-dani", "m-ana", "m-beto", "m-carla", "m-elena", "m-ivan"]);
    expect(bodyOf(plan, "2026-09").people.map((p) => p.memberId)).toEqual(["kidsMember-dani", "m-ana", "m-beto", "m-carla", "m-elena", "m-fausto", "m-ivan"]);
    expect(personOf(plan, "2026-07", "m-ana")?.roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.Choir": "in" });
    expect(personOf(plan, "2026-08", "m-ana")?.roles).toEqual({ ...OUT, "Sun.Lead": "in", "Sun.BGV": "in", "Sun.Choir": "in" });
    expect(personOf(plan, "2026-08", "m-ana")?.blocks).toEqual([{ date: "2026-08-15", unavailable: true, excludedRoles: [] }]);
    expect(personOf(plan, "2026-08", "m-beto")).toMatchObject({ roles: { ...OUT, "Sun.BGV": "exact", "Sat.BGV": "in" }, exactRules: [{ roles: ["Sun.BGV"], count: 1 }] });
    expect(personOf(plan, "2026-06", "m-beto")).toMatchObject({ roles: OUT, exactRules: [] });
    expect(personOf(plan, "2026-07", "m-beto")?.blocks).toEqual([{ date: "2026-07-26", unavailable: true, excludedRoles: [] }]);
    expect(personOf(plan, "2026-08", "m-carla")?.roles).toEqual(OUT);
    expect(personOf(plan, "2026-09", "m-carla")).toMatchObject({
      roles: { ...OUT, "Sun.BGV": "in", "Sat.BGV": "in" },
      blocks: [
        { date: "2026-09-06", unavailable: true, excludedRoles: [] },
        { date: "2026-09-13", unavailable: true, excludedRoles: [] },
      ],
    });
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      expect(personOf(plan, month, "kidsMember-dani")).toMatchObject({ sundayCadence: "alternate", roles: { ...OUT, "Sun.Lead": "in" } });
      expect(personOf(plan, month, "m-elena")?.roles).toEqual(OUT);
    }
    expect(personOf(plan, "2026-08", "m-ivan")).toMatchObject({
      roles: { ...OUT, "Sat.Lead": "in" },
      blocks: [{ date: "2026-08-08", unavailable: false, excludedRoles: ["Sat.Lead", "Sat.BGV", "Sat.Choir"] }],
    });
    expect(personOf(plan, "2026-09", "m-fausto")).toMatchObject({ roles: { ...OUT, "Sun.BGV": "in" }, blocks: [] });
    expect(bodyOf(plan, "2026-08").presence).toEqual([{ ruleKey: "d-beto-carla", roles: ["Sun.BGV"], members: ["m-beto", "m-carla"], exclusive: false }]);
    expect(plan.months[3].corrections).toEqual([
      { memberId: "m-carla", field: "blocks" },
      { memberId: "m-fausto", field: "Sun.BGV" },
      { memberId: "m-fausto", field: "added" },
    ]);
    for (const m of plan.months) expect(m.body && "source" in m.body).toBeFalsy();
  });

  it("lists every anomaly the world has, by type (R7, R13)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    const byCode = Object.fromEntries(ANOMALY_CODES.map((code) => [code, plan.anomalies.filter((a) => a.code === code).length]));
    expect(byCode).toEqual({
      seat_while_out: 1,
      seat_unavailable: 1,
      seat_rule_excluded: 1,
      join_mid_month: 2,
      exact_mismatch: 1,
      cadence_not_in: 0,
      not_ticked_today: 2,
      ticked_never_seated: 12,
      presence_no_seat: 4,
      presence_outside: 1,
      person_added: 1,
      member_gone: 1,
      duplicate_target: 1,
      second_seat: 1,
      rule_split: 0,
      lost_block: 1,
    });
    expect(plan.anomalies).toEqual(
      expect.arrayContaining([
        { code: "seat_while_out", month: "2026-08", memberId: "m-ana", date: "2026-08-01", roleKey: "Sat.BGV", serviceId: "sat-2026-08-01" },
        { code: "seat_rule_excluded", month: "2026-07", memberId: "m-ivan", date: "2026-07-11", roleKey: "Sat.Lead", serviceId: "sat-2026-07-11" },
        { code: "exact_mismatch", month: "2026-08", memberId: "m-beto", roles: ["Sun.BGV"], count: 1, held: 0 },
        { code: "member_gone", month: "2026-08", memberId: "m-julia" },
        { code: "lost_block", month: "2026-07", memberId: "m-ana", date: "2026-07-12" },
        { code: "join_mid_month", month: "2026-09", memberId: "m-carla", line: "BGV", date: "2026-09-13", firstServiceDate: "2026-09-06" },
        { code: "join_mid_month", month: "2026-07", memberId: "m-ana", line: "CORO", date: "2026-07-19", firstServiceDate: "2026-07-05" },
        { code: "not_ticked_today", month: null, memberId: "m-carla", line: "BGV", months: ["2026-06", "2026-07", "2026-08", "2026-09"] },
        { code: "ticked_never_seated", month: null, memberId: "m-elena", line: "DL", months: ["2026-06", "2026-07", "2026-08", "2026-09"] },
        { code: "presence_outside", month: "2026-09", ruleKey: "d-beto-carla", ruleOrdinal: "presencia 1 de 1", memberId: "m-carla", dates: ["2026-09-13"] },
        { code: "person_added", month: "2026-09", memberId: "m-fausto" },
        { code: "second_seat", month: "2026-09", memberId: "m-ana", date: "2026-09-13", roleKey: "Sun.Choir", serviceId: "sun-2026-09-13" },
      ]),
    );
    expect(plan.anomalies.some((a) => a.code === "ticked_never_seated" && a.memberId === "kidsMember-dani" && a.line === "DL")).toBe(false);
  });

  it("shows a split rule and a cadence setting off Sun.Lead in the table", async () => {
    const h = make(
      withConfig((c) => ({
        ...c,
        restrictions: c.restrictions.map((r) =>
          r.id === "d-ana" ? { ...r, caps: [cap("q9", "Sun.*", 2)] } : r.id === "c9p4" ? { ...r, excludedPatterns: ["Sun.Lead"] } : r,
        ),
      })),
    );
    expect(await h.dryRun(MONTHS)).toBe(0);
    const plan = planOf(h);
    expect(plan.anomalies).toContainEqual({ code: "rule_split", month: "2026-07", memberId: "m-ana", roles: ["Sun.Lead", "Sun.Choir"] });
    // June and September keep their stored records (the two «no se toca» rows), so their anomalies read those.
    expect(plan.anomalies.filter((a) => a.code === "cadence_not_in").map((a) => a.month)).toEqual(["2026-07", "2026-08"]);
    const table = readFileSync(h.tablePath(), "utf8");
    expect(table).toContain("regla fija partida por el inicio de línea");
    expect(table).toContain("tiene «Mes por medio» pero Sun.Lead no está elegible");
  });

  it("previews balances over the record each month will hold — the stored one for an edited month (R11)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const plan = planOf(h);
    expect(plan.preview.sources).toEqual([
      { month: "2026-07", from: "planned" },
      { month: "2026-08", from: "planned" },
      { month: "2026-09", from: "stored" },
    ]);
    expect(plan.preview.figures["m-elena"]?.DL).toEqual({ share: 100, received: 0, balance: 100 });
    expect(plan.preview.figures["kidsMember-dani"]?.DL).toBeUndefined();
    const table = readFileSync(h.tablePath(), "utf8");
    expect(table).toContain("| Elena E. (`m-elena`) | le deben 1.0 |");
  });

  it("shows a replace's per-person changes against the stored record — only on the «reemplazar» month («Decision per month», R21)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const table = readFileSync(h.tablePath(), "utf8");
    const july = table.slice(table.indexOf("## 2026-07 — reemplazar"), table.indexOf("## 2026-08 — crear"));
    expect(july).toContain("### Cambios frente al registro guardado");
    expect(july).toContain("| Ana E. (`m-ana`) | Dom. Coro: fuera → elegible · fecha bloqueada quitada: 2026-07-12 |");
    expect(july).toContain("| Beto E. (`m-beto`) | nueva en el registro |");
    expect(july).toContain("| presencia `d-beto-carla` | nueva en el registro · Sun.BGV · Beto E., Carla E. · no exclusiva |");
    expect(table.match(/### Cambios frente al registro guardado/g)).toHaveLength(1);
  });

  it("shows a newcomer «al día» before her join month", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile, "--preview-run", "2026-09"]);
    expect(readFileSync(h.tablePath(), "utf8")).toContain("| Carla E. (`m-carla`) | al día | al día | al día | al día | al día |");
  });

  it("matches the golden table (fictitious names only)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const table = readFileSync(h.tablePath(), "utf8").replace(/^- Generado: .*$/m, "- Generado: <hora>");
    await expect(table).toMatchFileSnapshot("./__fixtures__/reconstruct-golden-table.md");
  });

  it("always passes an untransformed resolver body through C2's validator (RES-8, A38)", () => {
    // Any superset of the worship roster will do: the resolver drops the kids-only member itself (C2 RES-5).
    const roster = MEMBERS as unknown as EligibilityMember[];
    for (const month of ["2026-06", "2026-07", "2026-08", "2026-09"]) {
      const r = resolveMonthEligibility({ month, config: hypotheticalConfig(WORLD_CONFIG, roster), members: roster });
      expect(r.ok).toBe(true);
      if (r.ok) expect(validateReconstructionBody({ ...r.body, expectedRev: null }, "2026-10")).toEqual({ ok: true });
    }
  });
});

describe("determinism (R5, R17)", () => {
  it("writes byte-identical plans for the same inputs, except the printed time", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    const first = readFileSync(h.planPath(), "utf8");
    await h.dryRun(MONTHS, ["--overrides", h.overridesFile]);
    expect(withoutTime(readFileSync(h.planPath(), "utf8"))).toBe(withoutTime(first));
  });

  it("is not moved by a draft seat after the join window", async () => {
    const a = make(worldDocs());
    await a.dryRun(MONTHS);
    const b = make(worldDocs({ extra: [{ _id: "sun-2026-10-04", _type: "sunday_role", week: "2026-10-04", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-elena" }], BGVs: [], Chorus: [] }] }));
    await b.dryRun(MONTHS);
    expect(withoutTime(readFileSync(b.planPath(), "utf8"))).toBe(withoutTime(readFileSync(a.planPath(), "utf8")));
  });
});

describe("reads (R3)", () => {
  it("writes no file and prints no fingerprint when a read fails, and prints only the error's class", async () => {
    const h = make(worldDocs());
    h.lake.failNext.fetch = Object.assign(new Error("Ana Ejemplo d-ana m-ana"), { statusCode: 500 });
    expect(await h.dryRun(MONTHS)).toBe(1);
    expect(h.runDirs()).toEqual([]);
    expect(h.out.some((l) => l.startsWith("huella del plan"))).toBe(false);
    expect(h.err.join("\n")).toContain("ReadFailure (solverConfig: Error 500)");
    expect(h.allOutput()).not.toMatch(/Ana|d-ana|m-ana/);
  });

  it("refuses without the read token before constructing any client", async () => {
    const h = make(worldDocs(), { env: { ...ENV, SANITY_API_READ_TOKEN: undefined } });
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.configs).toEqual([]);
    expect(h.lake.reads).toEqual([]);
    expect(h.out.join("\n")).toMatch(/falta SANITY_API_READ_TOKEN/);
  });

  it("refuses an absent solverConfig and writes no file — the defaults are not today's rules", async () => {
    const h = make(worldDocs({ config: null }));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(h.runDirs()).toEqual([]);
    expect(h.out.join("\n")).toMatch(/no hay reglas guardadas/);
  });

  it("aborts on a malformed stored record the run needs, writing no file", async () => {
    const h = make(worldDocs({ without: ["fairnessMonth.2026-07"], extra: [{ ...JULY_RECONSTRUCTED, schemaVersion: 9 }] }));
    expect(await h.dryRun(MONTHS)).toBe(1);
    expect(h.runDirs()).toEqual([]);
  });

  it("never reads a draft overlay: the draft Sunday lead gives Elena no DL join month", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS);
    expect(planOf(h).anomalies).toContainEqual(expect.objectContaining({ code: "ticked_never_seated", memberId: "m-elena", line: "DL" }));
    expect(personOf(planOf(h), "2026-09", "m-elena")).toBeDefined();
    expect(personOf(planOf(h), "2026-09", "m-greta")).toBeUndefined();
  });
});

describe("months (R1)", () => {
  it("refuses the current month before any read", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun("2026-09,2026-10")).toBe(2);
    expect(h.lake.reads).toEqual([]);
    expect(h.out.join("\n")).toMatch(/--months 2026-10: solo se reconstruyen meses anteriores/);
  });

  it("skips an empty month and one whose only service is an uncounted special — never a month with a record", async () => {
    const special = { _id: "spe-2026-05-10", _type: "special_role", date: "2026-05-10", service_name: "Retiro", published: true, Lead: [], BGVs: [], Chorus: [] };
    const h = make(worldDocs({ extra: [special] }));
    expect(await h.dryRun("2026-04,2026-05")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["skip", "skip"]);
    expect(h.out).toContain("2026-04 · sin servicios guardados: no se reconstruye");

    const recorded = storedRecord({ month: "2026-05", people: [{ memberId: "m-ana", roles: { ...OUT, "Sun.Lead": "in" }, exactRules: [], exempt: false, blocks: [] }], presence: [] }, "reconstructed", "rev-may");
    const g = make(worldDocs({ extra: [special, recorded] }));
    expect(await g.dryRun("2026-05")).toBe(0);
    expect(planOf(g).months[0].action).toBe("replace");
  });

  it("counts a 31 October Saturday in October once October is past", async () => {
    const saturday = { _id: "sat-2026-10-31", _type: "saturday_role", week: "2026-10-31", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-ivan" }], BGVs: [], Chorus: [] };
    const h = make(worldDocs({ extra: [saturday] }), { now: "2026-11-02T18:00:00.000Z" });
    expect(await h.dryRun("2026-10")).toBe(0);
    expect(planOf(h).months[0].action).toBe("create");
  });
});

describe("refusals after the reads (R6, R8, R12, R13)", () => {
  const refusedOnlyWithReport = (h: Harness) => {
    const dirs = h.runDirs();
    expect(dirs).toHaveLength(1);
    expect(readdirSync(path.join(h.outDir, dirs[0]))).toEqual(["rechazo.md"]);
    return readFileSync(path.join(h.outDir, dirs[0], "rechazo.md"), "utf8");
  };

  it("case (a): «Mes por medio» beside Sun.Lead == 2 in today's rules refuses through the resolver; a «normal» correction does not clear it", async () => {
    const docs = withConfig((c) => ({ ...c, restrictions: c.restrictions.map((r) => (r.id === "c9p4" ? { ...r, caps: [cap("c9c", "Sun.Lead", 2)] } : r)) }));
    const h = make(docs);
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(refusalLines(h)[0]).toBe(`rechazo 1 de 1 · cadence_and_exact · mes por medio · restricción 3 de 4; restricción 3 de 4, tope 1 · 2026-06 · informe: ${path.join(h.outDir, h.runDirs()[0], "rechazo.md")}`);
    const report = refusedOnlyWithReport(h);
    expect(report).toContain("clave `c9p4`");
    expect(report).toContain("Dani E. · `kidsMember-dani`");

    const g = make(docs);
    const file = path.join(g.work, "normal.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, members: { "kidsMember-dani": { sundayCadence: "normal" } } }));
    expect(await g.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    expect(refusalLines(g)[0]).toMatch(/cadence_and_exact/);
  });

  it("case (b) refuses through the validator; removing the correction clears it; case (c) passes", async () => {
    const docs = withConfig((c) => ({ ...c, restrictions: [...c.restrictions, restriction("e1", "Elena Ejemplo", { caps: [cap("e1c", "Sun.Lead", 2)] })] }));
    const writeFile = (h: Harness, doc: unknown) => {
      const file = path.join(h.work, "c.json");
      writeFileSync(file, JSON.stringify(doc));
      return file;
    };
    const b = make(docs);
    expect(await b.dryRun(MONTHS, ["--overrides", writeFile(b, { schemaVersion: 1, members: { "m-elena": { sundayCadence: "alternate" } } })])).toBe(2);
    expect(refusalLines(b)[0]).toMatch(/^rechazo 1 de 4 · invalid_body · corrección · entrada 1 del archivo · 2026-06 · people\[\d+\]\.sundayCadence: cadence_and_exact · informe: /);
    const clean = make(docs);
    expect(await clean.dryRun(MONTHS)).toBe(0);
    const c = make(docs);
    const file = writeFile(c, { schemaVersion: 1, members: { "m-elena": { sundayCadence: "alternate", months: { "*": { roles: { "Sun.Lead": "in" } } } } } });
    expect(await c.dryRun(MONTHS, ["--overrides", file])).toBe(0);
    expect(personOf(planOf(c), "2026-09", "m-elena")).toMatchObject({ sundayCadence: "alternate", exactRules: [], roles: { ...OUT, "Sun.Lead": "in" } });
    expect(planOf(c).months[3].corrections).toContainEqual({ memberId: "m-elena", field: "Sun.Lead" });
  });

  it("prints a refusal over the seed-shaped d-ana restriction by its ordinal, never its key (R12)", async () => {
    const h = make(withConfig((c) => ({ ...c, restrictions: c.restrictions.map((r) => (r.id === "d-ana" ? { ...r, caps: [cap("q2", "Sun.BGV", 1.5)] } : r)) })));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(refusalLines(h)[0]).toContain("exact_count_range · regla fija · restricción 1 de 4, tope 1");
    expect(h.allOutput()).not.toMatch(/d-ana|Ana Ejemplo|Ana E.|m-ana/);
    expect(refusedOnlyWithReport(h)).toContain("restricción 1 de 4, tope 1 · clave `q2`");
  });

  it.each<[string, (docs: { config: SolverConfig; extra: FakeDoc[] }) => void, string]>([
    ["unresolved", (w) => w.config.restrictions.push(restriction("r9", "Nadie Ejemplo")), "unresolved"],
    ["ambiguous", (w) => w.extra.push(member("m-ana-2", "Ana Ejemplo", "Ana Dos", ["voz", "support"])), "ambiguous"],
    ["no_tipo", (w) => { w.extra.push(member("m-sin", "Sin Tipo Ejemplo", "Sintipo", [])); w.config.restrictions.push(restriction("r8", "Sin Tipo Ejemplo")); }, "no_tipo"],
    ["overlapping_exact", (w) => { w.config.restrictions[1].caps.push(cap("c2", "*.BGV", 2)); }, "overlapping_exact"],
    ["presence_members", (w) => { w.config.presence[0].persons = ["Beto Ejemplo"]; }, "presence_members"],
  ])("refuses %s with exit 2, a private report and a name-free line", async (_label, mutate, reason) => {
    const w = { config: structuredClone(WORLD_CONFIG), extra: [] as FakeDoc[] };
    mutate(w);
    const h = make(worldDocs({ config: w.config, extra: w.extra }));
    expect(await h.dryRun(MONTHS)).toBe(2);
    expect(refusalLines(h).some((l) => l.includes(` · ${reason} · `))).toBe(true);
    refusedOnlyWithReport(h);
    expect(h.allOutput()).not.toMatch(/Ejemplo|Ana E.|Beto E.|d-ana|d-beto-carla|m-ana/);
  });

  it("refuses a corrections entry off the worship roster, by its position", async () => {
    const h = make(worldDocs());
    const file = path.join(h.work, "greta.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, members: { "m-greta": { exempt: true } } }));
    expect(await h.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    expect(refusalLines(h)[0]).toMatch(/^rechazo 1 de 1 · override_member_unknown · corrección · entrada 1 del archivo · informe: /);
    expect(refusedOnlyWithReport(h)).toContain("`m-greta`");
  });
});
