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

import { useId, useMemo, useState } from "react";

import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { resolveMonthEligibility, type EligibilityMember } from "@/app/utils/fairnessEligibility";
import type { FairnessLedgerResponse, FairnessPerson, TabKey } from "@/app/utils/fairnessVocabulary";
import {
  COPY,
  TABS,
  cadenceLine,
  chipText,
  onScreenCountedSundays,
  tabRows,
  windowSpan,
  monthYear,
  type PreviewRow,
} from "./fairnessPreviewModel";
import type { SolverConfig } from "./plannerModel";

export const FAIRNESS_ENDPOINT = "/api/admin/fairness";

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
}

function FiguresTable({ rows, total, sinceLabel }: { rows: PreviewRow[]; total: boolean; sinceLabel: string }) {
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

  const read = async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch(`${FAIRNESS_ENDPOINT}?month=${month}&horizon=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(`fairness read ${res.status}`);
      setLoad({ status: "ready", data: (await res.json()) as FairnessLedgerResponse });
    } catch {
      setLoad({ status: "error" });
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
  const extraMotivo = (person: FairnessPerson) => {
    if (!data || tab !== "DL") return "";
    const live = props.members.find((m) => m._id === person.memberId)?.unavailableDates ?? [];
    return (
      cadenceLine({ person, response: data, month, resolved, countedSundays, liveUnavailable: live.map((d) => d.slice(0, 10)) }) ?? ""
    );
  };
  const { rows, out } = data ? tabRows(data, tab, extraMotivo) : { rows: [], out: [] };
  const sinceLabel = data?.recordsSince ? monthYear(data.recordsSince) : "—";

  return (
    <section className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-3 space-y-2" data-fairness-preview="">
      <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        {COPY.disclosure}
      </Button>
      <Collapse id={bodyId} open={open} className="space-y-3">
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
            <p className="font-label text-[10px] uppercase tracking-widest text-warning-strong">{COPY.banner}</p>
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
            <FiguresTable rows={rows} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
            {out.length > 0 && (
              <div className="space-y-1">
                <Button variant="ghost" size="sm" onClick={() => setOutOpen((v) => !v)} aria-expanded={outOpen} aria-controls={outId}>
                  {COPY.outGroup(out.length)}
                </Button>
                <Collapse id={outId} open={outOpen}>
                  <FiguresTable rows={out} total={tab === "TOTAL"} sinceLabel={sinceLabel} />
                </Collapse>
              </div>
            )}
            <p className="font-body text-[11px] text-mono-500">{tab === "TOTAL" ? COPY.totalFooter : COPY.footer}</p>
          </>
        )}
      </Collapse>
    </section>
  );
}
