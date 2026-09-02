// Creates or replaces the «Verificador (bot)» member used by scripts/dev-verify.ts.
//
//   node --env-file=.env.local scripts/dev-verify-seed.mjs           # dry run: prints the doc, writes nothing
//   node --env-file=.env.local scripts/dev-verify-seed.mjs --apply   # writes to the dataset in .env.local
//
// Env: DEV_VERIFY_EMAIL, DEV_VERIFY_PASSWORD_HASH (bcrypt; generate with
//   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<password>'
//   and NEVER paste the hash anywhere tracked), NEXT_PUBLIC_SANITY_PROJECT_ID,
//   NEXT_PUBLIC_SANITY_DATASET, SANITY_WRITE_TOKEN.
//
// Idempotent: deterministic _id. An EXISTING document is PATCHED (so a Studio-set
// `disabled: true` — the kill switch — survives a password rotation); the document
// is CREATED only when absent. Re-running with a new hash rotates the password.
//
// Spec: docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md §3.1

import { buildVerifierDoc, VERIFIER_ID } from "./lib/dev-verify/seedDoc.ts";

const APPLY = process.argv.includes("--apply");
const email = process.env.DEV_VERIFY_EMAIL;
const passwordHash = process.env.DEV_VERIFY_PASSWORD_HASH;

if (!email || !passwordHash) {
  console.error("Missing DEV_VERIFY_EMAIL or DEV_VERIFY_PASSWORD_HASH in env.");
  process.exit(2);
}
if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
  console.error("DEV_VERIFY_PASSWORD_HASH does not look like a bcrypt hash; refusing.");
  process.exit(2);
}

const doc = buildVerifierDoc({ email, passwordHash });
console.log(JSON.stringify({ ...doc, passwordHash: "[redacted]" }, null, 2));

if (!APPLY) {
  console.log("\nDry run. Nothing written. Re-run with --apply to write.");
  process.exit(0);
}

const { createClient } = await import("@sanity/client");
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});
if (!process.env.SANITY_WRITE_TOKEN) {
  console.error("Missing SANITY_WRITE_TOKEN in env.");
  process.exit(2);
}
const twin = await client.fetch(
  `*[_type == "teamMembers" && lower(email) == lower($email) && _id != $id && _id != $draftId][0]._id`,
  { email, id: VERIFIER_ID, draftId: `drafts.${VERIFIER_ID}` },
);
if (twin) {
  console.error(`Another member already uses ${email} (${twin}). Refusing to create a twin.`);
  process.exit(2);
}
const current = await client.fetch(`*[_id == $id][0]{ _id, _rev, disabled }`, { id: VERIFIER_ID });
if (current) {
  const { _id, _type, ...fields } = doc; // never touches `disabled`
  void _id; void _type;
  const patched = await client.patch(VERIFIER_ID).set(fields).commit();
  console.log(`Patched ${patched._id} (rev ${current._rev} → ${patched._rev}); disabled stays ${current.disabled === true}.`);
} else {
  const created = await client.create(doc);
  console.log(`Created ${created._id} (rev ${created._rev}).`);
}
