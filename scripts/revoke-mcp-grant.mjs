/**
 * Revoke an MCP OAuth grant (spec O9). Grant documents are hidden and
 * read-only in `/studio` (`studioProtection.ts`), so this is the ONLY way to
 * revoke one without a deployment. Effective within 30 s — the MCP route's
 * grant cache TTL (`GRANT_CACHE_TTL_MS`, `app/mcp/oauth/grantStore.ts`).
 *
 * DRY RUN BY DEFAULT.
 *   node --env-file=.env.local scripts/revoke-mcp-grant.mjs
 *     … lists every grant (id, sub, origin, timestamps, revoked state), writes nothing.
 *   node --env-file=.env.local scripts/revoke-mcp-grant.mjs --id mcpOauthGrant.<uuid>
 *     … shows exactly what `--id --apply` would revoke, writes nothing.
 *   node --env-file=.env.local scripts/revoke-mcp-grant.mjs --all
 *     … shows exactly what `--all --apply` would revoke, writes nothing.
 *   … add --apply to write. --reason <text> defaults to "manual".
 *
 * ─── Why this duplicates app/mcp/oauth/documentTypes.ts instead of importing it ──
 *
 * That module is TypeScript with zero imports (controller ruling R10), so the
 * two Sanity schema files can import it straight into the embedded Studio
 * bundle. This script runs under plain `node` (per the exemplar,
 * `scripts/grant-kids-manager.mjs`), which cannot import a bare `.ts` file, so
 * the type name, the id prefix and the field list are copied below as literal
 * constants. `scripts/__tests__/revokeMcpGrant.test.ts` is TypeScript and
 * imports BOTH modules to assert they agree, so a field rename in
 * `documentTypes.ts` fails that test instead of silently drifting here.
 *
 * ─── Why the revocation patch never uses ifRevisionId ────────────────────────
 *
 * A revocation must WIN a race against a concurrent refresh-token rotation,
 * never lose to it: `grantStore.ts`'s own `revokeGrant` is unconditional for
 * exactly this reason (see its header comment). Guarding this script's patch
 * with a revision check would let an in-flight rotation's write "confirm" a
 * session Frank just decided to kill, and the rotation's own revision check
 * (`ifRevisionId`, in `rotateRefresh`) is what then correctly refuses instead.
 */
import { createClient } from "@sanity/client";
import { pathToFileURL } from "node:url";

/** Mirrors `MCP_OAUTH_GRANT_TYPE` in app/mcp/oauth/documentTypes.ts. */
export const GRANT_TYPE = "mcpOauthGrant";
/** Mirrors `GRANT_ID_PREFIX` there. */
export const GRANT_ID_PREFIX = "mcpOauthGrant.";
/** Mirrors `GRANT_FIELDS` there, order included. */
export const GRANT_FIELDS = [
  "sub",
  "clientHash",
  "origin",
  "createdAt",
  "lastRefreshAt",
  "currentRefreshJti",
  "revoked",
  "revokedAt",
  "revokedReason",
];

export const DEFAULT_REASON = "manual";

const USAGE = "usage: revoke-mcp-grant.mjs [--id <mcpOauthGrant.id> | --all] [--reason <text>] [--apply]";

/**
 * Parse argv into `{ id, all, apply, reason }`, or throw a descriptive
 * `Error`. Pure — no I/O, no `process` access beyond the array passed in.
 */
export function parseArgs(argv) {
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };

  const id = arg("--id");
  const all = argv.includes("--all");
  const apply = argv.includes("--apply");
  const reason = arg("--reason") ?? DEFAULT_REASON;

  if (id !== null && all) throw new Error("--id and --all are mutually exclusive");
  if (apply && id === null && !all) throw new Error("--apply needs --id or --all");
  if (id !== null && !id.startsWith(GRANT_ID_PREFIX)) {
    throw new Error(`--id must start with "${GRANT_ID_PREFIX}"`);
  }

  return { id, all, apply, reason };
}

/**
 * Which of the fetched `grants` a parsed `{ id, all }` selects for
 * revocation. An already-revoked grant is always skipped — by `--all`
 * implicitly, and by `--id` explicitly — so an existing `revokedAt` is never
 * overwritten. An `--id` naming no fetched grant selects nothing; the caller
 * reports "no such grant" separately. Pure — no I/O.
 */
export function selectGrantsToRevoke(grants, { id, all }) {
  if (all) return grants.filter((g) => g.revoked !== true);
  if (id) {
    const grant = grants.find((g) => g._id === id);
    return grant && grant.revoked !== true ? [grant] : [];
  }
  return [];
}

/**
 * The `set` of a revocation — exactly `revoked`/`revokedAt`/`revokedReason`,
 * mirroring `buildRevocationPatch` in `app/mcp/oauth/grantDocument.ts`. No
 * `ifRevisionId`: see the header note above. Pure.
 */
export function buildRevocationPatch({ reason, at }) {
  return { revoked: true, revokedAt: at, revokedReason: reason };
}

function formatGrantLine(g) {
  const state = g.revoked ? `revoked (${g.revokedReason ?? "?"} @ ${g.revokedAt ?? "?"})` : "live";
  return (
    `  ${g._id}\n` +
    `    sub=${g.sub}  origin=${g.origin}\n` +
    `    created=${g.createdAt ?? "?"}  lastRefresh=${g.lastRefreshAt ?? "?"}  ${state}`
  );
}

async function main() {
  let config;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    console.error(USAGE);
    process.exit(2);
  }

  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;
  const token = process.env.SANITY_WRITE_TOKEN;
  if (!projectId || !dataset || !token) {
    console.error("missing NEXT_PUBLIC_SANITY_PROJECT_ID / _DATASET / SANITY_WRITE_TOKEN");
    process.exit(2);
  }

  const client = createClient({
    projectId,
    dataset,
    apiVersion: process.env.NEXT_PUBLIC_SANITY_API_VERSION || "2024-01-01",
    token,
    useCdn: false,
  });

  console.log(`\nDataset: ${dataset}   Mode: ${config.apply ? "APPLY (writes)" : "DRY RUN"}\n`);

  // Never fetches clientHash or currentRefreshJti — neither is secret, but
  // neither helps the operator, so the output stays minimal.
  const grants = await client.fetch(
    `*[_type == $type]{ _id, sub, origin, createdAt, lastRefreshAt, revoked, revokedAt, revokedReason } | order(createdAt desc)`,
    { type: GRANT_TYPE },
  );

  if (config.id === null && !config.all) {
    console.log(`${grants.length} grant(s):\n`);
    for (const g of grants) console.log(formatGrantLine(g));
    console.log(`\nDRY RUN — nothing written.\n`);
    return;
  }

  if (config.id !== null && !grants.some((g) => g._id === config.id)) {
    console.error(`No ${GRANT_TYPE} document with _id "${config.id}".`);
    process.exit(1);
  }

  const toRevoke = selectGrantsToRevoke(grants, config);
  console.log(`${config.apply ? "Revoking" : "Would revoke"} ${toRevoke.length} grant(s):\n`);
  for (const g of toRevoke) console.log(formatGrantLine(g));

  if (!config.apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write.\n`);
    return;
  }

  if (!toRevoke.length) {
    console.log(`\nNothing to revoke.\n`);
    return;
  }

  const at = new Date().toISOString();
  const patch = buildRevocationPatch({ reason: config.reason, at });
  let txn = client.transaction();
  for (const g of toRevoke) txn = txn.patch(g._id, (p) => p.set(patch));
  await txn.commit();

  console.log(
    `\n✅ Revoked ${toRevoke.length} grant(s) (reason: ${config.reason}). ` +
      `Effective within 30 s — the MCP route's grant cache TTL.\n`,
  );
}

// IMPORTING THIS MODULE MUST BE PURE (same discipline as colour-inventory.mjs).
// `scripts/__tests__/revokeMcpGrant.test.ts` imports this file to exercise the
// exported functions above, and must not create a Sanity client, read env vars
// or touch argv just by doing so.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
