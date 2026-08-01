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
 *   cannot resolve. `scripts/import-schedule.ts` already runs this way.
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

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const capturePath = args.find((a) => !a.startsWith("--"));

if (!capturePath) {
  console.error(
    "Usage: node --env-file=.env.local scripts/seed-solver-config.ts <capture.json> [--apply]",
  );
  process.exit(1);
}

const raw = readFileSync(path.resolve(process.cwd(), capturePath), "utf8");

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

const parsed = parseSolverConfigWrite(parseCapture(raw));
if (!parsed.ok) {
  console.error("The capture is not a valid rule set. Nothing was written.");
  for (const issue of parsed.issues) console.error(`  · ${issue}`);
  process.exit(1);
}
const { config } = parsed.value;

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const existing = await client.fetch<Record<string, unknown> | null>(`*[_id == $id][0]`, {
  id: SOLVER_CONFIG_DOC_ID,
});

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
  process.exit(2);
}

const doc = buildSolverConfigDocument({ config, now: new Date().toISOString() });
summarize("Would create:", config);
console.log(
  `\n_id=${SOLVER_CONFIG_DOC_ID} · ${config.restrictions.length} restrictions · ` +
    `${config.conflicts.length} conflicts · ${config.presence.length} presence`,
);

if (!apply) {
  console.log("\nDry run. Review the rules above against the browser, then re-run with --apply.");
  process.exit(0);
}

// `create`, never `createIfNotExists`/`createOrReplace`: the id collision IS the
// guard, so a document that appeared between the check above and this line fails
// the write instead of silently winning or losing.
await client.create(doc as { _id: string; _type: string } & Record<string, unknown>);
console.log(`\nCreated ${SOLVER_CONFIG_DOC_ID}.`);
