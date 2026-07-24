// scripts/lib/sr-verification.mjs
//
// Shared guards, exclusive dataset lease, and deterministic synthetic fixtures
// for the Service Readiness A3 verification dataset (plan §2 of
// docs/superpowers/plans/2026-07-18-service-readiness-verification-release.md).
//
// EVERY guard lives here, in ONE place, so the seed / reset / feasibility
// scripts cannot drift apart or quietly lose a refusal. This module is PURE:
// no Sanity client, no network, no filesystem — it only decides. The scripts
// own the I/O and may only act on a decision produced here.
//
// Hard boundary: this tooling accepts ONLY project `scbxomq9` + dataset
// `service-readiness-verification`, and hard-refuses production project
// `ebb8vcnk` or dataset `production` on either axis (belt and braces: both the
// projectId and the dataset are checked independently, and a forbidden value on
// either one refuses the run even in dry-run mode).

import { createHash } from "node:crypto";

/* ------------------------------------------------------------------ *
 * Hard identities
 * ------------------------------------------------------------------ */

/** The only dataset this tooling may ever target. */
export const VERIFICATION_DATASET = "service-readiness-verification";

/** The only Sanity project this tooling may ever target. */
export const VERIFICATION_PROJECT_ID = "scbxomq9";

/** Production project — never a target, on any code path, ever. */
export const FORBIDDEN_PROJECT_IDS = Object.freeze(["ebb8vcnk"]);

/** Production dataset — never a target, on any code path, ever. */
export const FORBIDDEN_DATASETS = Object.freeze(["production"]);

export const MARKER_ENV = "SERVICE_READINESS_VERIFICATION_MARKER";
export const MARKER_VALUE = "owt-service-readiness-verification-v1";

/** Dedicated verification token env var. Never reuse a production token. */
export const TOKEN_ENV = "SR_VERIFY_SANITY_TOKEN";

/** Test-admin password hash, supplied outside Git. Never committed. */
export const ADMIN_HASH_ENV = "SR_VERIFY_ADMIN_PASSWORD_HASH";

/** Deterministic marker document proving the dataset's purpose. */
export const MARKER_DOC_ID = "serviceReadiness.verificationMarker";

/** Deterministic exclusive-lease document (plan §2 "Exclusive dataset lease"). */
export const LEASE_DOC_ID = "serviceReadiness.verificationLease";

/** Short bounded expiry — a crashed run blocks others only briefly. */
export const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

/** Backups land here; gitignored, never tracked. */
export const BACKUP_DIR = ".sr-verification-backups";

/** Every fixture id starts with this, and nothing else may ever be deleted. */
export const FIXTURE_ID_PREFIX = "srv.";

/** Infrastructure docs the lease/marker own — never fixtures, never reset. */
export const INFRASTRUCTURE_IDS = Object.freeze([MARKER_DOC_ID, LEASE_DOC_ID]);

export const API_VERSION = "2024-01-01";

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const KNOWN_FLAGS = new Set(["--apply", "--json", "--help"]);

/**
 * Parse argv. Dry-run is the DEFAULT: `apply` is true only for the exact
 * `--apply` token. An unrecognized flag is a hard failure rather than a
 * silently ignored typo.
 */
export function parseCliArgs(argv = []) {
  const flags = argv.filter((a) => a.startsWith("-"));
  const unknown = flags.filter((f) => !KNOWN_FLAGS.has(f));
  return {
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
    help: argv.includes("--help"),
    unknown,
  };
}

/* ------------------------------------------------------------------ *
 * Environment resolution + guards
 * ------------------------------------------------------------------ */

function trimmed(v) {
  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

/**
 * Resolve the environment this run would target. Dedicated `SR_VERIFY_*`
 * variables win, but the app's ordinary `NEXT_PUBLIC_*` variables are read as a
 * fallback ON PURPOSE: if an operator runs this with `--env-file=.env.local`,
 * the production project/dataset is what gets resolved and the guards below
 * refuse loudly, instead of the script seeing "unset" and looking safe.
 *
 * Secret VALUES are never returned — only presence booleans.
 */
export function resolveEnvironment(env = {}) {
  return {
    projectId: trimmed(env.SR_VERIFY_SANITY_PROJECT_ID) ?? trimmed(env.NEXT_PUBLIC_SANITY_PROJECT_ID),
    dataset: trimmed(env.SR_VERIFY_SANITY_DATASET) ?? trimmed(env.NEXT_PUBLIC_SANITY_DATASET),
    apiVersion: trimmed(env.NEXT_PUBLIC_SANITY_API_VERSION) ?? API_VERSION,
    marker: trimmed(env[MARKER_ENV]),
    hasToken: !!trimmed(env[TOKEN_ENV]),
    hasAdminPasswordHash: !!trimmed(env[ADMIN_HASH_ENV]),
    runId: trimmed(env.SR_VERIFY_RUN_ID),
    candidateSha: trimmed(env.SR_VERIFY_CANDIDATE_SHA),
    deploymentId: trimmed(env.SR_VERIFY_DEPLOYMENT_ID),
  };
}

function failure(code, message) {
  return { code, message };
}

/**
 * Evaluate every guard for a run.
 *
 * `hardFailures` refuse the run outright, in dry-run too — they mean the
 * operator pointed this tooling somewhere it must never point.
 * `applyBlockers` are "not enough to act": in dry-run they are printed and the
 * run still exits 0 having planned; with `--apply` they refuse.
 *
 * `willContactRemote` is the single authority the scripts branch on. It is
 * false unless `--apply` was passed AND nothing failed — so no remote code path
 * is reachable by default.
 */
export function evaluateGuards({ env = {}, apply = false, unknownFlags = [], requireAdminHash = false } = {}) {
  const resolved = resolveEnvironment(env);
  const hardFailures = [];
  const applyBlockers = [];

  for (const flag of unknownFlags) {
    hardFailures.push(failure("unknown_flag", `Unrecognized flag ${flag}. Refusing rather than guessing intent.`));
  }

  // --- Project axis -------------------------------------------------
  if (!resolved.projectId) {
    applyBlockers.push(
      failure("missing_project_id", `No project id resolved (set SR_VERIFY_SANITY_PROJECT_ID=${VERIFICATION_PROJECT_ID}).`),
    );
  } else if (FORBIDDEN_PROJECT_IDS.includes(resolved.projectId)) {
    hardFailures.push(
      failure(
        "forbidden_project",
        `Resolved project id "${resolved.projectId}" is the PRODUCTION project. This tooling must never target it.`,
      ),
    );
  } else if (resolved.projectId !== VERIFICATION_PROJECT_ID) {
    hardFailures.push(
      failure(
        "wrong_project",
        `Resolved project id "${resolved.projectId}" is not the verification project "${VERIFICATION_PROJECT_ID}".`,
      ),
    );
  }

  // --- Dataset axis (checked independently of the project) ----------
  if (!resolved.dataset) {
    applyBlockers.push(
      failure("missing_dataset", `No dataset resolved (set SR_VERIFY_SANITY_DATASET=${VERIFICATION_DATASET}).`),
    );
  } else if (FORBIDDEN_DATASETS.includes(resolved.dataset)) {
    hardFailures.push(
      failure(
        "forbidden_dataset",
        `Resolved dataset "${resolved.dataset}" is the PRODUCTION dataset. This tooling must never target it.`,
      ),
    );
  } else if (resolved.dataset !== VERIFICATION_DATASET) {
    hardFailures.push(
      failure("wrong_dataset", `Resolved dataset "${resolved.dataset}" is not "${VERIFICATION_DATASET}".`),
    );
  }

  // --- Verification marker -----------------------------------------
  if (!resolved.marker) {
    applyBlockers.push(failure("missing_marker", `${MARKER_ENV} is not set. Expected exactly "${MARKER_VALUE}".`));
  } else if (resolved.marker !== MARKER_VALUE) {
    hardFailures.push(
      failure("marker_mismatch", `${MARKER_ENV} is set to an unexpected value. Expected exactly "${MARKER_VALUE}".`),
    );
  }

  // --- Credentials --------------------------------------------------
  if (!resolved.hasToken) {
    applyBlockers.push(failure("missing_token", `${TOKEN_ENV} is not set. No remote call can be made.`));
  }
  if (requireAdminHash && !resolved.hasAdminPasswordHash) {
    applyBlockers.push(
      failure("missing_admin_password_hash", `${ADMIN_HASH_ENV} is not set. The test admin cannot be seeded.`),
    );
  }

  const refused = hardFailures.length > 0 || (apply && applyBlockers.length > 0);

  return {
    mode: apply ? "apply" : "dry-run",
    projectId: resolved.projectId,
    dataset: resolved.dataset,
    apiVersion: resolved.apiVersion,
    hasToken: resolved.hasToken,
    hardFailures,
    applyBlockers,
    refused,
    // The ONLY gate the scripts consult before constructing a client.
    willContactRemote: apply && !refused,
    exitCode: refused ? 1 : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Verification marker document
 * ------------------------------------------------------------------ */

export function buildMarkerDocument({ now }) {
  return {
    _id: MARKER_DOC_ID,
    _type: "srVerificationMarker",
    marker: MARKER_VALUE,
    dataset: VERIFICATION_DATASET,
    projectId: VERIFICATION_PROJECT_ID,
    purpose: "Service Readiness A3 isolated verification dataset. Synthetic data only.",
    createdAt: now,
  };
}

/**
 * Decide what to do about the marker document.
 * - absent            -> create it (bootstrap)
 * - present + exact   -> ok
 * - present + other   -> refuse; a mismatched marker means "not this dataset"
 */
export function evaluateMarkerDocument(doc) {
  if (!doc) return { action: "create", ok: false, reason: "marker_absent" };
  if (doc.marker === MARKER_VALUE) return { action: "ok", ok: true, reason: null };
  return { action: "refuse", ok: false, reason: "marker_document_mismatch" };
}

/* ------------------------------------------------------------------ *
 * Exclusive dataset lease (plan §2)
 * ------------------------------------------------------------------ */

/**
 * Owner is the exact `runId:candidateSha:deploymentId` triple. Any missing part,
 * or a part containing the `:` separator, yields null — a half-formed owner
 * string must never be able to alias another run's lease.
 */
export function leaseOwner({ runId, candidateSha, deploymentId } = {}) {
  const parts = [runId, candidateSha, deploymentId];
  for (const p of parts) {
    if (typeof p !== "string" || !p.length || p.includes(":")) return null;
  }
  return parts.join(":");
}

export function buildLeaseDocument({ owner, runId, candidateSha, deploymentId, now, ttlMs = DEFAULT_LEASE_TTL_MS }) {
  const acquiredAt = new Date(now).toISOString();
  const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
  return {
    _id: LEASE_DOC_ID,
    _type: "srVerificationLease",
    owner,
    runId,
    candidateSha,
    deploymentId,
    acquiredAt,
    expiresAt,
  };
}

/** True only when the lease has a usable `expiresAt` that is already past. */
export function isLeaseExpired(lease, now) {
  if (!lease || typeof lease.expiresAt !== "string") return false;
  const exp = Date.parse(lease.expiresAt);
  if (Number.isNaN(exp)) return false;
  return exp <= new Date(now).getTime();
}

function leaseIsStructurallyUsable(lease) {
  return (
    !!lease &&
    typeof lease.owner === "string" &&
    lease.owner.length > 0 &&
    typeof lease.expiresAt === "string" &&
    !Number.isNaN(Date.parse(lease.expiresAt))
  );
}

/**
 * Decide how to claim the lease.
 *
 *  existing absent            -> create-if-absent (atomic; loser retries)
 *  ours, still live           -> renew under `_rev`
 *  ours, expired              -> replace under `_rev`
 *  foreign, still live        -> REFUSE immediately (never steal)
 *  foreign, expired           -> replace under `_rev` precondition only
 *  structurally malformed     -> REFUSE (needs an explicitly authorized reset)
 */
export function evaluateLeaseClaim({ existing, owner, now }) {
  if (!owner) return { action: "refuse", reason: "invalid_owner", requiredRev: null };
  if (!existing) return { action: "create", reason: "absent", requiredRev: null };
  if (!leaseIsStructurallyUsable(existing)) {
    return { action: "refuse", reason: "malformed_lease", requiredRev: existing._rev ?? null };
  }
  const expired = isLeaseExpired(existing, now);
  const mine = existing.owner === owner;
  if (mine) {
    return { action: expired ? "replace" : "renew", reason: mine ? "own_lease" : null, requiredRev: existing._rev ?? null };
  }
  if (!expired) return { action: "refuse", reason: "foreign_live_lease", requiredRev: null };
  return { action: "replace", reason: "foreign_expired_lease", requiredRev: existing._rev ?? null };
}

/**
 * Re-read gate: every fixture create/reset/delete calls this against a FRESH
 * read of the lease. Exact owner match AND unexpired, or nothing is touched.
 */
export function evaluateLeaseOwnership({ existing, owner, now }) {
  if (!owner) return { ok: false, reason: "invalid_owner" };
  if (!existing) return { ok: false, reason: "lease_missing" };
  if (!leaseIsStructurallyUsable(existing)) return { ok: false, reason: "malformed_lease" };
  if (existing.owner !== owner) return { ok: false, reason: "foreign_lease" };
  if (isLeaseExpired(existing, now)) return { ok: false, reason: "lease_expired" };
  return { ok: true, reason: null };
}

/** Renew only as the current owner, under `_rev`. */
export function evaluateLeaseRenewal({ existing, owner, now, ttlMs = DEFAULT_LEASE_TTL_MS }) {
  const ownership = evaluateLeaseOwnership({ existing, owner, now });
  if (!ownership.ok) return { action: "refuse", reason: ownership.reason, requiredRev: null, expiresAt: null };
  return {
    action: "renew",
    reason: null,
    requiredRev: existing._rev ?? null,
    expiresAt: new Date(new Date(now).getTime() + ttlMs).toISOString(),
  };
}

/**
 * Release. Only the exact current owner may delete, under `_rev`. A foreign or
 * already-replaced lease is left alone — a release must never become a steal.
 * An expired lease that is still ours may be released (it is our own residue).
 */
export function evaluateLeaseRelease({ existing, owner }) {
  if (!owner) return { action: "refuse", reason: "invalid_owner", requiredRev: null };
  if (!existing) return { action: "noop", reason: "lease_absent", requiredRev: null };
  if (typeof existing.owner !== "string" || existing.owner !== owner) {
    return { action: "refuse", reason: "foreign_lease", requiredRev: null };
  }
  return { action: "delete", reason: null, requiredRev: existing._rev ?? null };
}

/* ------------------------------------------------------------------ *
 * Deterministic derivations
 *
 * MIRRORS of the TypeScript helpers, because these scripts are `.mjs` and
 * cannot import `.ts`. `scripts/lib/__tests__/sr-verification.test.mjs` asserts
 * every mirror against the real helper over a table of inputs, so the two can
 * never drift silently.
 * ------------------------------------------------------------------ */

function sha256(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Mirror of `roleTargetLockId` in app/utils/roleTargetLock.ts. */
export function mirrorRoleTargetLockId(targetKey) {
  if (typeof targetKey !== "string") return null;
  const at = targetKey.indexOf(":");
  if (at < 0) return null;
  const roleType = targetKey.slice(0, at);
  const date = targetKey.slice(at + 1);
  if (roleType !== "sunday_role" && roleType !== "saturday_role") return null;
  if (!isValidServiceDate(date)) return null;
  return `roleTarget.${roleType}.${date}`;
}

/** Mirror of `isValidServiceDate` in app/utils/serviceReadModel.ts. */
export function isValidServiceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Mirror of `receiptIdForRequestId` in app/utils/roleCreationReceipt.ts. */
export function mirrorReceiptId(requestId) {
  if (typeof requestId !== "string" || !requestId.length) return null;
  return `roleCreate.${sha256(requestId)}`;
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeLabel(v) {
  if (typeof v !== "string") return null;
  const out = v.normalize("NFC").trim().replace(/\s+/g, " ");
  return out.length ? out : null;
}

function canonicalRefs(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) if (typeof item === "string" && item.length) out.push(item);
  return out.sort(compareStrings);
}

function canonicalSlots(v, labelField) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const label = normalizeLabel(item[labelField]);
    const personId = typeof item.personId === "string" && item.personId.length ? item.personId : null;
    if (!label || !personId) continue;
    out.push({ label, personId });
  }
  return out.sort((a, b) => compareStrings(a.label, b.label) || compareStrings(a.personId, b.personId));
}

/** Mirror of `serviceDayKey` (date -> `YYYY-MM-DD`, else null). */
function mirrorServiceDayKey(v) {
  if (typeof v !== "string") return null;
  const head = v.slice(0, 10);
  return isValidServiceDate(head) ? head : null;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort(compareStrings);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Mirror of `canonicalizeCreatePayload(...).canonical` (fingerprint input). */
export function mirrorCanonicalCreatePayload(payload) {
  const doc = payload && typeof payload === "object" ? payload : {};
  const roleType = ["sunday_role", "saturday_role", "special_role"].includes(doc._type) ? doc._type : null;
  const date = mirrorServiceDayKey(doc.date);
  const serviceName = roleType === "special_role" ? normalizeLabel(doc.service_name) : null;
  let targetIdentity = null;
  if (roleType && date) {
    targetIdentity =
      roleType === "special_role"
        ? serviceName
          ? `special_role:${date}:${serviceName}`
          : null
        : `${roleType}:${date}`;
  }
  return {
    v: 1,
    roleType,
    date,
    targetIdentity,
    serviceName,
    published: doc.published === true,
    leads: canonicalRefs(doc.leads),
    bgvs: canonicalRefs(doc.bgvs),
    chorus: canonicalRefs(doc.chorus),
    instruments: canonicalSlots(doc.instruments, "instrument"),
    foh: canonicalSlots(doc.foh, "role"),
  };
}

/** Mirror of `payloadFingerprint` in app/utils/roleCreationReceipt.ts. */
export function mirrorPayloadFingerprint(payload) {
  return sha256(stableStringify(mirrorCanonicalCreatePayload(payload)));
}

/**
 * Deterministic `_key` for an array-of-object item. Same fixture inputs always
 * produce the same key, so a reset restores byte-identical documents (a random
 * key would make "reset is repeatable" false).
 */
export function fixtureKey(...parts) {
  return `srvk${sha256(parts.join("|")).slice(0, 12)}`;
}

/* ------------------------------------------------------------------ *
 * Synthetic fixtures (plan §2)
 *
 * Deterministic ids, no real PII, non-deliverable email domains, and NO device
 * tokens on any member.
 * ------------------------------------------------------------------ */

/** RFC 2606 reserved TLD — cannot resolve, cannot deliver. */
const MAIL_DOMAIN = "sr-verify.invalid";

export const FIXTURE_DATES = Object.freeze({
  sundayPublished: "2026-08-02",
  sundayDraft: "2026-08-09",
  sundayLegacy: "2026-08-16",
  sundayDangling: "2026-08-23",
  sundayVacant: "2026-08-30",
  saturdayPublished: "2026-08-01",
  saturdayDraft: "2026-08-08",
  saturdayLegacy: "2026-08-15",
  specialPublished: "2026-09-12",
  specialDraft: "2026-09-19",
  specialLegacy: "2026-09-26",
});

/** Member id that is deliberately NEVER created — the dangling-reference case. */
export const DANGLING_MEMBER_ID = "srv.member.absent";

export const FIXTURE_REQUEST_IDS = Object.freeze({
  sundayPublished: "srv-request-sunday-published",
  orphan: "srv-request-orphan-receipt",
  retired: "srv-request-retired-receipt",
});

function member({ id, name, alias, role, extra = {} }) {
  return {
    _id: id,
    _type: "teamMembers",
    member_name: name,
    alias,
    // Non-deliverable domain; branch allowlists exclude it; no device tokens.
    email: `${id.replace(/\./g, "-")}@${MAIL_DOMAIN}`,
    role,
    slug: { _type: "slug", current: id.replace(/\./g, "-") },
    published: true,
    ...extra,
  };
}

function memberRef(id, keySeed) {
  return { _type: "reference", _ref: id, _key: fixtureKey("ref", keySeed, id) };
}

function weakMemberRef(id, keySeed) {
  return { _type: "reference", _ref: id, _weak: true, _key: fixtureKey("ref", keySeed, id) };
}

function instrumentSlot(docId, instrument, personId, { weak = false } = {}) {
  return {
    _type: "instrument_slot",
    _key: fixtureKey("instrument", docId, instrument, personId),
    instrument,
    person: weak
      ? { _type: "reference", _ref: personId, _weak: true }
      : { _type: "reference", _ref: personId },
  };
}

function fohSlot(docId, role, personId) {
  return {
    _type: "foh_slot",
    _key: fixtureKey("foh", docId, role, personId),
    role,
    person: { _type: "reference", _ref: personId },
  };
}

function setlistSong(docId, songId, playKey) {
  return {
    _type: "setlist_song",
    _key: fixtureKey("song", docId, songId),
    song: { _type: "reference", _ref: songId },
    play_key: playKey,
  };
}

function proposalSong(docId, songId, playKey) {
  return {
    _type: "proposal_song",
    _key: fixtureKey("proposalSong", docId, songId),
    song: { _type: "reference", _ref: songId },
    play_key: playKey,
  };
}

/** All five member-referencing seats, filled from the five seat fixtures. */
function fullSeats(docId) {
  return {
    Lead: [memberRef("srv.member.lead", `${docId}:lead`)],
    BGVs: [memberRef("srv.member.bgv", `${docId}:bgv`)],
    Chorus: [memberRef("srv.member.chorus", `${docId}:chorus`)],
    instruments: [instrumentSlot(docId, "Guitarra", "srv.member.instrument")],
    foh_team: [fohSlot(docId, "Audio", "srv.member.foh")],
  };
}

/**
 * Build the complete deterministic fixture set. `now` only fills audit
 * timestamps; ids, `_key`s, and every business field are independent of it, so
 * two runs produce documents that differ in nothing but those timestamps.
 */
export function buildFixtureDocuments({ now }) {
  const docs = [];

  /* --- Members: the five assignment paths + admin + edge cases ----- */
  docs.push(
    member({
      id: "srv.member.admin",
      name: "SR Verificación Admin",
      alias: "SR Admin",
      role: "admin",
      // passwordHash is injected at apply time from ADMIN_HASH_ENV; it is never
      // part of this (committed) fixture definition.
      extra: { memberType: ["Lead"] },
    }),
    member({ id: "srv.member.lead", name: "SR Lead", alias: "SR Lead", role: "member", extra: { memberType: ["Lead"] } }),
    member({ id: "srv.member.bgv", name: "SR BGV", alias: "SR BGV", role: "member", extra: { memberType: ["BGV"] } }),
    member({ id: "srv.member.chorus", name: "SR Coro", alias: "SR Coro", role: "member", extra: { memberType: ["Coro"] } }),
    member({
      id: "srv.member.instrument",
      name: "SR Instrumento",
      alias: "SR Instr",
      role: "member",
      extra: { memberType: ["Guitarra"] },
    }),
    member({ id: "srv.member.foh", name: "SR FOH", alias: "SR FOH", role: "member", extra: { memberType: ["Audio"] } }),
    member({
      id: "srv.member.unavailable",
      name: "SR No Disponible",
      alias: "SR NoDisp",
      role: "member",
      extra: {
        memberType: ["Lead"],
        unavailableDates: [FIXTURE_DATES.sundayPublished, FIXTURE_DATES.saturdayPublished],
        unavailabilityNotes: [
          {
            _type: "object",
            _key: fixtureKey("unavail", "srv.member.unavailable", FIXTURE_DATES.sundayPublished),
            date: FIXTURE_DATES.sundayPublished,
            note: "Fixture: no disponible",
          },
        ],
      },
    }),
    member({ id: "srv.member.disabled", name: "SR Inactivo", alias: "SR Inact", role: "member", extra: { disabled: true } }),
  );

  /* --- Songs (setlist/proposal targets) ---------------------------- */
  for (const [n, title] of [
    ["a", "SR Canción A"],
    ["b", "SR Canción B"],
    ["c", "SR Canción C"],
  ]) {
    docs.push({
      _id: `srv.song.${n}`,
      _type: "post",
      title,
      slug: { _type: "slug", current: `srv-song-${n}` },
      key: "C",
    });
  }

  /* --- Roles: draft / published / legacy-missing-published --------- */
  const sundayPublished = "srv.role.sunday.published";
  docs.push({
    _id: sundayPublished,
    _type: "sunday_role",
    week: FIXTURE_DATES.sundayPublished,
    published: true,
    ...fullSeats(sundayPublished),
  });

  const sundayDraft = "srv.role.sunday.draft";
  docs.push({
    _id: sundayDraft,
    _type: "sunday_role",
    week: FIXTURE_DATES.sundayDraft,
    published: false,
    ...fullSeats(sundayDraft),
  });

  const sundayLegacy = "srv.role.sunday.legacy";
  docs.push({
    // `published` deliberately ABSENT — the legacy pre-draft/publish shape.
    _id: sundayLegacy,
    _type: "sunday_role",
    week: FIXTURE_DATES.sundayLegacy,
    ...fullSeats(sundayLegacy),
  });

  const sundayDangling = "srv.role.sunday.dangling";
  docs.push({
    _id: sundayDangling,
    _type: "sunday_role",
    week: FIXTURE_DATES.sundayDangling,
    published: true,
    // Weak refs so the transaction commits while still pointing at nothing.
    Lead: [weakMemberRef(DANGLING_MEMBER_ID, `${sundayDangling}:lead`)],
    BGVs: [],
    Chorus: [],
    instruments: [instrumentSlot(sundayDangling, "Bajo", DANGLING_MEMBER_ID, { weak: true })],
    foh_team: [],
  });

  const saturdayPublished = "srv.role.saturday.published";
  docs.push({
    _id: saturdayPublished,
    _type: "saturday_role",
    week: FIXTURE_DATES.saturdayPublished,
    published: true,
    ...fullSeats(saturdayPublished),
  });

  const saturdayDraft = "srv.role.saturday.draft";
  docs.push({
    _id: saturdayDraft,
    _type: "saturday_role",
    week: FIXTURE_DATES.saturdayDraft,
    published: false,
    ...fullSeats(saturdayDraft),
  });

  const saturdayLegacy = "srv.role.saturday.legacy";
  docs.push({
    _id: saturdayLegacy,
    _type: "saturday_role",
    week: FIXTURE_DATES.saturdayLegacy,
    ...fullSeats(saturdayLegacy),
  });

  const specialPublished = "srv.role.special.published";
  docs.push({
    _id: specialPublished,
    _type: "special_role",
    date: FIXTURE_DATES.specialPublished,
    service_name: "SR Servicio Especial Publicado",
    published: true,
    ...fullSeats(specialPublished),
  });

  const specialDraft = "srv.role.special.draft";
  docs.push({
    _id: specialDraft,
    _type: "special_role",
    date: FIXTURE_DATES.specialDraft,
    service_name: "SR Servicio Especial Borrador",
    published: false,
    ...fullSeats(specialDraft),
  });

  const specialLegacy = "srv.role.special.legacy";
  docs.push({
    _id: specialLegacy,
    _type: "special_role",
    date: FIXTURE_DATES.specialLegacy,
    service_name: "SR Servicio Especial Legado",
    ...fullSeats(specialLegacy),
  });

  /* --- Weekend target locks (§1) ----------------------------------- */
  // Claimed locks for the two published weekend targets.
  for (const [roleId, roleType, date] of [
    [sundayPublished, "sunday_role", FIXTURE_DATES.sundayPublished],
    [saturdayPublished, "saturday_role", FIXTURE_DATES.saturdayPublished],
  ]) {
    docs.push({
      _id: mirrorRoleTargetLockId(`${roleType}:${date}`),
      _type: "roleTargetLock",
      targetKey: `${roleType}:${date}`,
      state: "claimed",
      roleId,
      roleType,
      date,
      claimNonce: fixtureKey("claim", roleId),
      generation: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  // Vacant lock on a target with NO role — the "vacant reclaim" case.
  docs.push({
    _id: mirrorRoleTargetLockId(`sunday_role:${FIXTURE_DATES.sundayVacant}`),
    _type: "roleTargetLock",
    targetKey: `sunday_role:${FIXTURE_DATES.sundayVacant}`,
    state: "vacant",
    roleType: "sunday_role",
    date: FIXTURE_DATES.sundayVacant,
    generation: 2,
    createdAt: now,
    updatedAt: now,
  });
  // `srv.role.sunday.legacy` deliberately has NO lock — the legacy-bootstrap case.

  /* --- Role creation receipts (§2) --------------------------------- */
  const sundayPublishedPayload = {
    _type: "sunday_role",
    date: FIXTURE_DATES.sundayPublished,
    published: true,
    leads: ["srv.member.lead"],
    bgvs: ["srv.member.bgv"],
    chorus: ["srv.member.chorus"],
    instruments: [{ instrument: "Guitarra", personId: "srv.member.instrument" }],
    foh: [{ role: "Audio", personId: "srv.member.foh" }],
  };
  docs.push({
    _id: mirrorReceiptId(FIXTURE_REQUEST_IDS.sundayPublished),
    _type: "roleCreationReceipt",
    requestId: FIXTURE_REQUEST_IDS.sundayPublished,
    fingerprint: mirrorPayloadFingerprint(sundayPublishedPayload),
    roleId: sundayPublished,
    roleType: "sunday_role",
    targetIdentity: `sunday_role:${FIXTURE_DATES.sundayPublished}`,
    state: "committed",
    createdAt: now,
    updatedAt: now,
  });
  // Orphan receipt: committed, but its role id resolves to nothing.
  docs.push({
    _id: mirrorReceiptId(FIXTURE_REQUEST_IDS.orphan),
    _type: "roleCreationReceipt",
    requestId: FIXTURE_REQUEST_IDS.orphan,
    fingerprint: mirrorPayloadFingerprint({ ...sundayPublishedPayload, date: FIXTURE_DATES.sundayVacant }),
    roleId: "srv.role.sunday.neverCreated",
    roleType: "sunday_role",
    targetIdentity: `sunday_role:${FIXTURE_DATES.sundayVacant}`,
    state: "committed",
    createdAt: now,
    updatedAt: now,
  });
  // Retired receipt: the durable tombstone of a deleted role.
  docs.push({
    _id: mirrorReceiptId(FIXTURE_REQUEST_IDS.retired),
    _type: "roleCreationReceipt",
    requestId: FIXTURE_REQUEST_IDS.retired,
    fingerprint: mirrorPayloadFingerprint({ ...sundayPublishedPayload, date: FIXTURE_DATES.sundayDangling }),
    roleId: "srv.role.sunday.deleted",
    roleType: "sunday_role",
    targetIdentity: `sunday_role:${FIXTURE_DATES.sundayDangling}`,
    state: "role_deleted",
    createdAt: now,
    updatedAt: now,
  });

  /* --- Setlists: empty / incomplete / ready ------------------------ */
  const setlistEmpty = "srv.setlist.sunday.empty";
  docs.push({
    _id: setlistEmpty,
    _type: "featuredSongs",
    week: FIXTURE_DATES.sundayPublished,
    songs: [],
  });
  const setlistReady = "srv.setlist.sunday.ready";
  docs.push({
    _id: setlistReady,
    _type: "featuredSongs",
    week: FIXTURE_DATES.sundayDraft,
    songs: [
      setlistSong(setlistReady, "srv.song.a", "C"),
      setlistSong(setlistReady, "srv.song.b", "D"),
      setlistSong(setlistReady, "srv.song.c", "G"),
    ],
  });
  const setlistIncomplete = "srv.setlist.saturday.incomplete";
  docs.push({
    _id: setlistIncomplete,
    _type: "saturdarSongs", // deliberate stored typo — never "corrected"
    week: FIXTURE_DATES.saturdayPublished,
    songs: [setlistSong(setlistIncomplete, "srv.song.a", "C")],
  });

  /* --- Proposals: pending / changes / approved / legacy-approved --- */
  const proposalPending = "srv.proposal.pending";
  docs.push({
    _id: proposalPending,
    _type: "setlistProposal",
    service_type: "sunday",
    service_ref: { _type: "reference", _ref: sundayPublished },
    service_date: FIXTURE_DATES.sundayPublished,
    lead: { _type: "reference", _ref: "srv.member.lead" },
    submitted_by: { _type: "reference", _ref: "srv.member.lead" },
    contributors: [
      {
        _type: "contributor",
        _key: fixtureKey("contributor", proposalPending, "srv.member.lead"),
        person: { _type: "reference", _ref: "srv.member.lead" },
      },
    ],
    songs: [proposalSong(proposalPending, "srv.song.a", "C")],
    status: "pending",
    submitted_at: now,
    last_edited_at: now,
    last_edited_by: { _type: "reference", _ref: "srv.member.lead" },
  });

  const proposalChanges = "srv.proposal.changesRequested";
  docs.push({
    _id: proposalChanges,
    _type: "setlistProposal",
    service_type: "saturday",
    service_ref: { _type: "reference", _ref: saturdayPublished },
    service_date: FIXTURE_DATES.saturdayPublished,
    lead: { _type: "reference", _ref: "srv.member.lead" },
    submitted_by: { _type: "reference", _ref: "srv.member.lead" },
    contributors: [],
    songs: [proposalSong(proposalChanges, "srv.song.b", "D")],
    status: "changes_requested",
    submitted_at: now,
    reviewed_at: now,
    admin_notes: "Fixture: cambios solicitados",
  });

  const proposalApproved = "srv.proposal.approved";
  docs.push({
    _id: proposalApproved,
    _type: "setlistProposal",
    service_type: "sunday",
    service_ref: { _type: "reference", _ref: sundayDraft },
    service_date: FIXTURE_DATES.sundayDraft,
    lead: { _type: "reference", _ref: "srv.member.lead" },
    submitted_by: { _type: "reference", _ref: "srv.member.lead" },
    contributors: [],
    songs: [proposalSong(proposalApproved, "srv.song.c", "G")],
    status: "approved",
    submitted_at: now,
    reviewed_at: now,
    // Provisional forward-compatible marker of a verifiable approval. A2 step 6
    // introduces the real approval-receipt document; this field distinguishes
    // "approved with a receipt" from the legacy fixture below until then.
    approvalReceiptId: `proposalApproval.${fixtureKey("approval", proposalApproved)}`,
  });

  const proposalLegacyApproved = "srv.proposal.legacyApproved";
  docs.push({
    // Approved with NO approval receipt at all -> `legacy_approval_unverified`.
    _id: proposalLegacyApproved,
    _type: "setlistProposal",
    service_type: "special",
    service_ref: { _type: "reference", _ref: specialPublished },
    service_date: FIXTURE_DATES.specialPublished,
    lead: { _type: "reference", _ref: "srv.member.lead" },
    submitted_by: { _type: "reference", _ref: "srv.member.lead" },
    contributors: [],
    songs: [proposalSong(proposalLegacyApproved, "srv.song.a", "C")],
    status: "approved",
    submitted_at: now,
  });

  return docs;
}

/** Sorted deterministic ids of every fixture document. */
export function fixtureIds({ now = "2026-01-01T00:00:00.000Z" } = {}) {
  return buildFixtureDocuments({ now })
    .map((d) => d._id)
    .sort(compareStrings);
}

/**
 * The reset allowlist: the exact deterministic fixture ids, and nothing else.
 * Discovery-based or `*[_type == ...]` deletion is never permitted, so reset
 * always intersects its candidate list with this set.
 */
export function isDeletableFixtureId(id) {
  if (typeof id !== "string") return false;
  if (INFRASTRUCTURE_IDS.includes(id)) return false;
  return fixtureIds().includes(id);
}

/**
 * Filter any candidate id list down to deletable fixtures. Returns both the
 * allowed ids and the refused ones, so a caller can report (never silently drop)
 * anything that was proposed but is not a known fixture.
 */
export function filterDeletableIds(candidateIds = []) {
  const allowed = [];
  const refused = [];
  for (const id of candidateIds) (isDeletableFixtureId(id) ? allowed : refused).push(id);
  return { allowed, refused };
}

/* ------------------------------------------------------------------ *
 * Post-apply exactness
 * ------------------------------------------------------------------ */

/**
 * Compare the re-queried dataset state against the expected fixture set. Any
 * missing id, wrong `_type`, or unexpected extra `srv.*` document is a failure:
 * "close enough" is never accepted after an apply.
 */
export function verifyFixtureState({ expected, actual }) {
  const failures = [];
  const actualById = new Map();
  for (const doc of actual ?? []) actualById.set(doc._id, doc);

  for (const exp of expected ?? []) {
    const got = actualById.get(exp._id);
    if (!got) {
      failures.push({ code: "missing_document", id: exp._id });
      continue;
    }
    if (got._type !== exp._type) {
      failures.push({ code: "wrong_type", id: exp._id, expected: exp._type, actual: got._type });
    }
  }

  const expectedIds = new Set((expected ?? []).map((d) => d._id));
  for (const doc of actual ?? []) {
    if (doc._id.startsWith(FIXTURE_ID_PREFIX) && !expectedIds.has(doc._id)) {
      failures.push({ code: "unexpected_document", id: doc._id });
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Reset is exact only when zero fixture documents remain. */
export function verifyResetState({ remaining }) {
  const leftovers = (remaining ?? []).filter((d) => typeof d?._id === "string" && d._id.startsWith(FIXTURE_ID_PREFIX));
  return {
    ok: leftovers.length === 0,
    failures: leftovers.map((d) => ({ code: "fixture_not_removed", id: d._id })),
  };
}

/* ------------------------------------------------------------------ *
 * Backups
 * ------------------------------------------------------------------ */

/**
 * Timestamped backup filename inside the gitignored backup directory. Backups
 * capture every existing same-id document BEFORE any mutation.
 */
export function backupFileName({ kind, now }) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_DIR}/${stamp}-${kind}.json`;
}

/** The backup envelope. Contains no secrets — ids and document bodies only. */
export function buildBackupEnvelope({ kind, now, projectId, dataset, owner, documents }) {
  return {
    kind,
    createdAt: new Date(now).toISOString(),
    projectId,
    dataset,
    leaseOwner: owner,
    documentCount: documents.length,
    documents,
  };
}
