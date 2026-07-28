import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { NOTIFY_PREF_FIELD, wantsNotification, type NotifyKind } from "@/app/utils/notifyPrefs";

const EMAIL_KINDS = Object.keys(NOTIFY_PREF_FIELD) as NotifyKind[];

export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    email?: boolean;
    // Per-category push opt-outs (default on). These mirror the categories
    // push.ts gates on, which previously had no writer route.
    assignments?: boolean;
    proposals?: boolean;
    reminders?: boolean;
    setlist?: boolean;
    // Per-type EMAIL opt-outs. Named `email*` so they never collide with the
    // push categories above (`proposals`/`setlist` exist in both worlds).
    emailAssigned?: boolean;
    emailRemoved?: boolean;
    emailRoleChanged?: boolean;
    emailSetlist?: boolean;
    emailProposals?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.email === "boolean")       patch["notifPrefs.email"]       = body.email;
  if (typeof body.assignments === "boolean") patch["notifPrefs.assignments"] = body.assignments;
  if (typeof body.proposals === "boolean")   patch["notifPrefs.proposals"]   = body.proposals;
  if (typeof body.reminders === "boolean")   patch["notifPrefs.reminders"]   = body.reminders;
  // push.ts reads setlist as "all"/"off" (not a boolean), so map it.
  if (typeof body.setlist === "boolean")     patch["notifPrefs.setlist"]     = body.setlist ? "all" : "off";

  // The five per-type email toggles, keyed off the same map every sender uses.
  for (const kind of EMAIL_KINDS) {
    const field = NOTIFY_PREF_FIELD[kind];
    const value = (body as Record<string, unknown>)[field];
    if (typeof value === "boolean") patch[`notifPrefs.${field}`] = value;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid preference fields" }, { status: 400 });
  }

  const doc = await writeClient
    .patch(session.user.sanityId)
    .setIfMissing({ notifPrefs: {} })
    .set(patch)
    .commit();

  const p = (doc as { notifPrefs?: Record<string, unknown> }).notifPrefs ?? {};
  // The email values are RESOLVED through the shared resolver, never echoed raw:
  // with no data migration the five fields are unset for anyone who opted out of
  // the legacy `email`, and an unset boolean would render as its `true` default —
  // five switches ON for a member receiving nothing.
  const emailPrefs = Object.fromEntries(
    EMAIL_KINDS.map((kind) => [NOTIFY_PREF_FIELD[kind], wantsNotification(p, kind)]),
  );

  return NextResponse.json({
    // `email` is the RAW legacy fallback, echoed for whoever writes it — it is not
    // "does this member get mail". That question is only ever answered per type,
    // by `wantsNotification`, in `emailPrefs` below.
    email:       p.email !== false,
    assignments: p.assignments !== false,
    proposals:   p.proposals !== false,
    reminders:   p.reminders !== false,
    setlist:     (p.setlist ?? "all") !== "off",
    ...emailPrefs,
  });
}
