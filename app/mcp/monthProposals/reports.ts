// What `solve_month` says (D14, D15): the browser's report, re-used through the same functions
// and copy, as Spanish text plus `structuredContent`. Nothing is composed from a rule key, a
// member id or a service id (key hygiene): people by alias or name (`V3Names`), services by the
// planner's own label, seats by the grid row's label.

import { TABS } from "@/app/components/admin/fairnessPreviewModel";
import { describePreflightReason } from "@/app/components/admin/serviceCardModel";
import { saldoWords } from "@/app/utils/fairnessFormat";
import { dayLabel } from "@/app/components/admin/plannerModel";
import { V3_CONNECTOR_LINES as L } from "@/app/components/admin/v3Copy";
import type { V3MonthPlan } from "@/app/utils/v3MonthPlan";
import { draftLabel } from "./labels";

const TIME_ZONE = "America/Mexico_City";

/** An instant as «27 de octubre, 15:04» in CDMX, whatever the process zone. */
export function expiryLabel(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-MX", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
  const time = d.toLocaleTimeString("es-MX", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${date}, ${time}`;
}

export interface SolveReport {
  text: string;
  structured: Record<string, unknown>;
}

export function solveReport(
  plan: V3MonthPlan,
  stored: { handle: string; expiresAt: string } | { failed: true } | { nothingToCreate: true },
): SolveReport {
  const person = plan.names.person;
  const rowLabel = (rowId: string) => plan.rows.find((r) => r.id === rowId)?.label ?? rowId;
  const columnLabel = new Map(plan.columns.map((c) => [c.columnId, draftLabel({ _type: c.type, date: c.date, service_name: c.serviceName })]));

  const services = plan.drafts.map(({ draft, atSolve }) => ({
    service: draftLabel(draft),
    planned: atSolve === "creatable",
    seats: {
      Lead: draft.leads.map(person),
      BGV: draft.bgvs.map(person),
      Coro: draft.chorus.map(person),
      instrumentos: draft.instruments.map((s) => `${s.instrument}: ${person(s.personId)}`),
      FOH: draft.foh.map((s) => `${s.role}: ${person(s.personId)}`),
    },
  }));
  const serviceLines = services.map((s) => {
    const parts = Object.entries(s.seats)
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k} ${v.join(", ")}`);
    return `${s.service}: ${parts.length ? parts.join(" · ") : "sin asignaciones"}`;
  });

  const unfilled = plan.unfilled.map((u) => ({ service: columnLabel.get(u.columnId) ?? "servicio", seat: rowLabel(u.rowId) }));
  const leftOut = plan.leftOut.map((l) => ({
    service: draftLabel({ _type: l.type, date: l.date, service_name: l.serviceName }),
    reasons: l.reasons.map(describePreflightReason),
  }));
  const refusedSpecials = plan.refusedSpecials.map((r) => ({ date: r.date, name: r.name, reason: r.reason }));
  const unavailability = plan.unavailability.map((u) => ({ name: u.name, date: u.date, service: u.service }));

  const fairness = plan.response.fairness.people.map((p) => ({
    name: person(p.person),
    tabs: TABS.flatMap(({ key, label }) => {
      const f = p.tabs[key];
      return f ? [{ tab: label, enEstePlan: f.seats, queda: saldoWords(f.tenths.after) }] : [];
    }),
  })).filter((p) => p.tabs.length > 0);

  const head =
    "handle" in stored ? [L.handle(stored.handle, expiryLabel(stored.expiresAt))]
      : "failed" in stored ? [L.storeFailed]
        : [L.nothingToCreate];
  const text = [
    ...head,
    plan.report.runLine,
    ...plan.report.stageSummary,
    ...plan.notices,
    "Servicios:",
    ...serviceLines,
    ...(unfilled.length ? ["Lugares sin cubrir:", ...unfilled.map((u) => L.unfilled(u.service, u.seat))] : []),
    ...refusedSpecials.map((r) => L.refusedSpecial(r.date, r.reason)),
    ...leftOut.map((l) => L.leftOut(l.service, l.reasons.join(", "))),
    ...unavailability.map((u) => L.unavailable(u.name, `${u.service} ${dayLabel(u.date)}`)),
    ...(fairness.length ? ["Equidad:", ...fairness.map((p) => L.fairness(p.name, p.tabs.map((t) => L.fairnessTab(t.tab, t.enEstePlan, t.queda))))] : []),
  ].join("\n");

  return {
    text,
    structured: {
      ok: true,
      proposal: "handle" in stored ? stored.handle : null,
      expiresAt: "handle" in stored ? stored.expiresAt : null,
      stored: "handle" in stored,
      months: plan.months,
      runLine: plan.report.runLine,
      stages: plan.report.stageSummary,
      notices: plan.notices,
      services,
      unfilled,
      refusedSpecials,
      leftOut,
      unavailability,
      fairness,
    },
  };
}
