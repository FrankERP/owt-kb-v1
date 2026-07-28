import { NextRequest, NextResponse } from "next/server";
import { sweepOutbox } from "@/app/utils/outboxSweep";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// LAYER 1 of the outbox's three flush triggers (spec §3) — the PRIMARY one, and
// genuinely load-bearing. Vercel Hobby allows one cron per day, so the every-five-
// minutes schedule lives outside Vercel, in `.github/workflows/flush-notifications.yml`,
// which curls this route with `CRON_SECRET`. Layer 2 (the opportunistic sweep in
// a writer's `after()` block) cannot flush the terminal edit of a working session
// and layer 3 is daily, so when this stops, everything is up to 24 hours late —
// which is what the liveness alarm in `/api/cron/service-reminders` watches for.
//
// One sweep can fan out dozens of emails over a pooled SMTP transport with
// `maxConnections: 1`, so give it room; the sweep's own `NOTIFY_SEND_BUDGET_MS`
// (40 s) is sized to finish inside this.
export const maxDuration = 60;

// A3 §3: outbound-delivery evidence emitted anywhere under this handler carries
// the in-flight verification run's markers. An unmarked ordinary request
// establishes nothing and behaves exactly as before. The sweep additionally
// refuses to claim anything at all when delivery is blocked, so a verification
// run cannot mail the team from here.
export const GET = withVerificationRunContext(getHandler);

async function getHandler(req: NextRequest) {
  // The `Authorization: Bearer <CRON_SECRET>` pattern the service-reminders cron
  // already uses. 401 rather than that route's 403: the credential is missing or
  // wrong, which is what 401 means, and no caller of this route depends on 403.
  // FAIL CLOSED — with no secret configured this route authorizes nobody, rather
  // than letting `undefined === undefined` open a public sweep endpoint.
  const configured = process.env.CRON_SECRET;
  const presented =
    req.headers.get("authorization")?.replace("Bearer ", "") || req.nextUrl.searchParams.get("secret");
  if (!configured || presented !== configured) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One exported sweep, three thin callers. This one runs at the FULL budget:
  // it hosts nothing else, so the derating belongs to layer 2 alone.
  const report = await sweepOutbox();
  return NextResponse.json(report);
}
