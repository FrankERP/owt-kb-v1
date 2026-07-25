// Global integrity queue + card association (Plan B item 6, plan
// §"Global integrity queue").
//
// Not every A1/A2 integrity record can belong to a validated dated service card.
// This module is the ONE pure decision layer that answers, for every issue in the
// three shipped A1 integrity summaries:
//
//   "does exactly one validated service card own this, or does it belong to the
//    global `Integridad de datos` queue?"
//
// It consumes the shipped contracts and re-derives nothing:
//  - `@/app/utils/serviceReadSummary` — the three domain summaries (role targets
//    with their `lock` / `lockIssues` / `records` / `draftIds`, setlist targets,
//    and the proposal summary with `serviceRefConflicts` / `targetKeyConflicts` /
//    `recordIssues` / `draftIds`).
//  - `./serviceReadiness` — the `ServiceIntegrityIssueKind` vocabulary and
//    `lockIssuesToIntegrity`. No parallel issue vocabulary is invented here.
//  - `@/app/utils/serviceReadModel` — `normalizeBaseId` for raw-draft identity.
//
// Association rules (verbatim from the plan):
//  - attach to a service card only when a validated canonical role/target id maps
//    UNAMBIGUOUSLY to that card (exactly one card; zero or many is not a match);
//  - otherwise it goes in the global queue — draft-only roles, invalid-date
//    roles/setlists, dangling/malformed special proposals, orphan locks, and
//    unassociated raw drafts all land there by following that same rule;
//  - a source that is loading/failed (or whose summary cannot be proven) makes the
//    queue INCOMPLETE; it never renders as zero/clean;
//  - entries carry type, ids, reasons, related ids and the guarded cleanup/support
//    action. No free-form Studio mutation is offered from the UI.
//
// Two deliberate details, because they are easy to get wrong:
//
//  1. A lock issue is associated by the lock's OWN `targetKey`, never by its
//     `roleId`. A `wrong_owner` lock's `roleId` is precisely the wrong owner, so
//     attaching the issue to that role's card would misattribute it; the role id
//     is reported as a related id instead. A lock document sitting at a
//     deterministic id no canonical target claims therefore lands in the global
//     queue, which is what the plan means by "orphan locks".
//
//  2. `cardIssues` (the subset fed to `deriveServiceReadiness` as
//     `integrityIssues`) contains ONLY `lock` / `legacy` kinds. Every other kind
//     is already a readiness DIMENSION that `deriveServiceReadiness` derives from
//     its own observations; supplying it a second time would inflate
//     `blockingIssueCount` and hijack the shipped primary-action priority (rule 1
//     would swallow rules 2-3). `byCard` keeps the full associated set for card
//     issue copy.

import { normalizeBaseId, setlistTargetKey } from "@/app/utils/serviceReadModel";
import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import type { RoleTargetLockIssue } from "@/app/utils/roleTargetLock";
import {
  lockIssuesToIntegrity,
  unreadySources,
  type ServiceIntegrityIssue,
  type ServiceIntegrityIssueKind,
  type ServiceSourceKey,
  type ServiceSourceStates,
  type UnreadySource,
} from "./serviceReadiness";

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ── Domains and their source keys ────────────────────────────────────────────

export type IntegrityDomain = "roles" | "setlists" | "proposals";

export const INTEGRITY_DOMAINS = ["roles", "setlists", "proposals"] as const;

/** The three A1 read domains this queue is inventoried from. */
export const INTEGRITY_SOURCE_KEYS = [
  "roleTargets",
  "setlistTargets",
  "proposals",
] as const satisfies readonly ServiceSourceKey[];

export const INTEGRITY_DOMAIN_SOURCE: Record<IntegrityDomain, ServiceSourceKey> = {
  roles: "roleTargets",
  setlists: "setlistTargets",
  proposals: "proposals",
};

/**
 * Only the three integrity domains are required here, so a caller that tracks
 * just those (the read-only queue view) does not have to fake a members/roles
 * state. The full five-source `ServiceSourceStates` is assignable to it.
 */
export type IntegritySourceStates = Pick<
  ServiceSourceStates,
  (typeof INTEGRITY_SOURCE_KEYS)[number]
>;

/** Full-record shape `unreadySources` expects; the unrequested keys are never read. */
function widenSources(sources: IntegritySourceStates): ServiceSourceStates {
  return { roles: "ready", members: "ready", ...sources };
}

// ── Guarded cleanup / support actions ────────────────────────────────────────

/**
 * The action a queue entry offers. Deliberately a DESCRIPTOR, not a mutation:
 * this view never writes, and the plan forbids free-form Studio mutation from it.
 *
 * The named route is A2's guarded operator command
 * (`scripts/service-readiness-cleanup.mjs`), NOT Studio. A2 §8 made all eight
 * protected types read-only in Studio with their document actions removed, so
 * telling an admin to "fix it in Studio" would send them somewhere they cannot
 * act. The operator command is dry-run by default, takes an exact id and
 * revision, and refuses anything it cannot prove safe — which is why the queue's
 * job is to hand over those exact ids.
 */
export type IntegrityCleanupAction =
  | "discard_draft_via_operator"
  | "select_canonical_via_operator"
  | "repair_record_via_operator"
  | "request_support";

const OPERATOR_CMD = "scripts/service-readiness-cleanup.mjs";

export const INTEGRITY_ACTION_COPY: Record<IntegrityCleanupAction, string> = {
  discard_draft_via_operator:
    `Descarta el borrador con la herramienta guardada (${OPERATOR_CMD}) usando estos ids. Studio es de solo lectura para estos documentos.`,
  select_canonical_via_operator:
    `Elige el documento canónico con la herramienta guardada (${OPERATOR_CMD}) usando estos ids; no se combinan documentos. Studio es de solo lectura para estos documentos.`,
  repair_record_via_operator:
    `Repara los campos guardados con la herramienta guardada (${OPERATOR_CMD}) usando estos ids. Studio es de solo lectura para estos documentos.`,
  request_support:
    "Requiere limpieza asistida de un documento interno de coordinación. Solicita soporte con estos ids.",
};

const ACTION_BY_KIND: Record<ServiceIntegrityIssueKind, IntegrityCleanupAction> = {
  invalid_record: "repair_record_via_operator",
  role_target_duplicate: "select_canonical_via_operator",
  role_target_draft_conflict: "discard_draft_via_operator",
  role_target_invalid: "repair_record_via_operator",
  dangling_assignment: "repair_record_via_operator",
  setlist_duplicate: "select_canonical_via_operator",
  setlist_draft_conflict: "discard_draft_via_operator",
  setlist_invalid: "repair_record_via_operator",
  proposal_invalid: "repair_record_via_operator",
  proposal_draft_conflict: "discard_draft_via_operator",
  proposal_conflict: "select_canonical_via_operator",
  lock: "request_support",
  legacy: "request_support",
};

/** Spanish, admin-facing name of each issue type. */
export const INTEGRITY_KIND_LABEL: Record<ServiceIntegrityIssueKind, string> = {
  invalid_record: "Registro inválido",
  role_target_duplicate: "Servicios duplicados en la misma fecha",
  role_target_draft_conflict: "Borrador sin publicar del servicio",
  role_target_invalid: "Objetivo de servicio inválido",
  dangling_assignment: "Asignación a un miembro inexistente",
  setlist_duplicate: "Setlists duplicados",
  setlist_draft_conflict: "Borrador sin publicar del setlist",
  setlist_invalid: "Setlist con datos inválidos",
  proposal_invalid: "Propuesta con datos inválidos",
  proposal_draft_conflict: "Borrador sin publicar de la propuesta",
  proposal_conflict: "Propuestas en conflicto para el mismo servicio",
  lock: "Bloqueo de coordinación inconsistente",
  legacy: "Problema de integridad heredado",
};

/** Spanish copy for the machine reason tags A1/A2 emit. Unknown tags render raw. */
export const INTEGRITY_REASON_LABEL: Record<string, string> = {
  identity: "identidad del documento (_id/_rev)",
  type: "tipo de documento",
  date: "fecha inválida",
  status: "estado inválido",
  draft_only: "solo existe como borrador",
  duplicate: "más de un documento canónico",
  draft_conflict: "hay un borrador sin publicar",
  exception: "el registro no pudo leerse",
  dangling_assignment: "referencia a un miembro que ya no existe",
  invalid_content: "contenido inválido",
  serviceRef_conflict: "más de una propuesta válida para el mismo servicio",
  targetKey_conflict: "más de una propuesta válida para el mismo objetivo",
  not_an_object: "el registro no es un objeto",
  not_an_array: "el campo no es una lista",
  missing_key: "falta el _key",
  duplicate_key: "_key repetido",
  missing_song_ref: "referencia de canción ausente",
  service_ref: "referencia de servicio ausente",
  service_type: "tipo de servicio inválido",
  role_unresolved: "el servicio referido no existe",
  role_not_groupable: "el servicio referido es inválido",
  role_type_mismatch: "el tipo no coincide con el servicio",
  date_mismatch: "la fecha no coincide con el servicio",
  ambiguous_group: "grupo ambiguo: A1 no reportó un ganador",
  missing_lock: "falta el documento de bloqueo",
  malformed_lock: "bloqueo con datos inválidos",
  id_mismatch: "el id del bloqueo no corresponde a su objetivo",
  claimed_without_role: "bloqueo tomado sin dueño",
  vacant_with_role: "bloqueo libre que aún nombra un dueño",
  wrong_owner: "bloqueo tomado por otro servicio",
  orphan_lock: "bloqueo huérfano",
};

/**
 * Human reason text. A tag may carry a detail after a colon (`missing_key:3`,
 * `malformed_lock: identity`); an unknown tag is shown VERBATIM rather than
 * hidden, so a new A1/A2 reason can never disappear from the queue.
 */
export function describeIntegrityReason(reason: string): string {
  const head = reason.split(":")[0];
  const label = INTEGRITY_REASON_LABEL[reason] ?? INTEGRITY_REASON_LABEL[head];
  if (!label) return reason;
  const detail = reason.slice(head.length + 1).trim();
  return reason !== head && detail ? `${label} (${detail})` : label;
}

// ── The card index ───────────────────────────────────────────────────────────

/**
 * One rendered service card, as the panel knows it. Only `validated` cards enter
 * the index: an invalid record is never a "validated canonical role/target id",
 * so it can never own an integrity issue.
 */
export interface IntegrityCardRef {
  /** Stable key the UI addresses this card by (normally the canonical role id). */
  cardId: string;
  /** Canonical role document id — also the `service_ref` proposals point at. */
  roleId: string;
  /** A1 canonical role target key (`sunday_role:<week>`, or the id for special). */
  roleTargetKey?: string | null;
  /** A1 live-setlist target key (`featuredSongs:<week>` / `saturdarSongs:<week>` / role id). */
  setlistTargetKey?: string | null;
  /** A1 `validateRole().groupable` for this card's canonical role. */
  validated: boolean;
}

export interface IntegrityCardIndex {
  byRoleId: Map<string, string[]>;
  byRoleTargetKey: Map<string, string[]>;
  bySetlistTargetKey: Map<string, string[]>;
}

function pushKey(map: Map<string, string[]>, key: unknown, cardId: string): void {
  if (!nonEmptyString(key)) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(cardId)) list.push(cardId);
    return;
  }
  map.set(key, [cardId]);
}

/** Index the validated cards by every identity an A1 issue can name. */
export function buildIntegrityCardIndex(
  cards: readonly IntegrityCardRef[],
): IntegrityCardIndex {
  const index: IntegrityCardIndex = {
    byRoleId: new Map(),
    byRoleTargetKey: new Map(),
    bySetlistTargetKey: new Map(),
  };
  for (const card of cards ?? []) {
    if (!card || !nonEmptyString(card.cardId) || card.validated !== true) continue;
    pushKey(index.byRoleId, card.roleId, card.cardId);
    pushKey(index.byRoleTargetKey, card.roleTargetKey, card.cardId);
    pushKey(index.bySetlistTargetKey, card.setlistTargetKey, card.cardId);
  }
  return index;
}

/**
 * The cards A1's own role inventory implies: every canonical role record of every
 * target, with the setlist target key A1 derives for it. This is what the
 * standalone queue view uses when no caller supplied its rendered cards; a caller
 * that filters its list (month/past filters) passes its own set instead.
 *
 * Every record of a DUPLICATE target is included, precisely so that target's key
 * maps to two cards and its issues stay ambiguous — i.e. in the global queue.
 */
export function cardsFromRoleTargets(roles: RoleDomainSummary | null): IntegrityCardRef[] {
  const out: IntegrityCardRef[] = [];
  for (const target of roles?.targets ?? []) {
    for (const record of target.records ?? []) {
      if (!nonEmptyString(record?.id)) continue;
      out.push({
        cardId: record.id,
        roleId: record.id,
        roleTargetKey: target.targetKey,
        setlistTargetKey: setlistTargetKey(record.type, record.serviceDate ?? undefined, record.id),
        validated: true,
      });
    }
  }
  return out;
}

export interface IntegrityCardKeys {
  roleIds?: readonly (string | null | undefined)[];
  roleTargetKeys?: readonly (string | null | undefined)[];
  setlistTargetKeys?: readonly (string | null | undefined)[];
}

/**
 * The single card these ids belong to, or null. Zero candidates (nothing
 * validated names it) and more than one candidate (ambiguous — e.g. a duplicate
 * target owning two cards) BOTH mean "global queue"; the plan allows an issue on
 * a card only when the mapping is unambiguous.
 */
export function resolveIntegrityCard(
  index: IntegrityCardIndex,
  keys: IntegrityCardKeys,
): string | null {
  const found = new Set<string>();
  const collect = (map: Map<string, string[]>, values?: readonly (string | null | undefined)[]) => {
    for (const value of values ?? []) {
      if (!nonEmptyString(value)) continue;
      for (const cardId of map.get(value) ?? []) found.add(cardId);
    }
  };
  collect(index.byRoleId, keys.roleIds);
  collect(index.byRoleTargetKey, keys.roleTargetKeys);
  collect(index.bySetlistTargetKey, keys.setlistTargetKeys);
  if (found.size !== 1) return null;
  return [...found][0];
}

// ── Queue entries ────────────────────────────────────────────────────────────

export interface IntegrityQueueEntry {
  /** Stable, content-derived key: safe for React lists and explicit-id focus. */
  key: string;
  domain: IntegrityDomain;
  /** Reused `serviceReadiness` vocabulary — never a parallel one. */
  kind: ServiceIntegrityIssueKind;
  /** The exact document/draft ids this entry is about. Never a search key. */
  ids: string[];
  /** A1/A2 machine reason tags. */
  reasons: string[];
  /** Related ids when known (canonical base, owner role, conflict key…). */
  relatedIds: string[];
  /** The A1 target key this entry belongs to, when the summary named one. */
  targetKey: string | null;
  blocking: boolean;
  action: IntegrityCleanupAction;
  /** The owning card, or null when this entry belongs to the global queue. */
  cardId: string | null;
}

export interface IntegrityQueue {
  /** The GLOBAL `Integridad de datos` queue: entries no validated card owns. */
  entries: IntegrityQueueEntry[];
  /** Associated entries by card id — for the card's own issue copy. */
  byCard: Record<string, IntegrityQueueEntry[]>;
  /**
   * The ONLY associated entries safe to pass to `deriveServiceReadiness` as
   * `integrityIssues`: `lock` and `legacy`. Everything else is already a
   * readiness dimension the predicate derives itself.
   */
  cardIssues: Record<string, ServiceIntegrityIssue[]>;
  /** True when any integrity domain is loading/failed or its summary is unproven. */
  incomplete: boolean;
  /** Which integrity sources are unproven, for source-specific retry copy. */
  unproven: UnreadySource[];
  /** Global queue size. */
  count: number;
  /** Number of associated entries (attached to a card, not in the queue). */
  associatedCount: number;
}

export interface IntegrityQueueInput {
  /** The three integrity source states (the full five-source record also fits). */
  sources: IntegritySourceStates;
  cards: readonly IntegrityCardRef[];
  /** `null` = not observed. A `ready` source with a null summary is unproven. */
  roles: RoleDomainSummary | null;
  setlists: SetlistDomainSummary | null;
  proposals: ProposalDomainSummary | null;
}

interface DraftEntry {
  domain: IntegrityDomain;
  kind: ServiceIntegrityIssueKind;
  ids: readonly (string | null | undefined)[];
  reasons: readonly (string | null | undefined)[];
  relatedIds?: readonly (string | null | undefined)[];
  targetKey?: string | null;
  cardKeys: IntegrityCardKeys;
}

function clean(values: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((values ?? []).filter(nonEmptyString))];
}

/**
 * Assemble the global queue and the per-card association from the three shipped
 * A1 summaries. Pure and total: a malformed/unknown shape becomes an explicit
 * entry or an unproven source, never a silent drop.
 */
export function buildIntegrityQueue(input: IntegrityQueueInput): IntegrityQueue {
  const sources = input.sources;
  const index = buildIntegrityCardIndex(input.cards ?? []);

  // Honesty: a loading/failed domain is unproven, and so is a `ready` domain
  // whose summary is missing (the response could not prove an inventory).
  const unproven: UnreadySource[] = unreadySources(widenSources(sources), INTEGRITY_SOURCE_KEYS);
  const seenUnproven = new Set(unproven.map((u) => u.source));
  const summaries: Record<IntegrityDomain, unknown> = {
    roles: input.roles,
    setlists: input.setlists,
    proposals: input.proposals,
  };
  for (const domain of INTEGRITY_DOMAINS) {
    const source = INTEGRITY_DOMAIN_SOURCE[domain];
    if (seenUnproven.has(source)) continue;
    if (summaries[domain] == null) unproven.push({ source, state: "error" });
  }

  const merged = new Map<string, IntegrityQueueEntry>();

  const push = (draft: DraftEntry): void => {
    const ids = clean(draft.ids);
    const reasons = clean(draft.reasons);
    const relatedIds = clean(draft.relatedIds).filter((id) => !ids.includes(id));
    const key = `${draft.domain}|${draft.kind}|${[...ids].sort().join(",")}`;
    const existing = merged.get(key);
    if (existing) {
      existing.reasons = [...new Set([...existing.reasons, ...reasons])];
      existing.relatedIds = [...new Set([...existing.relatedIds, ...relatedIds])];
      existing.targetKey = existing.targetKey ?? draft.targetKey ?? null;
      return;
    }
    merged.set(key, {
      key,
      domain: draft.domain,
      kind: draft.kind,
      ids,
      reasons,
      relatedIds,
      targetKey: draft.targetKey ?? null,
      blocking: true,
      action: ACTION_BY_KIND[draft.kind],
      cardId: resolveIntegrityCard(index, draft.cardKeys),
    });
  };

  // ── Roles domain ──────────────────────────────────────────────────────────
  const roles = input.roles;
  if (roles) {
    for (const target of roles.targets ?? []) {
      const cardKeys: IntegrityCardKeys = {
        roleIds: target.canonicalIds,
        roleTargetKeys: [target.targetKey],
      };
      if (target.canonicalState === "duplicate") {
        push({
          domain: "roles",
          kind: "role_target_duplicate",
          ids: target.canonicalIds,
          reasons: ["duplicate"],
          targetKey: target.targetKey,
          cardKeys,
        });
      }
      if ((target.draftIds ?? []).length > 0) {
        push({
          domain: "roles",
          kind: "role_target_draft_conflict",
          ids: target.draftIds,
          reasons: ["draft_conflict"],
          relatedIds: target.canonicalIds,
          targetKey: target.targetKey,
          cardKeys,
        });
      }
      for (const record of target.records ?? []) {
        if ((record.danglingRefs ?? []).length === 0) continue;
        push({
          domain: "roles",
          kind: "dangling_assignment",
          ids: record.danglingRefs,
          reasons: ["dangling_assignment"],
          relatedIds: [record.id],
          targetKey: target.targetKey,
          // A dangling ref belongs to ONE canonical record, so it associates by
          // that record's id even when the target itself is ambiguous.
          cardKeys: { roleIds: [record.id] },
        });
      }
    }

    for (const issue of roles.recordIssues ?? []) {
      if (issue.kind === "draft_only") {
        push({
          domain: "roles",
          kind: "role_target_draft_conflict",
          ids: [issue.id],
          reasons: ["draft_only"],
          relatedIds: [issue.baseId],
          // A draft whose base id matches no canonical role has, by construction,
          // no validated card; the resolver confirms it rather than assuming it.
          cardKeys: { roleIds: [issue.baseId] },
        });
        continue;
      }
      push({
        domain: "roles",
        kind: "invalid_record",
        ids: [issue.id],
        reasons: issue.issues,
        relatedIds: issue.draftIds,
        // An invalid role is not a validated canonical id: it never owns a card.
        cardKeys: {},
      });
    }

    // The flat lock view is complete (per-target issues plus locks at ids no
    // canonical target claims), so it is the only lock source read here.
    for (const lockIssue of roles.lockIssues ?? []) {
      push(lockDraft(lockIssue));
    }
  }

  // ── Setlists domain ───────────────────────────────────────────────────────
  const setlists = input.setlists;
  if (setlists) {
    for (const target of setlists.targets ?? []) {
      const cardKeys: IntegrityCardKeys = { setlistTargetKeys: [target.targetKey] };
      if (target.canonicalState === "duplicate") {
        push({
          domain: "setlists",
          kind: "setlist_duplicate",
          ids: target.canonicalIds,
          reasons: ["duplicate"],
          targetKey: target.targetKey,
          cardKeys,
        });
      }
      if ((target.draftIds ?? []).length > 0) {
        push({
          domain: "setlists",
          kind: "setlist_draft_conflict",
          ids: target.draftIds,
          reasons: ["draft_conflict"],
          relatedIds: target.canonicalIds,
          targetKey: target.targetKey,
          cardKeys,
        });
      }
      // A duplicate target reports `contentState: "invalid"` because it is
      // ambiguous, not because its content is malformed — do not double-report.
      if (target.canonicalCount === 1 && target.contentState === "invalid") {
        push({
          domain: "setlists",
          kind: "setlist_invalid",
          ids: target.canonicalIds,
          reasons:
            (target.invalidEntries ?? []).length > 0
              ? (target.invalidEntries ?? []).flatMap((e) =>
                  e.reasons.map((r) => `${r}:${e.index}`),
                )
              : ["invalid_content"],
          targetKey: target.targetKey,
          cardKeys,
        });
      }
    }

    for (const issue of setlists.recordIssues ?? []) {
      if (issue.kind === "draft_only") {
        push({
          domain: "setlists",
          kind: "setlist_draft_conflict",
          ids: [issue.id],
          reasons: ["draft_only"],
          relatedIds: [issue.baseId],
          // A special service stores its songs on the role doc, so that base id
          // IS the setlist target key; a weekend setlist doc id is not.
          cardKeys: { setlistTargetKeys: [issue.baseId] },
        });
        continue;
      }
      push({
        domain: "setlists",
        kind: "setlist_invalid",
        ids: [issue.id],
        reasons: issue.issues,
        relatedIds: issue.draftIds,
        // No usable target key is exactly why this is a record issue.
        cardKeys: {},
      });
    }
  }

  // ── Proposals domain ──────────────────────────────────────────────────────
  const proposals = input.proposals;
  if (proposals) {
    const serviceRefById = new Map<string, string | null>();
    for (const record of proposals.records ?? []) {
      if (nonEmptyString(record?.id)) serviceRefById.set(record.id, record.serviceRef ?? null);
    }

    for (const record of proposals.recordIssues ?? []) {
      push({
        domain: "proposals",
        kind: "proposal_invalid",
        ids: [record.id],
        reasons: record.issues,
        relatedIds: [record.serviceRef],
        // A dangling/malformed (often special) proposal names no live role, so it
        // resolves to no card and lands in the global queue.
        cardKeys: { roleIds: [record.serviceRef] },
      });
    }

    for (const conflict of proposals.serviceRefConflicts ?? []) {
      push({
        domain: "proposals",
        kind: "proposal_conflict",
        ids: conflict.ids,
        reasons: ["serviceRef_conflict"],
        relatedIds: [conflict.key],
        cardKeys: { roleIds: [conflict.key] },
      });
    }

    for (const conflict of proposals.targetKeyConflicts ?? []) {
      // Look the service refs up in A1's OWN records — this is an id lookup, not
      // a client-side regrouping or target-key reconstruction.
      const refs = (conflict.ids ?? []).map((id) => serviceRefById.get(id) ?? null);
      push({
        domain: "proposals",
        kind: "proposal_conflict",
        ids: conflict.ids,
        reasons: ["targetKey_conflict"],
        relatedIds: [conflict.key, ...refs],
        cardKeys: { roleIds: refs },
      });
    }

    for (const draftId of proposals.draftIds ?? []) {
      if (!nonEmptyString(draftId)) continue;
      const baseId = normalizeBaseId(draftId);
      const serviceRef = serviceRefById.get(baseId) ?? null;
      push({
        domain: "proposals",
        kind: "proposal_draft_conflict",
        ids: [draftId],
        reasons: ["draft_conflict"],
        relatedIds: [baseId, serviceRef],
        // Only a draft overlaying a canonical proposal whose service_ref resolves
        // to exactly one card is associated; anything else is unassociated.
        cardKeys: { roleIds: [serviceRef] },
      });
    }
  }

  // ── Split global queue vs card association ────────────────────────────────
  const entries: IntegrityQueueEntry[] = [];
  const byCard: Record<string, IntegrityQueueEntry[]> = {};
  const cardIssues: Record<string, ServiceIntegrityIssue[]> = {};
  let associatedCount = 0;

  for (const entry of merged.values()) {
    if (!entry.cardId) {
      entries.push(entry);
      continue;
    }
    associatedCount += 1;
    (byCard[entry.cardId] ??= []).push(entry);
    if (entry.kind === "lock" || entry.kind === "legacy") {
      (cardIssues[entry.cardId] ??= []).push({
        kind: entry.kind,
        blocking: entry.blocking,
        ids: entry.ids,
        ...(entry.reasons.length ? { reason: entry.reasons.join(", ") } : {}),
      });
    }
  }

  return {
    entries,
    byCard,
    cardIssues,
    incomplete: unproven.length > 0,
    unproven,
    count: entries.length,
    associatedCount,
  };
}

/**
 * Adapt one A2 §1 lock issue through the shipped `lockIssuesToIntegrity`, then
 * associate it by the lock's own `targetKey` only (see the header note).
 */
function lockDraft(lockIssue: RoleTargetLockIssue): DraftEntry {
  const [issue] = lockIssuesToIntegrity([lockIssue]);
  return {
    domain: "roles",
    kind: issue?.kind ?? "lock",
    ids: issue?.ids ?? [],
    reasons: [issue?.reason ?? lockIssue?.kind],
    relatedIds: [lockIssue?.roleId, lockIssue?.lockId],
    targetKey: lockIssue?.targetKey ?? null,
    cardKeys: { roleTargetKeys: [lockIssue?.targetKey] },
  };
}

// ── Summary presentation ─────────────────────────────────────────────────────

export type IntegrityQueueTone = "clean" | "unknown" | "issues" | "issues_incomplete";

/**
 * `clean` is reachable ONLY from a fully proven inventory with zero entries. A
 * failed or still-loading domain is `unknown` (or `issues_incomplete` when
 * something was already found) — never zero/clean.
 */
export function integrityQueueTone(queue: IntegrityQueue): IntegrityQueueTone {
  if (queue.incomplete) return queue.count > 0 ? "issues_incomplete" : "unknown";
  return queue.count > 0 ? "issues" : "clean";
}

export const INTEGRITY_QUEUE_TITLE = "Integridad de datos";

export const INTEGRITY_INCOMPLETE_NOTE =
  "El inventario de integridad está incompleto: esta lista puede tener menos problemas de los que existen.";

/** One-line Spanish summary for the command-summary entry and the panel header. */
export function integrityQueueSummary(queue: IntegrityQueue): string {
  const n = queue.count;
  const problems = `${n} ${n === 1 ? "problema" : "problemas"}`;
  switch (integrityQueueTone(queue)) {
    case "clean":
      return "Sin problemas de integridad";
    case "unknown":
      return "Inventario incompleto";
    case "issues":
      return problems;
    default:
      return `${problems} · inventario incompleto`;
  }
}

// ── Explicit-id navigation ───────────────────────────────────────────────────

export type IntegrityFocusResolution =
  | { outcome: "waiting" }
  | { outcome: "load_failed"; unproven: UnreadySource[] }
  | { outcome: "not_found"; missingIds: string[] }
  | { outcome: "focus"; keys: string[]; ids: string[]; missingIds: string[] };

/**
 * Find the queue entries that carry the target's EXACT document/draft ids, in
 * both the global queue and the per-card association. A load failure is reported
 * distinctly from "those ids are not in the inventory".
 */
export function resolveIntegrityFocus(
  ids: readonly string[],
  queue: IntegrityQueue | null,
  sources: IntegritySourceStates,
): IntegrityFocusResolution {
  const wanted = clean(ids);
  const unready = unreadySources(widenSources(sources), INTEGRITY_SOURCE_KEYS);
  if (unready.some((u) => u.state === "loading")) return { outcome: "waiting" };
  if (unready.length > 0) return { outcome: "load_failed", unproven: unready };
  if (!queue) return { outcome: "load_failed", unproven: [] };

  const all = [...queue.entries, ...Object.values(queue.byCard).flat()];
  const keys: string[] = [];
  const found = new Set<string>();
  for (const entry of all) {
    const hit = entry.ids.filter((id) => wanted.includes(id));
    if (hit.length === 0) continue;
    if (!keys.includes(entry.key)) keys.push(entry.key);
    for (const id of hit) found.add(id);
  }
  const missingIds = wanted.filter((id) => !found.has(id));
  if (keys.length === 0) return { outcome: "not_found", missingIds };
  return { outcome: "focus", keys, ids: [...found], missingIds };
}
