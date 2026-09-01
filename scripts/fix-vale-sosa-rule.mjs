// One-off: repair the solver restriction whose `person` names nobody.
//
// WHAT'S WRONG. `solverConfig.restrictions[_key=="5cbxwcm"].person` is the string
// "Vale Sosa". `resolveToMemberName` (app/components/admin/plannerModel.ts:536)
// matches a rule's person text against `member_name` OR `alias`, trimmed and
// case-insensitively, and nothing else. The member is `Valeria Sosa Aguirre`
// with alias `Valesita`, so "Vale Sosa" matches neither and the rule enforces
// NOTHING — she is in the `support` pool and the solver may seat her in
// `Sun.BGV`, which is exactly what the rule says must not happen. The planner
// reports it as "Nombres no reconocidos: Vale Sosa"; that banner is the symptom,
// not the bug.
//
// WHY `Valesita` AND NOT `Valeria Sosa Aguirre`. Both resolve. The rule builder's
// Persona <select> writes `dn(m)` = `alias || member_name`, so editing this rule
// through the UI would produce `Valesita`; and every other rule name in the
// document is an alias (Andy, Frank, Gaby, Hugo, Jakey, Lucía, Mkz, Niza, Tay).
// Writing anything else would make this row the odd one out and invite the next
// person to "fix" it back.
//
// REVISION-GUARDED, deliberately. `app/api/admin/solver-config/route.ts` refuses
// to write this document without a client-observed `_rev` — "multi-admin is the
// entire point": two admins with the panel open would silently overwrite each
// other's whole rule set. A script is not exempt from that. This one reads the
// rev and commits with `ifRevisionId`, so if anyone saves the rule panel between
// the read and the write, this fails instead of clobbering them.
//
//   node --env-file=.env.local scripts/fix-vale-sosa-rule.mjs           # dry run
//   node --env-file=.env.local scripts/fix-vale-sosa-rule.mjs --apply   # writes
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const KEY = "5cbxwcm";
const FROM = "Vale Sosa";
const TO = "Valesita";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
  perspective: "published",
});

if (!process.env.SANITY_WRITE_TOKEN) {
  console.error("Missing SANITY_WRITE_TOKEN in env.");
  process.exit(1);
}

const cfg = await client.fetch(`*[_type == "solverConfig"][0]{ _id, _rev, restrictions }`);
if (!cfg) { console.error("No solverConfig document."); process.exit(1); }

const rule = (cfg.restrictions ?? []).find((r) => r._key === KEY);
if (!rule) {
  console.error(`No restriction with _key ${KEY}. Someone may have deleted it; nothing done.`);
  process.exit(1);
}

// Idempotent: refuses to "fix" a value that is not the one this script knows about.
if (rule.person === TO) {
  console.log(`Already "${TO}" — nothing to do.`);
  process.exit(0);
}
if (rule.person !== FROM) {
  console.error(`Expected person "${FROM}", found "${rule.person}". Refusing to guess; nothing done.`);
  process.exit(1);
}

// Prove the new value resolves BEFORE writing it. This is the check whose absence
// let the broken value sit there unnoticed.
const members = await client.fetch(`*[_type == "teamMembers"]{ member_name, alias }`);
const norm = (v) => (v ?? "").trim().toLowerCase();
const match = members.filter((m) => norm(m.member_name) === norm(TO) || norm(m.alias) === norm(TO));
if (match.length !== 1) {
  console.error(`"${TO}" resolves to ${match.length} members, expected exactly 1. Nothing done.`);
  process.exit(1);
}

console.log(`solverConfig ${cfg._id} (rev ${cfg._rev})`);
console.log(`  restrictions[_key=="${KEY}"].person`);
console.log(`    - "${rule.person}"`);
console.log(`    + "${TO}"   -> ${match[0].member_name}`);
console.log(`  excludedPatterns: ${JSON.stringify(rule.excludedPatterns ?? [])}   fairness: ${rule.fairness} ${rule.fairnessSlack ?? ""}`);
console.log(`  (nothing else in the document is touched)`);

if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to write."); process.exit(0); }

await client
  .patch(cfg._id, { ifRevisionID: cfg._rev })
  .set({ [`restrictions[_key=="${KEY}"].person`]: TO })
  .commit();
console.log("\nApplied.");
