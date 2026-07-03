// app/utils/__tests__/coLeadProposals.test.ts
import { describe, it, expect } from "vitest";
import { selectCoLeadProposals, type RawLeadProposal } from "../coLeadProposals";

const p = (o: Partial<RawLeadProposal>): RawLeadProposal => ({
  status: "draft", service_ref: "svc1", leadId: "other", leadName: "Ana", ...o,
});

describe("selectCoLeadProposals", () => {
  it("excludes my own proposals", () => {
    const m = selectCoLeadProposals([p({ leadId: "me", leadName: "Yo" })], "me");
    expect(m.size).toBe(0);
  });

  it("surfaces a co-lead's proposal keyed by service", () => {
    const m = selectCoLeadProposals([p({ leadId: "ana", leadName: "Ana", status: "pending" })], "me");
    expect(m.get("svc1")).toEqual({ status: "pending", leadName: "Ana" });
  });

  it("prefers the most actionable status when several co-leads propose on one service", () => {
    const m = selectCoLeadProposals(
      [
        p({ leadId: "ana", leadName: "Ana", status: "draft" }),
        p({ leadId: "beto", leadName: "Beto", status: "pending" }),
      ],
      "me",
    );
    expect(m.get("svc1")).toEqual({ status: "pending", leadName: "Beto" });
  });

  it("keeps a submitted proposal over a later draft regardless of order", () => {
    const m = selectCoLeadProposals(
      [
        p({ leadId: "ana", status: "changes_requested", leadName: "Ana" }),
        p({ leadId: "beto", status: "draft", leadName: "Beto" }),
      ],
      "me",
    );
    expect(m.get("svc1")?.leadName).toBe("Ana");
  });

  it("tracks proposals per service independently", () => {
    const m = selectCoLeadProposals(
      [
        p({ service_ref: "svc1", leadId: "ana", status: "draft", leadName: "Ana" }),
        p({ service_ref: "svc2", leadId: "beto", status: "pending", leadName: "Beto" }),
      ],
      "me",
    );
    expect(m.get("svc1")?.status).toBe("draft");
    expect(m.get("svc2")?.status).toBe("pending");
  });

  it("falls back to a generic name when leadName is missing", () => {
    const m = selectCoLeadProposals([p({ leadId: "ana", leadName: undefined })], "me");
    expect(m.get("svc1")?.leadName).toBe("Tu co-líder");
  });
});
