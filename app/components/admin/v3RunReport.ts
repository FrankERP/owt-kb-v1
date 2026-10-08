// app/components/admin/v3RunReport.ts
//
// Solver v3 C6 NT-1, NT-2 — everything a v3 success says, rendered from codes through `v3Copy.ts`.
// C6's own notices (the builder's) precede these (NT-3); v2's «Sin optimizar», «Equidad relajada» and
// «Historial» lines never render on a v3 run (NT-5: the caller passes no v2 diagnostics).

import {
  V3_CEILING_UNPROVEN, V3_LINES, V3_NOT_RUN_TAIL, V3_STAGE_REASON_LINE, V3_UNPROVEN_EXPLANATION,
  missedLine, noPossibleLeadNotice, noticeLine, stageLabel, stageStatusLabel, violationLine, type V3Names,
} from "./v3Copy";
import type { V3SolveRequest, V3Success } from "./v3Wire";

export function v3Names(input: {
  members: ReadonlyArray<{ _id: string; member_name: string; alias?: string }>;
  serviceLabels: ReadonlyMap<string, string>;
  ruleLabels: ReadonlyMap<string, string>;
}): V3Names {
  return {
    person: (id) => {
      const m = input.members.find((x) => x._id === id);
      return m ? (m.alias?.trim() || m.member_name) : "alguien que ya no está en la lista";
    },
    rule: (id) => input.ruleLabels.get(id) ?? V3_LINES.recordedPresenceLabel,
    service: (id) => input.serviceLabels.get(id) ?? "servicio",
  };
}

export interface V3RunReport {
  runLine: string;
  stageSummary: string[];
  stageDetail: Array<{ label: string; status: string }>;
  solverNotices: string[];
}

export function buildV3RunReport(input: {
  response: V3Success;
  request: V3SolveRequest;
  storedServiceIds: ReadonlySet<string>;
  names: V3Names;
}): V3RunReport {
  const { response, names } = input;
  const runLine = V3_LINES.runLine(input.request.months, input.request.services.length, input.storedServiceIds.size);

  const notProven = response.stages.filter((s) => s.status !== "proven");
  const stageSummary: string[] = notProven.length === 0
    ? [V3_LINES.allProven]
    : notProven.map((s) => V3_LINES.stageNotProven(stageLabel(s.id, names), stageStatusLabel(s.status)));
  if (notProven.some((s) => s.status === "unproven")) stageSummary.push(V3_UNPROVEN_EXPLANATION);
  const reasons = [...new Set(notProven.filter((s) => s.status === "not_run" && s.reason).map((s) => s.reason!))];
  if (notProven.some((s) => s.status === "not_run")) {
    stageSummary.push(...reasons.map(V3_STAGE_REASON_LINE), V3_NOT_RUN_TAIL);
  }
  const stageDetail = response.stages.map((s) => ({ label: stageLabel(s.id, names), status: stageStatusLabel(s.status) }));

  const solverNotices = [
    ...response.missed.map((m) => missedLine(m, names)),
    ...response.notices.map((n) => noticeLine(n.code, n.params, names)),
    ...response.unfilled.filter((u) => u.reason === "no_possible_lead").map((u) => noPossibleLeadNotice(names.service(u.service))),
    ...response.violations.map((v) => violationLine(v, names)),
    ...(response.violations.length > 0 && !response.violation_ceiling.proven ? [V3_CEILING_UNPROVEN] : []),
  ];
  return { runLine, stageSummary, stageDetail, solverNotices };
}
