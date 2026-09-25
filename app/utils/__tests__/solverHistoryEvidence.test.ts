// R11's diff evidence (spec `2026-09-23-solver-history-derivation-design.md`,
// plan `2026-09-25-owt-mcp-p2-solver-history.md` step 3).
//
// The POSITIVE CONTROL is the first block: a create payload goes through the
// create route's own path — `draftCreateBody` → `parseCreateRequest` →
// `buildCreationReceipt` + `buildRoleDocument` — then through the real
// `ROLE_PROJECTION` text, and the payload rebuilt from that stored row must
// reproduce the stamped fingerprint. Without it a rebuild defect would read
// every document as changed and quietly turn every would-be `bug` into
// `unverified`. No document here is hand-built except the legacy one that
// represents a service created before the guarded route existed.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { draftCreateBody, type CreatableDraft } from "@/app/utils/monthDraftCreate";
import { buildCreationReceipt, payloadFingerprint } from "@/app/utils/roleCreationReceipt";
import { buildRoleDocument, parseCreateRequest } from "@/app/utils/roleWriteRequest";
import { ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION, ROLE_PROJECTION } from "@/app/utils/serviceReadQueries";
import {
  deriveSolverHistory,
  indexMembersById,
  roleSeatContributions,
  type SolverHistoryMember,
} from "@/app/utils/solverHistory";
import {
  buildSolverHistoryEvidence,
  documentEvidence,
  outOfWindowReceiptRoleIds,
  storedRoleCreatePayload,
} from "@/app/utils/solverHistoryEvidence";

import { projectRow } from "./__fixtures__/roleProjectionReader";

// Fake names only: this repository is public.
const MEMBERS: SolverHistoryMember[] = [
  { _id: "m-ana", member_name: "Ana Prueba" },
  { _id: "m-beto", member_name: "Beto Ensayo" },
  { _id: "m-caro", member_name: "Caro Muestra" },
  { _id: "m-dani", member_name: "Dani Ficticio" },
  { _id: "m-eli", member_name: "Eli Simulada" },
  { _id: "m-fer", member_name: "Fer Ejemplo" },
];
const MEMBERS_BY_ID = indexMembersById(MEMBERS);
const CTX = { membersById: MEMBERS_BY_ID, duplicateTarget: false };

type Row = Record<string, unknown>;

let seq = 0;
function creatable(over: Partial<CreatableDraft> & Pick<CreatableDraft, "_type" | "date">): CreatableDraft {
  seq += 1;
  return {
    localId: `local-${seq}`,
    creationRequestId: `req-evidence-${String(seq).padStart(4, "0")}`,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
}

let keySeq = 0;
const nextKey = () => `key-${++keySeq}`;

/**
 * The create route's own path (`app/api/admin/roles/route.ts`): the body is
 * parsed, the receipt is built from the body, the document from the parse —
 * then both are projected the way the loader reads them.
 */
function createThroughRoute(draft: CreatableDraft, published: boolean, createdAt = "2026-09-01T12:00:00.000Z") {
  const body = draftCreateBody(draft, published);
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) throw new Error(`fixture ${draft.localId} failed to parse: ${parsed.issues.join(", ")}`);
  const v = parsed.value;
  const roleId = `role-${draft.localId}`;
  const receipt = buildCreationReceipt({ requestId: v.requestId, payload: body, roleId, now: createdAt });
  if (!receipt) throw new Error(`fixture ${draft.localId} built no receipt`);
  const doc = buildRoleDocument({
    roleId,
    roleType: v.roleType,
    date: v.date,
    serviceName: v.serviceName,
    time: v.time,
    format: v.format,
    published: v.published,
    seats: v.seats,
    receiptId: v.receiptId,
    fingerprint: v.fingerprint,
    nextKey,
  });
  return {
    fingerprint: v.fingerprint,
    // The Content Lake adds the system revision on commit.
    row: projectRow({ ...doc, _rev: `rev-${draft.localId}` }, ROLE_PROJECTION) as Row,
    receipt: projectRow({ ...receipt, _rev: `rev-receipt-${draft.localId}` }, ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION) as Row,
  };
}

/** Every seat kind; labels with odd whitespace; a member seated twice in one seat. */
function fullDraft(type: "sunday_role" | "saturday_role", date: string): CreatableDraft {
  return creatable({
    _type: type,
    date,
    leads: ["m-ana"],
    bgvs: ["m-beto", "m-beto"],
    chorus: ["m-caro", "m-dani"],
    instruments: [
      { instrument: "  Bajo   eléctrico ", personId: "m-eli" },
      { instrument: "Batería", personId: "m-ana" },
    ],
    foh: [{ role: " Audio  ", personId: "m-dani" }],
  });
}

const seat = (row: Row, path: string) => row[path] as Row[];

// ─── The positive control ────────────────────────────────────────────────────

describe("the positive control — a stored document rebuilds to its creation fingerprint", () => {
  const matrix = [
    { type: "sunday_role" as const, date: "2026-09-06", published: false },
    { type: "sunday_role" as const, date: "2026-09-13", published: true },
    { type: "saturday_role" as const, date: "2026-09-12", published: false },
    { type: "saturday_role" as const, date: "2026-09-19", published: true },
  ];

  it.each(matrix)("$type created with published=$published: the round trip reproduces the parsed fingerprint", ({ type, date, published }) => {
    const { fingerprint, row } = createThroughRoute(fullDraft(type, date), published);

    // The matrix really exercises what it claims: labels were normalized on the
    // way in, the duplicate reference was stored twice, and the row is the
    // read's shape (a weekend role projects `date: null`).
    expect(seat(row, "instruments").map((s) => s.instrument)).toEqual(["Bajo eléctrico", "Batería"]);
    expect(seat(row, "foh_team").map((s) => s.role)).toEqual(["Audio"]);
    expect(seat(row, "BGVs").map((s) => s._ref)).toEqual(["m-beto", "m-beto"]);
    expect(row).toMatchObject({ _type: type, week: date, date: null, service_name: null, published });

    expect(payloadFingerprint(storedRoleCreatePayload(row, published))).toBe(fingerprint);
    // …and only under the creation-time flag: `published` is hashed.
    expect(payloadFingerprint(storedRoleCreatePayload(row, !published))).not.toBe(fingerprint);
  });

  it.each(matrix)("$type created with published=$published: documentEvidence reads it unchanged, as created", ({ type, date, published }) => {
    const { row, receipt } = createThroughRoute(fullDraft(type, date), published);
    const ev = documentEvidence(row, [receipt], CTX);
    expect(ev).toMatchObject({
      roleId: row._id,
      type,
      day: date,
      publishedRaw: published,
      receipt: { status: "found", receiptId: receipt._id, state: "committed", targetDay: date, createdAt: "2026-09-01T12:00:00.000Z" },
      unchangedAs: published ? "published" : "draft",
      emptySeatCreate: false,
      excluded: null,
    });
  });

  it("rebuilds the payload the create route was sent, seat for seat", () => {
    const { row } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    expect(storedRoleCreatePayload(row, false)).toEqual({
      _type: "sunday_role",
      date: "2026-09-06",
      leads: ["m-ana"],
      bgvs: ["m-beto", "m-beto"],
      chorus: ["m-caro", "m-dani"],
      instruments: [
        { instrument: "Bajo eléctrico", personId: "m-eli" },
        { instrument: "Batería", personId: "m-ana" },
      ],
      foh: [{ role: "Audio", personId: "m-dani" }],
      published: false,
    });
  });

  it("a document published after it was created as a draft still matches — through published=false", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const publishedLater = { ...row, published: true };
    const ev = documentEvidence(publishedLater, [receipt], CTX);
    expect(ev?.publishedRaw).toBe(true);
    expect(ev?.unchangedAs).toBe("draft");
  });

  it("a reorder of a seat is not a change (the fingerprint is a multiset)", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), true);
    const reordered = { ...row, Chorus: [...seat(row, "Chorus")].reverse(), instruments: [...seat(row, "instruments")].reverse() };
    expect(documentEvidence(reordered, [receipt], CTX)?.unchangedAs).toBe("published");
  });

  it("a swapped seat does not match", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const lead = seat(row, "Lead");
    // The swap route replaces a seat's person — here Ana leaves Lead for Fer.
    const swapped = { ...row, Lead: [{ ...lead[0], _ref: "m-fer" }] };
    expect(documentEvidence(swapped, [receipt], CTX)?.unchangedAs).toBeNull();
    // Two members exchanging seats keeps the same people, and still does not match.
    const bgv = seat(row, "BGVs");
    const exchanged = { ...row, Lead: [{ ...lead[0], _ref: "m-beto" }], BGVs: [{ ...bgv[0], _ref: "m-ana" }, bgv[1]] };
    expect(documentEvidence(exchanged, [receipt], CTX)?.unchangedAs).toBeNull();
    // An instrument seat handed to someone else does not match either.
    const inst = seat(row, "instruments");
    const reassigned = { ...row, instruments: [{ ...inst[0], person: { _type: "reference", _ref: "m-fer" } }, inst[1]] };
    expect(documentEvidence(reassigned, [receipt], CTX)?.unchangedAs).toBeNull();
  });

  it("a document moved to another day does not match", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const ev = documentEvidence({ ...row, week: "2026-09-13" }, [receipt], CTX);
    expect(ev?.unchangedAs).toBeNull();
    expect(ev?.day).toBe("2026-09-13");
    expect(ev?.receipt).toMatchObject({ status: "found", targetDay: "2026-09-06" });
  });
});

// ─── Empty-seat creates («+ Nuevo servicio») ─────────────────────────────────

describe("emptySeatCreate — stored mode's «+ Nuevo servicio» body", () => {
  it.each([false, true])("an all-empty create body (published=%s) is detected", (published) => {
    const { row, receipt } = createThroughRoute(creatable({ _type: "saturday_role", date: "2026-10-03" }), published);
    const ev = documentEvidence(row, [receipt], CTX);
    expect(ev?.emptySeatCreate).toBe(true);
    expect(ev?.unchangedAs).toBe(published ? "published" : "draft");
  });

  it("stays detected after the seats are filled in — the receipt records how it was CREATED", () => {
    const { row, receipt } = createThroughRoute(creatable({ _type: "sunday_role", date: "2026-10-04" }), false);
    const filled = { ...row, Lead: [{ _key: "k1", _type: "reference", _ref: "m-ana" }] };
    const ev = documentEvidence(filled, [receipt], CTX);
    expect(ev?.emptySeatCreate).toBe(true);
    expect(ev?.unchangedAs).toBeNull();
    expect(ev?.contributes).toEqual({ "Ana Prueba": { "Sun.Lead": 1 } });
  });

  it("a create with any seat is not an empty-seat create", () => {
    const { row, receipt } = createThroughRoute(creatable({ _type: "sunday_role", date: "2026-10-04", foh: [{ role: "Audio", personId: "m-ana" }] }), false);
    expect(documentEvidence(row, [receipt], CTX)?.emptySeatCreate).toBe(false);
  });

  it("is never claimed without a found receipt (rule 4 admits that arm only on one)", () => {
    const { row } = createThroughRoute(creatable({ _type: "sunday_role", date: "2026-10-04" }), false);
    const ev = documentEvidence(row, [], CTX);
    expect(ev?.receipt).toEqual({ status: "not_found", receiptId: row.creationReceiptId });
    expect(ev?.emptySeatCreate).toBe(false);
    // The document's own stamp still proves it unchanged.
    expect(ev?.unchangedAs).toBe("draft");
  });
});

// ─── Receipt matching ────────────────────────────────────────────────────────

describe("documentEvidence — the receipt link", () => {
  it("matches a receipt by its own roleId, never another role's", () => {
    const a = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const b = createThroughRoute(fullDraft("sunday_role", "2026-09-13"), false);
    expect(documentEvidence(a.row, [b.receipt], CTX)?.receipt).toEqual({ status: "not_found", receiptId: a.row.creationReceiptId });
    expect(documentEvidence(a.row, [b.receipt, a.receipt], CTX)?.receipt).toMatchObject({ status: "found", receiptId: a.receipt._id });
  });

  it("compares against the FOUND receipt's fingerprint, not the document's own stamp", () => {
    // The receipt is immutable; the stamp on the document is an ordinary field
    // (Studio can edit it). A document swapped and re-stamped to match its new
    // seats is still changed since creation.
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const swapped = { ...row, Lead: [{ ...seat(row, "Lead")[0], _ref: "m-fer" }] };
    const restamped = { ...swapped, creationFingerprint: payloadFingerprint(storedRoleCreatePayload(swapped, false)) };
    expect(documentEvidence(restamped, [], CTX)?.unchangedAs).toBe("draft");
    expect(documentEvidence(restamped, [receipt], CTX)?.unchangedAs).toBeNull();
  });

  it("with several receipts naming the role, takes the one the role records — or none", () => {
    const a = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const impostor = { ...a.receipt, _id: "roleCreate.other", fingerprint: "f".repeat(64) };
    expect(documentEvidence(a.row, [impostor, a.receipt], CTX)?.receipt).toMatchObject({ status: "found", receiptId: a.receipt._id });
    // A role that records a receipt id no receipt carries is not matched to a stranger.
    expect(documentEvidence(a.row, [impostor], CTX)?.receipt).toEqual({ status: "not_found", receiptId: a.row.creationReceiptId });
  });

  it("a legacy document with no stamp and no receipt is `unstamped` — rule 4's «no receipt» arm", () => {
    // Created before the guarded create route (2026-07-24): no creationReceiptId,
    // no creationFingerprint. Hand-built because no current path writes one.
    const legacy: Row = {
      _id: "legacy-1",
      _type: "sunday_role",
      week: "2026-09-20",
      published: null,
      creationReceiptId: null,
      creationFingerprint: null,
      Lead: [{ _key: "a", _type: "reference", _ref: "m-ana" }],
      BGVs: null,
      Chorus: null,
      instruments: null,
      foh_team: null,
    };
    expect(documentEvidence(legacy, [], CTX)).toMatchObject({
      receipt: { status: "unstamped" },
      unchangedAs: null,
      emptySeatCreate: false,
      publishedRaw: null,
      contributes: { "Ana Prueba": { "Sun.Lead": 1 } },
    });
  });

  it("an unstamped role that receipts nonetheless name ambiguously is `not_found`, never `unstamped`", () => {
    const a = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const unstampedRow = { ...a.row, creationReceiptId: null, creationFingerprint: null };
    const second = { ...a.receipt, _id: "roleCreate.second" };
    expect(documentEvidence(unstampedRow, [a.receipt, second], CTX)?.receipt).toEqual({ status: "not_found", receiptId: null });
    // Exactly one receipt naming it is a match, stamp or not.
    expect(documentEvidence(unstampedRow, [a.receipt], CTX)?.receipt).toMatchObject({ status: "found" });
  });

  it("ignores a row that is not a weekend role document", () => {
    const special = { _id: "sp-1", _type: "special_role", date: "2026-09-16", service_name: "Noche de prueba" };
    expect(documentEvidence(special, [], CTX)).toBeNull();
    expect(documentEvidence(null, [], CTX)).toBeNull();
    expect(documentEvidence({ _type: "sunday_role", week: "2026-09-06" }, [], CTX)).toBeNull();
  });
});

// ─── contributes: one counting rule (ruling P2-R1) ───────────────────────────

describe("contributes — the derivation's own seat rule", () => {
  it("equals roleSeatContributions for a counted document", () => {
    const { row, receipt } = createThroughRoute(fullDraft("saturday_role", "2026-09-12"), false);
    const ev = documentEvidence(row, [receipt], CTX);
    expect(ev?.contributes).toEqual(roleSeatContributions(row, MEMBERS_BY_ID).role_counts);
    // Saturday Chorus, instruments and FOH never count; the duplicate BGV counts twice.
    expect(ev?.contributes).toEqual({ "Ana Prueba": { "Sat.Lead": 1 }, "Beto Ensayo": { "Sat.BGV": 2 } });
  });

  it("a duplicate-target copy is excluded and contributes NOTHING — entries count neither copy", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const ev = documentEvidence(row, [receipt], { membersById: MEMBERS_BY_ID, duplicateTarget: true });
    expect(ev?.excluded).toBe("duplicate_target");
    expect(ev?.contributes).toEqual({});
    // The rest of its evidence is still reported.
    expect(ev?.unchangedAs).toBe("draft");
  });

  it("a document whose week is not a valid day is excluded and contributes nothing", () => {
    const { row, receipt } = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false);
    const ev = documentEvidence({ ...row, week: "2026-09-31" }, [receipt], CTX);
    expect(ev).toMatchObject({ day: null, excluded: "invalid_date", contributes: {} });
  });
});

// ─── The whole evidence object ───────────────────────────────────────────────

describe("buildSolverHistoryEvidence", () => {
  const TARGET = { year: 2026, month: 11 };

  function scenario() {
    seq = 0;
    const aug = createThroughRoute(fullDraft("sunday_role", "2026-08-02"), false, "2026-07-30T10:00:00.000Z");
    const sepSat = createThroughRoute(fullDraft("saturday_role", "2026-09-12"), true, "2026-08-28T10:00:00.000Z");
    // A duplicate weekend target in October: two Sundays on one day.
    const dupA = createThroughRoute(fullDraft("sunday_role", "2026-10-04"), false, "2026-09-28T10:00:00.000Z");
    const dupB = createThroughRoute(creatable({ _type: "sunday_role", date: "2026-10-04", leads: ["m-fer"] }), false, "2026-09-28T10:05:00.000Z");
    // Swapped since creation.
    const octSat = createThroughRoute(fullDraft("saturday_role", "2026-10-31"), false, "2026-09-28T10:10:00.000Z");
    const octSatSwapped = { ...octSat.row, Lead: [{ _key: "s", _type: "reference", _ref: "m-caro" }] };
    // Created in the window, then moved to the target month.
    const movedOut = createThroughRoute(fullDraft("sunday_role", "2026-10-11"), false, "2026-09-28T10:15:00.000Z");
    const movedOutNow = { ...movedOut.row, week: "2026-11-08" };
    // Created in the window, since deleted: its receipt is retired.
    const deleted = createThroughRoute(fullDraft("sunday_role", "2026-09-20"), false, "2026-08-28T10:05:00.000Z");
    const deletedReceipt = { ...deleted.receipt, state: "role_deleted", updatedAt: "2026-09-01T00:00:00.000Z" };
    // Created before the window, since moved INTO it.
    const movedIn = createThroughRoute(fullDraft("saturday_role", "2026-07-25"), false, "2026-07-01T10:00:00.000Z");
    const movedInNow = { ...movedIn.row, week: "2026-08-08" };
    // A receipt for a service outside the window: never surfaced.
    const outside = createThroughRoute(fullDraft("sunday_role", "2026-11-15"), false, "2026-10-20T10:00:00.000Z");
    // Its stored week is not a calendar day (the bounded read still returns it):
    // a window document, excluded, still linked to its receipt — never "deleted".
    const badWeek = createThroughRoute(fullDraft("sunday_role", "2026-09-06"), false, "2026-08-28T10:15:00.000Z");
    const badWeekNow = { ...badWeek.row, week: "2026-09-31" };
    // Stamped, but its receipt is not among those read: unchanged by its own
    // stamp, yet no found receipt — it must not count toward the control.
    const stampedOnly = createThroughRoute(fullDraft("saturday_role", "2026-09-26"), false, "2026-08-28T10:10:00.000Z");
    // A legacy, unstamped document.
    const legacy: Row = { _id: "legacy-1", _type: "sunday_role", week: "2026-09-27", published: null, creationReceiptId: null, creationFingerprint: null, Lead: [{ _key: "l", _type: "reference", _ref: "m-eli" }], BGVs: null, Chorus: null, instruments: null, foh_team: null };

    const roles = [aug.row, sepSat.row, dupA.row, dupB.row, octSatSwapped, legacy, movedInNow, stampedOnly.row, badWeekNow];
    const receipts = [aug.receipt, sepSat.receipt, dupA.receipt, dupB.receipt, octSat.receipt, movedOut.receipt, deletedReceipt, movedIn.receipt, outside.receipt, badWeek.receipt];
    // Members include one nobody seats (a kids-only volunteer, say) and one with no name.
    const members: SolverHistoryMember[] = [...MEMBERS, { _id: "m-kids", member_name: "Gabi Infantil" }, { _id: "m-noname", member_name: null }];
    return { roles, receipts, members, movedOutNow, movedOut, deleted, dupA, dupB, octSat, movedIn, legacy, stampedOnly, badWeek };
  }

  it("outOfWindowReceiptRoleIds names exactly the roles of in-window receipts whose role is not a window document", () => {
    const s = scenario();
    expect(outOfWindowReceiptRoleIds({ target: TARGET, roles: s.roles, receipts: s.receipts })).toEqual(
      [s.movedOut.row._id, s.deleted.row._id].sort(),
    );
  });

  it("assembles documents, out-of-window receipts, members and the control", () => {
    const s = scenario();
    const derived = deriveSolverHistory({ target: TARGET, roles: s.roles, members: s.members });
    const ev = buildSolverHistoryEvidence({
      target: TARGET,
      roles: s.roles,
      members: s.members,
      receipts: s.receipts,
      lookedUpRoles: [s.movedOutNow],
      derived,
    });

    expect(ev.documents.map((d) => [d.day, d.type, d.roleId])).toEqual([
      [null, "sunday_role", s.badWeek.row._id],
      ["2026-08-02", "sunday_role", "role-local-1"],
      ["2026-08-08", "saturday_role", s.movedIn.row._id],
      ["2026-09-12", "saturday_role", "role-local-2"],
      ["2026-09-26", "saturday_role", s.stampedOnly.row._id],
      ["2026-09-27", "sunday_role", "legacy-1"],
      ["2026-10-04", "sunday_role", s.dupA.row._id],
      ["2026-10-04", "sunday_role", s.dupB.row._id],
      ["2026-10-31", "saturday_role", s.octSat.row._id],
    ]);
    // Keyed by `unknown`: the fixture rows are untyped projections.
    const byId = new Map<unknown, (typeof ev.documents)[number]>(ev.documents.map((d) => [d.roleId, d]));
    expect(byId.get(s.dupA.row._id)).toMatchObject({ excluded: "duplicate_target", contributes: {} });
    expect(byId.get(s.dupB.row._id)).toMatchObject({ excluded: "duplicate_target", contributes: {} });
    expect(byId.get(s.octSat.row._id)).toMatchObject({ receipt: { status: "found" }, unchangedAs: null });
    expect(byId.get("legacy-1")).toMatchObject({ receipt: { status: "unstamped" } });
    expect(byId.get(s.stampedOnly.row._id)).toMatchObject({ receipt: { status: "not_found" }, unchangedAs: "draft" });
    expect(byId.get(s.badWeek.row._id)).toMatchObject({
      excluded: "invalid_date",
      contributes: {},
      receipt: { status: "found", targetDay: "2026-09-06" },
      unchangedAs: null,
    });
    // Moved in: linked to its own receipt, whose target day is outside the window.
    expect(byId.get(s.movedIn.row._id)).toMatchObject({ receipt: { status: "found", targetDay: "2026-07-25" }, unchangedAs: null });

    expect(ev.outOfWindowReceipts).toEqual([
      {
        receiptId: s.deleted.receipt._id,
        state: "role_deleted",
        type: "sunday_role",
        targetDay: "2026-09-20",
        createdAt: "2026-08-28T10:05:00.000Z",
        roleId: s.deleted.row._id,
        roleCurrentDay: null,
      },
      {
        receiptId: s.movedOut.receipt._id,
        state: "committed",
        type: "sunday_role",
        targetDay: "2026-10-11",
        createdAt: "2026-09-28T10:15:00.000Z",
        roleId: s.movedOut.row._id,
        roleCurrentDay: "2026-11-08",
      },
    ]);

    expect(ev.members).toEqual(
      [...s.members].sort((a, b) => (a._id < b._id ? -1 : 1)).map((m) => ({ id: m._id, name: m.member_name ?? null })),
    );
    // Found receipts: aug, sepSat, dupA, dupB, octSat, movedIn, badWeek = 7; unchanged: aug, sepSat, dupA, dupB = 4.
    // `stampedOnly` is unchanged too, but by its own stamp: it is not in the rate.
    expect(ev.control).toEqual({ withReceipt: 7, unchanged: 4 });
  });

  it("per month, the documents' `contributes` sum to exactly the entry — evidence and derivation share one rule", () => {
    const s = scenario();
    const derived = deriveSolverHistory({ target: TARGET, roles: s.roles, members: s.members });
    const ev = buildSolverHistoryEvidence({ target: TARGET, roles: s.roles, members: s.members, receipts: s.receipts, lookedUpRoles: [s.movedOutNow], derived });
    for (const entry of derived.entries) {
      const sum: Record<string, Record<string, number>> = {};
      for (const d of ev.documents) {
        if (!d.day || Number(d.day.slice(0, 4)) !== entry.year || Number(d.day.slice(5, 7)) !== entry.month) continue;
        for (const [name, byKey] of Object.entries(d.contributes)) {
          for (const [key, n] of Object.entries(byKey)) {
            sum[name] ??= {};
            sum[name][key] = (sum[name][key] ?? 0) + n;
          }
        }
      }
      expect(sum).toEqual(entry.role_counts);
    }
    // The fixture is not vacuous: every month has counts, and October holds the dropped pair.
    expect(derived.entries.every((e) => Object.keys(e.role_counts).length > 0)).toBe(true);
    expect(derived.diagnostics.duplicateTargets).toHaveLength(1);
  });

  it("does not depend on input order", () => {
    const s = scenario();
    const derived = deriveSolverHistory({ target: TARGET, roles: s.roles, members: s.members });
    const input = { target: TARGET, roles: s.roles, members: s.members, receipts: s.receipts, lookedUpRoles: [s.movedOutNow], derived };
    const reversed = { ...input, roles: [...s.roles].reverse(), members: [...s.members].reverse(), receipts: [...s.receipts].reverse() };
    expect(JSON.stringify(buildSolverHistoryEvidence(reversed))).toBe(JSON.stringify(buildSolverHistoryEvidence(input)));
  });
});

// ─── Module hygiene ──────────────────────────────────────────────────────────

describe("module hygiene", () => {
  const code = (file: string) =>
    readFileSync(resolve(__dirname, "..", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("solverHistoryEvidence.ts is server-only and holds no GROQ", () => {
    const src = readFileSync(resolve(__dirname, "../solverHistoryEvidence.ts"), "utf8");
    expect(src).toMatch(/^import "server-only";$/m);
    expect(src).not.toMatch(/\*\[/);
    expect(code("solverHistoryEvidence.ts")).not.toMatch(/sanity\/lib/);
  });

  it("solverHistoryTypes.ts is neutral: type-only imports of neutral modules, no runtime code (ruling P2-R2)", () => {
    const src = code("solverHistoryTypes.ts");
    const imports = [...src.matchAll(/^\s*import\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, clause, spec] of imports) {
      expect(clause).toMatch(/^type\s/);
      expect(spec).not.toMatch(/server-only|sanity|^node:|roleWriteRequest|roleCreationReceipt|solverHistoryEvidence|solverHistoryRead/);
    }
    expect(src).not.toMatch(/^\s*import\s+["']/m);
    expect(src).not.toMatch(/\bexport\s+(const|let|var|function|class)\b/);
  });
});
