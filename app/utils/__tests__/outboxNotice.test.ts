import { describe, expect, it } from "vitest";
import { buildUpsert, isDue, outboxId, parseMinutesEnv, songRowsFrom } from "../outboxNotice";

const NOW = new Date("2026-08-01T10:00:00.000Z");
const DEBOUNCE = 15 * 60_000;
const MAX_WINDOW = 60 * 60_000;
const CLAIM_TTL = 5 * 60_000;

describe("outboxId", () => {
  it("is deterministic for the same subject", () => {
    expect(outboxId("role", "m1__r1")).toBe(outboxId("role", "m1__r1"));
  });

  it("separates kinds that share a subject key", () => {
    expect(outboxId("role", "r1")).not.toBe(outboxId("setlist", "r1"));
  });

  it("stays inside Sanity's id ceiling even for two 200-char ids", () => {
    const long = "a".repeat(200);
    expect(outboxId("role", `${long}__${long}`).length).toBeLessThanOrEqual(128);
  });

  it("produces an id Sanity accepts", () => {
    expect(outboxId("setlist", "r1")).toMatch(/^outbox\.[a-z]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("songRowsFrom", () => {
  const song = (ref: string, key: string, tag?: string) => ({
    _key: `k-${ref}`, play_key: key, medley_tag: tag, song: { _ref: ref },
  });

  it("records the run index rather than the tag", () => {
    // Two adjacent songs share a tag -> run 0. The tag VALUE is never stored.
    const rows = songRowsFrom([song("a", "G"), song("b", "D", "t1"), song("c", "D", "t1")]);
    expect(rows.map((r) => r.group)).toEqual([null, 0, 0]);
    expect(JSON.stringify(rows)).not.toContain("t1");
  });

  it("normalizes a one-song run to null", () => {
    // buildRuns emits a one-song medley run from stored data; the renderer draws
    // it as a plain single, so the comparison must agree.
    expect(songRowsFrom([song("a", "G", "lonely")])[0].group).toBeNull();
  });

  it("gives two different tag values with identical grouping the same rows", () => {
    const a = songRowsFrom([song("x", "A", "t1"), song("y", "A", "t1")]);
    const b = songRowsFrom([song("x", "A", "zz"), song("y", "A", "zz")]);
    expect(a.map((r) => ({ ...r, _key: "" }))).toEqual(b.map((r) => ({ ...r, _key: "" })));
  });

  it("carries a _key on every row", () => {
    expect(songRowsFrom([song("a", "G")])[0]._key).toBeTruthy();
  });

  it("tolerates junk", () => {
    expect(songRowsFrom(null)).toEqual([]);
    expect(songRowsFrom([{}, { song: {} }])).toEqual([]);
  });
});

describe("parseMinutesEnv", () => {
  it("falls back when the value is absent", () => {
    expect(parseMinutesEnv(undefined, 15)).toBe(15);
  });

  it("falls back when the value is an empty string", () => {
    // `??` alone wouldn't catch this — Number("") === 0, silently zeroing the window.
    expect(parseMinutesEnv("", 15)).toBe(15);
  });

  it("falls back when the value is non-numeric", () => {
    expect(parseMinutesEnv("abc", 15)).toBe(15);
  });

  it("falls back when the value is zero", () => {
    expect(parseMinutesEnv("0", 15)).toBe(15);
  });

  it("falls back when the value is negative", () => {
    expect(parseMinutesEnv("-5", 15)).toBe(15);
  });

  it("uses the parsed value when it is a positive number", () => {
    expect(parseMinutesEnv("30", 15)).toBe(30);
  });
});

describe("buildUpsert", () => {
  const input = {
    kind: "role" as const,
    subjectKey: "m1__r1",
    memberId: "m1",
    roleId: "r1",
    proposalId: null,
    serviceDate: "2026-08-09",
    roleType: "sunday_role" as const,
    before: { beforeRoles: ["BGV"] },
    knownRecipients: ["m1"],
  };

  it("creates with the ceiling and patches only the sliding fields", () => {
    const { createIfNotExists, patchSet } = buildUpsert(input, NOW);
    expect(createIfNotExists.deadline).toBe(new Date(NOW.getTime() + MAX_WINDOW).toISOString());
    expect(createIfNotExists.firstQueuedAt).toBe(NOW.toISOString());
    expect(createIfNotExists.status).toBe("pending");
    // The patch must never carry `deadline` — it is written once, at creation.
    expect(patchSet).toEqual({
      notifyAfter: new Date(NOW.getTime() + DEBOUNCE).toISOString(),
      status: "pending",
    });
  });

  it("uses the deterministic id", () => {
    expect(buildUpsert(input, NOW).createIfNotExists._id).toBe(outboxId("role", "m1__r1"));
  });

  it("computes notifyAfter and deadline from an overridden window", () => {
    const debounceMs = 2 * 60_000;
    const maxWindowMs = 10 * 60_000;
    const { createIfNotExists, patchSet } = buildUpsert(input, NOW, { debounceMs, maxWindowMs });
    expect(createIfNotExists.notifyAfter).toBe(new Date(NOW.getTime() + debounceMs).toISOString());
    expect(createIfNotExists.deadline).toBe(new Date(NOW.getTime() + maxWindowMs).toISOString());
    expect(patchSet).toEqual({
      notifyAfter: new Date(NOW.getTime() + debounceMs).toISOString(),
      status: "pending",
    });
  });

  it("overriding only one window value leaves the other at its module default", () => {
    const debounceMs = 90_000;
    const { createIfNotExists } = buildUpsert(input, NOW, { debounceMs });
    expect(createIfNotExists.notifyAfter).toBe(new Date(NOW.getTime() + debounceMs).toISOString());
    expect(createIfNotExists.deadline).toBe(new Date(NOW.getTime() + MAX_WINDOW).toISOString());
  });
});

describe("isDue", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it("is due when the debounce has elapsed", () => {
    expect(isDue({ status: "pending", notifyAfter: at(-1), deadline: at(MAX_WINDOW), claimedAt: null }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("is not due while the window is sliding", () => {
    expect(isDue({ status: "pending", notifyAfter: at(60_000), deadline: at(MAX_WINDOW), claimedAt: null }, NOW, CLAIM_TTL)).toBe(false);
  });

  it("is due at the ceiling even while edits continue", () => {
    // Defeats starvation: an admin saving every 10 minutes forever.
    expect(isDue({ status: "pending", notifyAfter: at(600_000), deadline: at(-1), claimedAt: null }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("reclaims a notice whose lease expired", () => {
    // Without this a killed sweep strands the notice in `sending` permanently.
    expect(isDue({ status: "sending", notifyAfter: at(-1), deadline: at(-1), claimedAt: at(-CLAIM_TTL - 1) }, NOW, CLAIM_TTL)).toBe(true);
  });

  it("leaves a live lease alone", () => {
    expect(isDue({ status: "sending", notifyAfter: at(-1), deadline: at(-1), claimedAt: at(-1000) }, NOW, CLAIM_TTL)).toBe(false);
  });
});
