import { NextResponse } from "next/server";

import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import { writeClient } from "@/sanity/lib/serverClient";
import {
  calendarFeedDocId,
  feedSecret,
  feedUrls,
  hasReadToken,
  parseStoredGeneration,
} from "@/app/utils/calendarFeedToken";

/**
 * POST /api/me/calendar-feed — «Generar un enlace nuevo»: the member revokes every earlier URL of
 * their calendar feed and receives the new ones (spec D2, ADR-0057).
 *
 * Self-write only (the id comes from the session) and refused while impersonating, like
 * `PATCH /api/me/theme`: a super-admin must never reset — or be handed — a member's private link.
 *
 * The counter moves by `createIfNotExists` + `inc` in ONE transaction. `inc` is applied atomically
 * by Content Lake, so two concurrent rotations both advance it and neither earlier URL survives.
 * The URLs this response returns are signed with the generation the transaction itself returned.
 *
 * No `revalidate*`: the counter is per-member credential state that no ISR page renders
 * (`/me/ajustes` is dynamic and reads it fresh).
 */
export async function POST() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.isImpersonating) {
    return NextResponse.json({ error: "No calendar link changes while impersonating" }, { status: 403 });
  }

  const memberId = session.user.sanityId;
  const access = await getMemberAccess(memberId);
  if (!access.ministries.includes("worship")) {
    return NextResponse.json({ error: "Calendar feed is for worship members" }, { status: 403 });
  }

  const secret = feedSecret();
  const origin = canonicalOrigin();
  if (!secret || !hasReadToken() || !origin) {
    return NextResponse.json({ error: "Calendar feed unavailable" }, { status: 503 });
  }

  const _id = calendarFeedDocId(memberId);
  const committed = await writeClient
    .transaction()
    .createIfNotExists({
      _id,
      _type: "calendarFeed",
      member: { _type: "reference", _ref: memberId, _weak: true },
      generation: 0,
    })
    .patch(_id, (p) => p.inc({ generation: 1 }).set({ rotatedAt: new Date().toISOString() }))
    .commit({ returnDocuments: true });

  // The generation this transaction produced, from its own result — not a follow-up read, which
  // could lag behind a concurrent rotation and hand back a URL that is already revoked.
  const docs = (Array.isArray(committed) ? committed : []) as Array<{ _id?: string; generation?: unknown }>;
  // Max, not first: the result may list the document once per mutation (the create's 0, then the
  // patch's increment).
  const generation = Math.max(0, ...docs.filter((d) => d?._id === _id).map((d) => parseStoredGeneration(d.generation) ?? 0));
  if (generation < 1) {
    return NextResponse.json({ error: "Calendar feed unavailable" }, { status: 503 });
  }
  return NextResponse.json({ urls: feedUrls(origin, memberId, generation, secret) });
}
