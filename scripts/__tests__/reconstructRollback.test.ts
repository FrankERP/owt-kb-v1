// Solver v3 C4 R18 — the rollback: it deletes only intact records the reconstruction
// wrote, reads nothing but the requested records, backs each one up before its plan, and
// deletes through C2's REAL executor under the revision the plan recorded. Every name is
// fictitious.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import type { RollbackPlanContent } from "../lib/reconstructPlanFile";
import { harness, type Harness } from "./__fixtures__/reconstructHarness";
import { MONTHS, WORLD_CONFIG, configDoc, restriction, worldDocs } from "./__fixtures__/reconstructWorld";

const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});
const rollbackPlan = (h: Harness) => h.readPlan().content as RollbackPlanContent;
/** Rules the resolver would refuse (an unresolved name) — a rollback must not care. */
const BROKEN_RULES = configDoc({ ...WORLD_CONFIG, restrictions: [...WORLD_CONFIG.restrictions, restriction("r9", "Nadie Ejemplo")] });

/** The world after a reviewed apply: July and August hold records the reconstruction wrote. */
async function applied(h: Harness) {
  expect(await h.dryRun(MONTHS, ["--overrides", h.overridesFile])).toBe(0);
  expect(await h.applyLast(["--overrides", h.overridesFile])).toBe(0);
}

describe("the rollback dry run (R18)", () => {
  it("plans to delete only intact reconstructed records, lists the rest, and backs each up before the plan", async () => {
    const h = make(worldDocs());
    await applied(h);
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--months", "2026-05,2026-06,2026-07,2026-08,2026-09", "--out", h.outDir])).toBe(0);
    const plan = rollbackPlan(h);
    expect(plan.months.map((m) => [m.month, m.action])).toEqual([
      ["2026-05", "none"],
      ["2026-06", "not_reconstruction_owned"],
      ["2026-07", "delete"],
      ["2026-08", "delete"],
      ["2026-09", "record_edited"],
    ]);
    expect(plan.months[2].stored).toMatchObject({ id: "fairnessMonth.2026-07", source: "reconstructed" });
    expect(plan.months[2].stored?.recomputedHash).toBe(plan.months[2].stored?.contentHash);
    expect(plan.months[4].stored?.recomputedHash).not.toBe(plan.months[4].stored?.contentHash);
    const dir = path.dirname(h.planPath());
    expect(readdirSync(dir).sort()).toEqual(["backup-2026-07.json", "backup-2026-08.json", "plan.json", "tabla.md"]);
    expect(JSON.parse(readFileSync(path.join(dir, "backup-2026-07.json"), "utf8"))).toMatchObject({ _id: "fairnessMonth.2026-07", source: "reconstructed" });
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.out).toEqual(
      expect.arrayContaining([
        "reconstruct-fairness-months · proj-test · test · ROLLBACK",
        "2026-05 · sin registro: nada que borrar",
        "2026-06 · no lo escribió la reconstrucción: no se toca",
        "2026-07 · borrar",
        "2026-09 · editado después de reconstruir: no se toca",
      ]),
    );
  });

  it("infers nothing: reads only records, plans over rules the resolver would refuse, and refuses corrections", async () => {
    const h = make(worldDocs());
    await applied(h);
    h.lake.put(BROKEN_RULES);
    const reads = h.lake.reads.length;
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    expect(h.lake.reads.slice(reads).length).toBeGreaterThan(0);
    expect(h.lake.reads.slice(reads).every((r) => r.query.includes('"fairnessMonth"'))).toBe(true);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir, "--overrides", h.overridesFile])).toBe(2);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir, "--preview-run", "2026-08"])).toBe(2);
  });
});

describe("the rollback apply (R18)", () => {
  it("deletes exactly the planned records, each in one guarded transaction, even over refused rules", async () => {
    const h = make(worldDocs());
    await applied(h);
    h.lake.put(BROKEN_RULES);
    expect(await h.run(["--rollback", "--months", "2026-06,2026-07,2026-08", "--out", h.outDir])).toBe(0);
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(0);
    expect(h.lake.commits.slice(commits).map((ops) => ops.map((o) => `${o.op}:${o.id}`))).toEqual([
      ["patch:fairnessMonth.2026-07", "delete:fairnessMonth.2026-07"],
      ["patch:fairnessMonth.2026-08", "delete:fairnessMonth.2026-08"],
    ]);
    expect(h.lake.docs.has("fairnessMonth.2026-07")).toBe(false);
    expect(h.lake.docs.has("fairnessMonth.2026-06")).toBe(true);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · deleted", "2026-08 · deleted"]));
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    expect(rollbackPlan(h).months.map((m) => m.action)).toEqual(["none", "none"]);
  });

  it("refuses with zero deletes when a record's revision moved after the rollback dry run", async () => {
    const h = make(worldDocs());
    await applied(h);
    expect(await h.run(["--rollback", "--months", "2026-07", "--out", h.outDir])).toBe(0);
    const current = h.lake.docs.get("fairnessMonth.2026-07");
    if (!current) throw new Error("no July record");
    h.lake.put({ ...current });
    const commits = h.lake.commits.length;
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(2);
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.out.join("\n")).toMatch(/plan_binding/);
  });

  it("refuses a write plan handed to --rollback --apply", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS)).toBe(0);
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(2);
    expect(h.out.join("\n")).toMatch(/plan de escritura/);
  });

  it("stops at a failed delete and names the rollback's own repair, not the write's (R16, R18)", async () => {
    let failOn: string | null = null;
    const h = make(worldDocs(), {
      execute: (input) => {
        if (input.months[0].month === failOn) h.lake.failNext.commit = Object.assign(new Error("Ana Ejemplo m-ana"), { name: "ClientError", statusCode: 500 });
        return executeFairnessMonthWrites(input);
      },
    });
    await applied(h);
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    failOn = "2026-08";
    expect(await h.run(["--rollback", "--apply", "--plan", h.planPath(), "--fingerprint", h.fingerprint(), "--out", h.outDir])).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · deleted", "2026-08 · error ClientError 500"]));
    const stop = h.out.filter((l) => l.includes("pudo haber llegado"));
    expect(stop).toEqual([expect.stringContaining("--rollback")]);
    expect(stop[0]).toContain("«sin registro: nada que borrar»");
    expect(stop[0]).not.toMatch(/sin cambios|Una escritura/);
    const report = readFileSync(h.out.findLast((l) => l.startsWith("informe: "))!.slice("informe: ".length), "utf8");
    expect(report).toContain("ROLLBACK-APPLY");
    expect(report).toContain("--rollback");
    expect(report).not.toMatch(/Una escritura/);
    expect(h.allOutput()).not.toMatch(/Ana Ejemplo|m-ana/);
    failOn = null;
    expect(await h.run(["--rollback", "--months", "2026-07,2026-08", "--out", h.outDir])).toBe(0);
    expect(rollbackPlan(h).months.map((m) => m.action)).toEqual(["none", "delete"]);
  });
});
