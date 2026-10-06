// The eligibility-record writer behind `PUT /api/admin/fairness/months` (solver v3 C2
// WR-1 … WR-13) — the domain body ADR-0043 moves out of the route. The route keeps only
// authorization and the JSON parse; everything after lives here and returns a
// `CommitOutcome` whose `body`/`status` the route sends as-is.
//
// It issues NO mutation of its own: it validates the PUT body, stamps the request from the
// server's own state (the effective engine, the deployment's environment, the CDMX
// month, the clock and the session's effective member id) and hands every month to THE
// write executor (`executeFairnessMonthWrites`, `fairnessMonthWriteRequest.ts`) with
// actor `route` and the canonical clients — `operationalClient` (published, no CDN,
// carrying the read token; the executor refuses any other) and `writeClient`. It is a
// registered protected writer (`PROTECTED_RUNTIME_WRITERS`, through the audit's executor
// rule), a delivery-capable import (`DELIVERY_CAPABLE_IMPORTS`) — so the route wraps its
// handler in `withVerificationRunContext`, harmlessly: nothing here delivers — and its
// one caller is pinned by `serviceCommitCallers.test.ts`.
//
// No side effects (WR-13): no notification, no outbox, no `after()`, and no
// `revalidate*` — no ISR page reads `fairnessMonth`; the panel re-reads the GET.
// The route can never select the reconstruction actor, and nothing here deletes.

import "server-only";

import { operationalClient } from "@/sanity/lib/operationalClient";
import { writeClient } from "@/sanity/lib/serverClient";
import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import type { CommitOutcome } from "./commitOutcome";
import {
  executeFairnessMonthWrites,
  validateFairnessMonthWrite,
  type FairnessExecution,
  type FairnessIssue,
} from "./fairnessMonthWriteRequest";
import {
  FAIRNESS_PUT_REFUSALS,
  isMonthString,
  shiftMonth,
  type FairnessMonthWrite,
  type FairnessMonthsPutConflictDetails,
  type FairnessMonthsPutOk,
  type FairnessPutRefusal,
} from "./fairnessVocabulary";
import { serviceError } from "./serviceMutation";
import { fairnessRecordEnvironment, resolveSolverEngine } from "./solverDeployment";

export interface FairnessCommitEffects {
  months: Array<{ month: string; outcome: "created" | "replaced" | "unchanged" }>;
}

/**
 * The shared error model's code for each refusal (WR-12: the plan's choice). The three
 * «your view is stale — re-read» refusals reuse `stale_revision`; everything that is the
 * state of the world refusing the write is `integrity_conflict` (WR-5's three are
 * mandated). Every one is a 409 with `conflict: true`; clients branch on `details.detail`.
 */
const REFUSAL_ERROR: Readonly<Record<FairnessPutRefusal, "stale_revision" | "integrity_conflict">> = {
  record_exists: "stale_revision",
  record_missing: "stale_revision",
  stale_revision: "stale_revision",
  month_has_services: "integrity_conflict",
  past_month: "integrity_conflict",
  engine_not_v3: "integrity_conflict",
  member_unknown: "integrity_conflict",
  member_not_worship: "integrity_conflict",
  tipo_mismatch: "integrity_conflict",
};

const isPutRefusal = (v: unknown): v is FairnessPutRefusal =>
  typeof v === "string" && (FAIRNESS_PUT_REFUSALS as readonly string[]).includes(v);

function invalid(issues: FairnessIssue[]): CommitOutcome<FairnessCommitEffects> {
  const res = serviceError("invalid_request", { details: { issues } });
  return { ok: false, status: res.status, body: res.body };
}

function conflict(details: FairnessMonthsPutConflictDetails): CommitOutcome<FairnessCommitEffects> {
  const res = serviceError(REFUSAL_ERROR[details.detail], { details: { ...details } });
  return { ok: false, status: res.status, body: res.body };
}

/** WR-3: `{ months: [1–2 entries] }`, consecutive and ascending; each entry by IF2-18. */
function validatePut(
  body: unknown,
  currentMonth: string,
): { ok: true; months: FairnessMonthWrite[] } | { ok: false; issues: FairnessIssue[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, issues: [{ path: "", message: "must be an object" }] };
  }
  const issues: FairnessIssue[] = [];
  for (const key of Object.keys(body)) if (key !== "months") issues.push({ path: key, message: "unknown field" });
  const months = (body as { months?: unknown }).months;
  if (!Array.isArray(months) || months.length < 1 || months.length > 2) {
    issues.push({ path: "months", message: "must hold 1 or 2 months" });
    return { ok: false, issues };
  }
  months.forEach((entry, i) => {
    const checked = validateFairnessMonthWrite(entry, "route", currentMonth);
    if (!checked.ok) {
      for (const issue of checked.issues) {
        issues.push({ path: issue.path ? `months[${i}].${issue.path}` : `months[${i}]`, message: issue.message });
      }
    }
  });
  const [first, second] = months as Array<{ month?: unknown }>;
  if (second && isMonthString(first?.month) && isMonthString(second.month) && second.month !== shiftMonth(first.month, 1)) {
    issues.push({ path: "months[1].month", message: "must be the month after months[0].month" });
  }
  return issues.length ? { ok: false, issues } : { ok: true, months: months as FairnessMonthWrite[] };
}

/** IF2-5 `details.months[].verdict`: each month's own decision or refusal. */
function ownVerdicts(results: FairnessExecution[]): FairnessMonthsPutConflictDetails["months"] {
  return results.map((r) => {
    const own = r.ownVerdict;
    const verdict = own === "create" || own === "replace" || own === "unchanged" ? own : isPutRefusal(own) ? own : "stale_revision";
    return { month: r.month, verdict };
  });
}

export async function commitFairnessMonths(
  body: unknown,
  actor: { recordedBy: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): Promise<CommitOutcome<FairnessCommitEffects>> {
  // WR-6 — the engine gate, before the body is looked at and before any read.
  const engine = resolveSolverEngine(env);
  if (engine !== "v3") return conflict({ detail: "engine_not_v3", months: [] });

  const currentMonth = serviceTodayIso(now).slice(0, 7);
  const checked = validatePut(body, currentMonth);
  if (!checked.ok) return invalid(checked.issues);

  const results = await executeFairnessMonthWrites({
    clients: { read: operationalClient, write: writeClient },
    actor: "route",
    op: "write",
    months: checked.months,
    stamps: {
      recordedBy: actor.recordedBy,
      now: now.toISOString(),
      currentMonth,
      environment: fairnessRecordEnvironment(env),
      engine,
    },
  });

  // The executor re-runs IF2-18; a body this module accepted cannot fail it, but if one
  // ever did, it is a 400 like any other invalid body.
  const bodyIssues = results.flatMap((r, i) =>
    typeof r.verdict === "object" && r.verdict.refused === "invalid_body"
      ? (r.verdict.issues ?? []).map((issue) => ({ path: `months[${i}].${issue.path}`, message: issue.message }))
      : [],
  );
  if (results.some((r) => typeof r.verdict === "object" && r.verdict.refused === "invalid_body")) return invalid(bodyIssues);

  if (results.every((r) => typeof r.verdict === "string")) {
    const ok: FairnessMonthsPutOk = {
      months: results.map((r) => ({
        month: r.month,
        outcome: r.verdict as "created" | "replaced" | "unchanged",
        rev: r.rev ?? "",
        contentHash: r.contentHash ?? "",
        recordedAt: r.recordedAt ?? "",
      })),
    };
    return {
      ok: true,
      status: 200,
      body: ok as unknown as Record<string, unknown>,
      effects: { months: ok.months.map(({ month, outcome }) => ({ month, outcome })) },
    };
  }

  // A refusal: nothing was written (WR-9). `detail` is the EARLIEST month's own refusal
  // (entries are ascending); a commit conflict carries one mapped verdict on every
  // written month, so the earliest written month's is the same.
  const first = results.find((r) => isPutRefusal(r.ownVerdict))!;
  const detail = first.ownVerdict as FairnessPutRefusal;
  const details: FairnessMonthsPutConflictDetails = { detail, months: ownVerdicts(results) };
  if (first.cause) details.cause = first.cause;
  if (detail === "record_exists" && first.current) {
    details.rev = first.current.rev;
    details.source = first.current.source as FairnessMonthsPutConflictDetails["source"];
    if (first.current.recordedAt) details.recordedAt = first.current.recordedAt;
  }
  if (first.memberIds) details.memberIds = first.memberIds;
  return conflict(details);
}
