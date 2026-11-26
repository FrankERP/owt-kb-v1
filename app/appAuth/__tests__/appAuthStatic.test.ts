// app/appAuth/__tests__/appAuthStatic.test.ts — the source-level guards of the
// native-app door (ADR-0091, spec §6 and §10 A8):
//
//  1. `documentTypes.ts` imports nothing (the Studio bundles the schema files
//     that import it), the schema fields equal its constants, and no builder
//     writes a field outside them;
//  2. every route under `app/api/app/v1` (except the two door endpoints) calls
//     `requireAppSession` FIRST, with a literal `needs`;
//  3. the `(appauth)` layout and the callback pages reach nothing that reads a
//     session, cookie, network, env or Sanity, and a callback query is never
//     rendered;
//  4. the four Jóvenes pages share `plansInMinistry` with the app's `planner` level.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { appAuthGrant } from "@/sanity/schemas/appAuthGrant";
import { appAuthCodeRedemption } from "@/sanity/schemas/appAuthCodeRedemption";
import { importSpecifiers, walkImportClosure } from "@/app/mcp/oauth/__tests__/importClosure";
import { APP_CODE_REDEMPTION_FIELDS, APP_GRANT_FIELDS } from "../documentTypes";
import {
  buildAppCodeRedemptionDocument,
  buildAppGrantDocument,
  buildAppRefreshRotationPatch,
  buildAppRevocationPatch,
} from "../grantDocument";
import CallbackPage from "@/app/(appauth)/app/callback/CallbackPage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");
const fieldNames = (schema: { fields?: unknown }) => ((schema.fields as { name: string }[] | undefined) ?? []).map((f) => f.name);

describe("documentTypes and the two schemas", () => {
  it("documentTypes.ts has no import statement", () => {
    expect(importSpecifiers(read("app/appAuth/documentTypes.ts"))).toEqual([]);
    expect(read("app/appAuth/documentTypes.ts")).not.toMatch(/^\s*(?:import|export\s[^\n]*\bfrom)\b|\bimport\(|\brequire\(/m);
  });

  it("the schema files import only sanity and documentTypes", () => {
    for (const f of ["sanity/schemas/appAuthGrant.ts", "sanity/schemas/appAuthCodeRedemption.ts"]) {
      expect(importSpecifiers(read(f)).sort()).toEqual(["../../app/appAuth/documentTypes", "sanity"]);
    }
  });

  it("declare exactly the constants' fields, hidden and read-only", () => {
    expect(fieldNames(appAuthGrant)).toEqual([...APP_GRANT_FIELDS]);
    expect(fieldNames(appAuthCodeRedemption)).toEqual([...APP_CODE_REDEMPTION_FIELDS]);
    for (const s of [appAuthGrant, appAuthCodeRedemption] as unknown as { hidden?: boolean; readOnly?: boolean }[]) {
      expect(s.hidden).toBe(true);
      expect(s.readOnly).toBe(true);
    }
  });

  it("no builder writes a field the schema does not declare", () => {
    const grantFields = new Set<string>([...APP_GRANT_FIELDS, "_id", "_type"]);
    const doc = buildAppGrantDocument({ id: "appAuthGrant.x", sub: "m", clientId: "backstage-ios", origin: "o", refreshJti: "j", createdAt: "t" });
    const writes = [doc, buildAppRefreshRotationPatch({ refreshJti: "j", at: "t" }), buildAppRevocationPatch({ reason: "r", at: "t" })];
    for (const w of writes) for (const k of Object.keys(w)) expect(grantFields.has(k), k).toBe(true);
    const codeFields = new Set<string>([...APP_CODE_REDEMPTION_FIELDS, "_id", "_type"]);
    for (const k of Object.keys(buildAppCodeRedemptionDocument({ jti: "j", redeemedAt: "t" }))) expect(codeFields.has(k), k).toBe(true);
  });
});

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

const NEEDS_LITERAL =
  /^\{\s*needs:\s*(?:"self"|"manager"|"super-admin"|\{\s*ministry:\s*"(?:worship|kids|jovenes)",\s*as:\s*"(?:member|planner|manager)"\s*\})\s*\}$/;
const METHOD = "(GET|POST|PUT|PATCH|DELETE)";

/** The first statement of a function body (comments and blank lines skipped) must be the guard. */
function guardProblem(label: string, body: string): string | null {
  const first = body.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("//"));
  const m = /^const\s+\w+\s*=\s*await\s+requireAppSession\(\s*\w+\s*,\s*(\{[\s\S]*\})\s*\);$/.exec(first ?? "");
  if (!m) return `${label}: first statement must be \`await requireAppSession(request, { needs: … })\``;
  if (!NEEDS_LITERAL.test(m[1]!.replace(/\s+/g, " "))) return `${label}: needs must be a literal level`;
  return null;
}

/**
 * Every problem with one route source. An exported method is either
 * `export async function METHOD(…)` whose first statement is the guard, or EXACTLY
 * `export const METHOD = withVerificationRunContext(<name>);` (the SR-verification scan requires
 * that form for a route that can send mail, W1 spec D2.5), where `<name>` is an
 * `async function <name>(…)` declared in this file whose first statement passes the same checks,
 * and `withVerificationRunContext` is imported from `@/app/utils/srVerificationRunContext`.
 * Any other `export const|let METHOD` is refused.
 */
function routeProblems(src: string): string[] {
  const problems: string[] = [];
  const direct = [...src.matchAll(new RegExp(`export\\s+async\\s+function\\s+${METHOD}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, "g"))];
  for (const [, method, body] of direct) {
    const p = guardProblem(method!, body!);
    if (p) problems.push(p);
  }

  const constExports = [...src.matchAll(new RegExp(`export\\s+(?:const|let)\\s+${METHOD}\\b[^\\n]*`, "g"))];
  for (const [line, method] of constExports) {
    const wrapped = new RegExp(`^export\\s+const\\s+${method}\\s*=\\s*withVerificationRunContext\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\);\\s*$`).exec(line);
    if (!wrapped) {
      problems.push(`${method}: an exported const handler must be exactly \`withVerificationRunContext(<local async function>)\``);
      continue;
    }
    const name = wrapped[1]!;
    const inner = new RegExp(`(?:^|\\n)async\\s+function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src);
    if (!inner) {
      problems.push(`${method}: \`${name}\` must be an \`async function\` declared in this file`);
      continue;
    }
    const p = guardProblem(`${method} (${name})`, inner[1]!);
    if (p) problems.push(p);
    if (!/import\s*\{[^}]*\bwithVerificationRunContext\b[^}]*\}\s*from\s*"@\/app\/utils\/srVerificationRunContext";/.test(src)) {
      problems.push(`${method}: withVerificationRunContext must come from @/app/utils/srVerificationRunContext`);
    }
  }

  // Any other export that names a method (`export function POST` without `async`,
  // `export { handler as POST }`, `export var POST`, `export * from`, …) is outside both forms.
  const accepted = new Set([...direct, ...constExports].map((m) => m.index));
  for (const m of src.matchAll(/^[ \t]*export\b(?:\s*\{[^}]*\}[^\n]*|\s*\*[^\n]*|[^\n]*)/gm)) {
    if (accepted.has(m.index)) continue;
    const named = new RegExp(`\\b${METHOD}\\b`).exec(m[0]);
    if (named) problems.push(`${named[1]}: exported in a form the rule does not check (\`${m[0].trim().slice(0, 60)}\`)`);
    else if (/^\s*export\s*\*/.test(m[0])) problems.push(`\`export *\` could re-export a handler the rule does not check`);
  }

  if (direct.length + constExports.length === 0) problems.push("no exported handler");
  return problems;
}

describe("the route rule itself (W1 spec D2.5)", () => {
  const IMPORT = 'import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";\n';
  const GUARD = '  const auth = await requireAppSession(request, { needs: { ministry: "worship", as: "member" } });\n';

  it("accepts a plain guarded handler", () => {
    expect(routeProblems(`export async function GET(request: Request) {\n${GUARD}  return x;\n}\n`)).toEqual([]);
  });

  it("accepts the wrapped form around a local async function that starts with the guard", () => {
    const src = `${IMPORT}async function postHandler(request: Request): Promise<Response> {\n${GUARD}  return x;\n}\n\nexport const POST = withVerificationRunContext(postHandler);\n`;
    expect(routeProblems(src)).toEqual([]);
  });

  it("refuses a wrapped handler whose first statement is not the guard", () => {
    const src = `${IMPORT}async function postHandler(request: Request) {\n  const body = await request.json();\n${GUARD}  return x;\n}\nexport const POST = withVerificationRunContext(postHandler);\n`;
    expect(routeProblems(src).join()).toMatch(/first statement/);
  });

  it("refuses a wrapper naming a function not declared in the file", () => {
    const src = `${IMPORT}export const POST = withVerificationRunContext(elsewhere);\n`;
    expect(routeProblems(src).join()).toMatch(/declared in this file/);
  });

  it("refuses a wrapper around an arrow or an imported function", () => {
    const arrow = `${IMPORT}export const POST = withVerificationRunContext(async (request: Request) => {\n${GUARD}  return x;\n});\n`;
    expect(routeProblems(arrow).join()).toMatch(/exactly/);
    const imported = `${IMPORT}import { postHandler } from "./handler";\nexport const POST = withVerificationRunContext(postHandler);\n`;
    expect(routeProblems(imported).join()).toMatch(/declared in this file/);
  });

  it("refuses a non-literal level inside a wrapped handler", () => {
    const src = `${IMPORT}async function postHandler(request: Request) {\n  const auth = await requireAppSession(request, LEVEL);\n}\nexport const POST = withVerificationRunContext(postHandler);\n`;
    expect(routeProblems(src).join()).toMatch(/first statement|literal/);
  });

  it("refuses any other exported const handler, and a wrapper imported from elsewhere", () => {
    expect(routeProblems(`export const GET = handler;\n`).join()).toMatch(/exactly/);
    const src = `import { withVerificationRunContext } from "./mine";\nasync function postHandler(request: Request) {\n${GUARD}}\nexport const POST = withVerificationRunContext(postHandler);\n`;
    expect(routeProblems(src).join()).toMatch(/must come from/);
  });
});

describe("the route rule refuses every other export of a method (review LOW 8)", () => {
  const GUARD = '  const auth = await requireAppSession(request, { needs: "self" });\n';
  it.each([
    ["a non-async function", `export function POST(request: Request) {\n${GUARD}  return x;\n}\n`],
    ["a renamed re-export", `async function handler(request: Request) {\n${GUARD}}\nexport { handler as POST };\n`],
    ["a multi-line renamed re-export", `async function handler(request: Request) {\n${GUARD}}\nexport {\n  handler as GET,\n};\n`],
    ["an export var", `export var DELETE = handler;\n`],
    ["a star re-export", `export * from "./handlers";\n`],
  ])("%s", (_label, src) => {
    // Beside a valid handler, so "no exported handler" cannot be what fails it.
    const valid = `export async function PUT(request: Request) {\n${GUARD}  return x;\n}\n`;
    expect(routeProblems(valid + src).join()).toMatch(/does not check/);
  });

  it("still accepts the two forms beside other exports", () => {
    const src = `export const dynamic = "force-dynamic";\nexport const maxDuration = 60;\nexport async function GET(request: Request) {\n${GUARD}  return x;\n}\n`;
    expect(routeProblems(src)).toEqual([]);
  });
});

describe("every app API route calls the guard first, with a literal level", () => {
  const ROOT = path.join(REPO, "app/api/app/v1");
  const DOOR = new Set(["auth/token/route.ts", "auth/revoke/route.ts"].map((r) => path.join(ROOT, r)));
  const files = routeFiles(ROOT);

  it("finds the door endpoints and at least one guarded route", () => {
    for (const d of DOOR) expect(files).toContain(d);
    expect(files.filter((f) => !DOOR.has(f)).length).toBeGreaterThan(0);
  });

  it("finds the wrapped proposal door (a vacuous wrapped-form rule would pass with none)", () => {
    expect(read("app/api/app/v1/proposals/route.ts")).toMatch(/export const POST = withVerificationRunContext\(postHandler\);/);
  });

  for (const file of files.filter((f) => !DOOR.has(f))) {
    it(path.relative(REPO, file), () => {
      expect(routeProblems(read(path.relative(REPO, file)))).toEqual([]);
    });
  }
});

describe("the (appauth) pages load nothing", () => {
  const FORBIDDEN_EXTERNAL = [/^next-auth/, /^next\/headers$/, /^@sanity\//, /^next-sanity/, /^sanity$/, /^jose$/, /^node:/];
  const FORBIDDEN_INTERNAL = [/\/sanity\/lib\//, /\/app\/utils\/authGuards/, /\/app\/utils\/memberAccess/, /\/auth\.ts$/, /\/app\/context\//, /\/app\/appAuth\/(?!.*__tests__)/];

  for (const entry of ["app/(appauth)/layout.tsx", "app/(appauth)/app/callback/ios/page.tsx", "app/(appauth)/app/callback/android/page.tsx"]) {
    it(entry, () => {
      const closure = walkImportClosure(path.join(REPO, entry), REPO);
      for (const ext of closure.externalSpecifiers) {
        for (const re of FORBIDDEN_EXTERNAL) expect(re.test(ext), `${entry} reaches ${ext}`).toBe(false);
      }
      for (const f of closure.files) {
        const rel = "/" + path.relative(REPO, f);
        for (const re of FORBIDDEN_INTERNAL) expect(re.test(rel), `${entry} reaches ${rel}`).toBe(false);
        if (/\.(t|j)sx?$/.test(f)) expect(readFileSync(f, "utf8"), `${rel} reads env`).not.toMatch(/process\.env|cookies\(|headers\(\)|fetch\(/);
      }
    });
  }

  it("the callback pages are force-dynamic", () => {
    for (const p of ["ios", "android"]) expect(read(`app/(appauth)/app/callback/${p}/page.tsx`)).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("never renders the callback query", () => {
    const html = renderToStaticMarkup(
      // Next would hand a page its query as `searchParams`; the page must ignore it.
      createElement(CallbackPage as unknown as (p: { searchParams: unknown }) => ReactElement, {
        searchParams: Promise.resolve({ code: "SECRET-CODE-123", state: "STATE-XYZ-0123456789" }),
      }),
    );
    expect(html).toContain("Abre la app Backstage para terminar de entrar.");
    expect(html).not.toContain("SECRET-CODE-123");
    expect(html).not.toContain("STATE-XYZ");
    expect(html).not.toMatch(/<a\b|<script\b|<img\b/);
  });
});

describe("Jóvenes pages share plansInMinistry (spec §10 A7)", () => {
  const PAGES = ["page.tsx", "calendario/page.tsx", "admin/page.tsx", "reunion/[token]/page.tsx"].map((p) => `app/(client)/jovenes/${p}`);
  for (const p of PAGES) {
    it(p, () => {
      const src = read(p);
      expect(src).toMatch(/plansInMinistry\(access, "jovenes"\)/);
      // The hand-rolled «manager or leads a group» test is gone.
      expect(src).not.toMatch(/isManager\s*\|\|\s*ledGroupsIn/);
      expect(src).not.toMatch(/!isManager\s*&&\s*led\.length\s*===\s*0/);
    });
  }
  it("the admin page GATES on it", () => {
    expect(read("app/(client)/jovenes/admin/page.tsx")).toMatch(/if \(!plansInMinistry\(access, "jovenes"\)\) redirect\("\/jovenes"\);/);
  });
});
