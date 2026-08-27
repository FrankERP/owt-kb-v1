// The two standalone thread writers (Child A §4) at the route level.
//
// The Sanity clients are fully mocked. The patch chain is RECORDED IN ORDER
// rather than merely counted, because that is the one thing this file exists to
// prove: `append` on a mocked chain succeeds whether or not `setIfMissing` ran
// first, so a test that only checks "a message was appended" passes against the
// exact bug that would break every proposal the migration never touched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireMinistryMemberMock = vi.fn();
const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();
const queueLeadNotesNoticeMock = vi.fn();
const sendPushMock = vi.fn();

// The transport, mocked at `push.ts` rather than at
// `serviceMutationSideEffects` — a wholesale mock of that module would vacate
// `notifyProposalReview`'s own audience resolution, which is exactly what the
// admin→lead rows below are asserting.
vi.mock("@/app/utils/push", () => ({ sendPush: (...a: unknown[]) => sendPushMock(...a) }));

// `after()` is REAL deferred work in these routes — both pushes live inside one,
// because an unawaited promise can be killed when the response returns. So the
// suite has to run the callbacks explicitly: asserting on a push that only
// happened to land because the handler awaited something afterwards would be
// testing the coupling this delivery deliberately removed.
const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>();
  return { ...mod, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});

/** Run every registered `after()` callback, including ones they register. */
async function drainAfter(): Promise<void> {
  for (let guard = 0; guard < 10 && afterCallbacks.length; guard++) {
    const batch = afterCallbacks.splice(0);
    for (const cb of batch) await cb();
  }
}

vi.mock("@/app/utils/authGuards", () => ({
  requireMinistryMember: () => requireMinistryMemberMock(),
  requireActiveManager: () => requireActiveManagerMock(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetch(...a) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { patch: (id: string) => makePatch(id) },
}));

// NOT a wholesale mock of `serviceMutationSideEffects`: no suite in the repo has
// one, and mocking the module would vacate the real fan-out. Only the one
// function this route calls is replaced.
vi.mock("@/app/utils/serviceMutationSideEffects", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  queueLeadNotesNotice: (...a: unknown[]) => queueLeadNotesNoticeMock(...a),
}));

import { POST as leadPost } from "@/app/api/me/proposals/[id]/messages/route";
import { POST as adminPost } from "@/app/api/admin/proposals/[id]/messages/route";
import { PROPOSAL_MESSAGES_MAX } from "@/app/utils/proposalMessageWrite";

// ── Patch-chain recorder ────────────────────────────────────────────────────

interface RecordedPatch {
  id: string;
  /** Every call in the order it was made — this is the assertion surface. */
  calls: string[];
  setIfMissing: Record<string, unknown>;
  appended: Record<string, unknown[]>;
  set: Record<string, unknown>;
  revisionAsserted: string | null;
  committed: boolean;
}

const patches: RecordedPatch[] = [];
const commitOutcomes: (Error | undefined)[] = [];

function conflictError(type = "documentRevisionIDDoesNotMatchError") {
  return Object.assign(new Error("conflict"), {
    statusCode: 409,
    details: { type: "mutationError", items: [{ error: { type } }] },
  });
}

function makePatch(id: string) {
  const rec: RecordedPatch = {
    id,
    calls: [],
    setIfMissing: {},
    appended: {},
    set: {},
    revisionAsserted: null,
    committed: false,
  };
  patches.push(rec);
  const chain = {
    setIfMissing(values: Record<string, unknown>) {
      rec.calls.push("setIfMissing");
      Object.assign(rec.setIfMissing, values);
      return chain;
    },
    append(field: string, items: unknown[]) {
      rec.calls.push("append");
      (rec.appended[field] ??= []).push(...items);
      return chain;
    },
    set(values: Record<string, unknown>) {
      rec.calls.push("set");
      Object.assign(rec.set, values);
      return chain;
    },
    ifRevisionId(rev: string) {
      rec.calls.push("ifRevisionId");
      rec.revisionAsserted = rev;
      return chain;
    },
    unset() {
      rec.calls.push("unset");
      return chain;
    },
    async commit() {
      const outcome = commitOutcomes.shift();
      if (outcome) throw outcome;
      rec.committed = true;
      const doc = store.proposals.find((p) => p._id === id);
      if (doc) {
        for (const [field, items] of Object.entries(rec.appended)) {
          const current = Array.isArray(doc[field]) ? (doc[field] as unknown[]) : [];
          doc[field] = [...current, ...items];
        }
        Object.assign(doc, rec.set);
        doc._rev = `${String(doc._rev)}+`;
      }
      return { _id: id };
    },
  };
  return chain;
}

const committed = () => patches.filter((p) => p.committed);

// ── In-memory store ─────────────────────────────────────────────────────────

interface Store {
  roles: Record<string, unknown>[];
  proposals: Record<string, unknown>[];
  rawRoleDrafts: Record<string, unknown>[];
  rawProposalDrafts: Record<string, unknown>[];
  /** `ADMIN_RECIPIENTS_QUERY`'s answer — ids, as that query projects. */
  admins: string[];
  /** `canonicalMembersByIdsQuery`'s answer, keyed by id. */
  members: Record<string, { alias?: string; member_name?: string }>;
}
let store: Store;

/** A FUTURE service date: `isThreadOpen` is a real guard on both routes, and a
 *  past date closes the thread. The suite runs pinned to America/Mexico_City. */
const WEEK = "2099-09-06";
const ROLE_ID = "role-1";
const PROPOSAL_ID = "setlistProposal.role-1";
// `alias` and `name` are what the push body reads — a real session carries them,
// refreshed from the same two `teamMembers` fields the member projection returns.
const LEAD = { user: { sanityId: "mem-1", role: "member", alias: "Ana", name: "Ana Ruiz" } };
const ADMIN = { user: { role: "admin", sanityId: "admin-1" } };

function ref(key: string, id: string) {
  return { _key: key, _type: "reference", _ref: id };
}

function sundayRole(over: Record<string, unknown> = {}) {
  return {
    _id: ROLE_ID,
    _rev: "role-rev-1",
    _type: "sunday_role",
    week: WEEK,
    published: true,
    Lead: [ref("a1", "mem-1")],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: PROPOSAL_ID,
    _rev: "prop-rev-1",
    _createdAt: "2026-07-01T00:00:00.000Z",
    _type: "setlistProposal",
    service_type: "sunday",
    service_ref: ROLE_ID,
    service_date: WEEK,
    status: "pending",
    lead: "mem-1",
    contributors: [{ _key: "c1", person: "mem-1" }],
    lead_notes: "Nota original",
    team_notes: "Salmo 100:2",
    songs: [{ _key: "p1", play_key: "D", song: { _type: "reference", _ref: "song-1" } }],
    ...over,
  };
}

function canonicalRead(query: string, params: Record<string, unknown>): unknown {
  // ADMIN_RECIPIENTS_QUERY — the un-scoped admin audience the lead→admin push
  // fans out to. Matched on the role list, which is what makes it that query.
  if (query.includes('role in ["super-admin","admin"]')) return store.admins;
  // canonicalMembersByIdsQuery — the author's display name for the push body.
  if (query.includes("teamMembers") && query.includes("_id in $ids")) {
    return ((params.ids as string[]) ?? [])
      .map((id) => store.members[id])
      .filter(Boolean);
  }
  if (query.includes("setlistProposal")) {
    // The routes' own response read, projecting the thread back with names.
    // `_id == $id` too: `THREAD_MESSAGES` is also interpolated into the GET
    // list query, which is keyed on the member. No live failure here — this suite
    // exercises no GET — but the two harnesses should not disagree.
    if (query.includes("author_name") && query.includes("_id == $id")) {
      const doc = store.proposals.find((p) => p._id === params.id);
      if (!doc) return null;
      const rows = Array.isArray(doc.messages) ? (doc.messages as Record<string, unknown>[]) : [];
      return {
        _id: doc._id,
        _rev: doc._rev,
        messages: rows.map((m) => ({ ...m, author_name: m.author ? "Ana" : null })),
      };
    }
    if (query.includes("_id == $id")) return store.proposals.filter((p) => p._id === params.id);
  }
  if (query.includes("_id == $id")) return store.roles.filter((r) => r._id === params.id);
  if (query.includes("_id in $ids")) {
    return store.roles.filter((r) => (params.ids as string[]).includes(r._id as string));
  }
  throw new Error(`unmocked canonical query: ${query}`);
}

function rawRead(query: string, params: Record<string, unknown>): unknown[] {
  if (query.includes("setlistProposal")) {
    return store.rawProposalDrafts.filter((d) => d._id === params.draftId);
  }
  return store.rawRoleDrafts.filter((d) => d._id === params.draftId);
}

function req(body: unknown): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

// Both helpers DRAIN `after()` before returning, so every row below exercises
// the deferred path the routes actually take rather than a promise that happened
// to resolve first. `postLeadRaw` skips the drain, for the one row that pins the
// deferral itself.
const postLeadRaw = (body: unknown, id = PROPOSAL_ID) =>
  leadPost(req(body), { params: Promise.resolve({ id }) });
const postLead = async (body: unknown, id = PROPOSAL_ID) => {
  const res = await postLeadRaw(body, id);
  await drainAfter();
  return res;
};
const postAdmin = async (body: unknown, id = PROPOSAL_ID) => {
  const res = await adminPost(req(body), { params: Promise.resolve({ id }) });
  await drainAfter();
  return res;
};

function seed(over: Record<string, unknown> = {}) {
  store.roles.push(sundayRole());
  store.proposals.push(proposal(over));
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  patches.length = 0;
  commitOutcomes.length = 0;
  store = {
    roles: [],
    proposals: [],
    rawRoleDrafts: [],
    rawProposalDrafts: [],
    admins: ["adm-1", "adm-2"],
    members: { "mem-1": { alias: "Ana" }, "adm-1": { alias: "Admin Uno" } },
  };
  requireMinistryMemberMock.mockResolvedValue(LEAD);
  requireActiveManagerMock.mockResolvedValue(ADMIN);
  operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) =>
    canonicalRead(q, p),
  );
  rawFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => rawRead(q, p));
});

// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/me/proposals/[id]/messages — the lead side", () => {
  it("appends a lead_note and mirrors NOTHING, in ONE patch", async () => {
    seed();
    const res = await postLead({ body: "  Bajé la tonalidad  " });
    expect(res.status).toBe(200);

    expect(committed()).toHaveLength(1);
    const p = committed()[0];
    expect(p.id).toBe(PROPOSAL_ID);
    const [msg] = p.appended.messages as Record<string, unknown>[];
    expect(msg).toMatchObject({
      _type: "proposal_message",
      kind: "lead_note",
      author_role: "lead",
      body: "Bajé la tonalidad", // trimmed by buildProposalMessage
      author: { _ref: "mem-1", _type: "reference" },
    });
    expect(typeof msg._key).toBe("string");
    expect(typeof msg.at).toBe("string");

    // The mirror is gone: the patch appends and sets NOTHING. `toEqual({})` on
    // the whole `set`, not `not.toHaveProperty`, because this route's patch has
    // no other business writing a field — anything appearing here is a new
    // writer nobody reviewed.
    expect(p.set).toEqual({});
    // And the stored value is left alone. Frozen, not blanked: it is what
    // production's old sweep compares against during the release window.
    expect(store.proposals[0].lead_notes).toBe("Nota original");
  });

  it("calls setIfMissing BEFORE append — the assertion this file exists for", async () => {
    seed();
    await postLead({ body: "hola" });
    const { calls } = committed()[0];
    expect(calls.indexOf("setIfMissing")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("setIfMissing")).toBeLessThan(calls.indexOf("append"));
    // Sanity rejects an append to an absent array. A mocked chain does not, so
    // ORDER is the only thing that distinguishes a correct route from one that
    // fails on every proposal the migration never touched.
  });

  it("asserts NO revision — two co-leads posting at once must both land", async () => {
    seed();
    await postLead({ body: "uno" });
    expect(committed()[0].revisionAsserted).toBeNull();
    expect(committed()[0].calls).not.toContain("ifRevisionId");
  });

  it("queues the debounced notice with the PRE-COMMIT snapshot", async () => {
    // MIXED on purpose, and the fixture is the assertion. On an all-lead-note
    // thread `count(all) === count(lead_note)`, so a queue side counting the
    // whole array passes by construction — and then, on a real proposal that
    // has been through one review cycle, `slice(T)` over an array of `L + 1`
    // lead notes is EMPTY. Every admin stops receiving the debounced email, the
    // notice classifies to `null` and is consumed, `report.lost` stays 0, and
    // every other test in this repo stays green. Three messages, two of them
    // lead notes, so the two counts differ: 2, never 3.
    seed({
      lead_notes: "vieja",
      status: "changes_requested",
      messages: [
        { _key: "m1", kind: "lead_note", body: "vieja", author: "mem-1" },
        { _key: "m2", kind: "admin_change_request", body: "cambia el cierre", author: "adm-1" },
        { _key: "m3", kind: "lead_note", body: "listo", author: "mem-1" },
      ],
    });
    await postLead({ body: "nueva" });
    expect(queueLeadNotesNoticeMock).toHaveBeenCalledTimes(1);
    expect(queueLeadNotesNoticeMock.mock.calls[0][0]).toMatchObject({
      proposalId: PROPOSAL_ID,
      serviceDate: WEEK,
      // Pre-commit, not the value the mirror just wrote: reading it after the
      // write gives post-write state and the email silently sends nothing.
      //
      // `beforeNotes` is KEPT, and this pin is what keeps it: it is what makes
      // the preview→main window's residual SILENCE rather than a stale-content
      // email, and nothing else would stop a later cleanup dropping it as dead
      // weight now that the flush no longer classifies against it.
      beforeNotes: "vieja",
      beforeMessageCount: 2,
      previousStatus: "changes_requested",
    });
    // `afterNotes` is GONE, not renamed. It carried the queue side's own
    // trimmed-equal guard, which now lives only in the callers.
    expect(queueLeadNotesNoticeMock.mock.calls[0][0]).not.toHaveProperty("afterNotes");
  });

  // ── Email XOR push (Child B criteria 2 and 4) ─────────────────────────────
  //
  // THE DELIVERY'S HEADLINE INVARIANT, and NOTHING ELSE PINS IT. There is also
  // no manual fallback: production holds zero proposals in `pending` or
  // `changes_requested`, so the email branch cannot be reached by hand at all.
  //
  // The two gates a plausible implementation reaches for are both wrong and both
  // pass every other row in this file:
  //   - `status !== "draft"` fires on `pending`/`changes_requested` too, so the
  //     admins get an email AND a push for one message.
  //   - `!REVIEWABLE_BEFORE_WRITE.has(previousStatus)` looks precise and is the
  //     same bug: that set IS `{pending, changes_requested}`, so its negation
  //     includes `draft`, which must stay silent.
  // The gate is `status === "approved"`, nothing else.
  for (const status of ["pending", "changes_requested"] as const) {
    it(`emails and does NOT push on ${status}`, async () => {
      seed({ status });
      const res = await postLead({ body: "una nota" });
      expect(res.status).toBe(200);
      expect(queueLeadNotesNoticeMock).toHaveBeenCalledTimes(1);
      expect(sendPushMock).not.toHaveBeenCalled();
    });
  }

  it("pushes and does NOT queue an email on approved", async () => {
    seed({ status: "approved" });
    const res = await postLead({ body: "una nota" });
    expect(res.status).toBe(200);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    // The outbox gate lives INSIDE `queueLeadNotesNotice`, which this suite
    // mocks — so the route calls it unconditionally and the early return is not
    // observable here. What IS observable is the status it was handed, and
    // `serviceMutationSideEffects.test.ts` pins that this exact value queues
    // nothing. The XOR is proved by the two suites composed, never by one.
    expect(queueLeadNotesNoticeMock.mock.calls[0][0]).toMatchObject({
      previousStatus: "approved",
    });
  });

  it("defers the push into after() — it does not race the response", async () => {
    // The reason this matters is specific to `approved`: on that status
    // `queueLeadNotesNotice` returns on its gate BEFORE registering its own
    // `after()`, so this push is the ONLY deferred work the handler has. Fired
    // inline it would be an unawaited promise with nothing holding the
    // invocation open, and a killed one means a stored message that notified
    // nobody, with no log and no outbox row to show for it.
    seed({ status: "approved" });
    const res = await postLeadRaw({ body: "una nota" });
    expect(res.status).toBe(200);
    // The response is written and the push has NOT happened yet.
    expect(sendPushMock).not.toHaveBeenCalled();
    await drainAfter();
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });

  it("pushes the ADMINS, on the admin surface, with the author's name and the service date", async () => {
    seed({ status: "approved" });
    await postLead({ body: "una nota" });
    const [recipients, pref, payload] = sendPushMock.mock.calls[0] as [
      string[],
      string,
      { title: string; body: string; path: string },
    ];
    expect(recipients).toEqual(["adm-1", "adm-2"]);
    expect(pref).toBe("proposals");
    expect(payload.title).toBe("Nuevo mensaje");
    // `/admin`, not `/me` — `notifyProposalReview` hardcodes the LEAD's surface,
    // which is why that helper is not used for this audience.
    expect(payload.path).toBe("/admin");
    expect(payload.body).toContain("Ana");
    // Rendered at LOCAL NOON. WEEK is 2099-09-06; a bare `new Date(iso)` in
    // America/Mexico_City renders the 5th.
    expect(payload.body).toContain("6 sep");
  });

  it("falls back to a nameless body rather than interpolating nothing", async () => {
    // A session with neither alias nor name — an impersonated or name-less
    // member. The message HAS committed, so the push must still fire, and
    // "undefined escribió" is worse than no name at all.
    seed({ status: "approved" });
    requireMinistryMemberMock.mockResolvedValue({
      user: { sanityId: "mem-1", role: "member" },
    });
    await postLead({ body: "una nota" });
    const payload = sendPushMock.mock.calls[0][2] as { body: string };
    expect(payload.body).not.toContain("undefined");
    expect(payload.body).toContain("mensaje nuevo");
  });

  it("excludes the author from the admin push — a lead who is also an admin", async () => {
    seed({ status: "approved" });
    store.admins = ["mem-1", "adm-2"];
    await postLead({ body: "una nota" });
    expect(sendPushMock.mock.calls[0][0]).toEqual(["adm-2"]);
  });

  it("pushes nothing at all when the author is the only admin", async () => {
    seed({ status: "approved" });
    store.admins = ["mem-1"];
    await postLead({ body: "una nota" });
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("a message on a DRAFT proposal notifies nobody, in either channel", async () => {
    // A draft is not in front of admins yet. This is the row both wrong gates
    // above would fail.
    seed({ status: "draft" });
    const res = await postLead({ body: "una nota" });
    expect(res.status).toBe(200);
    expect(sendPushMock).not.toHaveBeenCalled();
    // Same composition as the `approved` row: the helper is handed `draft` and
    // declines, which its own suite pins.
    expect(queueLeadNotesNoticeMock.mock.calls[0][0]).toMatchObject({
      previousStatus: "draft",
    });
  });

  it("counts only LEAD notes into the snapshot, never the whole thread", async () => {
    // The twin of the row above, stated as the zero case: an admin's change
    // request alone leaves the count at 0, so the first lead reply is `slice(0)`
    // and reaches admins. Counting the array would make it `slice(1)` — empty.
    seed({
      status: "changes_requested",
      messages: [
        { _key: "m1", kind: "admin_change_request", body: "cambia el cierre", author: "adm-1" },
      ],
    });
    await postLead({ body: "listo" });
    expect(queueLeadNotesNoticeMock.mock.calls[0][0]).toMatchObject({ beforeMessageCount: 0 });
  });

  it("returns the full thread with author names, plus observedRev", async () => {
    seed({ messages: [{ _key: "old", kind: "lead_note", body: "previa", author: "mem-1" }] });
    const res = await postLead({ body: "segunda" });
    const data = (await res.json()) as {
      messages: { body: string; author_name: string | null }[];
      observedRev: string;
      rev: string;
    };
    expect(data.messages.map((m) => m.body)).toEqual(["previa", "segunda"]);
    expect(data.messages.every((m) => m.author_name === "Ana")).toBe(true);
    // The revision read BEFORE the append — not the fresh one, which this very
    // append always moves.
    expect(data.observedRev).toBe("prop-rev-1");
    expect(data.rev).not.toBe("prop-rev-1");
  });

  it("refuses an empty or whitespace-only body, and commits nothing", async () => {
    seed();
    for (const body of ["", "   ", "\n\t"]) {
      const res = await postLead({ body });
      expect(res.status).toBe(400);
    }
    expect(committed()).toHaveLength(0);
    expect(queueLeadNotesNoticeMock).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not a Lead on the service", async () => {
    seed();
    requireMinistryMemberMock.mockResolvedValue({ user: { sanityId: "other", role: "member" } });
    const res = await postLead({ body: "hola" });
    expect(res.status).toBe(403);
    expect(committed()).toHaveLength(0);
  });

  it("refuses a draft-service proposal — both halves of the member gate", async () => {
    store.roles.push(sundayRole({ published: false }));
    store.proposals.push(proposal());
    const res = await postLead({ body: "hola" });
    expect(res.status).toBe(403);
    expect(committed()).toHaveLength(0);
  });

  it("refuses when the SERVICE has passed, not when the proposal is approved", async () => {
    // Approved but still upcoming: the thread stays OPEN. This is the decision
    // that makes the feature a conversation rather than a review artefact.
    seed({ status: "approved" });
    expect((await postLead({ body: "sigue abierto" })).status).toBe(200);

    // Past service: closed, server-side.
    patches.length = 0;
    store.proposals = [proposal({ service_date: "2020-01-05" })];
    store.roles = [sundayRole({ week: "2020-01-05" })];
    const closed = await postLead({ body: "tarde" });
    expect(closed.status).toBe(400);
    expect(committed()).toHaveLength(0);
  });

  it("fails CLOSED on an unusable service date — at the canonical loader, not the thread gate", async () => {
    seed({ service_date: "not-a-date" });
    const res = await postLead({ body: "hola" });
    // 409 `integrity_conflict`, not 400: `loadCanonicalProposal` validates the
    // stored document and rejects the date BEFORE `isThreadOpen` is reached, so
    // the thread gate's own fail-closed branch is unreachable from this route.
    // Both refuse the write; only one of them is the layer that acts. Asserted
    // as it actually behaves rather than as the plan's prose reads, because a
    // test that pinned 400 would be pinning a code path nothing takes.
    expect(res.status).toBe(409);
    expect(committed()).toHaveLength(0);
  });

  it("refuses once the thread is full, without committing", async () => {
    const full = Array.from({ length: PROPOSAL_MESSAGES_MAX }, (_, i) => ({
      _key: `k${i}`,
      kind: "lead_note",
      body: `m${i}`,
    }));
    seed({ messages: full });
    const res = await postLead({ body: "una más" });
    expect(res.status).toBe(400);
    expect(committed()).toHaveLength(0);
  });

  it("reports SUCCESS when the post-commit read-back fails", async () => {
    seed();
    // The write already committed. Throwing here would report a landed message
    // as a failure, and the obvious retry mints a permanent duplicate — this
    // delivery ships no delete path.
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("author_name")) throw new Error("content lake timeout");
      return canonicalRead(q, p);
    });
    const res = await postLead({ body: "sí llegó" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; messages: unknown };
    expect(data.ok).toBe(true);
    // `null`, not `[]`: the client must keep the thread it is rendering rather
    // than blanking it. An empty array is a real state and means something else.
    expect(data.messages).toBeNull();
    expect(committed()).toHaveLength(1);
  });

  it("maps a Sanity write conflict onto a registered code", async () => {
    seed();
    commitOutcomes.push(conflictError());
    const res = await postLead({ body: "hola" });
    expect(res.status).toBe(409);
    expect(queueLeadNotesNoticeMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/proposals/[id]/messages — the admin side", () => {
  it("pushes the LEAD with NEW copy — not the change-request alarm", async () => {
    // The other half of the conversation. Before Child B a standalone admin
    // message notified nobody at all.
    //
    // ASSERT THE COPY, not just the call. Reusing `REVIEW_PUSH.request_changes`
    // would push "Cambios solicitados — Revisaron la propuesta y pidieron
    // cambios" when an admin merely asked a question, and no other row here
    // would notice.
    seed();
    const res = await postAdmin({ body: "¿Podemos cerrar más lento?" });
    expect(res.status).toBe(200);
    const [recipients, pref, payload] = sendPushMock.mock.calls[0] as [
      string[],
      string,
      { title: string; body: string; path: string },
    ];
    // `doc.lead` plus contributors — the LEAD's audience, resolved by
    // `notifyProposalReview` itself rather than by this route.
    expect(recipients).toEqual(["mem-1"]);
    expect(pref).toBe("proposals");
    expect(payload.title).toBe("Nuevo mensaje");
    expect(payload.title).not.toBe("Cambios solicitados");
    expect(payload.body).not.toContain("pidieron cambios");
  });

  it("excludes the posting admin, and does so BEFORE the empty-audience guard", async () => {
    // THE ONE CASE that distinguishes filter-before-guard from
    // filter-after-guard: the posting admin is the proposal's ONLY review
    // recipient. A filter placed after the guard is a no-op precisely here, and
    // the proposal's lead would be pushed about their own message.
    //
    // The lead→admin row's "author is also an admin" case cannot catch this — it
    // exercises the route-side filter on the other direction.
    seed({ lead: "adm-1", contributors: [] });
    requireActiveManagerMock.mockResolvedValue({
      user: { role: "admin", sanityId: "adm-1" },
    });
    const res = await postAdmin({ body: "una pregunta" });
    expect(res.status).toBe(200);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("still pushes the OTHER recipients when the author is one of them", async () => {
    // The complement of the row above: excluding the author must not empty an
    // audience that has somebody else in it.
    seed({ lead: "adm-1", contributors: [{ _key: "c1", person: "mem-1" }] });
    requireActiveManagerMock.mockResolvedValue({
      user: { role: "admin", sanityId: "adm-1" },
    });
    await postAdmin({ body: "una pregunta" });
    expect(sendPushMock.mock.calls[0][0]).toEqual(["mem-1"]);
  });

  it("appends an admin_change_request and does NOT touch admin_notes", async () => {
    seed({ admin_notes: "el archivo de la petición de cambios" });
    const res = await postAdmin({ body: "¿Podemos cerrar más lento?" });
    expect(res.status).toBe(200);

    const p = committed()[0];
    expect((p.appended.messages as Record<string, unknown>[])[0]).toMatchObject({
      kind: "admin_change_request",
      author_role: "admin",
      author: { _ref: "admin-1", _type: "reference" },
      body: "¿Podemos cerrar más lento?",
    });
    // The whole point: the change-request archive the rollback leans on is not
    // overwritten by ordinary chatter. Only the TRANSITION mirrors it.
    expect(p.set).toEqual({});
    expect(store.proposals[0].admin_notes).toBe("el archivo de la petición de cambios");
  });

  it("never mirrors lead_notes either", async () => {
    seed();
    await postAdmin({ body: "una pregunta" });
    expect(committed()[0].set).not.toHaveProperty("lead_notes");
    expect(store.proposals[0].lead_notes).toBe("Nota original");
  });

  it("queues NO email notice — the admin\u2192lead signal is a push, not the outbox", async () => {
    seed();
    await postAdmin({ body: "una pregunta" });
    expect(queueLeadNotesNoticeMock).not.toHaveBeenCalled();
  });

  it("calls setIfMissing before append, and asserts no revision", async () => {
    seed();
    await postAdmin({ body: "hola" });
    const { calls, revisionAsserted } = committed()[0];
    expect(calls.indexOf("setIfMissing")).toBeLessThan(calls.indexOf("append"));
    expect(revisionAsserted).toBeNull();
  });

  it("refuses a content-editor", async () => {
    seed();
    requireActiveManagerMock.mockResolvedValue({
      user: { role: "content-editor", sanityId: "ed-1" },
    });
    const res = await postAdmin({ body: "hola" });
    expect(res.status).toBe(403);
    expect(committed()).toHaveLength(0);
  });

  it("refuses a non-manager", async () => {
    seed();
    requireActiveManagerMock.mockResolvedValue(null);
    expect((await postAdmin({ body: "hola" })).status).toBe(403);
    expect(committed()).toHaveLength(0);
  });

  it("enforces the closed thread server-side, like the lead route", async () => {
    store.roles.push(sundayRole({ week: "2020-01-05" }));
    store.proposals.push(proposal({ service_date: "2020-01-05" }));
    expect((await postAdmin({ body: "tarde" })).status).toBe(400);
    expect(committed()).toHaveLength(0);
  });

  it("reports SUCCESS when the post-commit read-back fails, like the lead route", async () => {
    seed();
    operationalFetch.mockImplementation(async (q: string, p: Record<string, unknown> = {}) => {
      if (q.includes("author_name")) throw new Error("content lake timeout");
      return canonicalRead(q, p);
    });
    const res = await postAdmin({ body: "sí llegó" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; messages: unknown };
    expect(data.ok).toBe(true);
    expect(data.messages).toBeNull();
    expect(committed()).toHaveLength(1);
  });

  it("stores a message with no author when the session has no sanityId", async () => {
    seed();
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    await postAdmin({ body: "sin autor" });
    const [msg] = committed()[0].appended.messages as Record<string, unknown>[];
    // Two production `admin_notes` have nobody to attribute them to, so an
    // author-less message is a real state. §7 renders it from the ROLE.
    expect(msg).not.toHaveProperty("author");
    expect(msg.author_role).toBe("admin");
  });
});
