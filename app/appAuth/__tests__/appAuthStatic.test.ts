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

describe("every app API route calls the guard first, with a literal level", () => {
  const ROOT = path.join(REPO, "app/api/app/v1");
  const DOOR = new Set(["auth/token/route.ts", "auth/revoke/route.ts"].map((r) => path.join(ROOT, r)));
  const files = routeFiles(ROOT);
  const NEEDS_LITERAL =
    /^\{\s*needs:\s*(?:"self"|"manager"|"super-admin"|\{\s*ministry:\s*"(?:worship|kids|jovenes)",\s*as:\s*"(?:member|planner|manager)"\s*\})\s*\}$/;

  it("finds the door endpoints and at least one guarded route", () => {
    for (const d of DOOR) expect(files).toContain(d);
    expect(files.filter((f) => !DOOR.has(f)).length).toBeGreaterThan(0);
  });

  for (const file of files.filter((f) => !DOOR.has(f))) {
    it(path.relative(REPO, file), () => {
      const src = read(path.relative(REPO, file));
      const handlers = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
      expect(handlers.length).toBeGreaterThan(0);
      expect(src).not.toMatch(/export\s+(?:const|let)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/);
      for (const [, method, body] of handlers) {
        const first = body!.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("//"));
        const m = /^const\s+\w+\s*=\s*await\s+requireAppSession\(\s*\w+\s*,\s*(\{[\s\S]*\})\s*\);$/.exec(first ?? "");
        expect(m, `${method}: first statement must be \`await requireAppSession(request, { needs: … })\``).not.toBeNull();
        expect(m![1]!.replace(/\s+/g, " "), `${method}: needs must be a literal level`).toMatch(NEEDS_LITERAL);
      }
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
