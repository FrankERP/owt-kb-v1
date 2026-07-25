// scripts/lib/__tests__/sr-verification-login-events.test.mjs
//
// Service Readiness A3 §4 "Run-owned credentials login events" — the guarded
// cleanup half, offline.
//
// What these tests defend: a verification run creates `loginEvent` documents with
// RANDOM ids (auth.ts does not control them), so cleanup is the one place where a
// broad delete would be tempting. The rules proven here are that the ONLY query
// issued is the exact run + deployment ownership predicate, that the only ids ever
// deleted are ids that predicate returned AND that revalidated against the full
// ownership tuple, that a late event arriving after a failure is still captured,
// and that zero run-owned events remain after both success and forced failure.
//
// Nothing here touches the network: the client is an in-memory fake that REFUSES
// any query other than the exact predicate, so a widened query fails the test
// rather than silently passing.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOGIN_EVENT_OWNERSHIP_FIELDS,
  LOGIN_EVENT_TYPE,
  RUN_OWNED_LOGIN_EVENT_QUERY,
  evaluateLoginEventCollision,
  filterRunOwnedLoginEvents,
  runOwnedLoginEventParams,
  validateRunOwnedLoginEvent,
  verifyLoginEventCleanup,
} from "../sr-verification.mjs";
import {
  deleteRunOwnedLoginEvents,
  fetchRunOwnedLoginEvents,
  verifyRunOwnedLoginEventsGone,
} from "../sr-verification-runtime.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const RUN_ID = "run-7f3a9c21b4e85d06";
const SHA = "c".repeat(40);
const DEPLOYMENT_ID = "dpl_9aBcDeFgHiJkLmNo";
const IDENTITY = { runId: RUN_ID, candidateSha: SHA, deploymentId: DEPLOYMENT_ID };

let attempt = 0;
function ownedEvent(over = {}) {
  attempt += 1;
  return {
    _id: `login-${Math.random().toString(36).slice(2, 10)}`,
    _rev: `rev-${attempt}`,
    _type: LOGIN_EVENT_TYPE,
    email: "srv-member-admin@sr-verify.invalid",
    provider: "credentials",
    timestamp: "2026-07-25T18:00:00.000Z",
    runId: RUN_ID,
    attemptId: `attempt-000${attempt}-9ab3c7de`,
    candidateSha: SHA,
    deploymentId: DEPLOYMENT_ID,
    ...over,
  };
}

/** An ordinary (unowned) sign-in event: none of the four ownership fields. */
function ordinaryEvent(id) {
  return {
    _id: id,
    _rev: "rev-ordinary",
    _type: LOGIN_EVENT_TYPE,
    email: "someone@example.com",
    provider: "google",
    timestamp: "2026-07-25T17:00:00.000Z",
  };
}

/**
 * In-memory Sanity stand-in. It understands EXACTLY ONE query — the run-owned
 * predicate — and throws on anything else, so a broadened query cannot pass.
 */
function fakeClient(initial = []) {
  const store = new Map(initial.map((d) => [d._id, { ...d }]));
  const queries = [];
  const projection = (d) => ({
    _id: d._id,
    _rev: d._rev,
    _type: d._type,
    runId: d.runId,
    attemptId: d.attemptId,
    candidateSha: d.candidateSha,
    deploymentId: d.deploymentId,
  });
  return {
    store,
    queries,
    async fetch(query, params) {
      queries.push({ query, params });
      if (query !== RUN_OWNED_LOGIN_EVENT_QUERY) {
        throw new Error(`Refused: only the exact run-owned predicate may be issued. Got: ${query}`);
      }
      return [...store.values()]
        .filter(
          (d) =>
            d._type === LOGIN_EVENT_TYPE &&
            d.runId !== undefined &&
            d.runId === params.runId &&
            d.deploymentId !== undefined &&
            d.deploymentId === params.deploymentId,
        )
        .map(projection);
    },
    transaction() {
      const ops = [];
      const tx = {
        patch(id, build) {
          const record = { kind: "patch", id, rev: null, fields: null };
          build({
            ifRevisionId(rev) {
              record.rev = rev;
              return this;
            },
            set(fields) {
              record.fields = fields;
              return this;
            },
          });
          ops.push(record);
          return tx;
        },
        delete(id) {
          ops.push({ kind: "delete", id });
          return tx;
        },
        async commit() {
          for (const op of ops) {
            if (op.kind !== "patch") continue;
            const doc = store.get(op.id);
            if (!doc) throw new Error(`patch target missing: ${op.id}`);
            if (op.rev && doc._rev !== op.rev) throw new Error(`revision mismatch: ${op.id}`);
          }
          for (const op of ops) if (op.kind === "delete") store.delete(op.id);
          return { ops };
        },
      };
      return tx;
    },
  };
}

// ── The predicate ───────────────────────────────────────────────────────────

describe("run-owned login event predicate", () => {
  it("is parameterized on the run id AND the deployment id, and on nothing else", () => {
    expect(RUN_OWNED_LOGIN_EVENT_QUERY).toContain(`_type == "loginEvent"`);
    expect(RUN_OWNED_LOGIN_EVENT_QUERY).toContain("runId == $runId");
    expect(RUN_OWNED_LOGIN_EVENT_QUERY).toContain("deploymentId == $deploymentId");
    expect(RUN_OWNED_LOGIN_EVENT_QUERY).toContain("defined(runId)");
    expect(RUN_OWNED_LOGIN_EVENT_QUERY).toContain("defined(deploymentId)");
    // Never by email, member, provider or time.
    for (const field of ["email", "member", "provider", "timestamp"]) {
      expect(RUN_OWNED_LOGIN_EVENT_QUERY, field).not.toContain(`${field} ==`);
    }
  });

  it("refuses to build params from an incomplete run identity", () => {
    expect(runOwnedLoginEventParams(IDENTITY)).toEqual({ runId: RUN_ID, deploymentId: DEPLOYMENT_ID });
    expect(runOwnedLoginEventParams({ runId: RUN_ID })).toBeNull();
    expect(runOwnedLoginEventParams({ deploymentId: DEPLOYMENT_ID })).toBeNull();
    expect(runOwnedLoginEventParams({})).toBeNull();
    expect(runOwnedLoginEventParams()).toBeNull();
  });

  it("declares exactly the four ownership fields", () => {
    expect([...LOGIN_EVENT_OWNERSHIP_FIELDS]).toEqual(["runId", "attemptId", "candidateSha", "deploymentId"]);
  });
});

// ── Full-tuple validation ───────────────────────────────────────────────────

describe("validateRunOwnedLoginEvent", () => {
  it("accepts a document whose complete ownership tuple matches", () => {
    expect(validateRunOwnedLoginEvent(ownedEvent(), IDENTITY)).toEqual({ ok: true, reason: null });
  });

  it("rejects a foreign run, deployment or candidate SHA", () => {
    expect(validateRunOwnedLoginEvent(ownedEvent({ runId: "run-other" }), IDENTITY).reason).toBe("foreign_run");
    expect(validateRunOwnedLoginEvent(ownedEvent({ deploymentId: "dpl_other" }), IDENTITY).reason).toBe(
      "foreign_deployment",
    );
    expect(validateRunOwnedLoginEvent(ownedEvent({ candidateSha: "f".repeat(40) }), IDENTITY).reason).toBe(
      "candidate_sha_mismatch",
    );
  });

  it("rejects a document with no attempt id (it could not be reconciled)", () => {
    expect(validateRunOwnedLoginEvent(ownedEvent({ attemptId: undefined }), IDENTITY).reason).toBe("missing_attempt_id");
    expect(validateRunOwnedLoginEvent(ownedEvent({ attemptId: "" }), IDENTITY).reason).toBe("missing_attempt_id");
  });

  it("rejects a wrong type, a missing id, and an incomplete run identity", () => {
    expect(validateRunOwnedLoginEvent(ownedEvent({ _type: "teamMembers" }), IDENTITY).reason).toBe("wrong_type");
    expect(validateRunOwnedLoginEvent(ownedEvent({ _id: undefined }), IDENTITY).reason).toBe("missing_id");
    expect(validateRunOwnedLoginEvent(ownedEvent(), { runId: RUN_ID }).reason).toBe("invalid_run_identity");
    expect(validateRunOwnedLoginEvent(null, IDENTITY).reason).toBe("not_a_document");
  });

  it("derives the deletable id set only from the supplied documents", () => {
    const mine = ownedEvent();
    const theirs = ownedEvent({ runId: "run-other" });
    const { deletable, refused } = filterRunOwnedLoginEvents([mine, theirs], IDENTITY);
    expect(deletable).toEqual([{ _id: mine._id, _rev: mine._rev }]);
    expect(refused).toEqual([{ id: theirs._id, reason: "foreign_run" }]);
  });
});

// ── Collision refusal ───────────────────────────────────────────────────────

describe("pre-run collision check", () => {
  it("passes when the exact predicate returns nothing", () => {
    expect(evaluateLoginEventCollision({ existing: [] })).toEqual({ ok: true, reason: null, collidingIds: [] });
  });

  it("refuses (and never deletes) a pre-existing run/deployment match", async () => {
    const preexisting = ownedEvent();
    const client = fakeClient([preexisting, ordinaryEvent("ordinary-1")]);
    const existing = await fetchRunOwnedLoginEvents(client, IDENTITY);
    const verdict = evaluateLoginEventCollision({ existing });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("run_id_collision");
    expect(verdict.collidingIds).toEqual([preexisting._id]);
    // The collision aborts the run; the pre-existing document belongs to whoever
    // wrote it and stays exactly where it is.
    expect(client.store.has(preexisting._id)).toBe(true);
  });
});

// ── The exact-id cleanup ────────────────────────────────────────────────────

describe("exact-id cleanup", () => {
  it("deletes only the run's own events and leaves every other login event alone", async () => {
    const mine = [ownedEvent(), ownedEvent()];
    const foreignRun = ownedEvent({ runId: "run-someone-else" });
    const foreignDeployment = ownedEvent({ deploymentId: "dpl_someoneelse" });
    const ordinary = ordinaryEvent("ordinary-1");
    const client = fakeClient([...mine, foreignRun, foreignDeployment, ordinary]);

    const owned = await fetchRunOwnedLoginEvents(client, IDENTITY);
    expect(owned.map((d) => d._id).sort()).toEqual(mine.map((d) => d._id).sort());

    const { deletedIds, refused } = await deleteRunOwnedLoginEvents(client, owned, IDENTITY);
    expect(deletedIds.sort()).toEqual(mine.map((d) => d._id).sort());
    expect(refused).toEqual([]);

    // Everything not owned by this run survives.
    expect([...client.store.keys()].sort()).toEqual(
      [foreignRun._id, foreignDeployment._id, ordinary._id].sort(),
    );

    const { verdict } = await verifyRunOwnedLoginEventsGone(client, IDENTITY);
    expect(verdict).toEqual({ ok: true, failures: [] });

    // Every query issued was the exact predicate with the exact two params.
    for (const q of client.queries) {
      expect(q.query).toBe(RUN_OWNED_LOGIN_EVENT_QUERY);
      expect(q.params).toEqual({ runId: RUN_ID, deploymentId: DEPLOYMENT_ID });
    }
  });

  it("deletes under a revision precondition, so a concurrently mutated event survives", async () => {
    const mine = ownedEvent();
    const client = fakeClient([mine]);
    const owned = await fetchRunOwnedLoginEvents(client, IDENTITY);
    // Someone else revised the document between the read and the delete.
    client.store.get(mine._id)._rev = "rev-changed";
    await expect(deleteRunOwnedLoginEvents(client, owned, IDENTITY)).rejects.toThrow(/revision mismatch/);
    expect(client.store.has(mine._id)).toBe(true);
  });

  it("refuses an id the predicate did not return, even if handed one directly", async () => {
    const client = fakeClient([ordinaryEvent("ordinary-1")]);
    const { deletedIds, refused } = await deleteRunOwnedLoginEvents(
      client,
      [ordinaryEvent("ordinary-1")],
      IDENTITY,
    );
    expect(deletedIds).toEqual([]);
    expect(refused).toEqual([{ id: "ordinary-1", reason: "foreign_run" }]);
    expect(client.store.has("ordinary-1")).toBe(true);
  });

  it("refuses to query at all when the run identity is incomplete", async () => {
    const client = fakeClient([ownedEvent()]);
    await expect(fetchRunOwnedLoginEvents(client, { runId: RUN_ID })).rejects.toThrow(/run identity is incomplete/);
    expect(client.queries).toEqual([]);
  });

  it("reports leftovers instead of claiming success", () => {
    expect(verifyLoginEventCleanup({ remaining: [{ _id: "left-1" }] })).toEqual({
      ok: false,
      failures: [{ code: "login_event_not_removed", id: "left-1" }],
    });
    expect(verifyLoginEventCleanup({ remaining: [] }).ok).toBe(true);
  });
});

// ── The orchestrator contract: `finally`, late events, forced failure ────────

/**
 * The shape the harness/reset path must follow: query the exact predicate, delete
 * only the validated ids, then re-query and require zero — all in `finally`, while
 * the lease is still live.
 */
async function cleanupInFinally(client, identity) {
  const owned = await fetchRunOwnedLoginEvents(client, identity);
  const { deletedIds, refused } = await deleteRunOwnedLoginEvents(client, owned, identity);
  const { verdict } = await verifyRunOwnedLoginEventsGone(client, identity);
  return { deletedIds, refused, verdict };
}

describe("cleanup runs in the outermost finally", () => {
  it("leaves zero run-owned events after a SUCCESSFUL scenario", async () => {
    const client = fakeClient([ordinaryEvent("ordinary-1")]);
    let result;
    try {
      // Two sign-ins during the scenario.
      for (const e of [ownedEvent(), ownedEvent()]) client.store.set(e._id, e);
    } finally {
      result = await cleanupInFinally(client, IDENTITY);
    }
    expect(result.deletedIds).toHaveLength(2);
    expect(result.verdict.ok).toBe(true);
    expect([...client.store.keys()]).toEqual(["ordinary-1"]);
  });

  it("leaves zero run-owned events after a FORCED FAILURE, and captures a late event", async () => {
    const client = fakeClient([ordinaryEvent("ordinary-1")]);
    const late = ownedEvent();
    let caught = null;
    let result;
    try {
      const during = ownedEvent();
      client.store.set(during._id, during);
      throw new Error("scenario failed on purpose");
    } catch (err) {
      caught = err;
    } finally {
      // A sign-in event that landed AFTER the failure — the `finally` re-query is
      // what catches it, which is exactly why cleanup re-queries instead of
      // trusting the ids it recorded during the scenario.
      client.store.set(late._id, late);
      result = await cleanupInFinally(client, IDENTITY);
    }
    expect(caught.message).toBe("scenario failed on purpose");
    expect(result.deletedIds).toContain(late._id);
    expect(result.verdict.ok).toBe(true);
    expect([...client.store.keys()]).toEqual(["ordinary-1"]);
  });

  it("does not claim success when a matched event fails full-tuple validation", async () => {
    // A document that matches the predicate (right run + deployment) but whose
    // candidate SHA belongs to a different candidate tree: it is NOT deleted, and
    // the re-query therefore still finds it, so the run reports failure.
    const suspicious = ownedEvent({ candidateSha: "f".repeat(40) });
    const client = fakeClient([suspicious]);
    const result = await cleanupInFinally(client, IDENTITY);
    expect(result.deletedIds).toEqual([]);
    expect(result.refused).toEqual([{ id: suspicious._id, reason: "candidate_sha_mismatch" }]);
    expect(result.verdict.ok).toBe(false);
    expect(client.store.has(suspicious._id)).toBe(true);
  });
});

// ── No broad deletion path exists anywhere ──────────────────────────────────

describe("no broad login-event deletion exists in the repo", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f));

  /** The ONLY files permitted to mention login events next to a delete call. */
  const CLEANUP_FILES = new Set([
    "scripts/lib/sr-verification-runtime.mjs",
    "scripts/service-readiness-verification-reset.mjs",
  ]);

  it("only the guarded reset path pairs login events with a delete call", () => {
    for (const file of tracked) {
      if (file.includes("__tests__")) continue;
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      if (!src.includes("loginEvent") && !src.includes("LoginEvent")) continue;
      if (!/\.delete\(/.test(src)) continue;
      expect(CLEANUP_FILES.has(file), `${file} pairs loginEvent with a delete call`).toBe(true);
    }
  });

  it("adds no general login-event deletion endpoint", () => {
    const route = readFileSync(path.join(REPO_ROOT, "app/api/admin/login-events/route.ts"), "utf8");
    // The admin dashboard reads the audit trail; it exposes no mutation at all.
    expect(route).toContain("export async function GET");
    for (const method of ["DELETE", "POST", "PUT", "PATCH"]) {
      expect(route, `login-events route must not export ${method}`).not.toContain(`export async function ${method}`);
    }
    // And no route anywhere exposes a login-event deletion.
    for (const file of tracked.filter((f) => f.startsWith("app/api/") && !f.includes("__tests__"))) {
      const src = readFileSync(path.join(REPO_ROOT, file), "utf8");
      if (!src.includes("loginEvent")) continue;
      expect(/\.delete\(/.test(src), `${file} deletes login events from an API route`).toBe(false);
    }
  });

  it("the reset script issues the exact predicate and deletes by exact _id", () => {
    const reset = readFileSync(path.join(REPO_ROOT, "scripts/service-readiness-verification-reset.mjs"), "utf8");
    expect(reset).toContain("RUN_OWNED_LOGIN_EVENT_QUERY");
    expect(reset).toContain("fetchRunOwnedLoginEvents");
    expect(reset).toContain("deleteRunOwnedLoginEvents");
    expect(reset).toContain("verifyRunOwnedLoginEventsGone");
    // Cleanup happens under the live lease.
    expect(reset).toContain("await lease.assertOwned();");
  });
});
