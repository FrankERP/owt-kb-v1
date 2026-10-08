// Solver v3 C4 R2, R12, R19, R20, R22 — the static guards on the reconstruction's files,
// the real CLI under tsx, and the key-hygiene sweep over every mode. Every name is
// fictitious; rule keys and one member id have production's seed shape.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { stripComments } from "../lib/strip-comments.mjs";
import { harness, REPO_ROOT, type Harness } from "./__fixtures__/reconstructHarness";
import { MEMBER_IDS, MONTHS, NAMES, RULE_KEYS, WORLD_CONFIG, cap, worldDocs } from "./__fixtures__/reconstructWorld";

const CLI = "scripts/reconstruct-fairness-months.mjs";
const LIB = readdirSync(path.join(REPO_ROOT, "scripts", "lib"))
  .filter((f) => /^reconstruct.*\.ts$/.test(f))
  .sort()
  .map((f) => `scripts/lib/${f}`);
const source = (file: string) => readFileSync(path.join(REPO_ROOT, file), "utf8");
/** The retirement test's write markers (`scripts/lib/__tests__/sr-retired-writer.test.mjs`). */
const WRITE_MARKERS = ["createClient(", "api.sanity.io", ".transaction(", ".commit(", ".patch(", ".delete(", ".create(", ".createIfNotExists(", "fetch("];

const open: Harness[] = [];
const make = (...args: Parameters<typeof harness>) => {
  const h = harness(...args);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open.splice(0)) h.cleanup();
});

describe("the files (R2, R20, R22)", () => {
  it("knows every file of the core, so a new one is a reviewed change", () => {
    expect(LIB).toEqual([
      "scripts/lib/reconstructAnomalies.ts",
      "scripts/lib/reconstructArgs.ts",
      "scripts/lib/reconstructDecide.ts",
      "scripts/lib/reconstructInference.ts",
      "scripts/lib/reconstructOverrides.ts",
      "scripts/lib/reconstructPlanFile.ts",
      "scripts/lib/reconstructPreview.ts",
      "scripts/lib/reconstructReport.ts",
      "scripts/lib/reconstructRun.ts",
      "scripts/lib/reconstructTypes.ts",
    ]);
  });

  it("calls no Sanity mutation method and never imports the route's commit module (R2)", () => {
    const mutation = /\.\s*(create|createIfNotExists|createOrReplace|createOrUpdate|patch|delete|transaction|commit|mutate)\s*\(/;
    for (const file of [CLI, ...LIB]) {
      const code = stripComments(source(file));
      expect(mutation.test(code), file).toBe(false);
      expect(code, file).not.toMatch(/fairnessMonthCommit/);
    }
  });

  it("calls the executor exactly once, from the CLI file — never from scripts/lib (R20 a)", () => {
    expect(stripComments(source(CLI)).match(/\bexecuteFairnessMonthWrites\s*\(/g)).toHaveLength(1);
    for (const file of LIB) expect(stripComments(source(file)), file).not.toMatch(/\bexecuteFairnessMonthWrites\b/);
  });

  it("keeps a write marker after the CLI's imports and none before, so C7's retirement gate fits (R22)", () => {
    const lines = source(CLI).split("\n");
    const firstStatement = lines.findIndex((l) => l.trim() !== "" && !l.startsWith("//") && !l.startsWith("import "));
    expect(firstStatement).toBeGreaterThan(0);
    const head = lines.slice(0, firstStatement).join("\n");
    const body = lines.slice(firstStatement).join("\n");
    for (const marker of WRITE_MARKERS) expect(head.includes(marker), marker).toBe(false);
    expect(body).toContain("createClient(");
  });
});

describe("the real CLI under tsx (R19)", () => {
  it("loads its whole import closure and refuses without the read token, building no client and writing nothing", () => {
    const work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-cli-"));
    try {
      const result = spawnSync(path.join(REPO_ROOT, "node_modules", ".bin", "tsx"), [path.join(REPO_ROOT, CLI), "--months", "2026-08", "--out", path.join(work, "out")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 60_000,
        // A minimal environment: no token can reach the child, whatever the parent holds. NODE_ENV is
        // there because Next's types make it a required key of ProcessEnv.
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? work, NEXT_PUBLIC_SANITY_PROJECT_ID: "proj-test", NEXT_PUBLIC_SANITY_DATASET: "test" },
      });
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("reconstruct-fairness-months · proj-test · test · DRY-RUN");
      expect(result.stderr).toMatch(/falta SANITY_API_READ_TOKEN/);
      expect(result.status).toBe(2);
      expect(readdirSync(work)).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("stdout and stderr carry no name, alias, member id, rule key or key hash — in every mode (R12)", () => {
  it("holds over a dry run, an apply, a rollback, every kind of refusal and a failed read", async () => {
    const outputs: string[] = [];
    const writeFile = (h: Harness, name: string, doc: unknown) => {
      const file = path.join(h.work, name);
      writeFileSync(file, JSON.stringify(doc));
      return file;
    };

    const full = make(worldDocs());
    await full.dryRun(MONTHS, ["--overrides", full.overridesFile]);
    await full.applyLast(["--overrides", full.overridesFile]);
    await full.run(["--rollback", "--months", "2026-07,2026-08", "--out", full.outDir]);
    await full.run(["--rollback", "--apply", "--plan", full.planPath(), "--fingerprint", full.fingerprint(), "--out", full.outDir]);
    outputs.push(full.allOutput());

    const resolver = make(
      worldDocs({ config: { ...WORLD_CONFIG, restrictions: WORLD_CONFIG.restrictions.map((r) => (r.id === "d-ana" ? { ...r, caps: [cap("q2", "Sun.BGV", 1.5)] } : r)) } }),
    );
    expect(await resolver.dryRun(MONTHS)).toBe(2);
    expect(resolver.err.join("\n")).toContain("restricción 1 de 4, tope 1");
    outputs.push(resolver.allOutput());

    const corrections = make(worldDocs());
    const file = writeFile(corrections, "c.json", { schemaVersion: 1, members: { "kidsMember-dani": { months: { "2026-08": { roles: { "Sun.Bajo": "in" } } } } } });
    expect(await corrections.dryRun(MONTHS, ["--overrides", file])).toBe(2);
    outputs.push(corrections.allOutput());

    const binding = make(worldDocs());
    await binding.dryRun(MONTHS);
    const ana = binding.lake.docs.get("m-ana");
    if (!ana) throw new Error("no member document");
    binding.lake.put({ ...ana, unavailableDates: ["2026-08-29"] });
    expect(await binding.applyLast()).toBe(2);
    outputs.push(binding.allOutput());

    const failed = make(worldDocs());
    failed.lake.failNext.fetch = new Error("Ana Ejemplo kidsMember-dani d-beto-carla m-hugo");
    expect(await failed.dryRun(MONTHS)).toBe(1);
    outputs.push(failed.allOutput());

    const text = outputs.join("\n");
    for (const secret of [...NAMES, ...MEMBER_IDS, ...RULE_KEYS]) expect(text.includes(secret), secret).toBe(false);
    for (const key of [...RULE_KEYS, ...MEMBER_IDS]) {
      const prefix = createHash("sha256").update(key, "utf8").digest("hex").slice(0, 8);
      expect(text.includes(prefix), `hash prefix of a fixture identifier`).toBe(false);
    }
  });
});
