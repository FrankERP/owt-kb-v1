// A meeting's publication state in the planner: a small pill with a dot and a word, the way a
// Servicios card says it (`ServiceReadinessCard`). Both states speak, so a card never leaves the
// reader guessing whether the pastors already see it; the draft's dot is hollow and its edge
// dashed, so the two differ by shape as well as by colour.
//
// NEUTRAL — no hooks.
export default function MeetingState({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] font-body text-[13px] font-semibold leading-tight ${
        published ? "border-positive-fg/30 bg-positive-fg/10 text-positive-strong" : "border-dashed border-warning-fg/50 bg-warning-fg/10 text-warning-strong"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${published ? "bg-positive-fg" : "border border-warning-fg"}`} />
      {published ? "Publicada" : "Borrador"}
    </span>
  );
}
