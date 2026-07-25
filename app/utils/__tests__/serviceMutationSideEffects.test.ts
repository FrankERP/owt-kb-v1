// Post-commit side effects for the protected service writers (A2 §7).
//
// Every delivery channel is mocked: recipients are asserted, nothing is sent.
// The two questions this file answers are "WHO hears about a committed change?"
// (derived from committed server state, never a client list) and "does a failed
// delivery stay swallowed?" (best-effort at-most-once, never a rollback).

import { beforeEach, describe, expect, it, vi } from "vitest";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the module loads under vitest's node environment.
vi.mock("server-only", () => ({}));

const sendPushMock = vi.fn();
const sendAssignmentEmailsMock = vi.fn();
const sendAssignmentEmailsBatchMock = vi.fn();
const notifyProposalSubmittedMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();
const revalidatePathMock = vi.fn();
const operationalFetch = vi.fn();
const afterCallbacks: (() => unknown)[] = [];

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/app/utils/assignmentEmail", () => ({
  sendAssignmentEmails: (...a: unknown[]) => sendAssignmentEmailsMock(...a),
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
}));
vi.mock("@/app/utils/proposalNotify", () => ({
  notifyProposalSubmitted: (...a: unknown[]) => notifyProposalSubmittedMock(...a),
}));
vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => revalidateServiceViewsMock(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import {
  notifyProposalPending,
  notifyProposalReview,
  notifyRoleAssignments,
  notifyRolePublished,
  notifySetlistSaved,
  proposalReviewRecipients,
  revalidateProposalApproval,
  revalidateRoleMutation,
  revalidateRolePublication,
  revalidateSetlistSave,
  roleCreateNotice,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
import type { NormalizedSeats } from "@/app/utils/roleWriteRequest";

function seats(over: Partial<NormalizedSeats> = {}): NormalizedSeats {
  return {
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
}

/** One member in each of the five seat paths. */
const ALL_FIVE = seats({
  leads: ["mem-lead"],
  bgvs: ["mem-bgv"],
  chorus: ["mem-chorus"],
  instruments: [{ instrument: "Bajo", personId: "mem-inst" }],
  foh: [{ role: "Sonido", personId: "mem-foh" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  operationalFetch.mockReset();
});

// ── Who hears about a role change ───────────────────────────────────────────

describe("roleCreateNotice", () => {
  it("a published create names every initial assignee across all five seat paths", () => {
    const notice = roleCreateNotice({
      published: true,
      seats: ALL_FIVE,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual([
      "mem-lead",
      "mem-bgv",
      "mem-chorus",
      "mem-inst",
      "mem-foh",
    ]);
    expect(notice?.kind).toBe("created");
    expect(notice?.body).toEqual({
      leads: ["mem-lead"],
      bgvs: ["mem-bgv"],
      chorus: ["mem-chorus"],
      instruments: [{ instrument: "Bajo", personId: "mem-inst" }],
      foh: [{ role: "Sonido", personId: "mem-foh" }],
    });
  });

  it("a draft create is silent", () => {
    expect(
      roleCreateNotice({ published: false, seats: ALL_FIVE, type: "sunday_role", date: "2026-08-09" }),
    ).toBeNull();
  });

  it("a published create with no assignees is silent", () => {
    expect(
      roleCreateNotice({ published: true, seats: seats(), type: "special_role", date: "2026-08-09" }),
    ).toBeNull();
  });
});

describe("roleUpdateNotice", () => {
  const before = ["mem-1"];
  const afterSeats = seats({ leads: ["mem-1", "mem-2"], bgvs: ["mem-3"] });

  it("names ONLY the newly added assignees of the destination role", () => {
    const notice = roleUpdateNotice({
      published: true,
      beforeAssignees: before,
      after: afterSeats,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual(["mem-2", "mem-3"]);
    expect(notice?.kind).toBe("updated");
  });

  it("treats a missing published field as grandfathered published", () => {
    const notice = roleUpdateNotice({
      published: undefined,
      beforeAssignees: before,
      after: afterSeats,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual(["mem-2", "mem-3"]);
  });

  it("a draft edit is silent", () => {
    expect(
      roleUpdateNotice({
        published: false,
        beforeAssignees: before,
        after: afterSeats,
        type: "sunday_role",
        date: "2026-08-09",
      }),
    ).toBeNull();
  });

  it("no newly added assignee is silent (a removal or a no-op)", () => {
    expect(
      roleUpdateNotice({
        published: true,
        beforeAssignees: ["mem-1", "mem-2", "mem-3"],
        after: seats({ leads: ["mem-1"] }),
        type: "sunday_role",
        date: "2026-08-09",
      }),
    ).toBeNull();
  });
});

// ── Fan-out ─────────────────────────────────────────────────────────────────

describe("notifyRoleAssignments", () => {
  const noticeA = roleCreateNotice({
    published: true,
    seats: seats({ leads: ["mem-1"] }),
    type: "sunday_role",
    date: "2026-08-09",
  });
  const noticeB = roleUpdateNotice({
    published: true,
    beforeAssignees: [],
    after: seats({ chorus: ["mem-9"] }),
    type: "saturday_role",
    date: "2026-08-08",
  });

  it("registers ONE deferred attempt for the whole batch, pushing and emailing per role", async () => {
    notifyRoleAssignments([noticeA, noticeB]);
    expect(afterCallbacks).toHaveLength(1);
    expect(sendPushMock).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[0]).toEqual([
      ["mem-1"],
      "assignments",
      { title: "Nuevo servicio asignado", body: "Te asignaron para el 2026-08-09.", path: "/me" },
    ]);
    expect(sendPushMock.mock.calls[1]).toEqual([
      ["mem-9"],
      "assignments",
      { title: "Servicio actualizado", body: "Te asignaron para el 2026-08-08.", path: "/me" },
    ]);
    expect(sendAssignmentEmailsMock).toHaveBeenCalledTimes(2);
    expect(sendAssignmentEmailsMock.mock.calls[0][0]).toEqual(["mem-1"]);
    expect(sendAssignmentEmailsMock.mock.calls[0][1]).toMatchObject({
      type: "sunday_role",
      date: "2026-08-09",
    });
  });

  it("stays entirely silent for no notices, nulls, or empty recipients", () => {
    notifyRoleAssignments([]);
    notifyRoleAssignments([null, null]);
    notifyRoleAssignments([
      { recipients: [], type: "sunday_role", date: "2026-08-09", body: {}, kind: "updated" },
    ]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("swallows a failing delivery and still attempts the rest", async () => {
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    notifyRoleAssignments([noticeA, noticeB]);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    // The failed push did not abort the batch.
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendAssignmentEmailsMock).toHaveBeenCalledTimes(2);
  });
});

describe("notifyRolePublished", () => {
  const services = [
    { recipients: ["mem-1"], type: "sunday_role" as const, date: "2026-08-09", body: { leads: ["mem-1"] } },
    { recipients: ["mem-9"], type: "saturday_role" as const, date: "2026-08-08", body: { chorus: ["mem-9"] } },
  ];

  it("pushes to every current assignee per service and sends ONE consolidated email batch", async () => {
    notifyRolePublished(services);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[1][0]).toEqual(["mem-9"]);
    expect(sendAssignmentEmailsBatchMock).toHaveBeenCalledTimes(1);
    expect(sendAssignmentEmailsBatchMock.mock.calls[0][0]).toEqual([
      { type: "sunday_role", date: "2026-08-09", body: { leads: ["mem-1"] } },
      { type: "saturday_role", date: "2026-08-08", body: { chorus: ["mem-9"] } },
    ]);
  });

  it("an unpublish or an empty transition batch is silent", () => {
    notifyRolePublished([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("swallows a failing batch email", async () => {
    sendAssignmentEmailsBatchMock.mockRejectedValueOnce(new Error("smtp down"));
    notifyRolePublished(services);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  });
});

// ── Setlist audience ────────────────────────────────────────────────────────

describe("notifySetlistSaved", () => {
  it("uses the setlistRecipientIds audience derived from committed server state", async () => {
    operationalFetch
      .mockResolvedValueOnce([
        { _id: "mem-all" },
        { _id: "mem-assigned", setlist: "assigned" },
        { _id: "mem-elsewhere", setlist: "assigned" },
        { _id: "mem-off", setlist: "off" },
      ])
      .mockResolvedValueOnce(["mem-assigned"]);
    await notifySetlistSaved("2026-08-09");
    expect(sendPushMock).toHaveBeenCalledWith(
      ["mem-all", "mem-assigned"],
      "setlist",
      expect.objectContaining({ path: "/" }),
    );
    // The assigned-member read covers all five seat paths, bound by week.
    const assignedQuery = String(operationalFetch.mock.calls[1][0]);
    for (const path of [
      "Lead[]._ref",
      "BGVs[]._ref",
      "Chorus[]._ref",
      "instruments[].person._ref",
      "foh_team[].person._ref",
    ]) {
      expect(assignedQuery).toContain(path);
    }
    expect(operationalFetch.mock.calls[1][1]).toEqual({ week: "2026-08-09" });
  });

  it("does not wait on the push, and swallows its rejection (no unhandled rejection)", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-all" }]).mockResolvedValueOnce([]);
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeUndefined();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    // Give the detached rejection handler a turn to run.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("swallows a failed audience read and never throws into the save", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("network"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeUndefined();
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

// ── Proposals ───────────────────────────────────────────────────────────────

describe("notifyProposalPending", () => {
  it("delegates to the existing admin/co-lead + allowlist-aware email fan-out", async () => {
    await notifyProposalPending({
      leadId: "mem-1",
      roleId: "role-1",
      serviceType: "sunday",
      serviceDate: "2026-08-09",
    });
    expect(notifyProposalSubmittedMock).toHaveBeenCalledWith({
      leadId: "mem-1",
      roleId: "role-1",
      serviceType: "sunday",
      serviceDate: "2026-08-09",
    });
  });

  it("swallows a failure", async () => {
    notifyProposalSubmittedMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notifyProposalPending({
        leadId: "mem-1",
        roleId: "role-1",
        serviceType: "special",
        serviceDate: "2026-08-09",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("proposal review recipients", () => {
  const doc = {
    lead: "mem-1",
    contributors: [
      { _key: "a", person: "mem-1" },
      { _key: "b", person: { _ref: "mem-2" } },
      { _key: "c" },
      null,
    ],
  };

  it("is the creator plus every contributor, deduped", () => {
    expect(proposalReviewRecipients(doc)).toEqual(["mem-1", "mem-2"]);
  });

  it("pushes the review outcome to exactly those recipients", async () => {
    await notifyProposalReview(doc, { title: "Propuesta aprobada", body: "ok" });
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1", "mem-2"], "proposals", {
      title: "Propuesta aprobada",
      body: "ok",
      path: "/me",
    });
  });

  it("is silent with no resolvable recipient, and swallows a push failure", async () => {
    await notifyProposalReview({}, { title: "t", body: "b" });
    expect(sendPushMock).not.toHaveBeenCalled();
    sendPushMock.mockImplementationOnce(() => {
      throw new Error("fcm down");
    });
    await expect(notifyProposalReview(doc, { title: "t", body: "b" })).resolves.toBeUndefined();
    // An async rejection is swallowed too, never an unhandled rejection.
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifyProposalReview(doc, { title: "t", body: "b" })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ── Cache revalidation, once per affected batch ─────────────────────────────

describe("revalidation", () => {
  it("a role create/edit/delete/swap/copy batch refreshes service + member views once", () => {
    revalidateRoleMutation();
    expect(revalidateServiceViewsMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/me");
  });

  it("a publish/unpublish batch refreshes the member-facing views once", () => {
    revalidateRolePublication();
    expect(revalidatePathMock.mock.calls.map((c) => c[0])).toEqual(["/", "/schedule", "/me"]);
  });

  it("a setlist save and an approval refresh the service views", () => {
    revalidateSetlistSave();
    revalidateProposalApproval();
    expect(revalidateServiceViewsMock).toHaveBeenCalledTimes(2);
  });
});
