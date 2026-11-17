// Who may ASK for the days a Jóvenes pastor marked, and which Jóvenes files may name the field
// (ADR-0090; plan `docs/superpowers/plans/2026-11-17-jovenes-away-in-planner.md` §3 R3).
//
// WHY THIS EXISTS. `readJovenesPeople()` feeds four pages. Three of them (`/jovenes`,
// `/jovenes/calendario`, `/jovenes/reunion/[token]`) hand its list to an editor that a plain pastor
// can hold (the encargado of a meeting), and must never receive anybody's days. The read is
// therefore opt-in (`awayFor`), and that option is a source scan, not a sentence:
//
//   (a) under `app/**`, only the roster read and the planner page name `awayFor`;
//   (b) no file of the Jóvenes tree names the availability fields, except the roster read, which
//       may name the dates and never the notes.
//
// SCOPE, said plainly: (b) covers the Jóvenes tree only. It does not stop a new reader of members'
// days elsewhere (worship's planner, Kids' and the MCP read them for their own audiences).
// It reads `git ls-files`: stage a new file before running it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const READ = "app/utils/jovenesPeople.ts";
const PLANNER_PAGE = "app/(client)/jovenes/admin/page.tsx";

const isTest = (f: string) => f.includes("/__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(f);
const files = execFileSync("git", ["ls-files", "app"], { cwd: REPO_ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.[cm]?[jt]sx?$/.test(f) && !isTest(f));
const code = (f: string) => stripComments(readFileSync(path.join(REPO_ROOT, f), "utf8"));

const JOVENES_TREE = [/^app\/\(client\)\/jovenes\//, /^app\/components\/jovenes\//, /^app\/api\/ministries\//, /^app\/utils\/jovenes[^/]*\.ts$/];

describe("ADR-0090: who asks for a pastor's marked days", () => {
  it("scans a real tree", () => {
    expect(files).toContain(READ);
    expect(files).toContain(PLANNER_PAGE);
    expect(files).toContain("app/(client)/jovenes/page.tsx");
  });

  it("(a) only the roster read and the planner page name `awayFor`", () => {
    expect(files.filter((f) => /\bawayFor\b/.test(code(f))).sort()).toEqual([PLANNER_PAGE, READ].sort());
  });

  it("(b) no Jóvenes file names the availability fields, except the roster read (dates only)", () => {
    const tree = files.filter((f) => JOVENES_TREE.some((re) => re.test(f)));
    expect(tree.length).toBeGreaterThan(20);
    expect(tree.filter((f) => /\bunavailableDates\b/.test(code(f)))).toEqual([READ]);
    expect(tree.filter((f) => /\bunavailabilityNotes\b/.test(code(f)))).toEqual([]);
  });
});
