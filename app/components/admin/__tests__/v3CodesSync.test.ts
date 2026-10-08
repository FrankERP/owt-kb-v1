// Solver v3 C6 NT-4 — every code C5 can emit has Spanish copy here, every copy names only
// parameters its code declares, and no copy exists for a code C5 does not list. Reads C5's registry
// (`gcf_v3/owt_v3/codes.json`) as data. Two registry groups are never shown and are excluded BY NAME:
// `limit` (none/deterministic/wall) and `violation_rule` (the fixed token `mandatory_lead`, which is
// rendered from the `violation` code's own copy, never through the rule-label map).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { V3_COPY_BY_GROUP, V3_HIDDEN_GROUPS, unknownCodeLine } from "../v3Copy";

const registry = JSON.parse(
  readFileSync(path.join(process.cwd(), "gcf_v3", "owt_v3", "codes.json"), "utf8"),
) as { contract: number; groups: Record<string, Record<string, string[]>> };

describe("C5's code registry ↔ C6's copy (NT-4)", () => {
  it("is the contract-3 registry", () => expect(registry.contract).toBe(3));

  it("every registry group is either copied here or excluded by name", () => {
    const copied = Object.keys(V3_COPY_BY_GROUP).sort();
    const all = Object.keys(registry.groups).sort();
    expect([...copied, ...V3_HIDDEN_GROUPS].sort()).toEqual(all);
  });

  for (const [group, codes] of Object.entries(registry.groups)) {
    if ((V3_HIDDEN_GROUPS as readonly string[]).includes(group)) continue;
    it(`group «${group}»: the same codes, and copy names only declared parameters`, () => {
      const copy = V3_COPY_BY_GROUP[group as keyof typeof V3_COPY_BY_GROUP];
      expect(Object.keys(copy).sort()).toEqual(Object.keys(codes).sort());
      for (const [code, params] of Object.entries(codes)) {
        for (const used of copy[code].params) expect(params).toContain(used);
      }
    });
  }

  it("a code not in the registry still renders a line at runtime", () => {
    expect(unknownCodeLine("brand_new")).toBe("El solver informó algo que el planificador no reconoce (brand_new).");
  });
});
