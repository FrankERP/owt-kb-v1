// MCP P4 step 5 — the month proposal's document contract: the import-free names the schema and
// the Studio policy share, the handle (D9), and the strict build/parse pair (D6, D10): a real
// plan round-trips; anything else that is not exactly what `buildProposal` writes reads as no
// record at all.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mcpProposal } from "@/sanity/schemas/mcpProposal";
import { INTERNAL_STUDIO_FIELDS } from "@/app/utils/studioProtection";
import { planV3Month, type V3MonthPlan } from "@/app/utils/v3MonthPlan";
import { deps } from "@/app/utils/__tests__/v3MonthPlanFixtures";
import { importSpecifiers } from "@/app/mcp/oauth/__tests__/importClosure";
import { MCP_PROPOSAL_TYPE, PROPOSAL_FIELD, PROPOSAL_FIELDS } from "../documentTypes";
import { isProposalHandle, isProposalId, newProposalHandle, proposalIdOf } from "../handle";
import {
  EMPTY_STATE,
  PROPOSAL_MAX_DRAFTS,
  PROPOSAL_TTL_MS,
  admitsProposal,
  buildProposal,
  mergeState,
  parseProposal,
  proposalDigest,
  stateText,
  type NewProposalDocument,
} from "../proposalDocument";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const NOW = Date.parse("2026-10-20T21:00:00.000Z");
const PROD = "https://owt-backstage.vercel.app";

async function realPlan(): Promise<V3MonthPlan> {
  const out = await planV3Month(
    { month: "2026-11", months: 1, specials: [{ date: "2026-11-18", name: "Noche de alabanza" }] },
    deps(),
  );
  if (out.kind !== "success") throw new Error(`expected a plan, got ${out.kind}`);
  return out.plan;
}

function build(plan: V3MonthPlan, over: Partial<Parameters<typeof buildProposal>[0]> = {}) {
  return buildProposal({
    handle: "0123456789abcdefghjkmnpqrs",
    origin: PROD,
    principal: "member-frank",
    nowMs: NOW,
    rulesRev: plan.rulesRev,
    months: plan.months,
    requestId: plan.requestId,
    payload: {
      entries: plan.entries,
      drafts: plan.drafts.map((d) => ({ draft: d.draft, atSolve: d.atSolve, reasons: d.reasons })),
      storedServiceIds: plan.storedServiceIds,
    },
    ...over,
  });
}

function built(plan: V3MonthPlan, over: Partial<Parameters<typeof buildProposal>[0]> = {}): NewProposalDocument {
  const out = build(plan, over);
  if (!out.ok) throw new Error("expected a document");
  return out.doc;
}

/** Re-sign a tampered document, so a test proves the SCHEMA refuses it, not the digest. */
function resigned(doc: NewProposalDocument, payload: unknown): NewProposalDocument {
  const text = JSON.stringify(payload);
  const header = {
    origin: doc.origin, principal: doc.principal, createdAt: doc.createdAt, expiresAt: doc.expiresAt,
    engine: doc.engine, rulesRev: doc.rulesRev ?? null, months: doc.months, requestId: doc.requestId,
  };
  return { ...doc, payload: text, digest: proposalDigest(header, text) };
}

describe("documentTypes.ts and the schema", () => {
  it("is import-free, and its name map equals the field list", () => {
    const src = readFileSync(path.join(HERE, "../documentTypes.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(Object.values(PROPOSAL_FIELD)).toEqual([...PROPOSAL_FIELDS]);
    expect(Object.keys(PROPOSAL_FIELD)).toEqual([...PROPOSAL_FIELDS]);
  });

  it("the schema declares exactly the fields, and the Studio policy lists the same", () => {
    expect(mcpProposal.name).toBe(MCP_PROPOSAL_TYPE);
    expect((mcpProposal.fields as { name: string }[]).map((f) => f.name)).toEqual([...PROPOSAL_FIELDS]);
    expect([...INTERNAL_STUDIO_FIELDS.mcpProposal]).toEqual([...PROPOSAL_FIELDS]);
  });

  it("the schema imports nothing beyond `sanity` and documentTypes (no node:crypto in the Studio)", () => {
    const src = readFileSync(path.join(REPO_ROOT, "sanity/schemas/mcpProposal.ts"), "utf8");
    expect(importSpecifiers(src).sort()).toEqual(["../../app/mcp/monthProposals/documentTypes", "sanity"]);
  });

  it("the writer never sets a field outside the list", async () => {
    const doc = built(await realPlan());
    expect(Object.keys(doc).filter((k) => !k.startsWith("_")).every((k) => (PROPOSAL_FIELDS as readonly string[]).includes(k))).toBe(true);
  });
});

describe("the handle (D9)", () => {
  it("is 26 lowercase Crockford characters, fresh each time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const h = newProposalHandle();
      expect(isProposalHandle(h)).toBe(true);
      seen.add(h);
    }
    expect(seen.size).toBe(500);
  });

  it.each(["", "0123456789abcdefghjkmnpqr", "0123456789abcdefghjkmnpqrst", "0123456789ABCDEFGHJKMNPQRS", "0123456789abcdefghijkmnpqr", "0123456789abcdefghjklnpqrs", "0123456789abcdefghjkmnoqrs", "0123456789abcdefghjkmnpqru", 42])(
    "refuses %s",
    (h) => {
      expect(isProposalHandle(h)).toBe(false);
    },
  );

  it("maps to a dotted id and back", () => {
    const h = newProposalHandle();
    expect(proposalIdOf(h)).toBe(`mcpProposal.${h}`);
    expect(isProposalId(proposalIdOf(h))).toBe(true);
    expect(isProposalId(`drafts.mcpProposal.${h}`)).toBe(false);
    expect(isProposalId(`mcpOauthGrant.${h}`)).toBe(false);
  });
});

describe("build and parse (D6, D10)", () => {
  it("a real plan round-trips, header, payload and an empty state", async () => {
    const plan = await realPlan();
    const doc = built(plan);
    expect(doc._id).toBe("mcpProposal.0123456789abcdefghjkmnpqrs");
    expect(doc.expiresAt).toBe(new Date(NOW + PROPOSAL_TTL_MS).toISOString());
    const parsed = parseProposal({ ...doc, _rev: "r1" });
    expect(parsed?.header).toMatchObject({ origin: PROD, principal: "member-frank", engine: "v3", rulesRev: "rules-rev-1", months: ["2026-11"] });
    expect(parsed?.payload.drafts.map((d) => d.draft.localId)).toEqual(plan.drafts.map((d) => d.draft.localId));
    expect(parsed?.payload.entries).toEqual(JSON.parse(JSON.stringify(plan.entries)));
    expect(parsed?.state).toEqual(EMPTY_STATE);
  });

  it("the defaults' null revision is an absent field, and GROQ's null for it reads back as null", async () => {
    const doc = built(await realPlan(), { rulesRev: null });
    expect("rulesRev" in doc).toBe(false);
    expect(parseProposal({ ...doc, _rev: "r1", rulesRev: null })?.header.rulesRev).toBeNull();
  });

  it.each([
    ["the payload", (d: NewProposalDocument) => ({ ...d, payload: d.payload.replace("2026-11", "2026-12") })],
    ["the principal", (d: NewProposalDocument) => ({ ...d, principal: "member-other" })],
    ["the expiry", (d: NewProposalDocument) => ({ ...d, expiresAt: "2027-01-01T00:00:00.000Z" })],
    ["the rules revision", (d: NewProposalDocument) => ({ ...d, rulesRev: "rules-rev-2" })],
    ["the digest", (d: NewProposalDocument) => ({ ...d, digest: `sha256:${"0".repeat(64)}` })],
  ])("altering %s after the solve reads as no record", async (_name, tamper) => {
    expect(parseProposal({ ...tamper(built(await realPlan())), _rev: "r1" })).toBeNull();
  });

  it("refuses an unknown field, a wrong type or id, and a missing revision", async () => {
    const doc = built(await realPlan());
    expect(parseProposal({ ...doc, _rev: "r1", extra: "x" })).toBeNull();
    expect(parseProposal({ ...doc, _rev: "r1", _type: "mcpOauthGrant" })).toBeNull();
    expect(parseProposal({ ...doc, _rev: "r1", _id: `drafts.${doc._id}` })).toBeNull();
    expect(parseProposal({ ...doc })).toBeNull();
  });

  it("refuses, even re-signed, a duplicate localId, a nameless special, an unknown preflight state, an entry for another month", async () => {
    const doc = built(await realPlan());
    const payload = JSON.parse(doc.payload);
    const dup = { ...payload, drafts: [...payload.drafts, payload.drafts[0]] };
    const special = payload.drafts.findIndex((p: { draft: { service_name?: string } }) => p.draft.service_name);
    const nameless = structuredClone(payload);
    nameless.drafts[special].draft.service_name = "  ";
    const badState = structuredClone(payload);
    badState.drafts[0].atSolve = "maybe";
    const badEntry = structuredClone(payload);
    badEntry.entries[0].month = "2026-12";
    for (const bad of [dup, nameless, badState, badEntry]) {
      expect(parseProposal({ ...resigned(doc, bad), _rev: "r1" })).toBeNull();
    }
    expect(parseProposal({ ...resigned(doc, payload), _rev: "r1" })).not.toBeNull();
  });

  it("refuses to build what it could not read back: too many drafts or months", async () => {
    const plan = await realPlan();
    const many = Array.from({ length: PROPOSAL_MAX_DRAFTS + 1 }, (_, i) => ({
      ...plan.drafts[0], draft: { ...plan.drafts[0].draft, localId: `l${i}`, creationRequestId: `c${i}` },
    }));
    expect(build(plan, { payload: { entries: plan.entries, drafts: many, storedServiceIds: [] } })).toEqual({ ok: false, reason: "invalid" });
    expect(build(plan, { months: ["2026-11", "2026-12", "2027-01"] })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a state naming a draft the payload does not hold", async () => {
    const doc = built(await realPlan());
    expect(parseProposal({ ...doc, _rev: "r1", state: stateText({ recordsDone: true, created: { nope: "role-1" } }) })).toBeNull();
  });
});

describe("state and admission", () => {
  it("mergeState ORs recordsDone and unions created, the stored side winning a clash", () => {
    expect(mergeState({ recordsDone: false, created: { a: "r-a", c: "r-c1" } }, { recordsDone: true, created: { b: "r-b", c: "r-c2" } }))
      .toEqual({ recordsDone: true, created: { a: "r-a", b: "r-b", c: "r-c1" } });
  });

  it("admits only this origin's, this principal's, unexpired record", async () => {
    const p = parseProposal({ ...built(await realPlan()), _rev: "r1" });
    if (!p) throw new Error("expected a record");
    expect(admitsProposal(p, { origin: PROD, principal: "member-frank", nowMs: NOW })).toBe(true);
    expect(admitsProposal(p, { origin: "https://dev-owt-backstage.vercel.app", principal: "member-frank", nowMs: NOW })).toBe(false);
    expect(admitsProposal(p, { origin: PROD, principal: "member-other", nowMs: NOW })).toBe(false);
    expect(admitsProposal(p, { origin: PROD, principal: "member-frank", nowMs: NOW + PROPOSAL_TTL_MS })).toBe(false);
  });
});
