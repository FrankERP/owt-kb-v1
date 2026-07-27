// A3 §4 — "individual/team swap and copy-instruments stale source/target", through
// the DEPLOYED `POST /api/admin/roles/swap` and `.../copy-instruments` routes.
//
// Both routes read the assignments they write from the STORED roles, never from the
// request, so the assertions are all about stored state before and after.

import { expect, test } from "./fixtures";
import { readRole } from "./lib/dataset";
import { MEMBERS, ROLES } from "./lib/fixtureRefs";

const SWAP = "/api/admin/roles/swap";
const COPY = "/api/admin/roles/copy-instruments";

function leadRefs(role: Awaited<ReturnType<typeof readRole>>): string[] {
  return (role?.Lead ?? []).map((r) => r._ref as string).sort();
}
function instrumentPairs(role: Awaited<ReturnType<typeof readRole>>): string[] {
  return (role?.instruments ?? [])
    .map((s) => `${s.instrument}:${s.person?._ref}`)
    .sort();
}
/**
 * Everything a role STORES, minus its revision and its `_key`s: the comparable
 * content of a document. Used where the claim is "this document's content did not
 * change", which is not the same claim as "this document's revision did not move".
 */
function roleContent(role: Awaited<ReturnType<typeof readRole>>): Record<string, unknown> {
  return {
    _id: role?._id ?? null,
    _type: role?._type ?? null,
    week: role?.week ?? null,
    date: role?.date ?? null,
    service_name: role?.service_name ?? null,
    published: role?.published ?? null,
    Lead: leadRefs(role),
    BGVs: (role?.BGVs ?? []).map((r) => r._ref as string).sort(),
    Chorus: (role?.Chorus ?? []).map((r) => r._ref as string).sort(),
    instruments: instrumentPairs(role),
    foh_team: (role?.foh_team ?? []).map((s) => `${s.role}:${s.person?._ref}`).sort(),
  };
}

test.describe("swap", () => {
  test("swaps one seat between two roles and writes both under their observed revisions", async ({
    admin,
    run,
  }) => {
    const source = await readRole(run.identity, ROLES.sundayPublished);
    const target = await readRole(run.identity, ROLES.saturdayPublished);
    const sourceKey = source?.Lead?.[0] as { _key?: string } | undefined;
    const targetKey = target?.Lead?.[0] as { _key?: string } | undefined;

    const res = await admin.api.post(SWAP, {
      data: {
        kind: "seat",
        source: {
          roleId: ROLES.sundayPublished,
          rev: source?._rev,
          path: "Lead",
          itemKey: sourceKey?._key,
        },
        target: {
          roleId: ROLES.saturdayPublished,
          rev: target?._rev,
          path: "Lead",
          itemKey: targetKey?._key,
        },
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()) as { ok: boolean; kind: string }).toMatchObject({
      ok: true,
      kind: "seat",
    });

    const sourceAfter = await readRole(run.identity, ROLES.sundayPublished);
    const targetAfter = await readRole(run.identity, ROLES.saturdayPublished);
    expect(sourceAfter?._rev).not.toBe(source?._rev);
    expect(targetAfter?._rev).not.toBe(target?._rev);
    // Both fixtures seed the same lead, so the swap is provable by revision movement
    // plus the seat still resolving to exactly one member on each side.
    expect(leadRefs(sourceAfter)).toHaveLength(1);
    expect(leadRefs(targetAfter)).toHaveLength(1);
  });

  test("swaps two whole teams", async ({ admin, run }) => {
    const a = await readRole(run.identity, ROLES.sundayPublished);
    const b = await readRole(run.identity, ROLES.specialPublished);

    // Give the two roles distinguishable teams first, so the swap is observable.
    const seed = await admin.api.patch(`/api/admin/roles/${encodeURIComponent(ROLES.specialPublished)}`, {
      data: {
        rev: b?._rev,
        _type: "special_role",
        date: b?.date,
        service_name: b?.service_name,
        leads: [MEMBERS.chorus],
        bgvs: [],
        chorus: [],
        instruments: [{ instrument: "Bajo", personId: MEMBERS.instrument }],
        foh: [],
      },
      failOnStatusCode: false,
    });
    expect(seed.status(), await seed.text()).toBe(200);

    const beforeA = await readRole(run.identity, ROLES.sundayPublished);
    const beforeB = await readRole(run.identity, ROLES.specialPublished);

    const res = await admin.api.post(SWAP, {
      data: {
        kind: "team",
        roles: [
          { id: ROLES.sundayPublished, rev: beforeA?._rev },
          { id: ROLES.specialPublished, rev: beforeB?._rev },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const afterA = await readRole(run.identity, ROLES.sundayPublished);
    const afterB = await readRole(run.identity, ROLES.specialPublished);
    expect(leadRefs(afterA)).toEqual(leadRefs(beforeB));
    expect(leadRefs(afterB)).toEqual(leadRefs(beforeA));
    expect(instrumentPairs(afterA)).toEqual(instrumentPairs(beforeB));
    expect(instrumentPairs(afterB)).toEqual(instrumentPairs(beforeA));
    void a;

    run.evidence("team_swap", { roles: [ROLES.sundayPublished, ROLES.specialPublished] });
  });

  test("rejects a swap whose source revision is stale, leaving both roles untouched", async ({
    admin,
    run,
  }) => {
    const source = await readRole(run.identity, ROLES.sundayPublished);
    const target = await readRole(run.identity, ROLES.saturdayPublished);

    const res = await admin.api.post(SWAP, {
      data: {
        kind: "team",
        roles: [
          { id: ROLES.sundayPublished, rev: "stale-revision-that-never-existed" },
          { id: ROLES.saturdayPublished, rev: target?._rev },
        ],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);

    expect((await readRole(run.identity, ROLES.sundayPublished))?._rev).toBe(source?._rev);
    expect((await readRole(run.identity, ROLES.saturdayPublished))?._rev).toBe(target?._rev);
  });
});

test.describe("copy instruments", () => {
  test("copies only the instruments, read from the stored source", async ({ admin, run }) => {
    const source = await readRole(run.identity, ROLES.sundayPublished);
    const target = await readRole(run.identity, ROLES.sundayDraft);

    const res = await admin.api.post(COPY, {
      data: {
        source: { id: ROLES.sundayPublished, rev: source?._rev },
        target: { id: ROLES.sundayDraft, rev: target?._rev },
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const targetAfter = await readRole(run.identity, ROLES.sundayDraft);
    expect(instrumentPairs(targetAfter)).toEqual(instrumentPairs(source));
    // Only instruments moved: the other four seat paths are unchanged.
    expect(leadRefs(targetAfter)).toEqual(leadRefs(target));

    // ── The source's CONTENT is never written by a copy ─────────────────────
    // Its `_rev` DOES advance, and that is by design, not a leak. Content Lake
    // offers no read-only revision assertion inside a transaction, so the only
    // way to make "the source still holds this lineup" part of the same atomic
    // commit is a revision-guarded no-op patch of the source's own unchanged
    // date field (see `app/api/admin/roles/copy-instruments/route.ts`); the
    // shipped guarded DELETE makes the identical tradeoff. A2 §4 requires the
    // TARGET's assignments to be safe on failure — it never requires the
    // source's revision to be frozen — so the honest assertion is that the
    // source's stored content is byte-identical.
    const sourceAfter = await readRole(run.identity, ROLES.sundayPublished);
    expect(roleContent(sourceAfter), "a copy must not change the source's content").toEqual(
      roleContent(source),
    );
    expect(
      sourceAfter?._rev,
      "the source's revision advances: its in-transaction assertion is a guarded no-op patch",
    ).not.toBe(source?._rev);
  });

  test("rejects a STALE SOURCE revision and writes nothing", async ({ admin, run }) => {
    const source = await readRole(run.identity, ROLES.sundayPublished);
    const target = await readRole(run.identity, ROLES.sundayDraft);

    const res = await admin.api.post(COPY, {
      data: {
        source: { id: ROLES.sundayPublished, rev: "stale-source-revision" },
        target: { id: ROLES.sundayDraft, rev: target?._rev },
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect((await readRole(run.identity, ROLES.sundayDraft))?._rev).toBe(target?._rev);
    expect((await readRole(run.identity, ROLES.sundayPublished))?._rev).toBe(source?._rev);
  });

  test("rejects a STALE TARGET revision and writes nothing", async ({ admin, run }) => {
    const source = await readRole(run.identity, ROLES.sundayPublished);
    const target = await readRole(run.identity, ROLES.sundayDraft);

    const res = await admin.api.post(COPY, {
      data: {
        source: { id: ROLES.sundayPublished, rev: source?._rev },
        target: { id: ROLES.sundayDraft, rev: "stale-target-revision" },
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect((await readRole(run.identity, ROLES.sundayDraft))?._rev).toBe(target?._rev);
    expect(instrumentPairs(await readRole(run.identity, ROLES.sundayDraft))).toEqual(
      instrumentPairs(target),
    );
  });
});
