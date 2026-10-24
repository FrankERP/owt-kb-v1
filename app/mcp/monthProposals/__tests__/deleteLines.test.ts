// Admin parity phase 2: the delete line's count is the notice builder's own audience (D4), and the
// outcome classification of D7.
import { describe, expect, it, vi } from "vitest";

const commits: unknown[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/sanity/lib/serverClient", () => {
  const tx = () => {
    const t = {
      createIfNotExists: () => t,
      patch: () => t,
      commit: async () => { commits.push(1); return {}; },
    };
    return t;
  };
  return { writeClient: { transaction: tx }, serverClient: { fetch: vi.fn() } };
});

import type { StoredRole } from "@/app/utils/roleWriteOps";
import { normalizeStoredSeats } from "@/app/utils/roleWriteRequest";
import { queueRoleNoticesNow } from "@/app/utils/serviceMutationSideEffects";
import { classifyDeleteOutcome, deleteLine, noticeAudience } from "../deleteLines";

const ref = (id: string, key = id) => ({ _key: key, _type: "reference", _ref: id });

describe("deleteLine", () => {
  it.each<[string, Partial<StoredRole>]>([
    ["a person in two seats", { Lead: [ref("m-ana")], BGVs: [ref("m-ana", "b1"), ref("m-bruno")] }],
    ["an instrument slot without a label (dropped, as the notice drops it)", { instruments: [{ _key: "i1", _type: "instrument_slot", person: { _type: "reference", _ref: "m-carla" } }], Lead: [ref("m-ana")] }],
    ["a dangling ref (still notified: the flush drops it)", { Lead: [ref("m-gone")], foh_team: [{ _key: "f1", _type: "foh_slot", role: "Consola", person: { _type: "reference", _ref: "m-dani" } }] }],
  ])("N is the number of people the commit's queued notice carries: %s", async (_name, seats) => {
    const role: StoredRole = { _id: "sun-8", _rev: "r", _type: "sunday_role", week: "2026-11-08", published: true, Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...seats };
    const queued = await queueRoleNoticesNow({
      roleId: role._id,
      roleType: role._type,
      serviceDate: "2026-11-08",
      published: true,
      beforeSeats: normalizeStoredSeats(role),
      afterSeats: null,
      deleted: true,
    });
    const n = queued.descriptor?.memberIds.length ?? 0;
    expect(noticeAudience(role)).toHaveLength(n);
    expect(deleteLine(role)).toBe(`domingo 8 nov · publicado: se avisa a hasta ${n} ${n === 1 ? "persona" : "personas"}`);
  });

  it("the longest line a special can have fits the delete schema's 200 characters", () => {
    const name = "N".repeat(80);
    const many = Array.from({ length: 60 }, (_, i) => ref(`m-${i}`));
    const line = deleteLine({ _id: "sp", _rev: "r", _type: "special_role", date: "2026-11-30", service_name: name, published: true, Lead: many, BGVs: [], Chorus: [], instruments: [], foh_team: [] })!;
    expect(line.length).toBeLessThanOrEqual(200);
  });

  it("an absent `published` is visible (a published line), only `false` is a draft; NFC", () => {
    const base: StoredRole = { _id: "s", _rev: "r", _type: "saturday_role", week: "2026-11-07", Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [] };
    expect(deleteLine(base)).toBe("sábado 7 nov · publicado, sin equipo");
    expect(deleteLine({ ...base, published: false })).toBe("sábado 7 nov · borrador");
    expect(deleteLine({ ...base, published: false })).toBe("sábado 7 nov · borrador".normalize("NFC"));
    expect(deleteLine({ ...base, week: undefined })).toBeNull();
  });
});

describe("classifyDeleteOutcome", () => {
  const refused = (error: string, status = 409) => classifyDeleteOutcome({ ok: false, status, body: { error } });
  it("proven pre-write refusals, not_found apart, and everything else unknown", () => {
    expect(classifyDeleteOutcome({ ok: true, status: 200, body: { ok: true } })).toEqual({ kind: "deleted" });
    expect(classifyDeleteOutcome(null)).toEqual({ kind: "unknown" });
    expect(refused("not_found", 404)).toEqual({ kind: "notFound" });
    for (const code of ["invalid_request", "forbidden", "integrity_conflict", "ambiguous_target", "dependency_conflict", "stale_revision", "role_has_dependencies", "bootstrap_completed_reload"]) {
      expect(refused(code), code).toEqual({ kind: "refused", code });
    }
    for (const code of ["bootstrap_outcome_unknown", "idempotency_mismatch", "something_new"]) expect(refused(code), code).toEqual({ kind: "unknown" });
    expect(refused("stale_revision", 500)).toEqual({ kind: "unknown" });
    expect(classifyDeleteOutcome({ ok: false, status: 409, body: {} })).toEqual({ kind: "unknown" });
  });
});
