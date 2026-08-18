// scripts/requeue-setlist-notice.mjs
//
// Re-queue a `setlist` notice for one published service, as though the setlist
// had just been introduced on publish. Use after a lossy flush destroyed a
// setlist fan-out mid-batch.
//
//   Dry run (default):
//     npx tsx --env-file=.env.local scripts/requeue-setlist-notice.mjs <roleId>
//   Apply, due immediately:
//     npx tsx --env-file=.env.local scripts/requeue-setlist-notice.mjs <roleId> --apply --now
//
// `before.beforeSongs` is deliberately EMPTY so every participant gets
// "Setlist listo" — the proper introduction when re-notifying after loss.

import { createClient } from "@sanity/client";

import { buildUpsert, outboxId } from "../app/utils/outboxNotice.ts";
import { normalizeStoredSeats, seatAssignees, storedRoleDate } from "../app/utils/roleWriteRequest.ts";

const APPLY = process.argv.includes("--apply");
const NOW_FLAG = process.argv.includes("--now");
const roleIds = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (!roleIds.length) {
  console.error("usage: requeue-setlist-notice.mjs <roleId> [<roleId>...] [--apply] [--now]");
  process.exit(2);
}

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const token = process.env.SANITY_WRITE_TOKEN;
if (!projectId || !dataset || !token) {
  console.error("missing NEXT_PUBLIC_SANITY_PROJECT_ID / _DATASET / SANITY_WRITE_TOKEN");
  process.exit(2);
}

const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", token, useCdn: false });

const ROLE_QUERY = `*[_id == $id][0]{
  _id, _type, published, week, date, Lead, BGVs, Chorus, instruments, foh_team, songs
}`;

const WEEKEND_SETLIST = { sunday_role: "featuredSongs", saturday_role: "saturdarSongs" };

const now = new Date();
let planned = 0;

for (const roleId of roleIds) {
  const role = await client.fetch(ROLE_QUERY, { id: roleId });
  if (!role) {
    console.error(`SKIP ${roleId}: no such document`);
    continue;
  }
  if (role._type !== "saturday_role" && role._type !== "sunday_role" && role._type !== "special_role") {
    console.error(`SKIP ${roleId}: not a service role (${role._type})`);
    continue;
  }
  if (role.published === false) {
    console.error(`SKIP ${roleId}: published === false`);
    continue;
  }

  const serviceDate = storedRoleDate(role);
  if (!serviceDate) {
    console.error(`SKIP ${roleId}: no service date`);
    continue;
  }

  let songs = role.songs;
  if (role._type !== "special_role") {
    const setlistType = WEEKEND_SETLIST[role._type];
    songs = setlistType
      ? await client.fetch(`*[_type == $t && week == $week][0].songs`, { t: setlistType, week: serviceDate })
      : null;
  }
  if (!Array.isArray(songs) || !songs.length) {
    console.error(`SKIP ${roleId}: no songs on setlist`);
    continue;
  }

  const knownRecipients = seatAssignees(normalizeStoredSeats(role));
  const { createIfNotExists, patchSet } = buildUpsert(
    {
      kind: "setlist",
      subjectKey: roleId,
      memberId: null,
      roleId,
      proposalId: null,
      serviceDate,
      roleType: role._type,
      before: { beforeSongs: [] },
      knownRecipients,
    },
    now,
    NOW_FLAG ? { debounceMs: 0 } : {},
  );

  planned++;
  console.log(
    `\n${roleId}  ${role._type}  ${serviceDate}  → ${knownRecipients.length} participant(s), ${songs.length} song(s)`,
  );
  console.log(`  ${APPLY ? "queue" : "would queue"} ${outboxId("setlist", roleId)}`);
  if (APPLY) {
    await client
      .transaction()
      .createIfNotExists(createIfNotExists)
      .patch(createIfNotExists._id, (p) => p.set(patchSet))
      .commit();
  }
}

console.log(
  `\n${APPLY ? "QUEUED" : "DRY RUN — would queue"} ${planned} setlist notice(s). ` +
    (APPLY ? "" : "Re-run with --apply to write."),
);
