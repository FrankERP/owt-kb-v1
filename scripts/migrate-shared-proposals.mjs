// scripts/migrate-shared-proposals.mjs
//
// Migrate legacy per-lead setlistProposal docs to the shared-per-service model.
// For each proposal, backfill contributors / last_edited_by / last_edited_at.
// If a service has >1 proposal (a collision), KEEP the most advanced one
// (advancementRank — approved wins), fold every doc's lead+contributors into the
// winner's contributors, and DELETE the losers.
//
// Dry-run by default; pass --apply to write. Run:
//   node --env-file=.env.local scripts/migrate-shared-proposals.mjs           (dry-run)
//   node --env-file=.env.local scripts/migrate-shared-proposals.mjs --apply   (writes prod)
//
// Idempotent: backfills use setIfMissing, so a second run is a no-op on
// already-migrated singletons.

import { createClient } from "@sanity/client";
import { advancementRank } from "./lib/proposalRank.mjs";

const APPLY = process.argv.includes("--apply");
const rkey = () => Math.random().toString(36).slice(2, 9);

const token = APPLY ? process.env.SANITY_WRITE_TOKEN : process.env.SANITY_API_READ_TOKEN;
if (!token) {
  console.error(`Missing ${APPLY ? "SANITY_WRITE_TOKEN" : "SANITY_API_READ_TOKEN"} in env.`);
  process.exit(1);
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  token,
  useCdn: false,
});

console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — shared-proposal migration\n`);

const rows = await client.fetch(`*[_type=="setlistProposal"]{
  _id, status, submitted_at, _updatedAt,
  "svc": service_ref._ref,
  "lead": lead._ref,
  "contributorRefs": contributors[].person._ref
}`);

console.log(`Found ${rows.length} proposals across ${new Set(rows.map(r => r.svc)).size} distinct services.`);

// Group by service to detect collisions.
const bySvc = new Map();
for (const r of rows) {
  if (!r.svc) { console.warn(`  ! ${r._id} has no service_ref — skipping`); continue; }
  if (!bySvc.has(r.svc)) bySvc.set(r.svc, []);
  bySvc.get(r.svc).push(r);
}

let backfills = 0, deletes = 0, collisions = 0;

for (const [svc, group] of bySvc) {
  // Winner = most advanced; tie-break by newest submitted_at/_updatedAt.
  const sorted = [...group].sort((a, b) => {
    const r = advancementRank(b.status) - advancementRank(a.status);
    if (r !== 0) return r;
    return (b.submitted_at ?? b._updatedAt ?? "").localeCompare(a.submitted_at ?? a._updatedAt ?? "");
  });
  const winner = sorted[0];
  const losers = sorted.slice(1);

  // Union of every doc's lead + existing contributors → winner's contributors.
  const refs = new Set();
  for (const r of group) {
    if (r.lead) refs.add(r.lead);
    for (const c of (r.contributorRefs ?? [])) if (c) refs.add(c);
  }
  const contributors = [...refs].map(ref => ({
    _type: "contributor", _key: rkey(), person: { _type: "reference", _ref: ref },
  }));

  if (losers.length) {
    collisions++;
    console.log(`  COLLISION svc ${svc}: keep ${winner._id} (${winner.status}); delete ${losers.map(l => `${l._id}(${l.status})`).join(", ")}`);
  } else {
    console.log(`  svc ${svc}: backfill ${winner._id} (${winner.status}) — ${contributors.length} contributor(s)`);
  }

  backfills++;
  deletes += losers.length;

  if (APPLY) {
    let p = client.patch(winner._id);
    // Collision → force the merged union; singleton → setIfMissing (idempotent).
    p = losers.length ? p.set({ contributors }) : p.setIfMissing({ contributors });
    p = p.setIfMissing({
      last_edited_at: winner.submitted_at ?? winner._updatedAt,
      ...(winner.lead ? { last_edited_by: { _type: "reference", _ref: winner.lead } } : {}),
    });
    await p.commit();
    for (const loser of losers) await client.delete(loser._id);
  }
}

console.log(`\n${APPLY ? "Applied" : "Would"}: backfill ${backfills} doc(s), delete ${deletes} loser(s), ${collisions} collision(s).`);
if (!APPLY) console.log("Re-run with --apply to write (prod).\n");
