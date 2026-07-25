// scripts/lib/__tests__/sr-cleanup.test.mjs
//
// Offline unit tests for the guarded operator cleanup/restore decision logic
// (plan §8). Nothing here touches the network: every assertion is about a
// DECISION, never about a Sanity call. Every refusal named in the plan has its
// own case, and the dependency mirror is asserted against the real TypeScript
// helper the live writers use.

import { describe, expect, it } from "vitest";

import {
  CLEANUP_ACTIONS,
  CLEANUP_ACTION_NAMES,
  CLEANUP_TARGET_TYPES,
  NORMALIZABLE_PROPOSAL_FIELDS,
  RECEIPT_TOMBSTONE_STATES,
  REPAIRABLE_FIELDS,
  ROLE_DEPENDENCY_EVIDENCE_KEYS,
  confirmationPhrase,
  evaluateCleanupAction,
  evaluateRestore,
  isRawDraftId,
  mirrorInventoryRoleDeleteDependencies,
  mirrorProposalTargetKey,
  mirrorServiceDayKey,
  mirrorSetlistTargetKey,
  parseCleanupArgs,
  publishedIdOf,
  restoreConfirmationPhrase,
  restoreFields,
  verifyCleanupOutcome,
} from "../sr-cleanup.mjs";
import { evaluateGuards, MARKER_ENV, MARKER_VALUE, TOKEN_ENV, VERIFICATION_DATASET, VERIFICATION_PROJECT_ID, mirrorReceiptId } from "../sr-verification.mjs";

// The real helpers the live writers use, through the vitest `@` alias, so the
// `.mjs` mirrors cannot drift from them silently.
import { inventoryRoleDependencies } from "@/app/utils/roleDependencies";
import { proposalTargetKey, setlistTargetKey } from "@/app/utils/serviceReadModel";
import { serviceDayKey } from "@/app/utils/serviceReadSelect";

const NOW = "2026-07-24T12:00:00.000Z";

/** Build a decision with the correct confirmation phrase already filled in. */
function decide({ action, id, rev, mode = null, documents = {}, evidence = {}, confirm, now = NOW }) {
  return evaluateCleanupAction({
    action,
    id,
    rev,
    mode,
    documents,
    evidence,
    confirm: confirm ?? confirmationPhrase({ action, id, rev, mode }),
    now,
  });
}

function codes(decision) {
  return decision.refusals.map((r) => r.code);
}

/* ================================================================== *
 * CLI + confirmation
 * ================================================================== */

describe("cleanup CLI parsing", () => {
  it("defaults to dry-run and collects the action/target/revision", () => {
    const args = parseCleanupArgs([
      "--action", "discard-raw-draft",
      "--id", "drafts.role-1",
      "--rev", "rev-a",
      "--confirm", "discard-raw-draft:drafts.role-1@rev-a",
    ]);
    expect(args.apply).toBe(false);
    expect(args).toMatchObject({
      action: "discard-raw-draft",
      id: "drafts.role-1",
      rev: "rev-a",
      confirm: "discard-raw-draft:drafts.role-1@rev-a",
    });
    expect(args.unknown).toEqual([]);
  });

  it("only sets apply for the exact --apply token", () => {
    expect(parseCleanupArgs(["--apply"]).apply).toBe(true);
    expect(parseCleanupArgs(["--apply=true"]).apply).toBe(false);
    expect(parseCleanupArgs(["--apply=true"]).unknown).toEqual(["--apply=true"]);
  });

  it("refuses an unrecognized flag rather than ignoring a typo", () => {
    expect(parseCleanupArgs(["--aply"]).unknown).toEqual(["--aply"]);
    expect(parseCleanupArgs(["--force"]).unknown).toEqual(["--force"]);
  });

  it("refuses a value flag with no value", () => {
    expect(parseCleanupArgs(["--id"]).unknown).toEqual(["--id (missing value)"]);
    expect(parseCleanupArgs(["--id", "--apply"]).unknown).toEqual(["--id (missing value)"]);
  });

  it("refuses a repeated target flag — one cleanup target per invocation", () => {
    const args = parseCleanupArgs(["--id", "a", "--id", "b"]);
    expect(args.unknown).toEqual(["--id (repeated — one target per invocation)"]);
  });

  it("feeds its unknown flags straight into the shipped guard evaluator", () => {
    const args = parseCleanupArgs(["--force"]);
    const guards = evaluateGuards({ env: {}, apply: args.apply, unknownFlags: args.unknown });
    expect(guards.refused).toBe(true);
    expect(guards.hardFailures.map((f) => f.code)).toContain("unknown_flag");
    expect(guards.willContactRemote).toBe(false);
  });
});

describe("action-specific confirmation phrase", () => {
  it("names the action, the exact id and the exact revision", () => {
    expect(confirmationPhrase({ action: "remove-orphan-setlist", id: "s1", rev: "r1" })).toBe(
      "remove-orphan-setlist:s1@r1",
    );
  });

  it("includes the mode for actions that take one", () => {
    expect(confirmationPhrase({ action: "resolve-proposal", id: "p1", rev: "r1", mode: "remove" })).toBe(
      "resolve-proposal#remove:p1@r1",
    );
    expect(confirmationPhrase({ action: "resolve-proposal", id: "p1", rev: "r1", mode: "normalize" })).not.toBe(
      confirmationPhrase({ action: "resolve-proposal", id: "p1", rev: "r1", mode: "remove" }),
    );
  });

  it("is null without an action, id and revision", () => {
    expect(confirmationPhrase({ action: "remove-orphan-setlist", id: "s1" })).toBeNull();
    expect(confirmationPhrase({ action: "nope", id: "s1", rev: "r1" })).toBeNull();
  });
});

/* ================================================================== *
 * Shared preconditions
 * ================================================================== */

describe("shared cleanup preconditions", () => {
  const draft = { _id: "drafts.srv.role.sunday.draft", _type: "sunday_role", _rev: "rev-1", week: "2026-08-09" };

  it("refuses an unknown action", () => {
    const d = evaluateCleanupAction({ action: "nuke-everything", id: "x", rev: "r" });
    expect(d.ok).toBe(false);
    expect(codes(d)).toEqual(["unknown_action"]);
  });

  it("requires an exact id AND revision", () => {
    const noId = decide({ action: "discard-raw-draft", id: null, rev: "rev-1", documents: {} });
    expect(codes(noId)).toContain("missing_target_id");
    const noRev = decide({ action: "discard-raw-draft", id: draft._id, rev: null, documents: { [draft._id]: draft } });
    expect(codes(noRev)).toContain("missing_revision");
  });

  it("refuses a wrong or recycled confirmation", () => {
    const wrong = decide({
      action: "discard-raw-draft",
      id: draft._id,
      rev: "rev-1",
      documents: { [draft._id]: draft },
      confirm: "yes",
    });
    expect(codes(wrong)).toContain("confirmation_mismatch");

    // A confirmation minted for a different revision of the same target.
    const stale = decide({
      action: "discard-raw-draft",
      id: draft._id,
      rev: "rev-1",
      documents: { [draft._id]: draft },
      confirm: confirmationPhrase({ action: "discard-raw-draft", id: draft._id, rev: "rev-0" }),
    });
    expect(codes(stale)).toContain("confirmation_mismatch");
  });

  it("refuses an absent target and a revision that moved under us", () => {
    expect(codes(decide({ action: "discard-raw-draft", id: draft._id, rev: "rev-1" }))).toContain("target_absent");
    const moved = decide({
      action: "discard-raw-draft",
      id: draft._id,
      rev: "rev-1",
      documents: { [draft._id]: { ...draft, _rev: "rev-2" } },
    });
    expect(codes(moved)).toContain("revision_mismatch");
  });

  it("refuses a type the action does not own", () => {
    const d = decide({
      action: "remove-orphan-setlist",
      id: "srv.role.sunday.published",
      rev: "rev-1",
      documents: { "srv.role.sunday.published": { _id: "srv.role.sunday.published", _type: "sunday_role", _rev: "rev-1" } },
    });
    expect(codes(d)).toContain("wrong_target_type");
  });

  it("keeps raw drafts and canonical documents on separate actions", () => {
    const canonicalToDraftAction = decide({
      action: "discard-raw-draft",
      id: "srv.role.sunday.draft",
      rev: "rev-1",
      documents: { "srv.role.sunday.draft": { _id: "srv.role.sunday.draft", _type: "sunday_role", _rev: "rev-1" } },
    });
    expect(codes(canonicalToDraftAction)).toContain("not_a_raw_draft");

    const draftToCanonicalAction = decide({
      action: "repair-malformed-record",
      id: "drafts.srv.setlist",
      rev: "rev-1",
      documents: { "drafts.srv.setlist": { _id: "drafts.srv.setlist", _type: "featuredSongs", _rev: "rev-1" } },
      evidence: { set: { week: "2026-08-02" } },
    });
    expect(codes(draftToCanonicalAction)).toContain("unexpected_raw_draft");
  });

  it("validates and refuses an unexpected or invalid --mode", () => {
    const unexpected = evaluateCleanupAction({
      action: "remove-orphan-setlist",
      id: "s",
      rev: "r",
      mode: "remove",
      confirm: confirmationPhrase({ action: "remove-orphan-setlist", id: "s", rev: "r" }),
    });
    expect(codes(unexpected)).toContain("unexpected_mode");

    const invalid = evaluateCleanupAction({
      action: "resolve-proposal",
      id: "p",
      rev: "r",
      mode: "approve",
      confirm: confirmationPhrase({ action: "resolve-proposal", id: "p", rev: "r", mode: "approve" }),
    });
    expect(codes(invalid)).toContain("invalid_mode");
  });

  it("never carries a plan on a refused decision", () => {
    const d = decide({ action: "discard-raw-draft", id: draft._id, rev: "rev-1" });
    expect(d.ok).toBe(false);
    expect(d.plan).toBeNull();
  });

  it("covers exactly the nine plan §8 actions over the eight protected types", () => {
    expect(CLEANUP_ACTION_NAMES).toEqual(
      [
        "cleanup-creation-receipt",
        "discard-raw-draft",
        "reconcile-approved-receipt",
        "remove-malformed-role",
        "remove-orphan-setlist",
        "repair-malformed-record",
        "resolve-proposal",
        "select-canonical-duplicate",
        "vacate-orphan-lock",
      ].sort(),
    );
    expect([...CLEANUP_TARGET_TYPES]).toEqual([
      "sunday_role",
      "saturday_role",
      "special_role",
      "featuredSongs",
      // Deliberate stored typo — never renamed.
      "saturdarSongs",
      "setlistProposal",
      "roleTargetLock",
      "roleCreationReceipt",
    ]);
    const union = new Set(Object.values(CLEANUP_ACTIONS).flatMap((s) => s.types));
    expect([...union].sort()).toEqual([...CLEANUP_TARGET_TYPES].sort());
  });

  it("pairs every delete with a revision-asserting no-op patch in the same plan", () => {
    const d = decide({
      action: "discard-raw-draft",
      id: draft._id,
      rev: "rev-1",
      documents: { [draft._id]: draft },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: draft._id, rev: "rev-1" },
      { op: "delete", id: draft._id },
    ]);
  });

  it("never sends `_type` or a system field in any patch", () => {
    const d = decide({
      action: "repair-malformed-record",
      id: "srv.setlist.sunday.empty",
      rev: "rev-1",
      documents: { "srv.setlist.sunday.empty": { _id: "srv.setlist.sunday.empty", _type: "featuredSongs", _rev: "rev-1" } },
      evidence: { set: { _type: "saturdarSongs" } },
    });
    expect(codes(d)).toContain("immutable_field_in_patch");
  });
});

/* ================================================================== *
 * discard exact raw draft
 * ================================================================== */

describe("discard-raw-draft", () => {
  const rawDraft = { _id: "drafts.srv.proposal.pending", _type: "setlistProposal", _rev: "rev-1" };
  const published = { _id: "srv.proposal.pending", _type: "setlistProposal", _rev: "rev-9" };

  it("discards only the draft, leaving the published document untouched", () => {
    const d = decide({
      action: "discard-raw-draft",
      id: rawDraft._id,
      rev: "rev-1",
      documents: { [rawDraft._id]: rawDraft, [published._id]: published },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations.map((m) => m.id)).toEqual([rawDraft._id, rawDraft._id]);
    expect(d.plan.mutations.some((m) => m.id === published._id)).toBe(false);
    expect(d.plan.requeryIds).toEqual([rawDraft._id, published._id]);
    expect(d.plan.backupIds).toEqual([rawDraft._id]);
  });

  it("refuses when draft and published disagree on `_type`", () => {
    const d = decide({
      action: "discard-raw-draft",
      id: rawDraft._id,
      rev: "rev-1",
      documents: { [rawDraft._id]: rawDraft, [published._id]: { ...published, _type: "featuredSongs" } },
    });
    expect(codes(d)).toContain("published_type_mismatch");
  });

  it("recognizes and strips the draft prefix", () => {
    expect(isRawDraftId("drafts.x")).toBe(true);
    expect(isRawDraftId("x")).toBe(false);
    expect(publishedIdOf("drafts.x")).toBe("x");
    expect(publishedIdOf("x")).toBe("x");
  });
});

/* ================================================================== *
 * select a canonical duplicate, never merging
 * ================================================================== */

describe("select-canonical-duplicate", () => {
  const keeper = {
    _id: "srv.setlist.keep",
    _type: "featuredSongs",
    _rev: "keep-rev",
    week: "2026-08-02",
    songs: [{ _key: "k1", _type: "setlist_song" }],
  };
  const emptyDuplicate = { _id: "srv.setlist.dup", _type: "featuredSongs", _rev: "dup-rev", week: "2026-08-02", songs: [] };

  function run(overrides = {}) {
    const documents = { [keeper._id]: keeper, [emptyDuplicate._id]: emptyDuplicate, ...(overrides.documents ?? {}) };
    return decide({
      action: "select-canonical-duplicate",
      id: overrides.id ?? emptyDuplicate._id,
      rev: overrides.rev ?? emptyDuplicate._rev,
      documents,
      evidence: { keepId: keeper._id, keepRev: keeper._rev, ...(overrides.evidence ?? {}) },
    });
  }

  it("removes the empty duplicate and only ASSERTS the keeper's revision", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: keeper._id, rev: "keep-rev" },
      { op: "assertRev", id: emptyDuplicate._id, rev: "dup-rev" },
      { op: "delete", id: emptyDuplicate._id },
    ]);
    expect(d.plan.mutations.some((m) => m.op === "patch")).toBe(false);
  });

  it("never merges: a duplicate carrying content is refused", () => {
    const d = run({
      documents: { [emptyDuplicate._id]: { ...emptyDuplicate, songs: [{ _key: "x", _type: "setlist_song" }] } },
    });
    expect(codes(d)).toContain("duplicate_carries_content");
  });

  it("refuses a duplicate carrying seats on a role", () => {
    const roleKeeper = { _id: "srv.role.keep", _type: "sunday_role", _rev: "k", week: "2026-08-02" };
    const roleDup = {
      _id: "srv.role.dup",
      _type: "sunday_role",
      _rev: "d",
      week: "2026-08-02",
      BGVs: [{ _key: "b1", _type: "reference", _ref: "srv.member.bgv" }],
    };
    const d = decide({
      action: "select-canonical-duplicate",
      id: roleDup._id,
      rev: "d",
      documents: { [roleKeeper._id]: roleKeeper, [roleDup._id]: roleDup },
      evidence: { keepId: roleKeeper._id, keepRev: "k" },
    });
    expect(codes(d)).toContain("duplicate_carries_content");
  });

  it("refuses a missing, self-referencing, absent or stale keeper", () => {
    expect(codes(run({ evidence: { keepId: null } }))).toContain("canonical_keeper_missing");
    expect(codes(run({ evidence: { keepId: emptyDuplicate._id } }))).toContain("keeper_equals_target");
    expect(codes(run({ evidence: { keepId: "srv.setlist.ghost" } }))).toContain("canonical_keeper_absent");
    expect(codes(run({ evidence: { keepRev: "stale" } }))).toContain("canonical_keeper_revision_mismatch");
  });

  it("refuses two documents that are not duplicates of the same target", () => {
    const d = run({ documents: { [emptyDuplicate._id]: { ...emptyDuplicate, week: "2026-08-09" } } });
    expect(codes(d)).toContain("duplicate_target_mismatch");
  });

  it("refuses a type mismatch, including the saturdarSongs/featuredSongs pair", () => {
    const d = run({ documents: { [emptyDuplicate._id]: { ...emptyDuplicate, _type: "saturdarSongs" } } });
    expect(codes(d)).toContain("duplicate_type_mismatch");
  });
});

/* ================================================================== *
 * repair a malformed record
 * ================================================================== */

describe("repair-malformed-record", () => {
  const setlist = { _id: "srv.setlist.broken", _type: "saturdarSongs", _rev: "rev-1", week: null };

  it("patches an allowlisted field under the exact revision", () => {
    const d = decide({
      action: "repair-malformed-record",
      id: setlist._id,
      rev: "rev-1",
      documents: { [setlist._id]: setlist },
      evidence: { set: { week: "2026-08-01" } },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([{ op: "patch", id: setlist._id, rev: "rev-1", set: { week: "2026-08-01" } }]);
  });

  it("refuses a field outside the type's closed allowlist", () => {
    const d = decide({
      action: "repair-malformed-record",
      id: setlist._id,
      rev: "rev-1",
      documents: { [setlist._id]: setlist },
      evidence: { set: { songs: [] } },
    });
    expect(codes(d)).toContain("field_not_repairable");
    expect(REPAIRABLE_FIELDS.saturdarSongs).toEqual(["week"]);
  });

  it("refuses a repair with no effect", () => {
    const d = decide({
      action: "repair-malformed-record",
      id: setlist._id,
      rev: "rev-1",
      documents: { [setlist._id]: setlist },
      evidence: {},
    });
    expect(codes(d)).toContain("empty_repair");
  });

  it("refuses an array-of-object item without a `_key`", () => {
    const role = { _id: "srv.role.broken", _type: "special_role", _rev: "rev-1" };
    const d = decide({
      action: "repair-malformed-record",
      id: role._id,
      rev: "rev-1",
      documents: { [role._id]: role },
      // `service_name` is repairable; the array is not — but the missing `_key`
      // must also be reported, so a future allowlist widening cannot slip through.
      evidence: { set: { service_name: [{ note: "no key" }] } },
    });
    expect(codes(d)).toContain("missing_array_key");
  });
});

/* ================================================================== *
 * remove a malformed role
 * ================================================================== */

describe("remove-malformed-role", () => {
  const role = {
    _id: "srv.role.sunday.malformed",
    _type: "sunday_role",
    _rev: "role-rev",
    week: "2026-08-30",
    creationReceiptId: "roleCreate.abc",
  };
  const lock = {
    _id: "roleTarget.sunday_role.2026-08-30",
    _type: "roleTargetLock",
    _rev: "lock-rev",
    state: "claimed",
    roleId: role._id,
    generation: 3,
  };
  const receipt = { _id: "roleCreate.abc", _type: "roleCreationReceipt", _rev: "receipt-rev", state: "committed" };
  const CLEAR = {
    canonicalSetlists: [],
    rawSetlistDrafts: [],
    canonicalProposals: [],
    rawProposalDrafts: [],
    unknownReferences: [],
  };

  function run(overrides = {}) {
    return decide({
      action: "remove-malformed-role",
      id: role._id,
      rev: "role-rev",
      documents: { [role._id]: role, [lock._id]: lock, [receipt._id]: receipt, ...(overrides.documents ?? {}) },
      evidence: { ...CLEAR, lockId: lock._id, ...(overrides.evidence ?? {}) },
    });
  }

  it("vacates the lock, retires the receipt, and deletes the role in one plan", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: role._id, rev: "role-rev" },
      {
        op: "patch",
        id: lock._id,
        rev: "lock-rev",
        set: { state: "vacant", generation: 4, updatedAt: NOW },
        unset: ["roleId", "claimNonce"],
      },
      { op: "patch", id: receipt._id, rev: "receipt-rev", set: { state: "role_deleted", updatedAt: NOW } },
      { op: "delete", id: role._id },
    ]);
    // The receipt is a durable tombstone: retired, never deleted.
    expect(d.plan.mutations.filter((m) => m.op === "delete").map((m) => m.id)).toEqual([role._id]);
  });

  it("refuses an incomplete dependency inventory — a missing array is never 'clear'", () => {
    for (const key of ROLE_DEPENDENCY_EVIDENCE_KEYS) {
      const evidence = { ...CLEAR, lockId: lock._id };
      delete evidence[key];
      expect(codes(run({ evidence: { ...evidence, [key]: undefined } })), key).toContain(
        "dependency_inventory_incomplete",
      );
    }
  });

  it("refuses when the live writers' inventory finds a dependency", () => {
    const withSetlist = run({
      evidence: { canonicalSetlists: [{ _id: "srv.setlist.x", _type: "featuredSongs", week: "2026-08-30", songs: [] }] },
    });
    expect(codes(withSetlist)).toContain("role_has_dependencies");

    const withProposal = run({
      evidence: {
        canonicalProposals: [
          { _id: "srv.proposal.x", _type: "setlistProposal", service_type: "sunday", service_date: "2026-08-30", service_ref: role._id },
        ],
      },
    });
    expect(codes(withProposal)).toContain("role_has_dependencies");

    const withRef = run({ evidence: { unknownReferences: [{ _id: "some.doc", _type: "post" }] } });
    expect(codes(withRef)).toContain("role_has_dependencies");
  });

  it("refuses when the dependency scope cannot be resolved", () => {
    const d = run({ documents: { [role._id]: { ...role, week: null } } });
    expect(codes(d)).toContain("dependency_scope_unresolved");
  });

  it("requires the weekend lock, and refuses a lock owned by another role", () => {
    expect(codes(run({ evidence: { lockId: null } }))).toContain("lock_evidence_missing");
    expect(codes(run({ evidence: { lockId: "roleTarget.sunday_role.2026-08-30" }, documents: { [lock._id]: { ...lock, roleId: "srv.role.other" } } }))).toContain(
      "lock_owned_by_other_role",
    );
    expect(codes(run({ evidence: { lockId: "roleTarget.missing" } }))).toContain("lock_evidence_absent");
  });

  it("needs no lock for a special role (special services carry no lock)", () => {
    const special = { _id: "srv.role.special.malformed", _type: "special_role", _rev: "s-rev", date: "2026-09-26" };
    const d = decide({
      action: "remove-malformed-role",
      id: special._id,
      rev: "s-rev",
      documents: { [special._id]: special },
      evidence: { ...CLEAR },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: special._id, rev: "s-rev" },
      { op: "delete", id: special._id },
    ]);
  });

  it("refuses a special role that still carries embedded songs", () => {
    const special = {
      _id: "srv.role.special.songs",
      _type: "special_role",
      _rev: "s-rev",
      date: "2026-09-26",
      songs: [{ _key: "k", _type: "setlist_song" }],
    };
    const d = decide({
      action: "remove-malformed-role",
      id: special._id,
      rev: "s-rev",
      documents: { [special._id]: special },
      evidence: { ...CLEAR },
    });
    expect(codes(d)).toContain("role_has_dependencies");
  });

  it("refuses when the role's creation receipt was not supplied for retirement", () => {
    const d = run({ documents: { [receipt._id]: null } });
    expect(codes(d)).toContain("receipt_evidence_missing");
  });
});

/* ================================================================== *
 * remove a named orphan singleton setlist
 * ================================================================== */

describe("remove-orphan-setlist", () => {
  const setlist = { _id: "srv.setlist.orphan", _type: "saturdarSongs", _rev: "rev-1", week: "2026-08-15", songs: [] };
  const PROOF = { canonicalOwners: [], rawOwnerDrafts: [], observedSetlists: [setlist] };

  function run(overrides = {}) {
    return decide({
      action: "remove-orphan-setlist",
      id: setlist._id,
      rev: "rev-1",
      documents: { [setlist._id]: overrides.target ?? setlist },
      evidence: { ...PROOF, ...(overrides.evidence ?? {}) },
    });
  }

  it("removes a proven orphan singleton", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: setlist._id, rev: "rev-1" },
      { op: "delete", id: setlist._id },
    ]);
  });

  it("requires published AND raw owner proof", () => {
    expect(codes(run({ evidence: { canonicalOwners: undefined } }))).toContain("orphan_proof_missing");
    expect(codes(run({ evidence: { rawOwnerDrafts: undefined } }))).toContain("orphan_proof_missing");
    expect(codes(run({ evidence: { observedSetlists: undefined } }))).toContain("singleton_proof_missing");
  });

  it("refuses when a canonical or raw owner still claims the target", () => {
    const owner = { _id: "srv.role.saturday.x", _type: "saturday_role", week: "2026-08-15" };
    expect(codes(run({ evidence: { canonicalOwners: [owner] } }))).toContain("canonical_owner_exists");
    expect(codes(run({ evidence: { rawOwnerDrafts: [{ ...owner, _id: "drafts.srv.role.saturday.x" }] } }))).toContain(
      "canonical_owner_exists",
    );
  });

  it("fails closed on an owner whose date cannot be resolved", () => {
    expect(codes(run({ evidence: { canonicalOwners: [{ _id: "srv.role.x", _type: "saturday_role", week: null }] } }))).toContain(
      "canonical_owner_exists",
    );
  });

  it("refuses when the target is not a singleton", () => {
    const sibling = { _id: "srv.setlist.orphan.2", _type: "saturdarSongs", week: "2026-08-15" };
    expect(codes(run({ evidence: { observedSetlists: [setlist, sibling] } }))).toContain("not_a_singleton");
    expect(codes(run({ evidence: { observedSetlists: [sibling] } }))).toContain("not_a_singleton");
  });

  it("never destroys service history", () => {
    const withSongs = { ...setlist, songs: [{ _key: "k", _type: "setlist_song" }] };
    const d = run({ target: withSongs, evidence: { observedSetlists: [withSongs] } });
    expect(codes(d)).toContain("orphan_setlist_carries_history");
  });

  it("refuses a setlist whose week cannot be resolved", () => {
    const broken = { ...setlist, week: "not-a-date" };
    expect(codes(run({ target: broken, evidence: { observedSetlists: [broken] } }))).toContain(
      "setlist_target_unresolved",
    );
  });
});

/* ================================================================== *
 * retarget / normalize / remove a non-approved proposal
 * ================================================================== */

describe("resolve-proposal", () => {
  const proposal = {
    _id: "srv.proposal.pending",
    _type: "setlistProposal",
    _rev: "p-rev",
    status: "pending",
    service_type: "sunday",
    service_date: "2026-08-02",
    service_ref: "srv.role.sunday.published",
  };
  const destination = { _id: "srv.role.sunday.draft", _type: "sunday_role", _rev: "d-rev", week: "2026-08-09" };

  it("removes a non-approved proposal atomically", () => {
    const d = decide({
      action: "resolve-proposal",
      mode: "remove",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: proposal._id, rev: "p-rev" },
      { op: "delete", id: proposal._id },
    ]);
  });

  it("never touches an approved proposal, in any mode", () => {
    for (const mode of ["remove", "normalize", "retarget"]) {
      const d = decide({
        action: "resolve-proposal",
        mode,
        id: proposal._id,
        rev: "p-rev",
        documents: { [proposal._id]: { ...proposal, status: "approved" } },
        evidence: { set: { status: "pending" } },
      });
      expect(codes(d), mode).toContain("approved_proposal_protected");
    }
  });

  it("normalizes only allowlisted fields, and never approves", () => {
    const ok = decide({
      action: "resolve-proposal",
      mode: "normalize",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal },
      evidence: { set: { status: "changes_requested" } },
    });
    expect(ok.ok).toBe(true);
    expect(NORMALIZABLE_PROPOSAL_FIELDS).toContain("status");

    const forbidden = decide({
      action: "resolve-proposal",
      mode: "normalize",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal },
      evidence: { set: { songs: [] } },
    });
    expect(codes(forbidden)).toContain("field_not_repairable");

    const approving = decide({
      action: "resolve-proposal",
      mode: "normalize",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal },
      evidence: { set: { status: "approved" } },
    });
    expect(codes(approving)).toContain("approval_via_cleanup_forbidden");
  });

  it("retargets to a verified, unoccupied destination without sending `_type`", () => {
    const d = decide({
      action: "resolve-proposal",
      mode: "retarget",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal, [destination._id]: destination },
      evidence: {
        serviceRef: destination._id,
        serviceType: "sunday",
        serviceDate: "2026-08-09",
        destinationProposals: [],
      },
    });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toHaveLength(1);
    expect(d.plan.mutations[0].set).toEqual({
      service_type: "sunday",
      service_date: "2026-08-09",
      service_ref: { _type: "reference", _ref: destination._id },
    });
    expect(Object.keys(d.plan.mutations[0].set)).not.toContain("_type");
  });

  it("refuses an incomplete, absent, mistyped, misdated or occupied destination", () => {
    const base = {
      action: "resolve-proposal",
      mode: "retarget",
      id: proposal._id,
      rev: "p-rev",
      documents: { [proposal._id]: proposal, [destination._id]: destination },
    };
    expect(codes(decide({ ...base, evidence: { serviceRef: destination._id } }))).toContain(
      "retarget_destination_incomplete",
    );
    expect(
      codes(decide({ ...base, evidence: { serviceRef: "srv.role.ghost", serviceType: "sunday", serviceDate: "2026-08-09" } })),
    ).toContain("retarget_destination_absent");
    expect(
      codes(
        decide({
          ...base,
          evidence: { serviceRef: destination._id, serviceType: "saturday", serviceDate: "2026-08-09", destinationProposals: [] },
        }),
      ),
    ).toContain("retarget_destination_type_mismatch");
    expect(
      codes(
        decide({
          ...base,
          evidence: { serviceRef: destination._id, serviceType: "sunday", serviceDate: "2026-08-16", destinationProposals: [] },
        }),
      ),
    ).toContain("retarget_destination_date_mismatch");
    expect(
      codes(decide({ ...base, evidence: { serviceRef: destination._id, serviceType: "sunday", serviceDate: "2026-08-09" } })),
    ).toContain("retarget_destination_proof_missing");
    expect(
      codes(
        decide({
          ...base,
          evidence: {
            serviceRef: destination._id,
            serviceType: "sunday",
            serviceDate: "2026-08-09",
            destinationProposals: [
              { _id: "srv.proposal.other", service_type: "sunday", service_date: "2026-08-09", service_ref: destination._id },
            ],
          },
        }),
      ),
    ).toContain("destination_proposal_exists");
  });
});

/* ================================================================== *
 * reconcile a legacy approved receipt
 * ================================================================== */

describe("reconcile-approved-receipt", () => {
  const legacy = {
    _id: "srv.proposal.legacyApproved",
    _type: "setlistProposal",
    _rev: "l-rev",
    status: "approved",
  };

  function run(overrides = {}) {
    return decide({
      action: "reconcile-approved-receipt",
      mode: "reconcile",
      id: legacy._id,
      rev: "l-rev",
      documents: { [legacy._id]: overrides.target ?? legacy },
      evidence: { approvalReceiptId: "proposalApproval.recon.1", note: "Aprobación legada de 2026-06", ...(overrides.evidence ?? {}) },
    });
  }

  it("adds a reconciliation marker and nothing else", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toHaveLength(1);
    expect(d.plan.mutations[0].op).toBe("patch");
    expect(d.plan.mutations.some((m) => m.op === "delete")).toBe(false);
    expect(d.plan.mutations[0].set).toMatchObject({
      approvalReceiptId: "proposalApproval.recon.1",
      approvalReconciledAt: NOW,
    });
  });

  it("never deletes approved history — remove is not even a mode", () => {
    expect(CLEANUP_ACTIONS["reconcile-approved-receipt"].modes).toEqual(["reconcile"]);
    const d = evaluateCleanupAction({
      action: "reconcile-approved-receipt",
      mode: "remove",
      id: legacy._id,
      rev: "l-rev",
      documents: { [legacy._id]: legacy },
      confirm: confirmationPhrase({ action: "reconcile-approved-receipt", id: legacy._id, rev: "l-rev", mode: "remove" }),
    });
    expect(codes(d)).toContain("invalid_mode");
    expect(d.plan).toBeNull();
  });

  it("refuses a non-approved proposal and an already-reconciled one", () => {
    expect(codes(run({ target: { ...legacy, status: "pending" } }))).toContain("not_an_approved_proposal");
    expect(codes(run({ target: { ...legacy, approvalReceiptId: "already" } }))).toContain(
      "approval_receipt_already_present",
    );
  });

  it("requires the receipt id and a written reason", () => {
    expect(codes(run({ evidence: { approvalReceiptId: null } }))).toContain("reconciliation_receipt_missing");
    expect(codes(run({ evidence: { note: null } }))).toContain("reconciliation_note_missing");
  });
});

/* ================================================================== *
 * vacate an orphan lock
 * ================================================================== */

describe("vacate-orphan-lock", () => {
  const lock = {
    _id: "roleTarget.sunday_role.2026-08-30",
    _type: "roleTargetLock",
    _rev: "lock-rev",
    state: "claimed",
    roleId: "srv.role.sunday.gone",
    claimNonce: "nonce-1",
    generation: 2,
  };

  function run(overrides = {}) {
    return decide({
      action: "vacate-orphan-lock",
      id: lock._id,
      rev: "lock-rev",
      documents: { [lock._id]: overrides.target ?? lock },
      evidence: { publishedRoles: [], rawRoleDrafts: [], ...(overrides.evidence ?? {}) },
    });
  }

  it("vacates (never deletes) and advances the generation", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      {
        op: "patch",
        id: lock._id,
        rev: "lock-rev",
        set: { state: "vacant", generation: 3, updatedAt: NOW },
        unset: ["roleId", "claimNonce"],
      },
    ]);
    expect(d.plan.mutations.some((m) => m.op === "delete")).toBe(false);
  });

  it("requires published AND raw proof", () => {
    expect(codes(run({ evidence: { publishedRoles: undefined } }))).toContain("lock_proof_missing");
    expect(codes(run({ evidence: { rawRoleDrafts: undefined } }))).toContain("lock_proof_missing");
  });

  it("refuses when the owner still exists in either perspective", () => {
    expect(codes(run({ evidence: { publishedRoles: [{ _id: "srv.role.sunday.gone", _type: "sunday_role" }] } }))).toContain(
      "lock_owner_alive",
    );
    expect(
      codes(run({ evidence: { rawRoleDrafts: [{ _id: "drafts.srv.role.sunday.gone", _type: "sunday_role" }] } })),
    ).toContain("lock_owner_alive");
  });

  it("refuses an already-vacant lock and one with no resolvable owner", () => {
    expect(codes(run({ target: { ...lock, state: "vacant" } }))).toContain("lock_already_vacant");
    expect(codes(run({ target: { ...lock, roleId: null } }))).toContain("lock_owner_unresolved");
  });
});

/* ================================================================== *
 * inspect / remove a creation receipt
 * ================================================================== */

describe("cleanup-creation-receipt", () => {
  const malformed = {
    _id: "roleCreate.handwritten",
    _type: "roleCreationReceipt",
    _rev: "r-rev",
    state: "in_flight",
    requestId: "srv-request-orphan-receipt",
  };

  function run(overrides = {}) {
    return decide({
      action: "cleanup-creation-receipt",
      mode: overrides.mode ?? "remove",
      id: malformed._id,
      rev: "r-rev",
      documents: { [malformed._id]: overrides.target ?? malformed },
      evidence: { liveRoles: [], ...(overrides.evidence ?? {}) },
    });
  }

  it("always allows read-only inspection, including of a tombstone", () => {
    for (const state of RECEIPT_TOMBSTONE_STATES) {
      const d = run({ mode: "inspect", target: { ...malformed, state } });
      expect(d.ok, state).toBe(true);
      expect(d.plan.mutations).toEqual([]);
      expect(d.plan.backupIds).toEqual([]);
    }
  });

  it("never deletes a committed or retired receipt — they are durable tombstones", () => {
    for (const state of RECEIPT_TOMBSTONE_STATES) {
      const d = run({ target: { ...malformed, state } });
      expect(codes(d), state).toContain("receipt_tombstone_protected");
      expect(d.plan).toBeNull();
    }
    expect([...RECEIPT_TOMBSTONE_STATES]).toEqual(["committed", "role_deleted"]);
  });

  it("removes a malformed receipt whose id is not derivable from its requestId", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "assertRev", id: malformed._id, rev: "r-rev" },
      { op: "delete", id: malformed._id },
    ]);
  });

  it("refuses a receipt a concurrent create could still address", () => {
    const requestId = "srv-request-orphan-receipt";
    const addressableId = mirrorReceiptId(requestId);
    const d = decide({
      action: "cleanup-creation-receipt",
      mode: "remove",
      id: addressableId,
      rev: "r-rev",
      documents: { [addressableId]: { _id: addressableId, _type: "roleCreationReceipt", _rev: "r-rev", state: "in_flight", requestId } },
      evidence: { liveRoles: [] },
    });
    expect(codes(d)).toContain("receipt_addressable_by_create");
  });

  it("requires live-role proof, and refuses when a live role carries the receipt", () => {
    expect(codes(run({ evidence: { liveRoles: undefined } }))).toContain("receipt_role_proof_missing");
    expect(
      codes(run({ evidence: { liveRoles: [{ _id: "srv.role.sunday.x", _type: "sunday_role", creationReceiptId: malformed._id }] } })),
    ).toContain("receipt_carried_by_live_role");
    expect(
      codes(
        run({
          target: { ...malformed, roleId: "srv.role.sunday.y" },
          evidence: { liveRoles: [{ _id: "srv.role.sunday.y", _type: "sunday_role" }] },
        }),
      ),
    ).toContain("receipt_carried_by_live_role");
  });
});

/* ================================================================== *
 * Restore
 * ================================================================== */

describe("restore", () => {
  const entry = {
    _id: "srv.setlist.sunday.ready",
    _type: "featuredSongs",
    _rev: "backup-rev",
    week: "2026-08-09",
    songs: [{ _key: "k1", _type: "setlist_song" }],
  };

  function run(overrides = {}) {
    const entries = overrides.entries ?? [entry];
    return evaluateRestore({
      entries,
      documents: overrides.documents ?? { [entry._id]: entry },
      confirm: overrides.confirm ?? restoreConfirmationPhrase(entries),
    });
  }

  it("restores in place under the exact backed-up revision", () => {
    const d = run();
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "patch", id: entry._id, rev: "backup-rev", set: { week: "2026-08-09", songs: entry.songs } },
    ]);
    // `_type` is immutable per document id and is never part of a restore patch.
    expect(Object.keys(d.plan.mutations[0].set)).not.toContain("_type");
  });

  it("recreates a document the cleanup deleted (not an overwrite)", () => {
    const d = run({ documents: {} });
    expect(d.ok).toBe(true);
    expect(d.plan.mutations).toEqual([
      { op: "createIfNotExists", id: entry._id, type: "featuredSongs", fields: { week: "2026-08-09", songs: entry.songs } },
    ]);
  });

  it("refuses a later-write conflict and never force-overwrites", () => {
    const d = run({ documents: { [entry._id]: { ...entry, _rev: "someone-else" } } });
    expect(d.ok).toBe(false);
    expect(d.refusals.map((r) => r.code)).toEqual(["later_write_conflict"]);
    expect(d.plan).toBeNull();
  });

  it("refuses the WHOLE restore when any single entry conflicts", () => {
    const second = { _id: "srv.setlist.sunday.empty", _type: "featuredSongs", _rev: "b2", week: "2026-08-02", songs: [] };
    const d = run({
      entries: [entry, second],
      documents: { [entry._id]: entry, [second._id]: { ...second, _rev: "moved" } },
    });
    expect(d.ok).toBe(false);
    expect(d.plan).toBeNull();
  });

  it("refuses a wrong confirmation, an empty backup, and a duplicate entry", () => {
    expect(run({ confirm: "restore" }).refusals.map((r) => r.code)).toContain("restore_confirmation_mismatch");
    expect(evaluateRestore({ entries: [] }).refusals.map((r) => r.code)).toEqual(["empty_backup"]);
    const dup = [entry, { ...entry }];
    expect(
      evaluateRestore({ entries: dup, documents: { [entry._id]: entry }, confirm: restoreConfirmationPhrase(dup) }).refusals.map(
        (r) => r.code,
      ),
    ).toContain("backup_duplicate_entry");
  });

  it("refuses a missing id/revision, a foreign type, and a `_type` that changed", () => {
    const noId = [{ _type: "featuredSongs", _rev: "r" }];
    expect(evaluateRestore({ entries: noId, confirm: restoreConfirmationPhrase(noId) }).refusals.map((r) => r.code)).toContain(
      "backup_entry_missing_id",
    );
    expect(run({ entries: [{ ...entry, _rev: null }] }).refusals.map((r) => r.code)).toContain(
      "backup_entry_missing_revision",
    );
    expect(run({ entries: [{ ...entry, _type: "post" }] }).refusals.map((r) => r.code)).toContain(
      "restore_type_not_protected",
    );
    expect(run({ documents: { [entry._id]: { ...entry, _type: "saturdarSongs" } } }).refusals.map((r) => r.code)).toContain(
      "restore_type_mismatch",
    );
  });

  it("binds its confirmation to the exact id set", () => {
    const a = restoreConfirmationPhrase([{ _id: "a" }]);
    const b = restoreConfirmationPhrase([{ _id: "b" }]);
    expect(a).not.toBe(b);
    expect(restoreConfirmationPhrase([{ _id: "a" }, { _id: "b" }])).toBe(
      restoreConfirmationPhrase([{ _id: "b" }, { _id: "a" }]),
    );
    expect(restoreConfirmationPhrase([])).toBeNull();
  });

  it("strips system fields from a restored body", () => {
    expect(restoreFields(entry)).toEqual({ week: "2026-08-09", songs: entry.songs });
    expect(restoreFields({ _createdAt: "x", _updatedAt: "y", a: 1 })).toEqual({ a: 1 });
  });
});

/* ================================================================== *
 * Post-write re-query
 * ================================================================== */

describe("post-write re-query", () => {
  const plan = {
    kind: "t",
    backupIds: ["a"],
    mutations: [{ op: "assertRev", id: "a", rev: "r1" }, { op: "patch", id: "b", rev: "r2", set: { week: "x" } }, { op: "delete", id: "a" }],
    requeryIds: ["a", "b"],
    notes: [],
  };

  it("passes when the delete is gone and the patch moved the revision", () => {
    const v = verifyCleanupOutcome({ plan, before: { b: { _id: "b", _type: "featuredSongs", _rev: "r2" } }, after: { b: { _id: "b", _type: "featuredSongs", _rev: "r3" } } });
    expect(v).toEqual({ ok: true, failures: [] });
  });

  it("fails when a delete target is still present", () => {
    const v = verifyCleanupOutcome({
      plan,
      before: {},
      after: { a: { _id: "a", _type: "sunday_role", _rev: "r1" }, b: { _id: "b", _rev: "r3" } },
    });
    expect(v.failures.map((f) => f.code)).toContain("still_present");
  });

  it("fails when a patched document is missing, unchanged, or changed `_type`", () => {
    expect(verifyCleanupOutcome({ plan, before: {}, after: {} }).failures.map((f) => f.code)).toContain(
      "missing_after_write",
    );
    expect(
      verifyCleanupOutcome({ plan, before: {}, after: { b: { _id: "b", _rev: "r2" } } }).failures.map((f) => f.code),
    ).toContain("revision_unchanged");
    expect(
      verifyCleanupOutcome({
        plan,
        before: { b: { _id: "b", _type: "featuredSongs", _rev: "r2" } },
        after: { b: { _id: "b", _type: "saturdarSongs", _rev: "r3" } },
      }).failures.map((f) => f.code),
    ).toContain("type_changed");
  });

  it("fails without a plan", () => {
    expect(verifyCleanupOutcome({ plan: null }).ok).toBe(false);
  });
});

/* ================================================================== *
 * Mirrors of the live helpers
 * ================================================================== */

describe("mirrors of the live TypeScript helpers", () => {
  it("mirrors serviceDayKey", () => {
    for (const v of ["2026-08-02", "2026-08-02T12:00:00Z", "2026-02-30", "nope", "", null, undefined, 5]) {
      expect(mirrorServiceDayKey(v), String(v)).toEqual(serviceDayKey(v));
    }
  });

  it("mirrors setlistTargetKey, keeping the saturdarSongs typo", () => {
    const table = [
      ["sunday_role", "2026-08-02", "r1"],
      ["saturday_role", "2026-08-01", "r2"],
      ["special_role", "2026-09-12", "r3"],
      ["sunday_role", undefined, "r4"],
      ["post", "2026-08-02", "r5"],
    ];
    for (const [type, week, id] of table) {
      expect(mirrorSetlistTargetKey(type, week, id), `${type}/${week}`).toEqual(setlistTargetKey(type, week, id));
    }
    expect(mirrorSetlistTargetKey("saturday_role", "2026-08-01", "x")).toBe("saturdarSongs:2026-08-01");
  });

  it("mirrors proposalTargetKey", () => {
    const table = [
      ["sunday", "2026-08-02", "r1"],
      ["saturday", "2026-08-01", "r2"],
      ["special", "2026-09-12", "r3"],
      ["nope", "2026-09-12", "r4"],
    ];
    for (const [kind, date, ref] of table) {
      expect(mirrorProposalTargetKey(kind, date, ref), kind).toEqual(proposalTargetKey(kind, date, ref));
    }
  });

  it("mirrors the delete-branch dependency inventory over a table of inputs", () => {
    const sunday = { _id: "srv.role.sunday", _type: "sunday_role", week: "2026-08-02" };
    const special = { _id: "srv.role.special", _type: "special_role", date: "2026-09-12", songs: [{ _key: "k" }] };
    const setlist = { _id: "srv.setlist", _type: "featuredSongs", week: "2026-08-02", songs: [] };
    const satSetlist = { _id: "srv.setlist.sat", _type: "saturdarSongs", week: "2026-08-01", songs: [{ _key: "s" }] };
    const proposal = {
      _id: "srv.proposal",
      _type: "setlistProposal",
      service_type: "sunday",
      service_date: "2026-08-02",
      service_ref: "srv.role.sunday",
      status: "pending",
    };
    const malformedProposal = { _id: "srv.proposal.bad", _type: "setlistProposal", service_date: "2026-08-02" };

    const cases = [
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [setlist], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [satSetlist], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [setlist], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [proposal], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [malformedProposal], rawProposalDrafts: [], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [proposal], unknownReferences: [] },
      { role: sunday, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [{ _id: "x", _type: "post" }] },
      { role: special, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: { ...sunday, week: null }, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: { _id: "x", _type: "post" }, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
      { role: null, canonicalSetlists: [], rawSetlistDrafts: [], canonicalProposals: [], rawProposalDrafts: [], unknownReferences: [] },
    ];

    for (const [i, input] of cases.entries()) {
      const mine = mirrorInventoryRoleDeleteDependencies(input);
      const real = inventoryRoleDependencies({ operation: "delete", ...input });
      expect(mine.usable, `case ${i} usable`).toBe(real.usable);
      expect(mine.code, `case ${i} code`).toBe(real.code);
      expect(mine.issues.sort(), `case ${i} issues`).toEqual([...real.issues].sort());
      expect(mine.hasDependencies, `case ${i} hasDependencies`).toBe(real.hasDependencies);
      expect(mine.dependencies, `case ${i} dependencies`).toEqual(real.dependencies);
    }
  });
});

/* ================================================================== *
 * The environment guard is the shipped one — production is refused
 * ================================================================== */

describe("cleanup reuses the shipped environment guards", () => {
  const GOOD_ENV = {
    SR_VERIFY_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
    SR_VERIFY_SANITY_DATASET: VERIFICATION_DATASET,
    [MARKER_ENV]: MARKER_VALUE,
    [TOKEN_ENV]: "sk-not-a-real-token",
  };

  it("refuses the production project outright, even in dry-run", () => {
    const g = evaluateGuards({ env: { ...GOOD_ENV, SR_VERIFY_SANITY_PROJECT_ID: "ebb8vcnk" }, apply: false });
    expect(g.refused).toBe(true);
    expect(g.hardFailures.map((f) => f.code)).toContain("forbidden_project");
    expect(g.willContactRemote).toBe(false);
  });

  it("refuses the production dataset outright, even in dry-run", () => {
    const g = evaluateGuards({ env: { ...GOOD_ENV, SR_VERIFY_SANITY_DATASET: "production" }, apply: false });
    expect(g.refused).toBe(true);
    expect(g.hardFailures.map((f) => f.code)).toContain("forbidden_dataset");
  });

  it("blocks --apply without the marker or the token", () => {
    const noMarker = { ...GOOD_ENV };
    delete noMarker[MARKER_ENV];
    const g1 = evaluateGuards({ env: noMarker, apply: true });
    expect(g1.refused).toBe(true);
    expect(g1.applyBlockers.map((f) => f.code)).toContain("missing_marker");

    const noToken = { ...GOOD_ENV };
    delete noToken[TOKEN_ENV];
    const g2 = evaluateGuards({ env: noToken, apply: true });
    expect(g2.refused).toBe(true);
    expect(g2.applyBlockers.map((f) => f.code)).toContain("missing_token");
  });

  it("never contacts remote by default (dry-run is the default)", () => {
    expect(evaluateGuards({ env: GOOD_ENV, apply: false }).willContactRemote).toBe(false);
    expect(evaluateGuards({ env: GOOD_ENV, apply: false }).exitCode).toBe(0);
  });
});
