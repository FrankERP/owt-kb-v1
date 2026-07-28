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

  // LAYER 3 of the three flush triggers (spec §3) — the last resort. The same
  // exported sweep layers 1 and 2 call, at the full budget: nothing can sit
  // pending for more than a day even if both other triggers are broken.
  const sweep = await sweepOutbox();

  // The liveness alarm, AFTER the sweep so it measures what is genuinely stuck
  // rather than what this request was about to flush. Past
  // NOTIFY_STALE_ALERT_HOURS it logs one structured error AND emails the
  // super-admins — layer 1 is a single point of failure and a `console.error`
  // here has no consumer (§3).
  const liveness = await reportOutboxLiveness();

  return NextResponse.json({ day, ...r, sweep, liveness });
}
