import { NextRequest, NextResponse } from "next/server";

import { PHASE_TIMEOUT_MS, probeSmtpPhases } from "@/app/utils/smtpPhases";
import { PROBE_TIMEOUT_MS, probeSmtp } from "@/app/utils/smtpProbe";

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
  // a number has some variance behind it. DATA is issued only for `?data=1`,
  // and only ever to our own mailbox.
  const to = req.nextUrl.searchParams.get("to") ?? undefined;
  const repeat = Math.min(Math.max(Number(req.nextUrl.searchParams.get("repeat") ?? 3), 1), 5);
  // `data=1` is the only path that submits a message, and `probeSmtpPhases`
  // refuses it for any recipient but the sending mailbox itself. `bytes` pads
  // the body, because scan cost tends to track message size and our real
  // notification emails are HTML several kilobytes long — a timing taken on a
  // two-line message would understate them.
  const sendData = req.nextUrl.searchParams.get("data") === "1";
  const bodyBytes = Math.min(Math.max(Number(req.nextUrl.searchParams.get("bytes") ?? 0), 0), 200_000);

  // ADMISSION AGAINST THE WORST CASE, not "has the deadline passed" — the same
  // distinction the sweep had to learn. Each reading may take PHASE_TIMEOUT_MS
  // and `probeSmtp` may take three PROBE_TIMEOUT_MS, so checking only whether
  // the deadline has already passed admits ~60 s of work at 44.9 s and lands
  // past `maxDuration`. That returns NOTHING, under exactly the tarpit
  // condition this route exists to diagnose. Partial readings are the useful
  // answer; a 504 is not.
  //
  // The budget closes: 45 s deadline, readings admitted while 12 s remain, and
  // `probeSmtp` admitted only while 24 s remain — so the worst admitted tail
  // ends at 44 s + 12 s, or 21 s + 24 s, both inside `maxDuration = 60`.
  const deadline = Date.now() + 45_000;
  const phases = [];
  for (let i = 0; i < repeat; i++) {
    if (Date.now() + PHASE_TIMEOUT_MS > deadline) break;
    phases.push(await probeSmtpPhases(to, { sendData, bodyBytes }));
  }

  // `probeSmtp` runs three verifies, so it needs three budgets reserved. When
  // there is no room it is SKIPPED rather than truncated mid-flight — but
  // `redirectTo` is still read and reported, because "is the team's mail being
  // diverted?" must never depend on how much clock was left. It is a
  // `process.env` read and costs nothing.
  const room = Date.now() + 3 * PROBE_TIMEOUT_MS <= deadline;
  const smtp = room
    ? await probeSmtp()
    : { status: "skipped" as const, redirectTo: process.env.EMAIL_REDIRECT_TO?.trim() || null };

  return NextResponse.json({
    ...smtp,
    requestedReadings: repeat,
    // Visible as truncated rather than read as "only this many were requested".
    truncated: phases.length < repeat,
    phases,
  });
}
