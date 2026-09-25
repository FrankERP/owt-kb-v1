// `presentParticipation` (P1 step 6): parity with `computeParticipation` on the
// exact input this module builds, the I5 seat exception (a kids-only member
// seated on a role is still shown), a special's voice seats counting as
// `especial` and inside `total`, a dangling seat reported `missing: true`
// rather than dropped, and the members-domain degradation note.
//
// Runs over `loadServiceSnapshot()` and the P1 step-4 fixture responder
// (`readToolFixtures.ts`), so the same fixture powers this presenter test and
// the tool/route tests — one matrix, not three.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ operational: vi.fn(), raw: vi.fn() }));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));

import { computeParticipation, type MemberParticipation } from "@/app/utils/computeParticipation";
import { FROZEN_EVENING, readToolStore, scopedResponder } from "./readToolFixtures";
import { buildParticipantRoles, participantMemberIds, presentParticipation } from "../participationPresenter";
import { loadMemberNames, loadServiceSnapshot, type ServiceSnapshot } from "../serviceSnapshot";

/** What `getParticipation.ts` itself builds before calling `presentParticipation`. */
async function resolveMembers(snapshot: ServiceSnapshot, month: string) {
  return loadMemberNames(participantMemberIds(buildParticipantRoles(snapshot, month)), snapshot.membersById);
}

beforeEach(() => {
  h.operational.mockReset();
  h.raw.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_EVENING));
  const responder = scopedResponder(readToolStore());
  h.operational.mockImplementation(responder.operational);
  h.raw.mockImplementation(responder.raw);
});

afterEach(() => {
  vi.useRealTimers();
});

const COUNT_FIELDS = [
  "sunLead",
  "satLead",
  "sunBGV",
  "satBGV",
  "coro",
  "especial",
  "total",
  "instrWeeks",
  "fohWeeks",
] as const satisfies readonly (keyof MemberParticipation)[];

/** Every count field matches a direct `computeParticipation` call on the SAME input this module builds — never re-deriving the function, only proving the wiring. */
function expectCountParity(members: Record<string, unknown>[], direct: MemberParticipation[]) {
  expect(members).toHaveLength(direct.length);
  for (const entry of direct) {
    const match = members.find((m) => m.memberId === entry.id);
    expect(match, `no participation entry for ${entry.id}`).toBeDefined();
    for (const field of COUNT_FIELDS) expect(match![field]).toBe(entry[field]);
  }
}

describe("presentParticipation", () => {
  it("September: a special's voice seats count as especial and inside total, and a kids-only seated member is shown", async () => {
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2026-09", await resolveMembers(snapshot, "2026-09"));

    // Parity: the same counts a direct `computeParticipation` call gives on the same input set.
    const direct = computeParticipation(buildParticipantRoles(snapshot, "2026-09"));
    expectCountParity(payload.members, direct);

    const ana = payload.members.find((m) => m.memberId === "mem-ana")!;
    expect(ana).toMatchObject({ name: "Ana", sunLead: 1, especial: 1, total: 2 });

    // "Kiki" is kids-only (spec I5's seat exception): shown because she is seated.
    const kiki = payload.members.find((m) => m.memberId === "mem-kiki")!;
    expect(kiki).toMatchObject({ name: "Kiki", especial: 1, total: 1 });

    expect(payload.services).toEqual([
      { serviceId: "role-sun-0927", date: "2026-09-27", kind: "sunday", published: "published" },
      { serviceId: "role-sp-0930-a", date: "2026-09-30", kind: "special", published: "draft" },
      { serviceId: "role-sp-0930-b", date: "2026-09-30", kind: "special", published: "draft" },
    ]);
    expect(payload.notes).toBeUndefined();
  });

  it("a seat whose member is missing from membersById is counted, not dropped", async () => {
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2026-10", await resolveMembers(snapshot, "2026-10"));
    const ghost = payload.members.find((m) => m.memberId === "mem-ghost");
    expect(ghost).toMatchObject({ name: null, missing: true, sunBGV: 1, total: 1 });
  });

  it("a member seated ONLY on a structurally invalid role still resolves by name, never reported missing", async () => {
    // `role-sp-1212-solo-invalid` fails `validateRole(...).groupable` (a null
    // Chorus), so `collectRoleMemberRefs` never adds its Lead ref to the
    // snapshot's bulk `membersById` — "Tono" exists nowhere else in the store.
    const snapshot = await loadServiceSnapshot();
    expect(snapshot.membersById.has("mem-tono")).toBe(false);
    const payload = presentParticipation(snapshot, "2026-12", await resolveMembers(snapshot, "2026-12"));
    const tono = payload.members.find((m) => m.memberId === "mem-tono");
    expect(tono).toMatchObject({ name: "Tono" });
    expect(tono?.missing).toBeUndefined();
  });

  it("a failed members read keeps the counts, with every name null and a note", async () => {
    const responder = scopedResponder(readToolStore(), { fail: ["members"] });
    h.operational.mockImplementation(responder.operational);
    h.raw.mockImplementation(responder.raw);
    const snapshot = await loadServiceSnapshot();
    const members = await resolveMembers(snapshot, "2026-09");
    expect(members.ok).toBe(false); // the supplementary read hits the same failing domain
    const payload = presentParticipation(snapshot, "2026-09", members);
    expect(payload.members.length).toBeGreaterThan(0);
    for (const m of payload.members) {
      expect(m.name).toBeNull();
      expect(m.unresolved).toBe(true);
    }
    expect(payload.notes).toEqual([
      "No se pudo leer el nombre de uno o más miembros; los conteos son correctos, pero esos miembros aparecen con unresolved: true.",
    ]);
  });

  it("months with no service in the store are empty, not an error", async () => {
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2020-01", await resolveMembers(snapshot, "2020-01"));
    expect(payload).toEqual({ month: "2020-01", members: [], services: [] });
  });

  it("orders services by date, then compareServiceTime, then id — same-day specials whose id order contradicts their time order", async () => {
    // `role-sp-1220-a` (20:00) sorts BEFORE `role-sp-1220-z` (08:00) by id
    // alone; the correct order (matching list_services) is by TIME.
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2026-12", await resolveMembers(snapshot, "2026-12"));
    const ids = payload.services.map((s) => s.serviceId);
    expect(ids.indexOf("role-sp-1220-z")).toBeLessThan(ids.indexOf("role-sp-1220-a"));
  });

  it("members tied on total are ordered by resolved name, not by insertion order", async () => {
    // `role-sp-2506-first` (Lead "Zeta") is pushed before `role-sp-2506-second`
    // (Lead "Alfa"), so Map insertion order alone would put Zeta first — both
    // are tied at total: 1. The admin sidebar's order is alphabetical.
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2025-06", await resolveMembers(snapshot, "2025-06"));
    const names = payload.members.map((m) => m.name);
    expect(names).toEqual(["Alfa", "Zeta"]);
  });

  it("failedSources appears when a domain failed, absent on success", async () => {
    const snapshot = await loadServiceSnapshot();
    const clean = presentParticipation(snapshot, "2026-09", await resolveMembers(snapshot, "2026-09"));
    expect(clean.failedSources).toBeUndefined();

    // "setlists" is the fixture's DOMAIN name; a failed read there degrades the
    // "setlistTargets" SOURCE (`setlists.ok && setlistDrafts.ok`), which is
    // what `failedSourcesOf` actually reports.
    const responder = scopedResponder(readToolStore(), { fail: ["setlists"] });
    h.operational.mockImplementation(responder.operational);
    h.raw.mockImplementation(responder.raw);
    const degraded = await loadServiceSnapshot();
    const payload = presentParticipation(degraded, "2026-09", await resolveMembers(degraded, "2026-09"));
    expect(payload.failedSources).toEqual(["setlistTargets"]);
  });
});
