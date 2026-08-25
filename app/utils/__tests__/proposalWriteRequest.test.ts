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

// ── Frozen digests (proposal message thread, R2 Phase 0) ────────────────────
//
// The two digests below are the idempotency keys behind `approval_receipt` and
// `last_transition`. `transitionFingerprint` builds its digest from the SAME
// `APPROVAL_RECEIPT_VERSION` / `APPROVAL_APP_MARKER` pair the approval receipt
// records, and `decideApprovalReceipt` rejects a receipt outright when either of
// those two values fails to match (`proposalWriteRequest.ts:302-303`) — an
// `unverified` receipt on an approved proposal is `409 legacy_approval_unverified`.
//
// So the intuitive move while extending the stored proposal shape — "the shape
// changed, bump the version" — would silently convert the 5 production proposals
// that currently carry a VERIFIABLE receipt into permanent 409s, and would do it
// from a file that never mentions approvals. Likewise, quietly adding a field to
// `canonicalizeApprovalInput` (or to the transition intent) moves the digest for
// content that was already published, so a lost-response retry stops matching the
// record its own first attempt committed and re-runs the write.
//
// These fixtures are FROZEN. If one of these tests goes red, the correct response
// is to undo the change that moved the digest — not to paste in the new hex.
const FROZEN_APPROVAL: ApprovalInput = {
  serviceType: "sunday",
  serviceDate: "2026-08-09",
  serviceRef: "role-frozen",
  setlistTargetKey: "featuredSongs:2026-08-09",
  songs: [
    { songId: "song-a", playKey: "G", medleyTag: null },
    { songId: "song-b", playKey: "A", medleyTag: "popurri" },
  ],
  teamNotes: "Salmo 100",
};

const FROZEN_INTENT: TransitionIntent = {
  action: "request_changes",
  proposalId: "setlistProposal.role-frozen",
  toStatus: "changes_requested",
  adminNotes: "Cambia la última",
  targetIdentity: null,
};

// A SECOND frozen pair, whose only job is to exercise the parts of
// `normalizeText` the pair above cannot reach:
//
//   * `teamNotes` / `adminNotes` carry a DECOMPOSED accent (u + U+0301). Every
//     other fixture in this file uses precomposed characters, which makes
//     `.normalize("NFC")` an identity — delete that call and the whole suite
//     stays green while the digest moves for any decomposed input, which is
//     exactly what a phone keyboard or a paste from macOS can produce.
//   * `songs` is EMPTY, and `targetIdentity` is non-null — the two branches the
//     first pair leaves untouched.
//
// Frozen on the same terms: if this goes red, undo the change, do not repaste.
const FROZEN_APPROVAL_NFC: ApprovalInput = {
  serviceType: "sunday",
  serviceDate: "2026-08-09",
  serviceRef: "role-nfc",
  setlistTargetKey: "featuredSongs:2026-08-09",
  songs: [],
  teamNotes: "Salmo 100 u\u0301ltima",
};

const FROZEN_INTENT_NFC: TransitionIntent = {
  action: "approve",
  proposalId: "setlistProposal.role-nfc",
  toStatus: "approved",
  adminNotes: "u\u0301ltima revisio\u0301n",
  targetIdentity: "sunday_role:role-nfc",
};

describe("frozen approval/transition digests", () => {
  it("pins the two shared constants byte for byte", () => {
    expect(APPROVAL_RECEIPT_VERSION).toBe(1);
    expect(APPROVAL_APP_MARKER).toBe("owt-kb-v1/a2-approval-1");
  });

  it("pins a decomposed-accent, empty-songs pair so NFC normalization is guarded", () => {
    expect(approvalInputFingerprint(FROZEN_APPROVAL_NFC)).toBe(
      "f601b556e83e56506805e34a6047ad0441c6055a047584dddded54e0791adbf0",
    );
    expect(transitionFingerprint(FROZEN_INTENT_NFC)).toBe(
      "ff98adf2c4e7c63cb26a6f1ae6b6ab2c25e566f0b7495262efe7b55002172a54",
    );
  });

  it("proves the NFC fixture is actually decomposed", () => {
    // Guards the guard: if someone "tidies" the escape into a literal á, the
    // digest test above would still pass while silently ceasing to exercise
    // normalization at all.
    expect(FROZEN_APPROVAL_NFC.teamNotes).not.toBe(
      FROZEN_APPROVAL_NFC.teamNotes.normalize("NFC"),
    );
  });

  it("pins approvalInputFingerprint for a fixed approval input", () => {
    expect(approvalInputFingerprint(FROZEN_APPROVAL)).toBe(
      "1334033989224707622c767aabf4aa5b28b01681f2c6a95a21eafbce70077d4b",
    );
  });

  it("pins transitionFingerprint for a fixed transition intent", () => {
    expect(transitionFingerprint(FROZEN_INTENT)).toBe(
      "91df6522dd5e8ae044945f22ca619a83363ff8510f7ce8e62f494ae68c118e2b",
    );
  });
});
