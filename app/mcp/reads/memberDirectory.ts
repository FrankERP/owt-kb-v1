// app/mcp/reads/memberDirectory.ts — the one `teamMembers` read
// `get_member_availability` needs (P1 step 6, spec I5). `teamMembers` is not a
// protected type (I1 only governs the seven protected service/proposal types),
// but the read still runs on `operationalClient` — imported directly from
// `sanity/lib/operationalClient`, as every MCP Sanity read does
// (`mcpSanityClients.test.ts`).
//
// FILTERED WITH `WORSHIP_AUDIENCE_GROQ_FILTER`, imported from
// `app/ministries.ts` rather than copied: absent, empty or "worship"-containing
// `ministries` counts as worship, no exceptions. Never `WORSHIP_MEMBER_GROQ_FILTER`
// and never a bound `$all`: that filter's `$all` arm is a super-admin
// see-everyone bypass built for the admin member list, and I5 forbids it here
// even though the caller is always a super-admin — a kids-only member's
// availability is never this tool's business, no matter who is asking.
//
// A failed read is `ok: false`, never an empty roster: the caller must refuse,
// not answer "nobody is unavailable" from nothing (spec E1's sibling rule for
// content, not just errors).

import "server-only";

import { WORSHIP_AUDIENCE_GROQ_FILTER } from "@/app/ministries";
import type { BoundQuery } from "@/app/utils/serviceReadQueries";
import { operationalClient } from "@/sanity/lib/operationalClient";

export interface WorshipMemberRow {
  readonly _id: string;
  readonly member_name: string | null;
  readonly alias: string | null;
  readonly memberType: readonly string[] | null;
  readonly disabled: boolean | null;
  readonly unavailableDates: readonly string[] | null;
  readonly unavailabilityNotes: readonly { date: string; note: string }[] | null;
}

/** Exported so the test fixture keys its responder on this exact text, never a hand-copied string. */
export function worshipMemberDirectoryQuery(): BoundQuery {
  return {
    query: `*[_type == "teamMembers" && ${WORSHIP_AUDIENCE_GROQ_FILTER}]{ _id, member_name, alias, memberType, disabled, unavailableDates, unavailabilityNotes }`,
    params: {},
  };
}

export interface MemberDirectoryLookup {
  /** False when the read failed: the caller must refuse, never answer an empty roster. */
  readonly ok: boolean;
  readonly members: readonly WorshipMemberRow[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Every worship-audience `teamMembers` document, in one read. */
export async function loadWorshipMemberDirectory(): Promise<MemberDirectoryLookup> {
  const bound = worshipMemberDirectoryQuery();
  let rows: unknown;
  try {
    rows = await operationalClient.fetch<unknown>(bound.query, bound.params);
  } catch {
    // Never log the error's text: it is Sanity's own (spec E1).
    console.error("[mcp-read] member directory read failed");
    return { ok: false, members: [] };
  }
  const members = (Array.isArray(rows) ? rows : [])
    .filter(isObj)
    .filter((row) => nonEmptyString(row._id)) as unknown as WorshipMemberRow[];
  return { ok: true, members };
}
