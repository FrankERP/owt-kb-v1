// Independent source loading state + per-control gating decisions for
// `/admin -> Servicios` (Plan B item 5).
//
// `ServicesPanel` loads five read domains INDEPENDENTLY (roles, members,
// proposals, role-target integrity, setlist-target integrity). Every decision
// that depends on their combined state lives here, framework-free and total, so
// it can be table-tested without a DOM:
//
//  - the per-source reducer (start / ok / error) and what stays rendered,
//  - the Spanish copy that names WHICH source is missing and offers its retry,
//  - the handler-entry guard for each control in the plan's capability matrix,
//  - "saved, but the refresh failed" honesty,
//  - invalidation of an active edit/swap/copy snapshot.
//
// It CONSUMES the shipped `serviceReadiness` contracts (`CONTROL_REQUIRED_SOURCES`,
// `selectServiceCapabilities`, `unreadySources`) and never re-derives a control's
// dependency list or a readiness dimension. Gating always reads the five
// individual source states — never aggregate `dataConfidence`, which the plan
// forbids as a gate.

import {
  CONTROL_REQUIRED_SOURCES,
  SERVICE_SOURCE_KEYS,
  unreadySources,
  type ServiceControl,
  type ServiceSourceKey,
  type ServiceSourceStates,
  type SourceState,
  type UnreadySource,
} from "./serviceReadiness";

// ── Records ──────────────────────────────────────────────────────────────────

export interface SourceRecord {
  status: SourceState;
  /**
   * True once this source has loaded successfully at least once, so the panel can
   * keep the last-successful data on screen during a refresh or after a failure
   * while still gating confirmation on `status`.
   */
  loaded: boolean;
  /** Bumped on every successful load — the observation generation for snapshots. */
  generation: number;
}

export type ServiceSourceRecords = Record<ServiceSourceKey, SourceRecord>;

export type SourceEvent =
  | { type: "load_start"; sources: readonly ServiceSourceKey[] }
  | { type: "load_ok"; source: ServiceSourceKey }
  | { type: "load_error"; source: ServiceSourceKey };

export function initialSourceRecords(): ServiceSourceRecords {
  const out = {} as ServiceSourceRecords;
  for (const source of SERVICE_SOURCE_KEYS) {
    out[source] = { status: "loading", loaded: false, generation: 0 };
  }
  return out;
}

/**
 * Apply one load event. A start marks only the named sources loading (their data
 * stays); a success bumps the generation; a failure keeps whatever was last
 * loaded so unrelated cards remain rendered — the `error` status is what disables
 * the controls that need it.
 */
export function reduceSourceRecords(
  records: ServiceSourceRecords,
  event: SourceEvent,
): ServiceSourceRecords {
  const next = { ...records };
  if (event.type === "load_start") {
    for (const source of event.sources) {
      next[source] = { ...records[source], status: "loading" };
    }
    return next;
  }
  const current = records[event.source];
  next[event.source] =
    event.type === "load_ok"
      ? { status: "ready", loaded: true, generation: current.generation + 1 }
      : { ...current, status: "error" };
  return next;
}

/** The five-source snapshot the shipped readiness/capability selectors consume. */
export function sourceStates(records: ServiceSourceRecords): ServiceSourceStates {
  const out = {} as ServiceSourceStates;
  for (const source of SERVICE_SOURCE_KEYS) out[source] = records[source].status;
  return out;
}

function keysWhere(
  records: ServiceSourceRecords,
  status: SourceState,
): ServiceSourceKey[] {
  return SERVICE_SOURCE_KEYS.filter((source) => records[source].status === status);
}

export function failedSources(records: ServiceSourceRecords): ServiceSourceKey[] {
  return keysWhere(records, "error");
}

export function loadingSources(records: ServiceSourceRecords): ServiceSourceKey[] {
  return keysWhere(records, "loading");
}

/** Retry refetches the failed sources, or everything when nothing is failed. */
export function retryTargets(records: ServiceSourceRecords): ServiceSourceKey[] {
  const failed = failedSources(records);
  return failed.length > 0 ? failed : [...SERVICE_SOURCE_KEYS];
}

export type RolesView = "loading" | "cards" | "error";

/**
 * A roles failure prevents card rendering and shows retry; a roles refresh keeps
 * the last-successful cards visible. Only the very first load shows skeletons.
 */
export function rolesView(records: ServiceSourceRecords): RolesView {
  const roles = records.roles;
  if (roles.status === "error") return "error";
  if (!roles.loaded) return "loading";
  return "cards";
}

/**
 * Month/past filters are a non-mutating view control over already-loaded roles:
 * the plan's matrix keeps loaded roles filterable during a partial load, and only
 * a roles failure (which removes the cards) takes them away.
 */
export function canFilterMonths(records: ServiceSourceRecords): boolean {
  return records.roles.loaded && records.roles.status !== "error";
}

// ── Endpoints + payload shape ────────────────────────────────────────────────

/** The shipped read routes, one per independently tracked source. */
export const SOURCE_ENDPOINTS: Record<ServiceSourceKey, string> = {
  roles: "/api/admin/roles",
  members: "/api/admin/members",
  proposals: "/api/admin/service-integrity/proposals",
  roleTargets: "/api/admin/service-integrity/roles",
  setlistTargets: "/api/admin/service-integrity/setlists",
};

/**
 * A 200 with the wrong shape is a failed load, not an empty one: a control must
 * never treat an unusable response as an empty array.
 */
export function isValidSourcePayload(source: ServiceSourceKey, body: unknown): boolean {
  if (source === "roles" || source === "members") return Array.isArray(body);
  return !!body && typeof body === "object" && !Array.isArray(body);
}

// ── Spanish copy ─────────────────────────────────────────────────────────────

export const SOURCE_LABEL: Record<ServiceSourceKey, string> = {
  roles: "servicios",
  members: "miembros",
  proposals: "propuestas",
  roleTargets: "integridad de roles",
  setlistTargets: "integridad de setlists",
};

const RETRY_HINT = "Usa «Reintentar carga».";

/** Canonical-order Spanish list ("miembros y propuestas", "… e integridad …"). */
export function describeSources(sources: readonly ServiceSourceKey[]): string {
  const unique = SERVICE_SOURCE_KEYS.filter((key) => sources.includes(key)).map(
    (key) => SOURCE_LABEL[key],
  );
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  const last = unique[unique.length - 1];
  const conjunction = /^[ií]/i.test(last) ? " e " : " y ";
  return `${unique.slice(0, -1).join(", ")}${conjunction}${last}`;
}

/** Copy that names the missing sources and offers their retry; null when ready. */
export function unreadyMessage(blockedBy: readonly UnreadySource[]): string | null {
  if (blockedBy.length === 0) return null;
  const failed = blockedBy.filter((b) => b.state === "error").map((b) => b.source);
  const loading = blockedBy.filter((b) => b.state === "loading").map((b) => b.source);
  const parts: string[] = [];
  if (failed.length > 0) {
    parts.push(`No se pudo cargar: ${describeSources(failed)}. ${RETRY_HINT}`);
  }
  if (loading.length > 0) parts.push(`Cargando ${describeSources(loading)}…`);
  return parts.join(" ");
}

/** Why this control is disabled right now, naming only ITS sources. */
export function controlBlockMessage(
  sources: ServiceSourceStates,
  control: ServiceControl,
): string | null {
  return unreadyMessage(unreadySources(sources, CONTROL_REQUIRED_SOURCES[control]));
}

// ── Handler-entry guard ──────────────────────────────────────────────────────

export interface ControlGuardResult {
  control: ServiceControl;
  ok: boolean;
  blockedBy: UnreadySource[];
  message: string | null;
}

/**
 * The single check used BOTH when rendering a control and at every handler entry
 * (modal open, submit, preview, confirm). It reads the individual source states
 * through the shipped matrix, so one blocked flow never disables an unrelated
 * control whose own dependencies are ready.
 */
export function guardControl(
  sources: ServiceSourceStates,
  control: ServiceControl,
): ControlGuardResult {
  const blockedBy = unreadySources(sources, CONTROL_REQUIRED_SOURCES[control]);
  return {
    control,
    ok: blockedBy.length === 0,
    blockedBy,
    message: unreadyMessage(blockedBy),
  };
}

// ── Which control a panel action belongs to ──────────────────────────────────

/**
 * Publishing needs the whole five-source bundle; hiding an already-published
 * service is the separate narrow capability, so an unavailable member, setlist or
 * proposal source must NOT prevent it (plan §"Unpublish is a separate safety
 * capability").
 */
export function publishControl(publishing: boolean): ServiceControl {
  return publishing ? "publishReady" : "unpublish";
}

/** The capability each service modal opens under. */
export function editModalControl(type: "add" | "edit" | "delete"): ServiceControl {
  if (type === "add") return "createService";
  return type === "edit" ? "editTeam" : "deleteService";
}

/**
 * True when a submitted edit would MOVE the service date, which is its own
 * capability row (all five sources) on top of ordinary field editing. Compared on
 * the `YYYY-MM-DD` calendar day only — a legacy datetime prefix is not a move.
 */
export function movesServiceDate(storedDate: unknown, submittedDate: unknown): boolean {
  if (typeof submittedDate !== "string" || submittedDate.length === 0) return false;
  const stored = typeof storedDate === "string" ? storedDate.slice(0, 10) : "";
  return submittedDate.slice(0, 10) !== stored;
}

// ── Mutation succeeded, refresh failed ───────────────────────────────────────

export const REFRESH_FAILED_PREFIX = "Guardado, pero no se pudo actualizar";

/**
 * After a successful mutation whose refresh failed, the panel must NOT claim a
 * fully refreshed success: it says what is unknown and keeps retry available.
 */
export function mutationOutcomeMessage(
  success: string,
  failed: readonly ServiceSourceKey[],
  prefix: string = REFRESH_FAILED_PREFIX,
): string {
  if (failed.length === 0) return success;
  return `${prefix} (${describeSources(failed)}). ${RETRY_HINT}`;
}

// ── Active edit / swap / copy invalidation ───────────────────────────────────

export type ActiveMode = "edit" | "delete" | "swap" | "copy" | "setlist";

/** The minimum identity an active mode observed: id + the revision it will send. */
export interface ObservedRole {
  _id: string;
  _rev: string;
}

export interface ActiveModeSnapshot {
  mode: ActiveMode;
  /** The control whose required sources this snapshot depends on. */
  control: ServiceControl;
  roles: ObservedRole[];
  /** Successful-load generation of every source at capture time. */
  generations: Record<ServiceSourceKey, number>;
}

export function captureActiveMode(input: {
  mode: ActiveMode;
  control: ServiceControl;
  roles: readonly ObservedRole[];
  records: ServiceSourceRecords;
}): ActiveModeSnapshot {
  const generations = {} as Record<ServiceSourceKey, number>;
  for (const source of SERVICE_SOURCE_KEYS) {
    generations[source] = input.records[source].generation;
  }
  return {
    mode: input.mode,
    control: input.control,
    roles: input.roles.map((r) => ({ _id: r._id, _rev: r._rev })),
    generations,
  };
}

export type ActiveModeInvalidationKind =
  | "source_unready"
  | "role_missing"
  | "revision_changed"
  | "source_reloaded";

export const ACTIVE_MODE_COPY: Record<ActiveModeInvalidationKind, string> = {
  source_unready: "Se perdió una fuente necesaria. Recarga antes de continuar.",
  role_missing: "Este servicio ya no existe. Recarga la lista.",
  revision_changed: "Alguien más cambió este servicio. Recarga e intenta de nuevo.",
  source_reloaded: "Los datos se actualizaron. Recarga tu selección antes de continuar.",
};

export interface ActiveModeInvalidation {
  kind: ActiveModeInvalidationKind;
  message: string;
  /** The sources involved, when the reason is a load state. */
  sources: ServiceSourceKey[];
  /** The role that disappeared or moved on, when the reason is identity. */
  roleId?: string;
}

/**
 * Whether an open edit/swap/copy snapshot may still be submitted. It refuses
 * rather than sending a stale snapshot when a required source failed or is
 * reloading, when a selected role disappeared, when an observed revision changed,
 * or when a required source reloaded underneath the open mode.
 *
 * Sources the mode does not require are ignored — an unrelated failure must not
 * cancel work in progress.
 */
export function checkActiveMode(
  snapshot: ActiveModeSnapshot,
  context: { records: ServiceSourceRecords; roles: readonly ObservedRole[] },
): ActiveModeInvalidation | null {
  const required = CONTROL_REQUIRED_SOURCES[snapshot.control];

  const blockedBy = unreadySources(sourceStates(context.records), required);
  if (blockedBy.length > 0) {
    const sources = blockedBy.map((b) => b.source);
    return {
      kind: "source_unready",
      message: `${ACTIVE_MODE_COPY.source_unready} (${describeSources(sources)})`,
      sources,
    };
  }

  for (const observed of snapshot.roles) {
    const current = context.roles.find((r) => r._id === observed._id);
    if (!current) {
      return {
        kind: "role_missing",
        message: ACTIVE_MODE_COPY.role_missing,
        sources: [],
        roleId: observed._id,
      };
    }
    if (current._rev !== observed._rev) {
      return {
        kind: "revision_changed",
        message: ACTIVE_MODE_COPY.revision_changed,
        sources: [],
        roleId: observed._id,
      };
    }
  }

  const reloaded = required.filter(
    (source) => context.records[source].generation !== snapshot.generations[source],
  );
  if (reloaded.length > 0) {
    return {
      kind: "source_reloaded",
      message: `${ACTIVE_MODE_COPY.source_reloaded} (${describeSources(reloaded)})`,
      sources: [...reloaded],
    };
  }

  return null;
}

/**
 * Keep the FIRST detected invalidation. A source that fails and then recovers
 * must not silently re-arm a submit built on the pre-failure snapshot; the
 * operator reloads explicitly.
 */
export function latchInvalidation(
  previous: ActiveModeInvalidation | null,
  next: ActiveModeInvalidation | null,
): ActiveModeInvalidation | null {
  return previous ?? next;
}
