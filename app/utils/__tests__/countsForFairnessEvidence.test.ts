// Solver v3 C1 §7 «R11 positive control». Since C1 every create body carries
// `countsForFairness` (draftCreateBody), at the type default for a default draft.
// R11's evidence rebuilds a create payload from a ROLE_PROJECTION row, which does
// NOT carry the field (C1-D1) — so the rebuild must still reproduce the creation
// fingerprint and read the document as unchanged. That holds only because the
// fingerprint omits a default-valued toggle (§5.3.2). The off-default case is the
// known limit the spec states (§10), pinned here so it stays a stated one.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { draftCreateBody, type CreatableDraft } from "@/app/utils/monthDraftCreate";
import { buildCreationReceipt, payloadFingerprint } from "@/app/utils/roleCreationReceipt";
import { buildRoleDocument, parseCreateRequest } from "@/app/utils/roleWriteRequest";
import { ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION, ROLE_PROJECTION } from "@/app/utils/serviceReadQueries";
import { indexMembersById, type SolverHistoryMember } from "@/app/utils/solverHistory";
import { documentEvidence, storedRoleCreatePayload } from "@/app/utils/solverHistoryEvidence";

import { projectRow } from "./__fixtures__/roleProjectionReader";

// Fake names only: this repository is public.
const MEMBERS: SolverHistoryMember[] = [
  { _id: "m-ana", member_name: "Ana Prueba" },
  { _id: "m-beto", member_name: "Beto Ensayo" },
];
const CTX = { membersById: indexMembersById(MEMBERS), duplicateTarget: false };
const TODAY = "2026-09-01"; // September 2026 is current: every draft below keeps its own value.

function draft(type: "sunday_role" | "saturday_role", date: string, countsForFairness: boolean): CreatableDraft {
  return {
    localId: `local-${date}`,
    creationRequestId: `req-c1-evidence-${date}`,
    _type: type,
    date,
    countsForFairness,
    leads: ["m-ana"],
    bgvs: ["m-beto"],
    chorus: [],
    instruments: [],
    foh: [],
  };
}

let keySeq = 0;

/** The create route's own path, then the loader's projection — as `solverHistoryEvidence.test.ts` does. */
function createThroughRoute(d: CreatableDraft) {
  const body = draftCreateBody(d, false, TODAY);
  const parsed = parseCreateRequest(body);
  if (!parsed.ok) throw new Error(`fixture ${d.localId} failed to parse: ${parsed.issues.join(", ")}`);
  const v = parsed.value;
  const roleId = `role-${d.localId}`;
  const receipt = buildCreationReceipt({ requestId: v.requestId, payload: body, roleId, now: "2026-09-01T12:00:00.000Z" });
  if (!receipt) throw new Error(`fixture ${d.localId} built no receipt`);
  const doc = buildRoleDocument({
    roleId,
    roleType: v.roleType,
    date: v.date,
    serviceName: v.serviceName,
    time: v.time,
    format: v.format,
    published: v.published,
    countsForFairness: v.countsForFairness,
    seats: v.seats,
    receiptId: v.receiptId,
    fingerprint: v.fingerprint,
    nextKey: () => `key-${++keySeq}`,
  });
  return {
    body,
    doc,
    fingerprint: v.fingerprint,
    row: projectRow({ ...doc, _rev: `rev-${d.localId}` }, ROLE_PROJECTION) as Record<string, unknown>,
    receipt: projectRow(
      { ...receipt, _rev: `rev-receipt-${d.localId}` },
      ROLE_CREATION_RECEIPT_EVIDENCE_PROJECTION,
    ) as Record<string, unknown>,
  };
}

describe("R11 positive control with countsForFairness on every create body (solver v3 C1 §7)", () => {
  it.each([
    ["sunday_role", "2026-09-06"],
    ["saturday_role", "2026-09-12"],
  ] as const)("%s: the body carries the default explicitly, the document stores it, and the evidence still reads unchanged", (type, date) => {
    const created = createThroughRoute(draft(type, date, true));
    expect(created.body.countsForFairness).toBe(true);
    expect(created.doc.countsForFairness).toBe(true);
    // ROLE_PROJECTION stays toggle-blind (C1-D1)…
    expect("countsForFairness" in created.row).toBe(false);
    // …and the rebuild still reproduces the creation fingerprint.
    expect(payloadFingerprint(storedRoleCreatePayload(created.row, false))).toBe(created.fingerprint);
    expect(documentEvidence(created.row, [created.receipt], CTX)?.unchangedAs).toBe("draft");
  });

  it("a weekend role created OFF reads as changed since creation — the known limit of §10, stated", () => {
    const created = createThroughRoute(draft("sunday_role", "2026-09-13", false));
    expect(created.body.countsForFairness).toBe(false);
    expect(payloadFingerprint(storedRoleCreatePayload(created.row, false))).not.toBe(created.fingerprint);
    expect(documentEvidence(created.row, [created.receipt], CTX)?.unchangedAs).toBeNull();
  });
});
