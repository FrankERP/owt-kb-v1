// Sanity does not support multidimensional arrays ("multidimensional arrays
// are not currently supported" — `npx sanity schema validate`). This walks
// every type's fields/of recursively and fails on any `array` whose member is
// itself an `array`, so a future field can't reintroduce the mistake that
// `post.rehearsalMixes[].active` originally shipped with (an array of arrays,
// fixed to an array of `{ _key, s, e }` objects).
import { describe, expect, it } from "vitest";
import { schema } from "@/sanity/schema";

interface SchemaNode {
  type?: string;
  name?: string;
  fields?: SchemaNode[];
  of?: SchemaNode[];
}

function findNestedArrays(node: SchemaNode, path: string, offenders: string[]) {
  if (!node || typeof node !== "object") return;
  if (node.type === "array") {
    for (const member of node.of ?? []) {
      const memberPath = `${path}[].${member.name ?? member.type}`;
      if (member.type === "array") {
        offenders.push(memberPath);
      }
      findNestedArrays(member, memberPath, offenders);
    }
    return;
  }
  for (const field of node.fields ?? []) {
    findNestedArrays(field, `${path}.${field.name}`, offenders);
  }
}

describe("Sanity schema — no nested arrays", () => {
  it("has no array-of-array field in any registered type", () => {
    const offenders: string[] = [];
    for (const type of schema.types as unknown as SchemaNode[]) {
      findNestedArrays(type, type.name ?? "?", offenders);
    }
    expect(offenders).toEqual([]);
  });
});
