import { NextRequest, NextResponse } from "next/server";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { sendPush } from "@/app/utils/push";
import { tomorrowDateStr, assignedMemberRefsQuery } from "@/app/utils/notifyTargets";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

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
  return NextResponse.json({ day, ...r });
}
