// Table-driven tests for the pure service-readiness model (Plan B item 2).
//
// The ambient timezone is deliberately NOT America/Mexico_City so every date
// assertion proves the local-noon / explicit-timeZone rules rather than
// accidentally passing on a Mexico-configured machine. Pacific/Honolulu is
// UTC-10 with no DST, so a bare `new Date("YYYY-MM-DD")` day-flips there.
process.env.TZ = "Pacific/Honolulu";

import { describe, expect, it } from "vitest";

import {
  CONTROL_REQUIRED_SOURCES,
  PRIMARY_ACTION_LABELS,
  SERVICE_CONTROLS,
  SERVICE_SOURCE_KEYS,
  computeAvailabilityConflicts,
  creatableTargets,
  deriveAvailabilityStatus,
  deriveDataConfidence,
  deriveProposalPresentation,
  derivePublishState,
  deriveRoleTargetStatus,
  deriveServiceReadiness,
  deriveSetlist,
  deriveTargetPreflight,
  deriveTeam,
  isControlEnabled,
  isOperationallyReady,
  isPastServiceDate,
  isReadyToPublish,
  lockIssuesToIntegrity,
  parseServiceDateAtNoon,
  resolvePrimaryAction,
  selectServiceCapabilities,
  serviceDayOffset,
  serviceTodayIso,
  unreadySources,
  type ProposalObservation,
  type ReadinessDimensions,
  type ServiceControl,
  type ServiceSourceKey,
  type ServiceSourceStates,
  type SourceState,
  type TargetPreflightInput,
} from "../serviceReadiness";
import { resolveMembers, validateRole, type CanonicalMember } from "@/app/utils/serviceReadModel";
import { buildSetlistRead } from "@/app/utils/setlistReadContract";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_READY: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

function sources(over: Partial<ServiceSourceStates> = {}): ServiceSourceStates {
  return { ...ALL_READY, ...over };
}

/** A fully clean, operationally ready draft. */
function cleanDimensions(over: Partial<ReadinessDimensions> = {}): ReadinessDimensions {
  return {
    sources: ALL_READY,
    publishState: "draft",
    recordStatus: "valid",
    roleTargetStatus: "single",
    teamStatus: "assigned",
    danglingRefCount: 0,
    setlistStatus: "ready",
    proposalPresentation: "none",
    availabilityStatus: "clear",
    blockingIssueCount: 0,
    ...over,
  };
}

function readSingle(songs: unknown[], recent: Record<string, string> = {}) {
  return buildSetlistRead([{ id: "sl1", rev: "r1", songs }], [], recent);
}

const SONG_OK = {
  _key: "k1",
  play_key: "G",
  songRef: "song1",
  song: { _id: "song1", title: "Uno" },
};

// ── dataConfidence ────────────────────────────────────────────────────────────

describe("deriveDataConfidence", () => {
  it("is complete only when all five sources are ready", () => {
    expect(deriveDataConfidence(ALL_READY)).toBe("complete");
  });

  it("is error when the roles source fails, whatever the others do", () => {
    for (const other of SERVICE_SOURCE_KEYS.filter((k) => k !== "roles")) {
      for (const state of ["loading", "ready", "error"] as SourceState[]) {
        expect(
          deriveDataConfidence(sources({ roles: "error", [other]: state })),
        ).toBe("error");
      }
    }
  });

  it("is partial for every non-roles loading/error combination", () => {
    for (const key of SERVICE_SOURCE_KEYS) {
      for (const state of ["loading", "error"] as SourceState[]) {
        const conf = deriveDataConfidence(sources({ [key]: state }));
        if (key === "roles" && state === "error") expect(conf).toBe("error");
        else expect(conf).toBe("partial");
      }
    }
  });

  it("covers the exhaustive 3^5 source-state space with only the three documented rules", () => {
    const states: SourceState[] = ["loading", "ready", "error"];
    let seen = 0;
    for (const roles of states)
      for (const members of states)
        for (const proposals of states)
          for (const roleTargets of states)
            for (const setlistTargets of states) {
              const s: ServiceSourceStates = {
                roles,
                members,
                proposals,
                roleTargets,
                setlistTargets,
              };
              const all = Object.values(s);
              const expected =
                roles === "error"
                  ? "error"
                  : all.every((v) => v === "ready")
                    ? "complete"
                    : "partial";
              expect(deriveDataConfidence(s)).toBe(expected);
              seen += 1;
            }
    expect(seen).toBe(243);
  });
});

describe("unreadySources", () => {
  it("reports only the required sources that are not ready, with their state", () => {
    expect(
      unreadySources(sources({ members: "loading", proposals: "error" }), [
        "roles",
        "members",
        "proposals",
      ]),
    ).toEqual([
      { source: "members", state: "loading" },
      { source: "proposals", state: "error" },
    ]);
  });

  it("ignores a failure in a source the caller does not require", () => {
    expect(unreadySources(sources({ proposals: "error" }), ["roles", "members"])).toEqual([]);
  });
});

// ── publishState ──────────────────────────────────────────────────────────────

describe("derivePublishState", () => {
  it("treats only an explicit false as draft", () => {
    expect(derivePublishState(false)).toBe("draft");
  });

  it("grandfathers a missing/legacy published field as published", () => {
    expect(derivePublishState(undefined)).toBe("published");
    expect(derivePublishState(null)).toBe("published");
    expect(derivePublishState(true)).toBe("published");
    expect(derivePublishState("false")).toBe("published");
    expect(derivePublishState(0)).toBe("published");
  });
});

// ── roleTargetStatus ──────────────────────────────────────────────────────────

describe("deriveRoleTargetStatus", () => {
  it("is unknown while the role-target source is loading or failed", () => {
    expect(deriveRoleTargetStatus("loading", "single")).toBe("unknown");
    expect(deriveRoleTargetStatus("error", "single")).toBe("unknown");
  });

  it("is unknown when the source is ready but no observation proves a target", () => {
    expect(deriveRoleTargetStatus("ready", null)).toBe("unknown");
  });

  it("maps A1's observed public target states", () => {
    expect(deriveRoleTargetStatus("ready", "single")).toBe("single");
    expect(deriveRoleTargetStatus("ready", "duplicate")).toBe("duplicate");
    expect(deriveRoleTargetStatus("ready", "draft_conflict")).toBe("draft_conflict");
    expect(deriveRoleTargetStatus("ready", "invalid")).toBe("invalid");
  });

  it("treats an observed `none` target for an existing card as invalid, never single", () => {
    expect(deriveRoleTargetStatus("ready", "none")).toBe("invalid");
  });
});

// ── team status across all five seat paths ────────────────────────────────────

const MEMBERS: CanonicalMember[] = [
  { _id: "m1", _rev: "v1", member_name: "Ana" },
  { _id: "m2", _rev: "v1", member_name: "Beto", alias: "  Bet  " },
  { _id: "m3", _rev: "v1", member_name: "Cris" },
  { _id: "m4", _rev: "v1", member_name: "Dani" },
  { _id: "m5", _rev: "v1", member_name: "Eva" },
];

const MEMBERS_BY_ID = new Map(MEMBERS.map((m) => [m._id, m]));

function roleDoc(over: Record<string, unknown> = {}) {
  return {
    _id: "role1",
    _rev: "rev1",
    _type: "sunday_role",
    week: "2026-08-02",
    Lead: [],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
    ...over,
  };
}

function ref(key: string, id: string) {
  return { _key: key, _type: "reference", _ref: id };
}

function teamFromRole(doc: Record<string, unknown>, membersSource: SourceState = "ready") {
  const v = validateRole(doc);
  const { danglingRefs } = resolveMembers(v.assignedRefs, MEMBERS_BY_ID);
  return deriveTeam({ membersSource, assignedRefs: v.assignedRefs, danglingRefs });
}

describe("deriveTeam", () => {
  it("is unknown while the members source is loading or failed, never empty", () => {
    for (const state of ["loading", "error"] as SourceState[]) {
      const t = deriveTeam({ membersSource: state, assignedRefs: [], danglingRefs: [] });
      expect(t.status).toBe("unknown");
    }
  });

  it("is empty only with a ready members source and zero refs across all five paths", () => {
    const t = teamFromRole(roleDoc());
    expect(t.status).toBe("empty");
    expect(t.summary).toEqual({ assignedRefCount: 0, resolvedCount: 0, danglingCount: 0 });
  });

  it("is assigned when every ref in all five seat paths resolves", () => {
    const t = teamFromRole(
      roleDoc({
        Lead: [ref("a", "m1")],
        BGVs: [ref("b", "m2")],
        Chorus: [ref("c", "m3")],
        instruments: [
          { _key: "d", _type: "instrument_slot", instrument: "Guitarra", person: { _type: "reference", _ref: "m4" } },
        ],
        foh_team: [
          { _key: "e", _type: "foh_slot", role: "Audio", person: { _type: "reference", _ref: "m5" } },
        ],
      }),
    );
    expect(t.status).toBe("assigned");
    expect(t.danglingRefs).toEqual([]);
    expect(t.summary).toEqual({ assignedRefCount: 5, resolvedCount: 5, danglingCount: 0 });
  });

  const DANGLING_PATHS: { path: string; doc: Record<string, unknown> }[] = [
    { path: "Lead", doc: { Lead: [ref("a", "ghost")] } },
    { path: "BGVs", doc: { BGVs: [ref("b", "ghost")] } },
    { path: "Chorus", doc: { Chorus: [ref("c", "ghost")] } },
    {
      path: "instruments",
      doc: {
        instruments: [
          { _key: "d", _type: "instrument_slot", instrument: "Bajo", person: { _type: "reference", _ref: "ghost" } },
        ],
      },
    },
    {
      path: "foh_team",
      doc: {
        foh_team: [
          { _key: "e", _type: "foh_slot", role: "Video", person: { _type: "reference", _ref: "ghost" } },
        ],
      },
    },
  ];

  it.each(DANGLING_PATHS)(
    "a dangling ref in $path is never collapsed to empty or assigned",
    ({ doc }) => {
      const t = teamFromRole(roleDoc(doc));
      expect(t.status).toBe("unknown");
      expect(t.status).not.toBe("empty");
      expect(t.status).not.toBe("assigned");
      expect(t.danglingRefs).toEqual(["ghost"]);
      expect(t.summary.danglingCount).toBe(1);
    },
  );

  it("keeps a partially resolvable team out of `assigned`", () => {
    const t = teamFromRole(roleDoc({ Lead: [ref("a", "m1"), ref("b", "ghost")] }));
    expect(t.status).toBe("unknown");
    expect(t.summary).toEqual({ assignedRefCount: 2, resolvedCount: 1, danglingCount: 1 });
  });

  const NULL_REF_PATHS: { path: string; doc: Record<string, unknown> }[] = [
    { path: "Lead", doc: { Lead: [{ _key: "a", _type: "reference", _ref: null }] } },
    { path: "BGVs", doc: { BGVs: [{ _key: "b", _type: "reference" }] } },
    { path: "Chorus", doc: { Chorus: [{ _key: "c", _type: "reference", _ref: "" }] } },
    {
      path: "instruments",
      doc: {
        instruments: [
          { _key: "d", _type: "instrument_slot", instrument: "Bajo", person: { _type: "reference", _ref: null } },
        ],
      },
    },
    {
      path: "foh_team",
      doc: { foh_team: [{ _key: "e", _type: "foh_slot", role: "Audio", person: null }] },
    },
  ];

  it.each(NULL_REF_PATHS)(
    "a null/missing ref in $path invalidates the record instead of reading as empty",
    ({ doc, path }) => {
      const v = validateRole(roleDoc(doc));
      expect(v.groupable).toBe(false);
      expect(v.issues).toContain(`seat:${path}`);
      // The seat contributes no refs, so the team alone would look "empty" —
      // the record status is what blocks it, which the model asserts below.
      const t = teamFromRole(roleDoc(doc));
      expect(t.status).toBe("empty");
      const model = deriveServiceReadiness({
        sources: ALL_READY,
        published: false,
        recordValid: v.groupable,
        roleTarget: "single",
        team: { assignedRefs: v.assignedRefs, danglingRefs: [] },
        setlistResponse: readSingle([SONG_OK]),
        proposal: emptyProposals(),
        serviceDate: "2026-08-02",
        members: [],
      });
      expect(model.recordStatus).toBe("invalid");
      expect(model.isOperationallyReady).toBe(false);
      expect(model.primaryAction.rule).toBe(1);
    },
  );
});

// ── setlist collapse matrix ───────────────────────────────────────────────────

function emptyProposals(): ProposalObservation {
  return { validated: [], conflicts: [], recordIssues: [], draftIds: [] };
}

describe("deriveSetlist — A1 collapse matrix", () => {
  it("target none -> none, editable (creates a new target)", () => {
    const d = deriveSetlist("ready", buildSetlistRead([], [], {}));
    expect(d.status).toBe("none");
    expect(d.editable).toBe(true);
  });

  it("target single + content empty -> incomplete, editable", () => {
    const d = deriveSetlist("ready", readSingle([]));
    expect(d.status).toBe("incomplete");
    expect(d.editable).toBe(true);
  });

  it("target single + content incomplete (blank play_key) -> incomplete, editable", () => {
    const d = deriveSetlist("ready", readSingle([{ ...SONG_OK, play_key: "" }]));
    expect(d.status).toBe("incomplete");
    expect(d.editable).toBe(true);
  });

  it("target single + content ready -> ready, editable", () => {
    const d = deriveSetlist("ready", readSingle([SONG_OK]));
    expect(d.status).toBe("ready");
    expect(d.editable).toBe(true);
  });

  it("target single + content invalid -> invalid, NOT editable", () => {
    const d = deriveSetlist("ready", readSingle([{ _key: "k1", play_key: "G", songRef: "gone" }]));
    expect(d.status).toBe("invalid");
    expect(d.editable).toBe(false);
    expect(d.issue).toBe("invalid_content");
  });

  it("target duplicate -> duplicate, NOT editable", () => {
    const d = deriveSetlist(
      "ready",
      buildSetlistRead(
        [
          { id: "a", rev: "1", songs: [] },
          { id: "b", rev: "1", songs: [] },
        ],
        [],
        {},
      ),
    );
    expect(d.status).toBe("duplicate");
    expect(d.editable).toBe(false);
  });

  it("target draft_conflict -> draft_conflict, NOT editable", () => {
    const d = deriveSetlist(
      "ready",
      buildSetlistRead([{ id: "a", rev: "1", songs: [] }], ["drafts.a"], {}),
    );
    expect(d.status).toBe("draft_conflict");
    expect(d.editable).toBe(false);
  });

  it("target invalid (malformed canonical identity) -> invalid, NOT editable", () => {
    const d = deriveSetlist("ready", buildSetlistRead([{ id: "", rev: "", songs: [] }], [], {}));
    expect(d.status).toBe("invalid");
    expect(d.editable).toBe(false);
    expect(d.issue).toBe("invalid_target");
  });

  it("source not loaded / failed -> unknown, NOT editable", () => {
    for (const state of ["loading", "error"] as SourceState[]) {
      const d = deriveSetlist(state, readSingle([SONG_OK]));
      expect(d.status).toBe("unknown");
      expect(d.editable).toBe(false);
    }
    const missing = deriveSetlist("ready", null);
    expect(missing.status).toBe("unknown");
    expect(missing.editable).toBe(false);
  });

  it("a structurally unexpected response fails closed to invalid, never editable-empty", () => {
    for (const body of [{}, { targetState: "weird", songs: [], recentSongs: {}, setlistId: null }, 42]) {
      const d = deriveSetlist("ready", body);
      expect(d.status).toBe("invalid");
      expect(d.editable).toBe(false);
    }
  });

  const MALFORMED_CONTENT: { name: string; songs: unknown[] }[] = [
    { name: "missing _key", songs: [{ play_key: "G", songRef: "song1", song: { _id: "song1" } }] },
    {
      name: "duplicate _key",
      songs: [
        { _key: "dup", play_key: "G", songRef: "song1", song: { _id: "song1" } },
        { _key: "dup", play_key: "A", songRef: "song1", song: { _id: "song1" } },
      ],
    },
    { name: "dangling song reference", songs: [{ _key: "k", play_key: "G", songRef: "gone" }] },
    { name: "non-object row", songs: ["nope"] },
  ];

  it.each(MALFORMED_CONTENT)(
    "$name content is invalid (integrity), never ordinary incomplete",
    ({ songs }) => {
      const d = deriveSetlist("ready", readSingle(songs));
      expect(d.status).toBe("invalid");
      expect(d.status).not.toBe("incomplete");
      expect(d.editable).toBe(false);
    },
  );

  it("routes malformed content to the integrity action, not the setlist editor", () => {
    const model = baseModelInput({
      setlistResponse: readSingle([{ _key: "dup", songRef: "gone" }]),
    });
    const r = deriveServiceReadiness(model);
    expect(r.setlistStatus).toBe("invalid");
    expect(r.setlistEditable).toBe(false);
    expect(r.primaryAction.kind).toBe("review_setlist_data");
    expect(r.integrityIssues.some((i) => i.kind === "setlist_invalid" && i.blocking)).toBe(true);
  });
});

// ── proposal presentation ─────────────────────────────────────────────────────

describe("deriveProposalPresentation", () => {
  it("maps a route load failure/loading to unknown, never to `none`", () => {
    for (const state of ["loading", "error"] as SourceState[]) {
      expect(deriveProposalPresentation(state, emptyProposals())).toBe("unknown");
    }
    expect(deriveProposalPresentation("ready", null)).toBe("unknown");
  });

  it("maps associated A1 record issues to invalid", () => {
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        recordIssues: [{ id: "p1", issues: ["date_mismatch"] }],
      }),
    ).toBe("invalid");
  });

  it("maps associated raw draft ids to draft_conflict", () => {
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        draftIds: ["drafts.p1"],
      }),
    ).toBe("draft_conflict");
  });

  it("maps either A1 grouping-conflict result to conflict", () => {
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        conflicts: [{ key: "sunday:2026-08-02", ids: ["p1", "p2"] }],
      }),
    ).toBe("conflict");
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        conflicts: [{ key: "role1", ids: ["p1", "p2"] }],
      }),
    ).toBe("conflict");
  });

  it("maps an empty validated group to none", () => {
    expect(deriveProposalPresentation("ready", emptyProposals())).toBe("none");
  });

  it.each(["draft", "pending", "changes_requested", "approved"] as const)(
    "maps exactly one conflict-free validated record to its stored status %s",
    (status) => {
      expect(
        deriveProposalPresentation("ready", {
          ...emptyProposals(),
          validated: [{ id: "p1", status }],
        }),
      ).toBe(status);
    },
  );

  it("never picks a winner: more than one validated record without an explicit conflict is conflict", () => {
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        validated: [
          { id: "p1", status: "pending" },
          { id: "p2", status: "approved" },
        ],
      }),
    ).toBe("conflict");
  });

  it("does not invent a status for an unrecognized stored value", () => {
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        validated: [{ id: "p1", status: "stale" }],
      }),
    ).toBe("invalid");
    expect(
      deriveProposalPresentation("ready", {
        ...emptyProposals(),
        validated: [{ id: "p1", status: null }],
      }),
    ).toBe("invalid");
  });

  it("prefers the integrity mapping when an issue and a validated record coexist", () => {
    expect(
      deriveProposalPresentation("ready", {
        validated: [{ id: "p1", status: "approved" }],
        conflicts: [],
        recordIssues: [{ id: "p2", issues: ["identity"] }],
        draftIds: ["drafts.p1"],
      }),
    ).toBe("invalid");
    expect(
      deriveProposalPresentation("ready", {
        validated: [{ id: "p1", status: "approved" }],
        conflicts: [{ key: "k", ids: ["p1", "p3"] }],
        recordIssues: [],
        draftIds: ["drafts.p1"],
      }),
    ).toBe("draft_conflict");
  });
});

// ── availability ──────────────────────────────────────────────────────────────

describe("computeAvailabilityConflicts / deriveAvailabilityStatus", () => {
  const team: CanonicalMember[] = [
    { _id: "m1", _rev: "v", member_name: "Ana", unavailableDates: ["2026-08-02"] },
    { _id: "m2", _rev: "v", member_name: "Beto", alias: " Bet ", unavailableDates: ["2026-08-09"] },
  ];

  it("flags only members unavailable on the exact service day, using alias display names", () => {
    expect(computeAvailabilityConflicts(team, "2026-08-02")).toEqual([
      { memberId: "m1", memberName: "Ana" },
    ]);
    expect(computeAvailabilityConflicts(team, "2026-08-09")).toEqual([
      { memberId: "m2", memberName: "Bet" },
    ]);
    expect(computeAvailabilityConflicts(team, "2026-08-16")).toEqual([]);
  });

  it("attaches a per-date note when one is stored", () => {
    const withNote = [
      {
        _id: "m1",
        _rev: "v",
        member_name: "Ana",
        unavailableDates: ["2026-08-02"],
        unavailabilityNotes: [{ date: "2026-08-02", note: "Viaje" }],
      },
    ];
    expect(computeAvailabilityConflicts(withNote, "2026-08-02")).toEqual([
      { memberId: "m1", memberName: "Ana", note: "Viaje" },
    ]);
  });

  it("computes nothing for a missing service date", () => {
    expect(computeAvailabilityConflicts(team, null)).toEqual([]);
  });

  it("is unknown while members are loading/failed — never clear", () => {
    for (const state of ["loading", "error"] as SourceState[]) {
      expect(
        deriveAvailabilityStatus({
          membersSource: state,
          teamStatus: "assigned",
          serviceDate: "2026-08-02",
          conflicts: [],
        }),
      ).toBe("unknown");
    }
  });

  it("is unknown when the team itself is unknown (dangling/unresolved refs)", () => {
    expect(
      deriveAvailabilityStatus({
        membersSource: "ready",
        teamStatus: "unknown",
        serviceDate: "2026-08-02",
        conflicts: [],
      }),
    ).toBe("unknown");
  });

  it("is unknown for a missing service date", () => {
    expect(
      deriveAvailabilityStatus({
        membersSource: "ready",
        teamStatus: "assigned",
        serviceDate: null,
        conflicts: [],
      }),
    ).toBe("unknown");
  });

  it("is conflict when any resolved seat is unavailable, otherwise clear", () => {
    expect(
      deriveAvailabilityStatus({
        membersSource: "ready",
        teamStatus: "assigned",
        serviceDate: "2026-08-02",
        conflicts: [{ memberId: "m1", memberName: "Ana" }],
      }),
    ).toBe("conflict");
    expect(
      deriveAvailabilityStatus({
        membersSource: "ready",
        teamStatus: "empty",
        serviceDate: "2026-08-02",
        conflicts: [],
      }),
    ).toBe("clear");
  });
});

// ── lock issue adapter ────────────────────────────────────────────────────────

describe("lockIssuesToIntegrity", () => {
  it("turns every A1/A2 lock issue into a blocking integrity issue", () => {
    const out = lockIssuesToIntegrity([
      { kind: "missing_lock", lockId: null, targetKey: "sunday_role:2026-08-02" },
      { kind: "wrong_owner", lockId: "lock1", targetKey: "sunday_role:2026-08-02", roleId: "r9" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.kind === "lock" && i.blocking)).toBe(true);
    expect(out[0].reason).toBe("missing_lock");
    expect(out[1].ids).toEqual(["lock1", "r9"]);
  });

  it("returns nothing when no lock inventory issue was reported", () => {
    expect(lockIssuesToIntegrity([])).toEqual([]);
  });
});

// ── readiness predicate ───────────────────────────────────────────────────────

describe("isOperationallyReady / isReadyToPublish", () => {
  it("is true for a fully clean record", () => {
    expect(isOperationallyReady(cleanDimensions())).toBe(true);
    expect(isReadyToPublish(cleanDimensions())).toBe(true);
  });

  const BLOCKING_ROWS: { row: string; over: Partial<ReadinessDimensions> }[] = [
    { row: "sources: roles loading", over: { sources: sources({ roles: "loading" }) } },
    { row: "sources: members loading", over: { sources: sources({ members: "loading" }) } },
    { row: "sources: proposals loading", over: { sources: sources({ proposals: "loading" }) } },
    { row: "sources: roleTargets loading", over: { sources: sources({ roleTargets: "loading" }) } },
    { row: "sources: setlistTargets loading", over: { sources: sources({ setlistTargets: "loading" }) } },
    { row: "sources: roles error", over: { sources: sources({ roles: "error" }) } },
    { row: "sources: members error", over: { sources: sources({ members: "error" }) } },
    { row: "sources: proposals error", over: { sources: sources({ proposals: "error" }) } },
    { row: "sources: roleTargets error", over: { sources: sources({ roleTargets: "error" }) } },
    { row: "sources: setlistTargets error", over: { sources: sources({ setlistTargets: "error" }) } },
    { row: "record invalid", over: { recordStatus: "invalid" } },
    { row: "role target duplicate", over: { roleTargetStatus: "duplicate" } },
    { row: "role target draft_conflict", over: { roleTargetStatus: "draft_conflict" } },
    { row: "role target invalid", over: { roleTargetStatus: "invalid" } },
    { row: "role target unknown", over: { roleTargetStatus: "unknown" } },
    { row: "team empty", over: { teamStatus: "empty" } },
    { row: "team unknown", over: { teamStatus: "unknown" } },
    { row: "team assigned with dangling refs", over: { danglingRefCount: 1 } },
    { row: "setlist none", over: { setlistStatus: "none" } },
    { row: "setlist incomplete", over: { setlistStatus: "incomplete" } },
    { row: "setlist duplicate", over: { setlistStatus: "duplicate" } },
    { row: "setlist draft_conflict", over: { setlistStatus: "draft_conflict" } },
    { row: "setlist invalid", over: { setlistStatus: "invalid" } },
    { row: "setlist unknown", over: { setlistStatus: "unknown" } },
    { row: "proposal draft", over: { proposalPresentation: "draft" } },
    { row: "proposal pending", over: { proposalPresentation: "pending" } },
    { row: "proposal changes_requested", over: { proposalPresentation: "changes_requested" } },
    { row: "proposal conflict", over: { proposalPresentation: "conflict" } },
    { row: "proposal invalid", over: { proposalPresentation: "invalid" } },
    { row: "proposal draft_conflict", over: { proposalPresentation: "draft_conflict" } },
    { row: "proposal unknown", over: { proposalPresentation: "unknown" } },
    { row: "availability conflict", over: { availabilityStatus: "conflict" } },
    { row: "availability unknown", over: { availabilityStatus: "unknown" } },
    { row: "blocking integrity issue", over: { blockingIssueCount: 1 } },
  ];

  it.each(BLOCKING_ROWS)("$row blocks operational readiness", ({ over }) => {
    const d = cleanDimensions(over);
    expect(isOperationallyReady(d)).toBe(false);
    expect(isReadyToPublish(d)).toBe(false);
  });

  it("treats proposal absence as clean when the live setlist is ready", () => {
    expect(isOperationallyReady(cleanDimensions({ proposalPresentation: "none" }))).toBe(true);
  });

  it("treats an approved proposal as clean", () => {
    expect(isOperationallyReady(cleanDimensions({ proposalPresentation: "approved" }))).toBe(true);
  });

  it("uses operational readiness as a health signal for published services but never as ready-to-publish", () => {
    const published = cleanDimensions({ publishState: "published" });
    expect(isOperationallyReady(published)).toBe(true);
    expect(isReadyToPublish(published)).toBe(false);
  });
});

// ── primary action priority (15 ordered rules) ─────────────────────────────────

describe("resolvePrimaryAction — the 15 ordered rules", () => {
  const R1_CASES: { name: string; over: Partial<ReadinessDimensions> }[] = [
    { name: "invalid service record", over: { recordStatus: "invalid" } },
    { name: "invalid proposal record", over: { proposalPresentation: "invalid" } },
    { name: "proposal raw-draft conflict", over: { proposalPresentation: "draft_conflict" } },
    { name: "role-target draft conflict", over: { roleTargetStatus: "draft_conflict" } },
    { name: "role-target invalid", over: { roleTargetStatus: "invalid" } },
    { name: "dangling assignment", over: { danglingRefCount: 1, teamStatus: "unknown" } },
    { name: "blocking legacy integrity issue", over: { blockingIssueCount: 1 } },
  ];

  it.each(R1_CASES)("rule 1 — $name -> Revisar datos", ({ over }) => {
    const a = resolvePrimaryAction(cleanDimensions(over));
    expect(a.rule).toBe(1);
    expect(a.kind).toBe("review_data");
    expect(a.label).toBe("Revisar datos");
    expect(a.disabled).toBe(false);
  });

  it("rule 1 outranks every lower rule when many problems coexist", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        sources: { roles: "loading", members: "error", proposals: "error", roleTargets: "loading", setlistTargets: "error" },
        recordStatus: "invalid",
        roleTargetStatus: "duplicate",
        teamStatus: "empty",
        danglingRefCount: 2,
        setlistStatus: "duplicate",
        proposalPresentation: "conflict",
        availabilityStatus: "conflict",
        blockingIssueCount: 3,
      }),
    );
    expect(a.rule).toBe(1);
  });

  it("rule 2 — role-target duplicate -> Revisar roles duplicados (over setlist/loading/error)", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        roleTargetStatus: "duplicate",
        setlistStatus: "duplicate",
        sources: sources({ members: "loading", proposals: "error" }),
        availabilityStatus: "conflict",
      }),
    );
    expect(a.rule).toBe(2);
    expect(a.kind).toBe("review_duplicate_roles");
    expect(a.label).toBe("Revisar roles duplicados");
  });

  it.each(["duplicate", "draft_conflict", "invalid"] as const)(
    "rule 3 — setlist %s -> Revisar datos del setlist (over loading/error)",
    (setlistStatus) => {
      const a = resolvePrimaryAction(
        cleanDimensions({
          setlistStatus,
          sources: sources({ setlistTargets: "loading", proposals: "error" }),
          availabilityStatus: "conflict",
          proposalPresentation: "pending",
        }),
      );
      expect(a.rule).toBe(3);
      expect(a.kind).toBe("review_setlist_data");
      expect(a.label).toBe("Revisar datos del setlist");
    },
  );

  it("rule 4 — any loading source -> disabled Cargando datos, outranking error", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        sources: sources({ members: "loading", proposals: "error" }),
        teamStatus: "unknown",
        availabilityStatus: "unknown",
        proposalPresentation: "unknown",
      }),
    );
    expect(a.rule).toBe(4);
    expect(a.kind).toBe("loading");
    expect(a.label).toBe("Cargando datos");
    expect(a.disabled).toBe(true);
  });

  it("rule 5 — any error source -> Reintentar carga, naming the failed sources", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        sources: sources({ proposals: "error", setlistTargets: "error" }),
        proposalPresentation: "unknown",
        setlistStatus: "unknown",
      }),
    );
    expect(a.rule).toBe(5);
    expect(a.kind).toBe("retry_load");
    expect(a.label).toBe("Reintentar carga");
    expect(a.reason).toContain("proposals");
    expect(a.reason).toContain("setlistTargets");
  });

  const R6_CASES: { name: string; over: Partial<ReadinessDimensions> }[] = [
    { name: "role target", over: { roleTargetStatus: "unknown" } },
    { name: "team", over: { teamStatus: "unknown" } },
    { name: "setlist", over: { setlistStatus: "unknown" } },
    { name: "proposal", over: { proposalPresentation: "unknown" } },
    { name: "availability", over: { availabilityStatus: "unknown" } },
  ];

  it.each(R6_CASES)(
    "rule 6 — sources ready but $name unknown -> Revisar datos",
    ({ over }) => {
      const a = resolvePrimaryAction(cleanDimensions(over));
      expect(a.rule).toBe(6);
      expect(a.kind).toBe("review_data");
      expect(a.label).toBe("Revisar datos");
    },
  );

  it("rule 7 — availability conflict -> Resolver conflicto (over proposal/setlist/team work)", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        availabilityStatus: "conflict",
        proposalPresentation: "pending",
        setlistStatus: "incomplete",
        teamStatus: "empty",
      }),
    );
    expect(a.rule).toBe(7);
    expect(a.kind).toBe("resolve_conflict");
    expect(a.label).toBe("Resolver conflicto");
  });

  it("rule 8 — proposal grouping conflict -> Revisar propuestas", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({
        proposalPresentation: "conflict",
        setlistStatus: "incomplete",
        teamStatus: "empty",
      }),
    );
    expect(a.rule).toBe(8);
    expect(a.kind).toBe("review_proposals");
    expect(a.label).toBe("Revisar propuestas");
  });

  it.each(["pending", "changes_requested"] as const)(
    "rule 9 — proposal %s -> Revisar propuesta",
    (proposalPresentation) => {
      const a = resolvePrimaryAction(
        cleanDimensions({ proposalPresentation, setlistStatus: "none", teamStatus: "empty" }),
      );
      expect(a.rule).toBe(9);
      expect(a.kind).toBe("review_proposal");
      expect(a.label).toBe("Revisar propuesta");
    },
  );

  it("rule 10 — proposal draft -> Revisar propuesta", () => {
    const a = resolvePrimaryAction(
      cleanDimensions({ proposalPresentation: "draft", setlistStatus: "incomplete", teamStatus: "empty" }),
    );
    expect(a.rule).toBe(10);
    expect(a.kind).toBe("review_proposal");
    expect(a.label).toBe("Revisar propuesta");
  });

  it.each(["none", "incomplete"] as const)(
    "rule 11 — setlist %s -> Completar setlist (over empty team)",
    (setlistStatus) => {
      const a = resolvePrimaryAction(cleanDimensions({ setlistStatus, teamStatus: "empty" }));
      expect(a.rule).toBe(11);
      expect(a.kind).toBe("complete_setlist");
      expect(a.label).toBe("Completar setlist");
    },
  );

  it("rule 12 — team empty -> Editar equipo", () => {
    const a = resolvePrimaryAction(cleanDimensions({ teamStatus: "empty" }));
    expect(a.rule).toBe(12);
    expect(a.kind).toBe("edit_team");
    expect(a.label).toBe("Editar equipo");
  });

  it("rule 13 — clean draft -> Publicar", () => {
    const a = resolvePrimaryAction(cleanDimensions());
    expect(a.rule).toBe(13);
    expect(a.kind).toBe("publish");
    expect(a.label).toBe("Publicar");
  });

  it("rule 14 — clean published -> Editar setlist", () => {
    const a = resolvePrimaryAction(cleanDimensions({ publishState: "published" }));
    expect(a.rule).toBe(14);
    expect(a.kind).toBe("edit_setlist");
    expect(a.label).toBe("Editar setlist");
  });

  it("rule 15 — fallback -> Editar servicio for an out-of-contract combination", () => {
    // Unreachable from any valid combination of the typed model (every unclean
    // dimension matches an earlier rule), so it is exercised through an
    // out-of-contract value to prove the fallback never throws or lies.
    const a = resolvePrimaryAction(
      cleanDimensions({ setlistStatus: "sideways" as never }),
    );
    expect(a.rule).toBe(15);
    expect(a.kind).toBe("edit_service");
    expect(a.label).toBe("Editar servicio");
  });

  it("exposes every documented Spanish label exactly once per kind", () => {
    expect(PRIMARY_ACTION_LABELS).toEqual({
      review_data: "Revisar datos",
      review_duplicate_roles: "Revisar roles duplicados",
      review_setlist_data: "Revisar datos del setlist",
      loading: "Cargando datos",
      retry_load: "Reintentar carga",
      resolve_conflict: "Resolver conflicto",
      review_proposals: "Revisar propuestas",
      review_proposal: "Revisar propuesta",
      complete_setlist: "Completar setlist",
      edit_team: "Editar equipo",
      publish: "Publicar",
      edit_setlist: "Editar setlist",
      edit_service: "Editar servicio",
    });
  });

  it("reaches all 15 rules across the suite's scenarios", () => {
    const reached = new Set<number>();
    const push = (over: Partial<ReadinessDimensions>) =>
      reached.add(resolvePrimaryAction(cleanDimensions(over)).rule);
    push({ recordStatus: "invalid" });
    push({ roleTargetStatus: "duplicate" });
    push({ setlistStatus: "invalid" });
    push({ sources: sources({ members: "loading" }) });
    push({ sources: sources({ members: "error" }) });
    push({ teamStatus: "unknown" });
    push({ availabilityStatus: "conflict" });
    push({ proposalPresentation: "conflict" });
    push({ proposalPresentation: "pending" });
    push({ proposalPresentation: "draft" });
    push({ setlistStatus: "none" });
    push({ teamStatus: "empty" });
    push({});
    push({ publishState: "published" });
    push({ setlistStatus: "sideways" as never });
    expect([...reached].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });
});

// ── whole model ───────────────────────────────────────────────────────────────

function baseModelInput(over: Partial<Parameters<typeof deriveServiceReadiness>[0]> = {}) {
  return {
    sources: ALL_READY,
    published: false as unknown,
    recordValid: true,
    roleTarget: "single" as const,
    team: { assignedRefs: ["m1"], danglingRefs: [] as string[] },
    setlistResponse: readSingle([SONG_OK]),
    proposal: emptyProposals(),
    serviceDate: "2026-08-02",
    members: [MEMBERS[0]],
    ...over,
  };
}

describe("deriveServiceReadiness", () => {
  it("assembles a clean, ready-to-publish draft", () => {
    const r = deriveServiceReadiness(baseModelInput());
    expect(r).toMatchObject({
      publishState: "draft",
      recordStatus: "valid",
      roleTargetStatus: "single",
      teamStatus: "assigned",
      setlistStatus: "ready",
      setlistEditable: true,
      proposalPresentation: "none",
      availabilityStatus: "clear",
      dataConfidence: "complete",
      isOperationallyReady: true,
      isReadyToPublish: true,
    });
    expect(r.integrityIssues).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.primaryAction.kind).toBe("publish");
  });

  it("treats a legacy missing `published` field as published (health signal, not ready-to-publish)", () => {
    const r = deriveServiceReadiness(baseModelInput({ published: undefined }));
    expect(r.publishState).toBe("published");
    expect(r.isOperationallyReady).toBe(true);
    expect(r.isReadyToPublish).toBe(false);
    expect(r.primaryAction.kind).toBe("edit_setlist");
  });

  it("keeps a dangling assignment out of `empty`/`assigned` and blocks with Revisar datos", () => {
    const r = deriveServiceReadiness(
      baseModelInput({ team: { assignedRefs: ["m1", "ghost"], danglingRefs: ["ghost"] } }),
    );
    expect(r.teamStatus).toBe("unknown");
    expect(r.availabilityStatus).toBe("unknown");
    expect(r.isOperationallyReady).toBe(false);
    expect(r.primaryAction.rule).toBe(1);
    expect(r.integrityIssues).toEqual([
      { kind: "dangling_assignment", blocking: true, ids: ["ghost"] },
    ]);
  });

  it("reports availability conflicts computed from the resolved seats", () => {
    const r = deriveServiceReadiness(
      baseModelInput({
        members: [{ _id: "m1", _rev: "v", member_name: "Ana", unavailableDates: ["2026-08-02"] }],
      }),
    );
    expect(r.availabilityStatus).toBe("conflict");
    expect(r.conflicts).toEqual([{ memberId: "m1", memberName: "Ana" }]);
    expect(r.primaryAction.kind).toBe("resolve_conflict");
  });

  it("keeps a proposals-source failure honest: unknown, never `none`", () => {
    const r = deriveServiceReadiness(
      baseModelInput({ sources: sources({ proposals: "error" }), proposal: null }),
    );
    expect(r.proposalPresentation).toBe("unknown");
    expect(r.dataConfidence).toBe("partial");
    expect(r.isOperationallyReady).toBe(false);
    expect(r.primaryAction.kind).toBe("retry_load");
  });

  it("carries supplied A1/A2 integrity issues into rule 1 and the issue list", () => {
    const r = deriveServiceReadiness(
      baseModelInput({
        integrityIssues: lockIssuesToIntegrity([
          { kind: "orphan_lock", lockId: "lock1", targetKey: "sunday_role:2026-08-02", roleId: "gone" },
        ]),
      }),
    );
    expect(r.isOperationallyReady).toBe(false);
    expect(r.primaryAction.rule).toBe(1);
    expect(r.integrityIssues.map((i) => i.kind)).toEqual(["lock"]);
  });

  it("derives integrity issues for each unclean dimension", () => {
    const r = deriveServiceReadiness(
      baseModelInput({
        recordValid: false,
        roleTarget: "duplicate",
        setlistResponse: buildSetlistRead(
          [
            { id: "a", rev: "1", songs: [] },
            { id: "b", rev: "1", songs: [] },
          ],
          [],
          {},
        ),
        proposal: { ...emptyProposals(), draftIds: ["drafts.p1"] },
      }),
    );
    expect(r.integrityIssues.map((i) => i.kind).sort()).toEqual([
      "invalid_record",
      "proposal_draft_conflict",
      "role_target_duplicate",
      "setlist_duplicate",
    ]);
    expect(r.integrityIssues.every((i) => i.blocking)).toBe(true);
  });

  it("does not treat a non-blocking supplied issue as a readiness blocker", () => {
    const r = deriveServiceReadiness(
      baseModelInput({
        integrityIssues: [{ kind: "legacy", blocking: false, ids: ["x"], reason: "informational" }],
      }),
    );
    expect(r.isOperationallyReady).toBe(true);
    expect(r.primaryAction.kind).toBe("publish");
    expect(r.integrityIssues).toHaveLength(1);
  });
});

// ── per-control capability gating ─────────────────────────────────────────────

describe("selectServiceCapabilities", () => {
  it("enables every control when all five sources are ready", () => {
    const caps = selectServiceCapabilities(ALL_READY);
    for (const control of SERVICE_CONTROLS) {
      expect(caps[control]).toEqual({ control, enabled: true, blockedBy: [] });
    }
  });

  it("declares the plan's required sources per control", () => {
    expect(CONTROL_REQUIRED_SOURCES).toEqual({
      monthFilters: ["roles"],
      createService: ["roles", "members", "proposals", "roleTargets", "setlistTargets"],
      generateMonth: ["roles", "members", "proposals", "roleTargets", "setlistTargets"],
      editTeam: ["roles", "members", "roleTargets"],
      changeServiceDate: ["roles", "members", "proposals", "roleTargets", "setlistTargets"],
      deleteService: ["roles", "members", "proposals", "roleTargets", "setlistTargets"],
      swap: ["roles", "members", "roleTargets"],
      copyInstruments: ["roles", "members", "roleTargets"],
      editSetlist: ["roles", "roleTargets", "setlistTargets"],
      participationSidebar: ["roles", "members"],
      proposalHandoff: ["roles", "proposals"],
      publishReady: ["roles", "members", "proposals", "roleTargets", "setlistTargets"],
      unpublish: ["roles", "roleTargets"],
    });
  });

  for (const control of SERVICE_CONTROLS) {
    for (const state of ["loading", "error"] as const) {
      it(`${control}: each required source ${state} disables it and names the source`, () => {
        for (const required of CONTROL_REQUIRED_SOURCES[control]) {
          const caps = selectServiceCapabilities(sources({ [required]: state }));
          expect(caps[control].enabled).toBe(false);
          expect(caps[control].blockedBy).toEqual([{ source: required, state }]);
          expect(isControlEnabled(sources({ [required]: state }), control)).toBe(false);
        }
      });

      it(`${control}: a non-required source ${state} leaves it enabled`, () => {
        const notRequired = SERVICE_SOURCE_KEYS.filter(
          (k) => !CONTROL_REQUIRED_SOURCES[control].includes(k),
        );
        for (const other of notRequired) {
          const caps = selectServiceCapabilities(sources({ [other]: state }));
          expect(caps[control].enabled).toBe(true);
          expect(caps[control].blockedBy).toEqual([]);
        }
      });
    }
  }

  const ALL_FIVE: ServiceControl[] = [
    "createService",
    "generateMonth",
    "changeServiceDate",
    "deleteService",
    "publishReady",
  ];

  it("a proposals-only failure blocks create/month/date/delete/publish and the handoff, not the rest", () => {
    const caps = selectServiceCapabilities(sources({ proposals: "error" }));
    for (const c of [...ALL_FIVE, "proposalHandoff" as ServiceControl]) {
      expect(caps[c].enabled).toBe(false);
    }
    for (const c of [
      "monthFilters",
      "editTeam",
      "swap",
      "copyInstruments",
      "editSetlist",
      "participationSidebar",
      "unpublish",
    ] as ServiceControl[]) {
      expect(caps[c].enabled).toBe(true);
    }
  });

  it("a setlist-only failure blocks create/month/date/delete/publish and setlist editing, not the rest", () => {
    const caps = selectServiceCapabilities(sources({ setlistTargets: "error" }));
    for (const c of [...ALL_FIVE, "editSetlist" as ServiceControl]) {
      expect(caps[c].enabled).toBe(false);
    }
    for (const c of [
      "monthFilters",
      "editTeam",
      "swap",
      "copyInstruments",
      "participationSidebar",
      "proposalHandoff",
      "unpublish",
    ] as ServiceControl[]) {
      expect(caps[c].enabled).toBe(true);
    }
  });

  it("a members-only failure leaves setlist editing, the proposal handoff and safe unpublish available", () => {
    const caps = selectServiceCapabilities(sources({ members: "error" }));
    expect(caps.editSetlist.enabled).toBe(true);
    expect(caps.proposalHandoff.enabled).toBe(true);
    expect(caps.unpublish.enabled).toBe(true);
    expect(caps.editTeam.enabled).toBe(false);
    expect(caps.participationSidebar.enabled).toBe(false);
  });

  it("is never derived from aggregate dataConfidence", () => {
    // Same aggregate confidence, different per-control results — proof that the
    // selector reads the individual source states.
    const proposalsDown = sources({ proposals: "error" });
    const setlistDown = sources({ setlistTargets: "error" });
    expect(deriveDataConfidence(proposalsDown)).toBe(deriveDataConfidence(setlistDown));
    expect(selectServiceCapabilities(proposalsDown).editSetlist.enabled).toBe(true);
    expect(selectServiceCapabilities(setlistDown).editSetlist.enabled).toBe(false);
    expect(selectServiceCapabilities(proposalsDown).proposalHandoff.enabled).toBe(false);
    expect(selectServiceCapabilities(setlistDown).proposalHandoff.enabled).toBe(true);
  });

  it("reports every unready required source, not just the first", () => {
    const caps = selectServiceCapabilities(sources({ members: "loading", proposals: "error" }));
    expect(caps.createService.blockedBy).toEqual([
      { source: "members", state: "loading" },
      { source: "proposals", state: "error" },
    ]);
  });
});

// ── per-target create/month preflight ─────────────────────────────────────────

function preflight(over: Partial<TargetPreflightInput> = {}): TargetPreflightInput {
  return {
    targetKey: "sunday_role:2026-08-02",
    sources: ALL_READY,
    role: "none",
    expectsLock: true,
    lock: { eligible: true, issues: [] },
    setlistHistory: { canonicalIds: [], draftIds: [] },
    proposalHistory: { canonicalIds: [], draftIds: [] },
    targetIssues: [],
    ...over,
  };
}

describe("deriveTargetPreflight", () => {
  it("creatable only when every source is ready and every observation is clean", () => {
    const r = deriveTargetPreflight(preflight());
    expect(r.state).toBe("creatable");
    expect(r.reasons).toEqual([]);
  });

  it("creatable for a special target that takes no weekend lock", () => {
    const r = deriveTargetPreflight(preflight({ expectsLock: false, lock: null }));
    expect(r.state).toBe("creatable");
  });

  it("checking while any required inventory is still loading — never vacant/creatable", () => {
    const r = deriveTargetPreflight(preflight({ sources: sources({ setlistTargets: "loading" }) }));
    expect(r.state).toBe("checking");
    expect(r.blockedBy).toEqual([{ source: "setlistTargets", state: "loading" }]);
  });

  it("loading outranks error, matching the primary-action ladder", () => {
    const r = deriveTargetPreflight(
      preflight({ sources: sources({ proposals: "loading", roleTargets: "error" }) }),
    );
    expect(r.state).toBe("checking");
  });

  it("unknown when a required domain failed", () => {
    const r = deriveTargetPreflight(preflight({ sources: sources({ proposals: "error" }) }));
    expect(r.state).toBe("unknown");
    expect(r.blockedBy).toEqual([{ source: "proposals", state: "error" }]);
  });

  it.each([
    ["role", { role: null }],
    ["setlist history", { setlistHistory: null }],
    ["proposal history", { proposalHistory: null }],
    ["weekend lock", { lock: null }],
  ] as [string, Partial<TargetPreflightInput>][])(
    "unknown when the %s observation cannot be proven",
    (_name, over) => {
      expect(deriveTargetPreflight(preflight(over)).state).toBe("unknown");
    },
  );

  it("exists for an unambiguous canonical role target (skipped, not creatable)", () => {
    const r = deriveTargetPreflight(preflight({ role: "single" }));
    expect(r.state).toBe("exists");
  });

  it.each(["duplicate", "draft_conflict", "invalid"] as const)(
    "blocked for role state %s",
    (role) => {
      const r = deriveTargetPreflight(preflight({ role }));
      expect(r.state).toBe("blocked");
      expect(r.reasons).toContain(`role_${role}`);
    },
  );

  it("blocked for a non-eligible or issue-carrying weekend lock, with its ids", () => {
    expect(deriveTargetPreflight(preflight({ lock: { eligible: false, issues: [] } })).state).toBe(
      "blocked",
    );
    const withIssue = deriveTargetPreflight(
      preflight({
        lock: {
          eligible: true,
          issues: [
            { kind: "wrong_owner", lockId: "lock1", targetKey: "sunday_role:2026-08-02", roleId: "r9" },
          ],
        },
      }),
    );
    expect(withIssue.state).toBe("blocked");
    expect(withIssue.reasons).toContain("lock_wrong_owner");
    expect(withIssue.ids).toContain("lock1");
  });

  it.each([
    ["canonical setlist", { setlistHistory: { canonicalIds: ["sl1"], draftIds: [] } }, "setlist_history", "sl1"],
    ["raw setlist draft", { setlistHistory: { canonicalIds: [], draftIds: ["drafts.sl1"] } }, "setlist_history", "drafts.sl1"],
    ["canonical proposal", { proposalHistory: { canonicalIds: ["p1"], draftIds: [] } }, "proposal_history", "p1"],
    ["raw proposal draft", { proposalHistory: { canonicalIds: [], draftIds: ["drafts.p1"] } }, "proposal_history", "drafts.p1"],
  ] as [string, Partial<TargetPreflightInput>, string, string][])(
    "blocked by orphan %s history, showing explicit ids",
    (_name, over, reason, id) => {
      const r = deriveTargetPreflight(preflight(over));
      expect(r.state).toBe("blocked");
      expect(r.reasons).toContain(reason);
      expect(r.ids).toContain(id);
    },
  );

  it("blocked by an explicit associated target issue", () => {
    const r = deriveTargetPreflight(
      preflight({
        targetIssues: [{ kind: "legacy", blocking: true, ids: ["x1"], reason: "unassociated" }],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.ids).toContain("x1");
  });

  it("exists takes precedence over history when a canonical role already occupies the target", () => {
    const r = deriveTargetPreflight(
      preflight({ role: "single", setlistHistory: { canonicalIds: ["sl1"], draftIds: [] } }),
    );
    expect(r.state).toBe("exists");
  });

  it("creatableTargets posts only proven-creatable targets", () => {
    const results = [
      deriveTargetPreflight(preflight({ targetKey: "a" })),
      deriveTargetPreflight(preflight({ targetKey: "b", role: "single" })),
      deriveTargetPreflight(preflight({ targetKey: "c", role: "duplicate" })),
      deriveTargetPreflight(preflight({ targetKey: "d", sources: sources({ proposals: "loading" }) })),
      deriveTargetPreflight(preflight({ targetKey: "e", sources: sources({ proposals: "error" }) })),
    ];
    expect(results.map((r) => r.state)).toEqual([
      "creatable",
      "exists",
      "blocked",
      "checking",
      "unknown",
    ]);
    expect(creatableTargets(results).map((r) => r.targetKey)).toEqual(["a"]);
  });

  it("preserves each target's state and reason independently", () => {
    const a = deriveTargetPreflight(preflight({ targetKey: "a", role: "duplicate" }));
    const b = deriveTargetPreflight(preflight({ targetKey: "b" }));
    expect(a.state).toBe("blocked");
    expect(b.state).toBe("creatable");
    expect(b.reasons).toEqual([]);
  });
});

// ── dates (running in a non-Mexico timezone) ──────────────────────────────────

describe("service dates in America/Mexico_City", () => {
  it("runs in a non-Mexico ambient timezone", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe("America/Mexico_City");
  });

  it("parses a service date at local noon, so the calendar day never flips", () => {
    const d = parseServiceDateAtNoon("2026-07-01")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(12);
    // The landmine this guards against: a bare `new Date(iso)` is parsed as UTC
    // midnight and flips a day back in every negative-offset zone.
    expect(new Date("2026-07-01").getDate()).not.toBe(1);
  });

  it("accepts a stored datetime prefix and rejects a malformed date", () => {
    expect(parseServiceDateAtNoon("2026-07-01T00:00:00Z")!.getDate()).toBe(1);
    expect(parseServiceDateAtNoon("2026-02-30")).toBeNull();
    expect(parseServiceDateAtNoon("nope")).toBeNull();
    expect(parseServiceDateAtNoon("")).toBeNull();
  });

  it("derives today in Mexico City regardless of the ambient zone", () => {
    // 04:30Z is still the previous calendar day in Mexico City (UTC-6).
    expect(serviceTodayIso(new Date("2026-07-25T04:30:00Z"))).toBe("2026-07-24");
    expect(serviceTodayIso(new Date("2026-07-25T06:30:00Z"))).toBe("2026-07-25");
  });

  it("computes calendar-day offsets at local noon, not elapsed hours", () => {
    expect(serviceDayOffset("2026-07-24", "2026-07-24")).toBe(0);
    expect(serviceDayOffset("2026-07-25", "2026-07-24")).toBe(1);
    expect(serviceDayOffset("2026-07-23", "2026-07-24")).toBe(-1);
    // Across a DST boundary in zones that have one, the day count stays exact.
    expect(serviceDayOffset("2026-11-02", "2026-10-30")).toBe(3);
    expect(serviceDayOffset("2027-01-01", "2026-12-31")).toBe(1);
    expect(serviceDayOffset("bad", "2026-07-24")).toBeNull();
  });

  it("splits upcoming from past on the Mexico City calendar day", () => {
    const today = serviceTodayIso(new Date("2026-07-25T04:30:00Z")); // 2026-07-24 in MX
    expect(isPastServiceDate("2026-07-23", today)).toBe(true);
    expect(isPastServiceDate("2026-07-24", today)).toBe(false); // today is upcoming
    expect(isPastServiceDate("2026-07-25", today)).toBe(false);
    expect(isPastServiceDate("2026-07-25T00:00:00Z", today)).toBe(false);
    expect(isPastServiceDate("nope", today)).toBe(false); // unusable date is never "past"
  });
});
