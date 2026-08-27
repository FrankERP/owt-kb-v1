/**
 * The `kind == "lead_note"` predicate exists twice — once in GROQ
 * (`LEAD_NOTE_MESSAGES`) for the flush side, once in JS (`isLeadNote`) for the
 * queue side — and the debounced admin email is correct only if they agree.
 *
 * These tests EXECUTE the fragment with groq-js rather than asserting on its
 * text, for the same reason `worshipAudienceScope.test.ts` does: the failures
 * that matter here are invisible to a string match.
 *
 * Two of them are worth naming, because both end in a silently dead
 * notification rather than a red test:
 *
 *  - **Narrowing the projection to `{body}`** while a consumer still filters on
 *    `kind`. Every element then lacks `kind`, the filter matches nothing, the
 *    appended slice is empty for every notice, and the email stops. Nothing in
 *    `outboxSweep.test.ts` notices, because its proposal read is routed to a
 *    hand-written literal that no assertion compares against the real query.
 *  - **The two copies drifting apart**, so the queue side counts a different
 *    set than the flush side slices. With `T` total messages and `L` lead notes,
 *    a queue side that counts the whole array makes `slice(T)` empty whenever
 *    the thread carries even one admin message — i.e. on precisely the
 *    proposals that have been through a review cycle.
 */
import { describe, it, expect } from "vitest";
import { evaluate, parse } from "groq-js";
import {
  LEAD_NOTE_MESSAGES,
  PROPOSAL_MESSAGE_KINDS,
  isLeadNote,
  type ProposalMessageKind,
} from "@/app/utils/proposalMessageWrite";
import {
  ADMIN_RECIPIENTS_QUERY,
  PROPOSAL_QUERY,
  SUBMITTED_NOTIFY_QUERY,
} from "@/app/utils/proposalNotifyQueries";

interface StoredMessage {
  _key: string;
  _type: "proposal_message";
  kind: ProposalMessageKind;
  body: string;
  author: { _ref: string };
  author_role: string;
  at: string;
}

const msg = (key: string, kind: ProposalMessageKind, body: string): StoredMessage => ({
  _key: key,
  _type: "proposal_message",
  kind,
  body,
  author: { _ref: "mem-1" },
  author_role: kind === "lead_note" ? "lead" : "admin",
  at: "2026-08-20T10:00:00.000Z",
});

/**
 * A thread of the shape a `changes_requested` proposal actually has: the lead
 * writes, an admin asks for changes, the lead answers. Mixed on purpose — an
 * all-`lead_note` fixture cannot tell a filtered read from an unfiltered one.
 */
const MIXED = [
  msg("a", "lead_note", "Bajé la tonalidad de Santo a D."),
  msg("b", "admin_change_request", "¿Podemos cerrar con algo más lento?"),
  msg("c", "lead_note", "Listo, cambié la última."),
  msg("d", "pastor_note", "Bendiciones."),
];

const PROPOSAL = {
  _id: "prop-1",
  _type: "setlistProposal",
  status: "changes_requested",
  service_date: "2026-09-06",
  lead_notes: "Bajé la tonalidad de Santo a D.",
  messages: MIXED,
};

async function run(query: string, dataset: unknown[], params: Record<string, unknown> = {}) {
  const value = await evaluate(parse(query), { dataset, params });
  return value.get();
}

const leadFragment = (proposal: unknown) =>
  run(`*[_type == "setlistProposal"][0]{ "leadMessages": ${LEAD_NOTE_MESSAGES} }`, [proposal]);

describe("LEAD_NOTE_MESSAGES", () => {
  it("selects the lead notes, in stored order, and nothing else", async () => {
    const row = (await leadFragment(PROPOSAL)) as { leadMessages: { body: string }[] };
    expect(row.leadMessages.map((m) => m.body)).toEqual([
      "Bajé la tonalidad de Santo a D.",
      "Listo, cambié la última.",
    ]);
  });

  it("projects `kind`, so a downstream filter still matches", async () => {
    const row = (await leadFragment(PROPOSAL)) as { leadMessages: Record<string, unknown>[] };
    // `every` alone is vacuously true on an empty array — which is exactly the
    // state a narrowed-to-`{body}` projection would leave a downstream filter
    // in. Pin the length first so this cannot pass by finding nothing.
    expect(row.leadMessages).toHaveLength(2);
    expect(row.leadMessages.every((m) => m.kind === "lead_note")).toBe(true);
  });

  it("narrows to {kind, body} — the sweep never pulls whole messages", async () => {
    const row = (await leadFragment(PROPOSAL)) as { leadMessages: Record<string, unknown>[] };
    expect(Object.keys(row.leadMessages[0]).sort()).toEqual(["body", "kind"]);
  });

  it("returns null — NOT [] — when the document has no messages at all", async () => {
    const row = (await leadFragment({
      _id: "prop-2",
      _type: "setlistProposal",
      status: "pending",
    })) as { leadMessages: unknown };
    // Consumers must coerce. `.slice()` on null throws; `.length` on null throws.
    expect(row.leadMessages).toBeNull();
  });

  it("returns [] for a stored-but-empty array, and for admin-only threads", async () => {
    const empty = (await leadFragment({
      _id: "p3", _type: "setlistProposal", messages: [],
    })) as { leadMessages: unknown };
    expect(empty.leadMessages).toEqual([]);

    const adminOnly = (await leadFragment({
      _id: "p4", _type: "setlistProposal", messages: [msg("x", "admin_change_request", "?")],
    })) as { leadMessages: unknown };
    expect(adminOnly.leadMessages).toEqual([]);
  });
});

describe("the GROQ and JS copies of the predicate agree", () => {
  it("selects the same bodies over the same mixed thread", async () => {
    const row = (await leadFragment(PROPOSAL)) as { leadMessages: { body: string }[] };
    const fromGroq = row.leadMessages.map((m) => m.body);
    const fromJs = MIXED.filter(isLeadNote).map((m) => m.body);

    // Bodies, not deep-equal: the GROQ side returns `{kind, body}` while the JS
    // side holds whole stored messages. The sequence is what both sides index.
    expect(fromGroq).toEqual(fromJs);
    expect(fromGroq).toHaveLength(2);
  });

  it("agrees on every kind in the vocabulary, one at a time", async () => {
    // Iterated from the exported list, never re-hardcoded: two suites each
    // pinning their own copy is the mistake this whole file exists to prevent,
    // and `pastor_note`/`system` are documented as reserved for future minting,
    // so a fifth kind is a foreseeable change that must not silently escape.
    expect(PROPOSAL_MESSAGE_KINDS.length).toBeGreaterThanOrEqual(4);
    for (const kind of PROPOSAL_MESSAGE_KINDS) {
      const one = msg("k", kind, `body-${kind}`);
      const row = (await leadFragment({
        _id: `p-${kind}`, _type: "setlistProposal", messages: [one],
      })) as { leadMessages: { body: string }[] };
      expect(row.leadMessages.map((m) => m.body)).toEqual(
        [one].filter(isLeadNote).map((m) => m.body),
      );
    }
  });

  it("agrees that a message with no `kind` is not a lead note", async () => {
    const malformed = { _key: "m", _type: "proposal_message", body: "sin kind" };
    const row = (await leadFragment({
      _id: "p-bad", _type: "setlistProposal", messages: [malformed],
    })) as { leadMessages: unknown[] };
    expect(row.leadMessages).toEqual([]);
    expect(isLeadNote(malformed)).toBe(false);
  });
});

describe("PROPOSAL_QUERY", () => {
  it("returns the fields the sweep reads, executed rather than assumed", async () => {
    const row = (await run(PROPOSAL_QUERY, [PROPOSAL], { proposalId: "prop-1" })) as Record<
      string,
      unknown
    >;
    // `outboxSweep.test.ts` routes this read to a hand-written literal; this is
    // the only place the real query is executed, so a projection change that
    // drops a field the classifier needs fails HERE or nowhere. No mocks are
    // needed to get here — that is why the queries live in a leaf.
    // `lead_notes` is GONE and `leadMessages` has replaced it: the sweep reads
    // the thread, the legacy-tolerance branch included. Pinned as an exact key
    // set so re-adding the field — or dropping `status`/`service_date`, which
    // the classifier and the live-date-wins rule need — fails here.
    expect(Object.keys(row).sort()).toEqual(["_id", "leadMessages", "service_date", "status"]);
    expect(row.status).toBe("changes_requested");
    expect(row.service_date).toBe("2026-09-06");
    // Pre-filtered by the ONE fragment, and narrowed. A consumer re-filtering
    // this array is what §The projection forbids; the shape is what makes the
    // ban safe to state.
    expect(row.leadMessages).toEqual(
      MIXED.filter((m) => m.kind === "lead_note").map((m) => ({ kind: m.kind, body: m.body })),
    );
  });

  it("selects by id and yields null for an unknown proposal", async () => {
    const row = await run(PROPOSAL_QUERY, [PROPOSAL], { proposalId: "nope" });
    expect(row).toBeNull();
  });
});

describe("ADMIN_RECIPIENTS_QUERY", () => {
  const MEMBERS = [
    { _id: "sa", _type: "teamMembers", role: "super-admin" },
    { _id: "ad", _type: "teamMembers", role: "admin" },
    { _id: "ed", _type: "teamMembers", role: "content-editor" },
    { _id: "me", _type: "teamMembers", role: "member" },
    { _id: "none", _type: "teamMembers" },
  ];

  it("selects super-admins and admins, and nobody else", async () => {
    const ids = (await run(ADMIN_RECIPIENTS_QUERY, MEMBERS)) as string[];
    expect([...ids].sort()).toEqual(["ad", "sa"]);
  });
});

describe("SUBMITTED_NOTIFY_QUERY", () => {
  it("resolves the audience, the lead name and the proposal in one read", async () => {
    const dataset = [
      PROPOSAL,
      { _id: "lead-1", _type: "teamMembers", role: "member", alias: "Fran", member_name: "Francisco" },
      { _id: "ad", _type: "teamMembers", role: "admin" },
    ];
    const row = (await run(SUBMITTED_NOTIFY_QUERY, dataset, {
      leadId: "lead-1",
      proposalId: "prop-1",
    })) as Record<string, unknown>;

    expect(row.admins).toEqual(["ad"]);
    expect(row.lead).toEqual({ alias: "Fran", member_name: "Francisco" });
    // Still `lead_notes`: this phase changes no behaviour. When Child B
    // repoints the body at the thread, THIS assertion is what shows it moved.
    // `songs` comes back as an explicit null rather than being omitted — GROQ
    // projects a requested-but-absent field, which is why every consumer of
    // these rows coerces instead of checking `in`.
    expect(row.proposal).toEqual({
      lead_notes: "Bajé la tonalidad de Santo a D.",
      songs: null,
    });
  });

  it("resolves the SAME admin set as the sweep's own audience query", async () => {
    // The real check: the two queries select the same PEOPLE. A textual
    // containment assertion cannot do that, which is why it is not the primary
    // one here (there is a narrower use for it at the end of this test).
    const dataset = [
      PROPOSAL,
      { _id: "sa", _type: "teamMembers", role: "super-admin" },
      { _id: "ad", _type: "teamMembers", role: "admin" },
      { _id: "ed", _type: "teamMembers", role: "content-editor" },
    ];
    const row = (await run(SUBMITTED_NOTIFY_QUERY, dataset, {
      leadId: "lead-1",
      proposalId: "prop-1",
    })) as { admins: string[] };
    const sweepAudience = (await run(ADMIN_RECIPIENTS_QUERY, dataset)) as string[];
    expect([...row.admins].sort()).toEqual([...sweepAudience].sort());
    expect([...row.admins].sort()).toEqual(["ad", "sa"]);

    // A textual tripwire for the divergences this fixture's three roles CANNOT
    // express — a ministry or active-member filter added to one query and not
    // the other (the gap tracked as FrankERP/owt-kb-v1#8), or a role nobody
    // seeded here. It does NOT prove the two are one definition: a
    // byte-identical literal pasted in place of the interpolation passes it.
    expect(SUBMITTED_NOTIFY_QUERY).toContain(ADMIN_RECIPIENTS_QUERY);
  });
});
