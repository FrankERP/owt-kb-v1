// Every presentational decision `/admin -> Servicios` makes, as pure functions
// (Plan B items 7-9).
//
// The components in `ServiceReadinessCard` / `ReadinessBadge` /
// `ServicePrimaryAction` / `ServiceIssueList` render what this module returns and
// decide nothing themselves, so card ordering, issue copy, the
// command-summary counters, bulk-publish selection copy, action routing and the
// per-target month preflight are all table-testable in vitest's `node`
// environment — no DOM harness, no fake React renderer.
//
// It CONSUMES the shipped contracts and re-derives none of them:
//  - `./serviceReadiness`        — `deriveServiceReadiness`, the 15-rule action
//                                 ladder, the capability selector, the local-noon
//                                 date helpers. The primary action is RENDERED,
//                                 never recomputed (see `servicePrimaryActionProps`).
//  - `./publishSelection`        — `selectPublishReady` + the blocker vocabulary.
//  - `./serviceIntegrityQueue`   — the queue, its per-card association (`byCard` /
//                                 `cardIssues`), the kind/reason labels and the
//                                 `Integridad de datos` summary + tone.
//  - `./proposalHandoff`         — the transient target shapes.
//  - `@/app/utils/setlistReadContract` — the fail-closed editable gate.
//  - `@/app/utils/serviceReadModel`    — the canonical target-key helpers.
//
// Two selection notes, because they are the easy things to get wrong:
//
//  1. Per-card A1 observations are selected by EXPLICIT id / target-key lookup in
//     A1's own already-decided output (`RoleDomainSummary`, `SetlistDomainSummary`,
//     `ProposalDomainSummary`). The client never re-groups records, never picks a
//     winner inside an ambiguous group, and never invents a state A1 did not
//     report. A missing summary is `null` = unproven, never a clean value.
//
//  2. `setlistReadFromSummary` PROJECTS the observed setlist target into the
//     shipped admin-GET response shape, and the decision is then made by A1's own
//     `canEditSetlistResponse` through `deriveSetlist`. The projection carries no
//     editability rule of its own — which is why a malformed/duplicate/draft
//     target can never reach the editor (proven in the tests).

import {
  MALFORMED_RECORD_REASON,
} from "@/app/utils/setlistReadContract";
import {
  normalizeBaseId,
  roleTargetKey as canonicalRoleTargetKey,
  setlistTargetKey as canonicalSetlistTargetKey,
  type RoleType,
} from "@/app/utils/serviceReadModel";
import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import {
  deriveServiceReadiness,
  isPastServiceDate,
  parseServiceDateAtNoon,
  serviceDayOffset,
  type ObservedTargetState,
  type PrimaryActionKind,
  type ProposalObservation,
  type ServiceIntegrityIssue,
  type ServiceIntegrityIssueKind,
  type ServiceReadiness,
  type ServiceSourceStates,
  type TargetPreflight,
  type UnreadySource,
  deriveTargetPreflight,
} from "./serviceReadiness";
import {
  selectBulkOverride,
  selectPublishReady,
  type PublishCandidate,
  type PublishOverrideAcknowledgement,
  type PublishSelectionEntry,
  type PublishSkipReason,
  type PublishWorkflowBlocker,
} from "./publishSelection";
import {
  INTEGRITY_KIND_LABEL,
  describeIntegrityReason,
  type IntegrityCardRef,
  type IntegrityDomain,
  type IntegrityQueue,
  type IntegrityQueueEntry,
} from "./serviceIntegrityQueue";
import type { IntegrityIssueTarget, ProposalHandoffInput } from "./proposalHandoff";
import { unreadyMessage } from "./serviceSourceState";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Shared card types (the shape `/api/admin/roles` returns) ─────────────────

export type ServiceType = "sunday_role" | "saturday_role" | "special_role";

export interface MemberOption {
  _id: string;
  member_name: string;
  alias?: string;
  memberType?: string[];
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
  /**
   * Stable stored `_key` of the seat this member occupies, when it came from a
   * role seat rather than the member directory. Swaps address seats by this key,
   * never by rendered index.
   */
  _key?: string;
}

export interface SetlistSong {
  play_key: string;
  medley_tag?: string;
  song: { _id: string; title: string; author: string; key: string; slug: string };
}

export interface ServiceRole {
  _id: string;
  /** Revision observed when this card was loaded — sent with every mutation. */
  _rev: string;
  _type: ServiceType;
  date: string;
  service_name?: string;
  published?: boolean;
  leads: MemberOption[];
  bgvs: MemberOption[];
  chorus: MemberOption[];
  instruments: { _key?: string; instrument: string; person: MemberOption | null }[];
  foh: { _key?: string; role: string; person: MemberOption | null }[];
  songs?: SetlistSong[];
}

/**
 * A chip selection is identified by the stored seat `_key` (`itemKey`) the server
 * addresses — never by a rendered index, which a concurrent edit can shift.
 */
export type SwapSource =
  | { kind: "card"; roleId: string }
  | {
      kind: "member";
      roleId: string;
      section: "leads" | "bgvs" | "chorus";
      itemKey: string;
      member: MemberOption;
    }
  | {
      kind: "slot";
      roleId: string;
      section: "instruments" | "foh";
      itemKey: string;
      member: MemberOption | null;
      slotLabel: string;
    };

export const dn = (m: MemberOption) => m.alias?.trim() || m.member_name;

/**
 * Rough rendered width of an instrument/FOH pill (label chip + name), in
 * char-widths, so pills can be sorted narrow→wide. Names/labels at or below the
 * CSS min-width floor count as equal; an emoji suffix adds a bit of width.
 */
export const pillWidth = (label: string, value: string) =>
  Math.max(label.length, 4) +
  Math.max([...value].length + (/\p{Extended_Pictographic}/u.test(value) ? 2 : 0), 4);

// ── Identity labels + colours ────────────────────────────────────────────────
//
// Purple is reserved for special-service identity ONLY; readiness tone never uses
// it. Cyan = ready/action, green = published/approved, amber = incomplete/warning,
// red = conflicts/integrity.

export const SERVICE_LABEL: Record<ServiceType, string> = {
  sunday_role: "Domingo",
  saturday_role: "Sábado",
  special_role: "Especial",
};

export const SERVICE_BADGE: Record<ServiceType, string> = {
  sunday_role: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  saturday_role: "bg-recency-fg/15 text-recency-strong border border-recency-strong/30",
  special_role: "bg-info-fg/15 text-info-fg border border-info-fg/30",
};

export const CARD_HEADER: Record<ServiceType, string> = {
  sunday_role: "bg-surface-sunken border-accent",
  saturday_role: "bg-warning-surface-deep border-warning-fg",
  special_role: "bg-info-surface-deep border-info-fg",
};

export const CARD_BORDER: Record<ServiceType, string> = {
  sunday_role: "border-accent",
  saturday_role: "border-warning-fg",
  special_role: "border-info-fg",
};

export const CARD_ACCENT: Record<ServiceType, string> = {
  sunday_role: "text-accent",
  saturday_role: "text-warning-fg",
  special_role: "text-info-fg",
};

export const CARD_ACCENT_MUTED: Record<ServiceType, string> = {
  sunday_role: "text-accent/70",
  saturday_role: "text-warning-fg/70",
  special_role: "text-info-fg/70",
};

export const CARD_DIVIDER: Record<ServiceType, string> = {
  sunday_role: "bg-accent/20",
  saturday_role: "bg-warning-fg/20",
  special_role: "bg-info-fg/20",
};

/**
 * The accent as a TOKEN NAME, not a colour.
 *
 * This was `CARD_ACCENT_HEX`, three bare hex strings that consumers turned into
 * colours by concatenating a two-digit alpha: `` `${hex}55` ``. A token cannot be
 * appended to — `rgb(var(--accent-rgb) / 0.2)55` is not a valid <color> and the
 * browser drops the whole declaration — so consumers now pass these to
 * `themeColour()`, which always returns a finished colour.
 *
 * Exported from here and consumed in `ServiceReadinessCard`, so the two files
 * migrate together: whichever moved second would have been handing the other a
 * value it could no longer use.
 */
export const CARD_ACCENT_VAR: Record<ServiceType, string> = {
  sunday_role: "--accent-rgb",
  saturday_role: "--warning-fg-rgb",
  special_role: "--info-fg-rgb",
};

export const SECTION_LABEL: Record<string, string> = {
  leads: "Líder",
  bgvs: "BGV",
  chorus: "Coro",
  instruments: "Instrumento",
  foh: "FOH",
};

// ── Narrow-viewport style invariants ─────────────────────────────────────────
//
// A 320px/375px viewport cannot be measured without a DOM, so the rules that keep
// a card, a menu, a dialog and long issue copy inside it are class CONSTANTS the
// tests assert instead: every scroll container is `min-w-0`, every unbounded
// string wraps with `[overflow-wrap:anywhere]`, and the kebab menu is width-capped
// against the viewport rather than a fixed `w-52`. Real pixel verification stays a
// manual/deployed check.

export const CARD_STYLE = {
  /** Card root: a grid/flex child must be `min-w-0` or its content sets the width. */
  container: "min-w-0 rounded-xl border transition-all",
  /** Any admin-supplied or id-bearing string. */
  longText: "min-w-0 [overflow-wrap:anywhere]",
  /** The kebab menu: never wider than the viewport. */
  menu: "w-[min(13rem,calc(100vw-2.5rem))] min-w-0",
  /** A ≥44px touch target for the one primary action. */
  primaryAction: "min-h-[44px] w-full min-w-0",
  /** Secondary/destructive menu trigger. */
  menuTrigger: "min-h-[44px] min-w-[44px]",
  /** Dialog body. */
  dialog: "min-w-0 space-y-4",
} as const;

// ── Card hierarchy ───────────────────────────────────────────────────────────

/**
 * The plan's card hierarchy, in order. `ServiceReadinessCard` renders by mapping
 * over this list, so the constant IS the rendered order — a reordering here (or
 * there) breaks the test rather than silently drifting.
 *
 * Two sections were removed for the same reason — a card in a three-column month
 * view has to stay scannable:
 *  - the four-module readiness strip (Equipo · Setlist · Propuesta ·
 *    Disponibilidad), which sat between `identity` and `issues` and repeated what
 *    the issue lines and the preview already say;
 *  - `secondary_menu`, a full-width `Más acciones` bar at the foot of every card.
 *    Its two most-used items (`Editar equipo`, `Editar setlist`) are now icon
 *    buttons in the `identity` header, and the rest moved into a kebab beside
 *    them. Nothing was dropped — the actions moved, they did not shrink.
 */
export const CARD_SECTIONS = [
  "identity",
  "issues",
  "preview",
  "primary_action",
] as const;

export type CardSection = (typeof CARD_SECTIONS)[number];

// ── Per-card A1 observation selection ────────────────────────────────────────

export interface CardSourceSummaries {
  roles: RoleDomainSummary | null;
  setlists: SetlistDomainSummary | null;
  proposals: ProposalDomainSummary | null;
}

/** `YYYY-MM-DD` calendar day of a stored service date, or null when unusable. */
export function serviceDay(role: Pick<ServiceRole, "date">): string | null {
  return parseServiceDateAtNoon(role?.date) ? role.date.slice(0, 10) : null;
}

/** A1's canonical role target key for this card (`sunday_role:<week>` / role id). */
export function cardRoleTargetKey(role: ServiceRole): string | null {
  const day = serviceDay(role);
  return canonicalRoleTargetKey({
    _type: role._type,
    _id: role._id,
    week: day ?? undefined,
    date: day ?? undefined,
  });
}

/** A1's live-setlist target key (`featuredSongs:<week>` / `saturdarSongs:<week>` / role id). */
export function cardSetlistTargetKey(role: ServiceRole): string | null {
  return canonicalSetlistTargetKey(role._type, serviceDay(role) ?? undefined, role._id);
}

/** Member reference ids the ROLES source can see across all five seat paths. */
export function seatMemberRefs(role: ServiceRole): string[] {
  const out: string[] = [];
  for (const m of role.leads ?? []) if (nonEmptyString(m?._id)) out.push(m._id);
  for (const m of role.bgvs ?? []) if (nonEmptyString(m?._id)) out.push(m._id);
  for (const m of role.chorus ?? []) if (nonEmptyString(m?._id)) out.push(m._id);
  for (const s of role.instruments ?? []) if (nonEmptyString(s?.person?._id)) out.push(s.person!._id);
  for (const s of role.foh ?? []) if (nonEmptyString(s?.person?._id)) out.push(s.person!._id);
  return [...new Set(out)];
}

export interface CardObservation {
  recordValid: boolean;
  roleTarget: ObservedTargetState | null;
  roleTargetIds: string[];
  roleTargetKey: string | null;
  setlistTargetKey: string | null;
  team: { assignedRefs: string[]; danglingRefs: string[] };
  /** A `SetlistRead`-shaped projection, or null when the inventory is unproven. */
  setlistResponse: unknown | null;
  proposal: ProposalObservation | null;
}

/**
 * Project the observed setlist target into the shipped admin-GET response shape.
 * The editability DECISION stays with A1's `canEditSetlistResponse` (through
 * `deriveSetlist`); this only reports what was observed:
 *
 *  - unproven inventory            -> null (the card reports `unknown`)
 *  - no target key derivable       -> `invalid` (a bad service date is an integrity issue)
 *  - target absent from inventory  -> `none` (A1 inventories every canonical setlist)
 *  - raw draft overlay             -> `draft_conflict`
 *  - more than one canonical doc   -> `duplicate`
 *  - unusable identity             -> `invalid`
 *  - exactly one                   -> `single` + A1's own `contentState`
 */
export function setlistReadFromSummary(
  setlists: SetlistDomainSummary | null,
  targetKey: string | null,
): unknown | null {
  if (!setlists) return null;
  const base = { setlistId: null, songs: [] as unknown[], recentSongs: {} };
  if (!targetKey) {
    return { ...base, targetState: "invalid", reason: "unusable_service_date", recordIds: [] };
  }
  const target = (setlists.targets ?? []).find((t) => t?.targetKey === targetKey) ?? null;
  if (!target) return { ...base, targetState: "none", observed: { state: "none" } };
  if ((target.draftIds ?? []).length > 0) {
    return {
      ...base,
      targetState: "draft_conflict",
      draftIds: target.draftIds,
      canonicalIds: target.canonicalIds,
    };
  }
  if (target.canonicalCount > 1) {
    return {
      ...base,
      targetState: "duplicate",
      conflictingIds: target.canonicalIds,
      draftIds: target.draftIds ?? [],
    };
  }
  const record = target.records?.[0];
  if (!record || !nonEmptyString(record.id) || !nonEmptyString(record.rev)) {
    return {
      ...base,
      targetState: "invalid",
      reason: MALFORMED_RECORD_REASON,
      recordIds: target.canonicalIds ?? [],
    };
  }
  return {
    targetState: "single",
    contentState: target.contentState,
    observed: { state: "single", id: record.id, rev: record.rev },
    setlistId: record.id,
    songs: (record.songKeys ?? []).map((key) => ({ _key: key })),
    recentSongs: {},
    // Additive: A1's `single` branch carries no id list, but a singleton whose
    // CONTENT is invalid is still a document `Revisar datos del setlist` must be
    // able to name. The shipped gate ignores the extra field and still answers
    // `invalid_content`, so editability is unchanged.
    ...(target.contentState === "invalid" ? { recordIds: [record.id] } : {}),
  };
}

/**
 * A1's already-grouped proposal result for ONE service, selected by explicit id.
 * `targetKeyConflicts` are attached through A1's OWN `records` service refs — an
 * id lookup, not a client-side re-grouping or target-key reconstruction.
 */
export function selectProposalObservation(
  proposals: ProposalDomainSummary | null,
  roleId: string,
): ProposalObservation | null {
  if (!proposals) return null;
  const records = proposals.records ?? [];
  const serviceRefById = new Map<string, string | null>();
  for (const record of records) {
    if (nonEmptyString(record?.id)) serviceRefById.set(record.id, record.serviceRef ?? null);
  }

  const validated = records
    .filter((r) => r?.valid === true && r.serviceRef === roleId && nonEmptyString(r.id))
    .map((r) => ({ id: r.id, status: r.status }));

  const recordIssues = (proposals.recordIssues ?? [])
    .filter((r) => r?.serviceRef === roleId && nonEmptyString(r.id))
    .map((r) => ({ id: r.id, issues: r.issues ?? [] }));

  const conflicts: { key: string; ids: string[] }[] = [];
  const seenKeys = new Set<string>();
  const pushConflict = (key: unknown, ids: readonly string[] | undefined) => {
    if (!nonEmptyString(key) || seenKeys.has(key)) return;
    seenKeys.add(key);
    conflicts.push({ key, ids: [...(ids ?? [])].filter(nonEmptyString) });
  };
  for (const conflict of proposals.serviceRefConflicts ?? []) {
    if (conflict?.key === roleId) pushConflict(conflict.key, conflict.ids);
  }
  for (const conflict of proposals.targetKeyConflicts ?? []) {
    if ((conflict?.ids ?? []).some((id) => serviceRefById.get(id) === roleId)) {
      pushConflict(conflict.key, conflict.ids);
    }
  }

  const draftIds = (proposals.draftIds ?? []).filter(
    (id) => nonEmptyString(id) && serviceRefById.get(normalizeBaseId(id)) === roleId,
  );

  return { validated, conflicts, recordIssues, draftIds };
}

/**
 * Everything `deriveServiceReadiness` needs for ONE card, from A1's summaries.
 *
 * When the role-target inventory is unproven the team falls back to the seats the
 * ROLES source resolved. That can never manufacture a clean card:
 * `roleTargetStatus` is `unknown` in exactly that case, which blocks readiness and
 * drives the ladder's rule 6.
 */
export function selectCardObservation(
  role: ServiceRole,
  summaries: CardSourceSummaries,
): CardObservation {
  const roleTargetKey = cardRoleTargetKey(role);
  const setlistTargetKey = cardSetlistTargetKey(role);
  const roles = summaries.roles;

  let roleTarget: ObservedTargetState | null = null;
  let roleTargetIds: string[] = [];
  let recordValid = true;
  let team = { assignedRefs: seatMemberRefs(role), danglingRefs: [] as string[] };

  if (roles) {
    const target =
      (roles.targets ?? []).find((t) =>
        (t?.canonicalIds ?? []).includes(role._id),
      ) ??
      (roleTargetKey ? (roles.targets ?? []).find((t) => t?.targetKey === roleTargetKey) : null) ??
      null;
    if (target) {
      roleTarget = target.publicState;
      roleTargetIds = [...(target.canonicalIds ?? []), ...(target.draftIds ?? [])];
      const record = (target.records ?? []).find((r) => r?.id === role._id) ?? null;
      if (record) {
        team = {
          assignedRefs: [...(record.assignedRefs ?? [])],
          danglingRefs: [...(record.danglingRefs ?? [])],
        };
      }
    }
    const issue = (roles.recordIssues ?? []).find(
      (r) => r?.id === role._id && r.kind === "invalid_role",
    );
    if (issue) {
      recordValid = false;
      roleTargetIds = [...new Set([...roleTargetIds, ...(issue.draftIds ?? [])])];
    }
  }

  return {
    recordValid,
    roleTarget,
    roleTargetIds: [...new Set(roleTargetIds.filter(nonEmptyString))],
    roleTargetKey,
    setlistTargetKey,
    team,
    setlistResponse: setlistReadFromSummary(summaries.setlists, setlistTargetKey),
    proposal: selectProposalObservation(summaries.proposals, role._id),
  };
}

/** Index cards for the integrity queue's association rules. */
export function serviceCardRefs(
  roles: readonly ServiceRole[],
  summaries: CardSourceSummaries,
): IntegrityCardRef[] {
  return (roles ?? []).map((role) => {
    const observation = selectCardObservation(role, summaries);
    return {
      cardId: role._id,
      roleId: role._id,
      roleTargetKey: observation.roleTargetKey,
      setlistTargetKey: observation.setlistTargetKey,
      validated: observation.recordValid,
    };
  });
}

// ── The assembled card model ─────────────────────────────────────────────────

export interface ServiceCardModel {
  role: ServiceRole;
  cardId: string;
  /** `YYYY-MM-DD` in America/Mexico_City, or null when the stored date is unusable. */
  day: string | null;
  isPast: boolean;
  readiness: ServiceReadiness;
  observation: CardObservation;
  /** Every integrity entry the queue associated with this card. */
  integrityEntries: IntegrityQueueEntry[];
}

export function buildServiceCards(input: {
  roles: readonly ServiceRole[];
  members: readonly MemberOption[];
  sources: ServiceSourceStates;
  summaries: CardSourceSummaries;
  todayIso: string;
  /** Built from the same summaries; supplies `lock`/`legacy` issues per card. */
  queue: IntegrityQueue | null;
}): ServiceCardModel[] {
  const membersById = new Map<string, MemberOption>();
  for (const member of input.members ?? []) {
    if (nonEmptyString(member?._id)) membersById.set(member._id, member);
  }

  return (input.roles ?? []).map((role) => {
    const observation = selectCardObservation(role, input.summaries);
    const day = serviceDay(role);
    const assigned = observation.team.assignedRefs
      .map((ref) => membersById.get(ref))
      .filter((m): m is MemberOption => !!m);

    const readiness = deriveServiceReadiness({
      sources: input.sources,
      published: role.published,
      recordValid: observation.recordValid,
      roleId: role._id,
      roleTarget: observation.roleTarget,
      roleTargetIds: observation.roleTargetIds,
      team: observation.team,
      setlistResponse: observation.setlistResponse,
      proposal: observation.proposal,
      serviceDate: day,
      members: assigned,
      integrityIssues: input.queue?.cardIssues?.[role._id] ?? [],
    });

    return {
      role,
      cardId: role._id,
      day,
      isPast: isPastServiceDate(role.date, input.todayIso),
      readiness,
      observation,
      integrityEntries: input.queue?.byCard?.[role._id] ?? [],
    };
  });
}

// ── Identity ─────────────────────────────────────────────────────────────────

/** Long Spanish date, parsed at LOCAL NOON so it can never day-flip. */
export function formatServiceDate(iso: unknown, locale = "es-ES"): string {
  const parsed = parseServiceDateAtNoon(iso);
  if (!parsed) return "Fecha inválida";
  return parsed.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Short Spanish date for confirmation lists and toasts. */
export function formatServiceDateShort(iso: unknown): string {
  const parsed = parseServiceDateAtNoon(iso);
  if (!parsed) return "fecha inválida";
  return parsed.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
}

/** `Domingo · 9 ago` — the label a confirmation list and a handoff notice use. */
export function serviceCardLabel(role: ServiceRole): string {
  const name = role.service_name?.trim() || SERVICE_LABEL[role._type];
  return `${name} · ${formatServiceDateShort(role.date)}`;
}

export interface CardIdentity {
  title: string;
  dateText: string;
  typeLabel: string;
  /** Draft/published badge — text + tone, never colour alone. */
  publication: { text: string; tone: ReadinessTone };
  /** Calendar-day countdown label, at local noon (never elapsed hours). */
  relative: string | null;
}

export function cardIdentity(card: ServiceCardModel, todayIso: string): CardIdentity {
  const role = card.role;
  const offset = serviceDayOffset(role.date, todayIso);
  const relative =
    offset === null
      ? null
      : offset === 0
        ? "Hoy"
        : offset === 1
          ? "Mañana"
          : offset === -1
            ? "Ayer"
            : offset > 1
              ? `En ${offset} días`
              : `Hace ${Math.abs(offset)} días`;
  return {
    title: role.service_name?.trim() || SERVICE_LABEL[role._type],
    dateText: formatServiceDate(role.date),
    typeLabel: SERVICE_LABEL[role._type],
    publication:
      card.readiness.publishState === "draft"
        ? { text: "Borrador", tone: "warn" }
        : { text: "Publicado", tone: "approved" },
    relative,
  };
}

// ── Readiness tones ──────────────────────────────────────────────────────────

export type ReadinessTone = "ok" | "approved" | "warn" | "error" | "unknown" | "neutral";

/** Dark-mode-only tone classes. Purple is never a readiness tone. */
export const TONE_CLASS: Record<ReadinessTone, string> = {
  ok: "border-accent/40 bg-accent/10 text-accent",
  approved: "border-green-500/40 bg-green-500/10 text-green-400",
  warn: "border-warning-fg/40 bg-warning-fg/10 text-warning-strong",
  error: "border-negative-strong/50 bg-negative-strong/10 text-negative-muted",
  unknown: "border-mono-500/40 bg-mono-500/10 text-mono-300",
  neutral: "border-mono-600/40 bg-transparent text-mono-400",
};

// ── Blocking issue copy ──────────────────────────────────────────────────────

export interface ServiceIssueLine {
  key: string;
  text: string;
  tone: ReadinessTone;
  /** Explicit document/draft ids, when A1/A2 supplied them. */
  ids: string[];
}

const PROPOSAL_WORKFLOW_COPY: Partial<Record<ServiceReadiness["proposalPresentation"], string>> = {
  draft: "La propuesta sigue en borrador: nadie la envió a revisión.",
  pending: "Hay una propuesta pendiente de revisión.",
  changes_requested: "La propuesta tiene cambios solicitados.",
};

// `none` is deliberately absent: roles are published BEFORE anyone plans a
// setlist, so "todavía no tiene setlist" fired on every fresh service and read as
// a problem when it is the normal starting state. An `incomplete` setlist is a
// real half-finished edit and still gets a line.
const SETLIST_WORKFLOW_COPY: Partial<Record<ServiceReadiness["setlistStatus"], string>> = {
  incomplete: "El setlist está incompleto.",
};

/**
 * Concise, actionable Spanish copy for everything blocking this card: unready
 * sources, each associated integrity issue (reusing the queue's own kind/reason
 * vocabulary), availability conflicts with their note, and the ordinary workflow
 * gaps. Nothing here claims a missing EXPECTED seat — role documents store
 * assignments, not a required-seat template.
 */
export function serviceIssueLines(input: {
  readiness: ServiceReadiness;
  sources: ServiceSourceStates;
}): ServiceIssueLine[] {
  const { readiness, sources } = input;
  const lines: ServiceIssueLine[] = [];

  const unready: UnreadySource[] = (
    ["roles", "members", "proposals", "roleTargets", "setlistTargets"] as const
  )
    .filter((key) => sources[key] !== "ready")
    .map((key) => ({ source: key, state: sources[key] as "loading" | "error" }));
  const sourceMessage = unreadyMessage(unready);
  if (sourceMessage) {
    lines.push({ key: "sources", text: sourceMessage, tone: "unknown", ids: [] });
  }

  for (const [index, issue] of readiness.integrityIssues.entries()) {
    const reason = issue.reason ? describeIntegrityReason(issue.reason) : "";
    const ids = issue.ids.filter(nonEmptyString);
    const detail = [reason, ids.length > 0 ? ids.join(" · ") : ""].filter(Boolean).join(" — ");
    lines.push({
      key: `issue-${index}-${issue.kind}`,
      text: detail
        ? `${INTEGRITY_KIND_LABEL[issue.kind]}: ${detail}`
        : INTEGRITY_KIND_LABEL[issue.kind],
      tone: "error",
      ids,
    });
  }

  for (const conflict of readiness.conflicts) {
    lines.push({
      key: `conflict-${conflict.memberId}`,
      text: conflict.note
        ? `${conflict.memberName} no está disponible — «${conflict.note}»`
        : `${conflict.memberName} no está disponible — sin razón indicada`,
      tone: "error",
      ids: [conflict.memberId],
    });
  }

  const proposalCopy = PROPOSAL_WORKFLOW_COPY[readiness.proposalPresentation];
  if (proposalCopy) {
    lines.push({ key: "proposal", text: proposalCopy, tone: "warn", ids: [] });
  }

  const setlistCopy = SETLIST_WORKFLOW_COPY[readiness.setlistStatus];
  if (setlistCopy) {
    lines.push({ key: "setlist", text: setlistCopy, tone: "warn", ids: [] });
  }

  if (readiness.teamStatus === "empty") {
    lines.push({
      key: "team",
      text: "Todavía no hay nadie asignado a este servicio.",
      tone: "warn",
      ids: [],
    });
  }

  return lines;
}

// ── Team / setlist preview ───────────────────────────────────────────────────

export interface CardPreview {
  leadNames: string[];
  instrumentNames: { label: string; name: string; memberId: string }[];
  fohNames: { label: string; name: string; memberId: string }[];
  songCount: number;
  /** Musical keys of the observed songs, when the roles source supplied them. */
  songKeys: string[];
}

/**
 * What the card shows about the assigned team and setlist. It reports only what
 * IS stored: never "N seats missing", because a role document has no authoritative
 * required-seat template.
 */
export function cardPreview(role: ServiceRole): CardPreview {
  const songs = role.songs ?? [];
  return {
    leadNames: (role.leads ?? []).map(dn),
    instrumentNames: (role.instruments ?? [])
      .filter((s) => s.person)
      .map((s) => ({ label: s.instrument, name: dn(s.person!), memberId: s.person!._id })),
    fohNames: (role.foh ?? [])
      .filter((s) => s.person)
      .map((s) => ({ label: s.role, name: dn(s.person!), memberId: s.person!._id })),
    songCount: songs.length,
    songKeys: songs.map((s) => s.play_key || s.song?.key).filter(nonEmptyString),
  };
}

// ── Primary action routing ───────────────────────────────────────────────────

export type PrimaryActionRoute =
  | "integrity_details"
  | "retry_sources"
  | "service_modal"
  | "setlist_editor"
  | "publish"
  | "proposal_handoff"
  | "none";

const ROUTE_BY_KIND: Record<PrimaryActionKind, PrimaryActionRoute> = {
  review_data: "integrity_details",
  review_duplicate_roles: "integrity_details",
  review_setlist_data: "integrity_details",
  loading: "none",
  retry_load: "retry_sources",
  resolve_conflict: "service_modal",
  review_proposals: "proposal_handoff",
  review_proposal: "proposal_handoff",
  complete_setlist: "setlist_editor",
  edit_team: "service_modal",
  publish: "publish",
  edit_setlist: "setlist_editor",
  edit_service: "service_modal",
};

/**
 * Where the ONE primary action goes. The action itself always comes from the
 * shipped ladder — this only says which existing flow opens.
 *
 * Two fail-closed adjustments, both tested:
 *  - a setlist action never opens the editor unless A1's own gate said the target
 *    is editable; a malformed/duplicate/draft target goes to integrity details;
 *  - `Revisar datos` with no explicit id to open (ladder rule 6: sources are ready
 *    but an observation could not be proven) refetches the inventory instead of
 *    opening a details view keyed by nothing.
 */
export function primaryActionRoute(readiness: ServiceReadiness): PrimaryActionRoute {
  const kind = readiness.primaryAction.kind;
  const route = ROUTE_BY_KIND[kind] ?? "none";
  if (route === "setlist_editor" && !readiness.setlistEditable) return "integrity_details";
  if (route === "integrity_details" && integrityActionIds(readiness).length === 0) {
    return "retry_sources";
  }
  return route;
}

/** Explicit ids a `Revisar…` action can open, in issue order. */
export function integrityActionIds(readiness: ServiceReadiness): string[] {
  const kind = readiness.primaryAction.kind;
  const relevant = readiness.integrityIssues.filter((issue) => {
    if (kind === "review_setlist_data") return issue.kind.startsWith("setlist_");
    if (kind === "review_duplicate_roles") return issue.kind === "role_target_duplicate";
    return issue.blocking;
  });
  return [...new Set(relevant.flatMap((issue) => issue.ids).filter(nonEmptyString))];
}

export interface PrimaryActionProps {
  kind: PrimaryActionKind;
  label: string;
  disabled: boolean;
  rule: number;
  route: PrimaryActionRoute;
  /** Why the control is disabled right now (source state), else null. */
  reason: string | null;
}

/**
 * The props `ServicePrimaryAction` renders. The kind, label, disabled flag and
 * rule are COPIED from `resolvePrimaryAction`'s output — this function never
 * inspects a readiness dimension to pick an action, so the 15-rule ladder stays
 * the single source of truth (proven in the tests).
 */
export function servicePrimaryActionProps(
  readiness: ServiceReadiness,
  capability?: { enabled: boolean; reason: string | null } | null,
): PrimaryActionProps {
  const action = readiness.primaryAction;
  const route = primaryActionRoute(readiness);
  const gated = capability && !capability.enabled ? capability : null;
  return {
    kind: action.kind,
    label: action.label,
    rule: action.rule,
    route,
    disabled: action.disabled || !!gated,
    reason: gated ? (gated.reason ?? "Datos incompletos.") : null,
  };
}

/** Which capability row each route must be re-checked against. */
export const ROUTE_CONTROL = {
  service_modal: "editTeam",
  setlist_editor: "editSetlist",
  publish: "publishReady",
  proposal_handoff: "proposalHandoff",
  integrity_details: null,
  retry_sources: null,
  none: null,
} as const;

// ── Handoff targets ──────────────────────────────────────────────────────────

const ISSUE_DOMAIN: Record<ServiceIntegrityIssueKind, IntegrityDomain> = {
  invalid_record: "roles",
  role_target_duplicate: "roles",
  role_target_draft_conflict: "roles",
  role_target_invalid: "roles",
  dangling_assignment: "roles",
  setlist_duplicate: "setlists",
  setlist_draft_conflict: "setlists",
  setlist_invalid: "setlists",
  proposal_invalid: "proposals",
  proposal_draft_conflict: "proposals",
  proposal_conflict: "proposals",
  lock: "roles",
  legacy: "roles",
};

/**
 * The read-only integrity target a `Revisar datos` / `Revisar roles duplicados` /
 * `Revisar datos del setlist` action opens. Keyed by EXPLICIT ids only — never a
 * search, and never an editable setlist. `null` when there is no id to open.
 */
export function integrityTargetForCard(card: ServiceCardModel): IntegrityIssueTarget | null {
  const readiness = card.readiness;
  const kind = readiness.primaryAction.kind;
  const relevant = readiness.integrityIssues.filter((issue: ServiceIntegrityIssue) => {
    if (kind === "review_setlist_data") return issue.kind.startsWith("setlist_");
    if (kind === "review_duplicate_roles") return issue.kind === "role_target_duplicate";
    return issue.blocking;
  });
  const ids = [...new Set(relevant.flatMap((i) => i.ids).filter(nonEmptyString))];
  if (ids.length === 0) return null;
  return {
    kind: "integrity_issue",
    domain: ISSUE_DOMAIN[relevant[0].kind] ?? "roles",
    ids,
    reasons: [
      ...new Set(
        relevant.flatMap((issue) => [issue.kind, ...(issue.reason ? [issue.reason] : [])]),
      ),
    ],
    relatedIds: [card.role._id],
    serviceRef: card.role._id,
    serviceDate: card.day,
  };
}

/** The `buildProposalHandoff` input for this card's `Revisar propuesta(s)` action. */
export function proposalHandoffInput(card: ServiceCardModel): ProposalHandoffInput {
  const type: RoleType = card.role._type;
  return {
    serviceRef: card.role._id,
    serviceType: type,
    serviceDate: card.day,
    presentation: card.readiness.proposalPresentation,
    observation: card.observation.proposal,
  };
}

// ── Command summary ──────────────────────────────────────────────────────────

export interface CommandSummaryCounters {
  upcoming: number;
  past: number;
  readyToPublish: number;
  publishedReady: number;
  conflicts: number;
  pendingProposals: number;
  integrityIssues: number;
  blockedDrafts: number;
}

/**
 * `upcoming` / `past` describe the whole loaded set; every actionable counter is
 * computed over the VISIBLE cards, so "listos para publicar" always equals what
 * `Publicar listos` would submit.
 */
export function commandSummaryCounters(input: {
  all: readonly ServiceCardModel[];
  visible: readonly ServiceCardModel[];
}): CommandSummaryCounters {
  const all = input.all ?? [];
  const visible = input.visible ?? [];
  const counters: CommandSummaryCounters = {
    upcoming: all.filter((c) => !c.isPast).length,
    past: all.filter((c) => c.isPast).length,
    readyToPublish: 0,
    publishedReady: 0,
    conflicts: 0,
    pendingProposals: 0,
    integrityIssues: 0,
    blockedDrafts: 0,
  };
  for (const card of visible) {
    const r = card.readiness;
    if (r.publishState === "draft") {
      if (r.isReadyToPublish) counters.readyToPublish += 1;
      else counters.blockedDrafts += 1;
    } else if (r.isOperationallyReady) {
      counters.publishedReady += 1;
    }
    if (r.availabilityStatus === "conflict") counters.conflicts += 1;
    if (r.proposalPresentation === "pending" || r.proposalPresentation === "changes_requested") {
      counters.pendingProposals += 1;
    }
    if (
      r.integrityIssues.length > 0 ||
      r.roleTargetStatus === "unknown" ||
      r.teamStatus === "unknown" ||
      r.setlistStatus === "unknown" ||
      r.proposalPresentation === "unknown" ||
      r.availabilityStatus === "unknown"
    ) {
      counters.integrityIssues += 1;
    }
  }
  return counters;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The Spanish command line that replaces the plain count header. `próximos` is
 * always shown (a zero there is information); every other segment appears only
 * when it is non-zero, so the line stays readable at 320px.
 */
export function commandSummarySegments(c: CommandSummaryCounters): string[] {
  const segments = [plural(c.upcoming, "próximo", "próximos")];
  if (c.readyToPublish > 0) {
    segments.push(
      `${plural(c.readyToPublish, "listo", "listos")} para publicar`,
    );
  }
  if (c.blockedDrafts > 0) {
    segments.push(`${plural(c.blockedDrafts, "borrador", "borradores")} bloqueado${c.blockedDrafts === 1 ? "" : "s"}`);
  }
  if (c.conflicts > 0) segments.push(plural(c.conflicts, "conflicto", "conflictos"));
  if (c.pendingProposals > 0) {
    segments.push(
      `${plural(c.pendingProposals, "propuesta", "propuestas")} pendiente${c.pendingProposals === 1 ? "" : "s"}`,
    );
  }
  if (c.integrityIssues > 0) {
    segments.push(
      `${plural(c.integrityIssues, "servicio", "servicios")} con datos por revisar`,
    );
  }
  if (c.past > 0) segments.push(plural(c.past, "pasado", "pasados"));
  return segments;
}

// ── Readiness-aware bulk publishing ──────────────────────────────────────────

/** Spanish copy for every skip/blocker code the confirmation can show. */
export const PUBLISH_SKIP_COPY: Record<PublishSkipReason, string> = {
  // workflow (override-eligible)
  availability_conflict: "hay un conflicto de disponibilidad",
  active_proposal: "hay una propuesta activa",
  incomplete_setlist: "el setlist está incompleto o falta",
  team_empty: "no hay equipo asignado",
  // hard integrity blockers
  source_unready: "faltan datos por cargar",
  invalid_record: "el registro del servicio es inválido",
  role_target_duplicate: "hay servicios duplicados en esa fecha",
  role_target_draft_conflict: "hay un borrador sin publicar del servicio",
  role_target_invalid: "el objetivo del servicio es inválido",
  role_target_unknown: "no se pudo verificar el objetivo del servicio",
  dangling_assignment: "hay una asignación a un miembro inexistente",
  team_unknown: "no se pudo verificar el equipo",
  setlist_duplicate: "hay setlists duplicados",
  setlist_draft_conflict: "hay un borrador sin publicar del setlist",
  setlist_invalid: "el setlist tiene datos inválidos",
  setlist_unknown: "no se pudo verificar el setlist",
  proposal_invalid: "la propuesta tiene datos inválidos",
  proposal_draft_conflict: "hay un borrador sin publicar de la propuesta",
  proposal_conflict: "hay propuestas en conflicto",
  proposal_unknown: "no se pudo verificar la propuesta",
  availability_unknown: "no se pudo verificar la disponibilidad",
  cleanup_required: "requiere limpieza de datos",
  // selection skips
  already_published: "ya está publicado",
  unusable_identity: "no se pudo identificar el servicio",
  duplicate_candidate: "aparece más de una vez en la lista",
  not_ready: "no cumple la verificación de publicación",
};

export interface PublishSkippedLine {
  id: string;
  label: string;
  reasons: PublishSkipReason[];
  /** Spanish "why it was skipped", ready to render. */
  text: string;
}

export type PublishOverrideLine = PublishOverrideAcknowledgement & { label: string };

export interface PublishConfirmationPlan {
  /** Exactly what `Publicar listos` may submit. */
  selected: (PublishSelectionEntry & { label: string })[];
  /** Every DRAFT that was left out of `selected`, with reasons — never a silent drop. */
  skipped: PublishSkippedLine[];
  /**
   * The ONE `mode: "override"` batch `Publicar todos` submits: every `selected`
   * entry (acknowledging nothing) plus every draft whose only blockers are
   * bulk-acknowledgeable. Empty when the override would add nothing.
   */
  overrideAll: PublishOverrideLine[];
  /** The `skipped` lines `Publicar todos` WOULD publish, in `skipped` order. */
  overrideAdds: PublishSkippedLine[];
  /** The `skipped` lines NO bulk action can publish, in `skipped` order. */
  overrideBlocked: PublishSkippedLine[];
}

/**
 * Split the visible cards into "submit these", "skipped, because", and "these
 * extra ones only the override reaches". Both selections are the pure functions'
 * (`selectPublishReady` / `selectBulkOverride`) — this only adds the Spanish
 * reason copy and drops already-published cards from the skipped list (they are
 * not candidates an admin needs explained).
 *
 * `overrideAll` is left EMPTY when the override adds nothing beyond `selected`,
 * so the panel never offers a second action that would do the same thing as the
 * first.
 */
export function buildPublishConfirmation(
  cards: readonly ServiceCardModel[],
): PublishConfirmationPlan {
  const candidates: PublishCandidate[] = (cards ?? []).map((card) => ({
    id: card.role._id,
    rev: card.role._rev,
    readiness: card.readiness,
    label: serviceCardLabel(card.role),
  }));
  const { selected, skipped } = selectPublishReady(candidates);
  const override = selectBulkOverride(candidates);

  const skippedLines: PublishSkippedLine[] = skipped
    .filter((entry) => entry.publishState === "draft")
    .map((entry) => ({
      id: entry.id,
      label: entry.label ?? entry.id,
      reasons: entry.reasons,
      text: entry.reasons.map((reason) => PUBLISH_SKIP_COPY[reason] ?? reason).join("; "),
    }));

  const overrideIds = new Set(override.selected.map((entry) => entry.id));
  const overrideAdds = skippedLines.filter((line) => overrideIds.has(line.id));

  return {
    selected: selected.map((entry) => ({ ...entry, label: entry.label ?? entry.id })),
    skipped: skippedLines,
    overrideAll:
      overrideAdds.length > 0
        ? override.selected.map((entry) => ({ ...entry, label: entry.label ?? entry.id }))
        : [],
    overrideAdds,
    overrideBlocked: skippedLines.filter((line) => !overrideIds.has(line.id)),
  };
}

/** Spanish copy of the workflow blockers an individual override acknowledges. */
export function describeAcknowledgedBlockers(
  blockers: readonly PublishWorkflowBlocker[],
): string[] {
  return blockers.map((blocker) => PUBLISH_SKIP_COPY[blocker] ?? blocker);
}

// ── Per-target create/month preflight ────────────────────────────────────────

/**
 * `sunday:<date>` / `saturday:<date>` — A1's own proposal target key format.
 *
 * **Deliberately NOT widened to `ServiceType`.** Its body is a silent ternary,
 * so a widened signature would key a special's proposal lookup to
 * `saturday:<date>` and collide with a real Saturday target on that date —
 * precisely the "keeps compiling, takes the Saturday path" class the widening
 * exists to eliminate. `monthTargetPreflight` returns above this call for a
 * special, so the narrow type is what makes that early return mandatory rather
 * than optional.
 */
function weekendProposalTargetKey(type: "sunday_role" | "saturday_role", date: string): string {
  return `${type === "sunday_role" ? "sunday" : "saturday"}:${date}`;
}

/**
 * Provisional per-target state for the month generator, computed through the
 * shipped `deriveTargetPreflight`. Nothing here copies A2's mutation decision: the
 * create endpoint still reruns its full preflight and may answer `409`.
 *
 * The observations handed over:
 *  - role: the observed public state of A1's canonical role target; a target
 *    ABSENT from a proven inventory is `none` (A1 inventories every canonical
 *    role), and an unproven inventory stays `null`.
 *  - lock: A1's `lockIssues` is a COMPLETE flat view — per-target issues plus
 *    locks at deterministic ids no canonical target claims. So a proven inventory
 *    with no issue naming this target key proves the weekend token is safe to
 *    claim; any issue makes it ineligible and carries its ids.
 *  - setlist/proposal history: canonical + raw ids observed at the same target,
 *    looked up by A1's own reported target keys.
 *  - targetIssues: global queue entries A1/A2 filed against this exact target.
 *
 * **A special takes a different branch entirely** (fact 7). Its canonical key is
 * its DOCUMENT ID (`serviceReadModel.ts:44-56`), so the weekend `targetKey`
 * lookup below can never match and `role` would default to `"none"` — always
 * `creatable`, wrong in the dangerous direction. And the branch cannot be made
 * name-aware to compensate: `RoleTarget`/`RoleTargetRecord`
 * (`serviceReadSummary.ts:58-69`, `:83-104`) carry `targetKey`/`type`/
 * `serviceDate` but no `service_name`, so it could only key by date — which
 * would report `exists` for a legitimately-creatable SECOND special on that
 * date and contradict E17. So the special branch is **name-blind**, and E17's
 * `existing` collision key in `cellsToDrafts` is the sole existence authority.
 */
export function monthTargetPreflight(input: {
  sources: ServiceSourceStates;
  summaries: CardSourceSummaries;
  queue: IntegrityQueue | null;
  type: ServiceType;
  date: string;
}): TargetPreflight {
  const { roles, setlists, proposals } = input.summaries;

  if (input.type === "special_role") {
    // Returns ABOVE both `canonicalSetlistTargetKey` and
    // `weekendProposalTargetKey`. The first takes a `string` and would happily
    // answer `""` for a special (`serviceReadModel.ts:67-76`), matching every
    // other empty key; the second is narrow on purpose (see above) and would
    // key this to `saturday:<date>`. Neither is reached.
    //
    // Still SOURCE-GATED — an unready or failed domain blocks exactly as it does
    // for a weekend target — but name-blind within that: no role lookup (there
    // is nothing to look one up by that would not be wrong), `expectsLock: false`
    // because a special takes no weekend lock (`roleTargetLock.ts:28`;
    // `roleWriteRequest.ts:256-257`), and proven-but-EMPTY setlist/proposal
    // history rather than `null`, which would report `unknown` forever.
    return deriveTargetPreflight({
      targetKey: `${input.type}:${input.date}`,
      sources: input.sources,
      role: roles ? "none" : null,
      expectsLock: false,
      lock: null,
      setlistHistory: setlists ? { canonicalIds: [], draftIds: [] } : null,
      proposalHistory: proposals ? { canonicalIds: [], draftIds: [] } : null,
      targetIssues: [],
    });
  }

  const targetKey = `${input.type}:${input.date}`;
  const setlistKey = canonicalSetlistTargetKey(input.type, input.date, "");
  const proposalKey = weekendProposalTargetKey(input.type, input.date);

  const roleTarget = roles
    ? ((roles.targets ?? []).find((t) => t?.targetKey === targetKey)?.publicState ?? "none")
    : null;

  const lockIssues = roles
    ? (roles.lockIssues ?? []).filter((issue) => issue?.targetKey === targetKey)
    : [];
  const lock = roles ? { eligible: lockIssues.length === 0, issues: lockIssues } : null;

  let setlistHistory: { canonicalIds: string[]; draftIds: string[] } | null = null;
  if (setlists) {
    const target = (setlists.targets ?? []).find((t) => t?.targetKey === setlistKey) ?? null;
    const orphanDrafts = (setlists.recordIssues ?? [])
      .filter((issue) => issue?.kind === "draft_only" && issue.baseId === setlistKey)
      .map((issue) => issue.id);
    setlistHistory = {
      canonicalIds: [...(target?.canonicalIds ?? [])],
      draftIds: [...(target?.draftIds ?? []), ...orphanDrafts],
    };
  }

  let proposalHistory: { canonicalIds: string[]; draftIds: string[] } | null = null;
  if (proposals) {
    const records = (proposals.records ?? []).filter((r) => r?.targetKey === proposalKey);
    const ids = records.map((r) => r.id).filter(nonEmptyString);
    const baseIds = new Set(ids);
    proposalHistory = {
      canonicalIds: ids,
      draftIds: (proposals.draftIds ?? []).filter(
        (id) => nonEmptyString(id) && baseIds.has(normalizeBaseId(id)),
      ),
    };
  }

  const targetIssues: ServiceIntegrityIssue[] = (input.queue?.entries ?? [])
    .filter((entry) => entry.targetKey === targetKey || entry.targetKey === setlistKey)
    .map((entry) => ({
      kind: entry.kind,
      blocking: entry.blocking,
      ids: entry.ids,
      ...(entry.reasons.length ? { reason: entry.reasons.join(", ") } : {}),
    }));

  return deriveTargetPreflight({
    targetKey,
    sources: input.sources,
    role: roleTarget,
    expectsLock: true,
    lock,
    setlistHistory,
    proposalHistory,
    targetIssues,
  });
}

/** Spanish label + tone for a per-target preflight state. */
export const PREFLIGHT_COPY: Record<
  TargetPreflight["state"],
  { text: string; tone: ReadinessTone }
> = {
  checking: { text: "Verificando…", tone: "unknown" },
  unknown: { text: "Sin verificar", tone: "unknown" },
  exists: { text: "Ya existe", tone: "neutral" },
  blocked: { text: "Bloqueado", tone: "error" },
  creatable: { text: "Se puede crear", tone: "ok" },
};

/** Spanish copy for the machine reasons `deriveTargetPreflight` reports. */
export function describePreflightReason(reason: string): string {
  const [head, ...rest] = reason.split(":");
  const detail = rest.join(":");
  const map: Record<string, string> = {
    loading: "cargando",
    error: "no se pudo cargar",
    role_unobserved: "no se pudo verificar el servicio",
    lock_unobserved: "no se pudo verificar el bloqueo de coordinación",
    setlist_unobserved: "no se pudo verificar el setlist",
    proposal_unobserved: "no se pudo verificar la propuesta",
    role_single: "ya hay un servicio en esa fecha",
    role_duplicate: "hay servicios duplicados en esa fecha",
    role_invalid: "el servicio de esa fecha es inválido",
    role_draft_conflict: "hay un borrador sin publicar en esa fecha",
    lock_not_eligible: "el bloqueo de coordinación no está libre",
    setlist_history: "ya hay un setlist para esa fecha",
    proposal_history: "ya hay una propuesta para esa fecha",
  };
  if (map[reason]) return map[reason];
  if (map[head]) return detail ? `${map[head]} (${detail})` : map[head];
  if (head === "lock") return `bloqueo de coordinación: ${detail || "inconsistente"}`;
  if (head === "issue") return `problema de integridad: ${detail || "sin detalle"}`;
  return reason;
}
