/**
 * set-password.ts
 *
 * Sets a bcrypt-hashed password on a Sanity teamMembers document.
 * Run this to bootstrap the first admin or reset any member's password.
 *
 * Usage:
 *   MEMBER_ID=<sanity-doc-id> PASSWORD=<plaintext> npx tsx scripts/set-password.ts
 *
 * Required env vars (loaded from .env.local automatically):
 *   NEXT_PUBLIC_SANITY_PROJECT_ID
 *   NEXT_PUBLIC_SANITY_DATASET
 *   SANITY_WRITE_TOKEN
 */

import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

// ─── Main ─────────────────────────────────────────────────────────────────────

const memberId = process.env.MEMBER_ID;
const plaintext = process.env.PASSWORD;

if (!memberId || !plaintext) {
  console.error("Usage: MEMBER_ID=<id> PASSWORD=<plaintext> npx tsx scripts/set-password.ts");
  process.exit(1);
}
if (plaintext.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!;
const dataset   = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
const token     = process.env.SANITY_WRITE_TOKEN!;
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? "2024-07-23";

if (!projectId || !token) {
  console.error("Missing NEXT_PUBLIC_SANITY_PROJECT_ID or SANITY_WRITE_TOKEN in .env.local");
  process.exit(1);
}

(async () => {
  console.log(`Hashing password for member: ${memberId}`);
  const hash = await bcrypt.hash(plaintext, 12);

  const url = `https://${projectId}.api.sanity.io/v${apiVersion}/data/mutate/${dataset}`;
  const body = JSON.stringify({
    mutations: [{ patch: { id: memberId, set: { passwordHash: hash } } }],
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Sanity error:", text);
    process.exit(1);
  }

  console.log("Password set successfully.");
})();
