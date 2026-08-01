/**
 * scripts/seed-solver-config.ts
 *
 * Seed the ONE shared planner rule document (`_id: solverConfig`) from the live
 * `localStorage` capture — the only place the real rules exist.
 *
 * ─── Why the capture and not `DEFAULT_SOLVER_CONFIG` ─────────────────────────
 *
 * `DEFAULT_SOLVER_CONFIG` (`app/components/admin/MonthGenerator.tsx`) is the
 * FIRST-RUN seed and nothing more. Every rule added, edited or deleted since
 * that browser first opened the generator lives only in
 * `localStorage["owt_solver_config_v3"]`. Seeding from the constant would
 * silently discard all of it, and — because these are HARD blocks since Task 3 —
 * would then enforce a rule set nobody wrote, on both surfaces, for every admin.
 *
 * ─── Capture it like this ────────────────────────────────────────────────────
 *
 *   1. Open the admin panel in the browser that HAS the rules, DevTools console:
 *          copy(localStorage.getItem("owt_solver_config_v3"))
 *   2. Paste into a file in the working tree, e.g. `solver-config-capture.json`
 *      (untracked — it is a capture, not source).
 *   3. Dry-run, READ THE DIFF, then apply.
 *
 * ─── Run it like this ────────────────────────────────────────────────────────
 *
 *   Dry run (writes nothing, prints exactly what would be created):
 *       npx tsx --env-file=.env.local scripts/seed-solver-config.ts ./solver-config-capture.json
 *
 *   Apply (a PRODUCTION write — needs the user's explicit consent):
 *       npx tsx --env-file=.env.local scripts/seed-solver-config.ts ./solver-config-capture.json --apply
 *
 *   `npx tsx` rather than bare `node`, and TypeScript rather than the `.mjs` most
 *   one-offs use, for one reason: this script MUST share
 *   `app/utils/solverConfigWriteRequest.ts` with the admin route, or the seeded
 *   document and every later save can drift on `_key` minting and validation.
 *   That module is TypeScript, and `moduleResolution: "bundler"` means its import
 *   here carries no file extension — which bare `node --experimental-strip-types`
 *   cannot resolve. `scripts/import-schedule.ts` already runs this way, and `tsx`
 *   is in `node_modules/.bin`, so `npx` resolves it locally with no download.
 *
 *   Verified to run: `npx tsx scripts/seed-solver-config.ts` with no argument
 *   prints the usage line and exits 1, a missing `SANITY_WRITE_TOKEN` is
 *   reported up front (on the dry run too — a dry run rehearses the credentials
 *   as well as the diff), and an invalid capture is rejected with its issue
 *   paths — all three BEFORE any Sanity client is constructed.
 *
 *   Every run prints its resolved target (project · dataset · dry-run/apply)
 *   before it reads anything: both ids fall back to a default, so without that
 *   line the output cannot be attributed to a dataset.
 *
 * ─── What it refuses to do ───────────────────────────────────────────────────
 *
 * **If the document already exists, this script REFUSES and prints the
 * difference.** It never overwrites — not with `createOrReplace`, not with
 * `createIfNotExists`. If a document is already there, something other than this
 * script minted it, and that is precisely the failure the "the route may only
 * UPDATE" rule exists to prevent; overwriting would then destroy whatever an
 * admin has since edited, and no-op'ing would silently abandon the live rules.
 * Either way a human has to look.
 *
 * The `_key` minting and every validation rule come from
 * `app/utils/solverConfigWriteRequest.ts` — the SAME module the admin route
 * uses, so the seeded document and every later save cannot drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@sanity/client";

import {
  SOLVER_CONFIG_DOC_ID,
  buildSolverConfigDocument,
  parseSolverConfigWrite,
  solverConfigFromDocument,
} from "../app/utils/solverConfigWriteRequest";

/**
 * The capture is the RAW `localStorage` string, so it may be either the JSON
 * object itself or a JSON string CONTAINING it (`copy()` on a `getItem` result
 * hands over the inner string; a `copy(JSON.parse(...))` hands over the object).
 * Accept both rather than make the operator guess which one they pasted.
 */
function parseCapture(text: string): unknown {
  const once: unknown = JSON.parse(text);
  return typeof once === "string" ? JSON.parse(once) : once;
}

function summarize(label: string, c: ReturnType<typeof solverConfigFromDocument>) {
  console.log(`\n${label}`);
  console.log(
    `  pools: ${c.sundayLeads.length} dom · ${c.saturdayLeads.length} sáb · ${c.support.length} apoyo`,
  );
  for (const r of c.restrictions) {
    const bits = [
      r.excludedPatterns.length ? `!in ${r.excludedPatterns.join(",")}` : "",
      r.weekExclusions.map((w) => `!in week ${w.week} ${w.pattern}`).join(" "),
      r.caps.map((cap) => `${cap.pattern} ${cap.op} ${cap.value}${cap.relative ? ` (rel ${cap.relOffset})` : ""}`).join(" "),
      r.fairness !== "none" ? `fairness:${r.fairness}` : "",
    ].filter(Boolean);
    console.log(`  restriction ${r.id} · ${r.person} · ${bits.join(" · ") || "(sin cláusulas)"}`);
  }
  for (const x of c.conflicts) {
    console.log(`  conflict    ${x.id} · ${x.personA} !with ${x.personB} on ${x.pattern}`);
  }
  for (const p of c.presence) {
    console.log(`  presence    ${p.id} · any_of(${p.persons.join(", ")}) on ${p.pattern}`);
  }
}

/**
 * Everything, in an async function rather than at the top level.
 *
 * Not style: the package has no `"type": "module"`, so a top-level `await` in a
 * `.ts` file here is transformed to CJS and fails to even parse
 * ("Top-level await is currently not supported with the cjs output format").
 * That failure happens before argument parsing, so the script would have blown
 * up in the operator's hands on its very first run — which for a one-shot
 * production seed is the worst possible moment to discover it.
 *
 * Returns the process exit code; nothing here calls `process.exit` mid-flow, so
 * every path has one visible ending.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const capturePath = args.find((a) => !a.startsWith("--"));

  if (!capturePath) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/seed-solver-config.ts <capture.json> [--apply]",
    );
    return 1;
  }

  // UP FRONT, and on the dry run too. The token is the last thing a write needs
  // and the first thing that is missing: checked at the commit instead, the
  // operator gets a clean-looking dry run, decides to apply on the strength of
  // it, and only then discovers the run never had credentials — with the whole
  // review to redo. A dry run is a rehearsal; it rehearses this as well.
  if (!process.env.SANITY_WRITE_TOKEN) {
    console.error(
      "SANITY_WRITE_TOKEN is not set. Re-run with `--env-file=.env.local` (or export it).\n" +
        "Nothing was read and nothing was written.",
    );
    return 1;
  }

  const raw = readFileSync(path.resolve(process.cwd(), capturePath), "utf8");
  const parsed = parseSolverConfigWrite(parseCapture(raw));
  if (!parsed.ok) {
    console.error("The capture is not a valid rule set. Nothing was written.");
    for (const issue of parsed.issues) console.error(`  · ${issue}`);
    return 1;
  }
  const { config } = parsed.value;

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk";
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || "production";

  const client = createClient({
    projectId,
    dataset,
    apiVersion: "2024-01-01",
    token: process.env.SANITY_WRITE_TOKEN,
    useCdn: false,
  });

  // Printed BEFORE anything is read, so every line below is attributable to a
  // named target. Both ids fall back to a default, so "which dataset did that
  // dry run actually describe?" is otherwise unanswerable from the output — and
  // this is a one-shot, irreversible production create.
  console.log(
    `Target: project ${projectId} · dataset ${dataset} · ${apply ? "APPLY (writes)" : "dry run (writes nothing)"}`,
  );

  const existing = await client.fetch<Record<string, unknown> | null>(`*[_id == $id][0]`, {
    id: SOLVER_CONFIG_DOC_ID,
  });

  if (existing) {
    console.error(
      `\nREFUSING: ${SOLVER_CONFIG_DOC_ID} already exists (_rev ${String(existing._rev)}).`,
    );
    console.error(
      "This script is the only writer allowed to create it, so something else did —\n" +
        "either an unguarded write, or the admin route after the create guard was weakened.\n" +
        "Nothing was written. Compare the two below and decide by hand.",
    );
    summarize("STORED (already in Sanity):", solverConfigFromDocument(existing));
    summarize("CAPTURE (this file):", config);
    return 2;
  }

  const doc = buildSolverConfigDocument({ config, now: new Date().toISOString() });
  summarize("Would create:", config);
  console.log(
    `\n_id=${SOLVER_CONFIG_DOC_ID} · ${config.restrictions.length} restrictions · ` +
      `${config.conflicts.length} conflicts · ${config.presence.length} presence`,
  );

  if (!apply) {
    console.log("\nDry run. Review the rules above against the browser, then re-run with --apply.");
    return 0;
  }

  // `create`, never `createIfNotExists`/`createOrReplace`: the id collision IS
  // the guard, so a document that appeared between the check above and this line
  // fails the write instead of silently winning or losing.
  await client.create(doc as { _id: string; _type: string } & Record<string, unknown>);
  console.log(`\nCreated ${SOLVER_CONFIG_DOC_ID}.`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
