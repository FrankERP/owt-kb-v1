"use client";
// app/components/ui/QuickActions.tsx
// What a long press opens (spec §12.8, decision L): the house sheet with one
// full-width, left-aligned ghost Button per action and «Cancelar» at the end.
//
// `CueDialog mode="sheet"` does all the work — portal, focus trap, backdrop,
// drag-to-dismiss, and rendering NOTHING while closed, which is what lets every
// row own one of these unconditionally. It is mounted with `open={open}`, never
// behind a conditional with a literal `open` (the `cueDialogMount` guard).
//
// An action either DOES something (`onSelect`) or GOES somewhere (`href`, a real
// link so a middle-click or a long-press-to-copy still behaves). Both close the
// sheet: an action that left it standing would sit on top of whatever it just did.
import Button from "./Button";
import CueDialog from "./CueDialog";

export interface QuickAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  tone?: "default" | "danger";
  icon?: React.ReactNode;
}

export default function QuickActions({
  open,
  onClose,
  title,
  subtitle,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: QuickAction[];
}) {
  const rowClass = "w-full justify-start";
  return (
    <CueDialog open={open} onDismiss={() => onClose()} mode="sheet" size="sm" title={title} label={title}>
      <div className="flex flex-col gap-1 px-3 pb-4 pt-3">
        {subtitle && (
          <p className="px-4 pb-2 font-body text-sm text-ink-dim">{subtitle}</p>
        )}
        {actions.map((a) =>
          a.href ? (
            <Button
              key={a.label}
              href={a.href}
              variant="ghost"
              size="lg"
              className={`${rowClass}${a.tone === "danger" ? " text-negative-strong" : ""}`}
              onClick={() => onClose()}
            >
              {a.icon}
              {a.label}
            </Button>
          ) : (
            <Button
              key={a.label}
              variant="ghost"
              size="lg"
              className={`${rowClass}${a.tone === "danger" ? " text-negative-strong" : ""}`}
              onClick={() => {
                a.onSelect?.();
                onClose();
              }}
            >
              {a.icon}
              {a.label}
            </Button>
          ),
        )}
        <Button variant="ghost" size="lg" className="w-full" onClick={() => onClose()}>
          Cancelar
        </Button>
      </div>
    </CueDialog>
  );
}
