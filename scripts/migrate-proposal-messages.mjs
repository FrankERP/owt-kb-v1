// scripts/migrate-proposal-messages.mjs
//
// One-shot: fold the single-valued `lead_notes` / `admin_notes` on every
// published `setlistProposal` into the append-only `messages[]` thread
// (Release 2, Child A §Migration). The legacy fields are LEFT IN PLACE — they
// stay a frozen archive and keep feeding the existing notification until
// Child B retires them.
//
// Dry-run by default; pass --apply to write. Run:
//   node --env-file=.env.local scripts/migrate-proposal-messages.mjs           (dry-run)
//   node --env-file=.env.local scripts/migrate-proposal-messages.mjs --apply   (writes prod)
//
// THE --apply HAS RUN — 2026-08-26, Child A Phase D step 4, with explicit
// consent: 8 documents, 10 messages, 0 failures. DO NOT RUN IT AGAIN. What
// follows is the rule it was run under, kept because it is why the guards below
// exist. Originally: it runs at exactly one point, after
// Frank's explicit consent in chat. Nowhere else. Step 9's repair path is a
// consented top-up with a distinct `_key`, never a second run of this script.
//
// Idempotent by construction: the two `_key`s it mints are deterministic, and a
// document already carrying either is skipped rather than re-minted.
//
// Exits non-zero when any document hit the abort path, so a run that needs a
// human cannot be mistaken for a clean one by its exit status alone.

import { createClient } from "@sanity/client";

import { MIGRATION_KEYS, planProposalMessages } from "./lib/proposalMessages.mjs";

const APPLY = process.argv.includes("--apply");

const token = APPLY ? process.env.SANITY_WRITE_TOKEN : process.env.SANITY_API_READ_TOKEN;
if (!token) {
  console.error(`Missing ${APPLY ? "SANITY_WRITE_TOKEN" : "SANITY_API_READ_TOKEN"} in env.`);
  process.exit(1);
}

// `perspective: "published"` AND an explicit drafts filter. There are no draft
// proposals today, but a `raw` perspective would also patch a draft overlay if
// one appeared between now and cutover, and a draft is not a document this
// migration has any business writing.
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
  token,
  useCdn: false,
  perspective: "published",
});

// PROPOSAL_PROJECTION omits every fallback field this mapping needs
// (`last_edited_at`, `submitted_at`, `reviewed_at`, `last_transition`, and the
// two document timestamps), so the script issues its own query.
const QUERY = `*[_type == "setlistProposal" && !(_id in path("drafts.**"))]{
  _id, _rev, _createdAt, _updatedAt,
  status,
  lead_notes, admin_notes,
  "lead": lead._ref,
  last_edited_at, submitted_at, reviewed_at,
  last_transition,
  "messageCount": count(messages),
  "messageKeys": messages[]._key
} | order(_id asc)`;

console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — setlistProposal lead_notes/admin_notes → messages[]`);
console.log(
  `project ${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID} / dataset ${process.env.NEXT_PUBLIC_SANITY_DATASET}\n`,
);

const docs = await client.fetch(QUERY);
console.log(`Fetched ${docs.length} published proposal(s).\n`);

const toPatch = [];
const aborts = [];
const skips = [];
let mintedTotal = 0;
let withLegacyNotes = 0;
let alreadyCarryingMessages = 0;
let carryingMigrationKey = 0;

for (const doc of docs) {
  const plan = planProposalMessages(doc);
  const hasLead = typeof doc.lead_notes === "string" && doc.lead_notes.trim() !== "";
  const hasAdmin = typeof doc.admin_notes === "string" && doc.admin_notes.trim() !== "";

  if (hasLead || hasAdmin) withLegacyNotes++;
  if (plan.existingCount > 0) alreadyCarryingMessages++;
  if (plan.migrationKeysPresent.length > 0) carryingMigrationKey++;

  // The resolved action is printed per document because it is the ONLY thing
  // that decides whether `admin_notes` gets an author, and the decision is
  // permanent — this is the moment it is auditable.
  const notes = [hasLead ? "lead_notes" : null, hasAdmin ? "admin_notes" : null]
    .filter(Boolean)
    .join("+") || "none";
  // The value the MAPPING resolved, never `doc.last_transition?.by ?? …`: `??`
  // lets an empty string through and would print `author=` for a message the
  // mapping correctly minted with no author at all.
  const attribution = hasAdmin
    ? plan.attributing
      ? `author=${plan.adminAuthorId || "(action ok, but `by` absent)"}`
      : "author=ABSENT"
    : "";

  console.log(
    `  ${doc._id}  status=${doc.status ?? "?"}  notes=${notes}  ` +
      `last_transition.action=${plan.action || "—"}  ${attribution}`.trimEnd(),
  );

  if (plan.decision === "abort") {
    aborts.push({ id: doc._id, reason: plan.reason });
    console.log(
      `      ABORT (${plan.reason}) — ${plan.existingCount} stored message(s), keys [${plan.existingKeys.join(", ")}]`,
    );
    continue;
  }
  if (plan.decision === "skip") {
    skips.push(doc._id);
    console.log(`      skip (${plan.reason}) — keys [${plan.migrationKeysPresent.join(", ")}]`);
    continue;
  }
  if (plan.decision === "noop") continue;

  mintedTotal += plan.messages.length;
  toPatch.push({ doc, plan });
  for (const msg of plan.messages) {
    console.log(
      `      + ${msg._key}  ${msg.kind}  author_role=${msg.author_role}  ` +
        `author=${msg.author?._ref ?? "—"}  at=${msg.at}  ${JSON.stringify(msg.body.slice(0, 60))}`,
    );
  }
}

console.log("\n── Counts ──────────────────────────────────────────────────────");
console.log(`  documents with non-empty legacy notes : ${withLegacyNotes}`);
console.log(`  messages those notes imply            : ${mintedTotal}`);
console.log(`  documents already carrying messages[] : ${alreadyCarryingMessages}  (expect 0)`);
console.log(
  `  documents carrying a migration _key   : ${carryingMigrationKey}  (expect 0; keys ${MIGRATION_KEYS.join("/")})`,
);
console.log(`  documents to patch                    : ${toPatch.length}`);
console.log(`  skipped (already migrated)            : ${skips.length}`);
console.log(`  ABORTED                               : ${aborts.length}`);

const revisionAborts = [];

if (APPLY) {
  console.log("\n── Applying ────────────────────────────────────────────────────");
  for (const { doc, plan } of toPatch) {
    try {
      // Assert the exact revision this script READ. Production is live during
      // the cutover and any ordinary save or admin transition moves `_rev`; a
      // mismatch means the note being migrated may already be stale, which is
      // precisely the case a human should look at. Abort that document, report
      // it, continue — never retry.
      await client.patch(doc._id).ifRevisionId(doc._rev).set({ messages: plan.messages }).commit();
      console.log(`  patched ${doc._id} — ${plan.messages.length} message(s)`);
    } catch (err) {
      // NOT necessarily a revision conflict: an expired token, a 5xx, a socket
      // timeout and a rejected reference all land here, and a timeout AFTER the
      // mutation was accepted lands here for a document that WAS written. Print
      // what the error actually was so the operator can tell them apart.
      const detail = [err?.name, err?.statusCode].filter(Boolean).join(" ");
      revisionAborts.push({ id: doc._id, detail, message: err?.message ?? String(err) });
      console.log(
        `  ABORT ${doc._id} — patch failed${detail ? ` [${detail}]` : ""}: ${err?.message ?? err}`,
      );
    }
  }
  console.log(
    `\nApplied ${toPatch.length - revisionAborts.length} of ${toPatch.length} document(s); ` +
      `${revisionAborts.length} failed patch(es).`,
  );
}

if (aborts.length || revisionAborts.length) {
  console.log("\nDocuments needing a human:");
  for (const a of aborts) console.log(`  ${a.id} — ${a.reason}`);
  for (const a of revisionAborts) {
    console.log(`  ${a.id} — patch failed${a.detail ? ` [${a.detail}]` : ""}: ${a.message}`);
  }
  if (revisionAborts.length) {
    console.log(
      "\n  A failed patch does NOT prove the write did not land — a timeout can\n" +
        "  follow an accepted mutation. RE-RUN THE DRY-RUN before any repair: a\n" +
        "  document that was written reports `skip (already_migrated)`, and the\n" +
        "  repair path (a top-up with a distinct `_key`) would duplicate its\n" +
        "  message permanently.",
    );
  }
}

if (!APPLY) console.log("\nRe-run with --apply to write (prod).\n");
else console.log("");

// `process.exitCode`, never `process.exit()`: this log is the ONLY record of an
// irreversible write, and an explicit exit can truncate a buffered stdout.
process.exitCode = aborts.length || revisionAborts.length ? 1 : 0;
