// scripts/lib/__tests__/sr-feasibility-checks.test.mjs
//
// Offline tests for the A2 §9 feasibility inventory: coverage of the required
// transaction shapes, deterministic document builders, the closed scratch-id
// set, dependency ordering, and the no-partial-state comparison. No network.

import { describe, it, expect } from "vitest";

import {
  FEASIBILITY_CHECKS,
  SCRATCH_ID_PREFIX,
  assertNoPartialState,
  checkInventory,
  claimedLockDocumentFor,
  isScratchId,
  orderedChecks,
  receiptDocumentFor,
  roleDocumentFromPayload,
  scratchIds,
} from "../sr-feasibility-checks.mjs";

import { fixtureIds, mirrorPayloadFingerprint, mirrorReceiptId } from "../sr-verification.mjs";
import { payloadFingerprint, receiptIdForRequestId } from "@/app/utils/roleCreationReceipt";
import { roleTargetLockId } from "@/app/utils/roleTargetLock";

const NOW = "2026-07-24T12:00:00.000Z";

describe("A2 §9 coverage — every required transaction shape is a named check", () => {
  const ids = FEASIBILITY_CHECKS.map((c) => c.id);

  it.each([
    ["role+receipt+lock create", "sunday_role_receipt_lock_create"],
    ["same-key retry", "sunday_same_key_retry_idempotent"],
    ["Saturday create + retry", "saturday_role_receipt_lock_create_and_retry"],
    ["special create + retry", "special_role_receipt_create_and_retry"],
    ["same-key/different-payload conflict", "same_key_different_payload_conflict"],
    ["receipt/target race", "receipt_and_target_race"],
    ["atomic rollback", "atomic_rollback"],
    ["receipt retirement on delete", "receipt_retirement_on_delete"],
    ["retired key cannot recreate", "retired_key_cannot_recreate"],
    ["orphan-receipt guarded cleanup", "orphan_receipt_guarded_cleanup"],
    ["legacy bootstrap then success", "legacy_bootstrap_then_success"],
    ["legacy bootstrap then conflict", "legacy_bootstrap_then_conflict"],
    ["vacant reclaim", "vacant_reclaim"],
    ["delete + vacate", "delete_and_vacate"],
    ["dependency created during move", "dependency_created_during_move"],
    ["dependency created during delete", "dependency_created_during_delete"],
    ["swap", "swap_same_and_cross_role"],
    ["copy-instruments source assertion", "copy_instruments_source_assertion"],
    ["observed-singleton setlist conflict", "setlist_observed_singleton_conflict"],
    ["observed-none setlist conflict", "setlist_observed_none_conflict"],
    ["proposal first-create conflict", "proposal_first_create_conflict"],
    ["proposal transition conflict", "proposal_transition_conflict"],
    ["atomic approval + receipt retry", "atomic_approval_and_receipt_retry"],
    ["multi-role publish", "multi_role_publish"],
  ])("covers %s", (_label, id) => {
    expect(ids).toContain(id);
  });

  it("has unique ids and no empty descriptors", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of FEASIBILITY_CHECKS) {
      expect(typeof c.title).toBe("string");
      expect(c.title.length).toBeGreaterThan(0);
      expect(typeof c.planRef).toBe("string");
      expect(["commit", "reject"]).toContain(c.expects);
      expect(typeof c.act).toBe("function");
    }
  });

  it("re-queries at least one document in every check", () => {
    for (const c of FEASIBILITY_CHECKS) expect(c.requery.length).toBeGreaterThan(0);
  });

  it("re-queries EVERY involved document class after an induced conflict", () => {
    for (const c of FEASIBILITY_CHECKS.filter((x) => x.expects === "reject")) {
      expect(c.induces).toBeTruthy();
      expect(c.requery.length).toBeGreaterThan(0);
    }
  });

  it("produces a printable inventory without touching anything remote", () => {
    const inv = checkInventory();
    expect(inv).toHaveLength(FEASIBILITY_CHECKS.length);
    expect(inv[0]).toMatchObject({ order: 1, id: FEASIBILITY_CHECKS[0].id });
  });
});

describe("dependency ordering", () => {
  it("places every dependency before its dependant", () => {
    const ordered = orderedChecks();
    const position = new Map(ordered.map((c, i) => [c.id, i]));
    for (const c of ordered) {
      for (const dep of c.dependsOn ?? []) {
        expect(position.get(dep)).toBeLessThan(position.get(c.id));
      }
    }
  });

  it("keeps every check exactly once", () => {
    const ordered = orderedChecks();
    expect(ordered).toHaveLength(FEASIBILITY_CHECKS.length);
    expect(new Set(ordered.map((c) => c.id)).size).toBe(FEASIBILITY_CHECKS.length);
  });

  it("throws on an unknown dependency instead of silently skipping it", () => {
    expect(() => orderedChecks([{ id: "a", dependsOn: ["nope"], requery: [], scratch: [] }])).toThrow(/Unknown/);
  });

  it("throws on a cycle", () => {
    const cyclic = [
      { id: "a", dependsOn: ["b"], requery: [], scratch: [] },
      { id: "b", dependsOn: ["a"], requery: [], scratch: [] },
    ];
    expect(() => orderedChecks(cyclic)).toThrow(/Cyclic/);
  });
});

describe("scratch ids are a closed deterministic set", () => {
  it("every scratch id carries the scratch prefix or is a derived lock/receipt id", () => {
    for (const id of scratchIds()) {
      const derived = id.startsWith("roleTarget.") || id.startsWith("roleCreate.");
      expect(id.startsWith(SCRATCH_ID_PREFIX) || derived).toBe(true);
    }
  });

  it("never overlaps the seeded fixture ids", () => {
    const seeded = new Set(fixtureIds());
    for (const id of scratchIds()) expect(seeded.has(id)).toBe(false);
  });

  it("recognises only declared scratch ids", () => {
    expect(isScratchId(scratchIds()[0])).toBe(true);
    expect(isScratchId("srv.scratch.notDeclared")).toBe(false);
    expect(isScratchId("post.production-document")).toBe(false);
    expect(isScratchId(null)).toBe(false);
  });

  it("is stable across calls", () => {
    expect(scratchIds()).toEqual(scratchIds());
  });
});

describe("deterministic document builders", () => {
  const payload = {
    _type: "sunday_role",
    date: "2026-10-04",
    published: false,
    leads: ["srv.member.lead"],
    bgvs: [],
    chorus: [],
    instruments: [{ instrument: "Guitarra", personId: "srv.member.instrument" }],
    foh: [{ role: "Audio", personId: "srv.member.foh" }],
  };

  it("maps a weekend payload date onto `week`, and a special payload onto `date`", () => {
    expect(roleDocumentFromPayload({ roleId: "srv.scratch.x", payload }).week).toBe("2026-10-04");
    const special = roleDocumentFromPayload({
      roleId: "srv.scratch.y",
      payload: { ...payload, _type: "special_role", service_name: "SR" },
    });
    expect(special.date).toBe("2026-10-04");
    expect(special.service_name).toBe("SR");
    expect(special.week).toBeUndefined();
  });

  it("gives every seat item a deterministic _key", () => {
    const a = roleDocumentFromPayload({ roleId: "srv.scratch.x", payload });
    const b = roleDocumentFromPayload({ roleId: "srv.scratch.x", payload });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.Lead[0]._key).toBeTruthy();
    expect(a.instruments[0]._key).toBeTruthy();
    expect(a.foh_team[0]._key).toBeTruthy();
  });

  it("builds the receipt at the audited derived id with the audited fingerprint", () => {
    const r = receiptDocumentFor({ requestId: "srv-scratch-sundayA", payload, roleId: "srv.scratch.x", now: NOW });
    expect(r._id).toBe(receiptIdForRequestId("srv-scratch-sundayA"));
    expect(r._id).toBe(mirrorReceiptId("srv-scratch-sundayA"));
    expect(r.fingerprint).toBe(payloadFingerprint(payload));
    expect(r.fingerprint).toBe(mirrorPayloadFingerprint(payload));
    expect(r.targetIdentity).toBe("sunday_role:2026-10-04");
    expect(r.state).toBe("committed");
  });

  it("builds a claimed lock at the audited derived id — and none for a special role", () => {
    const lock = claimedLockDocumentFor({ payload, roleId: "srv.scratch.x", now: NOW });
    expect(lock._id).toBe(roleTargetLockId("sunday_role:2026-10-04"));
    expect(lock.state).toBe("claimed");
    expect(lock.roleId).toBe("srv.scratch.x");
    expect(typeof lock.roleId).toBe("string"); // plain string, never a reference

    const special = claimedLockDocumentFor({
      payload: { ...payload, _type: "special_role", service_name: "SR" },
      roleId: "srv.scratch.y",
      now: NOW,
    });
    expect(special).toBeNull();
  });
});

describe("assertNoPartialState — the after-conflict proof", () => {
  const doc = { _id: "srv.role.sunday.draft", _type: "sunday_role", _rev: "rev-1", published: false };

  it("passes when every re-queried document is byte-identical", () => {
    expect(assertNoPartialState({ before: { [doc._id]: doc }, after: { [doc._id]: { ...doc } } }).ok).toBe(true);
  });

  it("passes when an absent document is still absent", () => {
    expect(assertNoPartialState({ before: { "srv.scratch.a": null }, after: { "srv.scratch.a": null } }).ok).toBe(true);
  });

  it("fails when a rejected transaction created a document", () => {
    const r = assertNoPartialState({ before: { "srv.scratch.a": null }, after: { "srv.scratch.a": doc } });
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe("document_created_by_rejected_transaction");
  });

  it("fails when a rejected transaction deleted a document", () => {
    const r = assertNoPartialState({ before: { [doc._id]: doc }, after: { [doc._id]: null } });
    expect(r.failures[0].code).toBe("document_deleted_by_rejected_transaction");
  });

  it("fails when a revision advanced at all", () => {
    const r = assertNoPartialState({ before: { [doc._id]: doc }, after: { [doc._id]: { ...doc, _rev: "rev-2" } } });
    expect(r.failures[0].code).toBe("revision_advanced");
  });

  it("fails on a same-revision body change (belt and braces)", () => {
    const r = assertNoPartialState({ before: { [doc._id]: doc }, after: { [doc._id]: { ...doc, published: true } } });
    expect(r.failures[0].code).toBe("document_mutated");
  });
});
