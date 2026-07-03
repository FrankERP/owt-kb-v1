// app/utils/__tests__/proposalContributors.test.ts
import { describe, it, expect } from "vitest";
import { mergeContributor } from "../proposalContributors";

let n = 0;
const key = () => `k${n++}`;

describe("mergeContributor", () => {
  it("creates a single-entry array when there are no existing contributors", () => {
    n = 0;
    const out = mergeContributor(undefined, "me", key);
    expect(out).toEqual([{ _type: "contributor", _key: "k0", person: { _type: "reference", _ref: "me" } }]);
  });

  it("appends the editor once, preserving existing entries and their _keys", () => {
    n = 0;
    const existing = [{ _key: "ana1", person: { _ref: "ana" } }];
    const out = mergeContributor(existing, "me", key);
    expect(out.map(c => c.person._ref)).toEqual(["ana", "me"]);
    expect(out[0]._key).toBe("ana1"); // preserved, not regenerated
    expect(out[1]._key).toBe("k0");
  });

  it("does NOT double-add an editor who is already a contributor", () => {
    n = 0;
    const existing = [
      { _key: "ana1", person: { _ref: "ana" } },
      { _key: "me1", person: { _ref: "me" } },
    ];
    const out = mergeContributor(existing, "me", key);
    expect(out.map(c => c.person._ref)).toEqual(["ana", "me"]);
    expect(n).toBe(0); // no new key minted
  });

  it("drops malformed entries with no person ref", () => {
    n = 0;
    const existing = [{ _key: "x", person: {} }, { _key: "ana1", person: { _ref: "ana" } }];
    const out = mergeContributor(existing, "me", key);
    expect(out.map(c => c.person._ref)).toEqual(["ana", "me"]);
  });

  it("always tags items as contributor/reference with a _key", () => {
    n = 0;
    const out = mergeContributor([{ _key: "a", person: { _ref: "ana" } }], "me", key);
    for (const c of out) {
      expect(c._type).toBe("contributor");
      expect(c.person._type).toBe("reference");
      expect(typeof c._key).toBe("string");
    }
  });
});
