import { serverClient } from "@/sanity/lib/serverClient";

// W9 (ADR-0081; plan `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §5 W9). The
// routes that write a CLIENT-SUPPLIED document id (the song DELETE, the member PATCH/DELETE, the
// member photo, the set-password POST) read the stored document's type first, so an id of any
// other type answers 404 and never reaches a write outside its own commit module — a Jóvenes
// event, above all, is written only by `ministryEventCommit.ts`, under its revision guard.
//
// A read with the server token: an untokened read of a dotted (private) id answers null, which
// here is the safe answer anyway (404).

/** The stored `_type` of `id`, or null when no document has that id. */
export async function storedTypeOf(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || id.length === 0) return null;
  const type = await serverClient.fetch<unknown>(`*[_id == $id][0]._type`, { id });
  return typeof type === "string" ? type : null;
}

/** The stored `_rev` of `id` when it is a document of `type`; null when absent or of another type. */
export async function storedRevisionOfType(id: unknown, type: string): Promise<string | null> {
  if (typeof id !== "string" || id.length === 0) return null;
  const rev = await serverClient.fetch<unknown>(`*[_type == $type && _id == $id][0]._rev`, { id, type });
  return typeof rev === "string" ? rev : null;
}
