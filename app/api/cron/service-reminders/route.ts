import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/sanity/lib/serverClient";
import { sendPush } from "@/app/utils/push";
import { tomorrowDateStr, assignedMemberRefsQuery } from "@/app/utils/notifyTargets";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const day = tomorrowDateStr("America/Mexico_City");
  const roleFilter = `_type in ["sunday_role","saturday_role","special_role"] && (week == $day || date == $day) && published != false`;
  const assigned = await serverClient.fetch<string[]>(
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
