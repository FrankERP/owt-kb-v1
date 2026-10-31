// The seat-clash guard (ADR-0078) must run in every writer that changes seats,
// and before anything in it can write. A guard placed after the legacy-lock
// bootstrap would leave that bootstrap committed on a refused edit; one placed
// after the transaction would be no guard. Source order is what this pins, so a
// refactor that moves a write above the guard fails here, not in production.
//
// A NEW `*Commit.ts` fails until it is classified below: either it writes seats
// (and joins SEAT_WRITERS, guard included) or it does not.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const UTILS = path.join(process.cwd(), "app/utils");

const SEAT_WRITERS: Record<string, string> = {
  "roleEditCommit.ts": "editRole",
  "roleCreateCommit.ts": "createRole",
  "roleSwapCommit.ts": "swapRoles",
  "copyInstrumentsCommit.ts": "copyInstruments",
};

/** Writers that leave seats alone (remove a whole role, publish, songs, records, threads, Kids). */
const NON_SEAT_WRITERS = [
  "fairnessMonthCommit.ts",
  "kidsCommit.ts",
  "proposalReviewCommit.ts",
  "publishReadyCommit.ts",
  "roleDeleteCommit.ts",
  "roleUnpublishCommit.ts",
  "serviceThreadCommit.ts",
  "setlistSaveCommit.ts",
  "songSaveCommit.ts",
];

/** Every call that writes, or that runs ahead of the writes and must not run on a refused write. */
const WRITE_STAGE_CALLS = [
  "resolveOwnedCoordination(",
  "bootstrapLegacyLock(",
  "loadSpecialIdentityCoordinator(",
  "loadTargetOccupancy(",
  ".transaction(",
];

/** Source with comments and import lines removed: several of these files name the calls in prose. */
function code(file: string): string {
  return readFileSync(path.join(UTILS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/^import[\s\S]*?;$/gm, "");
}

/** The exported writer's body: from its signature to the first top-level closing brace. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `${name} is exported`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end);
}

describe("seat-clash guard coverage", () => {
  it("classifies every *Commit.ts as a seat writer or not", () => {
    const commits = readdirSync(UTILS).filter((f) => f.endsWith("Commit.ts")).sort();
    expect(commits).toEqual([...Object.keys(SEAT_WRITERS), ...NON_SEAT_WRITERS].sort());
  });

  it.each(Object.entries(SEAT_WRITERS))("%s judges added clashes before any write stage", (file, name) => {
    const fn = body(code(file), name);
    const guard = fn.indexOf("addedSeatClashes(");
    expect(guard, `${name} calls addedSeatClashes`).toBeGreaterThan(0);
    for (const call of WRITE_STAGE_CALLS) {
      const at = fn.indexOf(call);
      if (at === -1) continue;
      expect(at, `${name}: ${call} must come after addedSeatClashes(`).toBeGreaterThan(guard);
    }
  });

  it("keeps the guard out of the writers that change no seats", () => {
    for (const file of NON_SEAT_WRITERS) expect(code(file)).not.toContain("addedSeatClashes(");
  });
});
