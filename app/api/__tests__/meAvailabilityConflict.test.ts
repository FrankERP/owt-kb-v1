// The lost-update race on `unavailableDates`, from the MEMBER's side.
//
// `kidsAvailabilityConflict.test.ts` covers the manager's direction. This file
// covers the mirror one, which the same field has by construction: `/me`'s
// calendar and `/kids/admin`'s override are TWO wholesale writers of the same
// two arrays. `/me` is the page members leave open for hours, so its snapshot is
// the older of the two far more often — an unconditional `.set()` there deletes
// whatever the Kids manager recorded in the meantime, silently, behind a
// "Guardado ✓", leaving the worship solver free to seat the member on a Sunday
// they refused.
//
// So this file does NOT assert "`ifRevisionId` was called". It runs the
// interleaving against a fake Content Lake that ENFORCES revisions the way the
// real one does — a stale precondition throws a 409-shaped mutation error and
// the stored document is left untouched — and then asserts the thing that
// actually matters: the manager's entry is still there afterwards.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  /** Every `.set()` payload that actually reached storage. */
  commits: [] as { id: string; set: Record<string, unknown> }[],
  /** Fires inside `commit()` BEFORE the revision check — the race window. */
  beforeCommit: null as null | (() => void),
  /** Thrown by `commit()` instead of a conflict, for the "not a race" arm. */
  commitError: null as null | unknown,
}));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveSession: () => h.requireActiveSession(),
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

/** The other writer: the Kids manager's override, which bumps the revision. */
function managerWritesFromKidsAdmin(id: string, unavailableDates: string[]) {
  const doc = docById(id)!;
  doc.unavailableDates = unavailableDates;
  doc._rev = `rev-${++revCounter}`;
}

/** A sibling write to the SAME document that leaves availability untouched —
 *  `ProfilePanel` saving an alias, a photo, a password or a notification pref. */
function siblingWrite(id: string) {
  const doc = docById(id)!;
  doc.alias = "Nuevo Alias";
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

import { GET as availabilityGET, PATCH as availabilityPATCH } from "@/app/api/me/availability/route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

interface Snapshot {
  _rev: string;
  unavailableDates: string[];
  unavailabilityNotes: { date: string; note: string }[];
}

/** What the member's own page holds while the tab sits open. */
async function memberSnapshot(): Promise<Snapshot> {
  return (await (await availabilityGET()).json()) as Snapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.commits.length = 0;
  h.beforeCommit = null;
  h.commitError = null;
  // A `dual` member: they sign in and mark their own dates AND a Kids manager
  // records absences for them. That is the population this race lives in.
  h.requireActiveSession.mockResolvedValue({ user: { sanityId: "dual", role: "member" } });
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

describe("GET /api/me/availability", () => {
  it("projects `_rev` — without it the calendar cannot save at all", async () => {
    expect((await memberSnapshot())._rev).toBe("rev-1");
  });

  it("is still 401 without a session", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    expect((await availabilityGET()).status).toBe(401);
  });
});

describe("/me renders the calendar with the revision it read", () => {
  // There is no callable seam for a server component's props, and the failure it
  // guards is total: a page that does not thread `_rev` turns EVERY member's
  // save into a 400.
  const page = readFileSync(
    new URL("../../(client)/me/page.tsx", import.meta.url),
    "utf8",
  );

  it("projects `_rev` on the member read", () => {
    expect(page).toMatch(/_id, _rev, member_name/);
  });

  it("passes it to AvailabilityCalendar", () => {
    expect(page).toMatch(/initialRev=\{member\._rev\}/);
  });
});

describe("PATCH /api/me/availability — the lost update", () => {
  it("refuses a save built on a stale snapshot, and keeps the manager's entry", async () => {
    // 09:30 — the member opens `/me` and leaves the tab open. Nothing is marked.
    const snapshot = await memberSnapshot();
    expect(snapshot.unavailableDates).toEqual([]);

    // 10:00 — the Kids manager records "out on 2026-09-20" through the guarded
    // override route. It commits cleanly.
    managerWritesFromKidsAdmin("dual", ["2026-09-20"]);

    // 10:05 — the member toggles an October date on the stale tab and saves. The
    // body carries the 09:30 array, which does not know about 2026-09-20.
    const res = await availabilityPATCH(
      req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"], unavailabilityNotes: [] }),
    );

    expect(res.status).toBe(409);
    expect(h.commits).toHaveLength(0);
    // The assertion that matters: the member is still unavailable on the 20th.
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);

    // And the reply carries the state the member must redo their edit against.
    const body = (await res.json()) as Snapshot & { error: string };
    expect(body.error).toBe("stale_revision");
    expect(body.unavailableDates).toEqual(["2026-09-20"]);
    expect(body._rev).toBe(docById("dual")!._rev);
  });

  it("lets the member redo the edit against the refreshed state, keeping both dates", async () => {
    const snapshot = await memberSnapshot();
    managerWritesFromKidsAdmin("dual", ["2026-09-20"]);
    const conflict = (await (
      await availabilityPATCH(req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }))
    ).json()) as Snapshot;

    const redo = await availabilityPATCH(
      req({ _rev: conflict._rev, unavailableDates: ["2026-09-20", "2026-10-04"] }),
    );

    expect(redo.status).toBe(200);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20", "2026-10-04"]);
  });

  it("loses the race that opens AFTER the pre-check, at commit time", async () => {
    // The pre-check passes — the member's revision is current when the route
    // reads it — and the manager writes in the window before the commit. Only
    // `ifRevisionId` can catch this one.
    const snapshot = await memberSnapshot();
    h.beforeCommit = () => managerWritesFromKidsAdmin("dual", ["2026-09-20"]);

    const res = await availabilityPATCH(
      req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
    );

    expect(res.status).toBe(409);
    expect(h.commits).toHaveLength(0);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);
    // The re-read after the failed commit reports the state that actually won.
    expect(((await res.json()) as Snapshot).unavailableDates).toEqual(["2026-09-20"]);
  });

  it("returns the NEW `_rev`, so a second save in the same session is not a false conflict", async () => {
    const snapshot = await memberSnapshot();
    const first = (await (
      await availabilityPATCH(req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }))
    ).json()) as Snapshot;
    expect(first._rev).not.toBe(snapshot._rev);

    const second = await availabilityPATCH(
      req({ _rev: first._rev, unavailableDates: ["2026-10-04", "2026-10-11"] }),
    );
    expect(second.status).toBe(200);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-10-04", "2026-10-11"]);
  });

  it("rejects a body with NO `_rev` instead of falling back to an unconditional write", async () => {
    // A fallback would preserve the bug for every caller that omits the field —
    // including a client bundle still cached from before this guard shipped,
    // which is the exact audience the guard exists for.
    managerWritesFromKidsAdmin("dual", ["2026-09-20"]);
    for (const body of [
      { unavailableDates: ["2026-10-04"] },
      { _rev: "", unavailableDates: ["2026-10-04"] },
      { _rev: 7, unavailableDates: ["2026-10-04"] },
    ]) {
      const res = await availabilityPATCH(req(body));
      expect(res.status).toBe(400);
    }
    expect(h.commits).toHaveLength(0);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-09-20"]);
  });

  it("does NOT report a token or network failure as a lost race", async () => {
    // Answering "someone else changed it" would send the member to reload, get
    // the same revision back, retry, and fail identically — forever.
    const snapshot = await memberSnapshot();
    h.commitError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    await expect(
      availabilityPATCH(req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] })),
    ).rejects.toThrow("Unauthorized");
  });

  it("still 401s without a session, before any revision talk", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    const res = await availabilityPATCH(req({ _rev: "rev-1", unavailableDates: ["2026-10-04"] }));
    expect(res.status).toBe(401);
    expect(h.commits).toHaveLength(0);
  });

  it("keeps the untouched validation: bad dates dropped, notes keyed by date", async () => {
    const snapshot = await memberSnapshot();
    const res = await availabilityPATCH(
      req({
        _rev: snapshot._rev,
        unavailableDates: ["2026-10-04", "octubre 4"],
        unavailabilityNotes: [
          { date: "2026-10-04", note: "  Viaje  " },
          { date: "2026-10-04", note: "duplicado" },
          { date: "2026-10-11", note: "fecha no marcada" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(docById("dual")!.unavailableDates).toEqual(["2026-10-04"]);
    expect(docById("dual")!.unavailabilityNotes).toEqual([
      { _key: "2026-10-04", date: "2026-10-04", note: "Viaje" },
    ]);
  });

  it("reports a sibling write to the same document as a conflict too", async () => {
    // `ProfilePanel` writes alias/email/photo/password/prefs on the SAME `/me`
    // page and bumps the revision without touching availability. The route
    // cannot tell the two apart — Sanity's precondition is per DOCUMENT — so it
    // conflicts, and the 409 body reports availability UNCHANGED. That is the
    // signal the calendar uses to rebase instead of throwing the edits away.
    const snapshot = await memberSnapshot();
    siblingWrite("dual");

    const res = await availabilityPATCH(
      req({ _rev: snapshot._rev, unavailableDates: ["2026-10-04"] }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as Snapshot;
    expect(body.unavailableDates).toEqual([]);
    expect(body._rev).toBe(docById("dual")!._rev);
  });
});
