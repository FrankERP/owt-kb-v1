// Pure request parsing, approval receipts and transition fingerprints for the
// protected proposal writers (Service Readiness A2 §6).

import { describe, expect, it } from "vitest";
import {
  APPROVAL_APP_MARKER,
  APPROVAL_RECEIPT_VERSION,
  approvalInputFingerprint,
  buildApprovalReceipt,
  buildTransitionRecord,
  decideApprovalReceipt,
  decideTransitionRetry,
  deterministicProposalId,
  isAllowedSourceStatus,
  parseProposalSaveRequest,
  parseProposalTransitionRequest,
  storedProposalSongRows,
  targetFromCanonicalRole,
  transitionFingerprint,
  type ApprovalInput,
  type TransitionIntent,
} from "@/app/utils/proposalWriteRequest";

describe("deterministic proposal identity", () => {
  it("derives ONE id per service role (the first-create mutex)", () => {
    expect(deterministicProposalId("role-1")).toBe("setlistProposal.role-1");
  });

  it("refuses a blank or drafts role id", () => {
    expect(deterministicProposalId("")).toBeNull();
    expect(deterministicProposalId("drafts.role-1")).toBeNull();
    expect(deterministicProposalId(undefined)).toBeNull();
  });
});

describe("parseProposalSaveRequest", () => {
  const base = {
    roleId: "role-1",
    status: "draft",
    observed: { state: "none" },
    songs: [{ songId: "song-1", play_key: "G" }],
  };

  it("parses a save and defaults both note fields to empty strings", () => {
    expect(parseProposalSaveRequest(base)).toEqual({
      ok: true,
      value: {
        roleId: "role-1",
        status: "draft",
        observed: { state: "none" },
        songs: [{ songId: "song-1", playKey: "G", medleyTag: null }],
        leadNotes: "",
        teamNotes: "",
      },
    });
  });

  it("ignores a client-supplied service type/date (the role is authoritative)", () => {
    const parsed = parseProposalSaveRequest({
      ...base,
      serviceType: "special",
      serviceDate: "2030-01-01",
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && Object.keys(parsed.value).sort()).toEqual(
      ["leadNotes", "observed", "roleId", "songs", "status", "teamNotes"],
    );
  });

  it.each([
    ["a missing roleId", { ...base, roleId: undefined }],
    ["a drafts roleId", { ...base, roleId: "drafts.role-1" }],
    ["an unknown status", { ...base, status: "approved" }],
    ["a missing observed state", { ...base, observed: undefined }],
    ["an observed none carrying a rev", { ...base, observed: { state: "none", rev: "r1" } }],
    ["a malformed song row", { ...base, songs: [{}] }],
    ["non-string notes", { ...base, leadNotes: 3 }],
    ["oversized notes", { ...base, teamNotes: "x".repeat(4001) }],
  ])("rejects %s", (_label, body) => {
    expect(parseProposalSaveRequest(body).ok).toBe(false);
  });
});

describe("parseProposalTransitionRequest", () => {
  it("requires the reviewed revision for every action", () => {
    for (const action of ["approve", "request_changes", "reopen", "reconcile_target"]) {
      expect(parseProposalTransitionRequest({ action, rev: "r1" })).toEqual({
        ok: true,
        value: { action, rev: "r1", adminNotes: "" },
      });
      expect(parseProposalTransitionRequest({ action }).ok).toBe(false);
    }
  });

  it.each([
    ["an unknown action", { action: "delete", rev: "r1" }],
    ["a blank rev", { action: "approve", rev: "" }],
    ["a non-string rev", { action: "approve", rev: 1 }],
    ["non-string notes", { action: "reopen", rev: "r1", adminNotes: {} }],
  ])("rejects %s", (_label, body) => {
    expect(parseProposalTransitionRequest(body).ok).toBe(false);
  });
});

describe("source-state policy", () => {
  it("approves only from pending / changes_requested", () => {
    expect(isAllowedSourceStatus("approve", "pending")).toBe(true);
    expect(isAllowedSourceStatus("approve", "changes_requested")).toBe(true);
    expect(isAllowedSourceStatus("approve", "draft")).toBe(false);
    expect(isAllowedSourceStatus("approve", "approved")).toBe(false);
  });

  it("re-opens only from approved, and retargets only non-approved history", () => {
    expect(isAllowedSourceStatus("reopen", "approved")).toBe(true);
    expect(isAllowedSourceStatus("reopen", "pending")).toBe(false);
    expect(isAllowedSourceStatus("reconcile_target", "draft")).toBe(true);
    expect(isAllowedSourceStatus("reconcile_target", "approved")).toBe(false);
    expect(isAllowedSourceStatus("approve", "bogus")).toBe(false);
  });
});

describe("canonical target metadata", () => {
  it("derives the proposal and setlist target keys from the stored role", () => {
    expect(targetFromCanonicalRole({ _id: "role-1", _type: "sunday_role", week: "2026-08-09" })).toEqual({
      serviceType: "sunday",
      serviceDate: "2026-08-09",
      serviceRef: "role-1",
      targetKey: "sunday:2026-08-09",
      setlistTargetKey: "featuredSongs:2026-08-09",
    });
    expect(
      targetFromCanonicalRole({ _id: "role-2", _type: "saturday_role", week: "2026-08-08" })
        ?.setlistTargetKey,
    ).toBe("saturdarSongs:2026-08-08");
    // A special service is its own setlist target.
    expect(
      targetFromCanonicalRole({ _id: "role-sp", _type: "special_role", date: "2026-08-20" }),
    ).toEqual({
      serviceType: "special",
      serviceDate: "2026-08-20",
      serviceRef: "role-sp",
      targetKey: "special:role-sp",
      setlistTargetKey: "role-sp",
    });
  });

  it("fails closed on an unusable role", () => {
    expect(targetFromCanonicalRole({ _id: "role-1", _type: "post", week: "2026-08-09" })).toBeNull();
    expect(targetFromCanonicalRole({ _id: "role-1", _type: "sunday_role" })).toBeNull();
    expect(targetFromCanonicalRole({ _type: "sunday_role", week: "2026-08-09" })).toBeNull();
    // A weekend role's date lives in `week`, never `date`.
    expect(targetFromCanonicalRole({ _id: "r", _type: "sunday_role", date: "2026-08-09" })).toBeNull();
  });
});

describe("stored proposal song rows", () => {
  it("keeps stored order and reports blank play keys as blank", () => {
    expect(
      storedProposalSongRows([
        { _key: "a", play_key: "G", song: { _ref: "song-1" } },
        { _key: "b", medley_tag: "m", song: { _ref: "song-2" } },
      ]),
    ).toEqual([
      { songId: "song-1", playKey: "G", medleyTag: null },
      { songId: "song-2", playKey: "", medleyTag: "m" },
    ]);
  });

  it("fails closed on malformed content instead of dropping a song", () => {
    expect(storedProposalSongRows(undefined)).toBeNull();
    expect(storedProposalSongRows([{ _key: "a", play_key: "G" }])).toBeNull();
    expect(storedProposalSongRows([null])).toBeNull();
  });
});

// ── Approval receipt ────────────────────────────────────────────────────────

const APPROVAL: ApprovalInput = {
  serviceType: "sunday",
  serviceDate: "2026-08-09",
  serviceRef: "role-1",
  setlistTargetKey: "featuredSongs:2026-08-09",
  songs: [
    { songId: "song-1", playKey: "G", medleyTag: null },
    { songId: "song-2", playKey: "A", medleyTag: "m" },
  ],
  teamNotes: "Salmo 100",
};

describe("approval input fingerprint", () => {
  it("is stable across incidental whitespace", () => {
    expect(approvalInputFingerprint(APPROVAL)).toBe(
      approvalInputFingerprint({ ...APPROVAL, teamNotes: "  Salmo   100 " }),
    );
  });

  it("is ORDER-sensitive — a reordered setlist is a different setlist", () => {
    expect(approvalInputFingerprint({ ...APPROVAL, songs: [...APPROVAL.songs].reverse() })).not.toBe(
      approvalInputFingerprint(APPROVAL),
    );
  });

  it.each([
    ["a changed play key", { songs: [{ songId: "song-1", playKey: "D", medleyTag: null }, APPROVAL.songs[1]] }],
    ["a changed medley tag", { songs: [APPROVAL.songs[0], { songId: "song-2", playKey: "A", medleyTag: "m2" }] }],
    ["a changed song", { songs: [{ songId: "song-9", playKey: "G", medleyTag: null }, APPROVAL.songs[1]] }],
    ["a changed team message", { teamNotes: "Otro mensaje" }],
    ["a changed target date", { serviceDate: "2026-08-16" }],
    ["a changed target role", { serviceRef: "role-9" }],
    ["a changed setlist target", { setlistTargetKey: "saturdarSongs:2026-08-09" }],
  ])("changes with %s", (_label, patch) => {
    expect(approvalInputFingerprint({ ...APPROVAL, ...(patch as Partial<ApprovalInput>) })).not.toBe(
      approvalInputFingerprint(APPROVAL),
    );
  });
});

describe("approval receipt", () => {
  it("records the fingerprint, published target/document, timestamp and app marker", () => {
    const receipt = buildApprovalReceipt({
      approval: APPROVAL,
      setlistId: "featuredSongs.2026-08-09",
      now: "2026-07-24T10:00:00.000Z",
      approvedBy: "admin-1",
    });
    expect(receipt).toEqual({
      v: APPROVAL_RECEIPT_VERSION,
      marker: APPROVAL_APP_MARKER,
      fingerprint: approvalInputFingerprint(APPROVAL),
      serviceType: "sunday",
      serviceDate: "2026-08-09",
      serviceRef: "role-1",
      setlistTargetKey: "featuredSongs:2026-08-09",
      setlistId: "featuredSongs.2026-08-09",
      songCount: 2,
      approvedAt: "2026-07-24T10:00:00.000Z",
      approvedBy: "admin-1",
    });
    // Carries no `_type`: the guard is our own version + marker, not a tag a
    // foreign writer could set.
    expect(receipt).not.toHaveProperty("_type");
  });

  it("refuses to build a half-derived receipt", () => {
    expect(buildApprovalReceipt({ approval: APPROVAL, setlistId: "", now: "t" })).toBeNull();
    expect(
      buildApprovalReceipt({ approval: { ...APPROVAL, serviceRef: "" }, setlistId: "s", now: "t" }),
    ).toBeNull();
  });
});

describe("decideApprovalReceipt", () => {
  const receipt = buildApprovalReceipt({
    approval: APPROVAL,
    setlistId: "featuredSongs.2026-08-09",
    now: "2026-07-24T10:00:00.000Z",
  })!;
  const args = {
    fingerprint: approvalInputFingerprint(APPROVAL),
    serviceRef: "role-1",
    setlistTargetKey: "featuredSongs:2026-08-09",
  };

  it("verifies a receipt for exactly these inputs (a retry is a no-write success)", () => {
    expect(decideApprovalReceipt({ ...args, receipt })).toBe("verified");
  });

  it("reports drift when the content changed after approval", () => {
    expect(
      decideApprovalReceipt({ ...args, receipt, fingerprint: "different" }),
    ).toBe("fingerprint_mismatch");
  });

  it.each([
    ["no receipt at all (the legacy case)", undefined],
    ["a non-object", "receipt"],
    ["a foreign marker", { ...receipt, marker: "someone-else" }],
    ["an older version", { ...receipt, v: 0 }],
    ["a missing fingerprint", { ...receipt, fingerprint: "" }],
    ["a missing timestamp", { ...receipt, approvedAt: "" }],
    ["a missing published setlist id", { ...receipt, setlistId: "" }],
    ["another service role", { ...receipt, serviceRef: "role-9" }],
    ["another setlist target", { ...receipt, setlistTargetKey: "saturdarSongs:2026-08-09" }],
  ])("treats %s as unverified", (_label, value) => {
    expect(decideApprovalReceipt({ ...args, receipt: value })).toBe("unverified");
  });
});

// ── Transitions ─────────────────────────────────────────────────────────────

const INTENT: TransitionIntent = {
  action: "request_changes",
  proposalId: "p1",
  toStatus: "changes_requested",
  adminNotes: "Cambia la última",
};

describe("transition fingerprint", () => {
  it("is stable across incidental whitespace in the notes", () => {
    expect(transitionFingerprint({ ...INTENT, adminNotes: " Cambia  la última " })).toBe(
      transitionFingerprint(INTENT),
    );
  });

  it.each([
    ["the action", { action: "reopen" as const }],
    ["the proposal", { proposalId: "p2" }],
    ["the resulting status", { toStatus: "draft" }],
    ["the notes", { adminNotes: "Otra cosa" }],
    ["the retarget identity", { targetIdentity: "sunday:2026-08-09" }],
  ])("changes with %s", (_label, patch) => {
    expect(transitionFingerprint({ ...INTENT, ...patch })).not.toBe(transitionFingerprint(INTENT));
  });
});

describe("decideTransitionRetry", () => {
  const record = buildTransitionRecord({ intent: INTENT, now: "2026-07-24T10:00:00.000Z", by: "a1" });

  it("treats an already-committed identical transition as a no-write retry", () => {
    expect(
      decideTransitionRetry({
        storedStatus: "changes_requested",
        storedTransition: record,
        intent: INTENT,
      }),
    ).toBe("no_write_retry");
  });

  it.each([
    ["the status has not moved yet", { storedStatus: "pending", storedTransition: record }],
    ["nothing was recorded", { storedStatus: "changes_requested", storedTransition: undefined }],
    [
      "a different intent was recorded (new notes)",
      {
        storedStatus: "changes_requested",
        storedTransition: buildTransitionRecord({
          intent: { ...INTENT, adminNotes: "otra" },
          now: "t",
        }),
      },
    ],
    [
      "a different action was recorded",
      {
        storedStatus: "changes_requested",
        storedTransition: buildTransitionRecord({
          intent: { ...INTENT, action: "reopen" },
          now: "t",
        }),
      },
    ],
    [
      "a foreign record shape",
      { storedStatus: "changes_requested", storedTransition: { ...record, marker: "x" } },
    ],
  ])("proceeds when %s", (_label, patch) => {
    expect(decideTransitionRetry({ ...patch, intent: INTENT })).toBe("proceed");
  });

  it("records the app marker/version rather than a settable _type tag", () => {
    expect(record).toMatchObject({ v: APPROVAL_RECEIPT_VERSION, marker: APPROVAL_APP_MARKER, by: "a1" });
    expect(record).not.toHaveProperty("_type");
  });
});
