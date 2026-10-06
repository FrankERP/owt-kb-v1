// Solver v3 C2 REC-5, REC-8, REC-9 — the `fairnessMonth` type is governed like
// `solverConfig`: hidden, read-only, every mutating Studio capability denied, every
// field listed as internal; it stores eligibility and never a computed figure; and the
// protected-read audit treats it as protected (a non-canonical read or a literal-named
// write of it is a violation).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { fairnessMonth } from "@/sanity/schemas/fairnessMonth";
import {
  INTERNAL_STUDIO_FIELDS,
  PROTECTED_STUDIO_TITLES,
  STUDIO_MUTATING_CAPABILITIES,
  isInternalStudioType,
  isProtectedStudioType,
  studioCapability,
} from "../studioProtection";
import { auditViolations, scanSource } from "../protectedReadAudit";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Field {
  name: string;
  type: string;
  weak?: boolean;
  fields?: Field[];
  of?: Array<{ type: string; name?: string; fields?: Field[] }>;
}

const FIELDS = (fairnessMonth as unknown as { fields: Field[] }).fields;
const field = (list: Field[] | undefined, name: string): Field => {
  const found = list?.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found;
};
const itemFields = (f: Field) => f.of?.[0]?.fields ?? [];

describe("the fairnessMonth schema (C2 REC-1 … REC-5)", () => {
  it("is a hidden, read-only document type", () => {
    const def = fairnessMonth as unknown as { name: string; type: string; hidden: boolean; readOnly: boolean };
    expect(def).toMatchObject({ name: "fairnessMonth", type: "document", hidden: true, readOnly: true });
  });

  it("declares exactly the fields INTERNAL_STUDIO_FIELDS governs (REC-8)", () => {
    expect(FIELDS.map((f) => f.name)).toEqual([...INTERNAL_STUDIO_FIELDS.fairnessMonth]);
  });

  it("stores people by weak reference, six role fields with no dots, and no figure (REC-3, REC-5)", () => {
    const people = itemFields(field(FIELDS, "people"));
    expect(people.map((f) => f.name)).toEqual(["member", "name", "roles", "exactRules", "sundayCadence", "exempt", "blocks"]);
    expect(field(people, "member")).toMatchObject({ type: "reference", weak: true });
    expect(field(people, "roles").fields?.map((f) => f.name)).toEqual([
      "sunLead",
      "satLead",
      "sunBgv",
      "satBgv",
      "sunChoir",
      "satChoir",
    ]);
    expect(itemFields(field(people, "exactRules")).map((f) => f.name)).toEqual(["roles", "count"]);
    expect(itemFields(field(people, "blocks")).map((f) => f.name)).toEqual(["date", "unavailable", "excludedRoles"]);
  });

  it("keeps names out of presence and never stores a computed figure or publication state (REC-4, REC-5)", () => {
    const presence = itemFields(field(FIELDS, "presence"));
    expect(presence.map((f) => f.name)).toEqual(["ruleKey", "roles", "members", "exclusive"]);
    const names: string[] = [];
    const walk = (list: Field[] | undefined) => {
      for (const f of list ?? []) {
        names.push(f.name);
        walk(f.fields);
        for (const item of f.of ?? []) walk(item.fields);
      }
    };
    walk(FIELDS);
    for (const forbidden of ["published", "balance", "share", "received", "seats", "state", "rule", "person", "persons"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });

  it("is registered in the Sanity schema", () => {
    const src = readFileSync(path.join(REPO_ROOT, "sanity/schema.ts"), "utf8");
    expect(src).toContain("./schemas/fairnessMonth");
    expect(src).toMatch(/types:\s*\[[\s\S]*fairnessMonth[\s\S]*\]/);
  });
});

describe("fairnessMonth in the Studio (C2 REC-8)", () => {
  it("is protected and internal, with its read-only pane title", () => {
    expect(isProtectedStudioType("fairnessMonth")).toBe(true);
    expect(isInternalStudioType("fairnessMonth")).toBe(true);
    expect(PROTECTED_STUDIO_TITLES.fairnessMonth).toBe("Registros de equidad (solo lectura)");
  });

  it("denies every mutating capability and keeps read", () => {
    for (const capability of STUDIO_MUTATING_CAPABILITIES) {
      expect(studioCapability("fairnessMonth", capability).allowed, capability).toBe(false);
    }
    for (const capability of ["create", "update", "delete", "publish", "unpublish", "duplicate", "restore"]) {
      expect(studioCapability("fairnessMonth", capability).allowed, capability).toBe(false);
    }
    expect(studioCapability("fairnessMonth", "read").allowed).toBe(true);
    expect(studioCapability("fairnessMonth", "create").mechanism).toContain("hidden");
  });
});

const CLIENT_IMPORTS = `
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
`;

describe("fairnessMonth in the protected-read audit (C2 REC-9)", () => {
  it("flags a read of the type off a non-canonical client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return serverClient.fetch(\`*[_type == "fairnessMonth"]{ _id, people }\`);
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ kind: "protected-literal-read", compliant: false });
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("accepts the same read through the canonical operational client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return operationalClient.fetch(\`*[_type == "fairnessMonth"]{ _id, people }\`);
}`,
    );
    expect(auditViolations(sites)).toHaveLength(0);
  });

  it("flags a literal-named write of the type on a recognised client as an unregistered protected-write", () => {
    const sites = scanSource(
      "app/utils/example.ts",
      `${CLIENT_IMPORTS}
export async function sneak() {
  await writeClient.create({ _id: "fairnessMonth.2026-11", _type: "fairnessMonth" });
}`,
    );
    expect(sites.map((s) => s.kind)).toEqual(["protected-write"]);
    expect(auditViolations(sites)).toHaveLength(1);
  });
});
