// scripts/lib/proposalRank.test.mjs
import { describe, it, expect } from "vitest";
import { advancementRank } from "./proposalRank.mjs";

describe("advancementRank (migration winner-selection)", () => {
  it("ranks approved HIGHEST — it backs the live setlist and must never be dropped", () => {
    expect(advancementRank("approved")).toBeGreaterThan(advancementRank("pending"));
    expect(advancementRank("approved")).toBeGreaterThan(advancementRank("changes_requested"));
    expect(advancementRank("approved")).toBeGreaterThan(advancementRank("draft"));
  });

  it("orders the rest pending > changes_requested > draft", () => {
    expect(advancementRank("pending")).toBeGreaterThan(advancementRank("changes_requested"));
    expect(advancementRank("changes_requested")).toBeGreaterThan(advancementRank("draft"));
  });

  it("picks the approved winner among a mixed group", () => {
    const group = ["draft", "pending", "approved", "changes_requested"];
    const winner = [...group].sort((a, b) => advancementRank(b) - advancementRank(a))[0];
    expect(winner).toBe("approved");
  });

  it("treats unknown status as lowest", () => {
    expect(advancementRank("bogus")).toBe(0);
  });
});
