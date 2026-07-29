// scripts/normalize-instrument-names.mjs
//
// One-off: collapse instrument-name spellings on role documents to a single
// canonical form. Production accumulated 7 spellings of 5 instruments because
// `SlotEditor` used a free-text input; the seat picklist replacing it must not
// inherit them.
//
//   node --env-file=.env.local scripts/normalize-instrument-names.mjs
//   node --env-file=.env.local scripts/normalize-instrument-names.mjs --apply
//
// Dry-run prints every change and writes nothing. `--apply` is required to write.
import { createClient } from "@sanity/client";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = process.env.SR_NORMALIZE_BACKUP_DIR || ".normalize-instrument-backups";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  token: process.env.SANITY_WRITE_TOKEN,
  apiVersion: "2024-01-01",
  useCdn: false,
});

// Canonical spelling keyed by its lowercase, whitespace-collapsed form.
const CANONICAL = new Map([
  ["bass", "Bass"],
  ["keys", "Keys"],
  ["drums", "Drums"],
  ["eg", "EG"],
  ["ag", "AG"],
]);

// `raw` is guaranteed non-null/undefined and non-blank by the caller before this
// runs, so it always canonicalises a real, non-empty spelling.
const canonicalise = (raw) => {
  const key = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return CANONICAL.get(key) ?? raw.trim().replace(/\s+/g, " ");
};

const roles = await client.fetch(
  `*[_type in ["sunday_role","saturday_role","special_role"] && defined(instruments)]{_id, _rev, instruments}`
);

// Build every role's patch plan up front (no writes yet) so a single
// pre-mutation backup can be taken before anything is committed, matching
// scripts/backfill-legacy-seat-arrays.mjs.
const plans = [];
for (const role of roles) {
  const patches = [];
  (role.instruments ?? []).forEach((slot, i) => {
    const raw = slot?.instrument;
    // Unset (null/undefined) is a legitimate, common state: `instrument` has no
    // required validation in sanity/schemas/sunRole.ts, and the Studio preview
    // falls back to "Sin instrumento" for it. Comparing "" !== undefined would
    // read as a change and fabricate a write turning "no instrument chosen"
    // into an explicit "" — skip these slots entirely instead.
    if (raw === null || raw === undefined) return;
    // A whitespace-only string isn't a real spelling to canonicalise, and it
    // carries the same "nothing chosen" meaning as unset — skip it too rather
    // than writing "".
    if (typeof raw === "string" && raw.trim() === "") return;
    const next = canonicalise(raw);
    if (next !== raw) patches.push({ i, from: raw, to: next });
  });
  if (patches.length) plans.push({ role, patches });
}

let changed = 0;
for (const { role, patches } of plans) {
  changed += patches.length;
  for (const p of patches) {
    console.log(`${role._id}  instruments[${p.i}]  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`);
  }
}

if (APPLY && plans.length) {
  // Back up the exact pre-mutation documents before touching anything.
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `${stamp}-normalize-instrument-names.json`);
  writeFileSync(backupPath, JSON.stringify(plans.map(({ role }) => role), null, 2));
  console.log(`\n  backup:  ${plans.length} document(s) -> ${backupPath}`);

  for (const { role, patches } of plans) {
    // Revision-guarded: if the array was reordered or an item was
    // inserted/removed between the read above and this commit, the index-addressed
    // set() below would land on the wrong slot. ifRevisionId makes a concurrent
    // edit fail the commit loudly instead of silently corrupting a neighbour.
    let tx = client.patch(role._id).ifRevisionId(role._rev);
    for (const p of patches) tx = tx.set({ [`instruments[${p.i}].instrument`]: p.to });
    try {
      await tx.commit();
    } catch (err) {
      console.error(`  COMMIT FAILED for ${role._id}: ${err.message}`);
      console.error(`  Skipped — the document changed since the dry run. Re-run to refetch and retry.`);
    }
  }
}

console.log(`\n${changed} slot(s) ${APPLY ? "updated" : "would change"} across ${roles.length} role(s).`);
if (!changed) console.log("Nothing to do.");
else if (!APPLY) console.log("Dry run. Re-run with --apply to write.");
