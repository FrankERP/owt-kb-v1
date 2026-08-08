import { NextRequest, NextResponse } from "next/server";

import { probeSmtpPhases } from "@/app/utils/smtpPhases";
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
// It authenticates like the other cron routes. By default it SENDS NO MAIL:
// connect, greeting, AUTH, RCPT TO, QUIT. Nothing is queued, nothing is claimed,
// no member is contacted — which is what makes it safe whenever the outbox looks
// wrong. The ONE exception is `?data=1`, which submits a real message so that
// content-scanning time can be measured instead of inferred; it is refused for
// every recipient except our own sending mailbox, before a socket is opened.
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

  // Per-command timings, repeated, because the ~13 s figure that drove three
  // deploys was inferred by subtraction from ONE successful send. `?to=` picks
  // whose address RCPT TO asks about; `?repeat=` takes more than one reading so
  // a number has some variance behind it. DATA is never issued on any path.
  const to = req.nextUrl.searchParams.get("to") ?? undefined;
  const repeat = Math.min(Math.max(Number(req.nextUrl.searchParams.get("repeat") ?? 3), 1), 5);
  // `data=1` is the only path that submits a message, and `probeSmtpPhases`
  // refuses it for any recipient but the sending mailbox itself. `bytes` pads
  // the body, because scan cost tends to track message size and our real
  // notification emails are HTML several kilobytes long — a timing taken on a
  // two-line message would understate them.
  const sendData = req.nextUrl.searchParams.get("data") === "1";
  const bodyBytes = Math.min(Math.max(Number(req.nextUrl.searchParams.get("bytes") ?? 0), 0), 200_000);

  // A WHOLE-ROUTE DEADLINE, not just a per-phase one. Each reading is bounded
  // individually, but `repeat` of them plus `probeSmtp`'s three verifies are
  // bounded only in sum — at the default that is 120 s of worst case against
  // `maxDuration = 60`. The condition that produces the worst case is a
  // tarpitting server, which is precisely what this route exists to diagnose, so
  // without this the probe returns NOTHING exactly when it is needed. Partial
  // readings are the useful answer here; a 504 is not.
  const deadline = Date.now() + 45_000;
  const phases = [];
  for (let i = 0; i < repeat; i++) {
    if (Date.now() >= deadline) break;
    phases.push(await probeSmtpPhases(to, { sendData, bodyBytes }));
  }

  // Reported even when the phase walk used the whole budget, so a truncated run
  // is visible as truncated rather than read as "only this many were requested".
  const truncated = phases.length < repeat;
  return NextResponse.json({
    ...(Date.now() < deadline ? await probeSmtp() : { status: "ok" as const }),
    requestedReadings: repeat,
    truncated,
    phases,
  });
}
