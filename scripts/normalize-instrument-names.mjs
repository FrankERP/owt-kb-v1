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

const APPLY = process.argv.includes("--apply");

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

const canonicalise = (raw) => {
  const key = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return CANONICAL.get(key) ?? String(raw ?? "").trim().replace(/\s+/g, " ");
};

const roles = await client.fetch(
  `*[_type in ["sunday_role","saturday_role","special_role"] && defined(instruments)]{_id, _rev, instruments}`
);

let changed = 0;
for (const role of roles) {
  const patches = [];
  (role.instruments ?? []).forEach((slot, i) => {
    const next = canonicalise(slot?.instrument);
    if (next !== slot?.instrument) {
      patches.push({ i, from: slot?.instrument, to: next });
    }
  });
  if (patches.length === 0) continue;
  changed += patches.length;
  for (const p of patches) {
    console.log(`${role._id}  instruments[${p.i}]  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`);
  }
  if (APPLY) {
    let tx = client.patch(role._id);
    for (const p of patches) tx = tx.set({ [`instruments[${p.i}].instrument`]: p.to });
    await tx.commit();
  }
}

console.log(`\n${changed} slot(s) ${APPLY ? "updated" : "would change"} across ${roles.length} role(s).`);
if (!changed) console.log("Nothing to do.");
else if (!APPLY) console.log("Dry run. Re-run with --apply to write.");
