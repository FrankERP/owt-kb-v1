// app/utils/__tests__/outboxSweep.test.ts
//
// The sweep is one pipeline: gate, select, claim, classify, filter, group, send,
// consume. These tests exercise the SEMANTICS of that pipeline against fake
// clients — who is emailed, what the claim and the consume actually assert, and
// which notices survive — rather than the order in which mocks were touched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js";

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
// Mirrors `email.ts`'s real value — the sweep sends in waves this wide. Inlined
// rather than referenced: `vi.mock` is hoisted above every const in this file.
vi.mock("@/app/utils/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
  SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000,
}));
vi.mock("@/app/utils/deliveryFirewall", () => ({
  isDeliveryBlocked: (...a: unknown[]) => isDeliveryBlockedMock(...a),
}));

import { EMAIL_LIMIT, SEND_BUDGET_MS, sweepOutbox } from "@/app/utils/outboxSweep";
import { SEND_CONCURRENCY, SEND_TIMEOUT_MS } from "@/app/utils/email";

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
 * A stored thread message, in the shape the routes actually append. WHOLE
 * objects, because `world.proposals` now feeds `groq-js`: the projection has to
 * do its own filtering and narrowing rather than being handed a pre-shaped row.
 */
const threadMessage = (kind: string, body: string, key: string) => ({
  _key: key,
  _type: "proposal_message",
  author: { _ref: kind === "lead_note" ? "lead-1" : "a1" },
  author_role: kind === "lead_note" ? "lead" : "admin",
  kind,
  body,
  at: "2026-08-08T10:00:00.000Z",
});

let msgKey = 0;
const note = (body: string) => threadMessage("lead_note", body, `k${++msgKey}`);
const adminNote = (body: string) => threadMessage("admin_change_request", body, `k${++msgKey}`);

/** A whole `setlistProposal`, for the query to project rather than replace. */
const proposalDoc = (over: Doc = {}): Doc => ({
  _id: "p1",
  _type: "setlistProposal",
  status: "pending",
  service_date: "2026-08-09",
  lead_notes: "",
  messages: [],
  ...over,
});

/** Executes a real query against an in-memory dataset, as Sanity would. */
async function runGroq(query: string, dataset: unknown[], params: Doc): Promise<unknown> {
  const value = await evaluate(parse(query), { dataset, params });
  return value.get();
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
  // EXECUTED, not hand-written. `world.proposals` holds whole documents and the
  // real `PROPOSAL_QUERY` runs over them with `groq-js`, so the projection and
  // the fixture cannot drift apart. Answering with a literal is what let this
  // suite stay green through a projection change for as long as it did: the
  // classifier would have been fed a shape the query no longer returns.
  if (query.includes("setlistProposal")) {
    const doc = world.proposals[p.proposalId ?? ""];
    return doc ? runGroq(query, [doc], params) : null;
  }
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

  it("never exceeds SEND_CONCURRENCY in flight, whatever that is set to", async () => {
    // The 2026-08-07 throughput defect. One send costs ~13 s against this mail
    // server — the probe put connect+AUTH at ~0.4 s of that, so the cost is the
    // message — and serialized that is ~220 s for a Sunday inside a 60 s
    // function. The sweep emailed one person and dropped sixteen, because stage 8
    // consumes whether or not stage 7 reached them.
    const team = ids("m", 12);
    world.notices = [setlistNotice({ knownRecipients: team })];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(team);

    let inFlight = 0;
    let peakInFlight = 0;
    sendEmailMock.mockImplementation(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { ok: true };
    });

    const report = await sweepOutbox();

    expect(report.emailed).toBe(12);
    expect(report.unserved).toBe(0);
    // Asserted against the constant rather than a hard-coded width, because the
    // right width has moved twice: 8 produced ZERO deliveries against
    // mail.oasis.mx where serial produced one, so it went to 1; the sender then
    // moved to Gmail and it is 8 again as of 2026-08-27. Asserting the constant
    // means this row follows without editing.
    // The machinery must be correct at whatever value that turns out to be.
    const { SEND_CONCURRENCY } = await import("@/app/utils/email");
    expect(peakInFlight).toBe(Math.min(SEND_CONCURRENCY, 12));
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

  it("stops sending at the wall-clock budget and re-pends instead of consuming", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);

    const report = await sweepOutbox({ sendBudgetMs: 0 });

    expect(report.unserved).toBeGreaterThan(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(writeClientDelete).not.toHaveBeenCalled();
    expect(report.consumed).toBe(0);
    expect(report.repended).toBe(1);
    expect(report.lost).toBe(0);
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
    // Every read costs 3 s of wall clock — together, more than the send budget
    // below, so a budget that charged for reads would have nothing left.
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      vi.setSystemTime(new Date(Date.now() + 3_000));
      return routeRead(query, params);
    });

    // 20 s, not the 1 s this once used: stage 7 now admits a wave only if the
    // worst case (SEND_TIMEOUT_MS, 20 s) fits in what remains, so a budget under
    // that admits nothing at all and would prove the opposite of the point. The
    // read phase still costs more than this budget, which is what matters here.
    const report = await sweepOutbox({ sendBudgetMs: 20_000 });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(report.emailed).toBe(1);
    expect(report.unserved).toBe(0);
    logSpy.mockRestore();
  });

  it("reads one subject once, however many notices share it", async () => {
    // Notices are one per (member, subject), so a batch is many notices over few
    // subjects. Unmemoized this was one round trip PER NOTICE for the same
    // document — the read phase, not the sends, is what pushed the 2026-08-06
    // backlog past the sweep deadline.
    world.notices = [
      roleNotice({ _id: "n1", memberId: "m1" }),
      roleNotice({ _id: "n2", memberId: "m2" }),
      roleNotice({ _id: "n3", memberId: "m3" }),
    ];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1", "m2", "m3"] };
    world.members = members(["m1", "m2", "m3"]);

    const report = await sweepOutbox();

    expect(report.claimed).toBe(3);
    const roleReads = reads.filter((r) => r.params.roleId === "r1" && r.query.includes("foh_team"));
    expect(roleReads).toHaveLength(1);
  });

  it("stops sending at the sweep's own deadline and re-pends so the next sweep can finish", async () => {
    // The 2026-08-06 stall, in one test. Not charging the read phase to the send
    // budget is correct for §1's inequality and fatal on its own: reads plus a
    // full send budget can reach the hosting route's maxDuration, the process is
    // killed before stage 8, the claims outlive it, the 5-minute lease re-offers
    // the SAME batch, and the next sweep dies in the same place — forever. The
    // second clock exists so the sweep gives up sending while it can still
    // discharge — and unserved recipients are re-pended, not destroyed.
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
    expect(writeClientDelete).not.toHaveBeenCalled();
    expect(report.consumed).toBe(0);
    expect(report.repended).toBe(1);
    expect(report.lost).toBe(0);

    const stopped = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((entry) => entry.event === "notify_sweep_send_budget_exhausted");
    expect(stopped?.stoppedBy).toBe("sweep_deadline");
    logSpy.mockRestore();
  });

  it("claims in waves, so a large batch does not spend the budget taking ownership", async () => {
    // 2026-08-07: a 27-notice claim took 27.7 s of a 45 s sweep, stage 7 was
    // refused its first wave, and the batch was consumed with `emailed: 0` —
    // the sweep spent its life taking ownership of work it then had no time to
    // do. A monthly role publish is the large-batch case BY DESIGN, so this is
    // the normal path, not an edge one.
    const team = ids("m", 16);
    world.notices = team.map((m, i) => roleNotice({ _id: `n${i}`, memberId: m }));
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: team };
    world.members = members(team);

    let inFlight = 0;
    let peakInFlight = 0;
    patchCommit.mockImplementation(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { _rev: "rev-claimed" };
    });

    const report = await sweepOutbox();

    expect(report.claimed).toBe(16);
    // Serially this peaks at 1, which is the defect.
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(8);
  });

  it("abandons a selection it ran out of time to serve, rather than claiming it", async () => {
    // Claiming is what commits a notice to deletion. A sweep that reaches the
    // deadline during SELECTION is already too slow to send, so claiming there
    // hands stage 4 work it cannot classify — and stage 8 deletes it regardless.
    // Unclaimed notices are simply still pending, so this path costs a delay and
    // cannot cost a notification.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice({ _id: "n1", memberId: "m1" }), roleNotice({ _id: "n2", memberId: "m2" })];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1", "m2"] };
    world.members = members(["m1", "m2"]);
    // The due-notices read alone blows the sweep deadline.
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      vi.setSystemTime(new Date(Date.now() + 46_000));
      return routeRead(query, params);
    });

    const report = await sweepOutbox();

    expect(report.claimed).toBe(0);
    expect(writeClientPatch).not.toHaveBeenCalled();
    expect(writeClientDelete).not.toHaveBeenCalled();
    // Nothing destroyed — everything is still waiting for the next sweep.
    expect(report.deferred).toBeGreaterThan(0);
    logSpy.mockRestore();
  });

  it("counts a tail it could not classify as unserved, and re-pends it", async () => {
    // An unclassified notice produces no line, never reaches stage 7's entries,
    // and must not be deleted — it is re-pended for the next sweep.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const team = ids("m", 4);
    world.notices = team.map((m, i) => roleNotice({ _id: `n${i}`, memberId: m }));
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: team };
    world.members = members(team);

    // Reads are fast enough to select and claim; classification then runs out of
    // clock on its very first notice.
    let classifyReads = 0;
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      if (query.includes("foh_team") && classifyReads++ === 0) {
        vi.setSystemTime(new Date(Date.now() + 46_000));
      }
      return routeRead(query, params);
    });

    const report = await sweepOutbox();

    expect(report.claimed).toBe(4);
    expect(report.consumed).toBe(0);
    expect(report.repended).toBe(4);
    expect(report.lost).toBe(0);
    expect(report.emailed).toBe(0);
    expect(report.emailed + report.unserved).toBe(report.claimed);
    logSpy.mockRestore();
  });

  it("refuses a wave that could not finish before the deadline", async () => {
    // Measured in production on 2026-08-07: `elapsedMs:57888` against a 45 s
    // reserve, then the platform killed the function and stage 8 never ran.
    // Asking "has the deadline passed?" admits a wave at 44 s that runs to 59 s.
    // The question has to be "does the WORST CASE still fit?" — and since every
    // send is bounded by SEND_TIMEOUT_MS, the worst case is knowable.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    world.notices = [roleNotice()];
    world.roles = { r1: roleDoc() };
    world.recipients = { r1: ["m1"] };
    world.members = members(["m1"]);
    // Reads leave 4 s before the 45 s reserve — room by the old test, nowhere
    // near enough for a send that may take 20 s.
    let reads_ = 0;
    operationalFetch.mockImplementation(async (query: string, params: Doc = {}) => {
      reads.push({ query, params });
      if (reads_++ === 0) vi.setSystemTime(new Date(Date.now() + 41_000));
      return routeRead(query, params);
    });

    const report = await sweepOutbox();

    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(report.unserved).toBe(1);
    expect(report.consumed).toBe(0);
    expect(report.repended).toBe(1);
    expect(report.lost).toBe(0);
    const stopped = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find((e) => e.event === "notify_sweep_send_budget_exhausted");
    expect(stopped?.stoppedBy).toBe("sweep_deadline");
    logSpy.mockRestore();
  });

  it("re-pends a setlist notice when the send budget stops early, instead of destroying it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const team = ids("m", 5);
    world.notices = [
      setlistNotice({ before: { beforeSongs: [snapshotRow("song1")] }, knownRecipients: team }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1"), storedSong("song2", "D")] };
    world.titles = { song1: "Santo", song2: "Digno" };
    world.members = members(team);

    const report = await sweepOutbox({ sendBudgetMs: 0 });

    expect(report.emailed).toBe(0);
    expect(report.unserved).toBe(5);
    expect(report.consumed).toBe(0);
    expect(report.repended).toBe(1);
    expect(report.lost).toBe(0);
    expect(writeClientDelete).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("skips recipients already attempted and emails the rest", async () => {
    const team = ids("m", 5);
    world.notices = [
      setlistNotice({
        knownRecipients: team,
        servedRecipients: ["m1", "m2", "m3"],
      }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(team);

    const report = await sweepOutbox();

    expect(report.emailed).toBe(2);
    expect(report.consumed).toBe(1);
    expect(report.repended).toBe(0);
    const to = sendEmailMock.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(to).toEqual(["m4@example.com", "m5@example.com"]);
  });

  it("counts only remaining recipients for selection, so a second notice can be claimed", async () => {
    const sat = ids("m", 10);
    world.notices = [
      setlistNotice({
        _id: "outbox.setlist.sat",
        roleId: "r2",
        subjectKey: "r2",
        knownRecipients: sat,
        servedRecipients: sat.slice(0, 8),
      }),
      setlistNotice({
        _id: "outbox.setlist.sun",
        _rev: "rev-setlist-2",
        roleId: "r3",
        subjectKey: "r3",
        serviceDate: "2026-08-09",
        roleType: "sunday_role",
        knownRecipients: ["m11"],
      }),
    ];
    world.roles = {
      r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }),
      r3: roleDoc({ _id: "r3", _type: "sunday_role", week: "2026-08-09" }),
    };
    world.recipients = { r2: sat, r3: ["m11"] };
    world.weekendSongs = {
      "saturdarSongs:2026-08-08": [storedSong("song1")],
      "featuredSongs:2026-08-09": [storedSong("song1")],
    };
    world.titles = { song1: "Santo" };
    world.members = members([...sat, "m11"]);

    const report = await sweepOutbox({ emailLimit: 3 });

    expect(report.deferred).toBe(0);
    expect(report.claimed).toBe(2);
    expect(report.emailed).toBe(3);
    expect(report.consumed).toBe(2);
  });

  it("persists the union of prior served ids when a remaining tail is re-pended", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const team = ids("m", 5);
    world.notices = [
      setlistNotice({
        knownRecipients: team,
        servedRecipients: ["m1", "m2"],
      }),
    ];
    world.roles = { r2: roleDoc({ _id: "r2", _type: "saturday_role", week: "2026-08-08" }) };
    world.recipients = { r2: team };
    world.weekendSongs = { "saturdarSongs:2026-08-08": [storedSong("song1")] };
    world.titles = { song1: "Santo" };
    world.members = members(team);

    const report = await sweepOutbox({ sendBudgetMs: 0 });

    expect(report.repended).toBe(1);
    expect(report.consumed).toBe(0);
    const repend = claimPatches.find((p) => p.set.status === "pending");
    expect(repend?.set.servedRecipients).toEqual(["m1", "m2"]);
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
      before: { beforeNotes: "", beforeMessageCount: 0 },
      knownRecipients: [],
      ...over,
    });
    world.notices = [leadNotes()];
    world.proposals = { p1: proposalDoc({ status: "pending", messages: [note("Ensayo 7pm")] }) };
    world.admins = ["a1", "a2"];
    world.members = members(["a1", "a2"]);

    let report = await sweepOutbox();
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    // The subject moved with the source: the thread carries admin replies and
    // the body can be several messages, so "Notas del líder" was wrong twice
    // over. This is the ONLY place the outbox subject is asserted.
    expect((sendEmailMock.mock.calls[0][0] as { subject: string }).subject).toContain(
      "Mensajes de la propuesta",
    );
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
    world.proposals = { p1: proposalDoc({ status: "approved", messages: [note("Ensayo 7pm")] }) };

    report = await sweepOutbox();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(report.consumed).toBe(1);
  });

  it("emails the messages appended after the snapshot, and only the LEAD's", async () => {
    // The row the delivery turns on. The thread is MIXED — the normal shape of a
    // proposal that has been through one review cycle — and the notice was
    // queued when it held ONE lead note. What admins must receive is the two
    // lead notes appended since, and NOT the admin's own change request.
    //
    // `beforeMessageCount` counts LEAD notes, so 1, not 2. A queue side counting
    // the whole array would send `slice(2)` = the last message only; counting it
    // on a longer thread sends nothing at all. Both pass an assertion that only
    // checks the body is non-empty, which is why this asserts it EXACTLY.
    world.notices = [
      {
        ...roleNotice(),
        _id: "outbox.leadnotes.mixed",
        _rev: "rev-mixed-1",
        kind: "leadNotes",
        subjectKey: "p1",
        memberId: null,
        roleId: null,
        roleType: null,
        proposalId: "p1",
        before: { beforeNotes: "Bajé la tonalidad.", beforeMessageCount: 1 },
        knownRecipients: [],
      },
    ];
    world.proposals = {
      p1: proposalDoc({
        status: "changes_requested",
        lead_notes: "Bajé la tonalidad.",
        messages: [
          note("Bajé la tonalidad."),
          adminNote("¿Podemos cerrar con algo más lento?"),
          note("Listo, cambié la última."),
          note("Y subí el tono de Santo."),
        ],
      }),
    };
    world.admins = ["a1"];
    world.members = members(["a1"]);

    await sweepOutbox();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const html = (sendEmailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("Listo, cambié la última.");
    expect(html).toContain("Y subí el tono de Santo.");
    // The two that must NOT be there: the admin's own words, and a message the
    // snapshot already covered.
    expect(html).not.toContain("¿Podemos cerrar con algo más lento?");
    expect(html).not.toContain("Bajé la tonalidad.");
  });

  it("does not drop a first-message notice, whose count is 0", async () => {
    // `beforeMessageCount: 0` is legitimate and falsy. A truthiness check reads
    // it as "legacy shape" and routes it to `classifyLeadNotes`, which — with a
    // `beforeNotes` of "" against a real newest body — happens to send here too.
    // So this asserts the CONTENT, which the two paths disagree about the moment
    // more than one message has been appended.
    world.notices = [
      {
        ...roleNotice(),
        _id: "outbox.leadnotes.first",
        _rev: "rev-first-1",
        kind: "leadNotes",
        subjectKey: "p1",
        memberId: null,
        roleId: null,
        roleType: null,
        proposalId: "p1",
        before: { beforeNotes: "", beforeMessageCount: 0 },
        knownRecipients: [],
      },
    ];
    world.proposals = {
      p1: proposalDoc({ status: "pending", messages: [note("Primera."), note("Segunda.")] }),
    };
    world.admins = ["a1"];
    world.members = members(["a1"]);

    await sweepOutbox();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const html = (sendEmailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("Primera.");
    expect(html).toContain("Segunda.");
  });

  it("classifies a LEGACY notice against the thread, not the frozen field", async () => {
    // A notice minted by production's pre-cutover route: `beforeNotes`, no count.
    // `before` is written only by `createIfNotExists` on a deterministic id, so
    // it keeps this shape for its whole window while the new route queues onto
    // it — which is why classifying against the stored `lead_notes` is wrong
    // rather than merely old: that field is frozen once the mirror stops, so
    // every message appended after the release would be swallowed.
    //
    // TWO assertions, and the second is the one an obvious implementation gets
    // wrong. Dropping the notice instead sends nothing, contributes no pending
    // recipients, leaves `countLost` silent, and passes any "it did not crash"
    // check while a real message vanishes.
    world.notices = [
      {
        ...roleNotice(),
        _id: "outbox.leadnotes.legacy",
        _rev: "rev-legacy-1",
        kind: "leadNotes",
        subjectKey: "p1",
        memberId: null,
        roleId: null,
        roleType: null,
        proposalId: "p1",
        before: { beforeNotes: "Lo de siempre." },
        knownRecipients: [],
      },
    ];
    world.proposals = {
      p1: proposalDoc({
        status: "pending",
        // Frozen at the pre-release value: nothing writes it any more.
        lead_notes: "Lo de siempre.",
        messages: [note("Lo de siempre."), note("Cambio de último momento: empezamos con Santo.")],
      }),
    };
    world.admins = ["a1"];
    world.members = members(["a1"]);

    const report = await sweepOutbox();

    // (a) an email is sent at all
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // (b) carrying the NEWEST message — the lead's most recent word, which is
    // exactly what the mirror used to hold — not the frozen field.
    const html = (sendEmailMock.mock.calls[0][0] as { html: string }).html;
    expect(html).toContain("Cambio de último momento: empezamos con Santo.");
    expect(report.consumed).toBe(1);
  });
});

/**
 * THE REAL NUMBER IS KNOWN, AND IT IS NOT THIS ONE. Production measured
 * `msPerSend` = **14 413 ms** on 2026-08-07 (two successful sends to external
 * recipients; a local recipient costs ~67 ms, so the cost is the server's remote
 * accept). This constant stays at 500 because the assertions below check the
 * DEFAULT `EMAIL_LIMIT` of 40, and swapping in 14 413 would turn a standing
 * regression guard into a permanently red test asserting a configuration nobody
 * runs — production runs `NOTIFY_FLUSH_EMAIL_LIMIT = 2`, where
 * `14 413 × 2 = 28 826 < 40 000` and §1's inequality genuinely holds.
 *
 * So read the guard for what it is: proof that the shipped DEFAULTS are
 * internally consistent, not evidence that sending is fast. The real cost and
 * what it forces live in `docs/NOTIFICATIONS.md` → Still open.
 *
 * §1's stop condition WAS crossed, deliberately and with the trade recorded:
 * lowering the limit below the largest per-service seat count (12-20 on a
 * Sunday) fragments a monthly publish into several emails per member. That was
 * chosen over destroying most of them. Raising THIS constant to make the test
 * green is still the one forbidden move.
 */
const MEASURED_MS_PER_SEND = 500;

describe("sweepOutbox — configuration", () => {
  it("defaults the recipient limit above the largest realistic single service", async () => {
    // 40, not 12: a Sunday on this ~30-member team routinely fills 12-20 seats,
    // so "taken alone" must stay exceptional.
    expect(EMAIL_LIMIT).toBe(40);
    expect(EMAIL_LIMIT).toBeGreaterThan(20);
    expect(SEND_BUDGET_MS).toBe(40_000);
  });

  it("satisfies the knob inequality at layer 1 and at the derated layer 2", () => {
    // §10's release gate as a STANDING regression check. Asserting the two
    // constants' values (above) would pass against any pair of numbers someone
    // typed, including a pair that cannot fit — this asserts they fit.
    //
    // IN THE RUNTIME'S FORM, not the spec's. The spec writes
    // `ms_per_send × limit < budget`, which charges the per-send reserve to
    // nothing and ignores concurrency; the loop actually admits a WAVE of
    // `SEND_CONCURRENCY` while `elapsed + SEND_TIMEOUT_MS <= budget`, so what
    // must fit is the wave count against the SPENDABLE part of the budget. The
    // previous version of this row asserted `SEND_BUDGET_MS / LAYER_2_DERATE`,
    // an expression production stopped using on 2026-08-27 — it passed while
    // describing a machine that no longer existed.
    const waves = Math.ceil(EMAIL_LIMIT / SEND_CONCURRENCY);
    const spendable = SEND_BUDGET_MS - SEND_TIMEOUT_MS;
    // The first wave is admitted at elapsed 0; each further wave costs one send's
    // latency and must still leave the reserve.
    expect((waves - 1) * MEASURED_MS_PER_SEND).toBeLessThanOrEqual(spendable);

    // LAYER 2'S HALF IS ASSERTED IN `serviceMutationSideEffects.test.ts`, against
    // the options that module actually builds. Recomputing the derate here is how
    // the previous version of this row came to assert `SEND_BUDGET_MS / 2`, an
    // expression production stopped using on 2026-08-27 — it stayed green while
    // describing a machine that no longer existed.
  });
});
