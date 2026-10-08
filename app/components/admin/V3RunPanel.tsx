"use client";

// Solver v3 C6 NT-1 and KH-3 — the run line, the stage summary, and «Ver etapas»: every stage with
// «probado» / «no probado» / «no ejecutado», then the run's rule reference table (wire id, kind,
// config ordinal — name-free by construction) as one copyable block headed by its `request_id`.
// The table is shown here and nowhere else; it is never sent, logged or stored.

import { useId, useState } from "react";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import { V3_LINES } from "./v3Copy";
import type { V3RunReport } from "./v3RunReport";

export default function V3RunPanel({ report, ruleTable }: { report: V3RunReport; requestId: string; ruleTable: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div data-v3-run="" className="space-y-1">
      <p className="font-body text-xs text-ink-muted">{report.runLine}</p>
      {report.stageSummary.map((line, i) => (
        <p key={i} className="font-body text-xs text-warning-strong">{line}</p>
      ))}
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {V3_LINES.seeStages}
      </Button>
      <Collapse open={open} id={id}>
        <ul className="space-y-0.5 pt-1">
          {report.stageDetail.map((s, i) => (
            <li key={i} className="font-body text-xs text-ink-muted">{s.label}: {s.status}</li>
          ))}
        </ul>
        <p className="pt-2 font-label text-[10px] uppercase tracking-widest text-mono-500">{V3_LINES.ruleTableTitle}</p>
        <pre data-v3-rule-table="" className="max-w-full overflow-x-auto rounded border border-accent/15 p-2 font-mono text-[11px] text-ink-muted">
          {ruleTable}
        </pre>
      </Collapse>
    </div>
  );
}
