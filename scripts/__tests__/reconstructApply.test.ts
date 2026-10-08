// Solver v3 C4 R10, R14–R19 — `--apply` against C2's REAL executor over the in-memory
// Content Lake: the plan binding, the guarded writes, the stop on the first failure.
// The commit log is the mutation log: every write in it was issued by the executor.
// Every name is fictitious.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import { RECORDED_BY } from "../lib/reconstructDecide";
import type { WritePlanContent } from "../lib/reconstructPlanFile";
import type { ExecuteFn } from "../lib/reconstructRun";
import { ENV, REPO_ROOT, harness, type Harness } from "./__fixtures__/reconstructHarness";
import { MEMBER_IDS, MONTHS, NAMES, OVERRIDES, RULE_KEYS, storedRecord, worldDocs } from "./__fixtures__/reconstructWorld";

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
const corrections = (h: Harness) => ["--overrides", h.overridesFile];
const docOf = (h: Harness, id: string) => {
  const doc = h.lake.docs.get(id);
  if (!doc) throw new Error(`no document ${id}`);
  return doc;
};
const STAMPS = { recordedBy: RECORDED_BY, now: "2026-10-20T18:00:00.000Z", currentMonth: "2026-10", environment: "local" as const };
/**
 * A Content Lake failure shaped as `@sanity/client` throws it: its message and `response.url` carry member ids, a
 * name and a rule key. C2's executor rethrows every non-409 error raw, so the run must print its class and status only.
 */
const clientError = () =>
  Object.assign(new Error("Mutation failed for Ana Ejemplo (m-ana, kidsMember-dani) under d-ana"), {
    name: "ClientError",
    statusCode: 500,
    response: { url: "https://proj-test.api.sanity.io/v2024-07-23/data/query/test?query=*&%24ids=m-ana%2CkidsMember-dani", body: { error: { description: "Ana Ejemplo" } } },
  });
const RAW = ["Mutation failed", "api.sanity.io", ...NAMES, ...MEMBER_IDS, ...RULE_KEYS];
const leaks = (text: string) => RAW.filter((secret) => text.includes(secret));

/** A harness whose executor runs `before(input)` first — a concurrent edit AFTER the apply re-derived the plan. */
function racing(docs: FakeDoc[]) {
  let before: (input: Parameters<ExecuteFn>[0]) => void = () => {};
  const h = make(docs, {
    execute: (input) => {
      before(input);
      return executeFairnessMonthWrites(input);
    },
  });
  return { h, setBefore: (fn: typeof before) => (before = fn) };
}

describe("the writes (R10, R14, R16)", () => {
  it("writes exactly the reviewed plan, one guarded mutation per month, stamped by the executor", async () => {
    const h = make(worldDocs());
    expect(await h.dryRun(MONTHS, corrections(h))).toBe(0);
    const plan = planOf(h);
    expect(await h.applyLast(corrections(h))).toBe(0);
    expect(h.configs.map((c) => c.token)).toEqual(["test-read-token", "test-read-token", "test-write-token"]);
    expect(h.lake.commits.map((ops) => ops.map((o) => `${o.op}:${o.id}`))).toEqual([["patch:fairnessMonth.2026-07"], ["create:fairnessMonth.2026-08"]]);
    for (const month of ["2026-07", "2026-08"]) {
      expect(docOf(h, `fairnessMonth.${month}`)).toMatchObject({
        source: "reconstructed",
        engine: "v2",
        environment: "local",
        recordedBy: "script:reconstruct-fairness-months",
        contentHash: plan.months.find((m) => m.month === month)?.bodyHash,
      });
    }
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · replaced", "2026-08 · created"]));
    expect(docOf(h, "fairnessMonth.2026-06").source).toBe("manual");
  });

  it("plans zero writes on the next dry run, and refuses to re-apply the old plan with zero writes (R17)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const [planPath, fingerprint] = [h.planPath(), h.fingerprint()];
    await h.applyLast(corrections(h));
    const commits = h.lake.commits.length;
    expect(await h.dryRun(MONTHS, corrections(h))).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["not_reconstruction_owned", "unchanged", "unchanged", "record_edited"]);
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", fingerprint, "--out", h.outDir, ...corrections(h)])).toBe(2);
    expect(h.lake.commits).toHaveLength(commits);
    expect(h.out.join("\n")).toMatch(/plan_binding/);
  });

  it("stops at a thrown error: the first month landed, the second failed, the third was never attempted (R16)", async () => {
    const { h, setBefore } = racing(worldDocs({ without: ["fairnessMonth.2026-06", "fairnessMonth.2026-07", "fairnessMonth.2026-09"] }));
    expect(await h.dryRun("2026-07,2026-08,2026-09")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["create", "create", "create"]);
    setBefore((input) => {
      if (input.months[0].month === "2026-08") h.lake.failNext.commit = clientError();
    });
    expect(await h.applyLast()).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · created", "2026-08 · error ClientError 500", "sin intentar: 2026-09"]));
    expect(h.out.join("\n")).toMatch(/corre el dry run otra vez antes de cualquier reparación/);
    expect(leaks(h.allOutput())).toEqual([]);
    const report = readFileSync(h.out.find((l) => l.startsWith("informe: "))!.slice("informe: ".length), "utf8");
    expect(report).toContain("| 2026-08 | error ClientError 500 |");
    expect(report).not.toMatch(/Mutation failed|api\.sanity\.io/);
    expect(h.lake.commits.map((ops) => ops[0].id)).toEqual(["fairnessMonth.2026-07"]);
    setBefore(() => {});
    expect(await h.dryRun("2026-07,2026-08,2026-09")).toBe(0);
    expect(planOf(h).months.map((m) => m.action)).toEqual(["unchanged", "create", "create"]);
  });

  it("prints only an error's class and status when the executor's own read throws, and stops before any write", async () => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    setBefore(() => {
      h.lake.failNext.fetch = clientError();
    });
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · error ClientError 500", "sin intentar: 2026-08"]));
    expect(h.lake.commits).toEqual([]);
    expect(leaks(h.allOutput())).toEqual([]);
  });

  it("prints only the class and status when the apply's own re-read fails, writing nothing", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    h.lake.failNext.fetch = clientError();
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.err.join("\n")).toContain("falló: ReadFailure (solverConfig: ClientError 500)");
    expect(h.lake.commits).toEqual([]);
    expect(leaks(h.allOutput())).toEqual([]);
  });
});

describe("every decision row against the executor (R14)", () => {
  const send = async (h: Harness, month: string) => {
    const body = planOf(h).months.find((m) => m.month === month)?.body;
    if (!body) throw new Error(`no body for ${month}`);
    const [result] = await executeFairnessMonthWrites({
      clients: h.lake.clients,
      actor: "reconstruction",
      op: "write",
      months: [{ month, expectedRev: body.expectedRev, people: body.people, presence: body.presence }],
      stamps: STAMPS,
    });
    return result.verdict;
  };

  it("gets from the executor the verdict the plan shows for the rows it never sends", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    expect(await send(h, "2026-06")).toEqual({ refused: "not_reconstruction_owned" });
    expect(await send(h, "2026-09")).toEqual({ refused: "record_edited" });
    // The row R1 refuses before any read: the executor refuses the current month on its own (WR-14 row 1).
    const [current] = await executeFairnessMonthWrites({
      clients: h.lake.clients,
      actor: "reconstruction",
      op: "write",
      months: [
        {
          month: "2026-10",
          expectedRev: null,
          people: [{ memberId: "m-ana", roles: { "Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out" }, exactRules: [], exempt: false, blocks: [] }],
          presence: [],
        },
      ],
      stamps: STAMPS,
    });
    expect(current.verdict).toEqual({ refused: "not_past_month" });
    await h.applyLast(corrections(h));
    await h.dryRun(MONTHS, corrections(h));
    const commits = h.lake.commits.length;
    expect(await send(h, "2026-08")).toBe("unchanged");
    expect(h.lake.commits).toHaveLength(commits);
  });

  it.each<[string, (h: Harness, input: Parameters<ExecuteFn>[0]) => void, string]>([
    ["member_unknown — a listed member deleted after the re-derivation", (h) => h.lake.docs.delete("m-ivan"), "member_unknown"],
    ["record_missing — the record deleted after the re-derivation", (h) => h.lake.docs.delete("fairnessMonth.2026-07"), "record_missing"],
    ["stale_revision — the record rewritten after the re-derivation", (h) => h.lake.put({ ...docOf(h, "fairnessMonth.2026-07") }), "stale_revision"],
  ])("refuses at write time on %s, and stops", async (_label, edit, verdict) => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    setBefore((input) => edit(h, input));
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining([`2026-07 · ${verdict}`, "sin intentar: 2026-08"]));
    expect(h.lake.commits).toEqual([]);
  });

  it("refuses a create that loses the race at commit time (record_exists), after the earlier month landed", async () => {
    const { h, setBefore } = racing(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const rival = storedRecord({ month: "2026-08", people: [{ memberId: "m-ana", roles: { "Sun.Lead": "in", "Sat.Lead": "out", "Sun.BGV": "out", "Sat.BGV": "out", "Sun.Choir": "out", "Sat.Choir": "out" }, exactRules: [], exempt: false, blocks: [] }], presence: [] }, "manual", "rev-rival");
    setBefore((input) => {
      if (input.months[0].month === "2026-08") h.lake.hooks.beforeCommit = () => h.lake.put(rival);
    });
    expect(await h.applyLast(corrections(h))).toBe(1);
    expect(h.out).toEqual(expect.arrayContaining(["2026-07 · replaced", "2026-08 · record_exists"]));
    expect(docOf(h, "fairnessMonth.2026-08").source).toBe("manual");
  });
});

describe("the plan binding (R15)", () => {
  const refusedWithZeroWrites = async (h: Harness) => {
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.lake.commits).toEqual([]);
    expect(h.out.join("\n")).toMatch(/plan_binding/);
    expect(h.err).toEqual([]); // R12, R13: a refusal prints on stdout
  };

  it.each<[string, (h: Harness) => void]>([
    ["a voice seat's stored order inside the join window (no figure moves)", (h) => {
      const d = docOf(h, "sun-2026-09-13");
      h.lake.put({ ...d, BGVs: [...(d.BGVs as unknown[])].reverse() });
    }],
    ["an unavailable date inside a requested month", (h) => h.lake.put({ ...docOf(h, "m-ivan"), unavailableDates: ["2026-08-29"] })],
    ["a stored record's revision", (h) => h.lake.put({ ...docOf(h, "fairnessMonth.2026-07") })],
    ["the corrections file", (h) => writeFileSync(h.overridesFile, OVERRIDES.replace("Llegó a mitad de septiembre.", "Llegó a mitad de mes."))],
  ])("refuses, writing nothing, after a change of %s", async (_label, change) => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    change(h);
    await refusedWithZeroWrites(h);
    const applyDir = h.runDirs().find((d) => d.endsWith("-apply"));
    expect(applyDir && readdirSync(path.join(h.outDir, applyDir))).toEqual(["rechazo.md"]);
  });

  it("refuses after an availability change inside a preview-only month", async () => {
    const h = make(worldDocs());
    await h.dryRun("2026-07,2026-08", corrections(h));
    h.lake.put({ ...docOf(h, "m-beto"), unavailableDates: ["2026-07-26", "2026-06-21"] });
    await refusedWithZeroWrites(h);
  });

  it.each<[string, (h: Harness) => void]>([
    ["publishing a draft", (h) => h.lake.put({ ...docOf(h, "sat-2026-08-22"), published: true })],
    ["an instrument edit", (h) => h.lake.put({ ...docOf(h, "sun-2026-09-13"), instruments: [{ _key: "i0", instrument: "Bajo", person: { _type: "reference", _ref: "m-beto" } }] })],
    ["a seat outside both windows", (h) => h.lake.put({ _id: "sun-2026-10-04", _type: "sunday_role", week: "2026-10-04", published: false, Lead: [{ _key: "k0", _type: "reference", _ref: "m-elena" }], BGVs: [], Chorus: [] })],
  ])("still applies after %s", async (_label, change) => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    change(h);
    expect(await h.applyLast(corrections(h))).toBe(0);
    expect(h.lake.commits).toHaveLength(2);
  });

  it("refuses when a replace's backup is missing from beside the plan (R18)", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    rmSync(path.join(path.dirname(h.planPath()), "backup-2026-07.json"));
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.out.join("\n")).toMatch(/backup_missing/);
    expect(h.lake.commits).toEqual([]);
  });
});

describe("the gate (R11, R19)", () => {
  it("refuses an apply without the write token, constructing no client", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    h.deps.env = { ...ENV, SANITY_WRITE_TOKEN: undefined };
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.configs).toHaveLength(1);
    expect(h.out.join("\n")).toMatch(/SANITY_WRITE_TOKEN/);
  });

  it("refuses a fingerprint the plan does not carry, an edited plan, other months, and a plan inside the repository — before any read", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const reads = h.lake.reads.length;
    const planPath = h.planPath();
    const fingerprint = h.fingerprint();
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", "f".repeat(64), "--out", h.outDir])).toBe(2);
    const edited = path.join(h.work, "edited-plan.json");
    writeFileSync(edited, readFileSync(planPath, "utf8").replace('"rev-jul"', '"rev-otra"'));
    expect(await h.run(["--apply", "--plan", edited, "--fingerprint", fingerprint, "--out", h.outDir])).toBe(2);
    expect(await h.run(["--apply", "--plan", planPath, "--fingerprint", fingerprint, "--months", "2026-07", "--out", h.outDir])).toBe(2);
    expect(await h.run(["--apply", "--plan", path.join(REPO_ROOT, "plan.json"), "--fingerprint", fingerprint, "--out", h.outDir])).toBe(2);
    expect(h.lake.reads).toHaveLength(reads);
    expect(h.out.join("\n")).toMatch(/--fingerprint no es la huella/);
    expect(h.out.join("\n")).toMatch(/su huella no coincide/);
    expect(h.out.join("\n")).toMatch(/--months no coincide/);
    expect(h.out.join("\n")).toMatch(/--plan está dentro del repositorio/);
    expect(h.err).toEqual([]);
  });

  it.each([
    ["dataset", { NEXT_PUBLIC_SANITY_DATASET: "production" }],
    ["project", { NEXT_PUBLIC_SANITY_PROJECT_ID: "proj-otro" }],
  ])("binds the plan to its target: a plan applied under another %s is refused before any read", async (_label, env) => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    expect(h.readPlan().content.inputs).toMatchObject({ projectId: "proj-test", dataset: "test" });
    const reads = h.lake.reads.length;
    h.deps.env = { ...ENV, ...env };
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.configs).toHaveLength(1);
    expect(h.lake.reads).toHaveLength(reads);
    expect(h.lake.commits).toEqual([]);
    expect(h.out.join("\n")).toMatch(/el plan revisado es de otro destino/);
  });

  it("names a missing dataset as missing, not as another target", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    h.deps.env = { ...ENV, NEXT_PUBLIC_SANITY_DATASET: undefined };
    expect(await h.applyLast(corrections(h))).toBe(2);
    expect(h.out.join("\n")).toMatch(/faltan NEXT_PUBLIC_SANITY_PROJECT_ID o NEXT_PUBLIC_SANITY_DATASET/);
    expect(h.out.join("\n")).not.toMatch(/otro destino/);
  });

  it("refuses a plan of the previous version as foreign", async () => {
    const h = make(worldDocs());
    await h.dryRun(MONTHS, corrections(h));
    const old = path.join(h.work, "v1-plan.json");
    writeFileSync(old, readFileSync(h.planPath(), "utf8").replace('"version": 2', '"version": 1'));
    expect(await h.run(["--apply", "--plan", old, "--fingerprint", h.fingerprint(), "--out", h.outDir, ...corrections(h)])).toBe(2);
    expect(h.out.join("\n")).toMatch(/no es un plan de esta herramienta/);
    expect(h.lake.commits).toEqual([]);
  });
});
