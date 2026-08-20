// The lost-update race on `unavailableDates`, and the revision guard that stops it.
//
// `/kids/admin`'s availability override made this field a field with TWO
// wholesale writers: the Kids manager's panel and the member's own `/me`
// calendar. The panel holds the member's ENTIRE array from a page-load snapshot,
// so an unconditional `.set()` deletes anything the member marked after that
// snapshot — silently, behind a success toast, leaving the worship solver free
// to seat them on a Sunday they refused.
//
// So this file does NOT assert "`ifRevisionId` was called". It runs the
// interleaving against a fake Content Lake that ENFORCES revisions the way the
// real one does — a stale precondition throws a 409-shaped mutation error and
// the stored document is left untouched — and then asserts the thing that
// actually matters: the member's own absence is still there afterwards.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireMinistryManager: vi.fn(),
  /** Every `.set()` payload that actually reached storage. */
  commits: [] as { id: string; set: Record<string, unknown> }[],
  /** Fires inside `commit()` BEFORE the revision check — the race window. */
  beforeCommit: null as null | (() => void),
  /** Thrown by `commit()` instead of a conflict, for the "not a race" arm. */
  commitError: null as null | unknown,
  revalidateKidsViews: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryManager: (m: string) => h.requireMinistryManager(m),
}));

vi.mock("@/app/utils/revalidate", () => ({
  revalidateKidsViews: () => h.revalidateKidsViews(),
}));

/** Runs the route's real GROQ against the CURRENT dataset. */
async function groq(query: string, params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset, params });
  return (await value.get()) as unknown;
}

/** A Content Lake 409 for a failed `ifRevisionId`, in the shape the client throws. */
function revisionMismatch() {
  return Object.assign(new Error("Mutation failed"), {
    statusCode: 409,
    details: {
      type: "mutationError",
      items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }],
    },
  });
}

let revCounter = 0;
let dataset: Record<string, unknown>[] = [];

const docById = (id: string) => dataset.find((d) => d._id === id);

/** The other writer: the member's own `/me` calendar, which bumps the revision. */
function memberWritesFromMe(id: string, unavailableDates: string[]) {
  const doc = docById(id)!;
  doc.unavailableDates = unavailableDates;
  doc._rev = `rev-${++revCounter}`;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (q: string, p?: Record<string, unknown>) => groq(q, p) },
  writeClient: {
    patch: (id: string) => {
      let expectedRev: string | null = null;
      const payload: Record<string, unknown> = {};
      const chain = {
        ifRevisionId(rev: string) {
          expectedRev = rev;
          return chain;
        },
        set(v: Record<string, unknown>) {
          Object.assign(payload, v);
          return chain;
        },
        async commit() {
          h.beforeCommit?.();
          if (h.commitError) throw h.commitError;
          const doc = docById(id)!;
          // The whole point: a stale precondition writes NOTHING.
          if (expectedRev !== null && doc._rev !== expectedRev) throw revisionMismatch();
          Object.assign(doc, payload);
          doc._rev = `rev-${++revCounter}`;
          h.commits.push({ id, set: { ...payload } });
          return { ...doc };
        },
      };
      return chain;
    },
  },
}));

import { GET as membersGET } from "@/app/api/kids/members/route";
import { PATCH as availabilityPATCH } from "@/app/api/kids/members/[id]/availability/route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface Snapshot {
  _id: string;
  _rev: string;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

/** What `/kids/admin` reads at page load and then holds, possibly for hours. */
async function managerSnapshot(id: string): Promise<Snapshot> {
  const body = (await (await membersGET()).json()) as Snapshot[];
  return body.find((m) => m._id === id)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.commits.length = 0;
  h.beforeCommit = null;
  h.commitError = null;
  h.requireMinistryManager.mockResolvedValue({ user: { sanityId: "kids-boss", role: "member" } });
  revCounter = 1;
  dataset = [
    {
      _id: "dual",
      _rev: "rev-1",
      _type: "teamMembers",
      member_name: "Ambos Ministerios",
      ministries: ["worship", "kids"],
      unavailableDates: [],
      unavailabilityNotes: [],
    },
  ];
});

describe("GET /api/kids/members", () => {
  it("projects `_rev` — without it the panel cannot save at all", async () => {
    expect((await managerSnapshot("dual"))._rev).toBe("rev-1");
  });
});

describe("PATCH /api/kids/members/[id]/availability — the lost update", () => {
  it("refuses a save built on a stale snapshot, and keeps the member's own absence", async () => {
    // 09:30 — the manager opens `/kids/admin`. Nothing is marked yet.
    const snapshot = await managerSnapshot("dual");
    expect(snapshot.unavailableDates).toEqual([]);

    // 10:00 — the member marks a Sunday unavailable from their own `/me`.
    memberWritesFromMe("dual", ["2026-09-20"]);

    // 10:05 — the manager toggles an unrelated October date and saves. The body
    // carries the 09:30 array, which does not know about 2026-09-20.
    const res = await availabilityPATCH(
      req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"], unavailabilityNotes: [] }),
      params("dual"),
    );

    expect(res.status).toBe(409);
    expect(h.commits).toHaveLength(0);
    expect(h.revalidateKidsViews).not.toHaveBeenCalled();
    // The assertion that matters: the member is still unavailable on the 20th.
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);

    // And the reply carries the state the manager must redo their edit against.
    const body = (await res.json()) as Snapshot & { error: string };
    expect(body.error).toBe("stale_revision");
    expect(body.unavailableDates).toEqual(["2026-09-20"]);
    expect(body._rev).toBe(docById("dual")!._rev);
  });

  it("lets the manager redo the edit against the refreshed state, keeping both dates", async () => {
    const snapshot = await managerSnapshot("dual");
    memberWritesFromMe("dual", ["2026-09-20"]);
    const conflict = (await (
      await availabilityPATCH(
        req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
        params("dual"),
      )
    ).json()) as Snapshot;

    const redo = await availabilityPATCH(
      req({ _rev: conflict._rev, unavailableDates: ["2026-09-20", "2026-10-04"] }),
      params("dual"),
    );

    expect(redo.status).toBe(200);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20", "2026-10-04"]);
    expect(h.revalidateKidsViews).toHaveBeenCalled();
  });

  it("loses the race that opens AFTER the pre-check, at commit time", async () => {
    // The pre-check passes — the manager's revision is current when the route
    // reads it — and the member writes in the window before the commit. Only
    // `ifRevisionId` can catch this one.
    const snapshot = await managerSnapshot("dual");
    h.beforeCommit = () => memberWritesFromMe("dual", ["2026-09-20"]);

    const res = await availabilityPATCH(
      req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
      params("dual"),
    );

    expect(res.status).toBe(409);
    expect(h.commits).toHaveLength(0);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);
    // The re-read after the failed commit reports the state that actually won.
    expect(((await res.json()) as Snapshot).unavailableDates).toEqual(["2026-09-20"]);
  });

  it("returns the NEW `_rev`, so a second save in the same session is not a false conflict", async () => {
    const snapshot = await managerSnapshot("dual");
    const first = (await (
      await availabilityPATCH(
        req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
        params("dual"),
      )
    ).json()) as Snapshot;
    expect(first._rev).not.toBe(snapshot._rev);

    const second = await availabilityPATCH(
      req({ _rev: first._rev, unavailableDates: ["2026-10-04", "2026-10-11"] }),
      params("dual"),
    );
    expect(second.status).toBe(200);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-10-04", "2026-10-11"]);
  });

  it("rejects a body with NO `_rev` instead of falling back to an unconditional write", async () => {
    // A fallback would preserve the bug for every caller that omits the field —
    // including a client bundle still cached from before this guard shipped.
    memberWritesFromMe("dual", ["2026-09-20"]);
    for (const body of [
      { unavailableDates: ["2026-10-04"] },
      { _rev: "", unavailableDates: ["2026-10-04"] },
      { _rev: 7, unavailableDates: ["2026-10-04"] },
    ]) {
      const res = await availabilityPATCH(req(body), params("dual"));
      expect(res.status).toBe(400);
    }
    expect(h.commits).toHaveLength(0);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);
  });

  it("does NOT report a token or network failure as a lost race", async () => {
    // Answering "someone else changed it" would send the manager to reload, get
    // the same revision back, retry, and fail identically — forever.
    const snapshot = await managerSnapshot("dual");
    h.commitError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(
      availabilityPATCH(
        req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
        params("dual"),
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("still 404s a worship member before any revision talk", async () => {
    dataset.push({
      _id: "w1",
      _rev: "rev-1",
      _type: "teamMembers",
      member_name: "Solo Alabanza",
      ministries: ["worship"],
    });
    const res = await availabilityPATCH(
      req({ _rev: "rev-1", unavailableDates: ["2026-10-04"] }),
      params("w1"),
    );
    expect(res.status).toBe(404);
    expect(h.commits).toHaveLength(0);
  });
});
