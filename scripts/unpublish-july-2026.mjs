// scripts/unpublish-july-2026.mjs — set published:false on existing July 2026 services.
import { createClient } from "@sanity/client";

// ── Service Readiness A2 §8: RETIRED WRITER ────────────────────────────────
// This one-shot writer already ran against production and cannot adopt the
// guarded mutation invariant (target lock + creation receipt + exact observed
// revision + dependency policy). It therefore FAILS CLOSED here, before any
// Sanity client is constructed and before any mutation is assembled. See
// scripts/lib/sr-retired-writer.mjs for the replacement path. Everything below
// is kept only as the historical record of what was applied.
import { assertRetiredWriter } from "./lib/sr-retired-writer.mjs";
assertRetiredWriter("unpublish-july-2026", { argv: process.argv.slice(2), env: process.env });
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || "ebb8vcnk",
  dataset: "production", apiVersion: "2024-01-01",
  token: process.env.SANITY_WRITE_TOKEN, useCdn: false,
});
const apply = process.argv.includes("--apply");
const q = `*[_type in ["sunday_role","saturday_role","special_role"]
  && coalesce(week, date) >= "2026-07-01" && coalesce(week, date) < "2026-08-01"]{ _id, _type, "d": coalesce(week,date), published }`;
const docs = await client.fetch(q);
console.log(`July 2026 services: ${docs.length}`);
for (const d of docs) console.log(`  ${d.d} ${d._type} published=${d.published}`);
if (!apply) { console.log("\nDry-run. Re-run with --apply to set published:false."); process.exit(0); }
let tx = client.transaction();
for (const d of docs) tx = tx.patch(d._id, (p) => p.set({ published: false }));
await tx.commit();
console.log(`Set published:false on ${docs.length} services.`);
