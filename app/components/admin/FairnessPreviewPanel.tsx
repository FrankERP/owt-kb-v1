"use client";

// The «Equidad · vista previa» panel (solver v3 C2 UI-1 … UI-7): a READ-ONLY preview of
// the fairness ledger for the month being viewed, mounted beside «sin Lead en …»
// (`LeadPoolHistoryPanel`) at the planner's config step and in the stored editor. It
// changes nothing Auto reads, sends, solves or writes, and a failure of its read never
// blocks Auto or a save.
//
// A closed `Collapse` disclosure that loads on FIRST open — no read for an admin who never
// opens it, and nothing in any other suite's `fetch` count. Every figure is the GET's
// tenths through the one formatter (A17); every string is in `fairnessPreviewModel.ts`.
//
// «Registrar elegibilidad de {mes}» (UI-6) is its one write: offered only when the GET's
// effective engine is v3 (so never in production while the constant is v2) and the
// month is between the current one and 12 months ahead; replaced by a line when the
// month's record binds (WR-8 row 7 would refuse it). It builds the body with the
// resolver from the on-screen state, sends `source: "manual"` and asserts the record
// revision the panel READ (WR-15); on any 409 it re-reads the GET — content and
// revision together — before a retry is possible, and the dialog stays open on every
// refusal.

import { useId, useMemo, useState } from "react";

import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import CueDialog from "@/app/components/ui/CueDialog";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import {
  RECORD_LIMITS,
  monthIndex,
  type FairnessLedgerResponse,
  type FairnessPerson,
  type TabKey,
} from "@/app/utils/fairnessVocabulary";
import { useTransientValue } from "@/app/utils/useTransientValue";
import {
  COPY,
  REGISTRAR,
  TABS,
  cadenceLine,
  chipText,
  onScreenCountedSundays,
  refusalMessage,
  resolverLines,
  tabRows,
  windowSpan,
  monthYear,
  type PreviewRow,
} from "./fairnessPreviewModel";
import type { SolverConfig } from "./plannerModel";
import type { SolverEngine } from "./solverEngine";
import { ledgerDiagnosticsLines, planCells, type EquidadPlan } from "./v3Equidad";
import { V3_LINES } from "./v3Copy";

export const FAIRNESS_ENDPOINT = "/api/admin/fairness";
export const FAIRNESS_MONTHS_ENDPOINT = "/api/admin/fairness/months";

type Load = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; data: FairnessLedgerResponse };

export interface FairnessPreviewPanelProps {
  /** The month being viewed, `YYYY-MM`. Mount with `key={month}` so a new month starts closed. */
  month: string;
  /** The on-screen rule set, unsaved edits included. */
  config: SolverConfig;
  /** The planner's member list as-is (a super-admin's includes kids-only members; RES-5 filters). */
  members: EligibilityMember[];
  /** The month's stored services, with the effective `countsForFairness` the roles GET projects. */
  storedServices: ReadonlyArray<{ _type: string; date: string; countsForFairness?: boolean }>;
  /** Whether the on-screen rules differ from the saved ones. */
  rulesDirty: boolean;
  /**
   * The server-resolved engine (solver v3 C6 EQ-2). The banner shows exactly when it is "v2"; under
   * "v3" the two plan columns appear. Every mount passes it (`engineProp.test.ts`); the literal
   * default serves C2's own tests only.
   */
  engine?: SolverEngine;
  /** C6 EQ-3/EQ-4: the last v3 run of this horizon; `null` before any run (the plan columns read «—»). */
  plan?: EquidadPlan | null;
}

function FiguresTable({ rows, total, sinceLabel, plan, tab }: {
  rows: PreviewRow[]; total: boolean; sinceLabel: string;
  /** C6: present (possibly `null`) only under v3 — then the two plan columns render. */
  plan?: EquidadPlan | null; tab: TabKey;
}) {
  const showPlan = plan !== undefined;
  return (
    <>
      {/* Desktop: never widens the page — its own horizontal scroller (ADR-0035). */}
      <div className="hidden md:block overflow-x-auto" data-fairness-table="">
        <table className="w-full font-body text-xs text-ink-muted">
          <thead>
            <tr className="font-label text-[10px] uppercase tracking-widest text-mono-500 text-left">
              <th className="py-1 pr-3">{COPY.columns.persona}</th>
              <th className="py-1 pr-3">{COPY.columns.leTocaba}</th>
              <th className="py-1 pr-3">{COPY.columns.tuvo}</th>
              <th className="py-1 pr-3">{COPY.columns.saldo}</th>
              <th className="py-1 pr-3">{COPY.columns.desde(sinceLabel)}</th>
              {showPlan && <th className="py-1 pr-3">{V3_LINES.colEnEstePlan}</th>}
              {showPlan && <th className="py-1 pr-3">{V3_LINES.colQueda}</th>}
              {total && <th className="py-1 pr-3">{COPY.columns.canto}</th>}
              <th className="py-1">{COPY.columns.motivo}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t border-accent/10 align-top">
                <td className="py-1 pr-3">{r.name}</td>
                <td className="py-1 pr-3 tabular-nums">{r.leTocaba}</td>
                <td className="py-1 pr-3 tabular-nums">{r.tuvo}</td>
                <td className="py-1 pr-3">{r.saldo}</td>
                <td className="py-1 pr-3">{r.desde}</td>
                {showPlan && <td className="py-1 pr-3 tabular-nums">{planCells(plan, r.memberId, tab).enEstePlan}</td>}
                {showPlan && <td className="py-1 pr-3">{planCells(plan, r.memberId, tab).queda}</td>}
                {total && <td className="py-1 pr-3 tabular-nums">{r.canto}</td>}
                <td className="py-1 text-mono-500">{r.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone: one card per person. */}
      <ul className="md:hidden space-y-2" data-fairness-cards="">
        {rows.map((r) => (
          <li key={r.memberId} className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-2 font-body text-xs text-ink-muted">
            <p className="font-label text-[11px] uppercase tracking-widest">{r.name}</p>
            <p>
              {COPY.columns.leTocaba} {r.leTocaba} · {COPY.columns.tuvo} {r.tuvo} · {r.saldo}
              {total && ` · ${COPY.columns.canto} ${r.canto}`}
            </p>
            <p className="text-mono-500">
              {COPY.columns.desde(sinceLabel)}: {r.desde}
            </p>
            {showPlan && (
              <p className="text-mono-500">
                {V3_LINES.colEnEstePlan} {planCells(plan, r.memberId, tab).enEstePlan} · {V3_LINES.colQueda} {planCells(plan, r.memberId, tab).queda}
              </p>
            )}
            {r.motivo && <p className="text-mono-500">{r.motivo}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function FairnessPreviewPanel(props: FairnessPreviewPanelProps) {
  const { month } = props;
  const bodyId = useId();
  const outId = useId();
  const [open, setOpen] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("DL");
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [reading, setReading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [success, showSuccess] = useTransientValue<string | null>(null, 3000);

  // A re-read keeps the figures on screen until the new ones arrive (a refused
  // «Registrar» re-reads while its dialog is open).
  const read = async () => {
    setReading(true);
    setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const res = await fetch(`${FAIRNESS_ENDPOINT}?month=${month}&horizon=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(`fairness read ${res.status}`);
      setLoad({ status: "ready", data: (await res.json()) as FairnessLedgerResponse });
    } catch {
      setLoad({ status: "error" });
    } finally {
      setReading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && load.status === "idle") void read();
  };

  // The resolver over the on-screen state: X1's eligibility when the month's record does
  // not bind (CAD-2).
  const resolved = useMemo(
    () => resolveMonthEligibility({ month, config: props.config, members: props.members }),
    [month, props.config, props.members],
  );
  const countedSundays = useMemo(() => onScreenCountedSundays(month, props.storedServices), [month, props.storedServices]);

  const data = load.status === "ready" ? load.data : null;
  const engine = props.engine ?? "v2";
  const extraMotivo = (person: FairnessPerson) => {
    // C6 EQ-4: after a v3 run of this horizon, the row's reason (cadence from RQ-4's values) is the run's.
    if (engine === "v3" && props.plan) return props.plan.reason(person.memberId, tab);
    if (!data || tab !== "DL") return "";
    const live = props.members.find((m) => m._id === person.memberId)?.unavailableDates ?? [];
    return (
      cadenceLine({ person, response: data, month, resolved, countedSundays, liveUnavailable: live.map((d) => d.slice(0, 10)) }) ?? ""
    );
  };
  const { rows, out } = data ? tabRows(data, tab, extraMotivo) : { rows: [], out: [] };
  const sinceLabel = data?.recordsSince ? monthYear(data.recordsSince) : "—";

  // UI-6 — «Registrar»: v3 only, and only for a month the record writer accepts.
  const horizon = data?.horizon.find((h) => h.month === month) ?? null;
  const registrable =
    data !== null &&
    data.engine === "v3" &&
    monthIndex(month) >= monthIndex(data.currentMonth) &&
    monthIndex(month) <= monthIndex(data.currentMonth) + RECORD_LIMITS.monthsAhead;

  const confirm = async () => {
    if (!resolved.ok || !data) return;
    setSaving(true);
    setRefusal(null);
    try {
      const res = await fetch(FAIRNESS_MONTHS_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: [{ ...resolved.body, source: "manual", expectedRev: horizon?.record?.rev ?? null }] }),
      });
      if (res.ok) {
        setDialogOpen(false);
        showSuccess(REGISTRAR.success);
        await read();
        return;
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      setRefusal(refusalMessage(month, body));
      // WR-15: never retry on the revision just refused — re-read content and rev together.
      if (res.status === 409) await read();
    } catch {
      setRefusal(REGISTRAR.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-3 space-y-2" data-fairness-preview="">
      <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        {COPY.disclosure}
      </Button>
      <Collapse id={bodyId} open={open} className="space-y-3">
        {engine === "v2" && (
          <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">{COPY.banner}</p>
        )}
        {engine === "v3" && data && ledgerDiagnosticsLines(data.diagnostics).map((line) => (
          <p key={line} className="font-body text-xs text-warning-strong">{line}</p>
        ))}
        {load.status === "loading" && (
          <SkeletonGroup label={COPY.loading} className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" rounded="lg" />
          </SkeletonGroup>
        )}
        {load.status === "error" && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="font-body text-xs text-negative-fg mr-auto">
              {COPY.error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void read()}>
              {COPY.retry}
            </Button>
          </div>
        )}
        {data && (
          <>
            <p className="font-body text-xs text-mono-500">{COPY.subheader(windowSpan(data.window))}</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Meses">
              {data.window.map((w) => (
                <li
                  key={w.month}
                  className="font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent/25 text-mono-500"
                >
                  {chipText(w)}
                </li>
              ))}
            </ul>
            {data.recordsSince === null && <p className="font-body text-xs text-mono-500">{COPY.empty}</p>}
            <SegmentedControl
              label="Línea"
              size="sm"
              value={tab}
              onChange={setTab}
              options={TABS.map((t) => ({ value: t.key, label: t.label }))}
            />
            <FiguresTable rows={rows} total={tab === "TOTAL"} sinceLabel={sinceLabel} tab={tab} {...(engine === "v3" ? { plan: props.plan ?? null } : {})} />
            {out.length > 0 && (
              <div className="space-y-1">
                <Button variant="ghost" size="sm" onClick={() => setOutOpen((v) => !v)} aria-expanded={outOpen} aria-controls={outId}>
                  {COPY.outGroup(out.length)}
                </Button>
                <Collapse id={outId} open={outOpen}>
                  <FiguresTable rows={out} total={tab === "TOTAL"} sinceLabel={sinceLabel} tab={tab} {...(engine === "v3" ? { plan: props.plan ?? null } : {})} />
                </Collapse>
              </div>
            )}
            <p className="font-body text-[11px] text-mono-500">{tab === "TOTAL" ? COPY.totalFooter : COPY.footer}</p>
            {registrable &&
              (horizon?.recordBinds ? (
                <p className="font-body text-xs text-mono-500">{REGISTRAR.monthHasServices(month)}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRefusal(null);
                      setDialogOpen(true);
                    }}
                  >
                    {REGISTRAR.button(month)}
                  </Button>
                </div>
              ))}
            {success && <span className="font-body text-xs text-accent">{success}</span>}
          </>
        )}
      </Collapse>
      <CueDialog
        open={dialogOpen}
        title={REGISTRAR.button(month)}
        onDismiss={() => {
          if (!saving) setDialogOpen(false);
        }}
      >
        <div className="space-y-2 font-body text-sm text-ink-muted">
          <p>{REGISTRAR.body(month)}</p>
          {!resolved.ok &&
            resolverLines(month, resolved).map((line) => (
              <p key={line} role="alert" className="text-negative-fg">
                {line}
              </p>
            ))}
          {props.rulesDirty && <p>{REGISTRAR.unsaved}</p>}
          {horizon?.record ? (
            <p>{REGISTRAR.replace(horizon.record.recordedAt)}</p>
          ) : horizon && horizon.storedServices > 0 ? (
            <p>{REGISTRAR.frozenCreate(month)}</p>
          ) : null}
          {data && data.environment !== "production" && <p>{REGISTRAR.devEnvironment(data.environment)}</p>}
          {refusal && (
            <p role="alert" className="text-negative-fg">
              {refusal}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDialogOpen(false)}>
              {REGISTRAR.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              busy={saving}
              disabled={!resolved.ok || saving || reading || load.status !== "ready"}
              onClick={() => void confirm()}
            >
              {REGISTRAR.confirm}
            </Button>
          </div>
        </div>
      </CueDialog>
    </section>
  );
}
