// scripts/lib/proposalMessages.mjs
//
// Pure mapping for the one-shot `lead_notes` / `admin_notes` → `messages[]`
// migration (Release 2, Child A §Migration). No Sanity client, no I/O: given one
// `setlistProposal` document it returns either the array the document should be
// patched with, or a decision NOT to write it.
//
// ⚠️ ONE SHAPE, TWO IMPLEMENTATIONS — deliberate, not an oversight. This
// re-derives what `app/utils/proposalMessageWrite.ts` owns, because the script
// that consumes it runs standalone against production and importing the app's
// module tree into a one-shot production writer is a larger risk than repeating
// six field names. Nothing makes the two agree at compile time, so BOTH test
// files assert the same field set, `_type` included.

/** The stored array-item type — every item on this document carries one. */
export const PROPOSAL_MESSAGE_TYPE = "proposal_message";

/**
 * Deterministic `_key`s. They are deterministic precisely so that a re-run can
 * recognise its own work: a random key would mint duplicates forever.
 */
export const LEAD_MESSAGE_KEY = "migleadnote01";
export const ADMIN_MESSAGE_KEY = "migadminnote1";
export const MIGRATION_KEYS = [LEAD_MESSAGE_KEY, ADMIN_MESSAGE_KEY];

/**
 * `admin_notes` is attributed to `last_transition.by` ONLY under these actions.
 *
 * `reconcile_target` writes `last_transition` while never touching
 * `admin_notes`, so a retarget after a change request would attribute one
 * admin's note to another — permanently, since this delivery has no edit path.
 * `approve` writes no `last_transition` at all, so the fallback is narrower than
 * it looks. The schema's own comment is the rule: a fabricated attribution in an
 * audit-adjacent history is worse than an absent one.
 */
export const ATTRIBUTING_TRANSITION_ACTIONS = ["request_changes", "reopen"];

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** First non-empty string in the fallback chain, or "" when the chain is dry. */
function firstAvailable(candidates) {
  for (const candidate of candidates) {
    const value = trimmedString(candidate);
    if (value) return value;
  }
  return "";
}

/** Accept a projected `_ref` string or a whole reference object; return the id. */
function refId(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value._ref === "string") return value._ref.trim();
  return "";
}

function reference(id) {
  return { _ref: id, _type: "reference" };
}

function message({ key, authorId, authorRole, kind, body, at }) {
  return {
    _key: key,
    _type: PROPOSAL_MESSAGE_TYPE,
    ...(authorId ? { author: reference(authorId) } : {}),
    author_role: authorRole,
    kind,
    body,
    at,
  };
}

/** The `_key`s already stored on the document, as a plain string array. */
export function storedMessageKeys(doc) {
  const keys = Array.isArray(doc?.messageKeys) ? doc.messageKeys : [];
  return keys.filter((key) => typeof key === "string" && key);
}

/**
 * How many items `messages[]` holds.
 *
 * `count(messages)` is projected alongside the keys and preferred, because
 * `messages[]._key` drops nulls: a single stored item that somehow lacks a
 * `_key` would project as `[]` and read as "empty array, safe to overwrite".
 */
export function storedMessageCount(doc) {
  if (typeof doc?.messageCount === "number" && Number.isFinite(doc.messageCount)) {
    return doc.messageCount;
  }
  return storedMessageKeys(doc).length;
}

/** The `last_transition.action` this document records, or "" when it has none. */
export function transitionAction(doc) {
  return trimmedString(doc?.last_transition?.action);
}

/**
 * Decide what to do with one `setlistProposal`.
 *
 * Returns `{ decision, reason, messages, ... }` where `decision` is one of:
 *
 * - `"abort"` — refuse to write this document and REPORT it. Never a silent skip.
 * - `"skip"`  — already migrated; a re-run is a no-op.
 * - `"noop"`  — nothing to migrate (no legacy notes).
 * - `"patch"` — `messages` holds the array to `set`.
 *
 * The safety order matters and is the plan's:
 *
 *  1. A non-empty `messages[]` carrying NO migration `_key` is a live thread: a
 *     whole-array `set` would erase real conversation. Hard abort.
 *  2. Skip when ANY key this document would mint is already present. Three
 *     production documents mint both keys, so a singular check would
 *     half-migrate one of them on a re-run.
 *  3. Only then is the whole-array `set` sound, because the array is now known
 *     to be absent or empty — which the final `partial_migration` abort below
 *     enforces rather than assumes.
 */
export function planProposalMessages(doc) {
  const existingKeys = storedMessageKeys(doc);
  const existingCount = storedMessageCount(doc);
  const migrationKeysPresent = existingKeys.filter((key) => MIGRATION_KEYS.includes(key));
  const action = transitionAction(doc);
  const attributing = ATTRIBUTING_TRANSITION_ACTIONS.includes(action);
  const context = { existingCount, existingKeys, migrationKeysPresent, action, attributing };

  // 1. A live thread. Report it; never overwrite it.
  if (existingCount > 0 && migrationKeysPresent.length === 0) {
    return { decision: "abort", reason: "live_thread", messages: [], ...context };
  }

  const minted = [];

  const leadBody = trimmedString(doc?.lead_notes);
  if (leadBody) {
    minted.push({
      key: LEAD_MESSAGE_KEY,
      authorId: refId(doc?.lead),
      authorRole: "lead",
      kind: "lead_note",
      body: leadBody,
      // `last_edited_at` is the newest fact about the lead's own writing;
      // `submitted_at` is when the note reached an admin; `_createdAt` is the
      // floor. First available wins.
      at: firstAvailable([doc?.last_edited_at, doc?.submitted_at, doc?._createdAt]),
    });
  }

  const adminBody = trimmedString(doc?.admin_notes);
  if (adminBody) {
    minted.push({
      key: ADMIN_MESSAGE_KEY,
      authorId: attributing ? refId(doc?.last_transition?.by) : "",
      authorRole: "admin",
      kind: "admin_change_request",
      body: adminBody,
      at: firstAvailable([
        attributing ? doc?.last_transition?.at : "",
        doc?.reviewed_at,
        doc?._updatedAt,
      ]),
    });
  }

  if (minted.length === 0) {
    return { decision: "noop", reason: "no_legacy_notes", messages: [], ...context };
  }

  // 2. Already migrated: any key we would mint is already stored.
  if (minted.some((item) => existingKeys.includes(item.key))) {
    return { decision: "skip", reason: "already_migrated", messages: [], ...context };
  }

  // A message with no resolvable timestamp is not something to store and then
  // discover later — `_createdAt` / `_updatedAt` always exist on a real
  // document, so reaching this means the projection changed underneath us.
  if (minted.some((item) => !item.at)) {
    return { decision: "abort", reason: "unresolvable_timestamp", messages: [], ...context };
  }

  // 3. The whole-array `set` is only sound on an absent or empty array. Rules 1
  //    and 2 leave one corner uncovered — a document already carrying a
  //    migration message whose OTHER note was written afterwards — and a `set`
  //    there would drop the stored one. Refuse and report rather than write.
  if (existingCount > 0) {
    return { decision: "abort", reason: "partial_migration", messages: [], ...context };
  }

  // Chronological, lead-first on a tie: on a tie the lead's note is the one the
  // admin was replying to.
  const ordered = [...minted].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.key === LEAD_MESSAGE_KEY ? -1 : 1;
  });

  return {
    decision: "patch",
    reason: "migrate",
    messages: ordered.map(message),
    ...context,
  };
}
