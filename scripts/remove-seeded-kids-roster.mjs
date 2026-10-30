/**
 * Remove the Oasis Kids roster `seed-kids-roster.mjs` created: the people with
 * no email (so no account) and the 12 pairs they form.
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *   node --env-file=.env.local scripts/remove-seeded-kids-roster.mjs
 *   node --env-file=.env.local scripts/remove-seeded-kids-roster.mjs --apply
 *
 * ─── Why ─────────────────────────────────────────────────────────────────────
 *
 * Frank, 2026-10-29: Kids is paused while Jóvenes comes first, «quita las
 * personas inventadas de kids que no tienen correo asociado»; the real people
 * arrive later in one bulk load of accounts. The seed minted them as
 * `kidsMember-<slug>` with `ministries: ["kids"]` and no email, so nobody could
 * ever sign in as one of them.
 *
 * ─── Who goes, and who stays ─────────────────────────────────────────────────
 *
 * A person goes only if ALL of these hold: the seed's id prefix, `ministries`
 * exactly `["kids"]`, no email, no password, not a Kids manager. Anyone with an
 * email stays (Niza and Vale, merged into their real worship documents in
 * August by `merge-kids-duplicates.mjs`, keep Kids). A pair goes if it holds
 * anyone who goes: a pair of one is not a pair, and every pair today holds a
 * seeded person.
 *
 * ─── Refusals ────────────────────────────────────────────────────────────────
 *
 * The run refuses, writing nothing, if a seeded-prefix person fails the rules
 * above (a human must look), if any `kidsSchedule` exists (a saved Sunday would
 * lose its pairs — today there are none), or if anything else references a
 * document about to go. Run it with the read token: an untokened read cannot see
 * private dotted documents, and would call the reference check clean.
 *
 * ─── How ─────────────────────────────────────────────────────────────────────
 *
 * One transaction: the pairs and the people together, so the dataset never
 * holds a pair pointing at nobody. `seed-kids-roster.mjs` can recreate them.
 */
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN || process.env.SANITY_API_READ_TOKEN,
  useCdn: false,
});

const PREFIX = "kidsMember-";

/** The person rule, in one place so the dry run and the apply can never disagree. */
export function removable(m) {
  const ministries = Array.isArray(m.ministries) ? m.ministries : [];
  return (
    typeof m._id === "string" &&
    m._id.startsWith(PREFIX) &&
    ministries.length === 1 &&
    ministries[0] === "kids" &&
    !(typeof m.email === "string" && m.email.trim()) &&
    !m.hasPassword &&
    !(Array.isArray(m.managesMinistries) && m.managesMinistries.length)
  );
}

async function main() {
  console.log(`\nDataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET}   Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}\n`);
  if (APPLY && !process.env.SANITY_WRITE_TOKEN) {
    console.error("SANITY_WRITE_TOKEN missing — cannot apply.");
    process.exit(1);
  }
  if (!process.env.SANITY_WRITE_TOKEN && !process.env.SANITY_API_READ_TOKEN) {
    console.log("WARNING: no token — private documents are invisible, so the reference check below is incomplete.\n");
  }

  const { kidsMembers, pairs, schedules } = await client.fetch(`{
    "kidsMembers": *[_type == "teamMembers" && ("kids" in ministries || _id match "${PREFIX}*")]{
      _id, member_name, alias, email, ministries, managesMinistries, "hasPassword": defined(passwordHash) && passwordHash != ""
    } | order(member_name asc),
    "pairs": *[_type == "kidsPair"]{ _id, name, room, "memberIds": members[]._ref },
    "schedules": count(*[_type == "kidsSchedule"])
  }`);

  const seeded = kidsMembers.filter((m) => m._id.startsWith(PREFIX));
  const odd = seeded.filter((m) => !removable(m));
  if (odd.length) {
    console.error("REFUSING: seeded documents that no longer look seeded (a human must look):");
    for (const m of odd) console.error(`  ${m._id}  ${m.member_name}  ministries=${JSON.stringify(m.ministries)} email=${m.email ? "yes" : "no"}`);
    process.exit(1);
  }
  if (schedules > 0) {
    console.error(`REFUSING: ${schedules} kidsSchedule document(s) exist; removing their pairs would empty saved Sundays.`);
    process.exit(1);
  }

  const people = seeded;
  const peopleIds = new Set(people.map((m) => m._id));
  const goingPairs = pairs.filter((p) => (p.memberIds || []).some((id) => peopleIds.has(id)));
  const goingIds = new Set([...peopleIds, ...goingPairs.map((p) => p._id)]);

  // Anything else that points at a document about to go.
  const referrers = await client.fetch(
    `*[references($ids) && !(_id in $ids)]{ _id, _type }`,
    { ids: [...goingIds] },
  );

  const staying = kidsMembers.filter((m) => !peopleIds.has(m._id));
  console.log(`People to remove (${people.length}):`);
  for (const m of people) console.log(`  ${m.member_name.padEnd(10)} ${m._id}`);
  console.log(`\nPairs to remove (${goingPairs.length} of ${pairs.length}):`);
  for (const p of goingPairs) console.log(`  ${(p.name || "").padEnd(18)} ${p.room.padEnd(10)} ${p._id}`);
  console.log(`\nKids members who stay (${staying.length}):`);
  for (const m of staying) console.log(`  ${m.member_name}${m.alias ? ` (${m.alias})` : ""}  ministries=${JSON.stringify(m.ministries)}`);
  console.log(`\nkidsSchedule documents: ${schedules}`);

  if (referrers.length) {
    console.error(`\nREFUSING: other documents reference what would be removed:`);
    for (const r of referrers) console.error(`  ${r._type}  ${r._id}`);
    process.exit(1);
  }
  console.log(`Other references: none`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.\n`);
    return;
  }

  const tx = client.transaction();
  for (const p of goingPairs) tx.delete(p._id);
  for (const m of people) tx.delete(m._id);
  await tx.commit();

  const left = await client.fetch(`count(*[_id in $ids])`, { ids: [...goingIds] });
  console.log(`\n✅ Applied. Documents left of those removed: ${left} (expected 0).\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
