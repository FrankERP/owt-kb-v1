/**
 * Run report for scripts/dev-verify.ts (spec §5) and the redaction/leak proof
 * (spec §3.3). Pure. The leak scanner is the A3 harness's own, reused so the two
 * tools can never disagree on what a leak looks like.
 */
import { scanForSecretLeak } from "../../../e2e/service-readiness/lib/bypass";

export interface BlockedMutation { method: string; url: string; phase: "signin" | "observe" }

export interface RunReport {
  origin: string;
  route: string;
  observedDeployment: string | null;
  status: number | null;
  artifacts: { screenshot?: string; text?: string; a11y?: string };
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number | null }[];
  blockedMutations: BlockedMutation[];
  pageErrors: string[];
  exitCode: 0 | 2 | 3 | 4;
  refusal?: string;
}

export function decideExitCode(
  r: Pick<RunReport, "blockedMutations" | "pageErrors" | "status" | "refusal">,
): 0 | 2 | 3 | 4 {
  if (r.refusal) return 2;
  if (r.blockedMutations.length > 0) return 3;
  if (r.pageErrors.length > 0 || (r.status !== null && r.status >= 500)) return 4;
  return 0;
}

function redactString(s: string, secrets: string[]): string {
  let out = s;
  for (const secret of secrets) {
    for (const needle of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(needle).join("[redacted]");
    }
  }
  return out;
}

function redactValue<T>(value: T, secrets: string[]): T {
  if (typeof value === "string") return redactString(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, secrets);
    return out as T;
  }
  return value;
}

export function redactReport(r: RunReport, secrets: (string | null)[]): RunReport {
  const live = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  return redactValue(r, live);
}

export function assertNoLeak(texts: { source: string; text: string }[], secrets: (string | null)[]): void {
  for (const { source, text } of texts) {
    for (const secret of secrets.length ? secrets : [null]) {
      if (scanForSecretLeak(source, text, secret).length > 0) throw new Error(`secret_leak:${source}`);
    }
  }
}

export function formatHuman(r: RunReport): string {
  const lines = [
    `dev-verify: exit ${r.exitCode} · ${r.origin}${r.route} · deployment ${r.observedDeployment ?? "unknown"} · HTTP ${r.status ?? "none"}`,
  ];
  if (r.refusal) lines.push(`refused: ${r.refusal}`);
  for (const [k, v] of Object.entries(r.artifacts)) if (v) lines.push(`${k}: ${v}`);
  for (const b of r.blockedMutations) lines.push(`blocked_mutation ${b.method} ${b.url} (${b.phase})`);
  for (const e of r.pageErrors) lines.push(`page_error ${e}`);
  for (const e of r.consoleErrors) lines.push(`console ${e}`);
  for (const f of r.failedRequests) lines.push(`failed ${f.method} ${f.url} → ${f.status ?? "no response"}`);
  return lines.join("\n");
}
