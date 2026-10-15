import { NextRequest } from "next/server";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { serverClient } from "@/sanity/lib/serverClient";
import { normalizeMinistries } from "@/app/ministries";
import { buildICS } from "@/app/utils/ics";
import { canonicalOrigin } from "@/app/mcp/oauth/origin";
import {
  buildFeedEvents,
  calendarFeedQuery,
  feedCalendarName,
  feedScopeFromSearch,
  feedWindow,
  isCanonicalFeedSearch,
  type FeedData,
} from "@/app/utils/calendarFeed";
import {
  FEED_TOKEN_RE,
  calendarFeedDocId,
  feedSecret,
  hasReadToken,
  parseStoredGeneration,
  parseUrlGeneration,
  stripIcsSuffix,
  verifyFeedToken,
} from "@/app/utils/calendarFeedToken";

/**
 * GET /api/calendar/<memberId>/<generation>/<token>[.ics][?solo=mios] — a member's calendar
 * subscription (docs/superpowers/specs/2026-10-15-member-calendar-feed-design.md, ADR-0057).
 *
 * PUBLIC: calendar apps (Google's servers, iOS) fetch it with no session, so it is excluded from
 * the `proxy.ts` matcher and this handler is its own gate. The order is the contract (D3):
 *
 *   secret + read token configured → shapes → HMAC (NO I/O) → one combined read
 *   (member + stored generation) → active, in worship, generation current → schedule read.
 *
 * A caller without a valid signature costs one HMAC and zero Sanity requests — the dataset is on
 * the Free plan and shared with the production app. Every refusal after the configuration checks
 * is the same 404.
 *
 * `getMemberAccess` is deliberately not used: its cache is keyed by the caller's id and never
 * evicted, and the feed needs a fresh answer anyway.
 */
export const dynamic = "force-dynamic";

const plain = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
const NOT_FOUND = () => plain("Not found", 404);
const UNAVAILABLE = () => plain("Unavailable", 503);

type Gate = {
  member: { disabled?: boolean | null; ministries?: unknown } | null;
  generation?: unknown;
} | null;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string; generation: string; token: string }> },
) {
  const secret = feedSecret();
  if (!secret || !hasReadToken()) return UNAVAILABLE();

  const { memberId, generation: rawGeneration, token: rawToken } = await params;
  const generation = parseUrlGeneration(rawGeneration);
  const token = stripIcsSuffix(rawToken ?? "");
  // ONE spelling per URL: the `.ics` suffix is required and the query is empty or exactly
  // `?solo=mios`. The edge cache keys on the full URL, so any other spelling would be a free way
  // for a URL holder to bypass it and spend uncached Sanity reads (spec D5 budget).
  if (!rawToken?.endsWith(".ics") || !isCanonicalFeedSearch(req.nextUrl.search)) return NOT_FOUND();
  if (!memberId || generation === null || !FEED_TOKEN_RE.test(token)) return NOT_FOUND();
  if (!verifyFeedToken(secret, memberId, generation, token)) return NOT_FOUND();

  let gate: Gate;
  try {
    gate = await serverClient.fetch<Gate>(
      `{
        "member": *[_type == "teamMembers" && _id == $id][0]{ disabled, ministries },
        "generation": *[_id == $feedId][0].generation
      }`,
      { id: memberId, feedId: calendarFeedDocId(memberId) },
    );
  } catch {
    return UNAVAILABLE();
  }
  const member = gate?.member;
  if (!member || member.disabled === true) return NOT_FOUND();
  if (!normalizeMinistries(member.ministries).includes("worship")) return NOT_FOUND();
  const stored = parseStoredGeneration(gate?.generation);
  if (stored === null) return UNAVAILABLE(); // a corrupt counter is refused, never read as 0
  if (stored !== generation) return NOT_FOUND();

  const scope = feedScopeFromSearch(req.nextUrl.searchParams);
  const { from, to } = feedWindow();
  let data: FeedData;
  try {
    data = await operationalClient.fetch<FeedData>(calendarFeedQuery(scope), { from, to, id: memberId });
  } catch {
    return UNAVAILABLE();
  }
  const ics = buildICS(buildFeedEvents(data, canonicalOrigin() ?? ""), feedCalendarName(scope), {
    uidDomain: "owt-backstage",
    refreshMinutes: 180,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="owt.ics"',
      // Browsers and shared proxies: private. Vercel's edge: one hour, keyed by the full secret
      // URL (one spelling per URL, enforced above) — so a URL costs at most 24 uncached reads a
      // day, and a rotation takes effect within the hour (spec D5, post-approval change 2).
      "Cache-Control": "private, max-age=300",
      "Vercel-CDN-Cache-Control": "max-age=3600",
    },
  });
}
