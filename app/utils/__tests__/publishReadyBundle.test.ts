// Pure halves of the server-authoritative publish bundle (Plan B item 3):
// batch-level op merging, the publication-flag fold, and the recovery predicate.
// The Sanity clients are only mocked so the `server-only` module can load.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: vi.fn() },
  rawIntegrityClient: { fetch: vi.fn() },
}));

import type { AssertionOp } from "../publishReadyTransaction";
import {
  allObservedIn,
  mergeAssertionOps,
  parsePublishReadyRequest,
  parseUnpublishRequest,
  withPublishedTrue,
  type ObservedPublication,
} from "../publishReadyBundle";

function op(over: Partial<AssertionOp> = {}): AssertionOp {
  return {
    kind: "assert",
    id: "mem-1",
    rev: "mem-rev-1",
    set: {},
    unset: [],
    subject: "member",
    ...over,
  };
}

describe("mergeAssertionOps", () => {
  it("keeps distinct documents untouched and in order", () => {
    const ops = [op({ id: "a" }), op({ id: "b" }), op({ id: "c" })];
    const merged = mergeAssertionOps(ops);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.ops.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("collapses two identical observations of the same document into one op", () => {
    const merged = mergeAssertionOps([
      op({ set: { unavailableDates: ["2026-08-09"] } }),
      op({ set: { unavailableDates: ["2026-08-09"] } }),
    ]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.ops).toHaveLength(1);
    expect(merged.ops[0].set).toEqual({ unavailableDates: ["2026-08-09"] });
  });

  it("unions unsets and does not mutate the input ops", () => {
    const first = op({ unset: ["unavailableDates"] });
    const merged = mergeAssertionOps([first, op({ unset: ["unavailableDates"] })]);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.ops[0].unset).toEqual(["unavailableDates"]);
    expect(first.unset).toEqual(["unavailableDates"]);
  });

  it("refuses a revision disagreement rather than letting the last write win", () => {
    const merged = mergeAssertionOps([op({ rev: "mem-rev-1" }), op({ rev: "mem-rev-2" })]);
    expect(merged).toEqual({ ok: false, issues: ["revision_disagreement:mem-1"] });
  });

  it("refuses a value disagreement on the same field", () => {
    const merged = mergeAssertionOps([
      op({ set: { unavailableDates: ["2026-08-09"] } }),
      op({ set: { unavailableDates: [] } }),
    ]);
    expect(merged).toEqual({ ok: false, issues: ["value_disagreement:mem-1:unavailableDates"] });
  });

  it("refuses a field that one observation sets and another unsets", () => {
    const merged = mergeAssertionOps([
      op({ set: { unavailableDates: [] } }),
      op({ unset: ["unavailableDates"] }),
    ]);
    expect(merged).toEqual({
      ok: false,
      issues: ["set_unset_conflict:mem-1:unavailableDates"],
    });
  });

  it("returns an empty plan for no ops", () => {
    expect(mergeAssertionOps([])).toEqual({ ok: true, ops: [] });
  });
});

describe("withPublishedTrue", () => {
  it("folds the flag into each role's own assertion and nothing else", () => {
    const result = withPublishedTrue(
      [
        op({ id: "role-1", rev: "rev-1", set: { week: "2026-08-09" }, subject: "role" }),
        op({ id: "mem-1", set: { unavailableDates: [] } }),
      ],
      ["role-1"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0].set).toEqual({ week: "2026-08-09", published: true });
    expect(result.ops[1].set).toEqual({ unavailableDates: [] });
  });

  it("refuses when a requested role has no role assertion to fold into", () => {
    const result = withPublishedTrue([op({ id: "mem-1" })], ["role-1"]);
    expect(result).toEqual({ ok: false, issues: ["no_role_assertion:role-1"] });
  });

  it("never flags a non-role op that happens to share an id", () => {
    const result = withPublishedTrue(
      [
        op({ id: "sp-1", rev: "sp-rev-1", set: { date: "2026-08-15" }, subject: "role" }),
        op({ id: "lock", subject: "lock" }),
      ],
      ["sp-1"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[1].set).toEqual({});
  });
});

describe("allObservedIn", () => {
  const state = (id: string, publishState: ObservedPublication["publishState"]) => ({
    id,
    publishState,
    rawDrafts: [],
  });

  it("is true only when every observation matches the requested state", () => {
    expect(allObservedIn([state("a", "published"), state("b", "published")], "published")).toBe(true);
    expect(allObservedIn([state("a", "published"), state("b", "draft")], "published")).toBe(false);
    expect(allObservedIn([state("a", "missing")], "published")).toBe(false);
    expect(allObservedIn([state("a", "draft")], "draft")).toBe(true);
  });

  it("is false for an empty observation — nothing observed is not success", () => {
    expect(allObservedIn([], "published")).toBe(false);
  });
});

describe("request parsing", () => {
  it("accepts the three publish-ready modes with their own required fields", () => {
    expect(parsePublishReadyRequest({ mode: "ready", roles: [{ id: "r1", rev: "v1" }] })).toEqual({
      ok: true,
      value: {
        mode: "ready",
        entries: [{ id: "r1", rev: "v1", acknowledgedBlockers: [] }],
        requestedState: "published",
      },
    });
    expect(
      parsePublishReadyRequest({
        mode: "override",
        roles: [{ id: "r1", rev: "v1", acknowledgedBlockers: ["team_empty", "team_empty"] }],
      }),
    ).toEqual({
      ok: true,
      value: {
        mode: "override",
        entries: [{ id: "r1", rev: "v1", acknowledgedBlockers: ["team_empty"] }],
        requestedState: "published",
      },
    });
    expect(
      parsePublishReadyRequest({ mode: "recover", published: false, roles: [{ id: "r1" }] }),
    ).toEqual({
      ok: true,
      value: {
        mode: "recover",
        entries: [{ id: "r1", rev: "", acknowledgedBlockers: [] }],
        requestedState: "draft",
      },
    });
  });

  it("accepts a BATCHED override, each entry with its own acknowledgement", () => {
    // `Publicar todos` submits the ready drafts (acknowledging nothing) and the
    // acknowledged ones in ONE request; the handler still checks each entry
    // against its own freshly recomputed set.
    expect(
      parsePublishReadyRequest({
        mode: "override",
        roles: [
          { id: "r1", rev: "v1", acknowledgedBlockers: [] },
          { id: "r2", rev: "v2", acknowledgedBlockers: ["incomplete_setlist"] },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        mode: "override",
        entries: [
          { id: "r1", rev: "v1", acknowledgedBlockers: [] },
          { id: "r2", rev: "v2", acknowledgedBlockers: ["incomplete_setlist"] },
        ],
        requestedState: "published",
      },
    });
  });

  it("still rejects a duplicate role id inside an override batch", () => {
    expect(
      parsePublishReadyRequest({
        mode: "override",
        roles: [
          { id: "r1", rev: "v1", acknowledgedBlockers: [] },
          { id: "r1", rev: "v1", acknowledgedBlockers: ["team_empty"] },
        ],
      }).ok,
    ).toBe(false);
  });

  it("rejects an acknowledgement that is not a registered workflow blocker", () => {
    for (const codes of [["invalid_record"], ["source_unready"], ["nonsense"], [42], "team_empty"]) {
      const parsed = parsePublishReadyRequest({
        mode: "override",
        roles: [{ id: "r1", rev: "v1", acknowledgedBlockers: codes }],
      });
      expect(parsed.ok, JSON.stringify(codes)).toBe(false);
    }
  });

  it("keeps the unpublish contract narrow", () => {
    expect(parseUnpublishRequest({ roles: [{ id: "r1", rev: "v1" }] })).toEqual({
      ok: true,
      value: { mode: "unpublish", entries: [{ id: "r1", rev: "v1" }] },
    });
    expect(parseUnpublishRequest({ mode: "recover", roles: [{ id: "r1" }] })).toEqual({
      ok: true,
      value: { mode: "recover", entries: [{ id: "r1", rev: "" }] },
    });
    for (const body of [
      { roles: [{ id: "r1", rev: "v1" }], published: true },
      { roles: [{ id: "r1", rev: "v1" }], acknowledgedBlockers: [] },
      { roles: [{ id: "r1", rev: "v1", acknowledgedBlockers: [] }] },
      { mode: "ready", roles: [{ id: "r1", rev: "v1" }] },
      { roles: [{ id: "r1" }] },
      { roles: [] },
    ]) {
      expect(parseUnpublishRequest(body).ok, JSON.stringify(body)).toBe(false);
    }
  });
});
