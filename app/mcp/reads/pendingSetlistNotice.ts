// app/mcp/reads/pendingSetlistNotice.ts — the `before` of a `setlist` notice still
// waiting in the outbox for one service (admin parity phase 3, S1, plan §7 A1).
//
// The proposal check forecasts the email an approval would cause. The outbox
// keeps the FIRST `before` of a debounce window (`buildUpsert` uses
// `createIfNotExists`) and the flush picks the audience from that stored
// snapshot, so while a notice is pending it decides «Setlist listo» (the whole
// team) versus «El setlist cambió» — not the live list. Read-only, on
// `operationalClient` (tokened: outbox ids are dotted, so private).

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { outboxId, type OutboxSongRow } from "@/app/utils/outboxNotice";

/** The pending notice's `before` rows, or null when no `setlist` notice is waiting for this service. */
export async function loadPendingSetlistBefore(roleId: string): Promise<OutboxSongRow[] | null> {
  const row = await operationalClient.fetch<{ before?: { beforeSongs?: unknown } } | null>(
    `*[_id == $id][0]{ before }`,
    { id: outboxId("setlist", roleId) },
  );
  if (!row) return null;
  const songs = row.before?.beforeSongs;
  return Array.isArray(songs) ? (songs as OutboxSongRow[]) : [];
}
