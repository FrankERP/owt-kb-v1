// ADR-0092 (C1 §3.3): every read of the shared rules document goes through the rule-person translation.
//
// WHY THIS EXISTS. Once the rules store member ids, a reader that parses the raw document and prints a
// rule person shows an id to a person or to the chat, and a writer that skips the core stores a name
// where an id belongs. The design answers that with ONE read boundary (`solverConfigGetBody` →
// `rulePeopleToNames`) and ONE write core (`solverConfigWrite.ts`). This scan is what keeps it one:
// every file under `app/**` and `scripts/**` that names the document or its raw reader must be in the
// allowlist below, with the reason it reads raw or how it translates. A new reader fails here until
// someone decides how it reads.
//
// WHAT IT DOES NOT CLAIM. A source scan of identifiers (comments blanked). A literal GROQ for the
// document is invisible to it; the two known ones are named in the plan and the ADR:
// `scripts/fix-vale-sosa-rule.mjs` (refuses an id-mode document) and the private ADR-0056 restore.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "../../../scripts/lib/strip-comments.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const READ_SYMBOLS = /\b(SOLVER_CONFIG_DOC_ID|solverConfigQuery|loadStoredSolverConfig|loadSolverConfigWithRoster|solverConfigFromDocument)\b/;

/** Every reader of the rules document, and why it may. */
const READERS: Record<string, string> = {
  "app/utils/solverConfigWriteRequest.ts": "defines the id and the reader; `rulePeopleToNames` wraps `solverConfigFromDocument`",
  "app/utils/solverConfigRead.ts": "the raw read; `solverConfigGetBody` returns names through `rulePeopleToNames`",
  "app/utils/serviceReadQueries.ts": "defines `solverConfigQuery`",
  "app/utils/solverConfigWrite.ts": "the one write core: patches the document by id",
  "app/utils/solverConfigCommit.ts": "the rules POST and the chat: judge `rulePeopleToNames`, write through the core",
  "app/api/admin/solver-config/route.ts": "the GET: `solverConfigGetBody(doc, roster)`",
  "app/utils/v3MonthPlanReads.ts": "`readRules`: `solverConfigGetBody(doc, roster)`",
  "app/components/admin/solverConfigSource.ts": "normalises the GET/POST body, which is already names",
  "app/utils/memberRuleRename.ts": "RAW by design: plans text rewrites on a names document; returns nothing in id mode",
  "app/utils/memberCommit.ts": "reads the raw document for `memberRuleRename` and patches its paths in names mode only",
  "app/api/admin/members/[id]/route.ts": "the DELETE's pool cleanup: pools were always ids",
  "scripts/lib/reconstructRun.ts": "reads through `rulePeopleToNames` with its own roster read",
  "scripts/seed-solver-config.ts": "creates the document only when absent, as names, with no marker",
  "scripts/lib/rekeySolverRulePeople.ts": "the consented migration: reads raw, writes through the core",
};

/** Only these may import the write core. */
const WRITERS = new Set(["app/utils/solverConfigCommit.ts", "scripts/lib/rekeySolverRulePeople.ts"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

const sources = ["app", "scripts"].flatMap((d) => files(path.join(REPO_ROOT, d))).map((full) => ({
  rel: path.relative(REPO_ROOT, full).split(path.sep).join("/"),
  code: stripComments(readFileSync(full, "utf8")) as string,
}));

describe("every reader of the rules document is a known site (ADR-0092)", () => {
  it("finds the sites it lists (the scan is not blind)", () => {
    const found = sources.filter((s) => READ_SYMBOLS.test(s.code)).map((s) => s.rel);
    for (const rel of Object.keys(READERS)) expect(found, rel).toContain(rel);
  });

  it("no unlisted file reads the document", () => {
    const unlisted = sources.filter((s) => READ_SYMBOLS.test(s.code) && !(s.rel in READERS)).map((s) => s.rel);
    expect(unlisted).toEqual([]);
  });

  it("only the rules writer and the migration import the write core", () => {
    const importers = sources.filter((s) => /from\s+["'][^"']*solverConfigWrite["']/.test(s.code)).map((s) => s.rel);
    expect(importers.filter((rel) => !WRITERS.has(rel))).toEqual([]);
    expect(importers.sort()).toEqual([...WRITERS].sort());
  });
});
