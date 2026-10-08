"use client";

// Solver v3 C6 CF-10 — leaving the planner after a partial confirm failure asks first. `open` is a
// state prop, never a literal (cueDialogMount.test.ts); «Seguir aquí» and every dismissal keep the
// planner open, «Salir así» leaves the gaps for «Editar mes».

import Button from "@/app/components/ui/Button";
import CueDialog from "@/app/components/ui/CueDialog";
import { V3_LINES } from "./v3Copy";

export default function V3IncompleteDialog({ open, gaps, onLeave, onStay }: {
  open: boolean;
  gaps: ReadonlyArray<{ month: string; missing: number }>;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <CueDialog open={open} title={V3_LINES.incompleteTitle} onDismiss={() => onStay()} size="sm">
      <p className="font-body text-sm text-ink-muted">{V3_LINES.incompleteBody(gaps)}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onStay}>{V3_LINES.stay}</Button>
        <Button variant="danger" onClick={onLeave}>{V3_LINES.leave}</Button>
      </div>
    </CueDialog>
  );
}
