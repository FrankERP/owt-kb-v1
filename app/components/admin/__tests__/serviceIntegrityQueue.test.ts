// Association + global-integrity-queue tests (Plan B item 6).
//
// The ambient timezone is deliberately NOT America/Mexico_City, matching the
// sibling readiness tests, so nothing here can pass by accident on a
// Mexico-configured machine.
process.env.TZ = "Pacific/Honolulu";

import { describe, expect, it } from "vitest";

import {
  INTEGRITY_ACTION_COPY,
  INTEGRITY_DOMAIN_SOURCE,
  INTEGRITY_KIND_LABEL,
  buildIntegrityCardIndex,
  buildIntegrityQueue,
  cardsFromRoleTargets,
  describeIntegrityReason,
  integrityQueueSummary,
  integrityQueueTone,
  resolveIntegrityCard,
  resolveIntegrityFocus,
  type IntegrityCardRef,
  type IntegrityQueueInput,
} from "../serviceIntegrityQueue";
import { buildRoleTargets, buildSetlistTargets, buildProposalSummary } from "@/app/utils/serviceReadSummary";
import type { ServiceSourceStates } from "../serviceReadiness";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const READY: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

const EMPTY_ROLES = { targets: [], recordIssues: [], lockIssues: [] };
const EMPTY_SETLISTS = { targets: [], recordIssues: [] };
const EMPTY_PROPOSALS = {
  records: [],
  serviceRefConflicts: [],
  targetKeyConflicts: [],
  recordIssues: [],
  draftIds: [],
};

function input(over: Partial<IntegrityQueueInput> = {}): IntegrityQueueInput {
  return {
    sources: READY,
    cards: [],
    roles: EMPTY_ROLES,
    setlists: EMPTY_SETLISTS,
    proposals: EMPTY_PROPOSALS,
    ...over,
  };
}

const SUNDAY_CARD: IntegrityCardRef = {
  cardId: "role-a",
  roleId: "role-a",
  roleTargetKey: "sunday_role:2026-08-02",
  setlistTargetKey: "featuredSongs:2026-08-02",
  validated: true,
};

/** A structurally valid canonical sunday role, so `validateRole` accepts it. */
function sundayRole(over: Record<string, unknown> = {}) {
  return {
    _id: "role-a",
    _rev: "rev-a",
    _type: "sunday_role",
    week: "2026-08-02",
    Lead: [],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

// ── Card index and resolution ────────────────────────────────────────────────

describe("card index / resolution", () => {
  it("indexes only validated cards", () => {
    const index = buildIntegrityCardIndex([
      SUNDAY_CARD,
      { cardId: "role-bad", roleId: "role-bad", roleTargetKey: "sunday_role:2026-08-09", validated: false },
    ]);
    expect(resolveIntegrityCard(index, { roleIds: ["role-a"] })).toBe("role-a");
    expect(resolveIntegrityCard(index, { roleIds: ["role-bad"] })).toBeNull();
    expect(resolveIntegrityCard(index, { roleTargetKeys: ["sunday_role:2026-08-09"] })).toBeNull();
  });

  it("resolves unambiguously by role id, role target key and setlist target key", () => {
    const index = buildIntegrityCardIndex([SUNDAY_CARD]);
    expect(resolveIntegrityCard(index, { roleTargetKeys: ["sunday_role:2026-08-02"] })).toBe("role-a");
    expect(resolveIntegrityCard(index, { setlistTargetKeys: ["featuredSongs:2026-08-02"] })).toBe("role-a");
  });

  it("returns null for zero and for many candidates", () => {
    const index = buildIntegrityCardIndex([
      SUNDAY_CARD,
      { ...SUNDAY_CARD, cardId: "role-b", roleId: "role-b" },
    ]);
    // Same target key on two cards -> ambiguous -> global queue.
    expect(resolveIntegrityCard(index, { roleTargetKeys: ["sunday_role:2026-08-02"] })).toBeNull();
    expect(resolveIntegrityCard(index, { roleIds: ["role-a", "role-b"] })).toBeNull();
    expect(resolveIntegrityCard(index, { roleIds: ["nobody"] })).toBeNull();
    expect(resolveIntegrityCard(index, {})).toBeNull();
  });

  it("ignores blank/null keys", () => {
    const index = buildIntegrityCardIndex([{ ...SUNDAY_CARD, roleTargetKey: null }]);
    expect(resolveIntegrityCard(index, { roleTargetKeys: [null, undefined, ""] })).toBeNull();
    expect(resolveIntegrityCard(index, { roleIds: ["role-a"] })).toBe("role-a");
  });
});

describe("cardsFromRoleTargets", () => {
  it("derives one card per canonical record, with its A1 setlist target key", () => {
    const roles = buildRoleTargets([sundayRole()], [], new Map(), null);
    expect(cardsFromRoleTargets(roles)).toEqual([
      {
        cardId: "role-a",
        roleId: "role-a",
        roleTargetKey: "sunday_role:2026-08-02",
        setlistTargetKey: "featuredSongs:2026-08-02",
        validated: true,
      },
    ]);
  });

  it("uses the Saturday stored typo and the special role's own id", () => {
    const roles = buildRoleTargets(
      [
        sundayRole({ _id: "sat-1", _rev: "r", _type: "saturday_role", week: "2026-08-01" }),
        sundayRole({ _id: "sp-1", _rev: "r", _type: "special_role", week: undefined, date: "2026-08-05" }),
      ],
      [],
      new Map(),
      null,
    );
    const byId = new Map(cardsFromRoleTargets(roles).map((c) => [c.cardId, c]));
    expect(byId.get("sat-1")?.setlistTargetKey).toBe("saturdarSongs:2026-08-01");
    expect(byId.get("sp-1")?.setlistTargetKey).toBe("sp-1");
  });

  it("includes both records of a duplicate target, keeping its issues ambiguous", () => {
    const roles = buildRoleTargets(
      [sundayRole(), sundayRole({ _id: "role-b", _rev: "rev-b" })],
      [],
      new Map(),
      null,
    );
    const cards = cardsFromRoleTargets(roles);
    expect(cards.map((c) => c.cardId)).toEqual(["role-a", "role-b"]);
    const queue = buildIntegrityQueue(input({ roles, cards }));
    expect(queue.entries.find((e) => e.kind === "role_target_duplicate")?.cardId).toBeNull();
  });

  it("derives nothing from a missing inventory", () => {
    expect(cardsFromRoleTargets(null)).toEqual([]);
  });
});

// ── Unassociated issue types land in the global queue ────────────────────────

describe("global queue: unassociated issue types", () => {
  it("puts a draft-only role in the queue", () => {
    const roles = buildRoleTargets([], [{ _id: "drafts.role-z", _type: "sunday_role" }], new Map(), []);
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(1);
    expect(queue.entries[0]).toMatchObject({
      domain: "roles",
      kind: "role_target_draft_conflict",
      ids: ["drafts.role-z"],
      reasons: ["draft_only"],
      relatedIds: ["role-z"],
      cardId: null,
    });
    expect(queue.associatedCount).toBe(0);
  });

  it("puts an invalid-date role in the queue and never on a card", () => {
    const roles = buildRoleTargets([sundayRole({ week: "2026-02-30" })], [], new Map(), []);
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0].kind).toBe("invalid_record");
    expect(queue.entries[0].ids).toEqual(["role-a"]);
    expect(queue.entries[0].reasons).toContain("date");
    expect(queue.byCard["role-a"]).toBeUndefined();
  });

  it("puts an invalid-date setlist in the queue", () => {
    const setlists = buildSetlistTargets(
      [{ _id: "fs-1", _rev: "r1", _type: "featuredSongs", week: "not-a-date", songs: [] }],
      [],
    );
    const queue = buildIntegrityQueue(input({ setlists, cards: [SUNDAY_CARD] }));
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0]).toMatchObject({
      domain: "setlists",
      kind: "setlist_invalid",
      ids: ["fs-1"],
      cardId: null,
    });
    expect(queue.entries[0].reasons).toContain("date");
  });

  it("puts a dangling special proposal in the queue", () => {
    const proposals = buildProposalSummary(
      [
        {
          _id: "prop-x",
          _rev: "r1",
          _type: "setlistProposal",
          service_type: "special",
          service_date: "2026-08-05",
          status: "pending",
          service_ref: "role-gone",
          songs: [],
        },
      ],
      [],
      () => null,
    );
    const queue = buildIntegrityQueue(input({ proposals, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(1);
    expect(queue.entries[0]).toMatchObject({
      domain: "proposals",
      kind: "proposal_invalid",
      ids: ["prop-x"],
      cardId: null,
    });
    expect(queue.entries[0].reasons).toContain("role_unresolved");
    expect(queue.entries[0].relatedIds).toContain("role-gone");
  });

  it("puts a malformed proposal record in the queue", () => {
    const proposals = buildProposalSummary([{ _id: "prop-bad" }], [], () => null);
    const queue = buildIntegrityQueue(input({ proposals }));
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0].kind).toBe("proposal_invalid");
    expect(queue.entries[0].reasons).toContain("service_ref");
  });

  it("puts a lock at an id no canonical target claims (orphan/misfiled) in the queue", () => {
    const roles = buildRoleTargets(
      [],
      [],
      new Map(),
      [
        {
          _id: "roleTarget.sunday_role.2026-09-06",
          _rev: "lr",
          _type: "roleTargetLock",
          targetKey: "sunday_role:2026-09-06",
          roleType: "sunday_role",
          date: "2026-09-06",
          state: "claimed",
          roleId: "role-vanished",
          generation: 0,
        },
      ],
    );
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(1);
    expect(queue.entries[0]).toMatchObject({ kind: "lock", cardId: null });
    expect(queue.entries[0].reasons.join(" ")).toContain("orphan_lock");
    expect(queue.entries[0].ids).toContain("roleTarget.sunday_role.2026-09-06");
  });

  it("puts an unassociated raw proposal draft in the queue", () => {
    const proposals = buildProposalSummary([], [{ _id: "drafts.prop-unknown" }], () => null);
    const queue = buildIntegrityQueue(input({ proposals, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(1);
    expect(queue.entries[0]).toMatchObject({
      kind: "proposal_draft_conflict",
      ids: ["drafts.prop-unknown"],
      cardId: null,
    });
    expect(queue.entries[0].relatedIds).toContain("prop-unknown");
  });

  it("puts an unassociated raw setlist draft in the queue", () => {
    const setlists = buildSetlistTargets([], [{ _id: "drafts.fs-orphan" }]);
    const queue = buildIntegrityQueue(input({ setlists, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(1);
    expect(queue.entries[0]).toMatchObject({
      kind: "setlist_draft_conflict",
      ids: ["drafts.fs-orphan"],
      cardId: null,
    });
  });

  it("keeps a duplicate role target global, because it maps to two cards", () => {
    const roles = buildRoleTargets(
      [sundayRole(), sundayRole({ _id: "role-b", _rev: "rev-b" })],
      [],
      new Map(),
      null,
    );
    const cards: IntegrityCardRef[] = [SUNDAY_CARD, { ...SUNDAY_CARD, cardId: "role-b", roleId: "role-b" }];
    const queue = buildIntegrityQueue(input({ roles, cards }));
    const dup = queue.entries.find((e) => e.kind === "role_target_duplicate");
    expect(dup).toBeDefined();
    expect(dup?.ids).toEqual(["role-a", "role-b"]);
    expect(dup?.cardId).toBeNull();
  });
});

// ── Correct card association ─────────────────────────────────────────────────

describe("card association", () => {
  it("attaches a role-target draft conflict to the single validated card", () => {
    const roles = buildRoleTargets([sundayRole()], [{ _id: "drafts.role-a" }], new Map(), null);
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.associatedCount).toBe(1);
    expect(queue.byCard["role-a"][0]).toMatchObject({
      kind: "role_target_draft_conflict",
      ids: ["drafts.role-a"],
      cardId: "role-a",
    });
    // Dimension-shaped kinds must NEVER be fed back into deriveServiceReadiness.
    expect(queue.cardIssues["role-a"]).toBeUndefined();
  });

  it("attaches a dangling assignment to its own record's card", () => {
    const roles = buildRoleTargets(
      [sundayRole({ Lead: [{ _key: "k1", _type: "reference", _ref: "member-gone" }] })],
      [],
      new Map(),
      null,
    );
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["role-a"][0]).toMatchObject({
      kind: "dangling_assignment",
      ids: ["member-gone"],
      relatedIds: ["role-a"],
    });
  });

  it("attaches a weekend lock issue to the card and exposes it as a readiness issue", () => {
    const roles = buildRoleTargets([sundayRole()], [], new Map(), []);
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["role-a"][0].kind).toBe("lock");
    // `lock` and `legacy` are the only kinds safe to pass as `integrityIssues`.
    expect(queue.cardIssues["role-a"]).toEqual([
      { kind: "lock", blocking: true, ids: ["roleTarget.sunday_role.2026-08-02"], reason: "missing_lock" },
    ]);
  });

  it("associates a lock by its own targetKey, never by a wrong-owner roleId", () => {
    // `role-a` owns sunday 2026-08-02; a lock filed at 2026-09-06 claims it.
    const roles = buildRoleTargets(
      [sundayRole()],
      [],
      new Map(),
      [
        {
          _id: "roleTarget.sunday_role.2026-08-02",
          _rev: "l1",
          _type: "roleTargetLock",
          targetKey: "sunday_role:2026-08-02",
          roleType: "sunday_role",
          date: "2026-08-02",
          state: "claimed",
          roleId: "role-a",
          generation: 0,
        },
        {
          _id: "roleTarget.sunday_role.2026-09-06",
          _rev: "l2",
          _type: "roleTargetLock",
          targetKey: "sunday_role:2026-09-06",
          roleType: "sunday_role",
          date: "2026-09-06",
          state: "claimed",
          roleId: "role-a",
          generation: 0,
        },
      ],
    );
    const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));
    const wrongOwner = [...queue.entries, ...Object.values(queue.byCard).flat()].find((e) =>
      e.reasons.join(" ").includes("wrong_owner"),
    );
    expect(wrongOwner).toBeDefined();
    expect(wrongOwner?.cardId).toBeNull();
    // The wrong owner is named (via `lockIssuesToIntegrity`) but never used to
    // associate the issue to that role's card.
    expect(wrongOwner?.ids).toContain("role-a");
    expect(queue.byCard["role-a"]).toBeUndefined();
  });

  it("attaches a setlist content problem to the card via the setlist target key", () => {
    const setlists = buildSetlistTargets(
      [
        {
          _id: "fs-1",
          _rev: "r1",
          _type: "featuredSongs",
          week: "2026-08-02",
          songs: [{ _key: "a" }],
        },
      ],
      [],
    );
    const queue = buildIntegrityQueue(input({ setlists, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["role-a"][0]).toMatchObject({
      kind: "setlist_invalid",
      ids: ["fs-1"],
      targetKey: "featuredSongs:2026-08-02",
    });
    expect(queue.byCard["role-a"][0].reasons).toContain("missing_song_ref:0");
  });

  it("attaches a special-role setlist draft via the role id target key", () => {
    const special = {
      cardId: "special-1",
      roleId: "special-1",
      roleTargetKey: "special-1",
      setlistTargetKey: "special-1",
      validated: true,
    };
    const setlists = buildSetlistTargets([], [{ _id: "drafts.special-1" }]);
    const queue = buildIntegrityQueue(input({ setlists, cards: [special] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["special-1"][0].kind).toBe("setlist_draft_conflict");
  });

  it("does not double-report content invalidity for a duplicate setlist target", () => {
    const doc = (id: string) => ({
      _id: id,
      _rev: "r",
      _type: "featuredSongs",
      week: "2026-08-02",
      songs: [],
    });
    const setlists = buildSetlistTargets([doc("fs-1"), doc("fs-2")], []);
    const queue = buildIntegrityQueue(input({ setlists, cards: [SUNDAY_CARD] }));
    const all = [...queue.entries, ...Object.values(queue.byCard).flat()];
    expect(all.filter((e) => e.kind === "setlist_invalid")).toHaveLength(0);
    expect(all.filter((e) => e.kind === "setlist_duplicate")).toHaveLength(1);
  });

  it("attaches an invalid proposal that names a validated card", () => {
    const proposals = buildProposalSummary(
      [
        {
          _id: "prop-1",
          _rev: "r1",
          _type: "setlistProposal",
          service_type: "sunday",
          service_date: "2026-08-02",
          status: "not_a_status",
          service_ref: "role-a",
          songs: [],
        },
      ],
      [],
      () => sundayRole(),
    );
    const queue = buildIntegrityQueue(input({ proposals, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["role-a"][0]).toMatchObject({ kind: "proposal_invalid", ids: ["prop-1"] });
    expect(queue.byCard["role-a"][0].reasons).toContain("status");
  });

  it("merges the serviceRef and targetKey conflict views into one entry", () => {
    const proposal = (id: string) => ({
      _id: id,
      _rev: "r",
      _type: "setlistProposal",
      service_type: "sunday",
      service_date: "2026-08-02",
      status: "pending",
      service_ref: "role-a",
      songs: [{ _key: id, play_key: "G", song: { _ref: "song-1" } }],
    });
    const proposals = buildProposalSummary(
      [proposal("prop-1"), proposal("prop-2")],
      [],
      () => sundayRole(),
    );
    expect(proposals.serviceRefConflicts).toHaveLength(1);
    expect(proposals.targetKeyConflicts).toHaveLength(1);
    const queue = buildIntegrityQueue(input({ proposals, cards: [SUNDAY_CARD] }));
    const conflicts = [...queue.entries, ...Object.values(queue.byCard).flat()].filter(
      (e) => e.kind === "proposal_conflict",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(["prop-1", "prop-2"]);
    expect(conflicts[0].reasons).toEqual(["serviceRef_conflict", "targetKey_conflict"]);
    expect(conflicts[0].cardId).toBe("role-a");
  });

  it("attaches a raw proposal draft through its canonical base's service ref", () => {
    const proposals = buildProposalSummary(
      [
        {
          _id: "prop-1",
          _rev: "r1",
          _type: "setlistProposal",
          service_type: "sunday",
          service_date: "2026-08-02",
          status: "pending",
          service_ref: "role-a",
          songs: [],
        },
      ],
      [{ _id: "drafts.prop-1" }],
      () => sundayRole(),
    );
    const queue = buildIntegrityQueue(input({ proposals, cards: [SUNDAY_CARD] }));
    expect(queue.count).toBe(0);
    expect(queue.byCard["role-a"][0]).toMatchObject({
      kind: "proposal_draft_conflict",
      ids: ["drafts.prop-1"],
    });
  });
});

// ── Partial-source honesty ───────────────────────────────────────────────────

describe("partial-source honesty", () => {
  it("never reports clean when a domain failed", () => {
    const queue = buildIntegrityQueue(
      input({ sources: { ...READY, setlistTargets: "error" }, setlists: null }),
    );
    expect(queue.count).toBe(0);
    expect(queue.incomplete).toBe(true);
    expect(queue.unproven).toEqual([{ source: "setlistTargets", state: "error" }]);
    expect(integrityQueueTone(queue)).toBe("unknown");
    expect(integrityQueueSummary(queue)).toBe("Inventario incompleto");
  });

  it("never reports clean while a domain is loading", () => {
    const queue = buildIntegrityQueue(
      input({ sources: { ...READY, proposals: "loading" }, proposals: null }),
    );
    expect(queue.incomplete).toBe(true);
    expect(integrityQueueTone(queue)).toBe("unknown");
  });

  it("treats a ready source with a missing summary as unproven, not as empty", () => {
    const queue = buildIntegrityQueue(input({ roles: null }));
    expect(queue.incomplete).toBe(true);
    expect(queue.unproven).toEqual([{ source: "roleTargets", state: "error" }]);
    expect(integrityQueueTone(queue)).not.toBe("clean");
  });

  it("marks found issues as possibly incomplete when another domain failed", () => {
    const roles = buildRoleTargets([], [{ _id: "drafts.role-z" }], new Map(), []);
    const queue = buildIntegrityQueue(
      input({ sources: { ...READY, proposals: "error" }, roles, proposals: null }),
    );
    expect(queue.count).toBe(1);
    expect(integrityQueueTone(queue)).toBe("issues_incomplete");
    expect(integrityQueueSummary(queue)).toBe("1 problema · inventario incompleto");
  });

  it("reports clean only from a fully proven, empty inventory", () => {
    const queue = buildIntegrityQueue(input());
    expect(queue.incomplete).toBe(false);
    expect(integrityQueueTone(queue)).toBe("clean");
    expect(integrityQueueSummary(queue)).toBe("Sin problemas de integridad");
  });

  it("pluralizes the issue count", () => {
    const roles = buildRoleTargets([], [{ _id: "drafts.a" }, { _id: "drafts.b" }], new Map(), []);
    const queue = buildIntegrityQueue(input({ roles }));
    expect(integrityQueueSummary(queue)).toBe("2 problemas");
  });

  it("maps every domain to its shipped source key", () => {
    expect(INTEGRITY_DOMAIN_SOURCE).toEqual({
      roles: "roleTargets",
      setlists: "setlistTargets",
      proposals: "proposals",
    });
  });
});

// ── Explicit-id navigation ───────────────────────────────────────────────────

describe("explicit-id navigation", () => {
  const roles = buildRoleTargets([], [{ _id: "drafts.role-z" }], new Map(), []);
  const queue = buildIntegrityQueue(input({ roles, cards: [SUNDAY_CARD] }));

  it("focuses the entry carrying the exact id", () => {
    const result = resolveIntegrityFocus(["drafts.role-z"], queue, READY);
    expect(result).toMatchObject({ outcome: "focus", ids: ["drafts.role-z"], missingIds: [] });
    expect(result.outcome === "focus" && result.keys).toEqual([queue.entries[0].key]);
  });

  it("finds card-associated entries too", () => {
    const withDangling = buildIntegrityQueue(
      input({
        roles: buildRoleTargets(
          [sundayRole({ Lead: [{ _key: "k", _type: "reference", _ref: "member-gone" }] })],
          [],
          new Map(),
          null,
        ),
        cards: [SUNDAY_CARD],
      }),
    );
    const result = resolveIntegrityFocus(["member-gone"], withDangling, READY);
    expect(result.outcome).toBe("focus");
  });

  it("distinguishes not-found from a load failure", () => {
    expect(resolveIntegrityFocus(["nope"], queue, READY)).toEqual({
      outcome: "not_found",
      missingIds: ["nope"],
    });
    expect(
      resolveIntegrityFocus(["drafts.role-z"], queue, { ...READY, roleTargets: "error" }),
    ).toMatchObject({ outcome: "load_failed" });
    expect(
      resolveIntegrityFocus(["drafts.role-z"], queue, { ...READY, roleTargets: "loading" }),
    ).toEqual({ outcome: "waiting" });
    expect(resolveIntegrityFocus(["drafts.role-z"], null, READY)).toMatchObject({
      outcome: "load_failed",
    });
  });

  it("reports partially missing ids while still focusing what it found", () => {
    const result = resolveIntegrityFocus(["drafts.role-z", "gone"], queue, READY);
    expect(result).toMatchObject({ outcome: "focus", missingIds: ["gone"] });
  });
});

// ── Entry presentation ───────────────────────────────────────────────────────

describe("entry presentation", () => {
  it("gives every issue kind a Spanish label and a guarded action copy", () => {
    for (const [kind, label] of Object.entries(INTEGRITY_KIND_LABEL)) {
      expect(label.length).toBeGreaterThan(3);
      expect(kind).toBeTruthy();
    }
    for (const copy of Object.values(INTEGRITY_ACTION_COPY)) {
      expect(copy.length).toBeGreaterThan(10);
    }
  });

  it("assigns a support action to coordination-document issues and the guarded operator command otherwise", () => {
    const roles = buildRoleTargets([sundayRole()], [], new Map(), []);
    const queue = buildIntegrityQueue(input({ roles, cards: [] }));
    expect(queue.entries[0]).toMatchObject({ kind: "lock", action: "request_support" });

    const setlists = buildSetlistTargets([], [{ _id: "drafts.fs-1" }]);
    const q2 = buildIntegrityQueue(input({ setlists }));
    expect(q2.entries[0].action).toBe("discard_draft_via_operator");
  });

  // Studio is read-only for all eight protected types (A2 §8), so no queue entry
  // may send an admin there to mutate — the guarded operator command is the route.
  it("never directs cleanup to Studio", () => {
    for (const copy of Object.values(INTEGRITY_ACTION_COPY)) {
      expect(copy).not.toMatch(/\ben Studio\b(?![^.]*solo lectura)/);
    }
    for (const action of Object.keys(INTEGRITY_ACTION_COPY)) {
      expect(action).not.toContain("in_studio");
    }
  });

  it("renders known reasons in Spanish and unknown tags verbatim", () => {
    expect(describeIntegrityReason("draft_only")).toBe("solo existe como borrador");
    expect(describeIntegrityReason("missing_song_ref:2")).toBe("referencia de canción ausente (2)");
    // `lockIssuesToIntegrity` emits `kind: detail` with a space after the colon.
    expect(describeIntegrityReason("malformed_lock: identity")).toBe(
      "bloqueo con datos inválidos (identity)",
    );
    expect(describeIntegrityReason("totally_new_tag")).toBe("totally_new_tag");
  });

  it("keys entries stably from their content", () => {
    const build = () =>
      buildIntegrityQueue(
        input({ roles: buildRoleTargets([], [{ _id: "drafts.role-z" }], new Map(), []) }),
      );
    expect(build().entries[0].key).toBe(build().entries[0].key);
  });
});
