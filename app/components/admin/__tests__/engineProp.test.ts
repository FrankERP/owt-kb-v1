// Solver v3 C6 ENG-3, ENG-4 — the effective engine is resolved on the SERVER and reaches the
// client only as a prop. Static guards over git-tracked, non-test sources (stage new files first).
// C2's `solverDeployment.test.ts` already pins «exactly one reader of OWT_SOLVER_ENGINE» and «no
// client module imports the resolver» (ENG-1); this file adds what C6 owns and does not repeat them.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = (): string[] =>
  execFileSync("git", ["ls-files", "app"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/__tests__/") && !/\.test\.(ts|tsx)$/.test(f));

const read = (f: string) => readFileSync(f, "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const isClient = (src: string) => /^\s*(["'])use client\1/.test(stripComments(src));

/** Every opening tag `<Name …>` in `src`, braces balanced so `=>` inside a prop never ends it. */
function openingTags(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe("the engine prop (C6 ENG-3, ENG-4)", () => {
  it("no client module mentions SOLVER_ENGINE: every client branch reads the prop (ENG-4)", () => {
    const offenders = sources().filter((f) => {
      const src = read(f);
      return isClient(src) && /\bSOLVER_ENGINE\b/.test(stripComments(src));
    });
    expect(offenders).toEqual([]);
  });

  it("the resolver's module is imported only by the admin page, route handlers and server-only modules (ENG-3)", () => {
    const offenders = sources().filter((f) => {
      if (f === "app/utils/solverDeployment.ts") return false;
      const src = stripComments(read(f));
      if (!/from\s+["'][^"']*\/solverDeployment["']/.test(src)) return false;
      const server = f === "app/(client)/admin/page.tsx"
        || /^app\/api\/.+\/route\.ts$/.test(f)
        || /^\s*import\s+["']server-only["'];?\s*$/m.test(src);
      return !server;
    });
    expect(offenders).toEqual([]);
  });

  it("/admin resolves the engine at render and hands it to the panel", () => {
    const page = read("app/(client)/admin/page.tsx");
    expect(isClient(page)).toBe(false);
    expect(page).toMatch(/const engine = resolveSolverEngine\(process\.env\);/);
    expect(openingTags(page, "AdminPanel")).toHaveLength(1);
    expect(openingTags(page, "AdminPanel")[0]).toMatch(/\bengine=\{engine\}/);
  });

  it("every production mount of an engine-dependent component passes `engine=`", () => {
    const everywhere = ["ServicesPanel", "MonthGenerator", "FairnessEngineNote", "FairnessPreviewPanel"];
    const inGenerator = ["PlannerGrid", "MonthCalendar", "SolverConfigPanel", "RuleBuilder", "RestrictionCard"];
    const missing: string[] = [];
    for (const f of sources().filter((s) => s.endsWith(".tsx"))) {
      const src = stripComments(read(f));
      const names = f === "app/components/admin/MonthGenerator.tsx" ? [...everywhere, ...inGenerator] : everywhere;
      for (const name of names) {
        for (const tag of openingTags(src, name)) {
          if (!/\bengine=/.test(tag)) missing.push(`${f}: <${name}>`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
