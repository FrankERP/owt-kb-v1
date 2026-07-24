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
  conflictSummary,
  isMutationConflict,
  isScratchId,
  orderedChecks,
  receiptDocumentFor,
  roleDocumentFromPayload,
  scratchIds,
  verifyRaceOutcome,
  verifySoleCreation,
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

  // The regression this guards: a check that asserts its rejections INSIDE
  // `act` resolves, so it must declare `expects: "commit"`. Without a `verify`
  // the driver would then skip the after-state proof entirely and the induced
  // conflict would go unproven while the check still printed a tick.
  it("proves the after-state of every check that induces a conflict", () => {
    for (const c of FEASIBILITY_CHECKS.filter((x) => x.induces)) {
      const proven = c.expects === "reject" || typeof c.verify === "function";
      expect(proven, `${c.id} induces a conflict but declares no after-state proof`).toBe(true);
    }
  });

  // The other regression: a check whose own setup must commit before the
  // conflict can be induced has to re-baseline, and its setup ids have to be
  // re-queried, or the setup write is scored as partial state (or goes unwatched).
  it("re-queries and cleans up every declared setup id", () => {
    const cleanable = new Set(scratchIds());
    for (const c of FEASIBILITY_CHECKS.filter((x) => (x.setup ?? []).length)) {
      for (const id of c.setup) {
        expect(c.requery, `${c.id} setup id ${id} must be re-queried`).toContain(id);
        expect(cleanable.has(id), `${c.id} setup id ${id} must be cleanable`).toBe(true);
      }
      expect(c.act.toString(), `${c.id} declares setup ids but never calls ctx.baseline()`).toMatch(
        /\.baseline\(/,
      );
    }
  });

  it("declares setup ids for every check whose act writes before inducing its conflict", () => {
    for (const c of FEASIBILITY_CHECKS) {
      if (/\.baseline\(/.test(c.act.toString())) {
        expect((c.setup ?? []).length, `${c.id} calls ctx.baseline() but declares no setup ids`).toBeGreaterThan(0);
      }
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

describe("Content Lake conflict classification", () => {
  // The shapes observed against the isolated dataset on 2026-07-24.
  const alreadyExists = {
    statusCode: 409,
    message: 'Mutation failed: Document by ID "srv.x" already exists',
    details: {
      type: "mutationError",
      items: [{ index: 1, error: { type: "documentAlreadyExistsError", id: "srv.x", description: "…" } }],
    },
  };
  const revMismatch = {
    statusCode: 409,
    message: 'Mutation failed: Document "srv.y" has unexpected revision ID',
    details: {
      type: "mutationError",
      items: [
        {
          index: 0,
          error: { type: "documentRevisionIDDoesNotMatchError", currentRevisionID: "a", expectedRevisionID: "b" },
        },
      ],
    },
  };

  it("accepts a 409 mutation conflict", () => {
    expect(isMutationConflict(alreadyExists)).toBe(true);
    expect(isMutationConflict(revMismatch)).toBe(true);
  });

  it("refuses to count a non-conflict failure as a guard firing", () => {
    expect(isMutationConflict({ statusCode: 401, message: "Unauthorized" })).toBe(false);
    expect(isMutationConflict({ statusCode: 500, message: "Internal" })).toBe(false);
    expect(isMutationConflict(new Error("socket hang up"))).toBe(false);
    expect(isMutationConflict(null)).toBe(false);
    expect(isMutationConflict("nope")).toBe(false);
  });

  it("summarises the conflict as one line of evidence", () => {
    expect(conflictSummary(alreadyExists)).toBe("409 documentAlreadyExistsError@srv.x");
    expect(conflictSummary(revMismatch)).toBe("409 documentRevisionIDDoesNotMatchError");
    expect(conflictSummary(null)).toBeNull();
  });
});

describe("verifyRaceOutcome — exactly one racer wins, the loser writes nothing", () => {
  const groups = [
    { role: "srv.scratch.race.roleA", receipt: "roleCreate.raceA" },
    { role: "srv.scratch.race.roleB", receipt: "roleCreate.raceB" },
  ];
  const lockId = "roleTarget.sunday";
  const absent = {
    "srv.scratch.race.roleA": null,
    "srv.scratch.race.roleB": null,
    "roleCreate.raceA": null,
    "roleCreate.raceB": null,
    [lockId]: null,
  };
  const aWon = {
    ...absent,
    "srv.scratch.race.roleA": { _id: "srv.scratch.race.roleA", _rev: "r1" },
    "roleCreate.raceA": { _id: "roleCreate.raceA", _rev: "r1", roleId: "srv.scratch.race.roleA" },
    [lockId]: { _id: lockId, _rev: "r1", state: "claimed", roleId: "srv.scratch.race.roleA" },
  };

  it("passes when one whole triple committed and the loser wrote nothing", () => {
    expect(verifyRaceOutcome({ before: absent, after: aWon, groups, lockId }).ok).toBe(true);
  });

  it("fails when both racers left documents behind", () => {
    const both = { ...aWon, "srv.scratch.race.roleB": { _id: "srv.scratch.race.roleB", _rev: "r1" } };
    const r = verifyRaceOutcome({ before: absent, after: both, groups, lockId });
    expect(r.ok).toBe(false);
    expect(r.failures[0].code).toBe("race_winner_count");
  });

  it("fails when neither racer won", () => {
    const r = verifyRaceOutcome({ before: absent, after: absent, groups, lockId });
    expect(r.failures[0].code).toBe("race_winner_count");
  });

  it("fails when the winner's receipt is missing (a torn triple)", () => {
    const torn = { ...aWon, "roleCreate.raceA": null };
    const r = verifyRaceOutcome({ before: absent, after: torn, groups, lockId });
    expect(r.failures.map((f) => f.code)).toContain("winner_receipt_missing");
  });

  it("fails when the loser left a stray receipt", () => {
    const stray = { ...aWon, "roleCreate.raceB": { _id: "roleCreate.raceB", roleId: "srv.scratch.race.roleB" } };
    const r = verifyRaceOutcome({ before: absent, after: stray, groups, lockId });
    expect(r.failures[0].code).toBe("race_winner_count");
  });

  it("fails when the contended lock was claimed by the loser", () => {
    const wrongLock = { ...aWon, [lockId]: { _id: lockId, state: "claimed", roleId: "srv.scratch.race.roleB" } };
    const r = verifyRaceOutcome({ before: absent, after: wrongLock, groups, lockId });
    expect(r.failures.map((f) => f.code)).toContain("lock_not_claimed_by_winner");
  });

  it("fails when the baseline was not absent, so no race was actually induced", () => {
    const dirty = { ...absent, "srv.scratch.race.roleA": { _id: "srv.scratch.race.roleA" } };
    const r = verifyRaceOutcome({ before: dirty, after: aWon, groups, lockId });
    expect(r.failures.map((f) => f.code)).toContain("race_baseline_not_absent");
  });
});

describe("verifySoleCreation — two racers on one id yield exactly one document", () => {
  const id = "srv.scratch.proposal.firstCreate";

  it("passes when the id was absent and exists afterwards", () => {
    expect(verifySoleCreation({ before: { [id]: null }, after: { [id]: { _id: id, _rev: "r1" } }, id }).ok).toBe(true);
  });

  it("fails when no racer created it", () => {
    const r = verifySoleCreation({ before: { [id]: null }, after: { [id]: null }, id });
    expect(r.failures[0].code).toBe("sole_creation_missing");
  });

  it("fails when the document already existed before the race", () => {
    const r = verifySoleCreation({ before: { [id]: { _id: id } }, after: { [id]: { _id: id } }, id });
    expect(r.failures[0].code).toBe("race_baseline_not_absent");
  });
});
