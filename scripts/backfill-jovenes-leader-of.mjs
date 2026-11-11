// One-off: state today's meaning of every stored Jóvenes LEADER explicitly — `leaderOf` = their
// groups — so PR 2 can read an absent `leaderOf` as leading NOTHING (L2) without taking anything
// from anyone (plan docs/superpowers/plans/2026-11-11-jovenes-per-group-leadership.md §6, §7 step 3,
// §11 N4 and N9; ADR-0085).
//
// Safety: DRY RUN by default. `--apply` needs Frank's explicit consent on the dry run's exact
// output (recorded in the PR). It writes ONLY `ministryRoles[_key=="<the item's own _key>"].leaderOf`
// on a Jóvenes item whose level is `leader` and whose `leaderOf` is ABSENT (no key, or null), on the
// published document and its `drafts.*` — one patch per document, under `ifRevisionId(_rev)`; a 409
// is reported and that person skipped (re-run). Never `level`, `groups`, `ministries` or any other
// field or type. Idempotent: a second run plans nothing. `versions.*` (Content Release) documents are
// REPORTED, never written. Under PR 1's reading (L1) a backfilled item reads exactly as before.
//
// It ends with THE CHECK, in both modes: the documents whose led groups differ between L1 and L2,
// computed on normalized reads. PR 2 may not merge to `preview` until a fresh dry run, right before
// that merge, prints 0. Only an item with no usable `_key` (or a Content Release version) can keep it
// above 0 after `--apply`; each needs a consented hand fix first (a re-save in «Personas» that
// changes and restores the Jóvenes level, or discarding the draft/version).
//
// ROLLBACK: unset exactly the `leaderOf` paths in the `--apply` run's list (printed, and saved to
// `.backfill-backups/<stamp>-jovenes-leader-of.json`). Under L1 that changes nothing either.
//
// Where it runs: it needs `.env.local` (read token + write token, docs/SECRETS.md; no new secret),
// so on Frank's Mac in the primary checkout. It imports `app/ministries.ts` directly (Node 22 strips
// the types; that module has no imports by design). It exists only in PR 1's tree; PR 2 deletes it.
//
//   node --env-file=.env.local scripts/backfill-jovenes-leader-of.mjs
//   node --env-file=.env.local scripts/backfill-jovenes-leader-of.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { LEADER_OF_QUERY, leaderOfCheck, planLeaderOfBackfill } from "./lib/leaderOfBackfill.mjs";

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
for (const a of argv) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const apply = argv.includes("--apply");
const BACKUP_DIR = process.env.SR_BACKFILL_BACKUP_DIR || ".backfill-backups";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
const readToken = process.env.SANITY_API_READ_TOKEN;
const writeToken = process.env.SANITY_WRITE_TOKEN;
if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}
if (!readToken) {
  // Without a token the raw perspective cannot see `drafts.*`, and they would silently leave the count.
  console.error("SANITY_API_READ_TOKEN is not set — the drafts would be invisible. Refusing.");
  process.exit(1);
}

// `perspective: "raw"` EXPLICITLY, whatever the client's API-version default: published, drafts.*
// and versions.* are each their own document here.
const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "raw", token: readToken });

const groupsText = (g) => (Array.isArray(g) ? `[${g.join(", ")}]` : JSON.stringify(g ?? null));
const kindTag = (k) => (k === "published" ? "" : ` [${k}]`);

function printCheck(title, check) {
  console.log(`\n  ${title}: ${check.length}`);
  for (const c of check) console.log(`    · ${c.name}${kindTag(c.kind)} (${c.id}): L1 ${groupsText(c.l1)} · L2 ${groupsText(c.l2)}`);
}

console.log("backfill-jovenes-leader-of");
console.log(`  project: ${projectId}\n  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const docs = await reader.fetch(LEADER_OF_QUERY);
if (!Array.isArray(docs)) {
  console.error("The read did not answer a list. Refusing.");
  process.exit(1);
}
const plan = planLeaderOfBackfill(docs);

console.log("  Por escribir (nivel · grupos · leaderOf antes → después):");
if (plan.patches.length === 0) console.log("    (nada)");
for (const p of plan.patches) {
  console.log(`    + ${p.name}${kindTag(p.kind)} (${p.id}): líder · grupos ${groupsText(p.groups)} · leaderOf (ausente) → [${p.leaderOf.join(", ")}]`);
}
if (plan.skips.length) {
  console.log("\n  No se escriben (revisar):");
  for (const s of plan.skips) console.log(`    = ${s.name}${kindTag(s.kind)} (${s.id}): ${s.reason}`);
}
const { documents, leaders, planned, skipped } = plan.totals;
console.log(`\n  Totales: ${documents} documento(s) con niveles · ${leaders} elemento(s) de líder · ${planned} por escribir · ${skipped} en la lista de revisión`);

if (!apply) {
  printCheck("CHECK (L1 ≠ L2) hoy", plan.check);
  printCheck("CHECK (L1 ≠ L2) si se aplicara este plan", plan.checkAfter);
  console.log(`\nDRY-RUN complete — no write was made. ${planned} document(s) would be patched.`);
  if (planned) console.log("Re-run with --apply (requires Frank's explicit consent on this output) to write.");
  process.exit(0);
}

if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }
if (planned === 0) {
  printCheck("CHECK (L1 ≠ L2)", plan.check);
  console.log("\nNothing to write.");
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const listPath = path.join(BACKUP_DIR, `${stamp}-jovenes-leader-of.json`);
writeFileSync(
  listPath,
  JSON.stringify({ rollback: "unset exactly these paths", patches: plan.patches.map(({ id, rev, path: p, leaderOf }) => ({ id, rev, path: p, leaderOf })) }, null, 2),
);
console.log(`\n  list:    ${planned} path(s) -> ${listPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
const written = [];
const conflicts = [];
for (const p of plan.patches) {
  try {
    await writer.patch(p.id).ifRevisionId(p.rev).set({ [p.path]: p.leaderOf }).commit();
    written.push(p);
    console.log(`    ✓ ${p.name}${kindTag(p.kind)} (${p.id}): ${p.path} = [${p.leaderOf.join(", ")}]`);
  } catch (err) {
    const status = err?.statusCode;
    if (status === 409) {
      conflicts.push(p);
      console.log(`    ✗ ${p.name}${kindTag(p.kind)} (${p.id}): changed since the read (409) — skipped; re-run`);
      continue;
    }
    console.error(`\n  WRITE FAILED on ${p.id}: ${err?.message ?? err}\n  Written so far: ${written.length}. Re-run the dry run before anything else.`);
    process.exit(1);
  }
}

console.log(`\n  Written: ${written.length} · skipped by 409: ${conflicts.length}`);
console.log(`  Rollback: unset exactly the paths listed in ${listPath} (changes nothing under L1).`);

const fresh = await reader.fetch(LEADER_OF_QUERY);
printCheck("CHECK (L1 ≠ L2) after the write, on a fresh read", leaderOfCheck(Array.isArray(fresh) ? fresh : []));
