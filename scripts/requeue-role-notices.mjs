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
//   Dry run (default — writes nothing):
//     node --env-file=.env.local scripts/requeue-role-notices.mjs <roleId> [...]
//   Apply:
//     node --env-file=.env.local scripts/requeue-role-notices.mjs <roleId> --apply
//
// `before.beforeRoles` is deliberately EMPTY for every member: from the
// notification system's point of view these people have never been introduced to
// this service, which is true — that is the whole problem. The classifier then
// describes the assignment itself rather than a diff against it.

import { createClient } from "@sanity/client";

import { buildUpsert, outboxId } from "../app/utils/outboxNotice.ts";
import { normalizeStoredSeats, storedRoleDate } from "../app/utils/roleWriteRequest.ts";

const APPLY = process.argv.includes("--apply");
// `--now` collapses the 15-minute debounce to zero so the batch is due
// immediately. The debounce exists to coalesce a burst of edits into one email;
// there is no burst here, and waiting a quarter of an hour to watch a rehearsal
// flush is the kind of delay that gets a step skipped.
const NOW_FLAG = process.argv.includes("--now");
const roleIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!roleIds.length) {
  console.error("usage: requeue-role-notices.mjs <roleId> [<roleId>...] [--apply]");
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

/** Every member-referencing seat, via the same normalizer the writers use. */
function assignedMembers(seats) {
  return [
    ...new Set([
      ...(seats.leads ?? []),
      ...(seats.bgvs ?? []),
      ...(seats.chorus ?? []),
      ...(seats.instruments ?? []).map((i) => i.personId),
      ...(seats.foh ?? []).map((f) => f.personId),
    ].filter(Boolean)),
  ];
}

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
  const members = assignedMembers(seats);
  console.log(`\n${roleId}  ${role._type}  ${serviceDate}  → ${members.length} member(s)`);

  for (const memberId of members) {
    const subjectKey = `${memberId}__${roleId}`;
    const { createIfNotExists, patchSet } = buildUpsert(
      {
        kind: "role",
        subjectKey,
        memberId,
        roleId,
        proposalId: null,
        serviceDate,
        roleType: role._type,
        // Empty on purpose — see the header note.
        before: { beforeRoles: [] },
        knownRecipients: [memberId],
      },
      now,
      NOW_FLAG ? { debounceMs: 0 } : {},
    );
    planned++;
    console.log(`  ${APPLY ? "queue" : "would queue"} ${outboxId("role", subjectKey)}  member=${memberId}`);
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
