// scripts/cleanup-superseded-proposals.mjs
// One-off: delete setlistProposal docs that are NOT approved but belong to a
// service (sunday/saturday date+type, or special service_ref) that already has
// an approved proposal. These are stale duplicates left over from before the
// approve-time cleanup existed. Idempotent. Dry-run by default; pass --apply.
import { createClient } from "@sanity/client";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
  dataset: "production",
  apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const apply = process.argv.includes("--apply");

// Service identity key shared by proposals that target the same service.
function serviceKey(p) {
  if (p.service_type === "special") {
    return p.service_ref_id ? `special|${p.service_ref_id}` : null;
  }
  if ((p.service_type === "sunday" || p.service_type === "saturday") && p.service_date) {
    return `${p.service_type}|${p.service_date}`;
  }
  return null;
}

const proposals = await client.fetch(
  `*[_type == "setlistProposal"]{
    _id, status, service_type, service_date,
    "service_ref_id": service_ref._ref,
    "lead": coalesce(lead->alias, lead->member_name)
  }`
);

// Services that already have an approved proposal.
const approvedKeys = new Set();
for (const p of proposals) {
  if (p.status === "approved") {
    const k = serviceKey(p);
    if (k) approvedKeys.add(k);
  }
}

// Non-approved proposals targeting one of those services → stale duplicates.
const stale = proposals.filter((p) => {
  if (p.status === "approved") return false;
  const k = serviceKey(p);
  return k !== null && approvedKeys.has(k);
});

console.log(`Total proposals: ${proposals.length}`);
console.log(`Services with an approved proposal: ${approvedKeys.size}`);
console.log(`Stale (non-approved for an already-approved service): ${stale.length}`);
for (const p of stale) {
  console.log(`  ${p.service_type} ${p.service_date ?? p.service_ref_id ?? "?"} · ${p.lead ?? "—"} · status=${p.status} · ${p._id}`);
}

if (!apply) {
  console.log("\nDry-run. Re-run with --apply to delete the stale proposals above.");
  process.exit(0);
}

if (stale.length === 0) {
  console.log("\nNothing to delete.");
  process.exit(0);
}

let tx = client.transaction();
for (const p of stale) tx = tx.delete(p._id);
await tx.commit();
console.log(`\nDeleted ${stale.length} stale proposal(s).`);
