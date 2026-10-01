// Side-effect DESCRIPTORS (MCP P3 step 2, invariant I9).
//
// Each post-commit helper in `serviceMutationSideEffects.ts` now RETURNS a
// description of what it queued or started, so a caller that must report WHO a
// write notified reads the values the helper actually used — never a second
// derivation that could drift from them. These tests hold each descriptor
// against the mocked channel it describes: what `after()` registered, what the
// outbox transaction recorded, what `sendPush` / `sendAssignmentEmailsBatch`
// were handed. Nothing is delivered, and a descriptor never claims delivery:
// "queued" or "started" is the strongest word it supports.
//
// The mock block mirrors `serviceMutationSideEffects.test.ts` on purpose. Test
// files never import each other (ruling C6), and extracting a shared fixture
// would edit that suite, whose job here is to stay green as proof that the
// helpers' behaviour did not move.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendPushMock = vi.fn();
const sendAssignmentEmailsBatchMock = vi.fn();
const operationalFetch = vi.fn();
const sweepOutboxMock = vi.fn();
const afterCallbacks: (() => unknown)[] = [];
/** The `after` stand-in. Replaced once per test to prove the ordering rule. */
const afterMock = vi.fn((fn: () => unknown) => void afterCallbacks.push(fn));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));

/** One recorded `createIfNotExists` document per outbox upsert, per commit. */
const outboxTransactions: Record<string, unknown>[][] = [];

function makeOutboxTransaction() {
  const docs: Record<string, unknown>[] = [];
  outboxTransactions.push(docs);
  const tx = {
    createIfNotExists(doc: Record<string, unknown>) {
      docs.push(doc);
      return tx;
    },
    patch(_id: string, fn: (p: unknown) => unknown) {
      const p = { set: () => p };
      fn(p);
      return tx;
    },
    async commit() {
      return {};
    },
  };
  return tx;
}

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { transaction: () => makeOutboxTransaction() },
}));
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));
vi.mock("@/app/utils/email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
  SEND_CONCURRENCY: 8,
  SEND_TIMEOUT_MS: 20_000,
}));
// PARTIAL: the batch send is spied, the seat vocabulary stays real.
vi.mock("@/app/utils/assignmentEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/assignmentEmail")>()),
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
}));
vi.mock("@/app/utils/proposalNotify", () => ({ notifyProposalSubmitted: vi.fn() }));
vi.mock("@/app/utils/outboxSweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/outboxSweep")>()),
  sweepOutbox: (...a: unknown[]) => sweepOutboxMock(...a),
}));
vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => afterMock(fn) };
});

import {
  notifyRoleAssignments,
  notifyRolePublished,
  notifySetlistSaved,
  queuePublishedSetlistNotices,
  queueRoleNotices,
  queueSetlistNotice,
  roleCreateNotice,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
import type { NormalizedSeats } from "@/app/utils/roleWriteRequest";

function seats(over: Partial<NormalizedSeats> = {}): NormalizedSeats {
  return { leads: [], bgvs: [], chorus: [], instruments: [], foh: [], ...over };
}

const ZERO_SWEEP = {
  claimed: 0, emailed: 0, consumed: 0, deferred: 0,
  unserved: 0, repended: 0, lost: 0, failed: 0, skipped: 0,
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  outboxTransactions.length = 0;
  operationalFetch.mockReset();
  afterMock.mockImplementation((fn: () => unknown) => void afterCallbacks.push(fn));
  sweepOutboxMock.mockResolvedValue(ZERO_SWEEP);
  // `attempt`/`attemptSync` log what they swallow; the swallow is under test,
  // the log line is not, so it is captured instead of printed.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Run every registered `after()` callback, draining anything they enqueue. */
async function flushAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

/** Make the NEXT `after()` registration throw, as a broken runtime would. */
function afterThrowsOnce() {
  afterMock.mockImplementationOnce(() => {
    throw new Error("after() unavailable");
  });
}

const upsertedDocs = () => outboxTransactions.flat();

// ── notifyRoleAssignments ───────────────────────────────────────────────────

describe("notifyRoleAssignments → { pushes }", () => {
  const created = roleCreateNotice({
    published: true,
    seats: seats({ leads: ["mem-1"], bgvs: ["mem-2"] }),
    type: "sunday_role",
    date: "2026-08-09",
  });
  const updated = roleUpdateNotice({
    published: true,
    beforeAssignees: [],
    after: seats({ chorus: ["mem-9"] }),
    type: "saturday_role",
    date: "2026-08-08",
  });

  it("describes exactly the pushes it scheduled, in order", async () => {
    const out = notifyRoleAssignments([
      created,
      null,
      { recipients: [], type: "sunday_role", date: "2026-08-01", body: {}, kind: "updated" },
      updated,
    ]);
    expect(out.pushes).toEqual([
      { recipients: ["mem-1", "mem-2"], date: "2026-08-09", kind: "created" },
      { recipients: ["mem-9"], date: "2026-08-08", kind: "updated" },
    ]);

    await flushAfter();
    const TITLE = { created: "Nuevo servicio asignado", updated: "Servicio actualizado" };
    expect(sendPushMock.mock.calls).toEqual(
      out.pushes.map((p) => [
        p.recipients,
        "assignments",
        { title: TITLE[p.kind], body: `Te asignaron para el ${p.date}.`, path: "/me" },
      ]),
    );
  });

  it("is empty — and registers nothing — when there is nobody to push", () => {
    expect(notifyRoleAssignments([])).toEqual({ pushes: [] });
    expect(notifyRoleAssignments([null, null])).toEqual({ pushes: [] });
    expect(
      notifyRoleAssignments([
        { recipients: [], type: "sunday_role", date: "2026-08-09", body: {}, kind: "updated" },
      ]),
    ).toEqual({ pushes: [] });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is a snapshot: editing it cannot change who the deferred push reaches", async () => {
    const out = notifyRoleAssignments([created]);
    out.pushes[0].recipients.splice(0, 1, "intruder");
    await flushAfter();
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-1", "mem-2"]);
  });
});

// ── notifyRolePublished ─────────────────────────────────────────────────────

describe("notifyRolePublished → { pushes, emailBatch } | null", () => {
  const services = [
    { recipients: ["mem-1"], type: "sunday_role" as const, date: "2026-08-09", body: { leads: ["mem-1"] } },
    // An empty service is still pushed (to nobody) today; the descriptor says so
    // rather than hiding the call the helper actually makes.
    { recipients: [], type: "special_role" as const, date: "2026-08-10", body: {} },
    { recipients: ["mem-9"], type: "saturday_role" as const, date: "2026-08-08", body: { chorus: ["mem-9"] } },
  ];

  it("pushes equal every sendPush call; emailBatch equals the batch argument", async () => {
    const out = notifyRolePublished(services);
    expect(out).not.toBeNull();
    await flushAfter();

    expect(sendPushMock.mock.calls.map((c) => c[0])).toEqual(out!.pushes.map((p) => p.recipients));
    expect(sendPushMock.mock.calls.map((c) => (c[2] as { body: string }).body)).toEqual(
      out!.pushes.map((p) => `Te asignaron para el ${p.date}.`),
    );
    expect(out!.pushes).toEqual([
      { recipients: ["mem-1"], date: "2026-08-09" },
      { recipients: [], date: "2026-08-10" },
      { recipients: ["mem-9"], date: "2026-08-08" },
    ]);

    expect(sendAssignmentEmailsBatchMock).toHaveBeenCalledTimes(1);
    expect(out!.emailBatch).toEqual(sendAssignmentEmailsBatchMock.mock.calls[0][0]);
    // The batch carries no recipient list: it derives its own at send time.
    expect(out!.emailBatch[0]).not.toHaveProperty("recipients");
  });

  it("carries a special's name and time to the email, and leaves a weekend entry's shape alone", async () => {
    const out = notifyRolePublished([
      { recipients: ["mem-1"], type: "special_role", date: "2026-10-03", body: { leads: ["mem-1"] }, serviceName: "CAMP - Set 2", serviceTime: "09:00" },
      { recipients: ["mem-9"], type: "saturday_role", date: "2026-10-03", body: { chorus: ["mem-9"] } },
    ]);
    await flushAfter();
    const sent = sendAssignmentEmailsBatchMock.mock.calls[0][0];
    expect(sent).toStrictEqual([
      { type: "special_role", date: "2026-10-03", body: { leads: ["mem-1"] }, serviceName: "CAMP - Set 2", serviceTime: "09:00" },
      { type: "saturday_role", date: "2026-10-03", body: { chorus: ["mem-9"] } },
    ]);
    expect(out!.emailBatch).toStrictEqual(sent);
  });

  it("hands the email only the keys it reads, whatever else a caller's object carries", async () => {
    const stray = { recipients: ["mem-1"], type: "sunday_role" as const, date: "2026-08-09", body: { leads: ["mem-1"] }, internal: "x" };
    const out = notifyRolePublished([stray]);
    await flushAfter();
    expect(sendAssignmentEmailsBatchMock.mock.calls[0][0]).toStrictEqual([
      { type: "sunday_role", date: "2026-08-09", body: { leads: ["mem-1"] } },
    ]);
    expect(out!.emailBatch[0]).not.toHaveProperty("internal");
  });

  it("is null — and registers nothing — for an empty batch", () => {
    expect(notifyRolePublished([])).toBeNull();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is a snapshot: editing its pushes cannot change who the deferred push reaches", async () => {
    const out = notifyRolePublished(services);
    out!.pushes[0].recipients.splice(0, 1, "intruder");
    await flushAfter();
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-1"]);
  });

  it("is a snapshot: editing an emailBatch body cannot change the deferred email", async () => {
    const full = () => ({
      leads: ["mem-lead"],
      bgvs: ["mem-bgv"],
      chorus: ["mem-chorus"],
      instruments: [{ instrument: "Bajo", personId: "mem-inst" }],
      foh: [{ role: "Sonido", personId: "mem-foh" }],
    });
    const out = notifyRolePublished([
      { recipients: ["mem-lead"], type: "sunday_role", date: "2026-08-09", body: full() },
    ]);
    const body = out!.emailBatch[0].body;
    body.leads!.splice(0, 1, "intruder");
    body.bgvs!.push("intruder");
    body.chorus!.length = 0;
    body.instruments![0].personId = "intruder";
    body.foh![0].personId = "intruder";

    await flushAfter();
    expect(sendAssignmentEmailsBatchMock.mock.calls[0][0]).toEqual([
      { type: "sunday_role", date: "2026-08-09", body: full() },
    ]);
  });
});

// ── queueRoleNotices ────────────────────────────────────────────────────────

describe("queueRoleNotices → { kind: 'role', roleId, memberIds } | null", () => {
  const base = {
    roleId: "role-1",
    roleType: "sunday_role" as const,
    serviceDate: "2026-08-09",
    published: true,
  };

  it("memberIds equal the memberIds of the upserts it queued", async () => {
    const out = queueRoleNotices({
      ...base,
      beforeSeats: seats({ leads: ["m1", "m2"] }),
      afterSeats: seats({ leads: ["m2"], foh: [{ role: "Sonido", personId: "m3" }] }),
    });
    expect(out).toEqual({ kind: "role", roleId: "role-1", memberIds: ["m1", "m2", "m3"] });

    await flushAfter();
    expect(upsertedDocs().map((d) => d.memberId)).toEqual(out!.memberIds);
    expect(upsertedDocs().every((d) => d.roleId === out!.roleId)).toBe(true);
  });

  it.each([
    ["a draft service", { published: false }],
    ["a missing date", { serviceDate: "" }],
  ])("is null — and registers nothing — for %s", (_label, over) => {
    const out = queueRoleNotices({
      ...base,
      ...over,
      beforeSeats: null,
      afterSeats: seats({ leads: ["m1"] }),
    });
    expect(out).toBeNull();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is null — and registers nothing — when neither state names anybody", () => {
    expect(queueRoleNotices({ ...base, beforeSeats: null, afterSeats: seats() })).toBeNull();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is null when registering the deferred upsert threw and was swallowed", () => {
    afterThrowsOnce();
    const out = queueRoleNotices({ ...base, beforeSeats: null, afterSeats: seats({ leads: ["m1"] }) });
    expect(out).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

// ── queueSetlistNotice ──────────────────────────────────────────────────────

describe("queueSetlistNotice → { kind: 'setlist', roleId, knownRecipients } | null", () => {
  const input = {
    roleId: "role-1",
    roleType: "sunday_role" as const,
    serviceDate: "2026-08-09",
    published: true,
    beforeSongs: [],
    hasSongs: true,
    knownRecipients: ["m1", "m2"],
  };

  it("knownRecipients equal the queued notice's knownRecipients", async () => {
    const out = queueSetlistNotice(input);
    expect(out).toEqual({ kind: "setlist", roleId: "role-1", knownRecipients: ["m1", "m2"] });

    await flushAfter();
    expect(upsertedDocs()).toHaveLength(1);
    expect(upsertedDocs()[0].roleId).toBe(out!.roleId);
    expect(upsertedDocs()[0].knownRecipients).toEqual(out!.knownRecipients);
  });

  it.each([
    ["a draft service", { published: false }],
    ["a missing role", { roleId: "" }],
    ["a missing date", { serviceDate: "" }],
    ["no songs", { hasSongs: false }],
  ])("is null — and registers nothing — for %s", (_label, over) => {
    expect(queueSetlistNotice({ ...input, ...over })).toBeNull();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is null when registering the deferred upsert threw and was swallowed", () => {
    afterThrowsOnce();
    expect(queueSetlistNotice(input)).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("is a snapshot: editing it cannot change the notice that gets committed", async () => {
    const out = queueSetlistNotice(input);
    out!.knownRecipients.push("intruder");
    await flushAfter();
    expect(upsertedDocs()[0].knownRecipients).toEqual(["m1", "m2"]);
  });
});

// ── queuePublishedSetlistNotices ────────────────────────────────────────────

describe("queuePublishedSetlistNotices → { kind: 'publishedSetlist', subjects } | null", () => {
  const withSongs = {
    roleId: "role-a",
    roleType: "special_role" as const,
    serviceDate: "2026-08-09",
    role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
    knownRecipients: ["m1"],
  };
  const withoutSongs = {
    roleId: "role-b",
    roleType: "special_role" as const,
    serviceDate: "2026-08-10",
    role: { songs: [] },
    knownRecipients: ["m2", "m3"],
  };

  it("lists every subject it handed to the deferred block, songs resolved later", async () => {
    const out = queuePublishedSetlistNotices([withSongs, withoutSongs]);
    expect(out).toEqual({
      kind: "publishedSetlist",
      subjects: [
        { roleId: "role-a", knownRecipients: ["m1"] },
        { roleId: "role-b", knownRecipients: ["m2", "m3"] },
      ],
    });

    // Song presence is decided inside `after()`: only the subject with songs is
    // minted. That is why the report must say "if the service has songs".
    await flushAfter();
    expect(upsertedDocs().map((d) => [d.roleId, d.knownRecipients])).toEqual([["role-a", ["m1"]]]);
    const described = new Map(out!.subjects.map((s) => [s.roleId, s.knownRecipients]));
    for (const doc of upsertedDocs()) {
      expect(doc.knownRecipients).toEqual(described.get(String(doc.roleId)));
    }
  });

  it("is null — and registers nothing — for an empty batch", () => {
    expect(queuePublishedSetlistNotices([])).toBeNull();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("is null when registering the deferred block threw and was swallowed", () => {
    afterThrowsOnce();
    expect(queuePublishedSetlistNotices([withSongs])).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("is a snapshot: editing it cannot change the notice that gets committed", async () => {
    const out = queuePublishedSetlistNotices([withSongs]);
    out!.subjects[0].knownRecipients.push("intruder");
    await flushAfter();
    expect(upsertedDocs()[0].knownRecipients).toEqual(["m1"]);
  });
});

// ── notifySetlistSaved ──────────────────────────────────────────────────────

describe("notifySetlistSaved → Promise<{ recipients } | null>", () => {
  it("recipients equal sendPush's first argument", async () => {
    operationalFetch
      .mockResolvedValueOnce([
        { _id: "mem-all" },
        { _id: "mem-assigned", setlist: "assigned" },
        { _id: "mem-elsewhere", setlist: "assigned" },
        { _id: "mem-off", setlist: "off" },
      ])
      .mockResolvedValueOnce(["mem-assigned", "mem-late"])
      .mockResolvedValueOnce([{ _id: "mem-late", setlist: "assigned" }]);
    sendPushMock.mockResolvedValue({ sent: 0, pruned: 0 });

    const out = await notifySetlistSaved("2026-08-09");
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ recipients: sendPushMock.mock.calls[0][0] });
    expect(out!.recipients).toEqual(["mem-all", "mem-assigned", "mem-late"]);
  });

  it("reports the push it STARTED even when that push later fails — never delivery", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-all" }]).mockResolvedValueOnce([]);
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    const out = await notifySetlistSaved("2026-08-09");
    expect(out).toEqual({ recipients: ["mem-all"] });
    // Give the detached rejection handler a turn to run.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("an audience that resolves to nobody is still the (empty) list sendPush got", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-off", setlist: "off" }]).mockResolvedValueOnce([]);
    const out = await notifySetlistSaved("2026-08-09");
    expect(sendPushMock).toHaveBeenCalledWith([], "setlist", expect.anything());
    expect(out).toEqual({ recipients: [] });
  });

  it("is a snapshot: editing it cannot change the list sendPush was handed", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-all" }]).mockResolvedValueOnce([]);
    const out = await notifySetlistSaved("2026-08-09");
    out!.recipients.push("intruder");
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-all"]);
  });

  it("is null when the audience read failed and was swallowed", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("network"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeNull();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("is null when the assigned-member read failed and was swallowed", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-all" }]).mockRejectedValueOnce(new Error("network"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeNull();
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});
