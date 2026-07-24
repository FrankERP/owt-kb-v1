// Schema-shape tests for the two internal A2 coordination types. They live under
// `app/utils/__tests__` because that is the vitest include root; the schemas
// themselves live with the rest of the Sanity schemas.

import { describe, expect, it } from "vitest";
import { schema } from "@/sanity/schema";
import { roleTargetLock } from "@/sanity/schemas/roleTargetLock";
import { roleCreationReceipt } from "@/sanity/schemas/roleCreationReceipt";
import { ROLE_TARGET_LOCK_TYPE } from "@/app/utils/roleTargetLock";
import { ROLE_CREATION_RECEIPT_TYPE } from "@/app/utils/roleCreationReceipt";

type Field = { name: string; type: string; options?: { list?: unknown[] } };

function fields(def: unknown): Field[] {
  return ((def as { fields?: Field[] }).fields ?? []) as Field[];
}

function optionValues(def: unknown, fieldName: string): unknown[] {
  const field = fields(def).find((f) => f.name === fieldName);
  return (field?.options?.list ?? []).map((o) => (o as { value: unknown }).value);
}

describe("internal coordination schemas are registered", () => {
  it.each([ROLE_TARGET_LOCK_TYPE, ROLE_CREATION_RECEIPT_TYPE])("registers %s once", (name) => {
    const hits = schema.types.filter((t) => (t as { name: string }).name === name);
    expect(hits).toHaveLength(1);
  });

  it("does not drop any previously registered type", () => {
    const names = schema.types.map((t) => (t as { name: string }).name);
    for (const previous of [
      "post",
      "tag",
      "author",
      "featuredSongs",
      "saturdarSongs",
      "saturday_role",
      "sunday_role",
      "teamMembers",
      "special_role",
      "loginEvent",
      "setlistProposal",
    ]) {
      expect(names).toContain(previous);
    }
  });
});

describe.each([
  ["roleTargetLock", roleTargetLock],
  ["roleCreationReceipt", roleCreationReceipt],
])("%s is an internal document type", (_name, def) => {
  it("is a document, hidden and read-only in the Studio", () => {
    expect(def).toMatchObject({ type: "document", hidden: true, readOnly: true });
  });

  it("does not use __experimental_actions (removed in Sanity v5, inert dead config)", () => {
    expect(def).not.toHaveProperty("__experimental_actions");
  });

  it("stores no strong references — a coordination doc must never cascade", () => {
    expect(fields(def).map((f) => f.type)).not.toContain("reference");
  });
});

describe("roleTargetLock fields", () => {
  it("declares exactly the §1 field list", () => {
    expect(fields(roleTargetLock).map((f) => [f.name, f.type])).toEqual([
      ["targetKey", "string"],
      ["state", "string"],
      ["roleId", "string"],
      ["roleType", "string"],
      ["date", "date"],
      ["claimNonce", "string"],
      ["generation", "number"],
      ["createdAt", "datetime"],
      ["updatedAt", "datetime"],
    ]);
  });

  it("constrains state to claimed | vacant", () => {
    expect(optionValues(roleTargetLock, "state")).toEqual(["claimed", "vacant"]);
  });

  it("constrains roleType to the two weekend types (special roles take no lock)", () => {
    expect(optionValues(roleTargetLock, "roleType")).toEqual(["sunday_role", "saturday_role"]);
  });
});

describe("roleCreationReceipt fields", () => {
  it("declares exactly the §2 field list", () => {
    expect(fields(roleCreationReceipt).map((f) => [f.name, f.type])).toEqual([
      ["requestId", "string"],
      ["fingerprint", "string"],
      ["roleId", "string"],
      ["roleType", "string"],
      ["targetIdentity", "string"],
      ["state", "string"],
      ["createdAt", "datetime"],
      ["updatedAt", "datetime"],
    ]);
  });

  it("constrains state to committed | role_deleted", () => {
    expect(optionValues(roleCreationReceipt, "state")).toEqual(["committed", "role_deleted"]);
  });

  it("constrains roleType to all three role types", () => {
    expect(optionValues(roleCreationReceipt, "roleType")).toEqual([
      "sunday_role",
      "saturday_role",
      "special_role",
    ]);
  });
});
