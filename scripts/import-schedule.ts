/**
 * import-schedule.ts
 *
 * Reads the latest run from worship_schedule_history.json and upserts
 * sunday_role / saturday_role documents into Sanity.
 *
 * Only patches Lead, BGVs, and Chorus — instruments and foh_team set
 * manually in Sanity Studio are never overwritten.
 *
 * Usage:
 *   npx tsx scripts/import-schedule.ts [options]
 *
 * Options:
 *   --json-path <path>     Path to history JSON  (default: worship_schedule_history.json)
 *   --start-date YYYY-MM-DD  First Sunday of the schedule (overrides the value in the JSON)
 *   --dry-run              Print mutations without sending them
 *
 * Required env vars (loaded from .env.local automatically):
 *   NEXT_PUBLIC_SANITY_PROJECT_ID
 *   NEXT_PUBLIC_SANITY_DATASET        (default: production)
 *   SANITY_WRITE_TOKEN
 *   NEXT_PUBLIC_SANITY_API_VERSION    (default: 2024-01-01)
 */

import fs from "fs";
import path from "path";

// ─── Load .env.local ────────────────────────────────────────────────────────

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

// ─── CLI args ────────────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const jsonPath = getArg("--json-path") ?? path.resolve("/Users/frankrocha/Documents/OWT/OWT_Code/worship_schedule_history.json");
const startDateArg = getArg("--start-date");
const dryRun = hasFlag("--dry-run");

// ─── Types ───────────────────────────────────────────────────────────────────

interface Assignment {
  week: number;
  service: "Sunday" | "Saturday";
  role: "Sun.Lead" | "Sat.Lead" | "Sun.BGV" | "Sat.BGV" | "Sun.Choir";
  person: string;
}

interface HistoryRun {
  saved_at: string;
  start_date?: string | null;
  weeks: number;
  weekends_w_sat: number[];
  assignments: Assignment[];
}

interface SanityMember {
  _id: string;
  member_name: string;
  alias?: string;
}

type Mutation =
  | { createIfNotExists: Record<string, unknown> }
  | { patch: { id: string; set: Record<string, unknown> } };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Sanity credentials ──────────────────────────────────────────────────
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "ebb8vcnk";
  const dataset   = process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production";
  const token     = process.env.SANITY_WRITE_TOKEN;
  const apiVer    = process.env.NEXT_PUBLIC_SANITY_API_VERSION ?? "2024-01-01";

  if (!token && !dryRun) {
    console.error("Missing SANITY_WRITE_TOKEN. Add it to .env.local:\n  SANITY_WRITE_TOKEN=sk-...");
    process.exit(1);
  }

  // ── Read history JSON ───────────────────────────────────────────────────
  if (!fs.existsSync(jsonPath)) {
    console.error(`History file not found: ${jsonPath}`);
    process.exit(1);
  }
  const history = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const runs: HistoryRun[] = history.runs ?? [];
  if (!runs.length) { console.error("No runs found in history JSON."); process.exit(1); }

  const latest = runs[runs.length - 1];
  const startDateStr = startDateArg ?? latest.start_date ?? null;

  if (!startDateStr) {
    console.error(
      "No start date found. Provide --start-date YYYY-MM-DD or save the schedule with --start-date in Python."
    );
    process.exit(1);
  }

  console.log(`Using run saved at: ${latest.saved_at}`);
  console.log(`First Sunday: ${startDateStr}`);
  console.log(`Weeks: ${latest.weeks}, Saturday weeks: [${latest.weekends_w_sat.join(", ")}]`);
  console.log(`Assignments: ${latest.assignments.length} rows`);

  // ── Fetch team members ──────────────────────────────────────────────────
  const groq = "*[_type == 'teamMembers'] { _id, member_name, alias }";
  const queryUrl = `https://${projectId}.api.sanity.io/v${apiVer}/data/query/${dataset}?query=${encodeURIComponent(groq)}`;
  const membersResp = await fetch(queryUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!membersResp.ok) {
    console.error(`Failed to fetch team members: ${membersResp.status} ${await membersResp.text()}`);
    process.exit(1);
  }
  const { result: members }: { result: SanityMember[] } = await membersResp.json();

  const nameToId = new Map<string, string>();
  for (const m of members) {
    if (m.member_name) nameToId.set(m.member_name.trim(), m._id);
    if (m.alias)       nameToId.set(m.alias.trim(), m._id);
  }
  console.log(`Loaded ${members.length} team members from Sanity.`);

  const warnings: string[] = [];
  function makeRef(name: string, key: string): Record<string, string> | null {
    const id = nameToId.get(name);
    if (!id) { warnings.push(`No Sanity member for "${name}"`); return null; }
    return { _type: "reference", _ref: id, _key: key };
  }

  // ── Group assignments ───────────────────────────────────────────────────
  type RoleMap = Map<string, string[]>;
  type ServiceMap = Map<"Sunday" | "Saturday", RoleMap>;
  const byWeek = new Map<number, ServiceMap>();

  for (const row of latest.assignments) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, new Map());
    const svc = byWeek.get(row.week)!;
    if (!svc.has(row.service)) svc.set(row.service, new Map());
    const roles = svc.get(row.service)!;
    if (!roles.has(row.role)) roles.set(row.role, []);
    roles.get(row.role)!.push(row.person);
  }

  // ── Build mutations ─────────────────────────────────────────────────────
  const mutations: Mutation[] = [];
  const startDate = new Date(startDateStr + "T00:00:00Z");

  for (let weekNum = 1; weekNum <= latest.weeks; weekNum++) {
    const sunDate = addDays(startDate, (weekNum - 1) * 7);
    const satDate = addDays(sunDate, -1);

    const sunData = byWeek.get(weekNum)?.get("Sunday");
    const satData = byWeek.get(weekNum)?.get("Saturday");

    // Sunday role
    if (sunData) {
      const docId   = `sunday-role-${toDateStr(sunDate)}`;
      const leads   = (sunData.get("Sun.Lead")  ?? []).map((n, i) => makeRef(n, `l${i}`)).filter(Boolean);
      const bgvs    = (sunData.get("Sun.BGV")   ?? []).map((n, i) => makeRef(n, `b${i}`)).filter(Boolean);
      const chorus  = (sunData.get("Sun.Choir") ?? []).map((n, i) => makeRef(n, `c${i}`)).filter(Boolean);

      mutations.push({ createIfNotExists: { _id: docId, _type: "sunday_role", week: toISO(sunDate) } });
      mutations.push({ patch: { id: docId, set: { week: toISO(sunDate), Lead: leads, BGVs: bgvs, Chorus: chorus } } });
    }

    // Saturday role
    if (satData && latest.weekends_w_sat.includes(weekNum)) {
      const docId   = `saturday-role-${toDateStr(satDate)}`;
      const satLeads = satData.get("Sat.Lead") ?? [];
      const satBGVs  = satData.get("Sat.BGV")  ?? [];
      const leadRef  = satLeads[0] ? makeRef(satLeads[0], "lead") : null;
      const bgvs     = satBGVs.map((n, i) => makeRef(n, `b${i}`)).filter(Boolean);
      const patchSet: Record<string, unknown> = { week: toISO(satDate), BGVs: bgvs };
      if (leadRef) patchSet["Lead"] = leadRef;

      mutations.push({ createIfNotExists: { _id: docId, _type: "saturday_role", week: toISO(satDate) } });
      mutations.push({ patch: { id: docId, set: patchSet } });
    }
  }

  if (warnings.length) {
    console.warn("\nWarnings:");
    warnings.forEach((w) => console.warn(`  ⚠  ${w}`));
  }

  if (!mutations.length) { console.log("No mutations to push."); return; }

  const docCount = mutations.length / 2;
  console.log(`\nBuilt ${docCount} role document mutations.`);

  if (dryRun) {
    console.log("\n── Dry run — mutations NOT sent ──");
    console.log(JSON.stringify(mutations, null, 2));
    return;
  }

  // ── POST to Sanity ──────────────────────────────────────────────────────
  const mutateUrl = `https://${projectId}.api.sanity.io/v${apiVer}/data/mutate/${dataset}`;
  const resp = await fetch(mutateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mutations }),
  });

  if (!resp.ok) {
    console.error(`Sanity mutation failed: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }

  const data = await resp.json();
  const results: Array<{ operation: string }> = data.results ?? [];
  const created  = results.filter((r) => r.operation === "create").length;
  const patched  = results.filter((r) => r.operation === "update" || r.operation === "patch").length;
  console.log(`Done. Created: ${created}, Updated: ${patched}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
