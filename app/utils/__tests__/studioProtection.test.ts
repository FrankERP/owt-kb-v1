// Service Readiness A2 §8 / A3 §4 — the Studio protection policy, asserted
// without a browser.
//
// The point of these tests: "we configured the Studio" is not evidence. The
// policy is code, so every capability of every one of the eight protected types
// is asserted here, plus the wiring in `sanity.config.ts` / `sanity/structure.ts`
// that actually installs it — and the fact that the v5-inert
// `__experimental_actions` is used nowhere.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DELETE_ONLY_STUDIO_TYPES,
  INTERNAL_STUDIO_FIELDS,
  INTERNAL_STUDIO_TYPES,
  PROTECTED_STUDIO_TITLES,
  PROTECTED_STUDIO_TYPES,
  SANITY_V5_BUILT_IN_ACTIONS,
  STUDIO_MUTATING_CAPABILITIES,
  STUDIO_READ_ONLY_CAPABILITIES,
  isDeleteOnlyStudioType,
  isGovernedStudioType,
  isInternalStudioField,
  isInternalStudioType,
  isProtectedStudioType,
  partitionStudioTypes,
  protectedDocumentActions,
  protectedNewDocumentOptions,
  studioCapability,
  templateItemType,
} from "../studioProtection";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function gitTracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

// ── The policy ──────────────────────────────────────────────────────────────

describe("studio protection policy", () => {
  it("covers exactly the eight protected types, keeping the saturdarSongs typo", () => {
    expect([...PROTECTED_STUDIO_TYPES]).toEqual([
      "sunday_role",
      "saturday_role",
      "special_role",
      "featuredSongs",
      "saturdarSongs",
      "setlistProposal",
      "roleTargetLock",
      "roleCreationReceipt",
    ]);
    expect(PROTECTED_STUDIO_TYPES).toContain("saturdarSongs");
    expect(PROTECTED_STUDIO_TYPES as readonly string[]).not.toContain("saturdaySongs");
  });

  it("denies create, update, delete, publish, unpublish and duplicate on every protected type", () => {
    for (const type of PROTECTED_STUDIO_TYPES) {
      for (const capability of ["create", "update", "delete", "publish", "unpublish", "duplicate"]) {
        const decision = studioCapability(type, capability);
        expect(decision.allowed, `${type} must deny ${capability}`).toBe(false);
        expect(decision.mechanism.length, `${type}/${capability} names no mechanism`).toBeGreaterThan(0);
        expect(decision.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("denies every mutating capability, including every Sanity v5 built-in action", () => {
    for (const type of PROTECTED_STUDIO_TYPES) {
      for (const capability of STUDIO_MUTATING_CAPABILITIES) {
        expect(studioCapability(type, capability).allowed, `${type}/${capability}`).toBe(false);
      }
      for (const action of SANITY_V5_BUILT_IN_ACTIONS) {
        expect(studioCapability(type, action).allowed, `${type}/${action}`).toBe(false);
      }
    }
    // Every built-in action is covered by the abstract capability list too.
    for (const action of SANITY_V5_BUILT_IN_ACTIONS) {
      expect(STUDIO_MUTATING_CAPABILITIES as readonly string[]).toContain(action);
    }
  });

  it("allows read-only inspection on every protected type", () => {
    for (const type of PROTECTED_STUDIO_TYPES) {
      for (const capability of STUDIO_READ_ONLY_CAPABILITIES) {
        const decision = studioCapability(type, capability);
        expect(decision.allowed, `${type}/${capability}`).toBe(true);
        expect(decision.mechanism).toBe("read-only inspection");
      }
    }
  });

  it("fails closed on an unknown capability", () => {
    expect(studioCapability("sunday_role", "someFutureAction").allowed).toBe(false);
    expect(studioCapability("sunday_role", "").allowed).toBe(false);
  });

  it("leaves ungoverned types alone", () => {
    for (const type of ["post", "teamMembers", "tag", "author"]) {
      for (const capability of [...STUDIO_MUTATING_CAPABILITIES, ...STUDIO_READ_ONLY_CAPABILITIES]) {
        expect(studioCapability(type, capability).allowed, `${type}/${capability}`).toBe(true);
      }
    }
    expect(isProtectedStudioType("post")).toBe(false);
    expect(isProtectedStudioType(undefined)).toBe(false);
    expect(isProtectedStudioType(null)).toBe(false);
  });

  it("marks the coordination types as internal, with an extra create mechanism", () => {
    expect([...INTERNAL_STUDIO_TYPES]).toEqual(["roleTargetLock", "roleCreationReceipt", "notificationOutbox"]);
    for (const type of INTERNAL_STUDIO_TYPES) {
      expect(isInternalStudioType(type)).toBe(true);
      expect(studioCapability(type, "create").mechanism).toContain("hidden");
    }
    expect(isInternalStudioType("sunday_role")).toBe(false);
  });

  it("governs notificationOutbox as prunable by an operator but never hand-authored", () => {
    // Coordination state written only by the server write token (spec §1). Pruning
    // a stuck or malformed entry is legitimate operator work; hand-authoring or
    // editing one is not — so it must be BOTH delete-only and internal at once.
    expect(studioCapability("notificationOutbox", "read").allowed).toBe(true);
    expect(studioCapability("notificationOutbox", "create").allowed).toBe(false);
    expect(studioCapability("notificationOutbox", "update").allowed).toBe(false);
    expect(studioCapability("notificationOutbox", "delete").allowed).toBe(true);
    expect(studioCapability("notificationOutbox", "create").mechanism).toContain("hidden");
    expect(isDeleteOnlyStudioType("notificationOutbox")).toBe(true);
    expect(isInternalStudioType("notificationOutbox")).toBe(true);
  });

  it("keeps the lock state and the internal idempotency fields hidden", () => {
    for (const field of ["creationReceiptId", "creationFingerprint"]) {
      for (const roleType of ["sunday_role", "saturday_role", "special_role"]) {
        expect(isInternalStudioField(roleType, field), `${roleType}.${field}`).toBe(true);
      }
    }
    for (const field of ["claimNonce", "generation", "state", "roleId"]) {
      expect(isInternalStudioField("roleTargetLock", field), field).toBe(true);
    }
    for (const field of ["requestId", "fingerprint", "state"]) {
      expect(isInternalStudioField("roleCreationReceipt", field), field).toBe(true);
    }
    expect(isInternalStudioField("sunday_role", "week")).toBe(false);
    expect(isInternalStudioField("post", "title")).toBe(false);
  });
});

// ── The delete-only category (Service Readiness A3 §4) ──────────────────────

describe("delete-only studio policy (loginEvent)", () => {
  it("covers exactly loginEvent and notificationOutbox, and is governed but not `protected`", () => {
    expect([...DELETE_ONLY_STUDIO_TYPES]).toEqual(["loginEvent", "notificationOutbox"]);
    expect(isDeleteOnlyStudioType("loginEvent")).toBe(true);
    expect(isDeleteOnlyStudioType("post")).toBe(false);
    expect(isGovernedStudioType("loginEvent")).toBe(true);
    expect(isGovernedStudioType("sunday_role")).toBe(true);
    expect(isGovernedStudioType("post")).toBe(false);
    // It is NOT one of the eight fully protected types.
    expect(isProtectedStudioType("loginEvent")).toBe(false);
    expect(PROTECTED_STUDIO_TYPES as readonly string[]).not.toContain("loginEvent");
  });

  it("allows read and delete", () => {
    for (const capability of STUDIO_READ_ONLY_CAPABILITIES) {
      expect(studioCapability("loginEvent", capability).allowed, capability).toBe(true);
    }
    const del = studioCapability("loginEvent", "delete");
    expect(del.allowed).toBe(true);
    expect(del.mechanism).toBe("document.actions -> [delete]");
  });

  it("denies create, update, publish, unpublish and duplicate", () => {
    for (const capability of ["create", "update", "publish", "unpublish", "duplicate"]) {
      const decision = studioCapability("loginEvent", capability);
      expect(decision.allowed, `loginEvent must deny ${capability}`).toBe(false);
      expect(decision.mechanism.length).toBeGreaterThan(0);
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });

  it("denies every other mutating capability, and fails closed on an unknown one", () => {
    for (const capability of STUDIO_MUTATING_CAPABILITIES) {
      if (capability === "delete") continue;
      expect(studioCapability("loginEvent", capability).allowed, capability).toBe(false);
    }
    expect(studioCapability("loginEvent", "someFutureAction").allowed).toBe(false);
    expect(studioCapability("loginEvent", "").allowed).toBe(false);
  });

  it("keeps only the delete action, and drops its create template", () => {
    const actions = SANITY_V5_BUILT_IN_ACTIONS.map((action) => ({ action }));
    expect(protectedDocumentActions(actions, { schemaType: "loginEvent" })).toEqual([{ action: "delete" }]);
    expect(protectedNewDocumentOptions([{ templateId: "loginEvent" }, { templateId: "post" }])).toEqual([
      { templateId: "post" },
    ]);
  });

  it("stays in the default structure list (it is prunable, not `solo lectura`)", () => {
    const { editable, inspectOnly } = partitionStudioTypes(["loginEvent", "sunday_role", "post"]);
    expect(editable).toEqual(["loginEvent", "post"]);
    expect(inspectOnly).toEqual(["sunday_role"]);
  });

  it("declares the schema type read-only with the four hidden A3 ownership fields", () => {
    const src = read("sanity/schemas/loginEvent.ts");
    expect(src).toMatch(/name:\s*["']loginEvent["']/);
    expect(src, "loginEvent must be a readOnly type").toMatch(/^\s*readOnly:\s*true,\s*$/m);
    for (const field of ["runId", "attemptId", "candidateSha", "deploymentId"]) {
      const at = src.indexOf(`name: "${field}"`);
      expect(at, `${field} is not declared`).toBeGreaterThan(-1);
      const declaration = src.slice(at, at + 200);
      expect(declaration, `${field} must be hidden`).toContain("hidden: true");
      expect(declaration, `${field} must be readOnly`).toContain("readOnly: true");
      // Optional: no validation rule may make an ordinary sign-in invalid.
      expect(declaration, `${field} must stay optional`).not.toContain("validation");
    }
  });
});

// ── Resolvers ───────────────────────────────────────────────────────────────

describe("document.actions resolver", () => {
  const ALL_ACTIONS = SANITY_V5_BUILT_IN_ACTIONS.map((action) => ({ action }));

  it("strips every action for every protected type", () => {
    for (const type of PROTECTED_STUDIO_TYPES) {
      expect(protectedDocumentActions(ALL_ACTIONS, { schemaType: type }), type).toEqual([]);
    }
  });

  it("strips a plugin action that carries no identifier (fail closed)", () => {
    expect(protectedDocumentActions([{ displayName: "Mystery" }], { schemaType: "setlistProposal" })).toEqual([]);
  });

  it("returns other types' actions untouched, by reference", () => {
    const prev = [...ALL_ACTIONS];
    expect(protectedDocumentActions(prev, { schemaType: "post" })).toBe(prev);
  });

  it("applies regardless of how the pane was reached (it only sees the schema type)", () => {
    // There is no "arrived by URL" escape hatch: the resolver's only input that
    // matters is the schema type, so a hand-typed intent URL is covered too.
    expect(protectedDocumentActions(ALL_ACTIONS, { schemaType: "roleTargetLock" })).toEqual([]);
  });
});

describe("document.newDocumentOptions resolver", () => {
  it("drops every protected template and keeps the rest", () => {
    const prev = [
      ...PROTECTED_STUDIO_TYPES.map((t) => ({ templateId: t })),
      { templateId: "post" },
      { templateId: "teamMembers" },
    ];
    expect(protectedNewDocumentOptions(prev).map((t) => t.templateId)).toEqual(["post", "teamMembers"]);
  });

  it("drops a template that names its type only through parameters", () => {
    const prev = [
      { templateId: "custom-a", parameters: { type: "sunday_role" } },
      { templateId: "custom-b", parameters: { schemaType: "saturdarSongs" } },
      { templateId: "custom-c", parameters: { type: "post" } },
    ];
    expect(protectedNewDocumentOptions(prev).map((t) => t.templateId)).toEqual(["custom-c"]);
  });

  it("resolves a template item's type from parameters first, then the id", () => {
    expect(templateItemType({ templateId: "x", parameters: { type: "post" } })).toBe("post");
    expect(templateItemType({ templateId: "post" })).toBe("post");
    expect(templateItemType({ templateId: "" })).toBeNull();
  });
});

describe("structure partitioning", () => {
  it("routes protected types to the read-only inspection group only", () => {
    const { editable, inspectOnly } = partitionStudioTypes([
      "post",
      "sunday_role",
      "teamMembers",
      "saturdarSongs",
      "roleCreationReceipt",
    ]);
    expect(editable).toEqual(["post", "teamMembers"]);
    expect(inspectOnly).toEqual(["sunday_role", "saturdarSongs", "roleCreationReceipt"]);
  });

  it("titles every protected type for that group", () => {
    for (const type of PROTECTED_STUDIO_TYPES) {
      expect(PROTECTED_STUDIO_TITLES[type], type).toMatch(/solo lectura/);
    }
    expect(Object.keys(PROTECTED_STUDIO_TITLES).sort()).toEqual([...PROTECTED_STUDIO_TYPES].sort());
  });
});

// ── The policy is actually installed ────────────────────────────────────────

describe("studio config installs the policy", () => {
  const config = read("sanity.config.ts");
  const structure = read("sanity/structure.ts");

  it("wires both resolvers into sanity.config.ts", () => {
    expect(config).toContain("protectedDocumentActions");
    expect(config).toContain("protectedNewDocumentOptions");
    expect(config).toMatch(/actions\s*:/);
    expect(config).toMatch(/newDocumentOptions\s*:/);
    expect(config).toContain("structureTool({structure: serviceReadinessStructure})");
  });

  it("never uses the v5-inert __experimental_actions in any governed schema or the Studio config", () => {
    // `__experimental_actions` was REMOVED in Sanity v5: assigning it protects
    // nothing. Every governed type and the Studio config must therefore rely on
    // the supported mechanisms only. `sanity/schemas/loginEvent.ts` carried an
    // inert `["read","delete"]` leftover from the v3 era — meaning that type had
    // silently lost its restriction — and A3 §4 replaced it with the code-owned
    // delete-only policy above.
    const owned = [
      "sanity.config.ts",
      "sanity/structure.ts",
      "app/utils/studioProtection.ts",
      "sanity/schemas/loginEvent.ts",
      "sanity/schemas/sunRole.ts",
      "sanity/schemas/satRole.ts",
      "sanity/schemas/specialRole.ts",
      "sanity/schemas/setList.ts",
      "sanity/schemas/satSongs.ts",
      "sanity/schemas/setlistProposal.ts",
      "sanity/schemas/roleTargetLock.ts",
      "sanity/schemas/roleCreationReceipt.ts",
    ];
    const tracked = new Set(gitTracked());
    for (const file of owned) {
      expect(tracked.has(file), `${file} is not git-tracked`).toBe(true);
      // Prose may explain the removal; no file may ASSIGN it as a config key.
      expect(read(file), `${file} assigns __experimental_actions`).not.toMatch(/__experimental_actions\s*:/);
    }
  });

  it("hides every protected type from the default structure list", () => {
    expect(structure).toContain("partitionStudioTypes");
    expect(structure).toContain("PROTECTED_STUDIO_TYPES");
  });

  it("marks all eight protected schema types read-only", () => {
    const files: Record<string, string> = {
      sunday_role: "sanity/schemas/sunRole.ts",
      saturday_role: "sanity/schemas/satRole.ts",
      special_role: "sanity/schemas/specialRole.ts",
      featuredSongs: "sanity/schemas/setList.ts",
      saturdarSongs: "sanity/schemas/satSongs.ts",
      setlistProposal: "sanity/schemas/setlistProposal.ts",
      roleTargetLock: "sanity/schemas/roleTargetLock.ts",
      roleCreationReceipt: "sanity/schemas/roleCreationReceipt.ts",
    };
    for (const type of PROTECTED_STUDIO_TYPES) {
      const src = read(files[type]);
      expect(src, `${files[type]} declares ${type}`).toMatch(new RegExp(`name:\\s*['"]${type}['"]`));
      expect(src, `${files[type]} must be readOnly`).toMatch(/readOnly:\s*true/);
    }
  });

  it("keeps the internal fields off the authoring surface, each by its own mechanism", () => {
    // Role types: the two internal idempotency links are `hidden: true` FIELDS.
    for (const file of ["sanity/schemas/sunRole.ts", "sanity/schemas/satRole.ts", "sanity/schemas/specialRole.ts"]) {
      const src = read(file);
      for (const field of ["creationReceiptId", "creationFingerprint"]) {
        const declaration = src.slice(src.indexOf(`name: '${field}'`), src.indexOf(`name: '${field}'`) + 260);
        expect(declaration, `${file}.${field} must be hidden`).toMatch(/hidden:\s*true/);
        expect(declaration, `${file}.${field} must be readOnly`).toMatch(/readOnly:\s*true/);
      }
    }
    // Coordination types: the whole TYPE is hidden, which covers every field.
    for (const file of [
      "sanity/schemas/roleTargetLock.ts",
      "sanity/schemas/roleCreationReceipt.ts",
      "sanity/schemas/notificationOutbox.ts",
    ]) {
      const src = read(file);
      expect(src, `${file} must be a hidden type`).toMatch(/^\s*hidden:\s*true,\s*$/m);
      expect(src, `${file} must be a readOnly type`).toMatch(/^\s*readOnly:\s*true,\s*$/m);
    }
    // And the policy lists the fields those mechanisms cover.
    expect(Object.keys(INTERNAL_STUDIO_FIELDS).sort()).toEqual(
      [
        "sunday_role",
        "saturday_role",
        "special_role",
        "roleTargetLock",
        "roleCreationReceipt",
        "notificationOutbox",
      ].sort(),
    );
  });
});
