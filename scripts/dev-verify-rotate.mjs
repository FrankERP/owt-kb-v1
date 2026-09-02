// Rotate the «Verificador (bot)» password in ONE command.
//
//   node scripts/dev-verify-rotate.mjs                      # dry run: shows the plan, writes nothing
//   node scripts/dev-verify-rotate.mjs --apply              # writes Sanity, then .env.local
//   node scripts/dev-verify-rotate.mjs --apply --email a@b  # first-time seed, or to change the address
//   node scripts/dev-verify-rotate.mjs --apply --show       # also print the password once, for a manager
//
// Why this exists: the manual sequence is five steps across two files and a
// dashboard, and getting the ORDER wrong silently breaks the runner. On
// 2026-09-01 the credentials were written inside a worktree and destroyed with
// it (docs/DEV_VERIFY.md); recovery meant rediscovering the whole sequence
// under time pressure. This is that sequence, in the safe order.
//
// The safe order is Sanity FIRST, `.env.local` second. The reverse leaves the
// file holding a password whose hash never reached the dataset — the runner
// then fails to sign in and the failure looks like a bug in the runner. If the
// Sanity write fails, nothing local has changed and the old password still
// works. If the LOCAL write fails after Sanity succeeded, the new password is
// printed to stderr rather than lost, because at that point it is the only
// copy of a value the dataset already trusts.
//
// The password is minted here, never typed and never passed as an argument, so
// it does not reach shell history. `.env.local` is backed up (mode 600) before
// it is rewritten.

import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const STORAGE_STATE = path.join(REPO_ROOT, "playwright/.dev-verify-storageState.json");
const KEYS = ["DEV_VERIFY_EMAIL", "DEV_VERIFY_PASSWORD", "DEV_VERIFY_PASSWORD_HASH"];

const APPLY = process.argv.includes("--apply");
const SHOW = process.argv.includes("--show");
const emailArg = (() => {
  const i = process.argv.indexOf("--email");
  return i === -1 ? undefined : process.argv[i + 1];
})();

const die = (msg) => { console.error(`dev-verify-rotate: ${msg}`); process.exit(2); };

// The symlink in a worktree must not be replaced by a regular file — resolve to
// the primary checkout's real file and write THAT.
const envPath = (() => {
  const p = path.join(REPO_ROOT, ".env.local");
  if (!existsSync(p)) die(".env.local not found. It lives in the primary checkout; a worktree symlinks to it.");
  return realpathSync(p);
})();

const raw = readFileSync(envPath, "utf8");
const readKey = (k) => raw.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");

const email = emailArg ?? readKey("DEV_VERIFY_EMAIL");
if (!email) die("no DEV_VERIFY_EMAIL in .env.local and none given. Pass --email <address>.\n" +
  "  Use an address with NO Google account: SSO signs in by email lookup too, so a Google\n" +
  "  identity on it would be a second door to the same admin (docs/SECRETS.md).");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die(`--email does not look like an address: ${email}`);

// base64url: 43 chars, no quoting hazards in a dotenv file, no shell metacharacters.
const password = randomBytes(32).toString("base64url");
const bcrypt = (await import("bcryptjs")).default;
const passwordHash = bcrypt.hashSync(password, 10);

const childEnv = { ...process.env };
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) childEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
// The NEW hash, not the file's stale one. Passing it in the child's environment
// avoids a temp env file, so the value never touches a second path on disk.
childEnv.DEV_VERIFY_EMAIL = email;
childEnv.DEV_VERIFY_PASSWORD_HASH = passwordHash;

for (const v of ["NEXT_PUBLIC_SANITY_PROJECT_ID", "NEXT_PUBLIC_SANITY_DATASET", "SANITY_WRITE_TOKEN"]) {
  if (!childEnv[v]) die(`${v} missing from ${envPath} — the seed cannot reach the dataset.`);
}

console.log(`dataset : ${childEnv.NEXT_PUBLIC_SANITY_DATASET} (project ${childEnv.NEXT_PUBLIC_SANITY_PROJECT_ID})`);
console.log(`email   : ${email}`);
console.log(`env file: ${envPath}`);
console.log(`password: minted, 43 chars — ${SHOW ? "printed below" : "not printed; read it from .env.local"}\n`);

const seed = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts/dev-verify-seed.mjs"), ...(APPLY ? ["--apply"] : [])],
  { cwd: REPO_ROOT, env: childEnv, stdio: "inherit" });
if (seed.status !== 0) die(`seed exited ${seed.status}. Nothing was written to ${envPath}; the old password still works.`);

if (!APPLY) {
  console.log(`\nDry run. Sanity untouched, ${path.basename(envPath)} untouched, password discarded.`);
  console.log("Re-run with --apply to rotate for real.");
  process.exit(0);
}

// Sanity now trusts the new hash. From here the password must reach the file or
// the operator, or it is gone.
try {
  const backup = `${envPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(envPath, backup);
  chmodSync(backup, 0o600);

  const next = KEYS.reduce((acc, k) => {
    const value = k === "DEV_VERIFY_EMAIL" ? email : k === "DEV_VERIFY_PASSWORD" ? password : passwordHash;
    const line = `${k}=${value}`;
    return new RegExp(`^${k}=.*$`, "m").test(acc) ? acc.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${acc.replace(/\n*$/, "\n")}${line}\n`;
  }, raw);

  writeFileSync(envPath, next, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  if (existsSync(STORAGE_STATE)) rmSync(STORAGE_STATE);

  console.log(`\nRotated. ${KEYS.join(", ")} written to ${envPath} (backup: ${path.basename(backup)}).`);
  if (existsSync(STORAGE_STATE)) console.log("Stale storage state left in place — delete it by hand.");
  else console.log("Stale sign-in state cleared.");
  if (SHOW) console.log(`\npassword: ${password}`);
  console.log("\nVerify:  npx tsx --env-file=.env.local scripts/dev-verify.ts --route / --text");
} catch (err) {
  console.error(`\n!! Sanity WAS updated but ${envPath} was not: ${err.message}`);
  console.error("!! The password below is the only copy of a value the dataset already trusts.");
  console.error(`!! Save it now, then put it in ${envPath} as DEV_VERIFY_PASSWORD.\n`);
  console.error(password);
  process.exit(1);
}
