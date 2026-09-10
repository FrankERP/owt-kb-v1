// One-off: derive each instrumentalist's declared instruments from the seats
// they have actually held (spec 2026-09-09-member-instruments-auto-fill §5).
//
// Safety: dry-run by default. `--apply` needs Frank's explicit consent on the
// dry-run output. Writes ONLY to members with Tipo `instrumento` and NO stored
// `instruments` field (setIfMissing — never overwrites, not even `[]`), each
// patch revision-guarded, every touched document backed up first. Only names
// in the closed vocabulary are written; anything else is listed for a human.
//
//   node --env-file=.env.local scripts/backfill-member-instruments.mjs
//   node --env-file=.env.local scripts/backfill-member-instruments.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proposeInstruments } from "./lib/memberInstruments.mjs";

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

const reader = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: readToken });

console.log(`backfill-member-instruments`);
console.log(`  project: ${projectId}\n  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const members = await reader.fetch(`*[_type == "teamMembers"]{ _id, _rev, member_name, memberType, instruments }`);
const roles = await reader.fetch(
  `*[_type in ["sunday_role","saturday_role","special_role"]]{ instruments[]{ instrument, person } }`,
);
const { proposals, noTipo, unrecognised } = proposeInstruments(members, roles);

const writes = proposals.filter((p) => p.action === "write");
console.log(`  Miembros con Tipo instrumento: ${proposals.length}`);
for (const p of proposals) {
  const ev = Object.entries(p.evidence).map(([k, v]) => `${k}×${v}`).join(", ") || "—";
  const tag = p.action === "write" ? "+" : "=";
  const why = p.action === "skip-stored" ? `ya tiene [${p.stored.join(", ")}] — no se toca`
    : p.action === "skip-no-history" ? "sin historial — no se escribe" : `escribe [${p.proposed.join(", ")}]`;
  console.log(`  ${tag} ${p.name} (${p.id}): ${why}   evidencia: ${ev}`);
}
if (noTipo.length) {
  console.log(`\n  Tocaron pero NO tienen Tipo instrumento (no se escribe; corrige el Tipo primero si aplica):`);
  for (const n of noTipo) console.log(`    · ${n.name}: ${n.seen.join(", ")}`);
}
if (unrecognised.length) {
  console.log(`\n  Etiquetas NO reconocidas en el historial (no se escriben; mapea a mano):`);
  for (const u of unrecognised) console.log(`    · "${u.label}" ×${u.count}`);
}

if (!writes.length) { console.log(`\nNothing to write.`); process.exit(0); }
if (!apply) {
  console.log(`\nDRY-RUN complete — no write was made. ${writes.length} member(s) would be patched.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}
if (!writeToken) { console.error("\nSANITY_WRITE_TOKEN is not set — cannot write."); process.exit(1); }

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-member-instruments.json`);
writeFileSync(backupPath, JSON.stringify(members.filter((m) => writes.some((w) => w.id === m._id)), null, 2));
console.log(`\n  backup:  ${writes.length} document(s) -> ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
let tx = writer.transaction();
for (const w of writes) {
  const rev = members.find((m) => m._id === w.id)._rev;
  tx = tx.patch(w.id, (patch) => patch.ifRevisionId(rev).setIfMissing({ instruments: w.proposed }));
}
try {
  await tx.commit();
} catch (err) {
  console.error(`\n  COMMIT FAILED: ${err.message}\n  Nothing was written (the transaction is atomic). Re-run the dry run to refetch revisions.`);
  process.exit(1);
}
const after = await reader.fetch(`*[_id in $ids]{ _id, member_name, instruments }`, { ids: writes.map((w) => w.id) });
console.log(`\n  Written:`);
for (const a of after) console.log(`    ✓ ${a.member_name}: [${(a.instruments ?? []).join(", ")}]`);
