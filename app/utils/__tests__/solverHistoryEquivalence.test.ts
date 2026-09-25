// R12 — for a month the planner created and nobody edited, the derived entry
// equals what `historyEntryFromDrafts` wrote from the same drafts.
//
// The documents are built by the create route's OWN path —
// `draftCreateBody` → `parseCreateRequest` → `buildRoleDocument`, exactly as
// `app/api/admin/roles/route.ts` does — and then passed through the real
// `ROLE_PROJECTION` text, so nothing here is a hand-built mirror of what the
// derivation expects (that would make the test circular).
//
// Deleted in D3 together with `historyEntryFromDrafts` (spec R15).

import { describe, expect, it } from "vitest";

import type { RankMember } from "@/app/components/admin/candidateRanking";
import { historyEntryFromDrafts, type DraftCard } from "@/app/components/admin/plannerModel";
import { draftCreateBody } from "@/app/utils/monthDraftCreate";
import { buildRoleDocument, parseCreateRequest } from "@/app/utils/roleWriteRequest";
import { ROLE_PROJECTION } from "@/app/utils/serviceReadQueries";
import { deriveSolverHistory, historyWindow } from "@/app/utils/solverHistory";

// Fake names only: this repository is public.
const MEMBERS: RankMember[] = [
  { _id: "m-ana", member_name: "Ana Prueba" },
  { _id: "m-beto", member_name: "Beto Ensayo" },
  { _id: "m-caro", member_name: "Caro Muestra" },
  { _id: "m-dani", member_name: "Dani Ficticio" },
  { _id: "m-eli", member_name: "Eli Simulada" },
  { _id: "m-fer", member_name: "Fer Ejemplo" },
];

const TARGET = { year: 2026, month: 11 };

let seq = 0;
function draft(over: Partial<DraftCard> & Pick<DraftCard, "_type" | "date">): DraftCard {
  seq += 1;
  return {
    localId: `local-${seq}`,
    creationRequestId: `req-equivalence-${String(seq).padStart(4, "0")}`,
    exists: false,
    isExisting: false,
    skipped: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    ...over,
  };
}

const bass = (personId: string) => ({ id: `i-${personId}`, instrument: "Bajo", personId });
const audio = (personId: string) => ({ id: `f-${personId}`, role: "Audio", personId });

/** Create-mode drafts: three non-empty prior months, a special among them, and the target month. */
const DRAFTS: { draft: DraftCard; published: boolean }[] = [
  // August
  { published: false, draft: draft({ _type: "sunday_role", date: "2026-08-02", leads: ["m-ana"], bgvs: ["m-beto", "m-caro"], chorus: ["m-dani", "m-eli"], instruments: [bass("m-fer")], foh: [audio("m-dani")] }) },
  { published: false, draft: draft({ _type: "saturday_role", date: "2026-08-08", leads: ["m-beto"], bgvs: ["m-ana"] }) },
  { published: true, draft: draft({ _type: "sunday_role", date: "2026-08-09", leads: ["m-ana", "m-caro"], bgvs: ["m-eli"], chorus: ["m-fer"] }) },
  // September — with a special, which neither side counts (R1)
  { published: true, draft: draft({ _type: "sunday_role", date: "2026-09-06", leads: ["m-caro"], bgvs: ["m-ana", "m-fer"], chorus: ["m-beto"] }) },
  { published: false, draft: draft({ _type: "saturday_role", date: "2026-09-12", leads: ["m-dani"], bgvs: ["m-eli", "m-beto"] }) },
  { published: false, draft: draft({ _type: "special_role", date: "2026-09-16", service_name: "Noche de prueba", leads: ["m-ana"], bgvs: ["m-caro"], chorus: ["m-fer"] }) },
  // A member seated twice on one service counts twice on both sides (every stored seat counts).
  { published: false, draft: draft({ _type: "sunday_role", date: "2026-09-13", leads: ["m-eli"], bgvs: ["m-dani", "m-dani"], chorus: ["m-eli"] }) },
  // October — including the month-end Saturday (R5)
  { published: false, draft: draft({ _type: "sunday_role", date: "2026-10-04", leads: ["m-fer"], bgvs: ["m-caro"], chorus: ["m-ana", "m-beto"], instruments: [bass("m-eli")] }) },
  { published: true, draft: draft({ _type: "saturday_role", date: "2026-10-31", leads: ["m-ana"], bgvs: ["m-dani"] }) },
  // November — the target month: stored, and never counted (R4)
  { published: false, draft: draft({ _type: "sunday_role", date: "2026-11-01", leads: ["m-beto"], bgvs: ["m-ana"], chorus: ["m-caro"] }) },
  { published: false, draft: draft({ _type: "saturday_role", date: "2026-11-07", leads: ["m-caro"] }) },
];

let keySeq = 0;
const nextKey = () => `key-${++keySeq}`;

/** The create route's own path, from draft to stored document. */
function storedDocument(d: DraftCard, published: boolean): Record<string, unknown> {
  const parsed = parseCreateRequest(draftCreateBody(d, published));
  if (!parsed.ok) throw new Error(`fixture ${d.localId} failed to parse: ${parsed.issues.join(", ")}`);
  const v = parsed.value;
  const doc = buildRoleDocument({
    roleId: `role-${d.localId}`,
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
  // The Content Lake adds the system revision on commit.
  return { ...doc, _rev: `rev-${d.localId}` };
}

// ── A literal reading of the `ROLE_PROJECTION` text ─────────────────────────
// Supports exactly the terms that projection uses — `field`, `field{…}` and
// `field[]{…}` — and throws on anything else, so a projection change that this
// reader cannot follow fails loudly instead of projecting the wrong shape.

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function project(value: unknown, projection: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inner = projection.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, unknown> = {};
  for (const term of splitTopLevel(inner)) {
    const m = /^(\w+)(\[\])?\s*(\{[\s\S]*\})?$/.exec(term);
    if (!m) throw new Error(`unsupported projection term: ${term}`);
    const [, field, isArray, sub] = m;
    const v = (value as Record<string, unknown>)[field];
    if (!sub) out[field] = v ?? null;
    else if (isArray) out[field] = Array.isArray(v) ? v.map((item) => project(item, sub)) : null;
    else out[field] = project(v, sub);
  }
  return out;
}

const monthOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });

describe("R12 — derived history equals historyEntryFromDrafts for an untouched create-mode month", () => {
  const rows = DRAFTS.map(({ draft: d, published }) => project(storedDocument(d, published), ROLE_PROJECTION));
  const derived = deriveSolverHistory({ target: TARGET, roles: rows, members: MEMBERS });

  it("builds real ROLE_PROJECTION rows (the fixture is what the read will return)", () => {
    expect(rows).toHaveLength(DRAFTS.length);
    const first = rows[0] as Record<string, unknown>;
    expect(first).toMatchObject({ _id: "role-local-1", _type: "sunday_role", week: "2026-08-02", date: null, published: false });
    expect((first.Lead as { _type: string; _ref: string }[])[0]).toMatchObject({ _type: "reference", _ref: "m-ana" });
    const special = rows.find((r) => (r as { _type: string })._type === "special_role") as Record<string, unknown>;
    expect(special).toMatchObject({ date: "2026-09-16", week: null, service_name: "Noche de prueba" });
  });

  it("each of the three prior months equals historyEntryFromDrafts over the same weekend drafts", () => {
    const window = historyWindow(TARGET);
    expect(derived.entries.map((e) => e.key)).toEqual(window.map((w) => w.key));
    window.forEach((w, i) => {
      const monthDrafts = DRAFTS.map((x) => x.draft).filter((d) => {
        const m = monthOf(d.date);
        return m.year === w.year && m.month === w.month;
      });
      const weekendDrafts = monthDrafts.filter((d) => d._type !== "special_role");
      expect(weekendDrafts.length).toBeGreaterThan(0); // "three non-empty prior months"
      const expected = historyEntryFromDrafts(weekendDrafts, MEMBERS, w.year, w.month);
      expect(derived.entries[i]).toEqual(expected);
      // Neither side counts the special, so including it changes nothing on the draft side either.
      expect(historyEntryFromDrafts(monthDrafts, MEMBERS, w.year, w.month)).toEqual(expected);
    });
  });

  it("reports nothing for a clean, untouched window", () => {
    expect(derived.diagnostics).toEqual({
      duplicateTargets: [],
      danglingSeats: [],
      unnamedMembers: [],
      duplicateNames: [],
    });
    expect(derived.months.map((m) => m.services)).toEqual([3, 3, 2]);
  });
});
