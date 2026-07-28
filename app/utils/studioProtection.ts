// Studio protection policy for the nine protected stored types
// (Service Readiness A2 §8 / A3 §4) — pure, exported, and unit-testable.
//
// WHY a code-owned policy instead of UI configuration alone: the Studio is an
// alternate write path into exactly the documents A2 spends its whole effort
// guarding. "We ticked a box in the config" is not assertable; this module is,
// and `app/utils/__tests__/studioProtection.test.ts` asserts every capability of
// every protected type in a plain Node test, with no browser involved.
//
// SANITY v5 CORRECTNESS: `__experimental_actions` was REMOVED in Sanity v5 — it
// is inert dead config there and is deliberately NOT used anywhere in this repo.
// Protection is built from the supported v5 mechanisms only:
//
//   create      -> `document.newDocumentOptions` drops the template, and the two
//                  internal types are additionally `hidden: true` in the schema
//   update      -> `readOnly: true` on the document type (whole form read-only)
//   every other -> `document.actions` resolves to an EMPTY action list, which
//   mutation      applies however the document pane was reached, including a
//                  hand-typed `/studio/structure/...` or intent URL
//   structure   -> the custom structure lists these types only inside an
//                  explicitly read-only inspection group
//
// Read-only inspection stays available on purpose: an operator still needs to
// look at a lock, a receipt, or a malformed role while diagnosing.

/**
 * The nine protected stored types. `saturdarSongs` is a deliberate stored typo —
 * never rename.
 *
 * Membership here is what earns a type a pane in `sanity/structure.ts`'s
 * read-only inspection group, because `partitionStudioTypes` classifies
 * everything else as `editable`. A `hidden: true` internal type that is NOT
 * listed here is therefore reachable NOWHERE in the Studio — which would make
 * `DELETE_ONLY_REASONS.notificationOutbox.prune` ("safe to remove by hand") a
 * promise the Studio cannot keep. Hence the invariant asserted in
 * `app/utils/__tests__/studioProtection.test.ts`: every
 * {@link INTERNAL_STUDIO_TYPES} entry appears in this list.
 *
 * `notificationOutbox` is listed here AND in {@link DELETE_ONLY_STUDIO_TYPES}.
 * That is not a contradiction: `studioCapability` checks delete-only FIRST, so
 * the type still resolves `delete` (an operator can prune a stray entry) while
 * this list is what puts it behind "solo lectura" instead of in the ordinary
 * "pick a type and edit it" list.
 */
export const PROTECTED_STUDIO_TYPES = [
  "sunday_role",
  "saturday_role",
  "special_role",
  "featuredSongs",
  "saturdarSongs",
  "setlistProposal",
  "roleTargetLock",
  "roleCreationReceipt",
  "notificationOutbox",
] as const;

export type ProtectedStudioType = (typeof PROTECTED_STUDIO_TYPES)[number];

/**
 * DELETE-ONLY governed types: read and delete are allowed, every other mutation
 * is denied.
 *
 * `loginEvent` is the sign-in audit trail. It is written only by `auth.ts`'s
 * `events.signIn` through the server write token, so hand-authoring or editing an
 * entry would falsify an audit record — but pruning it is legitimate operator
 * work, and Service Readiness A3 §4 deletes its own run-owned verification events
 * by exact `_id`.
 *
 * It used to express this with an `__experimental_actions` list of `["read",
 * "delete"]`, which Sanity v5 REMOVED — so the type had silently lost its
 * restriction and every mutating action was available again. The policy now
 * lives here, in code, and is asserted by
 * `app/utils/__tests__/studioProtection.test.ts`.
 *
 * `notificationOutbox` is the debounce/coordination queue for email notifications.
 * It is written only by the server write token through the guarded outbox writers
 * (`app/utils/serviceMutationSideEffects.ts`, `app/utils/outboxSweep.ts`), and it
 * needs the same "prunable, never hand-authored" shape as `loginEvent` — but it is
 * ALSO never hand-authored at all, so it is additionally listed in
 * `INTERNAL_STUDIO_TYPES` below. `studioCapability` composes both: delete-only
 * governs read/create/update/delete, and internal-ness is still consulted for the
 * create mechanism so the "hidden" affordance isn't lost to the delete-only branch.
 */
export const DELETE_ONLY_STUDIO_TYPES = ["loginEvent", "notificationOutbox"] as const;

export type DeleteOnlyStudioType = (typeof DELETE_ONLY_STUDIO_TYPES)[number];

/**
 * Reason text for the delete-only decisions, one entry per {@link DeleteOnlyStudioType}.
 * Kept as data rather than inline in `studioCapability` so every delete-only type
 * gets prose that is actually true of it — `loginEvent`'s "would falsify an audit
 * record" language does not hold for `notificationOutbox`, which is coordination
 * state, not an audit trail.
 */
const DELETE_ONLY_REASONS: Readonly<Record<DeleteOnlyStudioType, { read: string; prune: string; create: string; update: string }>> =
  Object.freeze({
    loginEvent: {
      read: "loginEvent is an audit trail; reading it is the point.",
      prune:
        "Pruning loginEvent entries is legitimate operator work, and the A3 verification reset deletes its own run-owned events by exact _id.",
      create:
        "loginEvent documents are written only by the server (auth.ts events.signIn); a hand-authored entry would falsify an audit record.",
      update: "loginEvent fields are read-only in the Studio; editing an audit record would falsify it.",
    },
    notificationOutbox: {
      read: "notificationOutbox is coordination state; reading it is how an operator diagnoses a stuck or malformed entry.",
      prune:
        "Pruning notificationOutbox entries is legitimate operator work: the sweep already claims and consumes its own entries, so a stray or malformed one is safe to remove by hand.",
      create:
        "notificationOutbox documents are written only by the server write token, through the guarded outbox writers; a hand-authored entry is not legitimate coordination state.",
      update:
        "notificationOutbox fields are read-only in the Studio; editing an entry by hand is not legitimate coordination state.",
    },
  });

/**
 * Internal coordination types: never authored by hand at all, so they are also
 * `hidden: true` in the schema and never appear in any create affordance.
 * `notificationOutbox` is additionally delete-only (above) — it is the one type
 * governed by both lists at once.
 */
export const INTERNAL_STUDIO_TYPES = ["roleTargetLock", "roleCreationReceipt", "notificationOutbox"] as const;

/**
 * Fields owned by the guarded writers and never hand-authored: the lock's
 * coordination state, the receipt's idempotency record, and the internal
 * idempotency links a role carries.
 *
 * How each is kept out of the authoring surface differs, and the test asserts
 * both:
 *   · on the three role types the listed fields are `hidden: true` FIELDS inside
 *     an otherwise operator-visible document;
 *   · `roleTargetLock` / `roleCreationReceipt` / `notificationOutbox` are
 *     `hidden: true` TYPES, so every field is off the authoring surface with
 *     them.
 * The read-only inspection group in `sanity/structure.ts` is the one deliberate
 * place these are visible, and it cannot write. That statement holds only
 * because every one of them is also in {@link PROTECTED_STUDIO_TYPES}, which is
 * what builds the pane — it was briefly false for `notificationOutbox`, which
 * was hidden and governed but listed nowhere the structure could reach.
 */
export const INTERNAL_STUDIO_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sunday_role: ["creationReceiptId", "creationFingerprint"],
  saturday_role: ["creationReceiptId", "creationFingerprint"],
  special_role: ["creationReceiptId", "creationFingerprint"],
  roleTargetLock: ["targetKey", "state", "roleId", "roleType", "claimNonce", "generation"],
  roleCreationReceipt: ["requestId", "fingerprint", "roleId", "targetIdentity", "state"],
  notificationOutbox: [
    "kind",
    "subjectKey",
    "memberId",
    "roleId",
    "proposalId",
    "serviceDate",
    "roleType",
    "before",
    "knownRecipients",
    "firstQueuedAt",
    "notifyAfter",
    "deadline",
    "status",
    "claimedAt",
  ],
});

/**
 * Every mutating capability the Studio can offer. The first six are the abstract
 * ones ("can a human change this document at all"); the rest are the exact
 * Sanity v5 built-in document action identifiers (`SANITY_DEFINED_ACTIONS`).
 */
export const STUDIO_MUTATING_CAPABILITIES = [
  "create",
  "update",
  "delete",
  "publish",
  "unpublish",
  "duplicate",
  "discardChanges",
  "discardVersion",
  "unpublishVersion",
  "restore",
  "schedule",
  "linkToCanvas",
  "editInCanvas",
  "unlinkFromCanvas",
] as const;

/** Read-only capabilities that stay available for diagnosis. */
export const STUDIO_READ_ONLY_CAPABILITIES = ["read", "inspect", "history", "preview", "structure-list"] as const;

export type StudioCapability =
  | (typeof STUDIO_MUTATING_CAPABILITIES)[number]
  | (typeof STUDIO_READ_ONLY_CAPABILITIES)[number];

/** The Sanity v5 built-in document action identifiers, as of sanity 5.x. */
export const SANITY_V5_BUILT_IN_ACTIONS = [
  "delete",
  "discardChanges",
  "discardVersion",
  "duplicate",
  "restore",
  "publish",
  "unpublish",
  "unpublishVersion",
  "linkToCanvas",
  "editInCanvas",
  "unlinkFromCanvas",
  "schedule",
] as const;

export interface StudioCapabilityDecision {
  allowed: boolean;
  /** Which supported v5 mechanism enforces (or permits) this decision. */
  mechanism: string;
  reason: string;
}

const PROTECTED_SET: ReadonlySet<string> = new Set(PROTECTED_STUDIO_TYPES);
const DELETE_ONLY_SET: ReadonlySet<string> = new Set(DELETE_ONLY_STUDIO_TYPES);
const INTERNAL_SET: ReadonlySet<string> = new Set(INTERNAL_STUDIO_TYPES);
const MUTATING_SET: ReadonlySet<string> = new Set(STUDIO_MUTATING_CAPABILITIES);
const READ_ONLY_SET: ReadonlySet<string> = new Set(STUDIO_READ_ONLY_CAPABILITIES);

export function isProtectedStudioType(typeName: unknown): typeName is ProtectedStudioType {
  return typeof typeName === "string" && PROTECTED_SET.has(typeName);
}

export function isDeleteOnlyStudioType(typeName: unknown): typeName is DeleteOnlyStudioType {
  return typeof typeName === "string" && DELETE_ONLY_SET.has(typeName);
}

/**
 * Any type this policy governs at all — the eight fully protected types plus the
 * delete-only ones. The config resolvers branch on THIS, so a delete-only type
 * cannot escape the policy just because it is not "protected".
 */
export function isGovernedStudioType(typeName: unknown): boolean {
  return isProtectedStudioType(typeName) || isDeleteOnlyStudioType(typeName);
}

export function isInternalStudioType(typeName: unknown): boolean {
  return typeof typeName === "string" && INTERNAL_SET.has(typeName);
}

export function isInternalStudioField(typeName: unknown, fieldName: unknown): boolean {
  if (typeof typeName !== "string" || typeof fieldName !== "string") return false;
  return (INTERNAL_STUDIO_FIELDS[typeName] ?? []).includes(fieldName);
}

/**
 * The whole policy, in one function: may `capability` be exercised on
 * `typeName` from inside the Studio?
 *
 * Unprotected types are untouched — this is a targeted policy, not a Studio-wide
 * lockdown. An unrecognized capability is denied for a protected type (fail
 * closed: a future Sanity release adding a new mutating action must not silently
 * become allowed).
 */
export function studioCapability(typeName: unknown, capability: string): StudioCapabilityDecision {
  if (isDeleteOnlyStudioType(typeName)) {
    const reasons = DELETE_ONLY_REASONS[typeName];
    if (READ_ONLY_SET.has(capability)) {
      return { allowed: true, mechanism: "read-only inspection", reason: reasons.read };
    }
    if (capability === "delete") {
      return { allowed: true, mechanism: "document.actions -> [delete]", reason: reasons.prune };
    }
    if (capability === "create") {
      // A delete-only type can ALSO be internal (`notificationOutbox` is both):
      // consult internal-ness here too, so the "hidden" create mechanism isn't
      // lost just because this branch runs before the protected-type branch below.
      return {
        allowed: false,
        mechanism: isInternalStudioType(typeName)
          ? "document.newDocumentOptions + schema `hidden: true`"
          : "document.newDocumentOptions",
        reason: reasons.create,
      };
    }
    if (capability === "update") {
      return { allowed: false, mechanism: "schema `readOnly: true`", reason: reasons.update };
    }
    return {
      allowed: false,
      mechanism: "document.actions -> [delete]",
      reason: `Only delete is kept for ${typeName}; ${JSON.stringify(capability)} is denied (fail closed).`,
    };
  }
  if (!isProtectedStudioType(typeName)) {
    return {
      allowed: true,
      mechanism: "not-protected",
      reason: `${String(typeName)} is not a protected Service Readiness type; the Studio governs it normally.`,
    };
  }
  if (READ_ONLY_SET.has(capability)) {
    return {
      allowed: true,
      mechanism: "read-only inspection",
      reason: "Read-only inspection stays available so an operator can diagnose without a write path.",
    };
  }
  if (capability === "create") {
    return {
      allowed: false,
      mechanism: isInternalStudioType(typeName)
        ? "document.newDocumentOptions + schema `hidden: true`"
        : "document.newDocumentOptions",
      reason: `${typeName} documents are created only by the guarded writers (deterministic ids, receipts, locks).`,
    };
  }
  if (capability === "update") {
    return {
      allowed: false,
      mechanism: "schema `readOnly: true`",
      reason: `${typeName} fields are read-only in the Studio; edits go through the guarded API routes.`,
    };
  }
  if (MUTATING_SET.has(capability)) {
    return {
      allowed: false,
      mechanism: "document.actions -> []",
      reason: `The ${capability} action is removed for ${typeName}, including when the document pane is reached by direct URL.`,
    };
  }
  return {
    allowed: false,
    mechanism: "document.actions -> []",
    reason: `Unrecognized capability ${JSON.stringify(capability)} is denied for ${typeName} (fail closed).`,
  };
}

/* ------------------------------------------------------------------ *
 * Config resolvers
 *
 * Typed against the real Sanity v5 config types, but with type-only imports so
 * this module (and its test) never pull the Studio runtime into Node.
 * ------------------------------------------------------------------ */

/** Minimal shape of a v5 document action, enough to identify and filter it. */
export interface StudioActionLike {
  action?: string;
  displayName?: string;
}

/** Minimal shape of a v5 new-document template item. */
export interface StudioTemplateItemLike {
  templateId: string;
  parameters?: { [key: string]: unknown };
}

/** The type a template item would create, if it can be determined. */
export function templateItemType(item: StudioTemplateItemLike): string | null {
  const params = item.parameters ?? {};
  for (const key of ["type", "schemaType"]) {
    const value = params[key];
    if (typeof value === "string" && value.length) return value;
  }
  return typeof item.templateId === "string" && item.templateId.length ? item.templateId : null;
}

/**
 * `document.actions` resolver. For a protected type EVERY action is dropped —
 * built-in or plugin-supplied — because no action currently offered by the
 * Studio is read-only. A delete-only type keeps exactly `delete` and nothing
 * else. Ungoverned types keep their actions untouched.
 */
export function protectedDocumentActions<T extends StudioActionLike>(
  prev: T[],
  context: { schemaType: string },
): T[] {
  if (!isGovernedStudioType(context?.schemaType)) return prev;
  return prev.filter((action) => studioCapability(context.schemaType, action.action ?? "unknown").allowed);
}

/** `document.newDocumentOptions` resolver: no governed type may be created. */
export function protectedNewDocumentOptions<T extends StudioTemplateItemLike>(prev: T[]): T[] {
  return prev.filter((item) => !isGovernedStudioType(templateItemType(item)));
}

/**
 * Split a list of document type names into the ones the default structure may
 * offer for editing and the ones that only appear in the read-only inspection
 * group.
 *
 * Delete-only-ness is NOT what decides this; protected-ness is. `loginEvent` is
 * delete-only and deliberately stays in the default list: it is not "solo
 * lectura" — an operator must be able to find and prune it — and its form is
 * already `readOnly: true` with `delete` as its only action. `notificationOutbox`
 * is delete-only too but is ALSO protected, because a `hidden: true` type has no
 * default list item to stay in; the inspection pane is the only way to reach it
 * at all, and pruning still works from there.
 */
export function partitionStudioTypes(typeNames: readonly string[]): {
  editable: string[];
  inspectOnly: string[];
} {
  const editable: string[] = [];
  const inspectOnly: string[] = [];
  for (const name of typeNames) (isProtectedStudioType(name) ? inspectOnly : editable).push(name);
  return { editable, inspectOnly };
}

/** Human-readable Spanish titles for the read-only inspection group. */
export const PROTECTED_STUDIO_TITLES: Readonly<Record<ProtectedStudioType, string>> = Object.freeze({
  sunday_role: "Domingo (solo lectura)",
  saturday_role: "Sábado (solo lectura)",
  special_role: "Especial (solo lectura)",
  featuredSongs: "Setlist domingo (solo lectura)",
  saturdarSongs: "Setlist sábado (solo lectura)",
  setlistProposal: "Propuestas (solo lectura)",
  roleTargetLock: "Locks internos (solo lectura)",
  roleCreationReceipt: "Recibos internos (solo lectura)",
  notificationOutbox: "Cola de avisos (solo lectura)",
});
