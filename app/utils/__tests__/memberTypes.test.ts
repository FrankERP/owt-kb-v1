// Pins `app/utils/memberTypes.ts` to `sanity/schemas/worshipTeam.ts`'s
// `memberType.options.list` — the canonical values/titles. `MeHeader`'s chips,
// `/admin`'s `TYPE_ABBR` and `PATCH /api/admin/members/[id]`'s write allowlist
// all read the values from here; this is what stops that list drifting away
// from the schema that actually stores it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MEMBER_TYPES, MEMBER_TYPE_LABEL } from "../memberTypes";

const SCHEMA = path.join(process.cwd(), "sanity/schemas/worshipTeam.ts");

/** The `memberType` field's own source, brace-matched — same technique as `themePrefSchema.test.ts`. */
function memberTypeFieldSource(): string {
  const src = readFileSync(SCHEMA, "utf8");
  const start = src.indexOf('name: "memberType"');
  expect(start, "`memberType` must exist on the teamMembers schema").toBeGreaterThan(-1);

  let open = start;
  while (open > 0 && src[open] !== "{") open--;
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(open, end + 1);
}

describe("memberTypes util (parity with sanity/schemas/worshipTeam.ts)", () => {
  const field = memberTypeFieldSource();
  const pairs = [...field.matchAll(/title:\s*"([^"]+)",\s*value:\s*"([^"]+)"/g)].map(
    ([, title, value]) => ({ title, value }),
  );

  it("finds all six options in the schema (sanity check on the fixture itself)", () => {
    expect(pairs).toHaveLength(6);
  });

  it("MEMBER_TYPES matches the schema's values, in the schema's order", () => {
    expect(MEMBER_TYPES).toEqual(pairs.map((p) => p.value));
  });

  it("MEMBER_TYPE_LABEL matches the schema's titles for every value", () => {
    for (const { title, value } of pairs) {
      expect(MEMBER_TYPE_LABEL[value]).toBe(title);
    }
  });
});
