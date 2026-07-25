// Every presentational decision `/admin -> Servicios` makes (Plan B items 7-9).
//
// vitest runs with `environment: "node"` and there is no `@testing-library`, so the
// decisions the card USED to bury in JSX live in pure functions and are table-tested
// here: section order, strip mapping, issue copy, the command-summary counters, bulk
// selection + skipped reasons, action routing (including "a malformed setlist never
// opens the editor"), the per-target month preflight, and the proof that rendering
// copies the shipped 15-rule ladder instead of re-deriving it.
//
// The 320px/375px overflow rule cannot be measured without a DOM; what IS asserted
// here are the class invariants that keep it true (`min-w-0`, wrapping long copy, a
// viewport-capped menu, a ≥44px touch target). Real pixel verification stays a
// manual/deployed check.

import { describe, expect, it } from "vitest";

import {
  buildProposalSummary,
  buildRoleTargets,
  buildSetlistTargets,
  type ProposalDomainSummary,
  type RoleDomainSummary,
  type SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import type { CanonicalMember } from "@/app/utils/serviceReadModel";
import {
  PRIMARY_ACTION_LABELS,
  deriveServiceReadiness,
  type PrimaryActionKind,
  type ProposalPresentation,
  type ServiceIntegrityIssueKind,
  type ServiceReadiness,
  type ServiceReadinessInput,
  type ServiceSourceStates,
  type SetlistStatus,
  type TeamStatus,
} from "../serviceReadiness";
import { PUBLISH_HARD_BLOCKERS, PUBLISH_SELECTION_SKIPS, PUBLISH_WORKFLOW_BLOCKERS } from "../publishSelection";
import { buildIntegrityQueue, type IntegrityQueue } from "../serviceIntegrityQueue";
import {
  CARD_SECTIONS,
  CARD_STYLE,
  PREFLIGHT_COPY,
  PUBLISH_SKIP_COPY,
  STRIP_MODULE_KEYS,
  buildPublishConfirmation,
  buildServiceCards,
  cardIdentity,
  cardPreview,
  commandSummaryCounters,
  commandSummarySegments,
  integrityTargetForCard,
  monthTargetPreflight,
  primaryActionRoute,
  proposalHandoffInput,
  readinessStripModules,
  selectCardObservation,
  selectProposalObservation,
  serviceCardRefs,
  serviceIssueLines,
  servicePrimaryActionProps,
  setlistReadFromSummary,
  type CardSourceSummaries,
  type MemberOption,
  type ServiceCardModel,
  type ServiceRole,
} from "../serviceCardModel";

const WEEK = "2026-08-09";
const TODAY = "2026-08-01";

const READY: ServiceSourceStates = {
  roles: "ready",
  members: "ready",
  proposals: "ready",
  roleTargets: "ready",
  setlistTargets: "ready",
};

// ── Readiness fixtures ───────────────────────────────────────────────────────

function setlistBody(over: Record<string, unknown> = {}) {
  return {
    targetState: "single",
    contentState: "ready",
    observed: { state: "single", id: "set-1", rev: "sr-1" },
    setlistId: "set-1",
    songs: [{ _key: "a" }],
    recentSongs: {},
    ...over,
  };
}

function readinessInput(over: Partial<ServiceReadinessInput> = {}): ServiceReadinessInput {
  return {
    sources: READY,
    published: false,
    recordValid: true,
    roleId: "role-1",
    roleTarget: "single",
    team: { assignedRefs: ["m1"], danglingRefs: [] },
    setlistResponse: setlistBody(),
    proposal: { validated: [], conflicts: [], recordIssues: [], draftIds: [] },
    serviceDate: WEEK,
    members: [{ _id: "m1", member_name: "Ana" }],
    integrityIssues: [],
    ...over,
  };
}

const readiness = (over: Partial<ServiceReadinessInput> = {}) =>
  deriveServiceReadiness(readinessInput(over));

function role(over: Partial<ServiceRole> = {}): ServiceRole {
  return {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    date: WEEK,
    published: false,
    leads: [{ _id: "m1", member_name: "Ana", _key: "k1" }],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    songs: [],
    ...over,
  };
}

function card(over: Partial<ServiceCardModel> = {}): ServiceCardModel {
  const r = over.role ?? role();
  return {
    role: r,
    cardId: r._id,
    day: WEEK,
    isPast: false,
    readiness: readiness(),
    observation: selectCardObservation(r, { roles: null, setlists: null, proposals: null }),
    integrityEntries: [],
    ...over,
  };
}

// ── 1. Card hierarchy ────────────────────────────────────────────────────────

describe("card hierarchy", () => {
  it("renders the plan's six sections in order", () => {
    // `ServiceReadinessCard` maps over this constant, so this IS the DOM order.
    expect([...CARD_SECTIONS]).toEqual([
      "identity",
      "readiness",
      "issues",
      "preview",
      "primary_action",
      "secondary_menu",
    ]);
  });

  it("puts the readiness strip and issues above the primary action", () => {
    const order = CARD_SECTIONS.indexOf.bind(CARD_SECTIONS);
    expect(order("readiness")).toBeLessThan(order("issues"));
    expect(order("issues")).toBeLessThan(order("preview"));
    expect(order("preview")).toBeLessThan(order("primary_action"));
    expect(order("primary_action")).toBeLessThan(order("secondary_menu"));
  });
});

// ── 2. Readiness strip ───────────────────────────────────────────────────────

describe("readiness strip", () => {
  it("always renders the four modules in order", () => {
    expect(readinessStripModules(readiness()).map((m) => m.key)).toEqual([...STRIP_MODULE_KEYS]);
  });

  const TEAM: [TeamStatus, string][] = [
    ["assigned", "ok"],
    ["empty", "warn"],
    ["unknown", "unknown"],
  ];
  it.each(TEAM)("maps team %s to a text/icon/tone triple", (status, tone) => {
    const base = readiness();
    const module = readinessStripModules({ ...base, teamStatus: status } as ServiceReadiness)[0];
    expect(module.text.length).toBeGreaterThan(0);
    expect(module.icon.length).toBeGreaterThan(0);
    expect(module.tone).toBe(tone);
  });

  it("reports a dangling assignment as an error, never as empty or assigned", () => {
    const r = readiness({ team: { assignedRefs: ["m1", "ghost"], danglingRefs: ["ghost"] } });
    const module = readinessStripModules(r)[0];
    expect(r.teamStatus).toBe("unknown");
    expect(module.tone).toBe("error");
    expect(module.text).toContain("inválida");
  });

  const SETLIST: [SetlistStatus, string][] = [
    ["ready", "ok"],
    ["incomplete", "warn"],
    ["none", "warn"],
    ["duplicate", "error"],
    ["draft_conflict", "error"],
    ["invalid", "error"],
    ["unknown", "unknown"],
  ];
  it.each(SETLIST)("maps setlist %s to a text/icon/tone triple", (status, tone) => {
    const module = readinessStripModules({
      ...readiness(),
      setlistStatus: status,
    } as ServiceReadiness)[1];
    expect(module.text.length).toBeGreaterThan(0);
    expect(module.icon.length).toBeGreaterThan(0);
    expect(module.tone).toBe(tone);
  });

  const PROPOSAL: [ProposalPresentation, string][] = [
    ["none", "neutral"],
    ["draft", "warn"],
    ["pending", "warn"],
    ["changes_requested", "warn"],
    ["approved", "approved"],
    ["conflict", "error"],
    ["invalid", "error"],
    ["draft_conflict", "error"],
    ["unknown", "unknown"],
  ];
  it.each(PROPOSAL)("maps proposal %s to a text/icon/tone triple", (presentation, tone) => {
    const module = readinessStripModules({
      ...readiness(),
      proposalPresentation: presentation,
    } as ServiceReadiness)[2];
    expect(module.text.length).toBeGreaterThan(0);
    expect(module.icon.length).toBeGreaterThan(0);
    expect(module.tone).toBe(tone);
  });

  it("counts availability conflicts and never reads a failure as clear", () => {
    const conflicted = readiness({
      members: [{ _id: "m1", member_name: "Ana", unavailableDates: [WEEK] }],
    });
    expect(readinessStripModules(conflicted)[3]).toMatchObject({
      tone: "error",
      text: "1 conflicto",
    });
    const unknown = readiness({ sources: { ...READY, members: "error" } });
    expect(readinessStripModules(unknown)[3]).toMatchObject({ tone: "unknown", icon: "?" });
  });

  it("never carries colour alone", () => {
    for (const module of readinessStripModules(readiness())) {
      expect(module.text.trim()).not.toBe("");
      expect(module.icon.trim()).not.toBe("");
      expect(module.label.trim()).not.toBe("");
    }
  });
});

// ── 3. Issue copy ────────────────────────────────────────────────────────────

describe("issue copy", () => {
  const KINDS: ServiceIntegrityIssueKind[] = [
    "invalid_record",
    "role_target_duplicate",
    "role_target_draft_conflict",
    "role_target_invalid",
    "dangling_assignment",
    "setlist_duplicate",
    "setlist_draft_conflict",
    "setlist_invalid",
    "proposal_invalid",
    "proposal_draft_conflict",
    "proposal_conflict",
    "lock",
    "legacy",
  ];

  it.each(KINDS)("has Spanish copy for a %s issue, with its ids", (kind) => {
    const base = readiness();
    const lines = serviceIssueLines({
      readiness: {
        ...base,
        integrityIssues: [{ kind, blocking: true, ids: ["doc-1"], reason: "duplicate" }],
      } as ServiceReadiness,
      sources: READY,
    });
    const line = lines.find((l) => l.key.endsWith(kind));
    expect(line).toBeDefined();
    expect(line!.text.length).toBeGreaterThan(0);
    expect(line!.text).toContain("doc-1");
    expect(line!.ids).toEqual(["doc-1"]);
    expect(line!.tone).toBe("error");
  });

  it("names the conflicting member and the stored note", () => {
    const r = readiness({
      members: [
        {
          _id: "m1",
          member_name: "Ana",
          unavailableDates: [WEEK],
          unavailabilityNotes: [{ date: WEEK, note: "viaje" }],
        },
      ],
    });
    const line = serviceIssueLines({ readiness: r, sources: READY }).find((l) =>
      l.key.startsWith("conflict-"),
    );
    expect(line?.text).toContain("Ana");
    expect(line?.text).toContain("viaje");
  });

  it("says 'sin razón indicada' when the member left no note", () => {
    const r = readiness({ members: [{ _id: "m1", member_name: "Ana", unavailableDates: [WEEK] }] });
    const line = serviceIssueLines({ readiness: r, sources: READY }).find((l) =>
      l.key.startsWith("conflict-"),
    );
    expect(line?.text).toContain("sin razón indicada");
  });

  it("names the failed/unknown source and its retry", () => {
    const sources: ServiceSourceStates = { ...READY, members: "error", proposals: "loading" };
    const line = serviceIssueLines({ readiness: readiness({ sources }), sources }).find(
      (l) => l.key === "sources",
    );
    expect(line?.text).toContain("miembros");
    expect(line?.text).toContain("Reintentar carga");
    expect(line?.tone).toBe("unknown");
  });

  it("covers the ordinary workflow gaps", () => {
    const pending = serviceIssueLines({
      readiness: readiness({
        proposal: { validated: [{ id: "p1", status: "pending" }], conflicts: [], recordIssues: [], draftIds: [] },
      }),
      sources: READY,
    });
    expect(pending.find((l) => l.key === "proposal")?.text).toContain("pendiente");

    const noSetlist = serviceIssueLines({
      readiness: readiness({
        setlistResponse: { targetState: "none", observed: { state: "none" }, setlistId: null, songs: [], recentSongs: {} },
      }),
      sources: READY,
    });
    expect(noSetlist.find((l) => l.key === "setlist")?.text).toContain("setlist");

    const noTeam = serviceIssueLines({
      readiness: readiness({ team: { assignedRefs: [], danglingRefs: [] }, members: [] }),
      sources: READY,
    });
    expect(noTeam.find((l) => l.key === "team")?.text).toContain("nadie asignado");
  });

  it("never claims a missing EXPECTED seat", () => {
    const lines = serviceIssueLines({
      readiness: readiness({ team: { assignedRefs: [], danglingRefs: [] }, members: [] }),
      sources: READY,
    });
    for (const line of lines) {
      expect(line.text).not.toMatch(/falta[n]? \d+ (lugar|puesto|asiento)/i);
    }
  });

  it("says nothing when nothing is wrong", () => {
    expect(serviceIssueLines({ readiness: readiness(), sources: READY })).toEqual([]);
  });
});

// ── 4. Command summary ───────────────────────────────────────────────────────

describe("command summary", () => {
  const withReadiness = (over: Partial<ServiceReadinessInput>, extra: Partial<ServiceCardModel> = {}) =>
    card({ readiness: readiness(over), ...extra });

  it("counts upcoming/past over the whole set and the rest over the visible set", () => {
    const past = withReadiness({}, { isPast: true });
    const upcomingReady = withReadiness({});
    const counters = commandSummaryCounters({
      all: [past, upcomingReady],
      visible: [upcomingReady],
    });
    expect(counters).toMatchObject({ upcoming: 1, past: 1, readyToPublish: 1, blockedDrafts: 0 });
  });

  it("counts ready drafts, blocked drafts, conflicts, pending proposals and integrity", () => {
    const ready = withReadiness({});
    const blocked = withReadiness({
      setlistResponse: { targetState: "none", observed: { state: "none" }, setlistId: null, songs: [], recentSongs: {} },
    });
    const conflicted = withReadiness({
      members: [{ _id: "m1", member_name: "Ana", unavailableDates: [WEEK] }],
    });
    const pending = withReadiness({
      proposal: { validated: [{ id: "p1", status: "changes_requested" }], conflicts: [], recordIssues: [], draftIds: [] },
    });
    const broken = withReadiness({ recordValid: false });
    const publishedClean = withReadiness({ published: true });

    const visible = [ready, blocked, conflicted, pending, broken, publishedClean];
    const counters = commandSummaryCounters({ all: visible, visible });
    expect(counters.readyToPublish).toBe(1);
    expect(counters.blockedDrafts).toBe(4);
    expect(counters.publishedReady).toBe(1);
    expect(counters.conflicts).toBe(1);
    expect(counters.pendingProposals).toBe(1);
    expect(counters.integrityIssues).toBe(1);
  });

  it("counts an unproven observation as an integrity/unknown issue", () => {
    const unknown = withReadiness({ sources: { ...READY, setlistTargets: "error" } });
    expect(commandSummaryCounters({ all: [unknown], visible: [unknown] }).integrityIssues).toBe(1);
  });

  it("renders the plan's Spanish line and omits empty segments", () => {
    const segments = commandSummarySegments({
      upcoming: 6,
      past: 0,
      readyToPublish: 2,
      publishedReady: 0,
      conflicts: 1,
      pendingProposals: 1,
      integrityIssues: 0,
      blockedDrafts: 0,
    });
    expect(segments.join(" · ")).toBe(
      "6 próximos · 2 listos para publicar · 1 conflicto · 1 propuesta pendiente",
    );
  });

  it("always shows the upcoming count, even at zero", () => {
    const segments = commandSummarySegments({
      upcoming: 0,
      past: 0,
      readyToPublish: 0,
      publishedReady: 0,
      conflicts: 0,
      pendingProposals: 0,
      integrityIssues: 0,
      blockedDrafts: 0,
    });
    expect(segments).toEqual(["0 próximos"]);
  });
});

// ── 5. Bulk publishing ───────────────────────────────────────────────────────

describe("Publicar listos", () => {
  it("selects only visible drafts that are ready, and explains every skipped draft", () => {
    const ready = card({ role: role({ _id: "ok-1" }), readiness: readiness() });
    const blockedDraft = card({
      role: role({ _id: "blocked-1" }),
      readiness: readiness({ team: { assignedRefs: [], danglingRefs: [] }, members: [] }),
    });
    const published = card({
      role: role({ _id: "pub-1", published: true }),
      readiness: readiness({ published: true }),
    });

    const plan = buildPublishConfirmation([ready, blockedDraft, published]);
    expect(plan.selected.map((s) => s.id)).toEqual(["ok-1"]);
    expect(plan.selected[0].rev).toBe("rev-1");
    expect(plan.skipped.map((s) => s.id)).toEqual(["blocked-1"]);
    expect(plan.skipped[0].reasons).toContain("team_empty");
    expect(plan.skipped[0].text).toContain("equipo");
    // An already-published card is not a draft the admin needs explained.
    expect(plan.skipped.map((s) => s.id)).not.toContain("pub-1");
  });

  it("never silently includes an integrity-blocked draft", () => {
    const duplicate = card({
      role: role({ _id: "dup-1" }),
      readiness: readiness({ roleTarget: "duplicate", roleTargetIds: ["dup-1", "dup-2"] }),
    });
    const plan = buildPublishConfirmation([duplicate]);
    expect(plan.selected).toEqual([]);
    expect(plan.skipped[0].reasons).toContain("role_target_duplicate");
  });

  it("has Spanish copy for every blocker and skip code", () => {
    for (const code of [
      ...PUBLISH_WORKFLOW_BLOCKERS,
      ...PUBLISH_HARD_BLOCKERS,
      ...PUBLISH_SELECTION_SKIPS,
    ]) {
      expect(PUBLISH_SKIP_COPY[code]).toBeTruthy();
    }
  });

  it("labels each entry with its local-noon date", () => {
    const plan = buildPublishConfirmation([card()]);
    expect(plan.selected[0].label).toContain("Domingo");
    expect(plan.selected[0].label).toContain("ago");
  });
});

// ── 6. Action routing ────────────────────────────────────────────────────────

describe("primary action", () => {
  it("renders the ladder's own result and never re-derives it", () => {
    const clean = readiness();
    expect(clean.primaryAction.kind).toBe("publish");
    // A tampered action must still be what is rendered: the component copies.
    const tampered: ServiceReadiness = {
      ...clean,
      primaryAction: {
        kind: "edit_service",
        label: PRIMARY_ACTION_LABELS.edit_service,
        disabled: false,
        rule: 15,
      },
    };
    const props = servicePrimaryActionProps(tampered);
    expect(props.kind).toBe("edit_service");
    expect(props.label).toBe("Editar servicio");
    expect(props.rule).toBe(15);
  });

  const LADDER: [string, Partial<ServiceReadinessInput>, PrimaryActionKind, string][] = [
    ["invalid record", { recordValid: false }, "review_data", "integrity_details"],
    [
      "duplicate role target",
      { roleTarget: "duplicate", roleTargetIds: ["a", "b"] },
      "review_duplicate_roles",
      "integrity_details",
    ],
    [
      "duplicate setlist",
      { setlistResponse: { targetState: "duplicate", conflictingIds: ["s1", "s2"], draftIds: [], setlistId: null, songs: [], recentSongs: {} } },
      "review_setlist_data",
      "integrity_details",
    ],
    ["loading source", { sources: { ...READY, members: "loading" } }, "loading", "none"],
    ["failed source", { sources: { ...READY, members: "error" } }, "retry_load", "retry_sources"],
    [
      "availability conflict",
      { members: [{ _id: "m1", member_name: "Ana", unavailableDates: [WEEK] }] },
      "resolve_conflict",
      "service_modal",
    ],
    [
      "proposal conflict",
      { proposal: { validated: [], conflicts: [{ key: "role-1", ids: ["p1", "p2"] }], recordIssues: [], draftIds: [] } },
      "review_proposals",
      "proposal_handoff",
    ],
    [
      "pending proposal",
      { proposal: { validated: [{ id: "p1", status: "pending" }], conflicts: [], recordIssues: [], draftIds: [] } },
      "review_proposal",
      "proposal_handoff",
    ],
    [
      "missing setlist",
      { setlistResponse: { targetState: "none", observed: { state: "none" }, setlistId: null, songs: [], recentSongs: {} } },
      "complete_setlist",
      "setlist_editor",
    ],
    ["empty team", { team: { assignedRefs: [], danglingRefs: [] }, members: [] }, "edit_team", "service_modal"],
    ["clean draft", {}, "publish", "publish"],
    ["published", { published: true }, "edit_setlist", "setlist_editor"],
  ];

  it.each(LADDER)("routes %s (%o) to the existing flow", (_name, over, kind, route) => {
    const r = readiness(over);
    expect(r.primaryAction.kind).toBe(kind);
    expect(primaryActionRoute(r)).toBe(route);
  });

  it("never routes a malformed setlist to an editable editor", () => {
    const malformed = readiness({
      // Exactly what `setlistReadFromSummary` emits for a singleton whose stored
      // songs are malformed (duplicate `_key`, dangling song reference…).
      setlistResponse: setlistBody({ contentState: "invalid", recordIds: ["set-1"] }),
    });
    expect(malformed.setlistStatus).toBe("invalid");
    expect(malformed.setlistEditable).toBe(false);
    expect(primaryActionRoute(malformed)).toBe("integrity_details");

    // Even if the ladder somehow asked for the editor, a non-editable target wins.
    const forced: ServiceReadiness = {
      ...malformed,
      primaryAction: {
        kind: "edit_setlist",
        label: PRIMARY_ACTION_LABELS.edit_setlist,
        disabled: false,
        rule: 14,
      },
    };
    expect(primaryActionRoute(forced)).not.toBe("setlist_editor");
    expect(primaryActionRoute(forced)).toBe("integrity_details");
  });

  it("refetches instead of opening integrity details with no id (ladder rule 6)", () => {
    // Sources ready, but A1 could not prove the setlist target observation.
    const unproven = readiness({ setlistResponse: null });
    expect(unproven.primaryAction.rule).toBe(6);
    expect(unproven.primaryAction.label).toBe("Revisar datos");
    expect(primaryActionRoute(unproven)).toBe("retry_sources");
  });

  it("disables the action when its capability row is not ready", () => {
    const props = servicePrimaryActionProps(readiness(), {
      enabled: false,
      reason: "No se pudo cargar: miembros.",
    });
    expect(props.disabled).toBe(true);
    expect(props.reason).toContain("miembros");
  });
});

// ── 7. Handoff targets ───────────────────────────────────────────────────────

describe("handoff targets", () => {
  it("opens integrity details by explicit id, scoped to the action", () => {
    const dup = card({
      readiness: readiness({ roleTarget: "duplicate", roleTargetIds: ["role-1", "role-2"] }),
    });
    const target = integrityTargetForCard(dup);
    expect(target).toMatchObject({ kind: "integrity_issue", domain: "roles" });
    expect(target!.ids).toEqual(["role-1", "role-2"]);
    expect(target!.serviceRef).toBe("role-1");
  });

  it("scopes a setlist action to the setlist ids", () => {
    const bad = card({
      readiness: readiness({
        setlistResponse: {
          targetState: "draft_conflict",
          draftIds: ["drafts.set-1"],
          canonicalIds: ["set-1"],
          setlistId: null,
          songs: [],
          recentSongs: {},
        },
      }),
    });
    const target = integrityTargetForCard(bad);
    expect(target).toMatchObject({ domain: "setlists" });
    expect(target!.ids).toContain("drafts.set-1");
  });

  it("returns null when there is no id to open", () => {
    expect(integrityTargetForCard(card({ readiness: readiness({ setlistResponse: null }) }))).toBeNull();
  });

  it("hands the card's own A1 observation to the proposal handoff", () => {
    const observed = card({
      readiness: readiness({
        proposal: { validated: [{ id: "p1", status: "pending" }], conflicts: [], recordIssues: [], draftIds: [] },
      }),
    });
    const input = proposalHandoffInput(observed);
    expect(input).toMatchObject({
      serviceRef: "role-1",
      serviceType: "sunday_role",
      serviceDate: WEEK,
      presentation: "pending",
    });
  });
});

// ── 8. Per-card A1 selection ─────────────────────────────────────────────────

const MEMBER: CanonicalMember = {
  _id: "m1",
  _rev: "mr-1",
  member_name: "Ana",
} as CanonicalMember;

function summaries(over: Partial<CardSourceSummaries> = {}): CardSourceSummaries {
  const roleDoc = {
    _id: "role-1",
    _rev: "rev-1",
    _type: "sunday_role",
    week: WEEK,
    published: false,
    // All five seat paths must be arrays for A1 to call the record groupable.
    Lead: [{ _key: "k1", _type: "reference", _ref: "m1" }],
    BGVs: [],
    Chorus: [],
    instruments: [],
    foh_team: [],
  };
  const roles: RoleDomainSummary = buildRoleTargets(
    [roleDoc],
    [],
    new Map([["m1", MEMBER]]),
  );
  const setlists: SetlistDomainSummary = buildSetlistTargets(
    [
      {
        _id: "set-1",
        _rev: "sr-1",
        _type: "featuredSongs",
        week: WEEK,
        songs: [{ _key: "a", play_key: "G", song: { _ref: "song-1" } }],
      },
    ],
    [],
  );
  const proposals: ProposalDomainSummary = buildProposalSummary([], [], () => roleDoc);
  return { roles, setlists, proposals, ...over };
}

describe("per-card A1 selection", () => {
  it("projects the observed setlist target into the shipped response shape", () => {
    const body = setlistReadFromSummary(summaries().setlists, `featuredSongs:${WEEK}`) as Record<
      string,
      unknown
    >;
    expect(body.targetState).toBe("single");
    expect(body.contentState).toBe("ready");
    expect(body.setlistId).toBe("set-1");
    expect(body.recordIds).toBeUndefined();
  });

  it("names the document when a singleton's stored songs are invalid", () => {
    const sums = summaries();
    sums.setlists = buildSetlistTargets(
      [
        {
          _id: "set-1",
          _rev: "sr-1",
          _type: "featuredSongs",
          week: WEEK,
          // Duplicate `_key` — malformed content, not an ordinary empty setlist.
          songs: [
            { _key: "a", play_key: "G", song: { _ref: "song-1" } },
            { _key: "a", play_key: "G", song: { _ref: "song-2" } },
          ],
        },
      ],
      [],
    );
    const body = setlistReadFromSummary(sums.setlists, `featuredSongs:${WEEK}`) as Record<
      string,
      unknown
    >;
    expect(body.contentState).toBe("invalid");
    expect(body.recordIds).toEqual(["set-1"]);

    const r = readiness({ setlistResponse: body });
    expect(r.setlistEditable).toBe(false);
    expect(r.primaryAction.kind).toBe("review_setlist_data");
    expect(primaryActionRoute(r)).toBe("integrity_details");
  });

  it("reports an absent target as `none` and an unproven inventory as null", () => {
    const absent = setlistReadFromSummary(summaries().setlists, "featuredSongs:2030-01-06") as Record<
      string,
      unknown
    >;
    expect(absent.targetState).toBe("none");
    expect(setlistReadFromSummary(null, `featuredSongs:${WEEK}`)).toBeNull();
  });

  it("treats an unusable service date as an integrity issue, not an empty setlist", () => {
    const body = setlistReadFromSummary(summaries().setlists, null) as Record<string, unknown>;
    expect(body.targetState).toBe("invalid");
  });

  it("selects a proposal group by explicit id, never by regrouping", () => {
    const proposals: ProposalDomainSummary = {
      records: [
        { id: "p1", rev: "r", status: "pending", serviceRef: "role-1", targetKey: `sunday:${WEEK}`, contentState: "ready", valid: true, issues: [], referencedRole: null },
        { id: "p2", rev: "r", status: "pending", serviceRef: "other", targetKey: "sunday:2030-01-06", contentState: "ready", valid: true, issues: [], referencedRole: null },
      ],
      serviceRefConflicts: [],
      targetKeyConflicts: [],
      recordIssues: [],
      draftIds: ["drafts.p1"],
    };
    const observation = selectProposalObservation(proposals, "role-1");
    expect(observation!.validated).toEqual([{ id: "p1", status: "pending" }]);
    expect(observation!.draftIds).toEqual(["drafts.p1"]);
    expect(selectProposalObservation(null, "role-1")).toBeNull();
  });

  it("assembles a clean, ready-to-publish draft card from the three A1 summaries", () => {
    const sums = summaries();
    const members: MemberOption[] = [{ _id: "m1", member_name: "Ana" }];
    const queue = buildIntegrityQueue({
      sources: READY,
      cards: serviceCardRefs([role()], sums),
      roles: sums.roles,
      setlists: sums.setlists,
      proposals: sums.proposals,
    });
    const [assembled] = buildServiceCards({
      roles: [role()],
      members,
      sources: READY,
      summaries: sums,
      todayIso: TODAY,
      queue,
    });
    expect(assembled.readiness.teamStatus).toBe("assigned");
    expect(assembled.readiness.setlistStatus).toBe("ready");
    expect(assembled.readiness.proposalPresentation).toBe("none");
    expect(assembled.readiness.availabilityStatus).toBe("clear");
    expect(assembled.readiness.isReadyToPublish).toBe(true);
    expect(assembled.readiness.primaryAction.kind).toBe("publish");
    expect(assembled.isPast).toBe(false);
  });

  it("keeps the team honest when the role-target inventory is unproven", () => {
    const sums = summaries({ roles: null });
    const [assembled] = buildServiceCards({
      roles: [role()],
      members: [{ _id: "m1", member_name: "Ana" }],
      sources: { ...READY, roleTargets: "error" },
      summaries: sums,
      todayIso: TODAY,
      queue: null,
    });
    expect(assembled.readiness.roleTargetStatus).toBe("unknown");
    expect(assembled.readiness.isOperationallyReady).toBe(false);
    // The fallback shows the seats the roles source resolved, and can never make
    // the card look clean.
    expect(assembled.readiness.teamSummary.assignedRefCount).toBe(1);
    expect(assembled.readiness.primaryAction.kind).toBe("retry_load");
  });

  it("marks a past service past, from a local-noon calendar-day diff", () => {
    const [assembled] = buildServiceCards({
      roles: [role({ date: "2026-07-26" })],
      members: [],
      sources: READY,
      summaries: summaries(),
      todayIso: TODAY,
      queue: null,
    });
    expect(assembled.isPast).toBe(true);
  });
});

// ── 9. Identity + preview ────────────────────────────────────────────────────

describe("identity and preview", () => {
  it("formats the date at local noon and labels the publication state", () => {
    const identity = cardIdentity(card(), TODAY);
    expect(identity.dateText).toContain("2026");
    expect(identity.publication).toEqual({ text: "Borrador", tone: "warn" });
    expect(identity.relative).toBe("En 8 días");
  });

  it("uses calendar-day labels, not elapsed hours", () => {
    expect(cardIdentity(card({ role: role({ date: TODAY }) }), TODAY).relative).toBe("Hoy");
    expect(cardIdentity(card({ role: role({ date: "2026-08-02" }) }), TODAY).relative).toBe("Mañana");
    expect(cardIdentity(card({ role: role({ date: "2026-07-31" }) }), TODAY).relative).toBe("Ayer");
  });

  it("shows a published service as published", () => {
    const published = card({ readiness: readiness({ published: true }) });
    expect(cardIdentity(published, TODAY).publication).toEqual({
      text: "Publicado",
      tone: "approved",
    });
  });

  it("previews only what is stored", () => {
    const preview = cardPreview(
      role({
        leads: [{ _id: "m1", member_name: "Ana" }],
        instruments: [{ _key: "i1", instrument: "Bajo", person: { _id: "m2", member_name: "Luis" } }],
        foh: [{ _key: "f1", role: "Audio", person: null }],
        songs: [
          { play_key: "G", song: { _id: "s1", title: "Canción", author: "A", key: "A", slug: "c" } },
        ],
      }),
    );
    expect(preview.leadNames).toEqual(["Ana"]);
    expect(preview.instrumentNames).toEqual([{ label: "Bajo", name: "Luis", memberId: "m2" }]);
    expect(preview.fohNames).toEqual([]);
    expect(preview.songCount).toBe(1);
    expect(preview.songKeys).toEqual(["G"]);
  });
});

// ── 10. Month/create per-target preflight ────────────────────────────────────

describe("month target preflight", () => {
  const emptySummaries = (): CardSourceSummaries => ({
    roles: { targets: [], recordIssues: [], lockIssues: [] },
    setlists: { targets: [], recordIssues: [] },
    proposals: {
      records: [],
      serviceRefConflicts: [],
      targetKeyConflicts: [],
      recordIssues: [],
      draftIds: [],
    },
  });

  const emptyQueue: IntegrityQueue = {
    entries: [],
    byCard: {},
    cardIssues: {},
    incomplete: false,
    unproven: [],
    count: 0,
    associatedCount: 0,
  };

  it("is `creatable` only when every domain proves the target is vacant", () => {
    const result = monthTargetPreflight({
      sources: READY,
      summaries: emptySummaries(),
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result).toMatchObject({ state: "creatable", targetKey: `sunday_role:${WEEK}` });
  });

  it("is `checking` while a domain is still loading — never vacant", () => {
    const result = monthTargetPreflight({
      sources: { ...READY, proposals: "loading" },
      summaries: emptySummaries(),
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("checking");
  });

  it("is `unknown` when a domain failed", () => {
    const result = monthTargetPreflight({
      sources: { ...READY, setlistTargets: "error" },
      summaries: { ...emptySummaries(), setlists: null },
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("unknown");
    expect(result.blockedBy.map((b) => b.source)).toContain("setlistTargets");
  });

  it("is `unknown` when a source is ready but its inventory is unproven", () => {
    const result = monthTargetPreflight({
      sources: READY,
      summaries: { ...emptySummaries(), proposals: null },
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("unknown");
    expect(result.reasons).toContain("proposal_unobserved");
  });

  it("is `exists` for an unambiguous canonical role", () => {
    const sums = emptySummaries();
    sums.roles = {
      targets: [
        {
          targetKey: `sunday_role:${WEEK}`,
          type: "sunday_role",
          canonicalCount: 1,
          canonicalIds: ["role-1"],
          canonicalState: "single",
          publicState: "single",
          memberVisibleCount: 1,
          draftIds: [],
          records: [],
          expectsLock: true,
          lock: null,
          lockIssues: [],
        },
      ],
      recordIssues: [],
      lockIssues: [],
    };
    const result = monthTargetPreflight({
      sources: READY,
      summaries: sums,
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
      });
    expect(result.state).toBe("exists");
  });

  it("is `blocked` by orphan setlist history at the same target", () => {
    const sums = emptySummaries();
    sums.setlists = {
      targets: [
        {
          targetKey: `featuredSongs:${WEEK}`,
          type: "featuredSongs",
          canonicalCount: 1,
          canonicalIds: ["set-1"],
          canonicalState: "single",
          publicState: "single",
          contentState: "ready",
          songCount: 1,
          songKeys: ["a"],
          invalidEntries: [],
          draftIds: [],
          records: [],
        },
      ],
      recordIssues: [],
    };
    const result = monthTargetPreflight({
      sources: READY,
      summaries: sums,
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("blocked");
    expect(result.reasons).toContain("setlist_history");
    expect(result.ids).toContain("set-1");
  });

  it("is `blocked` by a weekend lock issue at the same target", () => {
    const sums = emptySummaries();
    sums.roles = {
      targets: [],
      recordIssues: [],
      lockIssues: [
        {
          kind: "orphan_lock",
          targetKey: `sunday_role:${WEEK}`,
          lockId: `roleTargetLock.sunday_role.${WEEK}`,
          roleId: "role-9",
        },
      ],
    };
    const result = monthTargetPreflight({
      sources: READY,
      summaries: sums,
      queue: emptyQueue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("blocked");
    expect(result.reasons).toContain("lock_not_eligible");
  });

  it("is `blocked` by a global integrity entry filed against the target", () => {
    const queue: IntegrityQueue = {
      ...emptyQueue,
      entries: [
        {
          key: "roles|role_target_draft_conflict|drafts.role-1",
          domain: "roles",
          kind: "role_target_draft_conflict",
          ids: ["drafts.role-1"],
          reasons: ["draft_only"],
          relatedIds: [],
          targetKey: `sunday_role:${WEEK}`,
          blocking: true,
          action: "discard_draft_via_operator",
          cardId: null,
        },
      ],
      count: 1,
    };
    const result = monthTargetPreflight({
      sources: READY,
      summaries: emptySummaries(),
      queue,
      type: "sunday_role",
      date: WEEK,
    });
    expect(result.state).toBe("blocked");
    expect(result.ids).toContain("drafts.role-1");
  });

  it("has Spanish copy and a tone for every preflight state", () => {
    for (const state of ["checking", "unknown", "exists", "blocked", "creatable"] as const) {
      expect(PREFLIGHT_COPY[state].text).toBeTruthy();
      expect(PREFLIGHT_COPY[state].tone).toBeTruthy();
    }
  });
});

// ── 11. Narrow-viewport class invariants ─────────────────────────────────────

describe("narrow viewport (320px / 375px) invariants", () => {
  it("keeps every card region shrinkable", () => {
    expect(CARD_STYLE.container).toContain("min-w-0");
    expect(CARD_STYLE.longText).toContain("min-w-0");
    expect(CARD_STYLE.menu).toContain("min-w-0");
    expect(CARD_STYLE.dialog).toContain("min-w-0");
  });

  it("wraps unbounded strings instead of widening the card", () => {
    expect(CARD_STYLE.longText).toContain("[overflow-wrap:anywhere]");
  });

  it("caps the menu against the viewport instead of a fixed width", () => {
    expect(CARD_STYLE.menu).toContain("100vw");
    expect(CARD_STYLE.menu).toContain("min(");
  });

  it("gives the primary action and the menu trigger a ≥44px touch target", () => {
    expect(CARD_STYLE.primaryAction).toContain("min-h-[44px]");
    expect(CARD_STYLE.menuTrigger).toContain("min-h-[44px]");
    expect(CARD_STYLE.menuTrigger).toContain("min-w-[44px]");
  });

  it("never pins card copy open with nowrap", () => {
    for (const value of Object.values(CARD_STYLE)) {
      expect(value).not.toContain("whitespace-nowrap");
    }
  });
});
