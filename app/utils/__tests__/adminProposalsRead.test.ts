// app/utils/__tests__/adminProposalsRead.test.ts — the admin list read moved out of
// `GET /api/admin/proposals` (A-W1 D2): the web query is the route's old string byte for byte, and
// the app's read filters to the queue plus today-or-later and adds only the special's name.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fetch = vi.fn();
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: (...a: unknown[]) => fetch(...a) } }));

import { THREAD_MESSAGES } from "@/app/utils/proposalMessageRead";
import { serviceThreadMessagesOf } from "@/app/utils/serviceThread";
import { readAdminProposals, readAdminProposalsForApp } from "@/app/utils/adminProposalsRead";

// The literal the route sent before the move, copied from it.
const BEFORE = `
    *[_type == "setlistProposal"] | order(service_date asc) {
      _id,
      _rev,
      service_type,
      service_date,
      status,
      lead_notes,
      team_notes,
      pastor_message,
      admin_notes,
      submitted_at,
      reviewed_at,
      approval_receipt,
      last_transition,
      "service_ref": service_ref._ref,
      "lead_name": coalesce(lead->alias, lead->member_name),
      ${THREAD_MESSAGES},
      "earlier_messages": ${serviceThreadMessagesOf("^.service_ref._ref")},
      "lead_id": lead->_id,
      "contributors": contributors[]{ "id": person->_id, "name": coalesce(person->alias, person->member_name) },
      songs[] {
        _key,
        play_key,
        medley_tag,
        "song_id": song._ref,
        "title": song->title,
        "author": song->author,
        "key": song->key
      }
    }
  `;

beforeEach(() => fetch.mockReset().mockResolvedValue([]));

describe("adminProposalsRead", () => {
  it("sends the web route's query unchanged", async () => {
    await readAdminProposals();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(BEFORE);
    expect(fetch.mock.calls[0]).toHaveLength(1);
  });

  it("filters the app's read to the queue plus today or later, with the special's name", async () => {
    await readAdminProposalsForApp("2026-11-27");
    const [query, params] = fetch.mock.calls[0];
    expect(params).toEqual({ today: "2026-11-27" });
    expect(query).toContain(
      '*[_type == "setlistProposal" && (status in ["pending", "changes_requested"] || service_date >= $today)] | order(service_date asc)',
    );
    expect(query).toContain('"service_name": service_ref->service_name');
    // Same fields as the web's projection.
    expect(query).toContain(THREAD_MESSAGES);
    expect(query).toContain(serviceThreadMessagesOf("^.service_ref._ref"));
  });

  it("answers [] for a null read", async () => {
    fetch.mockResolvedValue(null);
    expect(await readAdminProposalsForApp("2026-11-27")).toEqual([]);
  });
});
