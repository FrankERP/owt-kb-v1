// scripts/lib/sr-cleanup.mjs
//
// Pure decision logic for the guarded Service Readiness operator cleanup and
// restore commands (plan §8 of
// docs/superpowers/plans/2026-07-18-service-readiness-mutation-integrity.md).
//
// Same shape as `sr-verification.mjs`, deliberately: this module is PURE — no
// Sanity client, no network, no filesystem. It only DECIDES. The scripts
// (`service-readiness-cleanup.mjs` / `service-readiness-restore.mjs`) own the
// I/O and may only execute a plan produced here. Every refusal is therefore
// exhaustively unit-testable offline.
//
// The environment guards are NOT re-implemented here: `evaluateGuards()` from
// `sr-verification.mjs` is the single authority for project/dataset refusal, the
// marker, the token, the unknown-flag refusal, and `willContactRemote`. This
// tooling therefore refuses the production project/dataset outright, on any code
// path, in dry-run too — a production `--apply` needs separate explicit consent
// and a different, purpose-built command.
//
// Contract notes that shape every plan below:
//   · `_type` is immutable per document id — it is NEVER sent in a patch.
//   · `delete` takes no precondition, so a delete is always paired with a
//     revision-asserting no-op patch in the SAME transaction (the idiom used by
//     the shipped role DELETE).
//   · array-of-object writes need a `_key` per item.
//   · one invocation touches ONE named target; multi-target cleanup is separate.

import { createHash } from "node:crypto";

import { isValidServiceDate, mirrorReceiptId } from "./sr-verification.mjs";

/* ------------------------------------------------------------------ *
 * Types this tooling may ever name
 * ------------------------------------------------------------------ */

/** The three role types. All five member-referencing seats live on these. */
export const ROLE_TYPES = Object.freeze(["sunday_role", "saturday_role", "special_role"]);

/** Weekend setlists. `saturdarSongs` is a deliberate stored typo — never renamed. */
export const SETLIST_TYPES = Object.freeze(["featuredSongs", "saturdarSongs"]);

export const PROPOSAL_TYPE = "setlistProposal";
export const LOCK_TYPE = "roleTargetLock";
export const RECEIPT_TYPE = "roleCreationReceipt";

/** The eight protected stored types — the same set the Studio policy protects. */
export const CLEANUP_TARGET_TYPES = Object.freeze([
  ...ROLE_TYPES,
  ...SETLIST_TYPES,
  PROPOSAL_TYPE,
  LOCK_TYPE,
  RECEIPT_TYPE,
]);

/** Receipt states that are durable idempotency tombstones. Never deleted. */
export const RECEIPT_TOMBSTONE_STATES = Object.freeze(["committed", "role_deleted"]);

const RAW_DRAFT_PREFIX = "drafts.";

/* ------------------------------------------------------------------ *
 * Action registry
 * ------------------------------------------------------------------ */

/**
 * One entry per plan §8 action. `types` is the closed set of `_type` values the
 * action may target; `modes` is the closed set of `--mode` values (null when the
 * action has none). `rawDraft` is `true` when the target MUST be a raw draft,
 * `false` when it must NOT be.
 */
export const CLEANUP_ACTIONS = Object.freeze({
  "discard-raw-draft": {
    types: [...ROLE_TYPES, ...SETLIST_TYPES, PROPOSAL_TYPE],
    modes: null,
    rawDraft: true,
    summary: "Discard one exact raw draft. The published document is never touched.",
  },
  "select-canonical-duplicate": {
    types: [...ROLE_TYPES, ...SETLIST_TYPES],
    modes: null,
    rawDraft: false,
    summary: "Remove one empty duplicate at a target, keeping the named canonical document. Never merges.",
  },
  "repair-malformed-record": {
    types: [...ROLE_TYPES, ...SETLIST_TYPES, PROPOSAL_TYPE],
    modes: null,
    rawDraft: false,
    summary: "Patch a closed set of repairable fields on one malformed record, under its exact revision.",
  },
  "remove-malformed-role": {
    types: [...ROLE_TYPES],
    modes: null,
    rawDraft: false,
    summary: "Remove one malformed role, only after the live writers' dependency inventory comes back clean.",
  },
  "remove-orphan-setlist": {
    types: [...SETLIST_TYPES],
    modes: null,
    rawDraft: false,
    summary: "Remove one named orphan singleton setlist, with proof that no canonical owner exists.",
  },
  "resolve-proposal": {
    types: [PROPOSAL_TYPE],
    modes: ["retarget", "normalize", "remove"],
    rawDraft: false,
    summary: "Retarget, normalize, or remove ONE non-approved proposal. Approved proposals are refused.",
  },
  "reconcile-approved-receipt": {
    types: [PROPOSAL_TYPE],
    modes: ["reconcile"],
    rawDraft: false,
    summary: "Attach a reconciliation marker to a legacy approved proposal. Approved history is never deleted.",
  },
  "vacate-orphan-lock": {
    types: [LOCK_TYPE],
    modes: null,
    rawDraft: false,
    summary: "Vacate one orphan target lock, with published AND raw proof that its owning role is gone.",
  },
  "cleanup-creation-receipt": {
    types: [RECEIPT_TYPE],
    modes: ["inspect", "remove"],
    rawDraft: false,
    summary: "Inspect, or remove one malformed/orphan creation receipt. Tombstones are never deleted.",
  },
});

export const CLEANUP_ACTION_NAMES = Object.freeze(Object.keys(CLEANUP_ACTIONS).sort());

/** Fields `repair-malformed-record` may touch, per type. Closed allowlists. */
export const REPAIRABLE_FIELDS = Object.freeze({
  sunday_role: ["week", "published"],
  saturday_role: ["week", "published"],
  special_role: ["date", "service_name", "published"],
  featuredSongs: ["week"],
  saturdarSongs: ["week"],
  setlistProposal: ["service_type", "service_date", "status"],
});

/** Fields `resolve-proposal --mode normalize` may touch. */
export const NORMALIZABLE_PROPOSAL_FIELDS = Object.freeze(["service_type", "service_date", "status"]);

/** Never patchable: system fields, and `_type` (immutable per document id). */
const FORBIDDEN_PATCH_FIELDS = Object.freeze(["_id", "_rev", "_type", "_createdAt", "_updatedAt"]);

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const BOOLEAN_FLAGS = Object.freeze(["--apply", "--json", "--help"]);
const VALUE_FLAGS = Object.freeze(["--action", "--id", "--rev", "--confirm", "--mode", "--evidence", "--backup"]);

/**
 * Parse argv for the cleanup/restore commands. Same idiom as
 * `parseCliArgs`: dry-run is the DEFAULT, and an unrecognized flag is reported
 * (never silently ignored) so the caller can hard-refuse instead of guessing.
 *
 * A repeated flag is also `unknown`-worthy: repeating `--id` would be a
 * multi-target invocation, and each cleanup target must be its own run.
 */
export function parseCleanupArgs(argv = []) {
  const out = {
    apply: false,
    json: false,
    help: false,
    action: null,
    id: null,
    rev: null,
    confirm: null,
    mode: null,
    evidencePath: null,
    backupPath: null,
    unknown: [],
    repeated: [],
  };
  const seen = new Set();
  const target = {
    "--action": "action",
    "--id": "id",
    "--rev": "rev",
    "--confirm": "confirm",
    "--mode": "mode",
    "--evidence": "evidencePath",
    "--backup": "backupPath",
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== "string" || !token.startsWith("-")) continue;
    if (BOOLEAN_FLAGS.includes(token)) {
      if (seen.has(token)) out.repeated.push(token);
      seen.add(token);
      if (token === "--apply") out.apply = true;
      if (token === "--json") out.json = true;
      if (token === "--help") out.help = true;
      continue;
    }
    if (VALUE_FLAGS.includes(token)) {
      if (seen.has(token)) out.repeated.push(token);
      seen.add(token);
      const value = argv[i + 1];
      // A missing or flag-shaped value is a typo, not an empty option.
      if (typeof value !== "string" || value.startsWith("-")) {
        out.unknown.push(`${token} (missing value)`);
        continue;
      }
      out[target[token]] = value;
      i++;
      continue;
    }
    out.unknown.push(token);
  }
  for (const flag of out.repeated) out.unknown.push(`${flag} (repeated — one target per invocation)`);
  return out;
}

/* ------------------------------------------------------------------ *
 * Action-specific confirmation
 * ------------------------------------------------------------------ */

/**
 * The exact `--confirm` value a run must carry. It names the ACTION, the exact
 * id and the exact revision, so a confirmation can never be recycled from an
 * earlier plan, another target, or another revision of the same target.
 */
export function confirmationPhrase({ action, id, rev, mode = null } = {}) {
  if (!nonEmpty(action) || !nonEmpty(id) || !nonEmpty(rev)) return null;
  const spec = CLEANUP_ACTIONS[action];
  if (!spec) return null;
  const suffix = spec.modes ? `#${mode ?? ""}` : "";
  return `${action}${suffix}:${id}@${rev}`;
}

/** Restore confirmation: the entry count plus a digest of the exact id set. */
export function restoreConfirmationPhrase(entries = []) {
  const ids = entries
    .map((e) => (e && typeof e._id === "string" ? e._id : null))
    .filter((v) => typeof v === "string" && v.length)
    .sort();
  if (!ids.length) return null;
  return `restore:${ids.length}:${sha256(ids.join("|")).slice(0, 12)}`;
}

/* ------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------ */

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function nonEmpty(v) {
  return typeof v === "string" && v.length > 0;
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isRawDraftId(id) {
  return nonEmpty(id) && id.startsWith(RAW_DRAFT_PREFIX);
}

/** Canonical (published) id of any id, raw draft or not. */
export function publishedIdOf(id) {
  return isRawDraftId(id) ? id.slice(RAW_DRAFT_PREFIX.length) : id;
}

/** Mirror of `serviceDayKey` (`app/utils/serviceReadSelect.ts`). */
export function mirrorServiceDayKey(value) {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return isValidServiceDate(day) ? day : null;
}

/** Mirror of `setlistTargetKey` (`app/utils/serviceReadModel.ts`). */
export function mirrorSetlistTargetKey(roleType, week, roleId) {
  if (roleType === "sunday_role") return week ? `featuredSongs:${week}` : null;
  if (roleType === "saturday_role") return week ? `saturdarSongs:${week}` : null;
  if (roleType === "special_role") return roleId || null;
  return null;
}

/** Mirror of `proposalTargetKey` (`app/utils/serviceReadModel.ts`). */
export function mirrorProposalTargetKey(serviceType, serviceDate, serviceRef) {
  if (serviceType === "sunday") return `sunday:${serviceDate}`;
  if (serviceType === "saturday") return `saturday:${serviceDate}`;
  if (serviceType === "special") return serviceRef ? `special:${serviceRef}` : null;
  return null;
}

const SERVICE_KIND_OF = Object.freeze({
  sunday_role: "sunday",
  saturday_role: "saturday",
  special_role: "special",
});

/** The stored target key of a weekend setlist document (`type:week`). */
function setlistDocKey(doc) {
  if (!isObj(doc)) return null;
  if (!SETLIST_TYPES.includes(doc._type)) return null;
  if (!nonEmpty(doc._id)) return null;
  const week = mirrorServiceDayKey(doc.week);
  return week ? `${doc._type}:${week}` : null;
}

/** Service date of a role document (`week` for weekends, `date` for special). */
export function roleServiceDate(role) {
  if (!isObj(role)) return null;
  return mirrorServiceDayKey(role._type === "special_role" ? role.date : role.week);
}

/* ------------------------------------------------------------------ *
 * Dependency inventory mirror
 *
 * MIRROR of the `delete` branch of `inventoryRoleDependencies`
 * (`app/utils/roleDependencies.ts`), because this file is `.mjs` and cannot
 * import `.ts`. `scripts/lib/__tests__/sr-cleanup.test.mjs` asserts this mirror
 * against the real helper over a table of inputs, so cleanup can never become
 * more permissive than the live writers.
 * ------------------------------------------------------------------ */

/**
 * Inventory everything that blocks removing `role`. Fail-closed by construction:
 * a missing evidence array (rather than an empty one) yields `usable: false`, and
 * an unusable inventory is NEVER "no dependencies found".
 */
export function mirrorInventoryRoleDeleteDependencies({
  role,
  canonicalSetlists,
  rawSetlistDrafts,
  canonicalProposals,
  rawProposalDrafts,
  unknownReferences,
} = {}) {
  const issues = [];
  const roleDoc = isObj(role) ? role : null;
  let roleType = null;
  let roleId = null;
  let date = null;

  if (!roleDoc) {
    issues.push("role");
  } else {
    roleType = ROLE_TYPES.includes(roleDoc._type) ? roleDoc._type : null;
    if (!roleType) issues.push("role_type");
    roleId = nonEmpty(roleDoc._id) ? roleDoc._id : null;
    if (!roleId) issues.push("role_id");
    date = roleServiceDate(roleDoc);
    if (!date) issues.push("date");
  }

  const scopes = [];
  if (roleType && roleId && date) {
    scopes.push({
      scope: "old",
      roleType,
      date,
      roleId,
      setlistTargetKey:
        roleType === "special_role" ? roleId : mirrorSetlistTargetKey(roleType, date, roleId),
      proposalTargetKey: mirrorProposalTargetKey(SERVICE_KIND_OF[roleType], date, roleId),
    });
  }

  const usable = issues.length === 0 && scopes.length > 0;
  const dependencies = [];
  const seen = new Set();
  const add = (ref) => {
    if (seen.has(ref.id)) return;
    seen.add(ref.id);
    dependencies.push(ref);
  };

  const scanSetlists = (rows, kind) => {
    if (!Array.isArray(rows)) return;
    for (const scope of scopes) {
      if (!scope.setlistTargetKey) continue;
      for (const row of rows) {
        const key = setlistDocKey(row);
        if (!key || key !== scope.setlistTargetKey) continue;
        const songCount = Array.isArray(row.songs) ? row.songs.length : 0;
        // An EMPTY setlist still blocks: removal never adopts or destroys history.
        add({ id: row._id, type: row._type, kind, scope: scope.scope, detail: `songs:${songCount}` });
      }
    }
  };

  const proposalFacts = (doc) => {
    if (!isObj(doc) || !nonEmpty(doc._id)) return null;
    const serviceRef = nonEmpty(doc.service_ref) ? doc.service_ref : null;
    const facts = {
      id: doc._id,
      serviceRef,
      date: mirrorServiceDayKey(doc.service_date),
      status: typeof doc.status === "string" ? doc.status : null,
      targetKey: null,
    };
    const kindKnown = ["sunday", "saturday", "special"].includes(doc.service_type);
    if (kindKnown && facts.date && serviceRef) {
      facts.targetKey = mirrorProposalTargetKey(doc.service_type, facts.date, serviceRef);
    }
    return facts;
  };

  const scanProposals = (rows, raw) => {
    if (!Array.isArray(rows)) return;
    for (const scope of scopes) {
      for (const row of rows) {
        const facts = proposalFacts(row);
        if (!facts) continue;
        const ownedByRole = !!(roleId && facts.serviceRef === roleId);
        if (facts.targetKey) {
          if (facts.targetKey !== scope.proposalTargetKey && !ownedByRole) continue;
          add({
            id: facts.id,
            type: PROPOSAL_TYPE,
            kind: raw ? "raw_proposal_draft" : "proposal",
            scope: scope.scope,
            detail: `status:${facts.status ?? "unknown"}`,
          });
          continue;
        }
        if (!ownedByRole && facts.date !== scope.date) continue;
        add({
          id: facts.id,
          type: PROPOSAL_TYPE,
          kind: raw ? "raw_proposal_draft" : "malformed_proposal",
          scope: scope.scope,
          detail: `status:${facts.status ?? "unknown"}`,
        });
      }
    }
  };

  scanSetlists(canonicalSetlists, "canonical_setlist");
  scanSetlists(rawSetlistDrafts, "raw_setlist_draft");
  scanProposals(canonicalProposals, false);
  scanProposals(rawProposalDrafts, true);

  // A special service stores its songs on the role: deleting it destroys them.
  if (roleType === "special_role" && roleId && roleDoc && Array.isArray(roleDoc.songs) && roleDoc.songs.length) {
    add({
      id: roleId,
      type: "special_role",
      kind: "special_songs",
      scope: "role",
      detail: `songs:${roleDoc.songs.length}`,
    });
  }

  if (Array.isArray(unknownReferences)) {
    for (const row of unknownReferences) {
      if (!isObj(row) || !nonEmpty(row._id)) continue;
      if (row._id === roleId) continue;
      add({ id: row._id, type: nonEmpty(row._type) ? row._type : "unknown", kind: "unknown_reference", scope: "role" });
    }
  }

  return {
    code: "role_has_dependencies",
    usable,
    issues,
    scopes,
    dependencies,
    hasDependencies: dependencies.length > 0,
  };
}

/** The five evidence arrays a role removal must supply, even when empty. */
export const ROLE_DEPENDENCY_EVIDENCE_KEYS = Object.freeze([
  "canonicalSetlists",
  "rawSetlistDrafts",
  "canonicalProposals",
  "rawProposalDrafts",
  "unknownReferences",
]);

/* ------------------------------------------------------------------ *
 * Mutation descriptors
 *
 * The scripts translate these — and nothing else — into Sanity calls.
 * ------------------------------------------------------------------ */

/** Revision-asserting no-op patch. Pairs with `delete`, which takes no precondition. */
function assertRev(id, rev) {
  return { op: "assertRev", id, rev };
}

function del(id) {
  return { op: "delete", id };
}

function patch(id, rev, { set = null, unset = null, inc = null } = {}) {
  const out = { op: "patch", id, rev };
  if (set && Object.keys(set).length) out.set = set;
  if (unset && unset.length) out.unset = [...unset];
  if (inc && Object.keys(inc).length) out.inc = inc;
  return out;
}

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

function refuse(code, message) {
  return { code, message };
}

/**
 * Reject a patch payload that touches a system field, `_type` (immutable per
 * document id), or an array-of-object item without a `_key`.
 */
function validatePatchPayload(set, unset, allowedFields, refusals) {
  const fields = [...Object.keys(set ?? {}), ...(unset ?? [])];
  if (!fields.length) {
    refusals.push(refuse("empty_repair", "No field to set or unset. A cleanup with no effect is refused."));
    return;
  }
  for (const field of fields) {
    if (FORBIDDEN_PATCH_FIELDS.includes(field)) {
      refusals.push(
        refuse(
          "immutable_field_in_patch",
          `Field "${field}" is never patchable (\`_type\` is immutable per document id; system fields are owned by the Content Lake).`,
        ),
      );
      continue;
    }
    if (!allowedFields.includes(field)) {
      refusals.push(
        refuse("field_not_repairable", `Field "${field}" is not on this type's closed repairable-field allowlist.`),
      );
    }
  }
  for (const [field, value] of Object.entries(set ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isObj(item) && !nonEmpty(item._key)) {
        refusals.push(
          refuse("missing_array_key", `Array field "${field}" has an object item without a \`_key\`. Sanity requires one per item.`),
        );
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * The cleanup decision
 * ------------------------------------------------------------------ */

/**
 * Decide one atomic cleanup.
 *
 * `documents` is the OBSERVED snapshot (id -> document or null) the script
 * re-read immediately before deciding; every revision assertion in the returned
 * plan comes from it, never from operator input alone.
 *
 * Returns `{ ok, plan, refusals }`. `ok` is true only when there is not a single
 * refusal, and a refused decision never carries a plan.
 */
export function evaluateCleanupAction({
  action = null,
  id = null,
  rev = null,
  confirm = null,
  mode = null,
  documents = {},
  evidence = {},
  now = new Date().toISOString(),
} = {}) {
  const refusals = [];
  const spec = CLEANUP_ACTIONS[action];

  if (!spec) {
    return {
      ok: false,
      action,
      id,
      rev,
      mode,
      plan: null,
      refusals: [
        refuse("unknown_action", `Unknown action ${JSON.stringify(action)}. Known: ${CLEANUP_ACTION_NAMES.join(", ")}.`),
      ],
    };
  }

  if (!nonEmpty(id)) refusals.push(refuse("missing_target_id", "An exact target `--id` is required."));
  if (!nonEmpty(rev)) refusals.push(refuse("missing_revision", "An exact observed `--rev` is required."));

  if (spec.modes) {
    if (!spec.modes.includes(mode)) {
      refusals.push(refuse("invalid_mode", `--mode must be one of: ${spec.modes.join(", ")}.`));
    }
  } else if (nonEmpty(mode)) {
    refusals.push(refuse("unexpected_mode", `Action ${action} takes no --mode.`));
  }

  const expectedConfirm = confirmationPhrase({ action, id, rev, mode });
  if (!expectedConfirm || confirm !== expectedConfirm) {
    refusals.push(
      refuse(
        "confirmation_mismatch",
        `--confirm must be exactly "${expectedConfirm ?? "<action>[#mode]:<id>@<rev>"}" — it names the action, the exact id and the exact revision.`,
      ),
    );
  }

  const target = isObj(documents[id]) ? documents[id] : null;
  if (!target) {
    refusals.push(refuse("target_absent", `No document ${JSON.stringify(id)} in the observed snapshot.`));
  } else {
    if (target._rev !== rev) {
      refusals.push(
        refuse("revision_mismatch", `Observed revision ${JSON.stringify(target._rev)} does not match --rev. Re-read and retry.`),
      );
    }
    if (!spec.types.includes(target._type)) {
      refusals.push(
        refuse("wrong_target_type", `Action ${action} does not accept _type ${JSON.stringify(target._type)}.`),
      );
    }
    if (spec.rawDraft && !isRawDraftId(id)) {
      refusals.push(refuse("not_a_raw_draft", `${action} only accepts a \`drafts.\` id.`));
    }
    if (!spec.rawDraft && isRawDraftId(id)) {
      refusals.push(refuse("unexpected_raw_draft", `${action} never accepts a \`drafts.\` id; use discard-raw-draft.`));
    }
  }

  const plan = target ? planFor({ action, id, rev, mode, target, documents, evidence, now, refusals }) : null;

  return {
    ok: refusals.length === 0,
    action,
    id,
    rev,
    mode: mode ?? null,
    plan: refusals.length === 0 ? plan : null,
    refusals,
  };
}

function planFor({ action, id, rev, mode, target, documents, evidence, now, refusals }) {
  switch (action) {
    case "discard-raw-draft":
      return planDiscardRawDraft({ id, rev, target, documents, refusals });
    case "select-canonical-duplicate":
      return planSelectCanonicalDuplicate({ id, rev, target, documents, evidence, refusals });
    case "repair-malformed-record":
      return planRepair({ id, rev, target, evidence, refusals });
    case "remove-malformed-role":
      return planRemoveMalformedRole({ id, rev, target, documents, evidence, now, refusals });
    case "remove-orphan-setlist":
      return planRemoveOrphanSetlist({ id, rev, target, evidence, refusals });
    case "resolve-proposal":
      return planResolveProposal({ id, rev, mode, target, documents, evidence, refusals });
    case "reconcile-approved-receipt":
      return planReconcileApprovedReceipt({ id, rev, target, evidence, now, refusals });
    case "vacate-orphan-lock":
      return planVacateOrphanLock({ id, rev, target, evidence, now, refusals });
    case "cleanup-creation-receipt":
      return planCleanupCreationReceipt({ id, rev, mode, target, evidence, refusals });
    default:
      refusals.push(refuse("unknown_action", `No plan builder for ${action}.`));
      return null;
  }
}

/* --- discard exact raw draft -------------------------------------- */

function planDiscardRawDraft({ id, rev, target, documents, refusals }) {
  const publishedId = publishedIdOf(id);
  const published = isObj(documents[publishedId]) ? documents[publishedId] : null;
  if (published && published._type !== target._type) {
    refusals.push(
      refuse(
        "published_type_mismatch",
        `Raw draft ${id} and its published counterpart disagree on _type. Refusing rather than guessing.`,
      ),
    );
  }
  return {
    kind: "discard-raw-draft",
    // Only the draft. The published document is read for context and never written.
    backupIds: [id],
    mutations: [assertRev(id, rev), del(id)],
    requeryIds: [id, publishedId],
    notes: [
      published
        ? `Published ${publishedId} exists and is left byte-for-byte untouched.`
        : `No published counterpart: ${publishedId} does not exist.`,
    ],
  };
}

/* --- select a canonical duplicate, never merging ------------------- */

function planSelectCanonicalDuplicate({ id, rev, target, documents, evidence, refusals }) {
  const keepId = nonEmpty(evidence.keepId) ? evidence.keepId : null;
  if (!keepId) {
    refusals.push(refuse("canonical_keeper_missing", "evidence.keepId must name the canonical document to KEEP."));
    return null;
  }
  if (keepId === id) {
    refusals.push(refuse("keeper_equals_target", "evidence.keepId is the removal target. Name the other document."));
    return null;
  }
  const keeper = isObj(documents[keepId]) ? documents[keepId] : null;
  if (!keeper) {
    refusals.push(refuse("canonical_keeper_absent", `Keeper ${keepId} is not in the observed snapshot.`));
    return null;
  }
  if (!nonEmpty(evidence.keepRev) || keeper._rev !== evidence.keepRev) {
    refusals.push(
      refuse("canonical_keeper_revision_mismatch", `evidence.keepRev must equal the keeper's observed revision.`),
    );
  }
  if (keeper._type !== target._type) {
    refusals.push(refuse("duplicate_type_mismatch", "Duplicate and keeper must share the same _type."));
  }

  const keyOf = (doc) =>
    SETLIST_TYPES.includes(doc._type) ? setlistDocKey(doc) : `${doc._type}:${roleServiceDate(doc) ?? "?"}`;
  const targetKey = keyOf(target);
  const keeperKey = keyOf(keeper);
  if (!targetKey || !keeperKey || targetKey !== keeperKey) {
    refusals.push(
      refuse(
        "duplicate_target_mismatch",
        `Duplicate (${targetKey ?? "unresolved"}) and keeper (${keeperKey ?? "unresolved"}) do not share one target. Refusing.`,
      ),
    );
  }

  // No implicit merging, ever: a duplicate carrying content is a human decision.
  const carried = describeCarriedContent(target);
  if (carried.length) {
    refusals.push(
      refuse(
        "duplicate_carries_content",
        `Duplicate carries ${carried.join(", ")}. Selection never merges — move the content explicitly first.`,
      ),
    );
  }

  return {
    kind: "select-canonical-duplicate",
    backupIds: [id, keepId],
    mutations: [
      // The keeper is asserted, never written: proof it did not change under us.
      assertRev(keepId, keeper._rev),
      assertRev(id, rev),
      del(id),
    ],
    requeryIds: [id, keepId],
    notes: [`Keeping ${keepId} unchanged; removing empty duplicate ${id}. Nothing is merged.`],
  };
}

/** Non-empty content that a removal would destroy. */
function describeCarriedContent(doc) {
  const out = [];
  if (Array.isArray(doc.songs) && doc.songs.length) out.push(`songs:${doc.songs.length}`);
  for (const seat of ["Lead", "BGVs", "Chorus", "instruments", "foh_team"]) {
    if (Array.isArray(doc[seat]) && doc[seat].length) out.push(`${seat}:${doc[seat].length}`);
  }
  return out;
}

/* --- repair a malformed record ------------------------------------ */

function planRepair({ id, rev, target, evidence, refusals }) {
  const set = isObj(evidence.set) ? evidence.set : null;
  const unset = Array.isArray(evidence.unset) ? evidence.unset.filter(nonEmpty) : null;
  const allowed = REPAIRABLE_FIELDS[target._type] ?? [];
  validatePatchPayload(set, unset, allowed, refusals);
  if (refusals.length) return null;
  return {
    kind: "repair-malformed-record",
    backupIds: [id],
    mutations: [patch(id, rev, { set, unset })],
    requeryIds: [id],
    notes: [`Repairing ${Object.keys(set ?? {}).concat(unset ?? []).join(", ")} under revision ${rev}.`],
  };
}

/* --- remove a malformed role -------------------------------------- */

function planRemoveMalformedRole({ id, rev, target, documents, evidence, now, refusals }) {
  const missing = ROLE_DEPENDENCY_EVIDENCE_KEYS.filter((k) => !Array.isArray(evidence[k]));
  if (missing.length) {
    refusals.push(
      refuse(
        "dependency_inventory_incomplete",
        `Missing dependency evidence array(s): ${missing.join(", ")}. An incomplete inventory is never "no dependencies".`,
      ),
    );
    return null;
  }

  const inventory = mirrorInventoryRoleDeleteDependencies({ role: target, ...evidence });
  if (!inventory.usable) {
    refusals.push(
      refuse("dependency_scope_unresolved", `Dependency scope could not be resolved (issues: ${inventory.issues.join(", ") || "none"}).`),
    );
    return null;
  }
  if (inventory.hasDependencies) {
    refusals.push(
      refuse(
        inventory.code,
        `${inventory.dependencies.length} dependency(ies) at this target: ${inventory.dependencies
          .map((d) => `${d.kind} ${d.id}`)
          .join(", ")}. Same refusal policy as the live writers.`,
      ),
    );
    return null;
  }

  const mutations = [assertRev(id, rev)];
  const backupIds = [id];
  const requeryIds = [id];
  const notes = [];

  // The weekend lock is vacated, never deleted: it is the target's coordination
  // singleton and the next claimant needs its advanced generation.
  const lockId = nonEmpty(evidence.lockId) ? evidence.lockId : null;
  if (lockId) {
    const lock = isObj(documents[lockId]) ? documents[lockId] : null;
    if (!lock) {
      refusals.push(refuse("lock_evidence_absent", `Lock ${lockId} named but absent from the observed snapshot.`));
      return null;
    }
    if (lock._type !== LOCK_TYPE) {
      refusals.push(refuse("lock_wrong_type", `${lockId} is not a ${LOCK_TYPE}.`));
      return null;
    }
    if (lock.roleId && lock.roleId !== id) {
      refusals.push(refuse("lock_owned_by_other_role", `Lock ${lockId} is claimed by ${lock.roleId}, not ${id}.`));
      return null;
    }
    mutations.push(vacatePatch(lock, now));
    backupIds.push(lockId);
    requeryIds.push(lockId);
    notes.push(`Vacating lock ${lockId} (generation ${(lock.generation ?? 0) + 1}); never deleted.`);
  } else if (target._type !== "special_role") {
    refusals.push(
      refuse(
        "lock_evidence_missing",
        "A weekend role owns a target lock. Supply evidence.lockId so the removal vacates it in the same transaction.",
      ),
    );
    return null;
  }

  // The creation receipt is RETIRED, never deleted: it is a durable idempotency
  // tombstone, and deleting it would let the original requestId create again.
  const receiptId = nonEmpty(target.creationReceiptId) ? target.creationReceiptId : null;
  if (receiptId) {
    const receipt = isObj(documents[receiptId]) ? documents[receiptId] : null;
    if (!receipt) {
      refusals.push(
        refuse("receipt_evidence_missing", `Role carries creationReceiptId ${receiptId}; supply it in the snapshot so it can be retired.`),
      );
      return null;
    }
    if (receipt._type !== RECEIPT_TYPE) {
      refusals.push(refuse("receipt_wrong_type", `${receiptId} is not a ${RECEIPT_TYPE}.`));
      return null;
    }
    mutations.push(patch(receiptId, receipt._rev, { set: { state: "role_deleted", updatedAt: now } }));
    backupIds.push(receiptId);
    requeryIds.push(receiptId);
    notes.push(`Retiring receipt ${receiptId} to state role_deleted (tombstone kept forever).`);
  }

  mutations.push(del(id));
  return { kind: "remove-malformed-role", backupIds, mutations, requeryIds, notes };
}

function vacatePatch(lock, now) {
  const generation = Number.isFinite(lock.generation) ? lock.generation : 0;
  return patch(lock._id, lock._rev, {
    set: { state: "vacant", generation: generation + 1, updatedAt: now },
    unset: ["roleId", "claimNonce"],
  });
}

/* --- remove a named orphan singleton setlist ---------------------- */

function planRemoveOrphanSetlist({ id, rev, target, evidence, refusals }) {
  const key = setlistDocKey(target);
  if (!key) {
    refusals.push(refuse("setlist_target_unresolved", `${id} has no resolvable \`week\`, so its target cannot be proven orphan.`));
    return null;
  }
  if (!Array.isArray(evidence.canonicalOwners) || !Array.isArray(evidence.rawOwnerDrafts)) {
    refusals.push(
      refuse(
        "orphan_proof_missing",
        "evidence.canonicalOwners and evidence.rawOwnerDrafts are required (even when empty) to prove no canonical owner exists.",
      ),
    );
    return null;
  }
  if (!Array.isArray(evidence.observedSetlists)) {
    refusals.push(refuse("singleton_proof_missing", "evidence.observedSetlists is required to prove the target holds a single setlist."));
    return null;
  }

  const owners = [...evidence.canonicalOwners, ...evidence.rawOwnerDrafts].filter(isObj);
  const claiming = owners.filter((role) => {
    const date = roleServiceDate(role);
    if (!date) return true; // unresolvable owner: fail closed
    return mirrorSetlistTargetKey(role._type, date, publishedIdOf(role._id ?? "")) === key;
  });
  if (claiming.length) {
    refusals.push(
      refuse(
        "canonical_owner_exists",
        `${claiming.length} role(s) still own ${key}: ${claiming.map((r) => r._id ?? "(no id)").join(", ")}. Not an orphan.`,
      ),
    );
    return null;
  }

  const siblings = evidence.observedSetlists.filter(isObj).filter((doc) => setlistDocKey(doc) === key);
  if (siblings.length !== 1 || siblings[0]._id !== id) {
    refusals.push(
      refuse(
        "not_a_singleton",
        `${siblings.length} setlist(s) observed at ${key}. This action removes a named SINGLETON orphan only.`,
      ),
    );
    return null;
  }

  const carried = describeCarriedContent(target);
  if (carried.length) {
    refusals.push(
      refuse(
        "orphan_setlist_carries_history",
        `${id} carries ${carried.join(", ")}. Removing it would destroy service history; refusing.`,
      ),
    );
    return null;
  }

  return {
    kind: "remove-orphan-setlist",
    backupIds: [id],
    mutations: [assertRev(id, rev), del(id)],
    requeryIds: [id],
    notes: [`Proven orphan singleton at ${key} with zero songs and no canonical or raw owner.`],
  };
}

/* --- retarget / normalize / remove a non-approved proposal --------- */

function planResolveProposal({ id, rev, mode, target, documents, evidence, refusals }) {
  if (target.status === "approved") {
    refusals.push(
      refuse(
        "approved_proposal_protected",
        `${id} is approved. Approved history is never retargeted, normalized, or deleted by cleanup.`,
      ),
    );
    return null;
  }

  if (mode === "remove") {
    return {
      kind: "resolve-proposal:remove",
      backupIds: [id],
      mutations: [assertRev(id, rev), del(id)],
      requeryIds: [id],
      notes: [`Removing non-approved proposal (status ${target.status ?? "unknown"}).`],
    };
  }

  if (mode === "normalize") {
    const set = isObj(evidence.set) ? evidence.set : null;
    const unset = Array.isArray(evidence.unset) ? evidence.unset.filter(nonEmpty) : null;
    validatePatchPayload(set, unset, [...NORMALIZABLE_PROPOSAL_FIELDS], refusals);
    if (set && set.status === "approved") {
      refusals.push(refuse("approval_via_cleanup_forbidden", "Cleanup never approves a proposal. Use the review route."));
    }
    if (refusals.length) return null;
    return {
      kind: "resolve-proposal:normalize",
      backupIds: [id],
      mutations: [patch(id, rev, { set, unset })],
      requeryIds: [id],
      notes: [`Normalizing ${Object.keys(set ?? {}).concat(unset ?? []).join(", ")}.`],
    };
  }

  // retarget
  const serviceRef = nonEmpty(evidence.serviceRef) ? evidence.serviceRef : null;
  const serviceType = nonEmpty(evidence.serviceType) ? evidence.serviceType : null;
  const serviceDate = mirrorServiceDayKey(evidence.serviceDate);
  if (!serviceRef || !serviceType || !serviceDate) {
    refusals.push(
      refuse("retarget_destination_incomplete", "Retarget needs evidence.serviceRef, evidence.serviceType and a valid evidence.serviceDate."),
    );
    return null;
  }
  const destination = isObj(documents[serviceRef]) ? documents[serviceRef] : null;
  if (!destination) {
    refusals.push(refuse("retarget_destination_absent", `Destination role ${serviceRef} is not in the observed snapshot.`));
    return null;
  }
  if (!ROLE_TYPES.includes(destination._type) || SERVICE_KIND_OF[destination._type] !== serviceType) {
    refusals.push(
      refuse("retarget_destination_type_mismatch", `Destination ${serviceRef} is ${destination._type}, which is not service_type ${serviceType}.`),
    );
    return null;
  }
  if (roleServiceDate(destination) !== serviceDate) {
    refusals.push(
      refuse("retarget_destination_date_mismatch", `Destination ${serviceRef} is dated ${roleServiceDate(destination) ?? "unresolved"}, not ${serviceDate}.`),
    );
    return null;
  }
  if (!Array.isArray(evidence.destinationProposals)) {
    refusals.push(refuse("retarget_destination_proof_missing", "evidence.destinationProposals is required (even when empty)."));
    return null;
  }
  const destinationKey = mirrorProposalTargetKey(serviceType, serviceDate, serviceRef);
  const occupied = evidence.destinationProposals
    .filter(isObj)
    .filter((p) => p._id !== id)
    .filter((p) => {
      const date = mirrorServiceDayKey(p.service_date);
      const ref = nonEmpty(p.service_ref) ? p.service_ref : null;
      if (!date || !ref) return true; // unresolvable: fail closed
      return mirrorProposalTargetKey(p.service_type, date, ref) === destinationKey;
    });
  if (occupied.length) {
    refusals.push(
      refuse("destination_proposal_exists", `Destination ${destinationKey} already holds ${occupied.map((p) => p._id).join(", ")}.`),
    );
    return null;
  }

  return {
    kind: "resolve-proposal:retarget",
    backupIds: [id],
    mutations: [
      // `_type` is never sent; only the target fields move.
      patch(id, rev, {
        set: {
          service_type: serviceType,
          service_date: serviceDate,
          service_ref: { _type: "reference", _ref: serviceRef },
        },
      }),
    ],
    requeryIds: [id, serviceRef],
    notes: [`Retargeting to ${destinationKey}.`],
  };
}

/* --- reconcile a legacy approved receipt --------------------------- */

function planReconcileApprovedReceipt({ id, rev, target, evidence, now, refusals }) {
  if (target.status !== "approved") {
    refusals.push(refuse("not_an_approved_proposal", `${id} has status ${target.status ?? "unknown"}; nothing to reconcile.`));
    return null;
  }
  if (nonEmpty(target.approvalReceiptId)) {
    refusals.push(
      refuse("approval_receipt_already_present", `${id} already carries approvalReceiptId ${target.approvalReceiptId}.`),
    );
    return null;
  }
  const receiptId = nonEmpty(evidence.approvalReceiptId) ? evidence.approvalReceiptId : null;
  if (!receiptId) {
    refusals.push(refuse("reconciliation_receipt_missing", "evidence.approvalReceiptId must name the reconciliation receipt id."));
    return null;
  }
  if (!nonEmpty(evidence.note)) {
    refusals.push(refuse("reconciliation_note_missing", "evidence.note must record WHY this legacy approval is being reconciled."));
    return null;
  }
  return {
    kind: "reconcile-approved-receipt",
    backupIds: [id],
    // Additive only. Approved history is never deleted, downgraded, or retargeted.
    mutations: [
      patch(id, rev, {
        set: {
          approvalReceiptId: receiptId,
          approvalReconciledAt: now,
          approvalReconciliationNote: evidence.note,
        },
      }),
    ],
    requeryIds: [id],
    notes: ["Additive reconciliation marker only; the approval itself is untouched."],
  };
}

/* --- vacate an orphan lock ---------------------------------------- */

function planVacateOrphanLock({ id, rev, target, evidence, now, refusals }) {
  if (target.state === "vacant") {
    refusals.push(refuse("lock_already_vacant", `${id} is already vacant; nothing to do.`));
    return null;
  }
  if (!Array.isArray(evidence.publishedRoles) || !Array.isArray(evidence.rawRoleDrafts)) {
    refusals.push(
      refuse(
        "lock_proof_missing",
        "evidence.publishedRoles AND evidence.rawRoleDrafts are required (even when empty): a lock is orphan only when neither a published nor a raw owner exists.",
      ),
    );
    return null;
  }
  const ownerId = nonEmpty(target.roleId) ? target.roleId : null;
  if (!ownerId) {
    refusals.push(
      refuse("lock_owner_unresolved", `${id} is in state ${target.state ?? "unknown"} with no roleId. Repair it rather than vacating blind.`),
    );
    return null;
  }
  const alive = [...evidence.publishedRoles, ...evidence.rawRoleDrafts]
    .filter(isObj)
    .filter((role) => publishedIdOf(role._id ?? "") === ownerId);
  if (alive.length) {
    refusals.push(
      refuse("lock_owner_alive", `Owner ${ownerId} still exists (${alive.map((r) => r._id).join(", ")}). The lock is not orphan.`),
    );
    return null;
  }
  return {
    kind: "vacate-orphan-lock",
    backupIds: [id],
    // Vacated, never deleted: the generation must keep advancing monotonically.
    mutations: [vacatePatch({ ...target, _id: id, _rev: rev }, now)],
    requeryIds: [id],
    notes: [`Owner ${ownerId} proven absent in both the published and raw perspectives.`],
  };
}

/* --- inspect / remove a creation receipt --------------------------- */

function planCleanupCreationReceipt({ id, rev, mode, target, evidence, refusals }) {
  if (mode === "inspect") {
    return {
      kind: "cleanup-creation-receipt:inspect",
      backupIds: [],
      mutations: [],
      requeryIds: [id],
      notes: [
        `state=${target.state ?? "(none)"} requestId=${target.requestId ?? "(none)"} roleId=${target.roleId ?? "(none)"}`,
        `derived id for that requestId: ${mirrorReceiptId(target.requestId) ?? "(none)"}`,
      ],
    };
  }

  // Removal. Tombstones first: a committed or retired receipt is the durable
  // idempotency record of a real create, and normal cleanup NEVER deletes it.
  if (RECEIPT_TOMBSTONE_STATES.includes(target.state)) {
    refusals.push(
      refuse(
        "receipt_tombstone_protected",
        `${id} is in state ${target.state}, a durable idempotency tombstone. Cleanup never deletes it — inspect instead.`,
      ),
    );
    return null;
  }

  if (!Array.isArray(evidence.liveRoles)) {
    refusals.push(
      refuse("receipt_role_proof_missing", "evidence.liveRoles is required (even when empty) to prove no live role carries this receipt."),
    );
    return null;
  }
  const carriers = evidence.liveRoles
    .filter(isObj)
    .filter((role) => role.creationReceiptId === id || (nonEmpty(target.roleId) && publishedIdOf(role._id ?? "") === target.roleId));
  if (carriers.length) {
    refusals.push(
      refuse("receipt_carried_by_live_role", `Live role(s) ${carriers.map((r) => r._id).join(", ")} still reference ${id}. Refusing.`),
    );
    return null;
  }

  // No concurrent create may be able to address this id. A create derives the
  // receipt id from its requestId, so a receipt whose id IS that derivation is
  // still addressable and must never be deleted; only an id/requestId mismatch
  // (or a receipt with no usable requestId at all) is provably unreachable.
  if (nonEmpty(target.requestId) && mirrorReceiptId(target.requestId) === id) {
    refusals.push(
      refuse(
        "receipt_addressable_by_create",
        `${id} is the deterministic id of requestId ${JSON.stringify(target.requestId)}, so a concurrent retry could still address it. Refusing.`,
      ),
    );
    return null;
  }

  return {
    kind: "cleanup-creation-receipt:remove",
    backupIds: [id],
    mutations: [assertRev(id, rev), del(id)],
    requeryIds: [id],
    notes: [
      `Malformed receipt: state ${target.state ?? "(none)"} is not a tombstone, no live role carries it, and its id is not derivable from its requestId.`,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Restore
 * ------------------------------------------------------------------ */

/** Body fields of a backed-up document: never `_id`/`_rev`/`_type`/timestamps. */
export function restoreFields(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc ?? {})) {
    if (FORBIDDEN_PATCH_FIELDS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Decide a restore from a backup envelope.
 *
 * All-or-nothing: ANY later-write conflict refuses the whole restore. A restore
 * never force-overwrites — every in-place restore carries the exact revision the
 * backup was taken at, so a document written since the backup is left alone and
 * reported instead.
 */
export function evaluateRestore({ entries = [], documents = {}, confirm = null } = {}) {
  const refusals = [];

  if (!Array.isArray(entries) || entries.length === 0) {
    refusals.push(refuse("empty_backup", "The backup envelope contains no documents to restore."));
    return { ok: false, plan: null, refusals };
  }

  const expectedConfirm = restoreConfirmationPhrase(entries);
  if (!expectedConfirm || confirm !== expectedConfirm) {
    refusals.push(
      refuse("restore_confirmation_mismatch", `--confirm must be exactly "${expectedConfirm ?? "restore:<count>:<digest>"}".`),
    );
  }

  const seen = new Set();
  const mutations = [];
  const creates = [];
  const requeryIds = [];
  const notes = [];

  for (const entry of entries) {
    if (!isObj(entry) || !nonEmpty(entry._id)) {
      refusals.push(refuse("backup_entry_missing_id", "A backup entry has no `_id`."));
      continue;
    }
    const id = entry._id;
    if (seen.has(id)) {
      refusals.push(refuse("backup_duplicate_entry", `Backup contains ${id} twice.`));
      continue;
    }
    seen.add(id);
    requeryIds.push(id);

    if (!nonEmpty(entry._type) || !CLEANUP_TARGET_TYPES.includes(entry._type)) {
      refusals.push(
        refuse("restore_type_not_protected", `${id} has _type ${JSON.stringify(entry._type)}, which this tooling never restores.`),
      );
      continue;
    }
    if (!nonEmpty(entry._rev)) {
      refusals.push(
        refuse("backup_entry_missing_revision", `${id} has no recorded revision; a revision-blind restore is refused.`),
      );
      continue;
    }

    const current = isObj(documents[id]) ? documents[id] : null;
    if (!current) {
      // Re-creating a document the cleanup deleted is not an overwrite.
      creates.push({ op: "createIfNotExists", id, type: entry._type, fields: restoreFields(entry) });
      notes.push(`${id}: absent — recreated from the backup body.`);
      continue;
    }
    if (current._type !== entry._type) {
      refusals.push(
        refuse("restore_type_mismatch", `${id} is now _type ${current._type}, backup says ${entry._type}. \`_type\` is immutable; refusing.`),
      );
      continue;
    }
    if (current._rev !== entry._rev) {
      refusals.push(
        refuse(
          "later_write_conflict",
          `${id} was written after the backup (observed ${current._rev}, backup ${entry._rev}). Refusing — restore never force-overwrites.`,
        ),
      );
      continue;
    }
    mutations.push(patch(id, entry._rev, { set: restoreFields(entry) }));
    notes.push(`${id}: restored in place under revision ${entry._rev}.`);
  }

  if (refusals.length) return { ok: false, plan: null, refusals };

  return {
    ok: true,
    plan: {
      kind: "restore",
      backupIds: [...seen],
      // Creates first so a recreated document exists before anything references it.
      mutations: [...creates, ...mutations],
      requeryIds,
      notes,
    },
    refusals,
  };
}

/* ------------------------------------------------------------------ *
 * Post-write re-query
 * ------------------------------------------------------------------ */

/**
 * Verify the re-queried state against the plan. Every `delete` must be gone,
 * every `patch`/`create` must exist with a CHANGED revision (an unchanged
 * revision means the write silently did not land), and no mutated document may
 * have changed `_type`.
 */
export function verifyCleanupOutcome({ plan, before = {}, after = {} } = {}) {
  const failures = [];
  if (!plan) return { ok: false, failures: [{ code: "no_plan", id: null }] };

  const deleted = new Set(plan.mutations.filter((m) => m.op === "delete").map((m) => m.id));
  const written = plan.mutations.filter((m) => m.op === "patch" || m.op === "createIfNotExists");

  for (const id of deleted) {
    if (after[id]) failures.push({ code: "still_present", id });
  }
  for (const m of written) {
    if (deleted.has(m.id)) continue;
    const doc = after[m.id];
    if (!doc) {
      failures.push({ code: "missing_after_write", id: m.id });
      continue;
    }
    const priorType = before[m.id]?._type;
    if (priorType && doc._type !== priorType) failures.push({ code: "type_changed", id: m.id });
    if (m.op === "patch" && doc._rev === m.rev) failures.push({ code: "revision_unchanged", id: m.id });
  }
  return { ok: failures.length === 0, failures };
}
