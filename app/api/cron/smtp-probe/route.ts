import { NextRequest, NextResponse } from "next/server";

import { probeSmtp } from "@/app/utils/smtpProbe";

// WHY THIS ROUTE EXISTS.
//
// On 2026-08-06 the outbox stalled because SMTP sends stopped completing, and it
// took 28 hours and a production incident to establish something the mail path
// should be able to answer on demand: is the server reachable from HERE, and
// where does the time go? Reachability from a laptop proves nothing — the
// question is always about Vercel's egress, and that is a place no local script
// can stand.
//
// It authenticates like the other cron routes and it SENDS NO MAIL: connect,
// greeting, AUTH, QUIT. Nothing is queued, nothing is claimed, no member is
// contacted. That is what makes it safe to run whenever the outbox looks wrong.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Same fail-closed shape as the sibling cron routes: with no secret configured
  // this authorizes nobody rather than letting `undefined === undefined` open a
  // credential-exercising endpoint to the internet.
  const configured = process.env.CRON_SECRET;
  const presented =
    req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
  if (!configured || presented !== configured) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await probeSmtp());
}
