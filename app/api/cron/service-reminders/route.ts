import { NextRequest, NextResponse } from "next/server";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { sendPush } from "@/app/utils/push";
import { tomorrowDateStr, assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { reportOutboxLiveness } from "@/app/utils/outboxLiveness";
import { sweepOutbox } from "@/app/utils/outboxSweep";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// The daily cron is the outbox's last-resort flush trigger (§3, Task 11); one
// sweep can fan out dozens of emails, so give it room to finish.
export const maxDuration = 60;

// A3 §3: outbound-delivery evidence emitted anywhere under this handler — including
// its post-commit `after()` fan-out — carries the in-flight verification run's markers.
// An unmarked ordinary request establishes nothing and behaves exactly as before.
export const GET = withVerificationRunContext(getHandler);

async function getHandler(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const day = tomorrowDateStr("America/Mexico_City");
  const roleFilter = `_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day) && published != false`;
  const assigned = await operationalClient.fetch<string[]>(
    assignedMemberRefsQuery(roleFilter),
    { day }
  );
  const r = await sendPush(assigned, "reminders", {
    title: "Recordatorio de servicio",
    body: "Sirves mañana. ¡Prepárate!",
    path: "/me",
  });

  // The liveness alarm, BEFORE this request's sweep — and the order is the whole
  // point of the alarm, not a detail. The failure it exists to catch is layer 1
  // being dead: notices then queue all day, every one passes its one-hour
  // `NOTIFY_MAX_WINDOW_MINUTES` ceiling, and this daily cron's own sweep claims,
  // sends and DELETES them. Measured afterwards the outbox reads empty, the alarm
  // returns idle, and a pipeline delivering everything up to 24 h late looks
  // perfectly healthy forever — precisely the state §3 says must not be silent.
  //
  // Measuring first costs nothing: with layer 1 healthy the hard ceiling on a
  // notice's age is one hour, so nothing legitimately reaches the six-hour
  // threshold and there is no false positive to trade away.
  //
  // Past NOTIFY_STALE_ALERT_HOURS it logs one structured error AND emails the
  // super-admins — layer 1 is a single point of failure and a `console.error`
  // here has no consumer (§3).
  const liveness = await reportOutboxLiveness();

  // LAYER 3 of the three flush triggers (spec §3) — the last resort. The same
  // exported sweep layers 1 and 2 call, at the full budget: nothing can sit
  // pending for more than a day even if both other triggers are broken.
  //
  // WRAPPED, unlike layer 1's route. Parts of the sweep run outside its own
  // try — the due-notices fetch and `resolveRecipients` — so a GROQ or transport
  // error there propagates. Unwrapped it would 500 this route, and the run that
  // 500s is exactly the run where the pipeline is broken in the way the alarm
  // reports. The alarm already ran above, and this keeps that true under any
  // future reordering: ordering and error handling are independent properties.
  //
  // The asymmetry with `/api/cron/flush-notifications` is deliberate: there a
  // throw SHOULD 500, because `curl --fail` turns it into a red Actions run,
  // which is that layer's only signal. Here the caller is Vercel's scheduler and
  // nobody reads the status code.
  let sweep: Awaited<ReturnType<typeof sweepOutbox>> | { error: string };
  try {
    sweep = await sweepOutbox();
  } catch (err) {
    console.error(JSON.stringify({ event: "notify_daily_sweep_failed" }), err);
    sweep = { error: "sweep_failed" };
  }

  return NextResponse.json({ day, ...r, sweep, liveness });
}
