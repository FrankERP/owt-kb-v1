// MonthGenerator batch-create contract (Service Readiness A2 §2).
//
// These are the rules the month-preview confirm step delegates to: only confirmed
// successes become `exists`, everything else stays retryable, and every attempt
// for one draft sends byte-for-byte the same `creationRequestId`.

import { describe, expect, it, vi } from "vitest";

import {
  draftCreateBody,
  newCreationRequestId,
  runDraftCreateBatch,
  type CreatableDraft,
  type DraftPostOutcome,
} from "@/app/utils/monthDraftCreate";
import { isValidCreationRequestId } from "@/app/utils/roleWriteRequest";

function draft(over: Partial<CreatableDraft> = {}): CreatableDraft {
  return {
    localId: "l1",
    creationRequestId: "req-draft-00000001",
    _type: "sunday_role",
    date: "2026-08-09",
    leads: ["mem-1"],
    bgvs: [],
    chorus: [],
    instruments: [{ instrument: "Bajo", personId: "mem-2" }],
    foh: [],
    ...over,
  };
}

describe("newCreationRequestId", () => {
  it("mints a bounded opaque id the server accepts", () => {
    const id = newCreationRequestId();
    expect(isValidCreationRequestId(id)).toBe(true);
    expect(newCreationRequestId()).not.toBe(id);
  });
});

describe("draftCreateBody", () => {
  it("sends the draft's own request id and drops blank slots", () => {
    const body = draftCreateBody(
      draft({
        instruments: [
          { instrument: "Bajo", personId: "mem-2" },
          { instrument: "", personId: "mem-3" },
        ],
        foh: [{ role: "Audio", personId: "" }],
      }),
      true,
    );
    expect(body.creationRequestId).toBe("req-draft-00000001");
    expect(body.published).toBe(true);
    expect(body.instruments).toEqual([{ instrument: "Bajo", personId: "mem-2" }]);
    expect(body.foh).toEqual([]);
    // The short UI localId is never sent as the idempotency key.
    expect(JSON.stringify(body)).not.toContain('"localId"');
  });
});

describe("runDraftCreateBatch", () => {
  const drafts = [
    draft({ localId: "l1", creationRequestId: "req-draft-00000001", date: "2026-08-02" }),
    draft({ localId: "l2", creationRequestId: "req-draft-00000002", date: "2026-08-09" }),
    draft({ localId: "l3", creationRequestId: "req-draft-00000003", date: "2026-08-16" }),
  ];

  it("marks only confirmed successes and keeps failures retryable", async () => {
    const post = vi.fn(async (body: { creationRequestId: string }) =>
      body.creationRequestId === "req-draft-00000002"
        ? ({ ok: false, status: 409, error: "ambiguous_target" } as DraftPostOutcome)
        : ({ ok: true, status: 201 } as DraftPostOutcome),
    );
    const result = await runDraftCreateBatch({ drafts, published: false, post });
    expect(result.createdLocalIds).toEqual(["l1", "l3"]);
    expect(result.failed).toEqual([{ localId: "l2", status: 409, error: "ambiguous_target" }]);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("treats a thrown request (lost response) as failed, never as created", async () => {
    const post = vi.fn(async () => {
      throw new Error("network");
    });
    const result = await runDraftCreateBatch({ drafts: [drafts[0]], published: false, post });
    expect(result.createdLocalIds).toEqual([]);
    expect(result.failed).toEqual([{ localId: "l1", status: undefined, error: undefined }]);
  });

  it("retries only the failed drafts, reusing the SAME request id byte-for-byte", async () => {
    const sent: string[] = [];
    const first = vi.fn(async (body: { creationRequestId: string }) => {
      sent.push(JSON.stringify(body));
      return body.creationRequestId === "req-draft-00000002"
        ? ({ ok: false, status: 500 } as DraftPostOutcome)
        : ({ ok: true } as DraftPostOutcome);
    });
    const firstRun = await runDraftCreateBatch({ drafts, published: true, post: first });
    expect(firstRun.failed.map((f) => f.localId)).toEqual(["l2"]);

    // The retry re-attempts exactly the failed draft, unchanged.
    const created = new Set(firstRun.createdLocalIds);
    const retryable = drafts.filter((d) => !created.has(d.localId));
    expect(retryable.map((d) => d.localId)).toEqual(["l2"]);

    const second = vi.fn(async (body: { creationRequestId: string }) => {
      sent.push(JSON.stringify(body));
      return { ok: true } as DraftPostOutcome;
    });
    const secondRun = await runDraftCreateBatch({ drafts: retryable, published: true, post: second });
    expect(secondRun.createdLocalIds).toEqual(["l2"]);

    const l2Bodies = sent.filter((b) => b.includes("req-draft-00000002"));
    expect(l2Bodies).toHaveLength(2);
    expect(l2Bodies[0]).toBe(l2Bodies[1]);
  });

  it("a lost response followed by a replay produces exactly one success for the id", async () => {
    const attempts: string[] = [];
    const d = drafts[0];
    // Attempt 1: the server committed, but the response was lost.
    const lost = vi.fn(async (body: { creationRequestId: string }) => {
      attempts.push(body.creationRequestId);
      throw new Error("socket hang up");
    });
    const run1 = await runDraftCreateBatch({ drafts: [d], published: false, post: lost });
    expect(run1.createdLocalIds).toEqual([]);

    // Attempt 2: the same id replays as idempotent success (HTTP 200).
    const replay = vi.fn(async (body: { creationRequestId: string }) => {
      attempts.push(body.creationRequestId);
      return { ok: true, status: 200 } as DraftPostOutcome;
    });
    const run2 = await runDraftCreateBatch({ drafts: [d], published: false, post: replay });
    expect(run2.createdLocalIds).toEqual(["l1"]);
    expect(attempts).toEqual(["req-draft-00000001", "req-draft-00000001"]);
  });
});
