/**
 * Grant a member the Oasis Kids manager right, and optionally set the email
 * they sign in with.
 *
 * DRY RUN BY DEFAULT.
 *   node --env-file=.env.local scripts/grant-kids-manager.mjs --id kidsMember-niza
 *   node --env-file=.env.local scripts/grant-kids-manager.mjs --id kidsMember-niza --email niza@example.com
 *   … add --apply to write.
 *
 * ─── Why the email matters ───────────────────────────────────────────────────
 *
 * `managesMinistries: ["kids"]` is what `requireMinistryManager("kids")` reads,
 * so it is the whole of the authorization. But sign-in resolves a member by
 * EMAIL (`auth.ts`, case-insensitive), so a member without one cannot get a
 * session at all and the grant is inert. Both are needed for a working Kids
 * lead — hence one script.
 *
 * ─── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It never changes `role`. A Kids manager stays app-role `member`: the ministry
 * right is a SECOND axis, not a tier (see CLAUDE.md § Auth). Making them `admin`
 * would hand them the worship Control Room, which is exactly the isolation this
 * delivery exists to enforce.
 *
 * It never invents an email. The address must be supplied and must match the
 * member's real SSO account — whoever controls that mailbox gets this access.
 */
import { createClient } from "@sanity/client";

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};
const APPLY = argv.includes("--apply");
const ID = arg("--id");
const EMAIL = arg("--email");

if (!ID) {
  console.error("Usage: --id <memberDocId> [--email <address>] [--apply]");
  process.exit(1);
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

async function main() {
  console.log(`\nDataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET}   Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const m = await client.fetch(
    `*[_type == "teamMembers" && _id == $id][0]{ _id, member_name, email, role, ministries, managesMinistries, disabled }`,
    { id: ID }
  );
  if (!m) {
    console.error(`No teamMembers document with _id "${ID}".`);
    process.exit(1);
  }

  // Refuse to hand one address to two accounts: sign-in resolves by email, so a
  // duplicate makes which member you become ambiguous.
  if (EMAIL) {
    const clash = await client.fetch(
      `*[_type == "teamMembers" && lower(email) == lower($e) && _id != $id][0]{ _id, member_name }`,
      { e: EMAIL, id: ID }
    );
    if (clash) {
      console.error(`REFUSING: ${EMAIL} is already on ${clash._id} (${clash.member_name}).`);
      process.exit(1);
    }
  }

  const already = (m.managesMinistries || []).includes("kids");
  console.log(`Member  : ${m.member_name}  (${m._id})`);
  console.log(`Role    : ${m.role}  ← unchanged; the ministry right is a second axis, not a tier`);
  console.log(`Ministries       : ${(m.ministries || []).join(", ") || "(absent ⇒ worship)"}`);
  console.log(`managesMinistries: ${(m.managesMinistries || []).join(", ") || "(none)"}  →  kids${already ? "  (already set)" : ""}`);
  console.log(`Email   : ${m.email || "(none — CANNOT SIGN IN)"}${EMAIL ? `  →  ${EMAIL}` : ""}`);

  if (!EMAIL && !m.email) {
    console.log(`\n⚠  No email on the document and none supplied. The grant would be INERT:`);
    console.log(`   sign-in resolves a member by email, so they could not get a session.`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.\n`);
    return;
  }

  const patch = { managesMinistries: ["kids"] };
  if (EMAIL) patch.email = EMAIL;
  await client.patch(ID).set(patch).commit();
  console.log(`\n✅ Applied.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
