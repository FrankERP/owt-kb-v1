// A run of the reconstruction CLI's core against C2's in-memory Content Lake — NOT a
// test file. Clients are the fake's (real GROQ through groq-js); the executor is C2's
// real one unless a test wraps it; the clock is pinned to 20 Oct 2026 (CDMX) and ticks
// one second per call; every file goes to a temporary folder outside the repository.
// Nothing here touches Sanity, the network or `.env.local` (R23).

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeFairnessSanity, type FakeDoc } from "@/app/utils/__tests__/__fixtures__/fakeFairnessSanity";
import { executeFairnessMonthWrites } from "@/app/utils/fairnessMonthWriteRequest";
import { runReconstruction, type ClientConfig, type ExecuteFn, type RunDeps } from "../../lib/reconstructRun";
import { NOW, OVERRIDES } from "./reconstructWorld";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "proj-test",
  NEXT_PUBLIC_SANITY_DATASET: "test",
  SANITY_API_READ_TOKEN: "test-read-token",
  SANITY_WRITE_TOKEN: "test-write-token",
};

export type Harness = ReturnType<typeof harness>;

export function harness(docs: FakeDoc[], opts: { env?: Record<string, string | undefined>; now?: string; execute?: ExecuteFn } = {}) {
  const lake = createFakeFairnessSanity(docs);
  const work = mkdtempSync(path.join(tmpdir(), "owt-reconstruct-"));
  const outDir = path.join(work, "out");
  const overridesFile = path.join(work, "overrides.json");
  writeFileSync(overridesFile, OVERRIDES);
  const out: string[] = [];
  const err: string[] = [];
  const configs: ClientConfig[] = [];
  let tick = 0;
  const deps: RunDeps = {
    env: opts.env ?? ENV,
    repoRoot: REPO_ROOT,
    platform: process.platform,
    now: () => new Date(Date.parse(opts.now ?? NOW) + 1000 * tick++),
    createClient: (config) => {
      configs.push(config);
      return config.token === ENV.SANITY_WRITE_TOKEN ? lake.clients.write : lake.clients.read;
    },
    execute: opts.execute ?? ((input) => executeFairnessMonthWrites(input)),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  const lastValue = (prefix: string) => {
    const line = [...out].reverse().find((l) => l.startsWith(prefix));
    if (line === undefined) throw new Error(`no stdout line starting with «${prefix}»`);
    return line.slice(prefix.length);
  };
  const run = (argv: string[]) => runReconstruction(argv, deps);
  return {
    lake,
    deps,
    out,
    err,
    configs,
    work,
    outDir,
    overridesFile,
    run,
    dryRun: (months: string, extra: string[] = []) => run(["--months", months, "--out", outDir, ...extra]),
    applyLast: (extra: string[] = []) => run(["--apply", "--plan", lastValue("plan: "), "--fingerprint", lastValue("huella del plan: "), "--out", outDir, ...extra]),
    planPath: () => lastValue("plan: "),
    tablePath: () => lastValue("tabla: "),
    fingerprint: () => lastValue("huella del plan: "),
    readPlan: () => JSON.parse(readFileSync(lastValue("plan: "), "utf8")),
    runDirs: () => {
      try {
        return readdirSync(outDir).sort();
      } catch {
        return [];
      }
    },
    allOutput: () => [...out, ...err].join("\n"),
    cleanup: () => rmSync(work, { recursive: true, force: true }),
  };
}
