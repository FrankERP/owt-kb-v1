/**
 * Seed the Oasis Kids roster — 24 people and the 12 pairs they form.
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *   node --env-file=.env.local scripts/seed-kids-roster.mjs
 *   node --env-file=.env.local scripts/seed-kids-roster.mjs --apply
 *
 * ─── What this writes ────────────────────────────────────────────────────────
 *
 * `teamMembers` documents with `ministries: ["kids"]` and NO email, plus one
 * `kidsPair` per couple. A member without an email cannot sign in (the SSO
 * lookup matches on email), which is deliberate: these documents exist so the
 * planner has a roster to schedule and so a Kids manager can record their
 * availability on their behalf. Give someone an email later and they can log in.
 *
 * ─── Names are first names only ──────────────────────────────────────────────
 *
 * That is what the Kids team supplied. `member_name` is stored exactly as given
 * so a leader recognises it; nothing here guesses surnames.
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 *
 * Deterministic ids: `kidsMember-<slug>` and `kidsPair-<room>-<slug>`. Re-running
 * touches nothing that already exists (`createIfNotExists`), so a partial run is
 * safe to repeat. It NEVER edits an existing document — if a name matches
 * somebody already in the dataset, the run reports it and skips, because merging
 * a Kids volunteer into a worship member's record is a judgement call, not a
 * script's decision.
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

/** Exactly as the Kids team wrote them, grouped by room. */
const ROSTER = [
  { room: "chiquitos", pairs: [["Linnette", "Vale"], ["Carlos", "Paola"], ["Sofí", "Jona"], ["Derek", "Aby"]] },
  // "Elvira y Luis": the original WhatsApp list said "Elvira y Carlos", which
  // collided with Carlos in Chiquitos. Frank confirmed (2026-08-20) that
  // Elvira's partner is LUIS — two people, not one serving two rooms.
  { room: "medianos", pairs: [["Caro", "Jorge"], ["Chris", "Xime"], ["Pau", "Josu"], ["Elvira", "Luis"]] },
  { room: "grandes", pairs: [["Fer", "Aidée"], ["David", "Ari"], ["Niza", "Mariana"], ["Irma", "Benji"]] },
];

const ROOM_LABEL = { chiquitos: "RG Chiquitos", medianos: "RG Medianos", grandes: "RG Grandes" };

/** Accent- and case-insensitive, for collision detection against existing members. */
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function main() {
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  console.log(`\nDataset: ${dataset}   Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}\n`);
  if (!process.env.SANITY_WRITE_TOKEN && APPLY) {
    console.error("SANITY_WRITE_TOKEN missing — cannot apply.");
    process.exit(1);
  }

  const existing = await client.fetch(
    `*[_type == "teamMembers"]{ _id, member_name, email, ministries, memberType }`
  );
  const byName = new Map(existing.map((m) => [fold(m.member_name || ""), m]));

  // "Carlos" appears in TWO pairs (chiquitos + medianos). One person or two is a
  // question only the Kids team can answer, so the script refuses to guess: it
  // reports the clash and treats them as ONE person (one document, two pairs),
  // which is the reversible choice — splitting later is an edit, merging later
  // is a data migration.
  const seen = new Map();
  const people = [];
  const pairs = [];

  for (const { room, pairs: roomPairs } of ROSTER) {
    for (const [a, b] of roomPairs) {
      for (const name of [a, b]) {
        const key = fold(name);
        if (!seen.has(key)) {
          seen.set(key, { name, rooms: [room] });
          people.push({ name, id: `kidsMember-${slug(name)}` });
        } else if (!seen.get(key).rooms.includes(room)) {
          seen.get(key).rooms.push(room);
        }
      }
      pairs.push({
        room,
        name: `${a} y ${b}`,
        id: `kidsPair-${room}-${slug(a)}-${slug(b)}`,
        memberIds: [`kidsMember-${slug(a)}`, `kidsMember-${slug(b)}`],
      });
    }
  }

  const clashes = [...seen.values()].filter((p) => p.rooms.length > 1);
  const collisions = people.filter((p) => byName.has(fold(p.name)));

  console.log(`People to create : ${people.length - collisions.length}`);
  console.log(`Pairs to create  : ${pairs.length}`);
  console.log(`Already in Sanity: ${collisions.length}`);

  if (clashes.length) {
    console.log(`\n⚠  SAME FIRST NAME IN TWO ROOMS — treated as ONE person, one document:`);
    for (const c of clashes) console.log(`   • ${c.name} → ${c.rooms.map((r) => ROOM_LABEL[r]).join(" + ")}`);
    console.log(`   If these are DIFFERENT people, stop and say so — they need distinct names.`);
  }

  if (collisions.length) {
    console.log(`\n⚠  NAME ALREADY EXISTS in teamMembers — skipped, never edited:`);
    for (const c of collisions) {
      const m = byName.get(fold(c.name));
      const min = m.ministries?.length ? m.ministries.join(",") : "(absent ⇒ worship)";
      console.log(`   • ${c.name} → ${m._id}  ministries=${min}  email=${m.email || "(none)"}`);
    }
    console.log(`   If one of these IS the Kids volunteer, add "kids" to their ministries`);
    console.log(`   in the app instead — this script will not merge records.`);
  }

  console.log(`\nPairs:`);
  for (const p of pairs) console.log(`   ${ROOM_LABEL[p.room].padEnd(14)} ${p.name}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write.\n`);
    return;
  }

  const tx = client.transaction();
  for (const p of people) {
    if (byName.has(fold(p.name))) continue;
    tx.createIfNotExists({
      _id: p.id,
      _type: "teamMembers",
      member_name: p.name,
      role: "member",
      ministries: ["kids"],
      disabled: false,
    });
  }
  for (const p of pairs) {
    tx.createIfNotExists({
      _id: p.id,
      _type: "kidsPair",
      name: p.name,
      room: p.room,
      active: true,
      members: p.memberIds.map((ref) => ({ _type: "reference", _ref: ref, _key: ref })),
    });
  }
  await tx.commit();
  console.log(`\n✅ Applied.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
