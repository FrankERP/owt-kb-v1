import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

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
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.email === "boolean")       patch["notifPrefs.email"]       = body.email;
  if (typeof body.assignments === "boolean") patch["notifPrefs.assignments"] = body.assignments;
  if (typeof body.proposals === "boolean")   patch["notifPrefs.proposals"]   = body.proposals;
  if (typeof body.reminders === "boolean")   patch["notifPrefs.reminders"]   = body.reminders;
  // push.ts reads setlist as "all"/"off" (not a boolean), so map it.
  if (typeof body.setlist === "boolean")     patch["notifPrefs.setlist"]     = body.setlist ? "all" : "off";

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid preference fields" }, { status: 400 });
  }

  const doc = await writeClient
    .patch(session.user.sanityId)
    .setIfMissing({ notifPrefs: {} })
    .set(patch)
    .commit();

  const p = (doc as { notifPrefs?: Record<string, unknown> }).notifPrefs ?? {};
  return NextResponse.json({
    email:       p.email !== false,
    assignments: p.assignments !== false,
    proposals:   p.proposals !== false,
    reminders:   p.reminders !== false,
    setlist:     (p.setlist ?? "all") !== "off",
  });
}
