// app/utils/__tests__/appAdminProposals.test.ts — the native app's admin proposal list and the
// answers of its two write doors (ADR-0091 A-W1): names and `mine` only, co-leads without the lead,
// the special's title, the proposed key falling back to the song's, malformed rows dropped, the
// writers' open-thread rule, `/admin`'s order, and ONE refusal shape.
import { describe, expect, it } from "vitest";
import { appRefusal, appReviewAnswer, buildAppAdminProposals } from "@/app/utils/appAdminProposals";
import type { AdminProposalRow } from "@/app/utils/adminProposalsRead";

const TODAY = "2026-11-27";

function row(over: Partial<AdminProposalRow> = {}): AdminProposalRow {
  return {
    _id: "setlistProposal.a",
    _rev: "r1",
    service_type: "sunday",
    service_date: "2026-11-29",
    status: "pending",
    lead_id: "m7",
    lead_name: "Luis",
    contributors: [],
    messages: [],
    earlier_messages: null,
    songs: [],
    ...over,
  };
}

describe("buildAppAdminProposals", () => {
  it("names people and computes `mine`, never sending a member id", () => {
    const { proposals } = buildAppAdminProposals(
      [
        row({
          contributors: [{ id: "m7", name: "Luis" }, { id: "m8", name: "Sara" }, { id: "m9", name: null }],
          messages: [{ _key: "k1", author: "m1", author_name: "Frank", body: "Hola", at: "2026-11-27T10:00:00Z" }],
          earlier_messages: [{ author: "m2", author_name: "Ana", body: "Antes" }],
        }),
      ],
      "m1",
      TODAY,
    );
    const p = proposals[0];
    expect(p.leadName).toBe("Luis");
    expect(p.coLeads).toEqual(["Sara"]);
    expect(p.messages).toEqual([expect.objectContaining({ key: "k1", authorName: "Frank", mine: true })]);
    expect(p.earlierMessages).toEqual([expect.objectContaining({ key: "s0", authorName: "Ana", mine: false })]);
    const text = JSON.stringify(proposals);
    for (const id of ["m1", "m2", "m7", "m8"]) expect(text).not.toContain(`"${id}"`);
  });

  it("titles a weekend by its day and a special by its folded name or the fallback", () => {
    const { proposals } = buildAppAdminProposals(
      [
        row({ _id: "a", service_type: "saturday", service_date: "2026-11-28" }),
        row({ _id: "b", service_type: "special", service_date: "2026-11-30", service_name: "  Noche   de alabanza " }),
        row({ _id: "c", service_type: "special", service_date: "2026-12-01", service_name: null }),
      ],
      "m1",
      TODAY,
    );
    expect(proposals.map((p) => p.service.title)).toEqual(["Sábado", "Noche de alabanza", "Servicio especial"]);
  });

  it("shows the proposed key, else the song's; drops a row with no song; titles a deleted song", () => {
    const { proposals } = buildAppAdminProposals(
      [
        row({
          songs: [
            { song_id: "s1", title: "Way Maker", author: "Sinach", key: "E", play_key: "D", medley_tag: "A" },
            { song_id: "s2", title: "Gracia", key: "G", play_key: "", medley_tag: "" },
            { song_id: null, title: "huérfana" },
            { song_id: "s3", title: null, key: null },
          ],
        }),
      ],
      "m1",
      TODAY,
    );
    expect(proposals[0].songs).toEqual([
      { songId: "s1", title: "Way Maker", author: "Sinach", key: "E", playKey: "D", medleyTag: "A" },
      { songId: "s2", title: "Gracia", author: null, key: "G", playKey: "G", medleyTag: null },
      { songId: "s3", title: "Canción sin título", author: null, key: null, playKey: "", medleyTag: null },
    ]);
  });

  it("drops a row without id, revision, a known status, kind or date", () => {
    const { proposals } = buildAppAdminProposals(
      [row({ _id: null }), row({ _rev: "" }), row({ status: "weird" }), row({ service_type: "x" }), row({ service_date: "soon" }), row()],
      "m1",
      TODAY,
    );
    expect(proposals).toHaveLength(1);
  });

  it("opens the thread from today on, as the writers do", () => {
    const { proposals } = buildAppAdminProposals(
      [row({ _id: "past", service_date: "2026-11-26" }), row({ _id: "today", service_date: TODAY })],
      "m1",
      TODAY,
    );
    expect(Object.fromEntries(proposals.map((p) => [p.id, p.threadOpen]))).toEqual({ past: false, today: true });
  });

  it("orders as /admin does: status buckets, approved newest first", () => {
    const { proposals } = buildAppAdminProposals(
      [
        row({ _id: "ap1", status: "approved", service_date: "2026-12-01" }),
        row({ _id: "p2", status: "pending", service_date: "2026-12-06" }),
        row({ _id: "ap2", status: "approved", service_date: "2026-12-08" }),
        row({ _id: "p1", status: "pending", service_date: "2026-11-29" }),
      ],
      "m1",
      TODAY,
    );
    const ids = proposals.map((p) => p.id);
    expect(ids.indexOf("p1")).toBeLessThan(ids.indexOf("p2"));
    expect(ids.indexOf("ap2")).toBeLessThan(ids.indexOf("ap1"));
  });
});

describe("appRefusal", () => {
  it("keeps code, conflict and string issues only", () => {
    expect(
      appRefusal({ status: 409, body: { error: "integrity_conflict", message: "x", conflict: true, details: { id: "p", detail: "receipt_build" } } }),
    ).toEqual({ status: 409, body: { error: "integrity_conflict", conflict: true } });
    expect(appRefusal({ status: 400, body: { error: "invalid_request", conflict: false, details: { issues: ["body", 3] } } })).toEqual({
      status: 400,
      body: { error: "invalid_request", conflict: false },
    });
    expect(appRefusal({ status: 404, body: null })).toEqual({ status: 404, body: { error: "error", conflict: false } });
  });
});

describe("appReviewAnswer", () => {
  it("a success keeps status, idempotent and the pastor's-message outcome", () => {
    expect(appReviewAnswer({ status: 200, body: { ok: true, status: "changes_requested", targetKey: "k" } })).toEqual({
      status: 200,
      body: { status: "changes_requested", idempotent: false, pastorMessage: null },
    });
  });

  it("a refusal goes through appRefusal", () => {
    expect(appReviewAnswer({ status: 409, body: { error: "stale_revision", conflict: true, details: { storedRev: "r2" } } })).toEqual({
      status: 409,
      body: { error: "stale_revision", conflict: true },
    });
  });
});
