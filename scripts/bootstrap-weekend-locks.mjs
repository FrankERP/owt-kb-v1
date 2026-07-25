// One-off: create the claimed `roleTargetLock` for each existing weekend service.
//
// Why: A2 §1 serializes every Sunday/Saturday writer on a weekend target lock, and
// Plan B's readiness treats a missing lock as a blocking integrity issue. Roles that
// predate A2 have no lock, so without this they would all render "Revisar datos" and
// drop out of the ready-to-publish count. Making the issue non-blocking instead would
// be worse: A2's publish-ready helper ALSO refuses a lockless weekend target, so the
// card would claim ready and then fail with a 409.
//
// Special services take no weekend lock (they serialize on their own revision), so
// they are never touched.
//
// Safety: dry-run by default; `--apply` needs explicit consent. It refuses any target
// it cannot prove safe — a duplicate target, a draft overlay, a malformed role, or an
// existing lock. The lock is created with `create` at its deterministic id, so a
// concurrent create loses instead of overwriting, and each create is paired with a
// revision-asserting no-op patch on the role's own unchanged target field, so a role
// edited mid-run aborts that target.
//
//   node --env-file=.env.local scripts/bootstrap-weekend-locks.mjs
//   node --env-file=.env.local scripts/bootstrap-weekend-locks.mjs --apply
import { createClient } from "next-sanity";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { mirrorRoleTargetLockId } from "./lib/sr-verification.mjs";

const KNOWN_FLAGS = new Set(["--apply"]);
for (const a of process.argv.slice(2)) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag "${a}". Refusing — a typo must never read as a dry run.`);
    process.exit(1);
  }
}
const apply = process.argv.slice(2).includes("--apply");

const WEEKEND_TYPES = ["sunday_role", "saturday_role"];
const SEAT_ARRAYS = ["Lead", "BGVs", "Chorus", "instruments", "foh_team"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BACKUP_DIR = process.env.SR_BOOTSTRAP_BACKUP_DIR || ".backfill-backups";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-07-23";
const readToken = process.env.SANITY_API_READ_TOKEN;
const writeToken = process.env.SANITY_WRITE_TOKEN;

if (!projectId || !dataset) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID / NEXT_PUBLIC_SANITY_DATASET.");
  process.exit(1);
}

// Canonical reads use the published perspective so `drafts.*` never masquerade as
// live roles; the raw client is used only as draft-overlay evidence.
const published = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published", token: readToken });
const raw = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "raw", token: readToken });

function isValidDate(v) {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * The subset of `validateRole` that decides whether a role may OWN a target: real
 * identity, a real weekend date, and all five seat fields present as arrays. A
 * missing seat array is invalid rather than empty (it cannot be validated), which
 * is exactly what the seat-array backfill repaired.
 */
function ownershipProblems(role) {
  const problems = [];
  if (typeof role?._id !== "string" || !role._id) problems.push("identity");
  if (typeof role?._rev !== "string" || !role._rev) problems.push("revision");
  if (!WEEKEND_TYPES.includes(role?._type)) problems.push("type");
  if (!isValidDate(role?.week)) problems.push("date");
  for (const f of SEAT_ARRAYS) if (!Array.isArray(role?.[f])) problems.push(`seat:${f}`);
  return problems;
}

console.log(`bootstrap-weekend-locks`);
console.log(`  project: ${projectId}`);
console.log(`  dataset: ${dataset}`);
console.log(`  mode:    ${apply ? "APPLY (will write)" : "DRY-RUN (no write)"}\n`);

const [roles, locks, rawWeekendDrafts] = await Promise.all([
  published.fetch(
    `*[_type in $types]{ _id, _rev, _type, week, published, Lead, BGVs, Chorus, instruments, foh_team } | order(week asc)`,
    { types: WEEKEND_TYPES },
  ),
  published.fetch(`*[_type == "roleTargetLock"]{ _id, _rev, targetKey, state, roleId, generation }`),
  raw.fetch(`*[_type in $types && _id in path("drafts.**")]{ _id }`, { types: WEEKEND_TYPES }),
]);

const lockById = new Map(locks.map((l) => [l._id, l]));
const draftBaseIds = new Set(rawWeekendDrafts.map((d) => String(d._id).replace(/^drafts\./, "")));

// Group canonical roles by target key: a target owned by two roles is ambiguous and
// no lock may claim it.
const byTarget = new Map();
const malformed = [];
for (const role of roles) {
  const problems = ownershipProblems(role);
  if (problems.length) {
    malformed.push({ id: role?._id ?? "(unknown)", problems });
    continue;
  }
  const key = `${role._type}:${role.week}`;
  const list = byTarget.get(key) ?? [];
  list.push(role);
  byTarget.set(key, list);
}

const plans = [];
const refusals = [];
const already = [];

for (const [targetKey, group] of [...byTarget.entries()].sort()) {
  const lockId = mirrorRoleTargetLockId(targetKey);
  if (!lockId) {
    refusals.push(`${targetKey}: not a lockable weekend target — refusing`);
    continue;
  }
  if (group.length !== 1) {
    refusals.push(`${targetKey}: ${group.length} canonical roles own this target (${group.map((r) => r._id).join(", ")}) — ambiguous, refusing`);
    continue;
  }
  const role = group[0];
  if (draftBaseIds.has(role._id)) {
    refusals.push(`${targetKey}: ${role._id} has a drafts.* overlay — draft-conflicted identity, refusing`);
    continue;
  }
  const existing = lockById.get(lockId);
  if (existing) {
    const owned = existing.state === "claimed" && existing.roleId === role._id;
    already.push(`${targetKey}: lock ${lockId} already exists (state=${existing.state}, roleId=${existing.roleId ?? "—"})${owned ? "" : " ⚠ NOT owned by this role — leave for guarded cleanup"}`);
    continue;
  }
  plans.push({ targetKey, lockId, role });
}

if (malformed.length) {
  console.log(`  malformed roles (cannot own a target, skipped):`);
  for (const m of malformed) console.log(`    ✗ ${m.id} [${m.problems.join(",")}]`);
  console.log();
}
if (already.length) {
  console.log(`  already locked (${already.length}):`);
  for (const a of already) console.log(`    = ${a}`);
  console.log();
}
if (refusals.length) {
  console.log(`  REFUSALS (${refusals.length}):`);
  for (const r of refusals) console.log(`    ✗ ${r}`);
  console.log();
}

console.log(`  ${plans.length} weekend target(s) would get a claimed lock:`);
for (const p of plans) {
  console.log(`    + ${p.lockId}`);
  console.log(`        targetKey=${p.targetKey} roleId=${p.role._id} rev=${p.role._rev} published=${p.role.published ?? "(grandfathered)"}`);
}

if (!plans.length) {
  console.log(`\nNothing to create.`);
  process.exit(refusals.length ? 1 : 0);
}

if (!apply) {
  console.log(`\nDRY-RUN complete — no write was made.`);
  console.log(`Each lock is created at its deterministic id with \`create\` (a concurrent`);
  console.log(`create loses rather than overwriting) and guarded by its role's revision.`);
  console.log(`NOTE: the revision guard patches the role's own unchanged week field, so each`);
  console.log(`role's _rev advances by one. No assignment or publication data changes.`);
  console.log(`Re-run with --apply (requires explicit consent) to write.`);
  process.exit(0);
}

if (!writeToken) {
  console.error("\nSANITY_WRITE_TOKEN is not set — cannot write.");
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `${stamp}-weekend-locks.json`);
writeFileSync(
  backupPath,
  JSON.stringify({ createdLockIds: plans.map((p) => p.lockId), rolesBefore: plans.map((p) => p.role), locksBefore: locks }, null, 2),
);
console.log(`\n  backup:  ${backupPath}`);

const writer = createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken });
const now = new Date().toISOString();

// One transaction per target, so a single conflicted role cannot block the rest.
let created = 0;
const failures = [];
for (const p of plans) {
  const lock = {
    _id: p.lockId,
    _type: "roleTargetLock",
    targetKey: p.targetKey,
    state: "claimed",
    roleId: p.role._id, // plain string, never a strong reference — a lock outlives its role
    roleType: p.role._type,
    date: p.role.week,
    claimNonce: randomUUID(),
    generation: 0,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await writer
      .transaction()
      .create(lock)
      .patch(p.role._id, (patch) => patch.ifRevisionId(p.role._rev).set({ week: p.role.week }))
      .commit();
    created += 1;
    console.log(`  ✓ ${p.lockId}`);
  } catch (err) {
    failures.push(`${p.lockId}: ${err.message}`);
    console.error(`  ✗ ${p.lockId}: ${err.message}`);
  }
}

// Re-query and prove each intended lock exists, is claimed, and owns its role.
const after = await published.fetch(
  `*[_type == "roleTargetLock" && _id in $ids]{ _id, targetKey, state, roleId, generation }`,
  { ids: plans.map((p) => p.lockId) },
);
const afterById = new Map(after.map((l) => [l._id, l]));
let verified = 0;
for (const p of plans) {
  const l = afterById.get(p.lockId);
  if (l && l.state === "claimed" && l.roleId === p.role._id && l.targetKey === p.targetKey) verified += 1;
  else if (!failures.some((f) => f.startsWith(p.lockId))) console.error(`  ✗ ${p.lockId}: not verified (${JSON.stringify(l ?? null)})`);
}

console.log(`\ncreated ${created}/${plans.length}, verified ${verified}/${plans.length}`);
if (failures.length) {
  console.error(`${failures.length} target(s) failed — re-run the dry run to refetch revisions.`);
}
process.exit(verified === plans.length && !failures.length ? 0 : 1);
