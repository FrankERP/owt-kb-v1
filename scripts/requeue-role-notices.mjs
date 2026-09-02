// scripts/requeue-role-notices.mjs
//
// Re-queue `role` notices for every member assigned to the given service(s), as
// though the service had just been saved.
//
// WHY THIS EXISTS. On 2026-08-06 the notification outbox wedged, and the batch it
// was holding was discharged on 2026-08-07 with one confirmed delivery out of
// seventeen — stage 8 consumes whether or not stage 7 reached anyone, so the
// notices were spent rather than retried. The people assigned to the Sunday
// services were never told. This puts those notices back.
//
// It does NOT hand-build documents. `outboxId`, `buildUpsert`,
// `normalizeStoredSeats`, `storedRoleDate` and `rolesForMember` are the SAME
// helpers `queueRoleNotices` uses in `serviceMutationSideEffects.ts`, so a notice
// minted here is shaped exactly like one minted by a real save. Hand-rolling the
// shape is how a re-notify sends the wrong thing to the whole team.
//
// RUN IT WITH `tsx`, NOT BARE `node`. It imports helpers from `app/utils/*.ts`
// so that a notice minted here cannot drift from one minted by a real save, and
// those modules import each other with extensionless specifiers that Node's ESM
// loader refuses. Bare `node` fails at import with ERR_MODULE_NOT_FOUND before
// argv is even read — during an incident, holding the only recovery tool.
//
//   Dry run (default — writes nothing):
//     npx tsx --env-file=.env.local scripts/requeue-role-notices.mjs <roleId> [...]
//   Apply:
//     npx tsx --env-file=.env.local scripts/requeue-role-notices.mjs <roleId> --apply
//
// `before.beforeRoles` is EMPTY for every member by default: from the
// notification system's point of view these people have never been introduced to
// this service, which is true for the incident above — that is the whole problem.
// The classifier then describes the assignment itself rather than a diff against it.
//
// `--before <memberId>=<label>[,<label>]` (repeatable; ONE role id per invocation)
// supplies the snapshot the failed write would have taken for a member, and is
// what makes an EDIT recoverable rather than only a publish. Two cases need it:
//   · a member REMOVED by that edit is no longer in the stored seats, so the
//     default enumeration never names them and they never hear "Ya no participas";
//   · a member whose seat CHANGED would, with an empty snapshot, be re-introduced
//     as newly assigned instead of told they moved.
// The labels are `rolesForMember`'s strings ("Líder", "BGV", "Coro", an
// instrument name, an FOH role) — the same vocabulary the writer snapshots — and
// they are copied verbatim, so a misspelt label renders as-is in the email.
//
// `--only <memberId>[,<memberId>]` (repeatable) narrows the queue to the members
// named, plus every `--before` member. An edit touches a few seats; the members
// it left alone would net out to silence in a real save (before == after) but
// have no snapshot here, so without `--only` they would be re-introduced as
// newly assigned — a duplicate of the publish email they already received.
//
// Both flags added 2026-09-02, when a ten-member Saturday edit queued nothing
// because one member's outbox id digested to a segment Sanity rejects (see
// `outboxId`). The recovery was: the removed lead with `--before`, the moved
// and the added member with `--only`, and nobody else.

import { createClient } from "@sanity/client";

import { buildUpsert, outboxId } from "../app/utils/outboxNotice.ts";
import { normalizeStoredSeats, seatAssignees, storedRoleDate } from "../app/utils/roleWriteRequest.ts";
import { membersToQueue, parseRequeueArgs } from "./lib/requeueArgs.mjs";

let parsed;
try {
  parsed = parseRequeueArgs(process.argv.slice(2));
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(2);
}
const { before: BEFORE, only: ONLY, rest: ARGV } = parsed;

const APPLY = ARGV.includes("--apply");
// `--now` collapses the 15-minute debounce to zero so the batch is due
// immediately. The debounce exists to coalesce a burst of edits into one email;
// there is no burst here, and waiting a quarter of an hour to watch a rehearsal
// flush is the kind of delay that gets a step skipped.
const NOW_FLAG = ARGV.includes("--now");
const roleIds = ARGV.filter((a) => !a.startsWith("--"));

if (!roleIds.length) {
  console.error(
    "usage: requeue-role-notices.mjs <roleId> [<roleId>...] [--before <memberId>=<label>[,<label>]]... [--only <memberId>[,<memberId>]]... [--now] [--apply]",
  );
  process.exit(2);
}
// A `--before` snapshot or an `--only` set names members of ONE service; applying
// the same set to several roles would snapshot seats they never held elsewhere.
if ((BEFORE.size || ONLY) && roleIds.length > 1) {
  console.error("--before and --only take exactly one role id per invocation");
  process.exit(2);
}

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
// The repo's write token is `SANITY_WRITE_TOKEN` (see `sanity/lib/serverClient`).
const token = process.env.SANITY_WRITE_TOKEN;
if (!projectId || !dataset || !token) {
  console.error("missing NEXT_PUBLIC_SANITY_PROJECT_ID / _DATASET / SANITY_WRITE_TOKEN");
  process.exit(2);
}

const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", token, useCdn: false });

const ROLE_QUERY = `*[_id == $id][0]{
  _id, _type, published, week, date, Lead, BGVs, Chorus, instruments, foh_team
}`;

const now = new Date();
let planned = 0;

for (const roleId of roleIds) {
  const role = await client.fetch(ROLE_QUERY, { id: roleId });
  if (!role) {
    console.error(`SKIP ${roleId}: no such document`);
    continue;
  }
  // Same guard as the real writer: a draft service is admin-only and publishing
  // is what introduces it, so it must not notify.
  if (role.published === false) {
    console.error(`SKIP ${roleId}: published === false (a draft notifies nobody)`);
    continue;
  }
  const serviceDate = storedRoleDate(role);
  if (!serviceDate) {
    console.error(`SKIP ${roleId}: no service date`);
    continue;
  }

  const seats = normalizeStoredSeats(role);
  // `seatAssignees`, not a local re-implementation: the five member-referencing
  // seats are an invariant, and a copy here would silently miss a sixth.
  // The UNION with `--before` members mirrors `queueRoleNotices`: a member removed
  // by the edit is in the before-set only, and is exactly who the default
  // enumeration would otherwise drop. `--only` narrows the stored side.
  const members = membersToQueue(seatAssignees(seats), ONLY, BEFORE);
  console.log(`\n${roleId}  ${role._type}  ${serviceDate}  → ${members.length} member(s)`);

  for (const memberId of members) {
    const subjectKey = `${memberId}__${roleId}`;
    // Empty unless `--before` named this member — see the header note.
    const beforeRoles = BEFORE.get(memberId) ?? [];
    const { createIfNotExists, patchSet } = buildUpsert(
      {
        kind: "role",
        subjectKey,
        memberId,
        roleId,
        proposalId: null,
        serviceDate,
        roleType: role._type,
        before: { beforeRoles },
        knownRecipients: [memberId],
      },
      now,
      NOW_FLAG ? { debounceMs: 0 } : {},
    );
    planned++;
    const snapshot = beforeRoles.length ? `  before=${beforeRoles.join(",")}` : "";
    console.log(`  ${APPLY ? "queue" : "would queue"} ${outboxId("role", subjectKey)}  member=${memberId}${snapshot}`);
    if (APPLY) {
      await client
        .transaction()
        .createIfNotExists(createIfNotExists)
        .patch(createIfNotExists._id, (p) => p.set(patchSet))
        .commit();
    }
  }
}

console.log(
  `\n${APPLY ? "QUEUED" : "DRY RUN — would queue"} ${planned} notice(s). ` +
    (APPLY ? "" : "Re-run with --apply to write."),
);
