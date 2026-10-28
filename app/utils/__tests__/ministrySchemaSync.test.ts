// The Studio's ministry fields are built from the registry, never typed by hand
// (ADR-0075). The guard that matters: `ministries` offers ASSIGNABLE ids only,
// so registering a ministry for READING never lets the Studio store it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { teamMembers } from "@/sanity/schemas/worshipTeam";
import {
  ASSIGNABLE_MINISTRY_IDS,
  LEVELED_MINISTRY_IDS,
  MINISTRIES,
  MINISTRY_LEVELS,
} from "@/app/ministries";

type Field = {
  name: string;
  readOnly?: boolean;
  options?: { list?: { value: string }[] };
  of?: { fields?: Field[] }[];
};
const fields = (teamMembers as unknown as { fields: Field[] }).fields;
const field = (name: string) => fields.find((f) => f.name === name)!;
const values = (f: Field) => (f.options?.list ?? []).map((o) => o.value);

describe("app/ministries.ts stays importable by the Studio", () => {
  it("has no imports — the Studio's browser bundle has no CI build to catch a leak", () => {
    const src = readFileSync(path.join(process.cwd(), "app/ministries.ts"), "utf8");
    expect(src.match(/^\s*(import|export\s.*\sfrom)\s/m)).toBeNull();
  });
});

describe("teamMembers ministry fields ↔ registry", () => {
  it("`ministries` offers exactly the assignable ministries", () => {
    expect(values(field("ministries"))).toEqual(ASSIGNABLE_MINISTRY_IDS);
  });
  it("`ministryRoles` is read-only — its one writer is the members API", () => {
    expect(field("ministryRoles").readOnly).toBe(true);
  });
  it("`ministryRoles` items list the leveled ministries, the levels and their groups", () => {
    const item = (field("ministryRoles").of ?? [])[0];
    const sub = (n: string) => item.fields!.find((f) => f.name === n)!;
    expect(values(sub("ministry"))).toEqual(LEVELED_MINISTRY_IDS);
    expect(values(sub("level"))).toEqual([...MINISTRY_LEVELS]);
    expect(values(sub("groups"))).toEqual(LEVELED_MINISTRY_IDS.flatMap((id) => MINISTRIES[id].groups.map((g) => g.id)));
  });
});
