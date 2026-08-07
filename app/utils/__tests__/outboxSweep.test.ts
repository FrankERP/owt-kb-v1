// app/utils/__tests__/outboxSweep.test.ts
//
// The sweep is one pipeline: gate, select, claim, classify, filter, group, send,
// consume. These tests exercise the SEMANTICS of that pipeline against fake
// clients — who is emailed, what the claim and the consume actually assert, and
// which notices survive — rather than the order in which mocks were touched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// operationalClient/outboxSweep are `import "server-only"` guarded; neutralize
// the marker so the modules load under vitest's node environment.
vi.mock("server-only", () => ({}));

const operationalFetch = vi.fn();
const sendEmailMock = vi.fn();
const isDeliveryBlockedMock = vi.fn();
const patchCommit = vi.fn();
const txCommit = vi.fn();
const writeClientDelete = vi.fn();

interface RecordedPatch {
  id: string;
  rev: string;
  set: Record<string, unknown>;
}
interface RecordedTx {
  patches: RecordedPatch[];
  deletes: string[];
}

const claimPatches: RecordedPatch[] = [];
const transactions: RecordedTx[] = [];

interface FakePatch {
  ifRevisionId(rev: string): FakePatch;
  set(value: Record<string, unknown>): FakePatch;
  commit(): Promise<unknown>;
}

function fakePatch(record: RecordedPatch, onCommit?: () => Promise<unknown>): FakePatch {
  const p: FakePatch = {
    ifRevisionId(rev) {
      record.rev = rev;
      return p;
    },
    set(value) {
      Object.assign(record.set, value);
      return p;
    },
    commit() {
      return onCommit ? onCommit() : Promise.resolve(undefined);
    },
  };
  return p;
}

const writeClientPatch = vi.fn((id: string) => {
  const record: RecordedPatch = { id, rev: "", set: {} };
  return fakePatch(record, () => {
    claimPatches.push(record);
    return patchCommit(record);
  });
});

interface FakeTransaction {
  patch(id: string, build: (p: FakePatch) => FakePatch): FakeTransaction;
  delete(id: string): FakeTransaction;
  commit(): Promise<unknown>;
}

const writeClientTransaction = vi.fn(() => {
  const call: RecordedTx = { patches: [], deletes: [] };
  const tx: FakeTransaction = {
    patch(id, build) {
      const record: RecordedPatch = { id, rev: "", set: {} };
      build(fakePatch(record));
      call.patches.push(record);
      return tx;
    },
    delete(id) {
      call.deletes.push(id);
      writeClientDelete(id);
      return tx;
    },
    commit() {
      transactions.push(call);
      return txCommit(call);
    },
  };
  return tx;
});

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: {
    patch: (id: string) => writeClientPatch(id),
    transaction: () => writeClientTransaction(),
  },
}));
vi.mock("@/app/utils/email", () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a) }));
vi.mock("@/app/utils/deliveryFirewall", () => ({
  isDeliveryBlocked: (...a: unknown[]) => isDeliveryBlockedMock(...a),
}));

import { EMAIL_LIMIT, SEND_BUDGET_MS, sweepOutbox } from "@/app/utils/outboxSweep";

// ── Fixtures ────────────────────────────────────────────────────────────────

// 12:00 local in America/Mexico_City (UTC-6) on 2026-08-01, so "today" is
// unambiguous and every fixture service date is in the future.
const NOW = new Date("2026-08-01T18:00:00.000Z");

type Doc = Record<string, unknown>;

interface World {
  notices: Doc[];
  /** roleId → assigned member ids (the `assignedMemberRefsQuery` answer). */
  recipients: Record<string, string[]>;
  /** roleId → stored role document, or absent for a deleted role. */
  roles: Record<string, Doc>;
  /** `${setlistType}:${week}` → stored songs array. */
  weekendSongs: Record<string, Doc[]>;
  proposals: Record<string, Doc>;
  admins: string[];
  members: Record<string, Doc>;
  titles: Record<string, string>;
}

let world: World;
/** Every (query, params) pair the sweep issued, for contract assertions. */
let reads: { query: string; params: Doc }[];

function member(id: string, notifPrefs: Doc = {}): Doc {
  return { _id: id, email: `${id}@example.com`, alias: id, member_name: id, notifPrefs };
}

function members(ids: string[], notifPrefs: Doc = {}): Record<string, Doc> {
  return Object.fromEntries(ids.map((id) => [id, member(id, notifPrefs)]));
}

function ids(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function roleNotice(over: Doc = {}): Doc {
  return {
    _id: "outbox.role.aaa",
    _rev: "rev-role-1",
    kind: "role",
    subjectKey: "m1__r1",
    memberId: "m1",
    roleId: "r1",
    proposalId: null,
    serviceDate: "2026-08-09",
    roleType: "sunday_role",
    before: { beforeRoles: [] },
    knownRecipients: ["m1"],
    firstQueuedAt: "2026-08-01T17:00:00.000Z",
    notifyAfter: "2026-08-01T17:15:00.000Z",
    deadline: "2026-08-01T18:00:00.000Z",
    status: "pending",
    claimedAt: null,
    ...over,
  };
}

function setlistNotice(over: Doc = {}): Doc {
  return {
    _id: "outbox.setlist.bbb",
    _rev: "rev-setlist-1",
    kind: "setlist",
    subjectKey: "r2",
    memberId: null,
    roleId: "r2",
    proposalId: null,
    serviceDate: "2026-08-08",
    roleType: "saturday_role",
    before: { beforeSongs: [] },
    knownRecipients: [],
    firstQueuedAt: "2026-08-01T17:01:00.000Z",
    notifyAfter: "2026-08-01T17:16:00.000Z",
    deadline: "2026-08-01T18:01:00.000Z",
    status: "pending",
    claimedAt: null,
    ...over,
  };
}

function roleDoc(over: Doc = {}): Doc {
  return {
    _id: "r1",
    _type: "sunday_role",
    published: true,
    week: "2026-08-09",
    Lead: [{ _key: "l1", _ref: "m1" }],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function storedSong(ref: string, key = "G", medleyTag?: string): Doc {
  return { _key: `k-${ref}`, song: { _ref: ref }, play_key: key, ...(medleyTag ? { medley_tag: medleyTag } : {}) };
}

function snapshotRow(ref: string, key = "G"): Doc {
  return { _key: `s-${ref}`, ref, key };
}

function emptyWorld(): World {
  return {
    notices: [],
    recipients: {},
    roles: {},
    weekendSongs: {},
    proposals: {},
    admins: [],
    members: {},
    titles: {},
  };
}

/**
 * Routes the sweep's reads by their distinguishing shape. Deliberately strict:
 * an unrouted query throws rather than silently answering `null`, so a change to
 * the read contract surfaces as a failure instead of an empty sweep.
 */
function routeRead(query: string, params: Doc): unknown {
  const p = params as { roleId?: string; roleType?: string; setlistType?: string; week?: string; proposalId?: string; ids?: string[] };
  if (query.includes("notificationOutbox")) return world.notices;
  if (query.includes("array::unique")) return world.recipients[p.roleId ?? ""] ?? [];
  if (query.includes("role in [")) return world.admins;
  if (query.includes("setlistProposal")) return world.proposals[p.proposalId ?? ""] ?? null;
  if (query.includes('_type == "post"')) {
    return (p.ids ?? [])
      .filter((id) => world.titles[id] !== undefined)
      .map((id) => ({ _id: id, title: world.titles[id] }));
  }
  if (query.includes("teamMembers")) {
    return (p.ids ?? []).map((id) => world.members[id]).filter(Boolean);
  }
  if (query.includes("$setlistType")) return world.weekendSongs[`${p.setlistType}:${p.week}`] ?? null;
  if (query.includes("foh_team")) return world.roles[p.roleId ?? ""] ?? null;
  throw new Error(`unrouted query: ${query}`);
}

function readsMatching(fragment: string): { query: string; params: Doc }[] {
  return reads.filter((r) => r.query.includes(fragment));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  claimPatches.length = 0;
  transactions.length = 0;
  world = emptyWorld();
  reads = [];
  isDeliveryBlockedMock.mockReturnValue(false);
  // Every claim hands back the patched document, carrying the revision the
  // consume asserts. `outbox.<id>` keeps the returned revision distinguishable
  // from the one the SELECT read observed.
  patchCommit.mockImplementation(async (rec: RecordedPatch) => ({ _id: rec.id, _rev: `claimed-${rec.id}` }));
  txCommit.mockResolvedValue({ transactionId: "tx" });
  sendEmailMock.mockResolvedValue({ ok: true });
  operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
    reads.push({ query, params });
    return routeRead(query, params);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("sweepOutbox — the gate", () => {
  it("exits without touching the outbox when delivery is blocked", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    isDeliveryBlockedMock.mockReturnValue(true);

    const report = await sweepOutbox();

    expect(report.claimed).toBe(0);
    expect(writeClientPatch).not.toHaveBeenCalled();
    expect(writeClientDelete).not.toHaveBeenCalled();
    expect(operationalFetch).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("sweepOutbox — grouping and fan-out", () => {
  it("sends one email per recipient across several notices", async () => {
    // The whole point of the debounce: a member with a role change on Sunday and
    // a new setlist on Saturday gets ONE email with two sections.
    world.notices = [roleNotice(), setlistNotice({ knownRecipients: ["m1"] })];
    world.roles = {
      r1: roleDoc(),
      r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08", Lead: [{ _key: "l", _ref: "m1" }] }),
    };
    world.recipients = { r1: ["m1"], r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Cuán grande es Él" };
    world.members = members(["m1"]);

    const report = await sweepOutbox();

    expect(report.claimed).toBe(2);
    expect(report.consumed).toBe(2);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(report.emailed).toBe(1);
    const sent = sendEmailMock.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(sent.to).toBe("m1@example.com");
    // Two lines in one email → the grouped subject, not either single subject.
    expect(sent.subject).toBe("Novedades de tus servicios");
    expect(sent.html).toContain("Nueva asignación");
    expect(sent.html).toContain("Setlist listo");
    expect(sent.html).toContain("Cuán grande es Él");
  });

  it("sends one email to every participant of a setlist notice", async () => {
    // The regression test for notify-one-participant-then-delete.
    const team = ids("m", 5);
    world.notices = [
      setlistNotice({ before: { beforeSongs: [snapshotRow("song1")] }, knownRecipients: team }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1"), storedSong("song2", "D")] };
    world.titles = { song1: "Santo", song2: "Digno" };
    world.members = members(team);

    const report = await sweepOutbox();

    expect(sendEmailMock).toHaveBeenCalledTimes(5);
    expect(report.emailed).toBe(5);
    // One notice, one consume — the fan-out does not multiply the delete.
    expect(report.claimed).toBe(1);
    expect(report.consumed).toBe(1);
    expect(writeClientDelete).toHaveBeenCalledTimes(1);
    const recipients = sendEmailMock.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual(team.map((m) => `${m}@example.com`).sort());
    expect((sendEmailMock.mock.calls[0][0] as { subject: string }).subject).toContain("El setlist cambió");
  });

  it("introduces a recipient absent from knownRecipients", async () => {
    // A member added after the setlist was queued gets "Setlist listo", not a
    // diff against a list they never saw.
    world.notices = [
      setlistNotice({ before: { beforeSongs: [snapshotRow("song1")] }, knownRecipients: ["m1"] }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    // m2 (new to the service) is resolved first so the assertion is unambiguous.
    world.recipients = { r2: ["m2", "m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1"), storedSong("song2", "D")] };
    world.titles = { song1: "Santo", song2: "Digno" };
    world.members = members(["m1", "m2"]);

    await sweepOutbox();

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect((sendEmailMock.mock.calls[0][0] as { subject: string }).subject).toContain("Setlist listo");
    expect((sendEmailMock.mock.calls[1][0] as { subject: string }).subject).toContain("El setlist cambió");
  });

  it("tells the assignees of a deleted role that they no longer serve", async () => {
    // `roleExists: false`, never a fabricated `published: false` — the deleted
    // role rule lives outside the unpublish guard on purpose.
    world.notices = [roleNotice({ before: { beforeRoles: ["BGV"] } })];
    world.roles = {}; // the role document is gone
    world.recipients = {};
    world.members = members(["m1"]);

    const report = await sweepOutbox();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0][0] as { subject: string }).subject).toContain("Ya no participas");
    expect(report.consumed).toBe(1);
  });

  it("drops a setlist notice whose live service date no longer matches its snapshot", async () => {
    world.notices = [setlistNotice({ knownRecipients: ["m1"] })];
    // The service moved a week: `before.songs` was captured against another week.
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-15" }) };
    world.recipients = { r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-15": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(["m1"]);

    const report = await sweepOutbox();

    expect(sendEmailMock).not.toHaveBeenCalled();
    // Dropped, but still consumed — a notice with nothing to say is not immortal.
    expect(report.claimed).toBe(1);
    expect(report.consumed).toBe(1);
  });

  it("resolves departed song titles from the union of before- and after-refs", async () => {
    world.notices = [
      setlistNotice({ before: { beforeSongs: [snapshotRow("gone1")] }, knownRecipients: ["m1"] }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("stay1")] };
    // `gone1` still has a title; `stay1` too. A ref with no title must not throw.
    world.titles = { gone1: "Se fue", stay1: "Sigue" };
    world.members = members(["m1"]);

    await sweepOutbox();

    const titleReads = readsMatching('_type == "post"');
    expect(titleReads).toHaveLength(1);
    expect(((titleReads[0].params as { ids: string[] }).ids ?? []).sort()).toEqual(["gone1", "stay1"]);
    const html = (sendEmailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("Se fue");
    expect(html).toContain("Sigue");
  });

  it("renders a song whose document was deleted in the interim without failing", async () => {
    world.notices = [
      setlistNotice({ before: { beforeSongs: [snapshotRow("ghost")] }, knownRecipients: ["m1"] }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("stay1")] };
    world.titles = { stay1: "Sigue" }; // `ghost` resolves to no title at all
    world.members = members(["m1"]);

    const report = await sweepOutbox();

    expect(report.emailed).toBe(1);
    expect((sendEmailMock.mock.calls[0][0] as { html: string }).html).toContain("Sigue");
  });
});

describe("sweepOutbox — selection bounds the recipient union", () => {
  it("does not treat a 20-recipient setlist notice as oversized", async () => {
    // Regression for the 12-vs-20 defect: a Sunday service routinely has 12-20
    // seats, so "taken alone" must be exceptional, not the normal path.
    const team = ids("m", 20);
    world.notices = [setlistNotice({ knownRecipients: team })];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(team);

    const report = await sweepOutbox();

    expect(report.deferred).toBe(0);
    expect(report.claimed).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(20);
  });

  it("defers a second notice whose recipients would exceed the budget", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [
      setlistNotice({ _id: "outbox.setlist.a", roleId: "r2", subjectKey: "r2", knownRecipients: ["m1", "m2"] }),
      setlistNotice({ _id: "outbox.setlist.b", _rev: "rev-setlist-2", roleId: "r3", subjectKey: "r3", knownRecipients: ["m3", "m4"] }),
    ];
    world.roles = {
      r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }),
      r3: roleDoc({ _id: "r3", _type: "saturday_role", week: "2026-08-08" }),
    };
    world.recipients = { r2: ["m1", "m2"], r3: ["m3", "m4"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(ids("m", 4));

    const report = await sweepOutbox({ emailLimit: 3 });

    expect(report.deferred).toBe(1);
    expect(report.claimed).toBe(1);
    expect(claimPatches.map((c) => c.id)).toEqual(["outbox.setlist.a"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("deferred"));
    logSpy.mockRestore();
  });

  it("takes a single oversized notice alone rather than truncating it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const team = ids("m", 4);
    world.notices = [
      setlistNotice({ _id: "outbox.setlist.a", roleId: "r2", subjectKey: "r2", knownRecipients: team }),
      roleNotice({ _id: "outbox.role.b" }),
    ];
    world.roles = {
      r1: roleDoc(),
      r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }),
    };
    world.recipients = { r2: team, r1: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(team);

    const report = await sweepOutbox({ emailLimit: 2 });

    // Its own recipients exceed the budget, so it is taken ALONE — never split.
    expect(report.claimed).toBe(1);
    expect(claimPatches.map((c) => c.id)).toEqual(["outbox.setlist.a"]);
    expect(report.deferred).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(4);
    logSpy.mockRestore();
  });
});

describe("sweepOutbox — claim and consume", () => {
  it("claims with a revision-asserting patch commit, one per notice", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);

    await sweepOutbox();

    expect(writeClientPatch).toHaveBeenCalledTimes(1);
    expect(claimPatches).toHaveLength(1);
    expect(claimPatches[0].id).toBe("outbox.role.aaa");
    // The revision the SELECT read observed.
    expect(claimPatches[0].rev).toBe("rev-role-1");
    expect(claimPatches[0].set.status).toBe("sending");
    expect(claimPatches[0].set.claimedAt).toBe(NOW.toISOString());
  });

  it("consumes with a revision-asserting no-op patch plus the delete in one transaction", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);

    await sweepOutbox();

    expect(transactions).toHaveLength(1);
    const tx = transactions[0];
    expect(tx.deletes).toEqual(["outbox.role.aaa"]);
    expect(tx.patches).toHaveLength(1);
    // `delete()` takes no precondition, so the guard is the patch — and it
    // asserts the revision the CLAIM returned, not the one SELECT saw.
    expect(tx.patches[0].id).toBe("outbox.role.aaa");
    expect(tx.patches[0].rev).toBe("claimed-outbox.role.aaa");
    expect(tx.patches[0].set).toEqual({ status: "sending" });
  });

  it("skips a notice whose claim fails, and claims the rest", async () => {
    world.notices = [roleNotice(), roleNotice({ _id: "outbox.role.b", _rev: "rev-role-2", memberId: "m2", subjectKey: "m2__r1" })];
    world.roles = { r1: roleDoc({ Lead: [{ _key: "l1", _ref: "m1" }, { _key: "l2", _ref: "m2" }] }) };
    world.recipients = { r1: ["m1", "m2"] };
    world.members = members(["m1", "m2"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    patchCommit.mockRejectedValueOnce(Object.assign(new Error("conflict"), { statusCode: 409 }));

    const report = await sweepOutbox();

    // One conflict drops only that notice — it never aborts the sweep.
    expect(report.claimed).toBe(1);
    expect(report.consumed).toBe(1);
    expect(writeClientDelete).toHaveBeenCalledTimes(1);
    expect(writeClientDelete).toHaveBeenCalledWith("outbox.role.b");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect((sendEmailMock.mock.calls[0][0] as { to: string }).to).toBe("m2@example.com");
    errSpy.mockRestore();
  });

  it("sends nothing when every claim fails", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    patchCommit.mockRejectedValueOnce(Object.assign(new Error("conflict"), { statusCode: 409 }));

    const report = await sweepOutbox();

    expect(report.claimed).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(writeClientDelete).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("leaves a notice re-pended during the send undeleted, and reports it", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    txCommit.mockRejectedValueOnce(Object.assign(new Error("stale"), { statusCode: 409 }));

    const report = await sweepOutbox();

    expect(report.claimed).toBe(1);
    expect(report.emailed).toBe(1);
    // The revision assertion lost: the notice survives to be re-classified.
    expect(report.consumed).toBe(0);
    errSpy.mockRestore();
  });

  it("consumes the batch even when a send fails", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendEmailMock.mockResolvedValue({ ok: false, error: "bad address" });

    const report = await sweepOutbox();

    expect(writeClientDelete).toHaveBeenCalled();
    expect(report.consumed).toBe(1);
    expect(report.emailed).toBe(0);
    errSpy.mockRestore();
  });

  it("consumes a notice whose classification throws", async () => {
    world.notices = [roleNotice()];
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The role read blows up AFTER the claim has already been taken.
    let seen = 0;
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      if (query.includes("foh_team") && seen++ === 0) throw new Error("content lake down");
      return routeRead(query, params);
    });

    const report = await sweepOutbox();

    expect(report.claimed).toBe(1);
    expect(report.consumed).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("sweepOutbox — due-ness, preferences and the send budget", () => {
  it("does not claim a notice whose lease has not expired", async () => {
    world.notices = [
      roleNotice({ status: "sending", claimedAt: NOW.toISOString(), notifyAfter: "2026-08-01T17:15:00.000Z" }),
    ];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);

    const report = await sweepOutbox();

    expect(report.claimed).toBe(0);
    expect(report.deferred).toBe(0);
    expect(writeClientPatch).not.toHaveBeenCalled();
  });

  it("filters lines by their own preference and sends nothing when none survive", async () => {
    // A setlist notice whose only participant set emailSetlist:false is consumed,
    // not left immortal.
    world.notices = [setlistNotice({ knownRecipients: ["m1"] })];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(["m1"], { emailSetlist: false });

    const report = await sweepOutbox();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(writeClientDelete).toHaveBeenCalled();
    expect(report.consumed).toBe(1);
  });

  it("honours the legacy notifPrefs.email opt-out through wantsNotification", async () => {
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"], { email: false });

    const report = await sweepOutbox();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(report.consumed).toBe(1);
  });

  it("stops sending at the wall-clock budget and still consumes", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);

    const report = await sweepOutbox({ sendBudgetMs: 0 });

    expect(report.unserved).toBeGreaterThan(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(writeClientDelete).toHaveBeenCalled();
    expect(report.consumed).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("unserved"));
    logSpy.mockRestore();
  });

  it("charges the budget for the send stage only, never for the read phase", async () => {
    // The defect this pins: the clock used to start before the due-notices
    // fetch, the per-notice recipient reads, the claim commits and
    // classification — so a slow read phase spent the whole budget, every email
    // was dropped, and stage 8 consumed the batch anyway. Permanently.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    // Every read costs 3 s of wall clock — several times the whole send budget.
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      vi.setSystemTime(new Date(Date.now() + 3_000));
      return routeRead(query, params);
    });

    const report = await sweepOutbox({ sendBudgetMs: 1_000 });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(report.emailed).toBe(1);
    expect(report.unserved).toBe(0);
    logSpy.mockRestore();
  });

  it("stops sending at the sweep's own deadline, so stage 8 always runs", async () => {
    // The 2026-08-06 stall, in one test. Not charging the read phase to the send
    // budget is correct for §1's inequality and fatal on its own: reads plus a
    // full send budget can reach the hosting route's maxDuration, the process is
    // killed before stage 8, the claims outlive it, the 5-minute lease re-offers
    // the SAME batch, and the next sweep dies in the same place — forever. The
    // second clock exists so the sweep gives up sending while it can still
    // consume.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    // A read phase slow enough to pass the sweep deadline before stage 7 starts.
    // The send budget's own clock has not started, so only the sweep clock can
    // stop this — which is exactly the case that used to be unguarded.
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      vi.setSystemTime(new Date(Date.now() + 20_000));
      return routeRead(query, params);
    });

    const report = await sweepOutbox();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(report.unserved).toBe(1);
    // The point of the whole exercise: the batch is discharged, so the next
    // sweep gets new work instead of this one again.
    expect(writeClientDelete).toHaveBeenCalled();
    expect(report.consumed).toBe(1);

    const stopped = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === "notify_sweep_send_budget_exhausted");
    expect(stopped?.stoppedBy).toBe("sweep_deadline");
    logSpy.mockRestore();
  });

  it("logs the observed send cost on completion, so ms_per_send stops being an assumption", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    // Each send costs 250 ms of wall clock.
    sendEmailMock.mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + 250));
      return { ok: true };
    });

    await sweepOutbox();

    const done = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === "notify_sweep_done");
    expect(done).toBeDefined();
    expect(done?.emailed).toBe(1);
    expect(done?.sendMs).toBe(250);
    expect(done?.msPerSend).toBe(250);
    expect(typeof done?.elapsedMs).toBe("number");
    logSpy.mockRestore();
  });
});

describe("sweepOutbox — recipient scoping and read contract", () => {
  it("scopes setlist recipients to the notice's role type and published services", async () => {
    world.notices = [setlistNotice({ knownRecipients: ["m1"] })];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: ["m1"] };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(["m1"]);

    await sweepOutbox();

    const recipientReads = readsMatching("array::unique");
    expect(recipientReads.length).toBeGreaterThan(0);
    for (const read of recipientReads) {
      // The member-facing-read invariant, at the query — not by relying on a
      // later drop rule to have caught it.
      expect(read.query).toContain("published != false");
      // All five member-referencing seats, via assignedMemberRefsQuery.
      for (const seat of ["Lead[]._ref", "BGVs[]._ref", "Chorus[]._ref", "instruments[].person._ref", "foh_team[].person._ref"]) {
        expect(read.query).toContain(seat);
      }
      expect(read.params).toMatchObject({ roleType: "saturday_role", roleId: "r2" });
    }
    // The Saturday setlist lives in `saturdarSongs`, never `featuredSongs`.
    const songReads = readsMatching("$setlistType");
    expect(songReads[0].params).toMatchObject({ setlistType: "saturdarSongs", week: "2026-08-08" });
  });

  it("emails admins about a lead-notes notice and drops an approved proposal", async () => {
    const leadNotes = (over: Doc = {}): Doc => ({
      ...roleNotice(),
      _id: "outbox.leadnotes.ccc",
      _rev: "rev-notes-1",
      kind: "leadNotes",
      subjectKey: "p1",
      memberId: null,
      roleId: null,
      roleType: null,
      proposalId: "p1",
      before: { beforeNotes: "" },
      knownRecipients: [],
      ...over,
    });
    world.notices = [leadNotes()];
    world.proposals = { p1: { _id: "p1", status: "pending", lead_notes: "Ensayo 7pm", service_date: "2026-08-09" } };
    world.admins = ["a1", "a2"];
    world.members = members(["a1", "a2"]);

    let report = await sweepOutbox();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect((sendEmailMock.mock.calls[0][0] as { subject: string }).subject).toContain("Notas del líder");
    expect(report.consumed).toBe(1);

    // A proposal that is no longer reviewable drops.
    vi.clearAllMocks();
    claimPatches.length = 0;
    transactions.length = 0;
    patchCommit.mockImplementation(async (rec: RecordedPatch) => ({ _id: rec.id, _rev: `claimed-${rec.id}` }));
    txCommit.mockResolvedValue({ transactionId: "tx" });
    sendEmailMock.mockResolvedValue({ ok: true });
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      return routeRead(query, params);
    });
    world.proposals = { p1: { _id: "p1", status: "approved", lead_notes: "Ensayo 7pm", service_date: "2026-08-09" } };

    report = await sweepOutbox();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(report.consumed).toBe(1);
  });
});

/**
 * PLACEHOLDER, pending §1's release-gate measurement — nobody has yet timed a
 * real send through the pooled `maxConnections: 1` SMTP transport. §1's working
 * assumption of 2 000 ms/send does NOT fit (2 000 × 40 = 80 000 > 40 000); this
 * is the value the shipped knobs currently stand on, and the sweep now logs
 * `msPerSend` on every run so the real one is observable in production.
 *
 * WHEN THE REAL NUMBER ARRIVES: replace this constant with the ms/send measured
 * over a batch of ~20 and re-run. If the assertions below then fail, §1 says
 * DERIVE, never re-guess: raise `NOTIFY_SEND_BUDGET_MS` (bounded by the hosting
 * route's `maxDuration = 60`) or lower `NOTIFY_FLUSH_EMAIL_LIMIT` — and if
 * lowering the limit would take it under the largest per-service seat count
 * (12–20 on a Sunday), STOP: splitting one notice's recipients across sweeps is
 * a different outbox model and must be designed, not discovered in production.
 * Raising THIS constant to make the test green is the one forbidden move.
 */
const MEASURED_MS_PER_SEND = 500;

/** Layer 2 (the opportunistic sweep inside a save) derates BOTH knobs by this. */
const LAYER_2_DERATE = 2;

describe("sweepOutbox — configuration", () => {
  it("defaults the recipient limit above the largest realistic single service", async () => {
    // 40, not 12: a Sunday on this ~30-member team routinely fills 12-20 seats,
    // so "taken alone" must stay exceptional.
    expect(EMAIL_LIMIT).toBe(40);
    expect(EMAIL_LIMIT).toBeGreaterThan(20);
    expect(SEND_BUDGET_MS).toBe(40_000);
  });

  it("satisfies the knob inequality at layer 1 and at the halved layer 2", () => {
    // §10's release gate as a STANDING regression check. Asserting the two
    // constants' values (above) would pass against any pair of numbers someone
    // typed, including a pair that cannot fit — this asserts they fit.
    expect(MEASURED_MS_PER_SEND * EMAIL_LIMIT).toBeLessThan(SEND_BUDGET_MS);
    expect(MEASURED_MS_PER_SEND * (EMAIL_LIMIT / LAYER_2_DERATE)).toBeLessThan(
      SEND_BUDGET_MS / LAYER_2_DERATE,
    );
  });
});
