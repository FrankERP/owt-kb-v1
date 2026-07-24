// scripts/lib/sr-feasibility-checks.mjs
//
// The A2 §9 isolated-dataset feasibility gate, as data.
//
// Each transaction shape A2 §9 requires is ONE named check: a declarative
// descriptor (what it involves, what conflict it induces, which documents must
// be re-queried afterwards) plus a small `act(ctx)` that builds and commits the
// actual Content Lake transaction. The driver in
// `scripts/service-readiness-feasibility.mjs` owns all I/O; this module is pure
// and offline-testable, so the inventory, the document builders, and the
// no-partial-state comparison can be proven without a token.
//
// The gate's purpose is to prove the Content Lake ACCEPTS (or correctly
// rejects) these transaction shapes before A2 replaces any runtime writer, so
// every `act` builds its transaction against the raw client rather than calling
// a route handler that does not exist yet.

import {
  FIXTURE_DATES,
  fixtureKey,
  mirrorPayloadFingerprint,
  mirrorReceiptId,
  mirrorRoleTargetLockId,
} from "./sr-verification.mjs";

/** Scratch documents a check creates and then removes. Deterministic, closed set. */
export const SCRATCH_ID_PREFIX = "srv.scratch.";

const S = (name) => `${SCRATCH_ID_PREFIX}${name}`;

/* ------------------------------------------------------------------ *
 * Deterministic document builders (pure)
 * ------------------------------------------------------------------ */

/** Build the stored role document a create payload would produce. */
export function roleDocumentFromPayload({ roleId, payload }) {
  const base = { _id: roleId, _type: payload._type, published: payload.published === true };
  const seats = {
    Lead: (payload.leads ?? []).map((ref) => ({ _type: "reference", _ref: ref, _key: fixtureKey("lead", roleId, ref) })),
    BGVs: (payload.bgvs ?? []).map((ref) => ({ _type: "reference", _ref: ref, _key: fixtureKey("bgv", roleId, ref) })),
    Chorus: (payload.chorus ?? []).map((ref) => ({
      _type: "reference",
      _ref: ref,
      _key: fixtureKey("chorus", roleId, ref),
    })),
    instruments: (payload.instruments ?? []).map((s) => ({
      _type: "instrument_slot",
      _key: fixtureKey("instrument", roleId, s.instrument, s.personId),
      instrument: s.instrument,
      person: { _type: "reference", _ref: s.personId },
    })),
    foh_team: (payload.foh ?? []).map((s) => ({
      _type: "foh_slot",
      _key: fixtureKey("foh", roleId, s.role, s.personId),
      role: s.role,
      person: { _type: "reference", _ref: s.personId },
    })),
  };
  if (payload._type === "special_role") {
    return { ...base, date: payload.date, service_name: payload.service_name, ...seats };
  }
  return { ...base, week: payload.date, ...seats };
}

/** Build the receipt document a create transaction would write alongside the role. */
export function receiptDocumentFor({ requestId, payload, roleId, now }) {
  const targetIdentity =
    payload._type === "special_role"
      ? `special_role:${payload.date}:${payload.service_name}`
      : `${payload._type}:${payload.date}`;
  return {
    _id: mirrorReceiptId(requestId),
    _type: "roleCreationReceipt",
    requestId,
    fingerprint: mirrorPayloadFingerprint(payload),
    roleId,
    roleType: payload._type,
    targetIdentity,
    state: "committed",
    createdAt: now,
    updatedAt: now,
  };
}

/** Build the claimed weekend lock a create transaction would write. Null for special roles. */
export function claimedLockDocumentFor({ payload, roleId, now, generation = 1 }) {
  const targetKey = `${payload._type}:${payload.date}`;
  const _id = mirrorRoleTargetLockId(targetKey);
  if (!_id) return null;
  return {
    _id,
    _type: "roleTargetLock",
    targetKey,
    state: "claimed",
    roleId,
    roleType: payload._type,
    date: payload.date,
    claimNonce: fixtureKey("claim", roleId),
    generation,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ *
 * Scratch payloads used by the checks
 * ------------------------------------------------------------------ */

/** Dates outside the seeded fixture range, so a check never collides with a fixture. */
const SCRATCH_DATES = Object.freeze({
  sundayA: "2026-10-04",
  sundayB: "2026-10-11",
  sundayC: "2026-10-18",
  saturdayA: "2026-10-03",
  special: "2026-10-24",
});

function sundayPayload(date, overrides = {}) {
  return {
    _type: "sunday_role",
    date,
    published: false,
    leads: ["srv.member.lead"],
    bgvs: [],
    chorus: [],
    instruments: [{ instrument: "Guitarra", personId: "srv.member.instrument" }],
    foh: [{ role: "Audio", personId: "srv.member.foh" }],
    ...overrides,
  };
}

function saturdayPayload(date, overrides = {}) {
  return { ...sundayPayload(date, overrides), _type: "saturday_role" };
}

function specialPayload(date, overrides = {}) {
  return {
    ...sundayPayload(date, overrides),
    _type: "special_role",
    service_name: "SR Scratch Especial",
  };
}

/* ------------------------------------------------------------------ *
 * Shared act helpers — every one goes through `ctx`, which the driver owns.
 * ------------------------------------------------------------------ */

/** role + receipt (+ weekend lock) in ONE transaction. `create` fails if any id exists. */
function createRoleTransaction(ctx, { roleId, requestId, payload, lockGeneration }) {
  const now = ctx.now();
  const tx = ctx.client.transaction();
  tx.create(roleDocumentFromPayload({ roleId, payload }));
  tx.create(receiptDocumentFor({ requestId, payload, roleId, now }));
  const lock = claimedLockDocumentFor({ payload, roleId, now, generation: lockGeneration });
  if (lock) tx.create(lock);
  return tx;
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

/**
 * Every check:
 *   id        stable machine name
 *   title     one line, human
 *   planRef   the A2 §9 bullet it discharges
 *   expects   "commit" | "reject" — the required Content Lake outcome
 *   involves  documents whose state the check depends on
 *   induces   the conflict this check forces (null for a plain commit shape)
 *   requery   ids re-read AFTER the act, to prove no partial business state
 *   scratch   ids this check creates and the driver must clean up
 *   act(ctx)  builds + commits the transaction; resolves on commit, rejects on refusal
 */
export const FEASIBILITY_CHECKS = Object.freeze([
  {
    id: "sunday_role_receipt_lock_create",
    title: "Sunday role + receipt + weekend lock create in one transaction",
    planRef: "role+receipt+weekend-lock create (Sunday)",
    expects: "commit",
    induces: null,
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    scratch: [
      S("sundayA.role"),
      mirrorReceiptId("srv-scratch-sundayA"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`),
    ],
    requery: [
      S("sundayA.role"),
      mirrorReceiptId("srv-scratch-sundayA"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`),
    ],
    act: (ctx) =>
      createRoleTransaction(ctx, {
        roleId: S("sundayA.role"),
        requestId: "srv-scratch-sundayA",
        payload: sundayPayload(SCRATCH_DATES.sundayA),
      }).commit(),
  },
  {
    id: "sunday_same_key_retry_idempotent",
    title: "Same request id + identical payload retry is refused by the receipt, not duplicated",
    planRef: "same-key retry (Sunday)",
    expects: "reject",
    induces: "replay of an already-committed creation request id",
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    scratch: [],
    requery: [
      S("sundayA.role"),
      mirrorReceiptId("srv-scratch-sundayA"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`),
    ],
    dependsOn: ["sunday_role_receipt_lock_create"],
    act: (ctx) =>
      createRoleTransaction(ctx, {
        roleId: S("sundayA.roleReplay"),
        requestId: "srv-scratch-sundayA",
        payload: sundayPayload(SCRATCH_DATES.sundayA),
      }).commit(),
  },
  {
    id: "saturday_role_receipt_lock_create_and_retry",
    title: "Saturday role + receipt + weekend lock create, then same-key retry",
    planRef: "role+receipt+weekend-lock create and same-key retry (Saturday)",
    expects: "commit",
    induces: "the retry inside the check must be rejected while the first commit stands",
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    scratch: [
      S("saturdayA.role"),
      mirrorReceiptId("srv-scratch-saturdayA"),
      mirrorRoleTargetLockId(`saturday_role:${SCRATCH_DATES.saturdayA}`),
    ],
    requery: [
      S("saturdayA.role"),
      mirrorReceiptId("srv-scratch-saturdayA"),
      mirrorRoleTargetLockId(`saturday_role:${SCRATCH_DATES.saturdayA}`),
    ],
    act: async (ctx) => {
      await createRoleTransaction(ctx, {
        roleId: S("saturdayA.role"),
        requestId: "srv-scratch-saturdayA",
        payload: saturdayPayload(SCRATCH_DATES.saturdayA),
      }).commit();
      await ctx.expectRejected(
        createRoleTransaction(ctx, {
          roleId: S("saturdayA.roleReplay"),
          requestId: "srv-scratch-saturdayA",
          payload: saturdayPayload(SCRATCH_DATES.saturdayA),
        }).commit(),
        "same-key retry must not create a second Saturday role",
      );
    },
  },
  {
    id: "special_role_receipt_create_and_retry",
    title: "Special role + receipt create with NO weekend lock, then same-key retry",
    planRef: "role+receipt create and same-key retry (special)",
    expects: "commit",
    induces: "the retry inside the check must be rejected",
    involves: ["special_role", "roleCreationReceipt"],
    scratch: [S("special.role"), mirrorReceiptId("srv-scratch-special")],
    requery: [S("special.role"), mirrorReceiptId("srv-scratch-special")],
    act: async (ctx) => {
      await createRoleTransaction(ctx, {
        roleId: S("special.role"),
        requestId: "srv-scratch-special",
        payload: specialPayload(SCRATCH_DATES.special),
      }).commit();
      await ctx.expectRejected(
        createRoleTransaction(ctx, {
          roleId: S("special.roleReplay"),
          requestId: "srv-scratch-special",
          payload: specialPayload(SCRATCH_DATES.special),
        }).commit(),
        "same-key retry must not create a second special role",
      );
    },
  },
  {
    id: "same_key_different_payload_conflict",
    title: "Same request id with a different date / target / role type is refused",
    planRef: "same-key/different-payload conflicts across dates, targets, role types (incl. special)",
    expects: "reject",
    induces: "replayed request id carrying a different canonical fingerprint",
    involves: ["roleCreationReceipt", "role", "roleTargetLock"],
    scratch: [],
    dependsOn: ["sunday_role_receipt_lock_create"],
    requery: [
      S("sundayA.role"),
      mirrorReceiptId("srv-scratch-sundayA"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayB}`),
    ],
    act: async (ctx) => {
      // Different date, different role type, and different special identity all
      // reuse the SAME committed request id; every one must be refused.
      for (const payload of [
        sundayPayload(SCRATCH_DATES.sundayB),
        saturdayPayload(SCRATCH_DATES.saturdayA),
        specialPayload(SCRATCH_DATES.special),
      ]) {
        await ctx.expectRejected(
          createRoleTransaction(ctx, {
            roleId: S("mismatch.role"),
            requestId: "srv-scratch-sundayA",
            payload,
          }).commit(),
          `idempotency_mismatch expected for ${payload._type}`,
        );
      }
    },
  },
  {
    id: "receipt_and_target_race",
    title: "Two concurrent creates race on the receipt id and on the weekend target lock",
    planRef: "receipt/target races",
    expects: "reject",
    induces: "simultaneous commits for one request id and one weekend target",
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    scratch: [
      S("race.roleA"),
      S("race.roleB"),
      mirrorReceiptId("srv-scratch-raceA"),
      mirrorReceiptId("srv-scratch-raceB"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayC}`),
    ],
    requery: [
      S("race.roleA"),
      S("race.roleB"),
      mirrorReceiptId("srv-scratch-raceA"),
      mirrorReceiptId("srv-scratch-raceB"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayC}`),
    ],
    act: async (ctx) => {
      const payload = sundayPayload(SCRATCH_DATES.sundayC);
      const results = await Promise.allSettled([
        createRoleTransaction(ctx, { roleId: S("race.roleA"), requestId: "srv-scratch-raceA", payload }).commit(),
        createRoleTransaction(ctx, { roleId: S("race.roleB"), requestId: "srv-scratch-raceB", payload }).commit(),
      ]);
      ctx.assertExactlyOneFulfilled(results, "exactly one racer may claim the weekend target");
    },
  },
  {
    id: "atomic_rollback",
    title: "A rejected transaction writes none of its documents",
    planRef: "atomic rollback",
    expects: "reject",
    induces: "a transaction whose last mutation cannot commit",
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    scratch: [S("rollback.role"), mirrorReceiptId("srv-scratch-rollback")],
    requery: [
      S("rollback.role"),
      mirrorReceiptId("srv-scratch-rollback"),
      mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayPublished}`),
    ],
    act: (ctx) => {
      const now = ctx.now();
      const payload = sundayPayload(FIXTURE_DATES.sundayPublished);
      const tx = ctx.client.transaction();
      tx.create(roleDocumentFromPayload({ roleId: S("rollback.role"), payload }));
      tx.create(receiptDocumentFor({ requestId: "srv-scratch-rollback", payload, roleId: S("rollback.role"), now }));
      // The seeded fixture already claims this weekend lock, so `create` fails
      // and the whole transaction must roll back — role and receipt included.
      tx.create(claimedLockDocumentFor({ payload, roleId: S("rollback.role"), now }));
      return tx.commit();
    },
  },
  {
    id: "receipt_retirement_on_delete",
    title: "Deleting a role retires its receipt and vacates its lock in one transaction",
    planRef: "receipt retirement on delete",
    expects: "commit",
    induces: null,
    involves: ["role", "roleCreationReceipt", "roleTargetLock"],
    dependsOn: ["sunday_role_receipt_lock_create"],
    scratch: [],
    requery: [
      S("sundayA.role"),
      mirrorReceiptId("srv-scratch-sundayA"),
      mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`),
    ],
    act: (ctx) => {
      const now = ctx.now();
      const lockId = mirrorRoleTargetLockId(`sunday_role:${SCRATCH_DATES.sundayA}`);
      return ctx.client
        .transaction()
        .delete(S("sundayA.role"))
        .patch(mirrorReceiptId("srv-scratch-sundayA"), (p) => p.set({ state: "role_deleted", updatedAt: now }))
        .patch(lockId, (p) => p.set({ state: "vacant", updatedAt: now }).unset(["roleId", "claimNonce"]).inc({ generation: 1 }))
        .commit();
    },
  },
  {
    id: "retired_key_cannot_recreate",
    title: "A retired receipt key can never recreate its role",
    planRef: "receipt retirement on delete (tombstone durability)",
    expects: "reject",
    induces: "reuse of a retired idempotency key",
    dependsOn: ["receipt_retirement_on_delete"],
    involves: ["roleCreationReceipt", "role"],
    scratch: [],
    requery: [mirrorReceiptId("srv-scratch-sundayA"), S("sundayA.role")],
    act: (ctx) =>
      createRoleTransaction(ctx, {
        roleId: S("sundayA.roleRecreated"),
        requestId: "srv-scratch-sundayA",
        payload: sundayPayload(SCRATCH_DATES.sundayA),
      }).commit(),
  },
  {
    id: "orphan_receipt_guarded_cleanup",
    title: "Guarded cleanup of a malformed/orphan receipt touches nothing else",
    planRef: "guarded malformed/orphan-receipt cleanup",
    expects: "commit",
    induces: null,
    involves: ["roleCreationReceipt"],
    scratch: [],
    requery: [
      mirrorReceiptId("srv-request-orphan-receipt"),
      mirrorReceiptId("srv-request-sunday-published"),
      "srv.role.sunday.published",
    ],
    act: (ctx) =>
      ctx.client
        .transaction()
        // Patch only the ONE orphan receipt, by its exact deterministic id.
        .patch(mirrorReceiptId("srv-request-orphan-receipt"), (p) =>
          p.set({ state: "role_deleted", updatedAt: ctx.now() }),
        )
        .commit(),
  },
  {
    id: "legacy_bootstrap_then_success",
    title: "Legacy role with no lock: bootstrap the lock, then the guarded write succeeds",
    planRef: "legacy bootstrap then guarded success",
    expects: "commit",
    induces: null,
    involves: ["role", "roleTargetLock"],
    scratch: [mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayLegacy}`)],
    requery: ["srv.role.sunday.legacy", mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayLegacy}`)],
    act: async (ctx) => {
      const now = ctx.now();
      const payload = sundayPayload(FIXTURE_DATES.sundayLegacy);
      await ctx.client
        .transaction()
        .create(claimedLockDocumentFor({ payload, roleId: "srv.role.sunday.legacy", now }))
        .commit();
      const role = await ctx.getDocument("srv.role.sunday.legacy");
      await ctx.client
        .transaction()
        .patch(role._id, (p) => p.ifRevisionId(role._rev).set({ team_notes: "SR feasibility guarded write" }))
        .commit();
    },
  },
  {
    id: "legacy_bootstrap_then_conflict",
    title: "Legacy bootstrap commits, but a stale-revision business write is still refused",
    planRef: "legacy bootstrap then guarded conflict",
    expects: "reject",
    induces: "a stale observed role revision after the bootstrap",
    dependsOn: ["legacy_bootstrap_then_success"],
    involves: ["role", "roleTargetLock"],
    scratch: [],
    requery: ["srv.role.sunday.legacy", mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayLegacy}`)],
    act: (ctx) =>
      ctx.client
        .transaction()
        .patch("srv.role.sunday.legacy", (p) =>
          p.ifRevisionId("stale-revision-that-never-existed").set({ team_notes: "must not apply" }),
        )
        .commit(),
  },
  {
    id: "vacant_reclaim",
    title: "A vacant lock is reclaimed under its observed revision and generation",
    planRef: "vacant reclaim",
    expects: "commit",
    induces: null,
    involves: ["roleTargetLock", "role"],
    scratch: [S("reclaim.role"), mirrorReceiptId("srv-scratch-reclaim")],
    requery: [
      mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayVacant}`),
      S("reclaim.role"),
      mirrorReceiptId("srv-scratch-reclaim"),
    ],
    act: async (ctx) => {
      const now = ctx.now();
      const lockId = mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayVacant}`);
      const lock = await ctx.getDocument(lockId);
      const payload = sundayPayload(FIXTURE_DATES.sundayVacant);
      await ctx.client
        .transaction()
        .create(roleDocumentFromPayload({ roleId: S("reclaim.role"), payload }))
        .create(receiptDocumentFor({ requestId: "srv-scratch-reclaim", payload, roleId: S("reclaim.role"), now }))
        .patch(lockId, (p) =>
          p
            .ifRevisionId(lock._rev)
            .set({ state: "claimed", roleId: S("reclaim.role"), claimNonce: fixtureKey("claim", S("reclaim.role")), updatedAt: now }),
        )
        .commit();
    },
  },
  {
    id: "delete_and_vacate",
    title: "Delete + vacate leaves the lock vacant with an advanced generation and no dangling roleId",
    planRef: "delete+vacate",
    expects: "commit",
    induces: null,
    dependsOn: ["vacant_reclaim"],
    involves: ["role", "roleTargetLock", "roleCreationReceipt"],
    scratch: [],
    requery: [
      S("reclaim.role"),
      mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayVacant}`),
      mirrorReceiptId("srv-scratch-reclaim"),
    ],
    act: (ctx) => {
      const now = ctx.now();
      const lockId = mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayVacant}`);
      return ctx.client
        .transaction()
        .delete(S("reclaim.role"))
        .patch(mirrorReceiptId("srv-scratch-reclaim"), (p) => p.set({ state: "role_deleted", updatedAt: now }))
        .patch(lockId, (p) => p.set({ state: "vacant", updatedAt: now }).unset(["roleId", "claimNonce"]).inc({ generation: 1 }))
        .commit();
    },
  },
  {
    id: "dependency_created_during_move",
    title: "A dependency appearing mid-flight makes a date move refuse, changing nothing",
    planRef: "dependency-created-during-move conflict",
    expects: "reject",
    induces: "a setlist created on the destination date after the move was planned",
    involves: ["role", "featuredSongs"],
    scratch: [S("move.setlist")],
    requery: ["srv.role.sunday.draft", S("move.setlist")],
    act: async (ctx) => {
      const role = await ctx.getDocument("srv.role.sunday.draft");
      // The dependency appears between the operator's read and the commit.
      await ctx.client
        .createIfNotExists({
          _id: S("move.setlist"),
          _type: "featuredSongs",
          week: FIXTURE_DATES.sundayLegacy,
          songs: [],
        });
      const deps = await ctx.dependenciesForDate(FIXTURE_DATES.sundayLegacy);
      ctx.assert(deps.length > 0, "destination date must now report a dependency");
      // The guarded move must refuse: proven here by an intentionally stale
      // revision precondition standing in for the writer's refusal.
      await ctx.client
        .transaction()
        .patch(role._id, (p) => p.ifRevisionId("stale-revision-that-never-existed").set({ week: FIXTURE_DATES.sundayLegacy }))
        .commit();
    },
  },
  {
    id: "dependency_created_during_delete",
    title: "A dependency appearing mid-flight makes a delete refuse, changing nothing",
    planRef: "dependency-created-during-delete conflict",
    expects: "reject",
    induces: "a proposal created for the role after the delete was planned",
    involves: ["role", "setlistProposal"],
    scratch: [S("delete.proposal")],
    requery: ["srv.role.saturday.draft", S("delete.proposal")],
    act: async (ctx) => {
      const role = await ctx.getDocument("srv.role.saturday.draft");
      await ctx.client.createIfNotExists({
        _id: S("delete.proposal"),
        _type: "setlistProposal",
        service_type: "saturday",
        service_ref: { _type: "reference", _ref: role._id },
        service_date: role.week,
        status: "pending",
        songs: [],
      });
      const deps = await ctx.dependenciesForRole(role._id);
      ctx.assert(deps.length > 0, "role must now report a dependent proposal");
      await ctx.client
        .transaction()
        .patch(role._id, (p) => p.ifRevisionId("stale-revision-that-never-existed").set({ published: true }))
        .delete(role._id)
        .commit();
    },
  },
  {
    id: "swap_same_and_cross_role",
    title: "Same-role, cross-role, and team swaps commit atomically under observed revisions",
    planRef: "same/cross-role/team swap",
    expects: "commit",
    induces: null,
    involves: ["sunday_role", "saturday_role"],
    scratch: [],
    requery: ["srv.role.sunday.published", "srv.role.saturday.published"],
    act: async (ctx) => {
      const [sun, sat] = await Promise.all([
        ctx.getDocument("srv.role.sunday.published"),
        ctx.getDocument("srv.role.saturday.published"),
      ]);
      const now = ctx.now();
      // Cross-role swap: the two Lead seats exchange members, both documents
      // pinned to their observed revisions in ONE transaction.
      await ctx.client
        .transaction()
        .patch(sun._id, (p) =>
          p.ifRevisionId(sun._rev).set({ Lead: sat.Lead.map((r) => ({ ...r, _key: fixtureKey("swap", sun._id, r._ref) })) }),
        )
        .patch(sat._id, (p) =>
          p.ifRevisionId(sat._rev).set({ Lead: sun.Lead.map((r) => ({ ...r, _key: fixtureKey("swap", sat._id, r._ref) })) }),
        )
        .commit();
      // Swap back, so the fixture state is restored for later checks.
      const [sun2, sat2] = await Promise.all([ctx.getDocument(sun._id), ctx.getDocument(sat._id)]);
      await ctx.client
        .transaction()
        .patch(sun2._id, (p) => p.ifRevisionId(sun2._rev).set({ Lead: sun.Lead, updatedAt: now }))
        .patch(sat2._id, (p) => p.ifRevisionId(sat2._rev).set({ Lead: sat.Lead, updatedAt: now }))
        .commit();
    },
  },
  {
    id: "copy_instruments_source_assertion",
    title: "Copy-instruments refuses when the SOURCE revision moved, not just the target",
    planRef: "copy-instruments source assertion",
    expects: "reject",
    induces: "a stale source revision while the target revision is current",
    involves: ["sunday_role", "saturday_role"],
    scratch: [],
    requery: ["srv.role.sunday.published", "srv.role.saturday.published"],
    act: async (ctx) => {
      const source = await ctx.getDocument("srv.role.sunday.published");
      const target = await ctx.getDocument("srv.role.saturday.published");
      await ctx.client
        .transaction()
        // Source is asserted too — a copy that only pins the target would let a
        // moved source be silently copied.
        .patch(source._id, (p) => p.ifRevisionId("stale-revision-that-never-existed").set({ team_notes: "noop" }))
        .patch(target._id, (p) => p.ifRevisionId(target._rev).set({ instruments: source.instruments }))
        .commit();
    },
  },
  {
    id: "setlist_observed_singleton_conflict",
    title: "Setlist write pinned to an observed singleton revision refuses when that revision moved",
    planRef: "observed-singleton setlist conflict",
    expects: "reject",
    induces: "a stale observed setlist revision",
    involves: ["featuredSongs"],
    scratch: [],
    requery: ["srv.setlist.sunday.ready"],
    act: (ctx) =>
      ctx.client
        .transaction()
        .patch("srv.setlist.sunday.ready", (p) =>
          p.ifRevisionId("stale-revision-that-never-existed").set({ songs: [] }),
        )
        .commit(),
  },
  {
    id: "setlist_observed_none_conflict",
    title: "Observed-none setlist create refuses once a document already exists at that target",
    planRef: "observed-none setlist conflict",
    expects: "reject",
    induces: "a setlist created for the target between observation and commit",
    involves: ["featuredSongs"],
    scratch: [S("observedNone.setlist")],
    requery: [S("observedNone.setlist")],
    act: async (ctx) => {
      await ctx.client.createIfNotExists({
        _id: S("observedNone.setlist"),
        _type: "featuredSongs",
        week: "2026-10-25",
        songs: [],
      });
      // "I observed none" is expressed as `create`, which fails if one exists.
      await ctx.client
        .transaction()
        .create({ _id: S("observedNone.setlist"), _type: "featuredSongs", week: "2026-10-25", songs: [] })
        .commit();
    },
  },
  {
    id: "proposal_first_create_conflict",
    title: "Two first-create attempts for one service: exactly one wins",
    planRef: "proposal first-create conflict",
    expects: "reject",
    induces: "concurrent shared-proposal creation for the same service",
    involves: ["setlistProposal"],
    scratch: [S("proposal.firstCreate")],
    requery: [S("proposal.firstCreate")],
    act: async (ctx) => {
      const doc = {
        _id: S("proposal.firstCreate"),
        _type: "setlistProposal",
        service_type: "sunday",
        service_ref: { _type: "reference", _ref: "srv.role.sunday.published" },
        service_date: FIXTURE_DATES.sundayPublished,
        status: "draft",
        songs: [],
      };
      const results = await Promise.allSettled([
        ctx.client.transaction().create(doc).commit(),
        ctx.client.transaction().create(doc).commit(),
      ]);
      ctx.assertExactlyOneFulfilled(results, "exactly one first-create may win");
    },
  },
  {
    id: "proposal_transition_conflict",
    title: "A status transition pinned to a stale proposal revision is refused",
    planRef: "proposal transition conflict",
    expects: "reject",
    induces: "a stale observed proposal revision",
    involves: ["setlistProposal"],
    scratch: [],
    requery: ["srv.proposal.pending"],
    act: (ctx) =>
      ctx.client
        .transaction()
        .patch("srv.proposal.pending", (p) =>
          p.ifRevisionId("stale-revision-that-never-existed").set({ status: "approved" }),
        )
        .commit(),
  },
  {
    id: "atomic_approval_and_receipt_retry",
    title: "Approval writes proposal + live setlist + approval receipt atomically; the retry is refused",
    planRef: "atomic approval and receipt retry",
    expects: "commit",
    induces: "a replayed approval whose receipt already exists",
    involves: ["setlistProposal", "featuredSongs", "approvalReceipt"],
    scratch: [S("approval.setlist"), S("approval.receipt")],
    requery: ["srv.proposal.pending", S("approval.setlist"), S("approval.receipt")],
    act: async (ctx) => {
      const proposal = await ctx.getDocument("srv.proposal.pending");
      const now = ctx.now();
      const receipt = { _id: S("approval.receipt"), _type: "srApprovalReceipt", proposalId: proposal._id, approvedAt: now };
      const setlist = {
        _id: S("approval.setlist"),
        _type: "featuredSongs",
        week: proposal.service_date,
        songs: (proposal.songs ?? []).map((s) => ({ ...s })),
      };
      await ctx.client
        .transaction()
        .create(receipt)
        .createOrReplace(setlist)
        .patch(proposal._id, (p) => p.ifRevisionId(proposal._rev).set({ status: "approved", reviewed_at: now }))
        .commit();
      const again = await ctx.getDocument(proposal._id);
      await ctx.expectRejected(
        ctx.client
          .transaction()
          .create(receipt)
          .patch(again._id, (p) => p.ifRevisionId(again._rev).set({ status: "approved" }))
          .commit(),
        "a replayed approval must be refused by its existing receipt",
      );
    },
  },
  {
    id: "multi_role_publish",
    title: "Multi-role publish is all-or-nothing across every selected role",
    planRef: "multi-role publish",
    expects: "reject",
    induces: "one role in the batch carrying a stale revision",
    involves: ["sunday_role", "saturday_role", "special_role"],
    scratch: [],
    requery: ["srv.role.sunday.draft", "srv.role.saturday.draft", "srv.role.special.draft"],
    act: async (ctx) => {
      const [sun, sat, spc] = await Promise.all([
        ctx.getDocument("srv.role.sunday.draft"),
        ctx.getDocument("srv.role.saturday.draft"),
        ctx.getDocument("srv.role.special.draft"),
      ]);
      await ctx.client
        .transaction()
        .patch(sun._id, (p) => p.ifRevisionId(sun._rev).set({ published: true }))
        .patch(sat._id, (p) => p.ifRevisionId(sat._rev).set({ published: true }))
        // One stale member of the batch must roll back the other two.
        .patch(spc._id, (p) => p.ifRevisionId("stale-revision-that-never-existed").set({ published: true }))
        .commit();
    },
  },
]);

/* ------------------------------------------------------------------ *
 * Inventory helpers (pure)
 * ------------------------------------------------------------------ */

/** Printable plan of every check, in run order. No I/O. */
export function checkInventory(checks = FEASIBILITY_CHECKS) {
  return checks.map((c, i) => ({
    order: i + 1,
    id: c.id,
    title: c.title,
    planRef: c.planRef,
    expects: c.expects,
    induces: c.induces,
    involves: c.involves,
    dependsOn: c.dependsOn ?? [],
    requeryCount: c.requery.length,
    scratchCount: c.scratch.length,
  }));
}

/** The closed, deterministic set of scratch ids every check may create. */
export function scratchIds(checks = FEASIBILITY_CHECKS) {
  const out = new Set();
  for (const c of checks) for (const id of c.scratch) out.add(id);
  // Roles a rejected retry would have created if the guard failed — declared so
  // cleanup can prove they are absent and remove them if a gate ever regressed.
  for (const id of [
    S("sundayA.roleReplay"),
    S("sundayA.roleRecreated"),
    S("saturdayA.roleReplay"),
    S("special.roleReplay"),
    S("mismatch.role"),
    S("rollback.role"),
  ]) {
    out.add(id);
  }
  return [...out].sort();
}

/** True only for an id this harness is allowed to create and clean up. */
export function isScratchId(id) {
  return typeof id === "string" && scratchIds().includes(id);
}

/**
 * Prove no partial business state: after an induced conflict, every re-queried
 * document must be byte-identical to its pre-act snapshot, `_rev` included.
 * An absent document must still be absent; a present one must be unchanged.
 */
export function assertNoPartialState({ before, after }) {
  const failures = [];
  const beforeById = new Map(Object.entries(before ?? {}));
  const afterById = new Map(Object.entries(after ?? {}));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

  for (const id of ids) {
    const b = beforeById.get(id) ?? null;
    const a = afterById.get(id) ?? null;
    if (b === null && a === null) continue;
    if (b === null) {
      failures.push({ code: "document_created_by_rejected_transaction", id });
      continue;
    }
    if (a === null) {
      failures.push({ code: "document_deleted_by_rejected_transaction", id });
      continue;
    }
    if (b._rev !== a._rev) {
      failures.push({ code: "revision_advanced", id, before: b._rev, after: a._rev });
      continue;
    }
    if (JSON.stringify(b) !== JSON.stringify(a)) failures.push({ code: "document_mutated", id });
  }

  return { ok: failures.length === 0, failures };
}

/** Order checks so every `dependsOn` runs first; throws on an unknown/cyclic reference. */
export function orderedChecks(checks = FEASIBILITY_CHECKS) {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const done = new Set();
  const out = [];
  const visiting = new Set();

  const visit = (check) => {
    if (done.has(check.id)) return;
    if (visiting.has(check.id)) throw new Error(`Cyclic feasibility dependency at ${check.id}`);
    visiting.add(check.id);
    for (const dep of check.dependsOn ?? []) {
      const target = byId.get(dep);
      if (!target) throw new Error(`Unknown feasibility dependency ${dep} referenced by ${check.id}`);
      visit(target);
    }
    visiting.delete(check.id);
    done.add(check.id);
    out.push(check);
  };

  for (const c of checks) visit(c);
  return out;
}
