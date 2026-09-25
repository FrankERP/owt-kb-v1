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
import { buildParticipantRoles, presentParticipation } from "../participationPresenter";
import { loadServiceSnapshot } from "../serviceSnapshot";

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
    const payload = presentParticipation(snapshot, "2026-09");

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
    const payload = presentParticipation(snapshot, "2026-10");
    const ghost = payload.members.find((m) => m.memberId === "mem-ghost");
    expect(ghost).toMatchObject({ name: null, missing: true, sunBGV: 1, total: 1 });
  });

  it("a failed members read keeps the counts, with every name null and a note", async () => {
    const responder = scopedResponder(readToolStore(), { fail: ["members"] });
    h.operational.mockImplementation(responder.operational);
    h.raw.mockImplementation(responder.raw);
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2026-09");
    expect(payload.members.length).toBeGreaterThan(0);
    for (const m of payload.members) {
      expect(m.name).toBeNull();
      expect(m.unresolved).toBe(true);
    }
    expect(payload.notes).toEqual([
      "No se pudieron leer los nombres de los miembros; los conteos son correctos, pero los nombres no están disponibles.",
    ]);
  });

  it("months with no service in the store are empty, not an error", async () => {
    const snapshot = await loadServiceSnapshot();
    const payload = presentParticipation(snapshot, "2020-01");
    expect(payload).toEqual({ month: "2020-01", members: [], services: [] });
  });
});
