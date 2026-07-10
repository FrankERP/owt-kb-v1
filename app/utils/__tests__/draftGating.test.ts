import { describe, it, expect } from "vitest";
import { publishedSetlist } from "../draftGating";

describe("publishedSetlist (draft-gating for weekend setlists)", () => {
  const setlist = { songs: [{ title: "Santo" }], week: "2026-07-12" };
  const publishedRole = { week: "2026-07-12", Lead: [] };

  it("returns the setlist when a published role is present", () => {
    expect(publishedSetlist(publishedRole, setlist)).toBe(setlist);
  });

  it("hides the setlist when the role is null (draft/unpublished service)", () => {
    // Role queries filter `published != false`, so null == no published role.
    expect(publishedSetlist(null, setlist)).toBeNull();
  });

  it("hides the setlist when the role is undefined", () => {
    expect(publishedSetlist(undefined, setlist)).toBeNull();
  });

  it("normalizes a missing setlist to null even when the role is published", () => {
    expect(publishedSetlist(publishedRole, null)).toBeNull();
    expect(publishedSetlist(publishedRole, undefined)).toBeNull();
  });
});
