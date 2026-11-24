/**
 * scripts/rekey-solver-rule-people.ts
 *
 * ADR-0092 (C1): make the shared solver rules name people by member id instead of by name, so a name or
 * alias change anywhere (the app, the chat, Studio) can never detach a rule again. A PRODUCTION write:
 * run the dry run, show Frank the names it prints, and apply ONLY after his explicit «sí».
 *
 *   Dry run (writes nothing; prints names, the four checks and a fingerprint):
 *       npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts
 *
 *   Apply (with the fingerprint the dry run printed; snapshots the document to .backfill-backups/ first):
 *       npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts --apply --fingerprint <hex>
 *
 *   Rollback, BEFORE reverting the PR, a Vercel instant rollback to an older deployment, or an
 *   ADR-0056 restore of a names-era rules snapshot (same dry run / apply shape):
 *       npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts --to-names
 *       npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts --to-names --apply --fingerprint <hex>
 *
 * Runbook: run it with no chat proposal waiting to be applied (the write changes the rules `_rev`, and
 * `apply_schedule` refuses a proposal made on an older one; such a proposal is regenerated). After an
 * apply: `get_solver_rules` from the chat lists the same people as before, the planner's Reglas panel
 * shows them, and a dry-run re-run says 0 por convertir.
 *
 * The logic and its checks are `scripts/lib/rekeySolverRulePeople.ts`; the write is the app's one writer
 * core (`app/utils/solverConfigWrite.ts`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@sanity/client";

import { USAGE, parseRekeyArgs, runRekey } from "./lib/rekeySolverRulePeople";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (!parseRekeyArgs(argv)) {
    console.error(USAGE);
    return 2;
  }
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  const token = process.env.SANITY_WRITE_TOKEN;
  if (!projectId || !dataset || !token) {
    console.error("Faltan NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET o SANITY_WRITE_TOKEN (usa --env-file=.env.local).");
    return 1;
  }
  const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", token, useCdn: false, perspective: "published" });
  const backups = path.resolve(process.cwd(), ".backfill-backups");
  return runRekey(argv, {
    client,
    target: `${projectId} · ${dataset}`,
    now: () => new Date(),
    backup: (name, text) => {
      mkdirSync(backups, { recursive: true });
      const file = path.join(backups, name);
      writeFileSync(file, text, { flag: "wx" });
      return file;
    },
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
