import { describe, expect, it } from "vitest";

import {
  SERVICE_CONTROLS,
  SERVICE_SOURCE_KEYS,
  CONTROL_REQUIRED_SOURCES,
  deriveServiceReadiness,
  type ServiceControl,
  type ServiceSourceKey,
  type ServiceSourceStates,
} from "../serviceReadiness";
import {
  ACTIVE_MODE_COPY,
  REFRESH_FAILED_PREFIX,
  SOURCE_ENDPOINTS,
  SOURCE_LABEL,
  canFilterMonths,
  captureActiveMode,
  checkActiveMode,
  controlBlockMessage,
  describeSources,
  editModalControl,
  failedSources,
  guardControl,
  initialSourceRecords,
  isValidSourcePayload,
  latchInvalidation,
  loadingSources,
  movesServiceDate,
  mutationOutcomeMessage,
  publishControl,
  reduceSourceRecords,
  retryTargets,
  rolesView,
  sourceStates,
  unreadyMessage,
  type ActiveModeSnapshot,
  type ServiceSourceRecords,
} from "../serviceSourceState";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Records in an all-ready steady state, generation 1 (one successful load). */
function allReady(): ServiceSourceRecords {
  let records = initialSourceRecords();
  for (const source of SERVICE_SOURCE_KEYS) {
    records = reduceSourceRecords(records, { type: "load_ok", source });
  }
  return records;
}

function withState(source: ServiceSourceKey, state: "loading" | "error"): ServiceSourceRecords {
  const records = allReady();
  return reduceSourceRecords(
    reduceSourceRecords(records, { type: "load_start", sources: [source] }),
    state === "error" ? { type: "load_error", source } : { type: "load_start", sources: [source] },
  );
}

const READY_STATES: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

// ── Records + reducer ────────────────────────────────────────────────────────

describe("source records", () => {
  it("starts every source loading with no data and generation 0", () => {
    const records = initialSourceRecords();
    for (const source of SERVICE_SOURCE_KEYS) {
      expect(records[source]).toEqual({ status: "loading", loaded: false, generation: 0 });
    }
    expect(sourceStates(records)).toEqual({
      roles: "loading",
      members: "loading",
      proposals: "loading",
      roleTargets: "loading",
      setlistTargets: "loading",
    });
  });

  it("maps a success to ready, marks data present and bumps the generation", () => {
    const records = reduceSourceRecords(initialSourceRecords(), {
      type: "load_ok",
      source: "members",
    });
    expect(records.members).toEqual({ status: "ready", loaded: true, generation: 1 });
    // The other four are untouched: sources load independently.
    expect(records.proposals.status).toBe("loading");
  });

  it("maps a failure to error, keeps previously loaded data and the generation", () => {
    const ready = allReady();
    const failed = reduceSourceRecords(ready, { type: "load_error", source: "proposals" });
    expect(failed.proposals).toEqual({ status: "error", loaded: true, generation: 1 });
    // A failure in one source never disturbs another.
    expect(failed.roles).toEqual({ status: "ready", loaded: true, generation: 1 });
  });

  it("a refresh of a ready source is loading again but keeps its last-successful data", () => {
    const refreshing = reduceSourceRecords(allReady(), {
      type: "load_start",
      sources: ["setlistTargets"],
    });
    expect(refreshing.setlistTargets).toEqual({ status: "loading", loaded: true, generation: 1 });
    expect(sourceStates(refreshing).setlistTargets).toBe("loading");
  });

  it("recovers to ready after a retry of only the failed source", () => {
    const failed = reduceSourceRecords(allReady(), { type: "load_error", source: "roleTargets" });
    expect(failedSources(failed)).toEqual(["roleTargets"]);
    expect(retryTargets(failed)).toEqual(["roleTargets"]);

    const retrying = reduceSourceRecords(failed, { type: "load_start", sources: retryTargets(failed) });
    expect(retrying.roleTargets.status).toBe("loading");
    expect(loadingSources(retrying)).toEqual(["roleTargets"]);

    const recovered = reduceSourceRecords(retrying, { type: "load_ok", source: "roleTargets" });
    expect(recovered.roleTargets).toEqual({ status: "ready", loaded: true, generation: 2 });
    expect(failedSources(recovered)).toEqual([]);
    // With nothing failed, a manual retry refetches everything.
    expect(retryTargets(recovered)).toEqual([...SERVICE_SOURCE_KEYS]);
  });

  it("reports the roles view: first load, cards, and a card-blocking failure", () => {
    expect(rolesView(initialSourceRecords())).toBe("loading");
    expect(rolesView(allReady())).toBe("cards");
    // A roles refresh keeps the last-successful cards on screen.
    expect(rolesView(reduceSourceRecords(allReady(), { type: "load_start", sources: ["roles"] }))).toBe(
      "cards",
    );
    // A roles failure prevents card rendering and shows retry instead.
    expect(rolesView(reduceSourceRecords(allReady(), { type: "load_error", source: "roles" }))).toBe(
      "error",
    );
    // Another source failing never blocks the cards.
    expect(rolesView(reduceSourceRecords(allReady(), { type: "load_error", source: "members" }))).toBe(
      "cards",
    );
  });

  it("keeps loaded roles filterable during a refresh but not after a roles failure", () => {
    expect(canFilterMonths(initialSourceRecords())).toBe(false);
    expect(canFilterMonths(allReady())).toBe(true);
    expect(
      canFilterMonths(reduceSourceRecords(allReady(), { type: "load_start", sources: ["roles"] })),
    ).toBe(true);
    expect(canFilterMonths(reduceSourceRecords(allReady(), { type: "load_error", source: "roles" }))).toBe(
      false,
    );
    // A different source failing leaves the view control alone.
    expect(
      canFilterMonths(reduceSourceRecords(allReady(), { type: "load_error", source: "proposals" })),
    ).toBe(true);
  });
});

// ── Failure mapping: never clear / none / no-proposal ────────────────────────

describe("source failure never collapses to a clean value", () => {
  const base = {
    published: false,
    recordValid: true,
    roleId: "role-1",
    roleTarget: "single" as const,
    team: { assignedRefs: ["m1"], danglingRefs: [] },
    // A valid A1 admin setlist GET body (single target, ready content).
    setlistResponse: {
      targetState: "single",
      contentState: "ready",
      setlistId: "setlist-1",
      observed: { state: "single", id: "setlist-1", rev: "rev-s1" },
      songs: [{ _key: "k1", song: { _id: "song-1" } }],
      recentSongs: {},
    },
    proposal: { validated: [], conflicts: [], recordIssues: [], draftIds: [] },
    serviceDate: "2026-08-02",
    members: [{ _id: "m1", member_name: "Ana" }],
  };

  it("members failure makes team and availability unknown, never clear", () => {
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "members" });
    const readiness = deriveServiceReadiness({ ...base, sources: sourceStates(records) });
    expect(readiness.teamStatus).toBe("unknown");
    expect(readiness.availabilityStatus).toBe("unknown");
    expect(readiness.availabilityStatus).not.toBe("clear");
    expect(readiness.isReadyToPublish).toBe(false);
  });

  it("proposals failure means unknown, never no-proposal", () => {
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "proposals" });
    const readiness = deriveServiceReadiness({ ...base, sources: sourceStates(records) });
    expect(readiness.proposalPresentation).toBe("unknown");
    expect(readiness.proposalPresentation).not.toBe("none");
    expect(readiness.isReadyToPublish).toBe(false);
  });

  it("role-target failure means unknown, never single", () => {
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "roleTargets" });
    const readiness = deriveServiceReadiness({ ...base, sources: sourceStates(records) });
    expect(readiness.roleTargetStatus).toBe("unknown");
    expect(readiness.roleTargetStatus).not.toBe("single");
  });

  it("setlist-target failure means unknown, never none", () => {
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "setlistTargets" });
    const readiness = deriveServiceReadiness({ ...base, sources: sourceStates(records) });
    expect(readiness.setlistStatus).toBe("unknown");
    expect(readiness.setlistStatus).not.toBe("none");
    expect(readiness.setlistEditable).toBe(false);
  });

  it("preserves successful source data while another source fails", () => {
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "proposals" });
    const readiness = deriveServiceReadiness({ ...base, sources: sourceStates(records) });
    // Roles/members/setlist observations still render honestly.
    expect(readiness.teamStatus).toBe("assigned");
    expect(readiness.setlistStatus).toBe("ready");
    expect(readiness.availabilityStatus).toBe("clear");
    expect(readiness.dataConfidence).toBe("partial");
    // Record-level issues stay visible instead of failing the card.
    const invalid = deriveServiceReadiness({
      ...base,
      recordValid: false,
      sources: sourceStates(records),
    });
    expect(invalid.integrityIssues.some((i) => i.kind === "invalid_record")).toBe(true);
  });
});

// ── Copy ─────────────────────────────────────────────────────────────────────

describe("Spanish loading/error copy", () => {
  it("labels every source and maps it to its shipped endpoint", () => {
    for (const source of SERVICE_SOURCE_KEYS) {
      expect(SOURCE_LABEL[source]).toBeTruthy();
      expect(SOURCE_ENDPOINTS[source].startsWith("/api/admin/")).toBe(true);
    }
    expect(SOURCE_ENDPOINTS).toEqual({
      roles: "/api/admin/roles",
      members: "/api/admin/members",
      proposals: "/api/admin/service-integrity/proposals",
      roleTargets: "/api/admin/service-integrity/roles",
      setlistTargets: "/api/admin/service-integrity/setlists",
    });
  });

  it("lists sources in the canonical order with Spanish conjunctions", () => {
    expect(describeSources(["proposals"])).toBe("propuestas");
    expect(describeSources(["proposals", "members"])).toBe("miembros y propuestas");
    expect(describeSources(["setlistTargets", "roles", "members"])).toBe(
      "servicios, miembros e integridad de setlists",
    );
    expect(describeSources([])).toBe("");
  });

  it("identifies the missing source and offers its retry", () => {
    expect(unreadyMessage([])).toBeNull();
    expect(unreadyMessage([{ source: "proposals", state: "loading" }])).toBe("Cargando propuestas…");
    expect(unreadyMessage([{ source: "proposals", state: "error" }])).toContain("propuestas");
    expect(unreadyMessage([{ source: "proposals", state: "error" }])).toContain("Reintentar carga");
    const mixed = unreadyMessage([
      { source: "proposals", state: "error" },
      { source: "members", state: "loading" },
    ]);
    expect(mixed).toContain("propuestas");
    expect(mixed).toContain("Cargando miembros…");
  });

  it("names only the sources a control actually needs", () => {
    const setlistDown: ServiceSourceStates = { ...READY_STATES, setlistTargets: "error" };
    expect(controlBlockMessage(setlistDown, "editSetlist")).toContain("integridad de setlists");
    // Swap does not need the setlist source, so it has nothing to report.
    expect(controlBlockMessage(setlistDown, "swap")).toBeNull();
  });
});

// ── Mutation succeeded, refresh failed ───────────────────────────────────────

describe("mutation outcome messaging", () => {
  it("reports plain success when the refresh loaded every source", () => {
    expect(mutationOutcomeMessage("Servicio creado.", [])).toBe("Servicio creado.");
  });

  it("never claims a refreshed success when the refresh failed", () => {
    const message = mutationOutcomeMessage("Servicio creado.", ["roles", "proposals"]);
    expect(message.startsWith(REFRESH_FAILED_PREFIX)).toBe(true);
    expect(message).toContain("servicios y propuestas");
    expect(message).toContain("Reintentar carga");
    expect(message).not.toContain("Servicio creado.");
  });

  it("accepts an operation-specific prefix", () => {
    expect(mutationOutcomeMessage("Eliminado.", ["roles"], "Eliminado, pero no se pudo actualizar")).toContain(
      "Eliminado, pero no se pudo actualizar",
    );
  });
});

// ── Payload shape ────────────────────────────────────────────────────────────

describe("payload validation", () => {
  it("requires an array for roles/members and an object for the three summaries", () => {
    expect(isValidSourcePayload("roles", [])).toBe(true);
    expect(isValidSourcePayload("roles", { error: "Forbidden" })).toBe(false);
    expect(isValidSourcePayload("members", [{ _id: "m1" }])).toBe(true);
    expect(isValidSourcePayload("members", null)).toBe(false);
    expect(isValidSourcePayload("proposals", { records: [] })).toBe(true);
    expect(isValidSourcePayload("proposals", [])).toBe(false);
    expect(isValidSourcePayload("roleTargets", null)).toBe(false);
    expect(isValidSourcePayload("setlistTargets", { targets: [] })).toBe(true);
  });
});

// ── The capability matrix, every row, every required source ──────────────────

describe("per-control gating (the plan's matrix)", () => {
  it("enables every control when all five sources are ready", () => {
    for (const control of SERVICE_CONTROLS) {
      expect(guardControl(READY_STATES, control).ok).toBe(true);
      expect(guardControl(READY_STATES, control).message).toBeNull();
    }
  });

  it("refuses a control while any of ITS required sources is loading or failed", () => {
    for (const control of SERVICE_CONTROLS) {
      for (const source of CONTROL_REQUIRED_SOURCES[control]) {
        for (const state of ["loading", "error"] as const) {
          const sources: ServiceSourceStates = { ...READY_STATES, [source]: state };
          const guard = guardControl(sources, control);
          expect(guard.ok, `${control} / ${source} / ${state}`).toBe(false);
          expect(guard.blockedBy).toEqual([{ source, state }]);
          expect(guard.message).toContain(SOURCE_LABEL[source]);
        }
      }
    }
  });

  it("leaves unrelated controls enabled when one source fails", () => {
    const proposalsDown: ServiceSourceStates = { ...READY_STATES, proposals: "error" };
    const blocked: ServiceControl[] = [];
    const open: ServiceControl[] = [];
    for (const control of SERVICE_CONTROLS) {
      (guardControl(proposalsDown, control).ok ? open : blocked).push(control);
    }
    expect(blocked.sort()).toEqual(
      ["createService", "generateMonth", "changeServiceDate", "deleteService", "publishReady", "proposalHandoff"].sort(),
    );
    expect(open.sort()).toEqual(
      ["monthFilters", "editTeam", "swap", "copyInstruments", "editSetlist", "participationSidebar", "unpublish"].sort(),
    );
  });

  it("setlist-only failure blocks create/month and the setlist editor, not team edits or swap", () => {
    const setlistDown: ServiceSourceStates = { ...READY_STATES, setlistTargets: "error" };
    expect(guardControl(setlistDown, "createService").ok).toBe(false);
    expect(guardControl(setlistDown, "generateMonth").ok).toBe(false);
    expect(guardControl(setlistDown, "editSetlist").ok).toBe(false);
    expect(guardControl(setlistDown, "editTeam").ok).toBe(true);
    expect(guardControl(setlistDown, "swap").ok).toBe(true);
    expect(guardControl(setlistDown, "copyInstruments").ok).toBe(true);
    expect(guardControl(setlistDown, "unpublish").ok).toBe(true);
  });

  it("keeps safe unpublish available when members/setlist/proposals are unavailable", () => {
    const sources: ServiceSourceStates = {
      roles: "ready",
      roleTargets: "ready",
      members: "error",
      setlistTargets: "error",
      proposals: "error",
    };
    expect(guardControl(sources, "unpublish").ok).toBe(true);
    expect(guardControl(sources, "publishReady").ok).toBe(false);
  });

  it("refuses a handler bypass attempt for every control while a dependency is down", () => {
    // A handler entry point re-checks the same capability the render used; a
    // caller that reaches the handler anyway is refused with honest copy.
    const rolesDown: ServiceSourceStates = { ...READY_STATES, roles: "error" };
    for (const control of SERVICE_CONTROLS) {
      const guard = guardControl(rolesDown, control);
      expect(guard.ok, control).toBe(false);
      expect(guard.message).toContain("servicios");
    }
  });
});

// ── Which control each panel action delegates to ─────────────────────────────

describe("panel action -> control mapping", () => {
  it("routes publish and unpublish to their own capabilities", () => {
    expect(publishControl(true)).toBe("publishReady");
    expect(publishControl(false)).toBe("unpublish");
    // The whole point: a members/setlist/proposal outage still allows hiding.
    const partial: ServiceSourceStates = {
      ...READY_STATES,
      members: "error",
      setlistTargets: "loading",
      proposals: "error",
    };
    expect(guardControl(partial, publishControl(false)).ok).toBe(true);
    expect(guardControl(partial, publishControl(true)).ok).toBe(false);
  });

  it("routes each modal to its capability", () => {
    expect(editModalControl("add")).toBe("createService");
    expect(editModalControl("edit")).toBe("editTeam");
    expect(editModalControl("delete")).toBe("deleteService");
  });

  it("detects a date move so the date row is checked on top of the edit row", () => {
    expect(movesServiceDate("2026-08-02", "2026-08-02")).toBe(false);
    // A legacy datetime prefix is the same calendar day, not a move.
    expect(movesServiceDate("2026-08-02T00:00:00Z", "2026-08-02")).toBe(false);
    expect(movesServiceDate("2026-08-02", "2026-08-09")).toBe(true);
    expect(movesServiceDate("2026-08-02", "")).toBe(false);
    expect(movesServiceDate("2026-08-02", undefined)).toBe(false);

    const dateBlocked: ServiceSourceStates = { ...READY_STATES, proposals: "error" };
    // Ordinary team edits stay possible while the date itself cannot move.
    expect(guardControl(dateBlocked, "editTeam").ok).toBe(true);
    expect(guardControl(dateBlocked, "changeServiceDate").ok).toBe(false);
  });
});

// ── Active edit/swap/copy invalidation ───────────────────────────────────────

describe("active mode invalidation", () => {
  const roleA = { _id: "role-a", _rev: "rev-a" };
  const roleB = { _id: "role-b", _rev: "rev-b" };

  function snapshot(mode: ActiveModeSnapshot["mode"], control: ServiceControl, roles = [roleA]) {
    return captureActiveMode({ mode, control, roles, records: allReady() });
  }

  it("stays valid while nothing changed", () => {
    const snap = snapshot("edit", "editTeam");
    expect(checkActiveMode(snap, { records: allReady(), roles: [roleA, roleB] })).toBeNull();
  });

  it("invalidates when a required source fails", () => {
    const snap = snapshot("edit", "editTeam");
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "members" });
    const result = checkActiveMode(snap, { records, roles: [roleA] });
    expect(result?.kind).toBe("source_unready");
    expect(result?.message).toContain("miembros");
  });

  it("invalidates while a required source is reloading", () => {
    const snap = snapshot("swap", "swap", [roleA, roleB]);
    const records = reduceSourceRecords(allReady(), { type: "load_start", sources: ["roleTargets"] });
    expect(checkActiveMode(snap, { records, roles: [roleA, roleB] })?.kind).toBe("source_unready");
  });

  it("ignores a source the mode does not require", () => {
    const snap = snapshot("copy", "copyInstruments");
    const records = reduceSourceRecords(allReady(), { type: "load_error", source: "proposals" });
    expect(checkActiveMode(snap, { records, roles: [roleA] })).toBeNull();
  });

  it("invalidates when a selected role disappeared", () => {
    const snap = snapshot("swap", "swap", [roleA, roleB]);
    const result = checkActiveMode(snap, { records: allReady(), roles: [roleA] });
    expect(result?.kind).toBe("role_missing");
    expect(result?.message).toBe(ACTIVE_MODE_COPY.role_missing);
  });

  it("invalidates when an observed revision changed", () => {
    const snap = snapshot("edit", "editTeam", [roleA]);
    const result = checkActiveMode(snap, {
      records: allReady(),
      roles: [{ _id: "role-a", _rev: "rev-a2" }],
    });
    expect(result?.kind).toBe("revision_changed");
    expect(result?.message).toBe(ACTIVE_MODE_COPY.revision_changed);
  });

  it("invalidates after a required source reloaded, even with identical revisions", () => {
    const snap = snapshot("copy", "copyInstruments", [roleA]);
    const reloaded = reduceSourceRecords(
      reduceSourceRecords(allReady(), { type: "load_start", sources: ["members"] }),
      { type: "load_ok", source: "members" },
    );
    const result = checkActiveMode(snap, { records: reloaded, roles: [roleA] });
    expect(result?.kind).toBe("source_reloaded");
  });

  it("does not invalidate on a reload of an unrequired source", () => {
    const snap = snapshot("copy", "copyInstruments", [roleA]);
    const reloaded = reduceSourceRecords(
      reduceSourceRecords(allReady(), { type: "load_start", sources: ["setlistTargets"] }),
      { type: "load_ok", source: "setlistTargets" },
    );
    expect(checkActiveMode(snap, { records: reloaded, roles: [roleA] })).toBeNull();
  });

  it("latches the first invalidation so a recovered source cannot silently re-arm the submit", () => {
    const snap = snapshot("edit", "editTeam");
    const failed = reduceSourceRecords(allReady(), { type: "load_error", source: "members" });
    const first = latchInvalidation(null, checkActiveMode(snap, { records: failed, roles: [roleA] }));
    expect(first?.kind).toBe("source_unready");
    // Source recovers; the stale snapshot must still require an explicit reload.
    const recovered = reduceSourceRecords(failed, { type: "load_ok", source: "members" });
    const later = latchInvalidation(first, checkActiveMode(snap, { records: recovered, roles: [roleA] }));
    expect(later).toBe(first);
  });

  it("latching is a no-op while everything is valid", () => {
    expect(latchInvalidation(null, null)).toBeNull();
  });
});

// ── Types used by the panel are the shipped ones ─────────────────────────────

describe("contract reuse", () => {
  it("gates from the individual source states, never from aggregate confidence", () => {
    // A partial load is the ONLY thing `dataConfidence` describes; the guard must
    // not consult it. Members down => editTeam blocked, unpublish still open,
    // which an aggregate value could not express.
    const sources: ServiceSourceStates = { ...READY_STATES, members: "error" };
    expect(guardControl(sources, "editTeam").ok).toBe(false);
    expect(guardControl(sources, "unpublish").ok).toBe(true);
  });

  it("withState helper covers loading and error for one source", () => {
    expect(sourceStates(withState("members", "error")).members).toBe("error");
    expect(sourceStates(withState("members", "loading")).members).toBe("loading");
  });
});
