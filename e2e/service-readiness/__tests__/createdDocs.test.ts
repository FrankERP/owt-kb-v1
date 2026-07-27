// Offline proof that the run-created document ledger can only ever widen the delete
// set to documents THIS RUN created through a deployed route.
//
// This is the second half of the "exact id only" rule: the deterministic fixtures are
// covered by `filterDeletableIds(fixtureIds())`, but a role created through
// `POST /api/admin/roles` gets a server-generated id. Recording it at creation time is
// what keeps cleanup exact instead of discovery-based.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CREATED_LEDGER_FILE,
  evaluateCreatedId,
  readCreatedDocuments,
  recordCreatedDocument,
} from "../lib/createdDocs";
import {
  INFRASTRUCTURE_IDS,
  LEASE_DOC_ID,
  MARKER_DOC_ID,
  fixtureIds,
} from "../../../scripts/lib/sr-verification.mjs";

describe("created-id validation", () => {
  it("accepts a server-generated document id", () => {
    expect(evaluateCreatedId("7f3c1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b")).toEqual({
      ok: true,
      reason: null,
    });
    expect(evaluateCreatedId("roleCreate.".padEnd(20, "a")).ok).toBe(true);
  });

  it("REFUSES the infrastructure documents — the marker and the lease", () => {
    for (const id of INFRASTRUCTURE_IDS as readonly string[]) {
      expect(evaluateCreatedId(id), id).toEqual({ ok: false, reason: "infrastructure_document" });
    }
    expect(evaluateCreatedId(MARKER_DOC_ID).ok).toBe(false);
    expect(evaluateCreatedId(LEASE_DOC_ID).ok).toBe(false);
  });

  it("REFUSES a deterministic fixture id — those belong to the fixture reset", () => {
    for (const id of (fixtureIds() as string[]).slice(0, 8)) {
      expect(evaluateCreatedId(id), id).toEqual({ ok: false, reason: "deterministic_fixture" });
    }
  });

  it("REFUSES a draft id and anything malformed", () => {
    expect(evaluateCreatedId("drafts.srv.role.sunday.published").reason).toBe("draft_id");
    expect(evaluateCreatedId("").reason).toBe("malformed_id");
    expect(evaluateCreatedId("ab").reason).toBe("malformed_id");
    expect(evaluateCreatedId("has/slash/inside").reason).toBe("malformed_id");
    expect(evaluateCreatedId("has space").reason).toBe("malformed_id");
    expect(evaluateCreatedId(undefined).reason).toBe("malformed_id");
    expect(evaluateCreatedId(42).reason).toBe("malformed_id");
  });
});

describe("created-id ledger", () => {
  let cwd: string;
  let dir: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "sr-created-"));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it("appends and reads back distinct ids", () => {
    recordCreatedDocument("aaaaaaaa-1111-2222-3333-444444444444", "spec-a");
    recordCreatedDocument("bbbbbbbb-1111-2222-3333-444444444444", "spec-b");
    // A repeat is harmless: the read de-duplicates.
    recordCreatedDocument("aaaaaaaa-1111-2222-3333-444444444444", "spec-a-again");

    expect(readCreatedDocuments()).toEqual([
      "aaaaaaaa-1111-2222-3333-444444444444",
      "bbbbbbbb-1111-2222-3333-444444444444",
    ]);
  });

  it("THROWS rather than silently dropping a refused id", () => {
    expect(() => recordCreatedDocument(MARKER_DOC_ID, "oops")).toThrow(/infrastructure_document/);
    expect(() => recordCreatedDocument((fixtureIds() as string[])[0], "oops")).toThrow(
      /deterministic_fixture/,
    );
    expect(readCreatedDocuments()).toEqual([]);
  });

  it("re-validates on READ, so a hand-edited ledger cannot widen the delete set", () => {
    const path = resolve(dir, CREATED_LEDGER_FILE);
    recordCreatedDocument("cccccccc-1111-2222-3333-444444444444", "legit");
    // Someone appends the lease document and a fixture directly to the file.
    writeFileSync(
      path,
      readFileSync(path, "utf8") +
        `${JSON.stringify({ id: LEASE_DOC_ID })}\n` +
        `${JSON.stringify({ id: (fixtureIds() as string[])[0] })}\n` +
        "not json at all\n",
      "utf8",
    );
    expect(readCreatedDocuments()).toEqual(["cccccccc-1111-2222-3333-444444444444"]);
  });

  it("returns an empty list when the run created nothing", () => {
    expect(readCreatedDocuments()).toEqual([]);
  });
});

describe("reset deletion targets", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "sr-reset-")));
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it("never targets the marker or the lease, and covers exactly the seeded fixtures", async () => {
    const { resetDeletionTargets } = await import("../lib/dataset");
    const targets = resetDeletionTargets();

    expect(targets.fixtures.sort()).toEqual((fixtureIds() as string[]).sort());
    expect(targets.refused).toEqual([]);
    for (const id of INFRASTRUCTURE_IDS as readonly string[]) {
      expect(targets.fixtures, id).not.toContain(id);
      expect(targets.runCreated, id).not.toContain(id);
    }
    // No run-created ids yet.
    expect(targets.runCreated).toEqual([]);
  });

  it("adds run-created ids, and only those", async () => {
    const { resetDeletionTargets } = await import("../lib/dataset");
    recordCreatedDocument("dddddddd-1111-2222-3333-444444444444", "spec");
    const targets = resetDeletionTargets();
    expect(targets.runCreated).toEqual(["dddddddd-1111-2222-3333-444444444444"]);
    // The fixture list is unchanged by anything the run created.
    expect(targets.fixtures.sort()).toEqual((fixtureIds() as string[]).sort());
  });
});

describe("scenario-local integrity fixtures", () => {
  const identity = { runId: "r", candidateSha: "s", deploymentId: "d" };

  // Every case below must be refused BEFORE the lease check and BEFORE any Sanity
  // client is built, which is exactly why these assertions can run offline: reaching
  // the lease would require a configured verification environment.
  it("refuses to plant a document at a deterministic fixture id", async () => {
    const { createScenarioDocument } = await import("../lib/dataset");
    const fixture = (fixtureIds() as string[])[0];
    await expect(
      createScenarioDocument(identity, { _id: fixture, _type: "sunday_role" }),
    ).rejects.toThrow(/deterministic_fixture/);
  });

  it("refuses to plant a document over the marker or the lease", async () => {
    const { createScenarioDocument } = await import("../lib/dataset");
    for (const id of INFRASTRUCTURE_IDS as readonly string[]) {
      await expect(
        createScenarioDocument(identity, { _id: id, _type: "sunday_role" }),
      ).rejects.toThrow(/infrastructure_document/);
    }
  });

  it("refuses a draft id and a malformed id", async () => {
    const { createScenarioDocument } = await import("../lib/dataset");
    await expect(
      createScenarioDocument(identity, { _id: "drafts.srv.role.sunday.published" }),
    ).rejects.toThrow(/draft_id/);
    await expect(createScenarioDocument(identity, { _id: "" })).rejects.toThrow(/malformed_id/);
  });
});
