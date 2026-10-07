// scripts/lib/reconstructPlanFile.ts
//
// R15 and R18's plan file (solver v3 C4): the canonical serialization, the digests
// of the inputs the run read, the fingerprint the consent attaches to, and the
// backups' bytes. Deterministic (R17): object keys in codepoint order, every list
// already sorted by the code that built it, the generation time outside the
// fingerprint. A fingerprint or a digest is never a record hash (R2): a record's
// `contentHash` is C2's alone, computed through `reconstructDecide.ts`.

import { createHash } from "node:crypto";

import { normalizeMinistries } from "../../app/ministries";
import { countsForFairness } from "../../app/utils/countsForFairness";
import type { LedgerService } from "../../app/utils/fairnessLedger";
import { compareCodepoint, type TabKey } from "../../app/utils/fairnessVocabulary";
import type { Anomaly, Correction, MonthAction, ReconstructionBody, RollbackAction, RosterRow } from "./reconstructTypes";

export const PLAN_KIND = "owt-fairness-reconstruction-plan";
export const PLAN_VERSION = 1;

/** JSON with object keys in codepoint order at every level; `undefined` members dropped; arrays kept as built. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareCodepoint);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** The same content indented for a human reader — still deterministic. */
export function canonicalPretty(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const hashText = (text: string): string => `sha256:${sha256Hex(text)}`;

/** A backup's bytes (R18): the stored document exactly as read, canonical and indented. */
export function backupText(doc: Record<string, unknown>): string {
  return canonicalPretty(doc);
}

/**
 * R15's service-input digest: every role document read inside the join and preview
 * windows, projected to `_id`, `_type`, stored date, effective «cuenta» flag (C1) and
 * the voice seat references in stored order, sorted by `_id`. No `_rev`, `_updatedAt`,
 * `published`, `time`, instrument or FOH seat: publishing a draft or touching an
 * instrument changes nothing (R17).
 */
export function serviceInputDigest(services: readonly LedgerService[]): string {
  const rows = [...services]
    .sort((a, b) => compareCodepoint(a._id, b._id))
    .map((s) => ({
      _id: s._id,
      _type: s._type,
      date: s.date,
      counted: countsForFairness(s),
      Lead: s.Lead,
      BGVs: s.BGVs,
      Chorus: s.Chorus,
    }));
  return hashText(canonicalJson(rows));
}

/**
 * The member-input digest — a plan decision beyond R15's list, so R15's acceptance
 * («one `unavailableDates` entry inside a requested or preview month makes --apply
 * refuse») holds for a preview-only month too: each worship member's id, names,
 * Tipo, ministries and stored `unavailableDates` inside the run's months.
 */
export function memberInputDigest(roster: readonly RosterRow[], months: readonly string[]): string {
  const inMonths = new Set(months);
  const rows = [...roster]
    .sort((a, b) => compareCodepoint(a._id, b._id))
    .map((m) => ({
      _id: m._id,
      member_name: m.member_name ?? null,
      alias: m.alias ?? null,
      memberType: [...(m.memberType ?? [])].sort(compareCodepoint),
      ministries: normalizeMinistries(m.ministries),
      unavailableDates: [
        ...new Set(
          (m.unavailableDates ?? [])
            .map((d) => (typeof d === "string" ? d.slice(0, 10) : ""))
            .filter((d) => inMonths.has(d.slice(0, 7))),
        ),
      ].sort(compareCodepoint),
    }));
  return hashText(canonicalJson(rows));
}

export interface WriteMonthPlan {
  month: string;
  action: MonthAction;
  /** The full planned body (null only for «sin servicios guardados»). */
  body: ReconstructionBody | null;
  bodyHash: string | null;
  corrections: Correction[];
  existing: { id: string; rev: string; source: string; contentHash: string } | null;
  /** «reemplazar» only (R18): the backup beside this plan, and its bytes' hash. */
  backup: { file: string; hash: string } | null;
}

export interface WritePlanContent {
  mode: "write";
  inputs: { months: string[]; previewRun: string; overridesHash: string };
  months: WriteMonthPlan[];
  anomalies: Anomaly[];
  preview: {
    run: string;
    sources: Array<{ month: string; from: "planned" | "stored" | "none" }>;
    /** member id → tab → hundredths: the figures Frank reviewed (R15). */
    figures: Record<string, Partial<Record<TabKey, { share: number; received: number; balance: number }>>>;
  };
  serviceDigest: string;
  memberDigest: string;
}

export interface RollbackMonthPlan {
  month: string;
  action: RollbackAction;
  stored: { id: string; rev: string; source: string; contentHash: string; recomputedHash: string } | null;
  backup: { file: string; hash: string } | null;
}

export interface RollbackPlanContent {
  mode: "rollback";
  inputs: { months: string[] };
  months: RollbackMonthPlan[];
}

export type PlanContent = WritePlanContent | RollbackPlanContent;

export interface PlanFile {
  kind: typeof PLAN_KIND;
  version: typeof PLAN_VERSION;
  /** Printed, never hashed (R17). */
  generatedAt: string;
  fingerprint: string;
  content: PlanContent;
}

/** The fingerprint the consent attaches to (R15, R18): SHA-256 of the canonical content. */
export function fingerprintOf(content: PlanContent): string {
  return sha256Hex(canonicalJson(content));
}

export function serializePlan(content: PlanContent, generatedAt: string): string {
  const file: PlanFile = { kind: PLAN_KIND, version: PLAN_VERSION, generatedAt, fingerprint: fingerprintOf(content), content };
  return canonicalPretty(file);
}

export function parsePlanFile(text: string): { ok: true; plan: PlanFile } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "el plan no es JSON válido" };
  }
  const file = raw as Partial<PlanFile> | null;
  if (
    !file ||
    typeof file !== "object" ||
    file.kind !== PLAN_KIND ||
    file.version !== PLAN_VERSION ||
    typeof file.fingerprint !== "string" ||
    !file.content ||
    typeof file.content !== "object"
  ) {
    return { ok: false, reason: "no es un plan de esta herramienta" };
  }
  if (fingerprintOf(file.content) !== file.fingerprint) {
    return { ok: false, reason: "el plan cambió después de escribirse: su huella no coincide con su contenido" };
  }
  return { ok: true, plan: file as PlanFile };
}

/** Where re-derived content differs from the plan (R15, R18) — name-free paths only. */
export function planDifferences(planned: PlanContent, live: PlanContent): string[] {
  const a = planned as unknown as Record<string, unknown>;
  const b = live as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareCodepoint)) {
    const left = a[key];
    const right = b[key];
    if (key === "months" && Array.isArray(left) && Array.isArray(right)) {
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        if (canonicalJson(left[i] ?? null) === canonicalJson(right[i] ?? null)) continue;
        const month = (left[i] as { month?: string } | undefined)?.month ?? (right[i] as { month?: string } | undefined)?.month ?? "?";
        out.push(`months[${i}] (${month})`);
      }
    } else if (canonicalJson(left ?? null) !== canonicalJson(right ?? null)) {
      out.push(key);
    }
  }
  return out;
}
