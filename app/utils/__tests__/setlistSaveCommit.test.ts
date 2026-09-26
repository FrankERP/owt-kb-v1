// `saveSetlist`'s OUTCOME contract — what the admin route and the MCP
// `edit_setlist` tool both receive from the one setlist writer.
//
// The writer's BEHAVIOUR (every refusal, every transaction op, every notice) is
// pinned end to end through the admin route by `setlistWriteRoute.test.ts`,
// `setlistsRoute.test.ts` and `setlistNoticeQueueing.test.ts`, which stayed
// unchanged when the body moved here. What those cannot see is the part only a
// caller of the module gets: `effects`, the values the write already held — the
// target, the written songs with their new `_key`s, the pre-commit subject and
// the step-2 descriptors of what the post-commit helpers queued. The tool builds
// its report and its fresh-observation check from exactly these, so they are
// pinned here with the loaders and helpers mocked at their module seams.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  transactions: [] as { ops: unknown[]; committed: boolean }[],
  commitError: null as Error | null,
  keys: 0,
  loadWeekendSetlistTarget: vi.fn(),
  loadWeekendCoordination: vi.fn(),
  loadSpecialSetlistTarget: vi.fn(),
  notifySetlistSaved: vi.fn(),
  queueSetlistNotice: vi.fn(),
  revalidateSetlistSave: vi.fn(),
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  writeClient: {
    transaction: () => {
      const record = { ops: [] as unknown[], committed: false };
      h.transactions.push(record);
      const tx = {
        create(doc: unknown) {
          record.ops.push({ create: doc });
          return tx;
        },
        patch(id: string, build: (p: unknown) => unknown) {
          const op = { patch: id, rev: null as string | null, set: null as unknown };
          const builder = {
            ifRevisionId(rev: string) {
              op.rev = rev;
              return builder;
            },
            set(value: unknown) {
              op.set = value;
              return builder;
            },
          };
          build(builder);
          record.ops.push(op);
          return tx;
        },
        async commit() {
          if (h.commitError) throw h.commitError;
          record.committed = true;
        },
      };
      return tx;
    },
  },
}));

vi.mock("@/app/utils/roleWriteOps", () => ({
  nextKey: () => `k${++h.keys}`,
  nowIso: () => "2026-09-26T18:00:00.000Z",
}));

vi.mock("@/app/utils/serviceWriteTargets", () => ({
  loadWeekendSetlistTarget: (...a: unknown[]) => h.loadWeekendSetlistTarget(...a),
  loadWeekendCoordination: (...a: unknown[]) => h.loadWeekendCoordination(...a),
  loadSpecialSetlistTarget: (...a: unknown[]) => h.loadSpecialSetlistTarget(...a),
}));

vi.mock("@/app/utils/serviceMutationSideEffects", () => ({
  notifySetlistSaved: (...a: unknown[]) => h.notifySetlistSaved(...a),
  queueSetlistNotice: (...a: unknown[]) => h.queueSetlistNotice(...a),
  revalidateSetlistSave: () => h.revalidateSetlistSave(),
  serviceParticipants: (role: { participants?: string[] }) => [...(role.participants ?? [])],
}));

import { saveSetlist } from "@/app/utils/setlistSaveCommit";

const WEEK = "2026-10-04";
const PUSH = { recipients: ["m-1", "m-2"] };
const NOTICE = { kind: "setlist", roleId: "role-sun", knownRecipients: ["m-1"] };

function weekendOwner(published: unknown) {
  return { _id: "role-sun", _rev: "rrev", _type: "sunday_role", published, participants: ["m-1"] };
}

function mockWeekend(owner: ReturnType<typeof weekendOwner> | null) {
  h.loadWeekendSetlistTarget.mockResolvedValue({
    ok: true,
    target: { server: { state: "none" }, record: null },
  });
  h.loadWeekendCoordination.mockResolvedValue({
    ok: true,
    coordination: {
      role: owner,
      lock: owner ? { _id: "lock-1", _rev: "lrev", _type: "roleTargetLock" } : null,
      bootstrapped: false,
    },
  });
}

const weekendBody = {
  week: WEEK,
  type: "sunday",
  observed: { state: "none" },
  songs: [{ songId: "song-a", play_key: "G" }, { songId: "song-b" }],
};

const WRITTEN_WEEKEND_SONGS = [
  { _type: "setlist_song", _key: "k1", play_key: "G", song: { _type: "reference", _ref: "song-a" } },
  { _type: "setlist_song", _key: "k2", song: { _type: "reference", _ref: "song-b" } },
];

beforeEach(() => {
  h.transactions.length = 0;
  h.commitError = null;
  h.keys = 0;
  for (const fn of [
    h.loadWeekendSetlistTarget,
    h.loadWeekendCoordination,
    h.loadSpecialSetlistTarget,
    h.notifySetlistSaved,
    h.queueSetlistNotice,
    h.revalidateSetlistSave,
  ]) {
    fn.mockReset();
  }
  h.notifySetlistSaved.mockResolvedValue(PUSH);
  // The real helper returns null when `input.published === false` — mirror that
  // instead of a blanket NOTICE, so the draft test below exercises the actual
  // published-gating behaviour rather than only a pass-through mock.
  h.queueSetlistNotice.mockImplementation((input: { published?: unknown }) =>
    input?.published === false ? null : NOTICE,
  );
});

describe("saveSetlist — success outcome", () => {
  it("a published weekend create reports the target, the written songs, the subject and both descriptors", async () => {
    mockWeekend(weekendOwner(true));

    const outcome = await saveSetlist(weekendBody);

    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, setlistId: `featuredSongs.${WEEK}`, created: true },
      effects: {
        kind: "sunday",
        week: WEEK,
        roleId: "role-sun",
        setlistId: `featuredSongs.${WEEK}`,
        created: true,
        songs: WRITTEN_WEEKEND_SONGS,
        subject: {
          roleId: "role-sun",
          roleType: "sunday_role",
          published: true,
          beforeSongs: [],
          knownRecipients: ["m-1"],
        },
        push: PUSH,
        notice: NOTICE,
      },
    });
    // The songs in `effects` are the very documents the transaction wrote.
    expect(h.transactions).toHaveLength(1);
    expect(h.transactions[0].committed).toBe(true);
    expect(h.transactions[0].ops[0]).toEqual({
      create: expect.objectContaining({ _id: `featuredSongs.${WEEK}`, songs: WRITTEN_WEEKEND_SONGS }),
    });
    expect(h.notifySetlistSaved).toHaveBeenCalledWith(WEEK);
  });

  it("hands back a COPY of the recipients the deferred notice holds, so editing it cannot reach the outbox", async () => {
    mockWeekend(weekendOwner(true));

    const outcome = await saveSetlist(weekendBody);

    if (!outcome.ok || !outcome.effects.subject) throw new Error("expected a subject");
    const queued = h.queueSetlistNotice.mock.calls[0][0] as { knownRecipients: string[] };
    outcome.effects.subject.knownRecipients.push("m-intruder");
    outcome.effects.subject.knownRecipients.reverse();
    expect(queued.knownRecipients).toEqual(["m-1"]);
  });

  it("a draft service reports no push (the helper is never called) and no notice (the real helper declines a draft)", async () => {
    mockWeekend(weekendOwner(false));

    const outcome = await saveSetlist(weekendBody);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(h.notifySetlistSaved).not.toHaveBeenCalled();
    expect(outcome.effects.push).toBeNull();
    expect(h.queueSetlistNotice).toHaveBeenCalled();
    expect(outcome.effects.notice).toBeNull();
    expect(outcome.effects.subject?.published).toBe(false);
  });

  it("a role-less week reports no subject, no role and no descriptors", async () => {
    mockWeekend(null);

    const outcome = await saveSetlist(weekendBody);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.effects).toMatchObject({ roleId: null, subject: null, push: null, notice: null });
    expect(h.notifySetlistSaved).not.toHaveBeenCalled();
    expect(h.queueSetlistNotice).not.toHaveBeenCalled();
  });

  it("a helper that skipped silently surfaces as null, never as a guess", async () => {
    mockWeekend(weekendOwner(true));
    h.notifySetlistSaved.mockResolvedValue(null);
    h.queueSetlistNotice.mockReturnValue(null);

    const outcome = await saveSetlist(weekendBody);

    expect(outcome.ok && outcome.effects.push).toBeNull();
    expect(outcome.ok && outcome.effects.notice).toBeNull();
  });

  it("a special patch reports the role as the target, with leader references keyed", async () => {
    const role = {
      _id: "role-sp",
      _rev: "srev",
      _type: "special_role",
      published: true,
      format: "worship_night",
      Lead: [{ _key: "l1", _ref: "m-1" }],
      songs: [{ _key: "old", song: { _ref: "song-z" } }],
      participants: ["m-1", "m-3"],
    };
    h.loadSpecialSetlistTarget.mockResolvedValue({
      ok: true,
      target: { role, record: role, server: { state: "single", id: "role-sp", rev: "srev" } },
    });

    const outcome = await saveSetlist({
      week: WEEK,
      type: "special",
      roleId: "role-sp",
      observed: { state: "single", id: "role-sp", rev: "srev" },
      songs: [{ songId: "song-a", leadIds: ["m-1"] }],
    });

    const written = [
      {
        _type: "setlist_song",
        _key: "k1",
        song: { _type: "reference", _ref: "song-a" },
        leads: [{ _key: "k2", _type: "reference", _ref: "m-1" }],
      },
    ];
    expect(outcome).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, setlistId: "role-sp", created: false },
      effects: {
        kind: "special",
        week: WEEK,
        roleId: "role-sp",
        setlistId: "role-sp",
        created: false,
        songs: written,
        subject: {
          roleId: "role-sp",
          roleType: "special_role",
          published: true,
          beforeSongs: role.songs,
          knownRecipients: ["m-1", "m-3"],
        },
        push: PUSH,
        notice: NOTICE,
      },
    });
    expect(h.transactions[0].ops).toEqual([{ patch: "role-sp", rev: "srev", set: { songs: written } }]);
  });
});

describe("saveSetlist — refusals carry the route's status and body, and no effects", () => {
  it("an unparseable body is a 400 invalid_request before any read", async () => {
    const outcome = await saveSetlist({ week: WEEK, type: "nope" });

    expect(outcome).toEqual({
      ok: false,
      status: 400,
      body: expect.objectContaining({ error: "invalid_request", details: { issues: ["type"] } }),
    });
    expect(outcome).not.toHaveProperty("effects");
    expect(h.loadWeekendSetlistTarget).not.toHaveBeenCalled();
    expect(h.transactions).toHaveLength(0);
  });

  it("a stale observed target is a 409 with no transaction and no notice", async () => {
    mockWeekend(weekendOwner(true));

    const outcome = await saveSetlist({
      ...weekendBody,
      observed: { state: "single", id: `featuredSongs.${WEEK}`, rev: "old" },
    });

    expect(outcome).toMatchObject({ ok: false, status: 409, body: { error: "stale_revision" } });
    expect(h.transactions).toHaveLength(0);
    expect(h.notifySetlistSaved).not.toHaveBeenCalled();
    expect(h.queueSetlistNotice).not.toHaveBeenCalled();
  });

  it("a commit that fails for a reason other than a conflict still throws, as the route's 500 does", async () => {
    mockWeekend(weekendOwner(true));
    h.commitError = new Error("network down");

    await expect(saveSetlist(weekendBody)).rejects.toThrow("network down");
    expect(h.revalidateSetlistSave).not.toHaveBeenCalled();
  });
});
