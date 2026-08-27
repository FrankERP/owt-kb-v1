// Child A, Phase D step 9 — the post-release reconcile.
//
//   node --env-file=.env.local scripts/reconcile-proposal-messages.mjs
//
// READ-ONLY. It never writes; it reports. Exit 1 means a human has to look.
//
// WHAT IT IS FOR, and why it is not redundant with step 5. Step 5 verified the
// migration the moment it finished. Step 9 runs AFTER the production release,
// and its job is the window between them: from the `--apply` (step 4) until
// production actually served the new code (step 8), production was running OLD
// code, so a lead saving a proposal in that window wrote `lead_notes` directly
// and minted no message. §6 removed the render blocks that used to show those
// fields, so such a note is now INVISIBLE to admins — stored, unread, and
// unreported by anything else.
//
// THREE RULES THAT LOOK LIKE DETAILS AND ARE NOT:
//
// 1. **Compare TRIMMED.** The migration stores a trimmed body while the legacy
//    field keeps whatever was typed, and 4 of the 8 migrated documents carry
//    surrounding whitespace. A raw comparison flags half the set as damaged the
//    moment the `--apply` finishes, and its prescribed repair is an
//    irreversible, visible top-up.
//
// 2. **Compare against ANY message in that direction, not just the newest, and
//    not against `migleadnote01` specifically.** From step 8 the mirror is live,
//    so `lead_notes` legitimately holds the newest POSTED message. A lead who
//    posts between the release and this run would otherwise read as a mismatch
//    and draw a permanent top-up for a note that is not missing at all.
//
// 3. **Compare emptiness too.** A field blanked to `""` would be skipped
//    entirely by a non-empty-only comparison, which is the one shape that hides
//    a real loss.
//
// THE REPAIR, when this reports a problem, is a consented top-up with a distinct
// `_key` (`topup<n>`) — never a second run of the migration. A top-up is
// irreversible and visible: it lands at the END of the thread carrying today's
// timestamp, so it reads to both the lead and the admins as a fresh repeat of an
// old note. Never top up a difference that is whitespace only.

import { createClient } from "@sanity/client";

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-01-01",
  token: process.env.SANITY_API_READ_TOKEN,
  useCdn: false,
  perspective: "published",
});

if (!process.env.SANITY_API_READ_TOKEN) {
  console.error("Missing SANITY_API_READ_TOKEN in env.");
  process.exit(1);
}

const PAIRS = [
  ["lead_notes", "lead_note"],
  ["admin_notes", "admin_change_request"],
];

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

const rows = await client.fetch(`*[_type == "setlistProposal"] | order(service_date asc) {
  _id, service_date, status, lead_notes, admin_notes,
  "msgs": messages[]{ _key, kind, body, at }
}`);

console.log(`\nRECONCILE — ${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}/${process.env.NEXT_PUBLIC_SANITY_DATASET}`);
console.log(`Read ${rows.length} published proposal(s). READ-ONLY.\n`);

const problems = [];
const notes = [];
let whitespaceBaseline = 0;

for (const row of rows) {
  const msgs = Array.isArray(row.msgs) ? row.msgs : [];
  for (const [field, kind] of PAIRS) {
    const raw = row[field];
    const legacy = trimmed(raw);
    const sameKind = msgs.filter((m) => m?.kind === kind);

    if (!legacy) {
      // Rule 3. An empty field with messages is normal after the release (the
      // mirror only writes on a post); an empty field is only alarming if we
      // expected content, which we cannot know from here. Reported, not failed.
      if (sameKind.length) {
        notes.push(`${row._id} · ${field}: empty, ${sameKind.length} ${kind} message(s) present`);
      }
      continue;
    }

    if (!sameKind.length) {
      // The shape §6 makes invisible.
      problems.push(
        `${row._id} · ${field}: NON-EMPTY with NO ${kind} message. ` +
          `Stored but unrenderable — a write from old production code inside the step 4→8 window.`,
      );
      continue;
    }

    // Rule 2: any message in that direction, not only the newest.
    const carried = sameKind.some((m) => trimmed(m.body) === legacy);
    if (!carried) {
      problems.push(
        `${row._id} · ${field}: no ${kind} message carries the legacy text (${sameKind.length} present).`,
      );
    } else {
      const newest = sameKind[sameKind.length - 1];
      if (trimmed(newest.body) !== legacy) {
        notes.push(
          `${row._id} · ${field}: legacy text sits in an OLDER message; the newest differs — ` +
            `a post since the migration. Not a repair case.`,
        );
      }
    }

    // Rule 1: surface the baseline so nobody mistakes it for damage.
    if (raw !== legacy) whitespaceBaseline++;
  }
}

console.log(`Legacy fields with surrounding whitespace : ${whitespaceBaseline}`);
console.log(`  (the migration stores TRIMMED bodies — this is the expected baseline, not damage)\n`);

console.log(`NOTES (${notes.length}) — expected states, no action:`);
for (const n of notes) console.log(`  ${n}`);

console.log(`\nPROBLEMS (${problems.length}):`);
for (const p of problems) console.log(`  ${p}`);

if (problems.length) {
  console.log(
    `\nSTOP. Repair is a CONSENTED top-up with a distinct \`_key\` (topup<n>), never a\n` +
      `second run of the migration. A top-up is irreversible and lands at the end of the\n` +
      `thread with today's timestamp, so it reads as a fresh repeat of an old note.\n`,
  );
} else {
  console.log(
    `\nCLEAN — every non-empty legacy value is carried by a message in its own direction,\n` +
      `compared on TRIMMED values.\n`,
  );
}

process.exitCode = problems.length ? 1 : 0;
