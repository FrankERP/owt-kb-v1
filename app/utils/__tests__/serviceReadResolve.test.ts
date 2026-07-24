import { describe, expect, it } from "vitest";
import {
  normalizeBaseId,
  publicTargetState,
  resolveMembers,
} from "@/app/utils/serviceReadModel";

describe("normalizeBaseId", () => {
  it("strips the drafts. prefix so an overlay maps to its canonical identity", () => {
    expect(normalizeBaseId("drafts.role-1")).toBe("role-1");
    expect(normalizeBaseId("role-1")).toBe("role-1");
    expect(normalizeBaseId("drafts.drafts.x")).toBe("drafts.x"); // only one prefix stripped
  });
});

describe("resolveMembers", () => {
  const members = new Map([
    ["m1", { _id: "m1", _rev: "r1", member_name: "Ana", alias: "Ana" }],
    ["m2", { _id: "m2", _rev: "r2", member_name: "Beto", alias: "B" }],
  ]);

  it("resolves known refs and reports unknown refs as dangling (never dropped)", () => {
    const { members: resolved, danglingRefs } = resolveMembers(["m1", "ghost", "m2"], members);
    expect(resolved.map((m) => m._id)).toEqual(["m1", "m2"]);
    expect(danglingRefs).toEqual(["ghost"]);
  });

  it("deduplicates repeated refs", () => {
    const { members: resolved, danglingRefs } = resolveMembers(["m1", "m1", "ghost", "ghost"], members);
    expect(resolved.map((m) => m._id)).toEqual(["m1"]);
    expect(danglingRefs).toEqual(["ghost"]);
  });

  it("empty refs resolve to nothing (clean), not dangling", () => {
    const { members: resolved, danglingRefs } = resolveMembers([], members);
    expect(resolved).toEqual([]);
    expect(danglingRefs).toEqual([]);
  });
});

describe("publicTargetState", () => {
  it("mirrors canonical state when no relevant raw drafts exist", () => {
    expect(publicTargetState("none", [])).toBe("none");
    expect(publicTargetState("single", [])).toBe("single");
    expect(publicTargetState("duplicate", [])).toBe("duplicate");
    expect(publicTargetState("invalid", [])).toBe("invalid");
  });

  it("becomes draft_conflict whenever a relevant raw draft exists, regardless of canonical state", () => {
    expect(publicTargetState("none", ["drafts.x"])).toBe("draft_conflict");
    expect(publicTargetState("single", ["drafts.x"])).toBe("draft_conflict");
    expect(publicTargetState("duplicate", ["drafts.x", "drafts.y"])).toBe("draft_conflict");
  });
});
