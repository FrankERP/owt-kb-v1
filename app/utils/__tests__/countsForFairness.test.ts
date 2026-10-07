// Solver v3 C1-R2 — ONE read rule for «Cuenta para equidad»: the GROQ fragment, its
// TypeScript twin and the type default must agree on every stored state of every
// role type, and nothing else may spell the fragment.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, parse } from "groq-js";
import { describe, expect, it } from "vitest";

import {
  COUNTS_FOR_FAIRNESS_GROQ,
  countsForFairness,
  countsForFairnessDefault,
  type FairnessRoleType,
} from "@/app/utils/countsForFairness";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TYPES: FairnessRoleType[] = ["sunday_role", "saturday_role", "special_role"];
const STORED: (boolean | null | undefined)[] = [undefined, null, true, false];

interface Doc {
  _id: string;
  _type: FairnessRoleType;
  countsForFairness?: boolean | null;
}

/** The 12 documents of the spec's domain: {absent, null, true, false} x the three role types. */
function domain(): Doc[] {
  const docs: Doc[] = [];
  for (const type of TYPES) {
    for (const stored of STORED) {
      const doc: Doc = { _id: `${type}.${String(stored)}`, _type: type };
      if (stored !== undefined) doc.countsForFairness = stored;
      docs.push(doc);
    }
  }
  return docs;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("countsForFairness — one read rule (solver v3 C1-R2)", () => {
  it("spells the fragment exactly", () => {
    expect(COUNTS_FOR_FAIRNESS_GROQ).toBe('coalesce(countsForFairness, _type != "special_role")');
  });

  it("defaults weekend services to counted and specials to not counted", () => {
    expect(countsForFairnessDefault("sunday_role")).toBe(true);
    expect(countsForFairnessDefault("saturday_role")).toBe(true);
    expect(countsForFairnessDefault("special_role")).toBe(false);
  });

  it("the GROQ fragment, the twin and the default agree on all 12 documents", async () => {
    const dataset = domain();
    expect(dataset).toHaveLength(12);
    const query = `*[_type in ["sunday_role", "saturday_role", "special_role"]]{ _id, "counts": ${COUNTS_FOR_FAIRNESS_GROQ} }`;
    const rows = (await (await evaluate(parse(query), { dataset })).get()) as { _id: string; counts: boolean }[];
    const fragment = new Map(rows.map((row) => [row._id, row.counts]));
    expect(fragment.size).toBe(12);
    for (const doc of dataset) {
      const twin = countsForFairness(doc);
      const expected =
        typeof doc.countsForFairness === "boolean" ? doc.countsForFairness : countsForFairnessDefault(doc._type);
      expect(twin, doc._id).toBe(expected);
      expect(fragment.get(doc._id), doc._id).toBe(twin);
    }
  });

  it("keeps the fragment a plain quoted string in a neutral, import-free module", () => {
    const src = readFileSync(path.join(REPO_ROOT, "app/utils/countsForFairness.ts"), "utf8");
    expect(src).toContain(`'coalesce(countsForFairness, _type != "special_role")'`);
    expect(src).not.toMatch(/`[^`]*coalesce\(countsForFairness/);
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it("is the only source file under app/ and sanity/ that spells the fragment", () => {
    const spelling = [...sourceFiles(path.join(REPO_ROOT, "app")), ...sourceFiles(path.join(REPO_ROOT, "sanity"))]
      .filter((file) => readFileSync(file, "utf8").includes("coalesce(countsForFairness"))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(spelling).toEqual(["app/utils/countsForFairness.ts"]);
  });
});
