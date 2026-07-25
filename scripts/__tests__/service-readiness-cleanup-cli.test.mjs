// scripts/__tests__/service-readiness-cleanup-cli.test.mjs
//
// Guard behaviour of the cleanup and restore COMMANDS, executed for real as child
// processes and entirely offline.
//
// Safety of this test file: no invocation here can reach the network. Either the
// run has no `--apply` (so `willContactRemote` is false and no Sanity client is
// ever constructed), or it has `--apply` with a deliberately incomplete
// environment (no marker / no token / production ids), which the shipped guards
// refuse BEFORE the dynamic import of the runtime module. No real token is ever
// present in the environment these children receive.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MARKER_ENV,
  MARKER_VALUE,
  TOKEN_ENV,
  VERIFICATION_DATASET,
  VERIFICATION_PROJECT_ID,
} from "../lib/sr-verification.mjs";
import { confirmationPhrase, restoreConfirmationPhrase } from "../lib/sr-cleanup.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLEANUP = "scripts/service-readiness-cleanup.mjs";
const RESTORE = "scripts/service-readiness-restore.mjs";
const TMP = mkdtempSync(join(tmpdir(), "sr-cleanup-cli-"));

/** A minimal environment: nothing inherited, so no real credential can leak in. */
function run(script, args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const VERIFICATION_ENV = {
  SR_VERIFY_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
  SR_VERIFY_SANITY_DATASET: VERIFICATION_DATASET,
};

const TARGET = { id: "srv.setlist.orphan", rev: "rev-1" };

describe("cleanup command guards", () => {
  it("is dry-run by default and contacts nothing", () => {
    const { status, out } = run(CLEANUP, [
      "--action", "remove-orphan-setlist",
      "--id", TARGET.id,
      "--rev", TARGET.rev,
    ]);
    expect(status).toBe(0);
    expect(out).toContain("mode:      DRY-RUN");
    expect(out).toContain("no remote call will be made");
    expect(out).toContain("No Sanity client was constructed and no remote call was made");
  });

  it("refuses the production project outright, even without --apply", () => {
    const { status, out } = run(
      CLEANUP,
      ["--action", "remove-orphan-setlist", "--id", TARGET.id, "--rev", TARGET.rev],
      { NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk", NEXT_PUBLIC_SANITY_DATASET: "some-other" },
    );
    expect(status).toBe(1);
    expect(out).toContain("[forbidden_project]");
    expect(out).toContain("Nothing was written.");
  });

  it("refuses the production dataset outright, even without --apply", () => {
    const { status, out } = run(
      CLEANUP,
      ["--action", "remove-orphan-setlist", "--id", TARGET.id, "--rev", TARGET.rev],
      { NEXT_PUBLIC_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET: "production" },
    );
    expect(status).toBe(1);
    expect(out).toContain("[forbidden_dataset]");
  });

  it("refuses --apply without the verification marker", () => {
    const { status, out } = run(
      CLEANUP,
      ["--action", "remove-orphan-setlist", "--id", TARGET.id, "--rev", TARGET.rev, "--apply"],
      { ...VERIFICATION_ENV, [TOKEN_ENV]: "" },
    );
    expect(status).toBe(1);
    expect(out).toContain("[missing_marker]");
    expect(out).not.toContain("committed:");
  });

  it("refuses --apply without a token", () => {
    const { status, out } = run(
      CLEANUP,
      ["--action", "remove-orphan-setlist", "--id", TARGET.id, "--rev", TARGET.rev, "--apply"],
      { ...VERIFICATION_ENV, [MARKER_ENV]: MARKER_VALUE },
    );
    expect(status).toBe(1);
    expect(out).toContain("[missing_token]");
    expect(out).toContain("Nothing was written.");
  });

  it("refuses an unknown flag rather than ignoring a typo", () => {
    const { status, out } = run(CLEANUP, ["--action", "remove-orphan-setlist", "--force"]);
    expect(status).toBe(1);
    expect(out).toContain("[unknown_flag]");
  });

  it("refuses a repeated --id (one target per invocation)", () => {
    const { status, out } = run(CLEANUP, ["--action", "remove-orphan-setlist", "--id", "a", "--id", "b"]);
    expect(status).toBe(1);
    expect(out).toContain("[unknown_flag]");
    expect(out).toContain("repeated");
  });

  it("refuses an unreadable --evidence file", () => {
    const { status, out } = run(CLEANUP, [
      "--action", "remove-orphan-setlist",
      "--id", TARGET.id,
      "--rev", TARGET.rev,
      "--evidence", join(TMP, "does-not-exist.json"),
    ]);
    expect(status).toBe(1);
    expect(out).toContain("could not be read");
  });

  it("lists every action and every protected type in --help", () => {
    const { status, out } = run(CLEANUP, ["--help"]);
    expect(status).toBe(0);
    for (const type of [
      "sunday_role",
      "saturday_role",
      "special_role",
      "featuredSongs",
      "saturdarSongs",
      "setlistProposal",
      "roleTargetLock",
      "roleCreationReceipt",
    ]) {
      expect(out).toContain(type);
    }
    expect(out).toContain("Never targets the production project/dataset");
  });
});

describe("cleanup dry-run rehearsal", () => {
  it("prints a full plan when the intent file carries an observed snapshot", () => {
    const setlist = {
      _id: TARGET.id,
      _type: "saturdarSongs",
      _rev: TARGET.rev,
      week: "2026-08-15",
      songs: [],
    };
    const file = join(TMP, "orphan-intent.json");
    writeFileSync(
      file,
      JSON.stringify({
        observed: { [setlist._id]: setlist },
        evidence: { canonicalOwners: [], rawOwnerDrafts: [], observedSetlists: [setlist] },
      }),
    );
    const { status, out } = run(CLEANUP, [
      "--action", "remove-orphan-setlist",
      "--id", TARGET.id,
      "--rev", TARGET.rev,
      "--confirm", confirmationPhrase({ action: "remove-orphan-setlist", id: TARGET.id, rev: TARGET.rev }),
      "--evidence", file,
    ]);
    expect(status).toBe(0);
    expect(out).toContain("decision:  PLAN");
    expect(out).toContain(`assertRev ${TARGET.id} @${TARGET.rev}`);
    expect(out).toContain(`delete ${TARGET.id}`);
  });

  it("exits non-zero when the rehearsed decision is refused (receipt tombstone)", () => {
    const receipt = {
      _id: "roleCreate.tombstone",
      _type: "roleCreationReceipt",
      _rev: "r1",
      state: "committed",
      requestId: "some-request",
    };
    const file = join(TMP, "tombstone-intent.json");
    writeFileSync(file, JSON.stringify({ observed: { [receipt._id]: receipt }, evidence: { liveRoles: [] } }));
    const { status, out } = run(CLEANUP, [
      "--action", "cleanup-creation-receipt",
      "--mode", "remove",
      "--id", receipt._id,
      "--rev", "r1",
      "--confirm", confirmationPhrase({ action: "cleanup-creation-receipt", id: receipt._id, rev: "r1", mode: "remove" }),
      "--evidence", file,
    ]);
    expect(status).toBe(1);
    expect(out).toContain("decision:  REFUSED");
    expect(out).toContain("[receipt_tombstone_protected]");
  });
});

describe("restore command guards", () => {
  const envelope = {
    kind: "cleanup-remove-orphan-setlist",
    createdAt: "2026-07-24T12:00:00.000Z",
    projectId: VERIFICATION_PROJECT_ID,
    dataset: VERIFICATION_DATASET,
    documentCount: 1,
    documents: [
      { _id: "srv.setlist.orphan", _type: "saturdarSongs", _rev: "rev-1", week: "2026-08-15", songs: [] },
    ],
  };
  const backupFile = join(TMP, "backup.json");
  writeFileSync(backupFile, JSON.stringify(envelope));

  it("is dry-run by default and prints the exact confirmation phrase", () => {
    const { status, out } = run(RESTORE, ["--backup", backupFile]);
    expect(status).toBe(0);
    expect(out).toContain("mode:      DRY-RUN");
    expect(out).toContain(restoreConfirmationPhrase(envelope.documents));
    expect(out).toContain("any later write refuses the whole restore");
  });

  it("requires a --backup file", () => {
    const { status, out } = run(RESTORE, []);
    expect(status).toBe(1);
    expect(out).toContain("--backup <file> is required");
    expect(out).toContain("Nothing was restored.");
  });

  it("refuses the production project/dataset outright", () => {
    const project = run(RESTORE, ["--backup", backupFile], {
      NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk",
      NEXT_PUBLIC_SANITY_DATASET: "some-other",
    });
    expect(project.status).toBe(1);
    expect(project.out).toContain("[forbidden_project]");

    const dataset = run(RESTORE, ["--backup", backupFile], {
      NEXT_PUBLIC_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
      NEXT_PUBLIC_SANITY_DATASET: "production",
    });
    expect(dataset.status).toBe(1);
    expect(dataset.out).toContain("[forbidden_dataset]");
  });

  it("refuses --apply without a token, before constructing any client", () => {
    const { status, out } = run(RESTORE, ["--backup", backupFile, "--apply"], {
      ...VERIFICATION_ENV,
      [MARKER_ENV]: MARKER_VALUE,
    });
    expect(status).toBe(1);
    expect(out).toContain("[missing_token]");
    expect(out).not.toContain("committed:");
  });

  it("refuses an empty backup envelope", () => {
    const empty = join(TMP, "empty.json");
    writeFileSync(empty, JSON.stringify({ ...envelope, documents: [] }));
    const { status, out } = run(RESTORE, ["--backup", empty]);
    expect(status).toBe(1);
    expect(out).toContain("no `documents`");
  });
});
