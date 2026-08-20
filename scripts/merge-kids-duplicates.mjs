/**
 * Repair the duplicates the Kids roster seed created, and merge them into the
 * real member documents.
 *
 * DRY RUN BY DEFAULT.
 *   node --env-file=.env.local scripts/merge-kids-duplicates.mjs
 *   node --env-file=.env.local scripts/merge-kids-duplicates.mjs --apply
 *
 * ─── What went wrong, and why this list is HAND-WRITTEN ──────────────────────
 *
 * `seed-kids-roster.mjs` compared the Kids team's first names against
 * `member_name` ONLY, so it missed people already on the worship team under a
 * full name with a short alias, and minted a second document for them.
 *
 * The obvious repair — match on `alias` too — was tried and was WRONG in both
 * directions. It proposed merging the Kids Benji, Jorge and Sofí into the
 * worship members who merely share those first names (three different humans,
 * and fusing them would have been unrecoverable), while still missing Valeria
 * Sosa Aguirre, whose alias is "Vale Sosa" rather than "Vale".
 *
 * A first name is not an identity. So this script does not infer anything: the
 * pairs below were confirmed by Frank (2026-08-20) and are the whole list.
 *
 * ─── What this does ──────────────────────────────────────────────────────────
 *
 * For each duplicate: add "kids" to the REAL document's ministries (these people
 * serve both, so they become explicit ["worship","kids"] rather than the legacy
 * absent-means-worship), repoint every `kidsPair.members[]` entry from the
 * seeded id to the real one (rewriting `_key` too, since the key IS the ref),
 * and only then delete the seeded document.
 *
 * Order matters: delete last, so a failure part-way leaves a pair pointing at a
 * document that still exists rather than at nothing.
 */
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

/**
 * The confirmed duplicates. `seeded` is the document the roster seed created;
 * `real` is the person who already existed. Everyone else the seed created is a
 * genuinely new person who happens to share a first name with someone on the
 * worship team — do NOT add them here.
 */
const MERGES = [
  { seededId: "kidsMember-niza", realId: "49e2ec4a-44bb-478c-8a53-2b2bb7562d14" }, // Nitzaya Castillejos, alias "Niza"
  { seededId: "kidsMember-vale", realId: "gJgJ2wc44ylNYNyNTYYu5k" },               // Valeria Sosa Aguirre, alias "Vale Sosa"
];

async function main() {
  console.log(`\nDataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET}   Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const all = await client.fetch(
    `*[_type == "teamMembers"]{ _id, member_name, alias, email, ministries, managesMinistries }`
  );
  const seeded = all.filter((m) => m._id.startsWith("kidsMember-"));
  const real = all.filter((m) => !m._id.startsWith("kidsMember-"));
  const pairs = await client.fetch(`*[_type == "kidsPair"]{ _id, name, room, members }`);

  const merges = [];
  for (const { seededId, realId } of MERGES) {
    const s = seeded.find((m) => m._id === seededId);
    const r = real.find((m) => m._id === realId);
    if (!s) {
      console.log(`  skip ${seededId} — already merged or absent`);
      continue;
    }
    if (!r) {
      console.error(`REFUSING: real document ${realId} not found for ${seededId}.`);
      process.exit(1);
    }
    merges.push({ seeded: s, real: r });
  }

  console.log(`Seeded kids docs: ${seeded.length}   Confirmed duplicates: ${merges.length}`);
  console.log(`Everyone else stays a distinct new person, first-name collisions and all.\n`);

  for (const m of merges) {
    const min = m.real.ministries?.length ? m.real.ministries.join(",") : "(absent ⇒ worship)";
    const affected = pairs.filter((p) => (p.members || []).some((x) => x._ref === m.seeded._id));
    console.log(`  ${m.seeded.member_name.padEnd(8)} ${m.seeded._id}`);
    console.log(`     → real: ${m.real._id}  "${m.real.member_name}" (alias ${m.real.alias || "—"}) ${m.real.email || "(no email)"}`);
    console.log(`       ministries ${min} → worship,kids`);
    console.log(`       pairs repointed: ${affected.map((p) => p.name).join(", ") || "(none)"}`);
    console.log(`       then delete ${m.seeded._id}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.\n`);
    return;
  }

  for (const m of merges) {
    const ministries = Array.from(new Set([...(m.real.ministries?.length ? m.real.ministries : ["worship"]), "kids"]));
    await client.patch(m.real._id).set({ ministries }).commit();

    for (const p of pairs) {
      if (!(p.members || []).some((x) => x._ref === m.seeded._id)) continue;
      const members = p.members.map((x) =>
        x._ref === m.seeded._id ? { _type: "reference", _ref: m.real._id, _key: m.real._id } : x
      );
      await client.patch(p._id).set({ members }).commit();
      p.members = members; // keep local copy consistent for a later merge in the same run
    }

    await client.delete(m.seeded._id);
    console.log(`  merged ${m.seeded.member_name} → ${m.real._id}`);
  }
  console.log(`\n✅ Applied.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
