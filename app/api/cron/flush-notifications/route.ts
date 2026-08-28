import { NextRequest, NextResponse } from "next/server";
import { sweepOutbox, type SweepReport } from "@/app/utils/outboxSweep";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

// LAYER 1 of the outbox's three flush triggers (spec §3) — the PRIMARY one, and
// genuinely load-bearing. Vercel Hobby allows one cron per day, so the every-five-
// minutes schedule lives outside Vercel, in `.github/workflows/flush-notifications.yml`,
// which curls this route with `CRON_SECRET`. Layer 2 (the opportunistic sweep in
// a writer's `after()` block) cannot flush the terminal edit of a working session
// and layer 3 is daily, so when this stops, everything is up to 24 hours late —
// which is what the liveness alarm in `/api/cron/service-reminders` watches for.
//
// One sweep can fan out dozens of emails over a pooled SMTP transport whose width is
// `SEND_CONCURRENCY`, so give it room; the sweep's own `NOTIFY_SEND_BUDGET_MS`
// (40 s) is sized to finish inside this.
export const maxDuration = 60;

/**
 * Wall clock for the whole drain loop, inside `maxDuration`. Leaves headroom so
 * the platform does not kill mid-consume on the last round.
 */
export const DRAIN_BUDGET_MS = 55_000;

/** Do not start another round when less than this remains — even a repended tail
 * needs claim + classify + at least one send attempt. */
export const MIN_NEXT_ROUND_MS = 20_000;

/** Hard cap on rounds per invocation — safety against a pathological loop even if
 * time accounting drifts. Five rounds × two recipients covers a Sunday setlist. */
export const MAX_DRAIN_ROUNDS = 5;

export type FlushReport = SweepReport & { rounds: number };

/** Sum numeric sweep fields across rounds; `repended`/`deferred` come from the last. */
export function aggregateFlushReports(rounds: SweepReport[]): FlushReport {
  if (!rounds.length) {
    return {
      claimed: 0, emailed: 0, consumed: 0, deferred: 0,
      unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0, rounds: 0,
    };
  }
  const last = rounds[rounds.length - 1];
  let claimed = 0;
  let emailed = 0;
  let consumed = 0;
  let unserved = 0;
  let lost = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rounds) {
    claimed += r.claimed;
    emailed += r.emailed;
    consumed += r.consumed;
    unserved += r.unserved;
    lost += r.lost;
    // SUMMED, like the other losses — not taken from the last round. A wave
    // throttled in round 1 and a clean round 2 must not net out to zero.
    failed += r.failed;
    skipped += r.skipped;
  }
  return {
    rounds: rounds.length,
    claimed,
    emailed,
    consumed,
    deferred: last.deferred,
    unserved,
    repended: last.repended,
    lost,
    failed,
    skipped,
  };
}

/**
 * Run sweeps back-to-back while work was re-pended and time/round budget remains.
 * Each round is a full `sweepOutbox()` — same pipeline, full budget, no derating.
 */
export async function drainOutbox(opts: {
  now?: () => number;
  sweep?: typeof sweepOutbox;
} = {}): Promise<FlushReport> {
  const now = opts.now ?? Date.now;
  const sweep = opts.sweep ?? sweepOutbox;
  const startedAt = now();
  const rounds: SweepReport[] = [];

  while (rounds.length < MAX_DRAIN_ROUNDS) {
    const report = await sweep();
    rounds.push(report);
    if (report.lost > 0 || report.repended === 0) break;

    const elapsed = now() - startedAt;
    if (elapsed >= DRAIN_BUDGET_MS) break;
    if (DRAIN_BUDGET_MS - elapsed < MIN_NEXT_ROUND_MS) break;
  }

  return aggregateFlushReports(rounds);
}

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

  // Full budget each round; layer 2 alone is derated. When a setlist notice is
  // re-pended because the send stage ran out of clock, drain again in the same
  // invocation instead of waiting for the next GitHub tick — nominally five
  // minutes, measured at a 41-minute median (docs/NOTIFICATIONS.md).
  const report = await drainOutbox();
  return NextResponse.json(report);
}
