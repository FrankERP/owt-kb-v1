// A3 §4 — "setlist observed-singleton and observed-none conflicts", through the
// DEPLOYED `PUT /api/admin/setlists` route.
//
// The contract: the client must state the target state it OBSERVED. Any divergence
// is a 409 (reload), never a merge and never a blind overwrite. Both directions are
// exercised:
//
//   observed `single` + moved/vanished/different document  → conflict
//   observed `none`   + a target that now exists           → concurrent_creation
//
// The Saturday fixture deliberately uses the stored `saturdarSongs` typo.

import { expect, test } from "./fixtures";
import { readWeekendSetlist, readWeekendSetlistsForWeek } from "./lib/dataset";
import { FIXTURE_DATE, SETLISTS, SONGS, observedNone, observedSingle } from "./lib/fixtureRefs";

const SETLISTS_URL = "/api/admin/setlists";

function songRows(...ids: string[]): Array<Record<string, unknown>> {
  return ids.map((songId, i) => ({ songId, play_key: ["C", "D", "G"][i % 3] }));
}

test.describe("setlist observed-target contract", () => {
  test("saves under an exact observed singleton and returns the refreshed shape", async ({
    admin,
    run,
  }) => {
    const before = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);
    expect(before?._type).toBe("featuredSongs");

    const res = await admin.api.put(SETLISTS_URL, {
      data: {
        type: "sunday",
        week: FIXTURE_DATE.sundayDraft,
        observed: observedSingle(before?._id as string, before?._rev as string),
        songs: songRows(SONGS.c, SONGS.a),
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const stored = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);
    expect(stored?._rev).not.toBe(before?._rev);
    expect((stored?.songs ?? []).map((s) => s.song?._ref)).toEqual([SONGS.c, SONGS.a]);
    // Still exactly one canonical document for the week.
    expect(
      await readWeekendSetlistsForWeek(run.identity, {
        type: "featuredSongs",
        week: FIXTURE_DATE.sundayDraft,
      }),
    ).toHaveLength(1);
  });

  test("rejects an observed singleton whose revision moved (revision_mismatch)", async ({
    admin,
    run,
  }) => {
    const before = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);

    const first = await admin.api.put(SETLISTS_URL, {
      data: {
        type: "sunday",
        week: FIXTURE_DATE.sundayDraft,
        observed: observedSingle(before?._id as string, before?._rev as string),
        songs: songRows(SONGS.a),
      },
      failOnStatusCode: false,
    });
    expect(first.status()).toBe(200);
    const moved = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);

    const stale = await admin.api.put(SETLISTS_URL, {
      data: {
        type: "sunday",
        week: FIXTURE_DATE.sundayDraft,
        observed: observedSingle(before?._id as string, before?._rev as string),
        songs: songRows(SONGS.b),
      },
      failOnStatusCode: false,
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()) as { conflict: boolean }).toMatchObject({ conflict: true });

    const after = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);
    expect(after?._rev, "a conflicted save must write nothing").toBe(moved?._rev);
    expect((after?.songs ?? []).map((s) => s.song?._ref)).toEqual([SONGS.a]);
  });

  test("rejects an observed singleton that is a DIFFERENT document (identity_mismatch)", async ({
    admin,
    run,
  }) => {
    const target = await readWeekendSetlist(run.identity, SETLISTS.sundayReady);
    const other = await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty);

    const res = await admin.api.put(SETLISTS_URL, {
      data: {
        type: "sunday",
        week: FIXTURE_DATE.sundayDraft,
        // Right week, wrong document.
        observed: observedSingle(other?._id as string, other?._rev as string),
        songs: songRows(SONGS.b),
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);

    expect((await readWeekendSetlist(run.identity, SETLISTS.sundayReady))?._rev).toBe(target?._rev);
    expect((await readWeekendSetlist(run.identity, SETLISTS.sundayEmpty))?._rev).toBe(other?._rev);
  });

  test("creates the deterministic document when observed-none is accurate", async ({
    admin,
    run,
  }) => {
    // `sundayVacant` has no setlist at all.
    const week = FIXTURE_DATE.sundayVacant;
    expect(
      await readWeekendSetlistsForWeek(run.identity, { type: "featuredSongs", week }),
    ).toEqual([]);

    const res = await admin.api.put(SETLISTS_URL, {
      data: { type: "sunday", week, observed: observedNone(), songs: songRows(SONGS.a, SONGS.b) },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);

    const created = await readWeekendSetlistsForWeek(run.identity, {
      type: "featuredSongs",
      week,
    });
    expect(created, "observed-none must create exactly one deterministic document").toHaveLength(1);
    run.recordCreated(created[0]._id, "setlist/observed-none");
    expect((created[0].songs ?? []).map((s) => s.song?._ref)).toEqual([SONGS.a, SONGS.b]);

    run.evidence("setlist_observed_none_created", { id: created[0]._id, week });
  });

  test("rejects observed-none when a target already exists (concurrent_creation)", async ({
    admin,
    run,
  }) => {
    // The Saturday week already has the (deliberately typo'd) `saturdarSongs` document.
    const week = FIXTURE_DATE.saturdayPublished;
    const before = await readWeekendSetlist(run.identity, SETLISTS.saturdayIncomplete);
    expect(before?._type).toBe("saturdarSongs");

    const res = await admin.api.put(SETLISTS_URL, {
      data: { type: "saturday", week, observed: observedNone(), songs: songRows(SONGS.c) },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(409);
    expect((await res.json()) as { conflict: boolean }).toMatchObject({ conflict: true });

    const after = await readWeekendSetlist(run.identity, SETLISTS.saturdayIncomplete);
    expect(after?._rev, "a concurrent-creation refusal must write nothing").toBe(before?._rev);
    expect(
      await readWeekendSetlistsForWeek(run.identity, { type: "saturdarSongs", week }),
      "and must not create a second document for the week",
    ).toHaveLength(1);
  });
});
