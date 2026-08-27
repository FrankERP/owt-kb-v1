// scripts/lib/__tests__/sr-retired-writer.test.mjs
//
// Offline unit tests for the retirement gate on the five one-shot executable
// writers (plan §8: "a script that cannot use the shared invariant must fail
// before any production write").
//
// Two halves:
//  1. the pure decision — always refused, never contacts remote, and the shipped
//     production project/dataset refusals still apply;
//  2. a STATIC check of each of the five real files, asserting the gate call
//     appears before any client construction and before any mutation, so the
//     retirement cannot be defeated by argument, environment, or code path.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RETIRED_WRITERS,
  RETIRED_WRITER_NAMES,
  evaluateRetiredWriter,
  formatRetirementRefusal,
} from "../sr-retired-writer.mjs";
import { MARKER_ENV, MARKER_VALUE, TOKEN_ENV, VERIFICATION_DATASET, VERIFICATION_PROJECT_ID } from "../sr-verification.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const PRODUCTION_ENV = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "ebb8vcnk",
  NEXT_PUBLIC_SANITY_DATASET: "production",
  SANITY_WRITE_TOKEN: "sk-would-be-a-real-token",
};
const VERIFICATION_ENV = {
  SR_VERIFY_SANITY_PROJECT_ID: VERIFICATION_PROJECT_ID,
  SR_VERIFY_SANITY_DATASET: VERIFICATION_DATASET,
  [MARKER_ENV]: MARKER_VALUE,
  [TOKEN_ENV]: "sk-not-a-real-token",
};

describe("retired-writer decision", () => {
  it("registers exactly the seven plan §8 executable writers", () => {
    expect(RETIRED_WRITER_NAMES).toEqual(
      [
        "cleanup-superseded-proposals",
        "import-schedule",
        "import-setlist-history",
        // Release 2's notes-to-thread fold. It RAN (2026-08-26) and was retired
        // in Child A Phase E; `scripts/reconcile-proposal-messages.mjs` is the
        // read-only check that replaced it.
        "migrate-proposal-messages",
        "migrate-shared-proposals",
        "normalize-instrument-names",
        "unpublish-july-2026",
      ].sort(),
    );
    // `scripts/sa-roster.mjs` is gitignored local tooling: out of this scope and
    // deliberately never registered here.
    expect(RETIRED_WRITER_NAMES.some((n) => /sa-roster/.test(n))).toBe(false);
  });

  it("refuses every writer in every mode and every environment", () => {
    for (const name of RETIRED_WRITER_NAMES) {
      for (const env of [{}, PRODUCTION_ENV, VERIFICATION_ENV]) {
        for (const apply of [false, true]) {
          const d = evaluateRetiredWriter({ script: name, env, apply });
          expect(d.refused, `${name} apply=${apply}`).toBe(true);
          expect(d.willContactRemote, `${name} apply=${apply}`).toBe(false);
          expect(d.exitCode).toBe(1);
          expect(d.hardFailures.map((f) => f.code)).toContain("retired_writer");
        }
      }
    }
  });

  it("keeps the shipped production refusals on top of the retirement", () => {
    const d = evaluateRetiredWriter({ script: "unpublish-july-2026", env: PRODUCTION_ENV, apply: true });
    const codes = d.hardFailures.map((f) => f.code);
    expect(codes).toContain("forbidden_project");
    expect(codes).toContain("forbidden_dataset");
    expect(codes).toContain("retired_writer");
  });

  it("refuses an unregistered script rather than guessing", () => {
    const d = evaluateRetiredWriter({ script: "some-other-script", env: {} });
    expect(d.hardFailures.map((f) => f.code)).toContain("unknown_retired_writer");
    expect(d.refused).toBe(true);
    const none = evaluateRetiredWriter({});
    expect(none.hardFailures.map((f) => f.code)).toContain("unknown_retired_writer");
  });

  it("names a replacement path for every writer", () => {
    for (const [name, entry] of Object.entries(RETIRED_WRITERS)) {
      expect(entry.file, name).toMatch(/^scripts\//);
      expect(entry.did.length, name).toBeGreaterThan(20);
      expect(entry.replacement.length, name).toBeGreaterThan(20);
    }
  });

  it("prints the refusal without leaking a token value", () => {
    const lines = formatRetirementRefusal(
      evaluateRetiredWriter({ script: "import-schedule", env: PRODUCTION_ENV, apply: true }),
    ).join("\n");
    expect(lines).toContain("RETIRED WRITER");
    expect(lines).toContain("Nothing was read and nothing was written.");
    expect(lines).not.toContain("sk-would-be-a-real-token");
  });
});

describe("every retired writer fails closed before any production write", () => {
  /** Markers that would mean "this file is about to talk to the Content Lake". */
  const WRITE_MARKERS = [
    "createClient(",
    "api.sanity.io",
    ".transaction(",
    ".commit(",
    ".patch(",
    ".delete(",
    ".create(",
    ".createIfNotExists(",
    "fetch(",
  ];

  for (const [name, entry] of Object.entries(RETIRED_WRITERS)) {
    it(`${entry.file} gates before every write marker`, () => {
      const src = readFileSync(resolve(REPO_ROOT, entry.file), "utf8");

      // The gate is imported from the shared module and called with this exact name.
      expect(src).toContain('from "./lib/sr-retired-writer.mjs"');
      const gateIndex = src.indexOf(`assertRetiredWriter("${name}"`);
      expect(gateIndex, `${entry.file} does not call assertRetiredWriter("${name}")`).toBeGreaterThan(-1);

      // Nothing that could reach the Content Lake may appear before the gate.
      const before = src.slice(0, gateIndex);
      for (const marker of WRITE_MARKERS) {
        expect(before.includes(marker), `${entry.file} has "${marker}" BEFORE the retirement gate`).toBe(false);
      }

      // The historical body is still present (retirement, not deletion), so the
      // markers do exist — after the gate.
      expect(WRITE_MARKERS.some((marker) => src.slice(gateIndex).includes(marker))).toBe(true);
    });
  }
});
