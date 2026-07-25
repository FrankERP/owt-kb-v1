// One-off: add the missing seat arrays to six legacy May-2026 role documents.
//
// Why: A1's canonical read contract treats a MISSING seat field as invalid
// rather than empty (a non-array seat cannot be validated), so these six legacy
// docs — created before those fields existed — became integrity issues and would
// stop rendering. Adding the empty arrays makes them groupable again. No
// assignment data is created, changed, or removed.
//
// Safety: dry-run by default. `--apply` needs explicit user consent. Only fields
// that are genuinely ABSENT are set, each patch is revision-guarded, every
// document is backed up before mutation, and the result is re-queried.
//
//   node --env-file=.env.local scripts/backfill-legacy-seat-arrays.mjs
//   node --env-file=.env.local scripts/backfill-legacy-seat-arrays.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const KNOWN_FLAGS = new Set(["--apply"]);
const argv = process.argv.slice(2);
for (const a of argv) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const apply = argv.includes("--apply");

// The exact documents, established by a read-only integrity probe. No discovery
// query: this script can only ever touch these six ids.
const TARGET_IDS = [
  "saturday-role-2026-05-02",
  "saturday-role-2026-05-30",
  "sunday-role-2026-05-03",
  "sunday-role-2026-05-17",
  "sunday-role-2026-05-24",
  "sunday-role-2026-05-31",
];
const ROLE_TYPES = new Set(["sunday_role", "saturday_role", "special_role"]);
const SEAT_ARRAYS = ["Lead", "BGVs", "Chorus", "instruments", "foh_team"];
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

const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: readToken });

console.log(`backfill-legacy-seat-arrays`);
console.log(`  project: ${projectId}`);
console.log(`  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}`);
console.log(`  targets: ${TARGET_IDS.length} exact ids\n`);

const docs = await reader.fetch(
  `*[_id in $ids]{ _id, _rev, _type, week, date, published, Lead, BGVs, Chorus, instruments, foh_team }`,
  { ids: TARGET_IDS },
);

const plans = [];
const refusals = [];

for (const id of TARGET_IDS) {
  const doc = docs.find((d) => d._id === id);
  if (!doc) {
    refusals.push(`${id}: not found — refusing (the id list is fixed, so this means the doc moved or was deleted)`);
    continue;
  }
  if (!ROLE_TYPES.has(doc._type)) {
    refusals.push(`${id}: _type "${doc._type}" is not a role type — refusing`);
    continue;
  }
  const missing = SEAT_ARRAYS.filter((f) => doc[f] === undefined || doc[f] === null);
  const present = SEAT_ARRAYS.filter((f) => Array.isArray(doc[f]));
  const wrongShape = SEAT_ARRAYS.filter((f) => doc[f] !== undefined && doc[f] !== null && !Array.isArray(doc[f]));
  if (wrongShape.length) {
    refusals.push(`${id}: ${wrongShape.join(", ")} present but not an array — refusing (needs manual repair, not a backfill)`);
    continue;
  }
  if (!missing.length) {
    console.log(`  = ${id}: already has all five seat arrays — nothing to do`);
    continue;
  }
  plans.push({ id, rev: doc._rev, missing, doc });
  console.log(`  + ${id} (${doc._type}, ${doc.week ?? doc.date}) rev=${doc._rev}`);
  console.log(`      will set: ${missing.map((f) => `${f}: []`).join(", ")}`);
  console.log(`      untouched: ${present.join(", ")}`);
}

if (refusals.length) {
  console.log(`\n  REFUSALS:`);
  for (const r of refusals) console.log(`    ✗ ${r}`);
}

if (!plans.length) {
  console.log(`\nNothing to write.`);
  process.exit(refusals.length ? 1 : 0);
}

if (!apply) {
  console.log(`\nDRY-RUN complete — no write was made. ${plans.length} document(s) would be patched.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}

if (!writeToken) {
  console.error("\nSANITY_WRITE_TOKEN is not set — cannot write.");
  process.exit(1);
}

// Back up the exact pre-mutation documents before touching anything.
mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-legacy-seat-arrays.json`);
writeFileSync(backupPath, JSON.stringify(docs, null, 2));
console.log(`\n  backup:  ${plans.length} document(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });

// One transaction, each patch revision-guarded: a concurrent edit aborts the
// whole thing rather than clobbering someone's work.
let tx = writer.transaction();
for (const p of plans) {
  const set = Object.fromEntries(p.missing.map((f) => [f, []]));
  tx = tx.patch(p.id, (patch) => patch.ifRevisionId(p.rev).set(set));
}

try {
  await tx.commit();
} catch (err) {
  console.error(`\n  COMMIT FAILED: ${err.message}`);
  console.error(`  Nothing was written (the transaction is atomic). Re-run the dry run to refetch revisions.`);
  process.exit(1);
}

// Re-query and prove the exact expected end state.
const after = await reader.fetch(
  `*[_id in $ids]{ _id, _rev, Lead, BGVs, Chorus, instruments, foh_team }`,
  { ids: plans.map((p) => p.id) },
);
let ok = true;
for (const p of plans) {
  const d = after.find((x) => x._id === p.id);
  const stillMissing = SEAT_ARRAYS.filter((f) => !Array.isArray(d?.[f]));
  if (stillMissing.length) {
    ok = false;
    console.error(`  ✗ ${p.id}: still missing ${stillMissing.join(", ")}`);
  } else {
    console.log(`  ✓ ${p.id}: all five seat arrays present (rev ${d._rev})`);
  }
}

console.log(ok ? `\nDone. ${plans.length} document(s) patched and verified.` : `\nVERIFICATION FAILED — inspect before retrying.`);
process.exit(ok ? 0 : 1);
