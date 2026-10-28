// THE gate of multi-ministry phase 1 (ADR-0075; access plan §5): registering
// `jovenes` and rebuilding the ministry guards on `ministryAccess.ts` must leave
// every EXISTING member with exactly the access they had.
//
// The oracle is a verbatim copy of the code this replaced (main 93ed813e):
// `normalizeMinistries`, the `managesMinistries` filter of `getMemberAccess`, and
// the two guard predicates of `authGuards.ts`, over the registry as it stood
// (worship, kids). The candidate is the real code: raw documents go through
// `accessFromDoc` — the function `getMemberAccess` returns — so a forgotten
// projection or an un-normalized field would fail here, not in production.
//
// Do NOT update the oracle to make this pass. If the new code disagrees, the new
// code changed someone's access.
import { describe, expect, it, vi } from "vitest";

// accessFromDoc is pure; its module also holds the cached fetch, whose client needs env.
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() } }));
import { accessFromDoc, type MemberAccessDoc } from "../memberAccess";
import { isMinistryManager, isMinistryMember } from "../ministryAccess";
import type { MinistryId } from "@/app/ministries";

const OLD_IDS = ["worship", "kids"];
const oldIsMinistryId = (x: unknown): x is string => typeof x === "string" && OLD_IDS.includes(x);
function oldNormalizeMinistries(v: unknown): string[] {
  const known = Array.isArray(v) ? v.filter(oldIsMinistryId) : [];
  return known.length > 0 ? known : ["worship"];
}
function oldAccess(doc: MemberAccessDoc | null) {
  return {
    role: doc?.role ?? null,
    ministries: doc ? oldNormalizeMinistries(doc.ministries) : [],
    managesMinistries: doc && Array.isArray(doc.managesMinistries) ? doc.managesMinistries.filter(oldIsMinistryId) : [],
  };
}
// authGuards.ts at 93ed813e, after the session/active checks:
const oldMember = (a: ReturnType<typeof oldAccess>, m: string) =>
  a.role === "super-admin" ? true : a.ministries.includes(m);
const oldManager = (a: ReturnType<typeof oldAccess>, m: string) =>
  a.role === "super-admin" ? true : a.managesMinistries.includes(m);

const ROLES = ["super-admin", "admin", "content-editor", "member", null, "weird"];
const RAW_MINISTRIES: unknown[] = [
  undefined, [], ["worship"], ["kids"], ["worship", "kids"], ["worship", "jovenes"], ["jovenes"],
  ["toString"], "worship", [null], ["kids", "constructor"],
];
const RAW_MANAGES: unknown[] = [undefined, [], ["kids"], ["worship"], ["__proto__"]];
const RAW_ROLES: unknown[] = [
  undefined,
  [{ _key: "jovenes", ministry: "jovenes", level: "admin", groups: ["otro-nivel"] }],
  "junk",
];
const MINISTRIES: MinistryId[] = ["worship", "kids"];

/** The ONE intended divergence: a stored ["jovenes"] alone read as worship before. */
const divergesOnPurpose = (ministries: unknown) =>
  Array.isArray(ministries) && ministries.length === 1 && ministries[0] === "jovenes";

const rows: { doc: MemberAccessDoc; m: MinistryId }[] = [];
for (const role of ROLES)
  for (const ministries of RAW_MINISTRIES)
    for (const managesMinistries of RAW_MANAGES)
      for (const ministryRoles of RAW_ROLES)
        for (const m of MINISTRIES)
          rows.push({ doc: { _id: "m1", role, ministries, managesMinistries, ministryRoles }, m });

describe("ministry guards: equivalence with the pre-ADR-0075 code", () => {
  it("covers the whole matrix", () => {
    expect(rows.length).toBe(ROLES.length * RAW_MINISTRIES.length * RAW_MANAGES.length * RAW_ROLES.length * 2);
  });

  it("every existing member shape has exactly the access it had (worship and kids)", () => {
    const mismatches = rows
      .filter(({ doc }) => !divergesOnPurpose(doc.ministries))
      .flatMap(({ doc, m }) => {
        const before = oldAccess(doc);
        const after = accessFromDoc(doc);
        const out: string[] = [];
        if (oldMember(before, m) !== isMinistryMember(after, m)) out.push(`member ${m} ${JSON.stringify(doc)}`);
        if (oldManager(before, m) !== isMinistryManager(after, m)) out.push(`manager ${m} ${JSON.stringify(doc)}`);
        return out;
      });
    expect(mismatches).toEqual([]);
  });

  it("the ONE intended divergence: a Jóvenes-only member is no longer a worship member", () => {
    for (const { doc, m } of rows.filter((r) => divergesOnPurpose(r.doc.ministries))) {
      const before = oldAccess(doc);
      const after = accessFromDoc(doc);
      expect(isMinistryManager(after, m)).toBe(oldManager(before, m));
      if (doc.role === "super-admin" || m === "kids") {
        expect(isMinistryMember(after, m)).toBe(oldMember(before, m));
      } else {
        // Old code: ["jovenes"] → [] → ["worship"]. New code: a Jóvenes member.
        expect(oldMember(before, m)).toBe(true);
        expect(isMinistryMember(after, m)).toBe(false);
      }
    }
  });

  it("a missing document still grants nothing", () => {
    const after = accessFromDoc(null);
    for (const m of MINISTRIES) {
      expect(isMinistryMember(after, m)).toBe(false);
      expect(isMinistryManager(after, m)).toBe(false);
    }
  });
});
