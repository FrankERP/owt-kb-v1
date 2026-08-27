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
}
let store: Store;

/** A FUTURE service date: `isThreadOpen` is a real guard on both routes, and a
 *  past date closes the thread. The suite runs pinned to America/Mexico_City. */
const WEEK = "2099-09-06";
const ROLE_ID = "role-1";
const PROPOSAL_ID = "setlistProposal.role-1";
const LEAD = { user: { sanityId: "mem-1", role: "member" } };
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

const postLead = (body: unknown, id = PROPOSAL_ID) =>
  leadPost(req(body), { params: Promise.resolve({ id }) });
const postAdmin = (body: unknown, id = PROPOSAL_ID) =>
  adminPost(req(body), { params: Promise.resolve({ id }) });

function seed(over: Record<string, unknown> = {}) {
  store.roles.push(sundayRole());
  store.proposals.push(proposal(over));
}

beforeEach(() => {
  vi.clearAllMocks();
  patches.length = 0;
  commitOutcomes.length = 0;
  store = { roles: [], proposals: [], rawRoleDrafts: [], rawProposalDrafts: [] };
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

  it("queues NO notice — an admin message notifies nobody in this delivery", async () => {
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
