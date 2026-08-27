// Post-commit side effects for the protected service writers (A2 §7).
//
// Every delivery channel is mocked: recipients are asserted, nothing is sent.
// The two questions this file answers are "WHO hears about a committed change?"
// (derived from committed server state, never a client list) and "does a failed
// delivery stay swallowed?" (best-effort at-most-once, never a rollback).
//
// Since the notification-outbox design (spec §2/§7) a third question joins them:
// "WHAT is queued for the debounced email?" — one notice per member in the UNION
// of before- and after-assignees, each carrying that member's own seat labels.
// The `writeClient` transaction is recorded rather than executed, so the outbox
// upsert is asserted as a value.

import { beforeEach, describe, expect, it, vi } from "vitest";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the module loads under vitest's node environment.
vi.mock("server-only", () => ({}));

const sendPushMock = vi.fn();
const sendAssignmentEmailsMock = vi.fn();
const sendAssignmentEmailsBatchMock = vi.fn();
const notifyProposalSubmittedMock = vi.fn();
const revalidateServiceViewsMock = vi.fn();
const revalidatePathMock = vi.fn();
const operationalFetch = vi.fn();
const sweepOutboxMock = vi.fn();
const afterCallbacks: (() => unknown)[] = [];

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));

/* ── Outbox transaction recorder ────────────────────────────────────────────
 *
 * The upsert must be its OWN transaction on `writeClient` — never the business
 * transaction — so it is recorded per commit and asserted as a value.
 */

interface RecordedUpsert {
  createIfNotExists: Record<string, unknown>;
  patchSet: Record<string, unknown>;
}

const outboxTransactions: RecordedUpsert[][] = [];
/** Set to make the next `commit()` reject, proving the failure stays swallowed. */
let outboxCommitError: Error | null = null;
/**
 * Ordered record of the two things a queueing `after()` block does — the outbox
 * commit and layer 2's opportunistic sweep (§3) — so their ORDER is assertable
 * rather than assumed.
 */
const eventLog: string[] = [];

function makeOutboxTransaction() {
  const ops: RecordedUpsert[] = [];
  outboxTransactions.push(ops);
  const byId = new Map<string, RecordedUpsert>();
  const tx = {
    createIfNotExists(doc: Record<string, unknown>) {
      const row: RecordedUpsert = { createIfNotExists: doc, patchSet: {} };
      byId.set(String(doc._id), row);
      ops.push(row);
      return tx;
    },
    patch(id: string, fn: (p: unknown) => unknown) {
      const row = byId.get(id);
      const p = {
        set(values: Record<string, unknown>) {
          if (row) Object.assign(row.patchSet, values);
          return p;
        },
      };
      fn(p);
      return tx;
    },
    async commit() {
      eventLog.push("upsert commit");
      if (outboxCommitError) throw outboxCommitError;
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
// assignmentEmail.ts also imports ./email, which imports the "server-only"
// package guard — unresolvable outside a Next.js server build.
vi.mock("@/app/utils/email", () => ({ sendEmail: vi.fn(), SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000 }));
// PARTIAL on purpose: the two send paths are spied, but `rolesForMember` is the
// REAL seat-label vocabulary. Stubbing it would let the "each member's OWN seat
// labels" assertion pass against a label set the emails never use.
vi.mock("@/app/utils/assignmentEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/assignmentEmail")>()),
  sendAssignmentEmails: (...a: unknown[]) => sendAssignmentEmailsMock(...a),
  sendAssignmentEmailsBatch: (...a: unknown[]) => sendAssignmentEmailsBatchMock(...a),
}));
vi.mock("@/app/utils/proposalNotify", () => ({
  notifyProposalSubmitted: (...a: unknown[]) => notifyProposalSubmittedMock(...a),
}));
// PARTIAL on purpose (spec §3, layer 2): the sweep itself is spied so nothing is
// sent, but `EMAIL_LIMIT`/`SEND_BUDGET_MS` stay the REAL exported defaults — the
// derating assertion below divides those rather than restating two numbers.
vi.mock("@/app/utils/outboxSweep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/utils/outboxSweep")>()),
  sweepOutbox: (...a: unknown[]) => sweepOutboxMock(...a),
}));
vi.mock("@/app/utils/revalidate", () => ({
  revalidateServiceViews: (...a: unknown[]) => revalidateServiceViewsMock(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));
vi.mock("next/server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

import {
  notifyProposalPending,
  notifyProposalReview,
  notifyRoleAssignments,
  notifyRolePublished,
  notifySetlistSaved,
  proposalReviewRecipients,
  queueLeadNotesNotice,
  queuePublishedSetlistNotices,
  queueRoleNotices,
  queueSetlistNotice,
  revalidateProposalApproval,
  revalidateRoleMutation,
  revalidateRolePublication,
  revalidateSetlistSave,
  roleCreateNotice,
  roleUpdateNotice,
} from "@/app/utils/serviceMutationSideEffects";
import { outboxId } from "@/app/utils/outboxNotice";
import { EMAIL_LIMIT, SEND_BUDGET_MS } from "@/app/utils/outboxSweep";
import type { NormalizedSeats } from "@/app/utils/roleWriteRequest";

function seats(over: Partial<NormalizedSeats> = {}): NormalizedSeats {
  return {
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
}

/** One member in each of the five seat paths. */
const ALL_FIVE = seats({
  leads: ["mem-lead"],
  bgvs: ["mem-bgv"],
  chorus: ["mem-chorus"],
  instruments: [{ instrument: "Bajo", personId: "mem-inst" }],
  foh: [{ role: "Sonido", personId: "mem-foh" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  outboxTransactions.length = 0;
  outboxCommitError = null;
  eventLog.length = 0;
  operationalFetch.mockReset();
  sweepOutboxMock.mockImplementation(async () => {
    eventLog.push("sweep");
    return { claimed: 0, emailed: 0, consumed: 0, deferred: 0, unserved: 0, repended: 0, lost: 0 };
  });
});

/** Run every registered `after()` callback, draining anything they enqueue. */
async function flushAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

// ── Who hears about a role change ───────────────────────────────────────────

describe("roleCreateNotice", () => {
  it("a published create names every initial assignee across all five seat paths", () => {
    const notice = roleCreateNotice({
      published: true,
      seats: ALL_FIVE,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual([
      "mem-lead",
      "mem-bgv",
      "mem-chorus",
      "mem-inst",
      "mem-foh",
    ]);
    expect(notice?.kind).toBe("created");
    expect(notice?.body).toEqual({
      leads: ["mem-lead"],
      bgvs: ["mem-bgv"],
      chorus: ["mem-chorus"],
      instruments: [{ instrument: "Bajo", personId: "mem-inst" }],
      foh: [{ role: "Sonido", personId: "mem-foh" }],
    });
  });

  it("a draft create is silent", () => {
    expect(
      roleCreateNotice({ published: false, seats: ALL_FIVE, type: "sunday_role", date: "2026-08-09" }),
    ).toBeNull();
  });

  it("a published create with no assignees is silent", () => {
    expect(
      roleCreateNotice({ published: true, seats: seats(), type: "special_role", date: "2026-08-09" }),
    ).toBeNull();
  });
});

describe("roleUpdateNotice", () => {
  const before = ["mem-1"];
  const afterSeats = seats({ leads: ["mem-1", "mem-2"], bgvs: ["mem-3"] });

  it("names ONLY the newly added assignees of the destination role", () => {
    const notice = roleUpdateNotice({
      published: true,
      beforeAssignees: before,
      after: afterSeats,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual(["mem-2", "mem-3"]);
    expect(notice?.kind).toBe("updated");
  });

  it("treats a missing published field as grandfathered published", () => {
    const notice = roleUpdateNotice({
      published: undefined,
      beforeAssignees: before,
      after: afterSeats,
      type: "sunday_role",
      date: "2026-08-09",
    });
    expect(notice?.recipients).toEqual(["mem-2", "mem-3"]);
  });

  it("a draft edit is silent", () => {
    expect(
      roleUpdateNotice({
        published: false,
        beforeAssignees: before,
        after: afterSeats,
        type: "sunday_role",
        date: "2026-08-09",
      }),
    ).toBeNull();
  });

  it("no newly added assignee is silent (a removal or a no-op)", () => {
    expect(
      roleUpdateNotice({
        published: true,
        beforeAssignees: ["mem-1", "mem-2", "mem-3"],
        after: seats({ leads: ["mem-1"] }),
        type: "sunday_role",
        date: "2026-08-09",
      }),
    ).toBeNull();
  });
});

// ── Fan-out ─────────────────────────────────────────────────────────────────

describe("notifyRoleAssignments", () => {
  const noticeA = roleCreateNotice({
    published: true,
    seats: seats({ leads: ["mem-1"] }),
    type: "sunday_role",
    date: "2026-08-09",
  });
  const noticeB = roleUpdateNotice({
    published: true,
    beforeAssignees: [],
    after: seats({ chorus: ["mem-9"] }),
    type: "saturday_role",
    date: "2026-08-08",
  });

  it("registers ONE deferred attempt for the whole batch, pushing per role", async () => {
    notifyRoleAssignments([noticeA, noticeB]);
    expect(afterCallbacks).toHaveLength(1);
    expect(sendPushMock).not.toHaveBeenCalled();

    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[0]).toEqual([
      ["mem-1"],
      "assignments",
      { title: "Nuevo servicio asignado", body: "Te asignaron para el 2026-08-09.", path: "/me" },
    ]);
    expect(sendPushMock.mock.calls[1]).toEqual([
      ["mem-9"],
      "assignments",
      { title: "Servicio actualizado", body: "Te asignaron para el 2026-08-08.", path: "/me" },
    ]);
  });

  it("no longer sends an immediate assignment email — the outbox absorbed it (§7)", async () => {
    notifyRoleAssignments([noticeA, noticeB]);
    await flushAfter();
    // Keeping it would produce "te asignaron" now and "tu rol cambió" fifteen
    // minutes later for one edit.
    expect(sendAssignmentEmailsMock).not.toHaveBeenCalled();
    // The push leg is unchanged: members still get an immediate in-app signal.
    expect(sendPushMock).toHaveBeenCalledTimes(2);
  });

  it("stays entirely silent for no notices, nulls, or empty recipients", () => {
    notifyRoleAssignments([]);
    notifyRoleAssignments([null, null]);
    notifyRoleAssignments([
      { recipients: [], type: "sunday_role", date: "2026-08-09", body: {}, kind: "updated" },
    ]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("swallows a failing delivery and still attempts the rest", async () => {
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    notifyRoleAssignments([noticeA, noticeB]);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    // The failed push did not abort the batch.
    expect(sendPushMock).toHaveBeenCalledTimes(2);
  });
});

// ── Outbox queueing (spec §2) ───────────────────────────────────────────────

describe("queueRoleNotices", () => {
  const ROLE_ID = "role-1";
  const base = {
    roleId: ROLE_ID,
    roleType: "sunday_role" as const,
    serviceDate: "2026-08-09",
    published: true,
  };

  const leadsOf = (...ids: string[]) => seats({ leads: ids });
  const bgvsOf = (...ids: string[]) => seats({ bgvs: ids });

  const upserted = () => outboxTransactions.flat();
  const upsertedIds = () => upserted().map((u) => String(u.createIfNotExists._id));
  const upsertFor = (memberId: string) => {
    const id = outboxId("role", `${memberId}__${ROLE_ID}`);
    return upserted().find((u) => u.createIfNotExists._id === id)!;
  };

  it("queues one notice per member in the UNION of before and after", async () => {
    // Removals must be covered, which `addedAssignees` never was: it diffed
    // member ids, so being dropped from a service said nothing at all.
    queueRoleNotices({
      ...base,
      beforeSeats: leadsOf("m1", "m2"),
      afterSeats: leadsOf("m2", "m3"),
    });
    await flushAfter();
    expect(upsertedIds()).toHaveLength(3);
    expect(upsertedIds().sort()).toEqual(
      ["m1", "m2", "m3"].map((m) => outboxId("role", `${m}__${ROLE_ID}`)).sort(),
    );
    // …and the dropped member is genuinely one of them.
    expect(upsertFor("m1")).toBeTruthy();
  });

  it("snapshots each member's OWN seat labels, taken from the BEFORE state", async () => {
    queueRoleNotices({ ...base, beforeSeats: leadsOf("m1"), afterSeats: bgvsOf("m1") });
    await flushAfter();
    expect(upsertFor("m1").createIfNotExists.before).toEqual({ beforeRoles: ["Líder"] });
    // That is what lets a member who was never introduced to a service stay
    // silent when it is deleted: an absent member's own labels are empty.
    expect(upsertFor("m1").createIfNotExists.knownRecipients).toEqual(["m1"]);
  });

  it("records the identity a deleted role can no longer answer for", async () => {
    queueRoleNotices({ ...base, beforeSeats: leadsOf("m1"), afterSeats: leadsOf("m1") });
    await flushAfter();
    const doc = upsertFor("m1").createIfNotExists;
    expect(doc).toMatchObject({
      _type: "notificationOutbox",
      kind: "role",
      subjectKey: `m1__${ROLE_ID}`,
      memberId: "m1",
      roleId: ROLE_ID,
      proposalId: null,
      serviceDate: "2026-08-09",
      roleType: "sunday_role",
      status: "pending",
      claimedAt: null,
    });
    // The patch only slides the debounce and re-pends; `before` and `deadline`
    // survive a whole burst of edits.
    expect(Object.keys(upsertFor("m1").patchSet).sort()).toEqual(["notifyAfter", "servedRecipients", "status"]);
  });

  it("queues nothing for a draft service", async () => {
    queueRoleNotices({ ...base, published: false, beforeSeats: null, afterSeats: leadsOf("m1") });
    await flushAfter();
    expect(upsertedIds()).toHaveLength(0);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("treats a missing published field as grandfathered published", async () => {
    queueRoleNotices({ ...base, published: undefined, beforeSeats: null, afterSeats: leadsOf("m1") });
    await flushAfter();
    expect(upsertedIds()).toHaveLength(1);
  });

  it("queues per CURRENT assignee on a delete, with their pre-delete labels", async () => {
    queueRoleNotices({ ...base, deleted: true, beforeSeats: leadsOf("m1"), afterSeats: null });
    await flushAfter();
    expect(upsertFor("m1").createIfNotExists.before).toEqual({ beforeRoles: ["Líder"] });
  });

  it("stays silent when neither state names anybody", async () => {
    queueRoleNotices({ ...base, beforeSeats: null, afterSeats: seats() });
    await flushAfter();
    expect(afterCallbacks).toHaveLength(0);
    expect(upsertedIds()).toHaveLength(0);
  });

  it("commits in its OWN transaction and swallows a failed outbox write", async () => {
    // A failed outbox op must never abort a committed content write, so the
    // upsert is never part of the business transaction and never rethrows.
    outboxCommitError = new Error("sanity down");
    queueRoleNotices({ ...base, beforeSeats: null, afterSeats: leadsOf("m1") });
    expect(afterCallbacks).toHaveLength(1);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(outboxTransactions).toHaveLength(1);
  });
});

describe("notifyRolePublished", () => {
  const services = [
    { recipients: ["mem-1"], type: "sunday_role" as const, date: "2026-08-09", body: { leads: ["mem-1"] } },
    { recipients: ["mem-9"], type: "saturday_role" as const, date: "2026-08-08", body: { chorus: ["mem-9"] } },
  ];

  it("pushes to every current assignee per service and sends ONE consolidated email batch", async () => {
    notifyRolePublished(services);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock.mock.calls[1][0]).toEqual(["mem-9"]);
    expect(sendAssignmentEmailsBatchMock).toHaveBeenCalledTimes(1);
    expect(sendAssignmentEmailsBatchMock.mock.calls[0][0]).toEqual([
      { type: "sunday_role", date: "2026-08-09", body: { leads: ["mem-1"] } },
      { type: "saturday_role", date: "2026-08-08", body: { chorus: ["mem-9"] } },
    ]);
  });

  it("an unpublish or an empty transition batch is silent", () => {
    notifyRolePublished([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("swallows a failing batch email", async () => {
    sendAssignmentEmailsBatchMock.mockRejectedValueOnce(new Error("smtp down"));
    notifyRolePublished(services);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  });
});

// ── Setlist audience ────────────────────────────────────────────────────────

describe("notifySetlistSaved", () => {
  it("uses the setlistRecipientIds audience derived from committed server state", async () => {
    operationalFetch
      .mockResolvedValueOnce([
        { _id: "mem-all" },
        { _id: "mem-assigned", setlist: "assigned" },
        { _id: "mem-elsewhere", setlist: "assigned" },
        { _id: "mem-off", setlist: "off" },
      ])
      .mockResolvedValueOnce(["mem-assigned"]);
    await notifySetlistSaved("2026-08-09");
    expect(sendPushMock).toHaveBeenCalledWith(
      ["mem-all", "mem-assigned"],
      "setlist",
      expect.objectContaining({ path: "/" }),
    );
    // The assigned-member read covers all five seat paths, bound by week.
    const assignedQuery = String(operationalFetch.mock.calls[1][0]);
    for (const path of [
      "Lead[]._ref",
      "BGVs[]._ref",
      "Chorus[]._ref",
      "instruments[].person._ref",
      "foh_team[].person._ref",
    ]) {
      expect(assignedQuery).toContain(path);
    }
    expect(operationalFetch.mock.calls[1][1]).toEqual({ week: "2026-08-09" });
  });

  it("does not wait on the push, and swallows its rejection (no unhandled rejection)", async () => {
    operationalFetch.mockResolvedValueOnce([{ _id: "mem-all" }]).mockResolvedValueOnce([]);
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeUndefined();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    // Give the detached rejection handler a turn to run.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("swallows a failed audience read and never throws into the save", async () => {
    operationalFetch.mockRejectedValueOnce(new Error("network"));
    await expect(notifySetlistSaved("2026-08-09")).resolves.toBeUndefined();
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

describe("setlist notice serviceDate guard", () => {
  // A notice with no usable date could never render a correct subject line, and
  // at flush `isPast("", today)` (a lexicographic YYYY-MM-DD comparison) has no
  // defined reading for `""`. The mint boundary must refuse it outright rather
  // than lean on that comparison's incidental behavior.
  const upserted = () => outboxTransactions.flat();

  it("queueSetlistNotice mints nothing when serviceDate is empty", async () => {
    queueSetlistNotice({
      roleId: "role-1",
      roleType: "sunday_role",
      serviceDate: "",
      published: true,
      beforeSongs: [],
      hasSongs: true,
      knownRecipients: [],
    });
    await flushAfter();
    expect(afterCallbacks).toHaveLength(0);
    expect(upserted()).toHaveLength(0);
  });

  it("queueSetlistNotice mints nothing when serviceDate is missing", async () => {
    queueSetlistNotice({
      roleId: "role-1",
      roleType: "sunday_role",
      serviceDate: undefined as unknown as string,
      published: true,
      beforeSongs: [],
      hasSongs: true,
      knownRecipients: [],
    });
    await flushAfter();
    expect(afterCallbacks).toHaveLength(0);
    expect(upserted()).toHaveLength(0);
  });

  it("queueSetlistNotice mints a notice once serviceDate is a real date (control)", async () => {
    queueSetlistNotice({
      roleId: "role-1",
      roleType: "sunday_role",
      serviceDate: "2026-08-09",
      published: true,
      beforeSongs: [],
      hasSongs: true,
      knownRecipients: [],
    });
    await flushAfter();
    expect(upserted()).toHaveLength(1);
  });

  it("queuePublishedSetlistNotices mints nothing for a subject with an empty serviceDate", async () => {
    queuePublishedSetlistNotices([
      {
        roleId: "role-2",
        roleType: "special_role",
        serviceDate: "",
        role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
        knownRecipients: [],
      },
    ]);
    await flushAfter();
    expect(upserted()).toHaveLength(0);
  });

  it("queuePublishedSetlistNotices mints nothing for a subject with a missing serviceDate", async () => {
    queuePublishedSetlistNotices([
      {
        roleId: "role-2",
        roleType: "special_role",
        serviceDate: undefined as unknown as string,
        role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
        knownRecipients: [],
      },
    ]);
    await flushAfter();
    expect(upserted()).toHaveLength(0);
  });

  it("queuePublishedSetlistNotices still mints for the other subjects in the same batch", async () => {
    queuePublishedSetlistNotices([
      {
        roleId: "role-2",
        roleType: "special_role",
        serviceDate: "",
        role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
        knownRecipients: [],
      },
      {
        roleId: "role-3",
        roleType: "special_role",
        serviceDate: "2026-08-09",
        role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
        knownRecipients: [],
      },
    ]);
    await flushAfter();
    expect(upserted()).toHaveLength(1);
    expect(upserted()[0].createIfNotExists._id).toBe(outboxId("setlist", "role-3"));
  });
});

// ── Layer 2: the opportunistic sweep (spec §3) ──────────────────────────────

describe("the opportunistic sweep", () => {
  const roleInput = {
    roleId: "role-1",
    roleType: "sunday_role" as const,
    serviceDate: "2026-08-09",
    published: true,
    beforeSeats: seats({ leads: ["m1"] }),
    afterSeats: seats({ leads: ["m2"] }),
  };

  const setlistInput = {
    roleId: "role-1",
    roleType: "sunday_role" as const,
    serviceDate: "2026-08-09",
    published: true,
    beforeSongs: [],
    hasSongs: true,
    knownRecipients: [],
  };

  const leadNotesInput = {
    proposalId: "prop-1",
    serviceDate: "2026-08-09",
    previousStatus: "pending",
    beforeNotes: "antes",
    beforeMessageCount: 1,
  };

  it("every committed write that queues a notice also sweeps due notices", async () => {
    queueRoleNotices(roleInput);
    await flushAfter();
    expect(sweepOutboxMock).toHaveBeenCalledTimes(1);
  });

  it("derates BOTH knobs — half the recipient limit AND half the send budget", async () => {
    // Halving only the limit would let a layer-2 sweep spend a FULL send budget
    // after the write route already consumed part of its `maxDuration`; halving
    // both keeps `ms_per_send × limit < budget` holding identically here.
    queueRoleNotices(roleInput);
    await flushAfter();
    expect(sweepOutboxMock).toHaveBeenCalledWith({
      emailLimit: EMAIL_LIMIT / 2,
      sendBudgetMs: SEND_BUDGET_MS / 2,
    });
  });

  it("sweeps from the setlist, publish and lead-notes writers too", async () => {
    queueSetlistNotice(setlistInput);
    await flushAfter();
    queuePublishedSetlistNotices([
      {
        roleId: "role-2",
        roleType: "special_role",
        serviceDate: "2026-08-09",
        role: { songs: [{ song: { _ref: "song-1" }, play_key: "C" }] },
        knownRecipients: [],
      },
    ]);
    await flushAfter();
    queueLeadNotesNotice(leadNotesInput);
    await flushAfter();
    expect(sweepOutboxMock).toHaveBeenCalledTimes(3);
  });

  it("runs AFTER the outbox upsert commits, never before it", async () => {
    queueRoleNotices(roleInput);
    await flushAfter();
    expect(eventLog).toEqual(["upsert commit", "sweep"]);
  });

  it("a failing sweep stays swallowed — a committed write never fails on it", async () => {
    sweepOutboxMock.mockRejectedValueOnce(new Error("sweep exploded"));
    queueRoleNotices(roleInput);
    await expect(flushAfter()).resolves.toBeUndefined();
  });

  it("a failing outbox commit does not skip the sweep", async () => {
    outboxCommitError = new Error("transport down");
    queueRoleNotices(roleInput);
    await flushAfter();
    expect(sweepOutboxMock).toHaveBeenCalledTimes(1);
  });

  it("a write that queues nothing does not sweep", async () => {
    queueRoleNotices({ ...roleInput, published: false });
    await flushAfter();
    expect(sweepOutboxMock).not.toHaveBeenCalled();
  });
});

// ── Proposals ───────────────────────────────────────────────────────────────

describe("notifyProposalPending", () => {
  it("delegates to the existing admin/co-lead + allowlist-aware email fan-out", async () => {
    await notifyProposalPending({
      leadId: "mem-1",
      roleId: "role-1",
      proposalId: "setlistProposal.role-1",
      serviceType: "sunday",
      serviceDate: "2026-08-09",
    });
    expect(notifyProposalSubmittedMock).toHaveBeenCalledWith({
      leadId: "mem-1",
      roleId: "role-1",
      proposalId: "setlistProposal.role-1",
      serviceType: "sunday",
      serviceDate: "2026-08-09",
    });
  });

  it("swallows a failure", async () => {
    notifyProposalSubmittedMock.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notifyProposalPending({
        leadId: "mem-1",
        roleId: "role-1",
        proposalId: "setlistProposal.role-1",
        serviceType: "special",
        serviceDate: "2026-08-09",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("proposal review recipients", () => {
  const doc = {
    lead: "mem-1",
    contributors: [
      { _key: "a", person: "mem-1" },
      { _key: "b", person: { _ref: "mem-2" } },
      { _key: "c" },
      null,
    ],
  };

  it("is the creator plus every contributor, deduped", () => {
    expect(proposalReviewRecipients(doc)).toEqual(["mem-1", "mem-2"]);
  });

  it("pushes the review outcome to exactly those recipients", async () => {
    await notifyProposalReview(doc, { title: "Propuesta aprobada", body: "ok" });
    expect(sendPushMock).toHaveBeenCalledWith(["mem-1", "mem-2"], "proposals", {
      title: "Propuesta aprobada",
      body: "ok",
      path: "/me",
    });
  });

  it("is silent with no resolvable recipient, and swallows a push failure", async () => {
    await notifyProposalReview({}, { title: "t", body: "b" });
    expect(sendPushMock).not.toHaveBeenCalled();
    sendPushMock.mockImplementationOnce(() => {
      throw new Error("fcm down");
    });
    await expect(notifyProposalReview(doc, { title: "t", body: "b" })).resolves.toBeUndefined();
    // An async rejection is swallowed too, never an unhandled rejection.
    sendPushMock.mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifyProposalReview(doc, { title: "t", body: "b" })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ── Cache revalidation, once per affected batch ─────────────────────────────

describe("revalidation", () => {
  it("a role create/edit/delete/swap/copy batch refreshes service + member views once", () => {
    revalidateRoleMutation();
    expect(revalidateServiceViewsMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/me");
  });

  it("a publish/unpublish batch refreshes the member-facing views once", () => {
    revalidateRolePublication();
    expect(revalidatePathMock.mock.calls.map((c) => c[0])).toEqual(["/", "/schedule", "/me"]);
  });

  it("a setlist save and an approval refresh the service views", () => {
    revalidateSetlistSave();
    revalidateProposalApproval();
    expect(revalidateServiceViewsMock).toHaveBeenCalledTimes(2);
  });
});
