// A meeting's publication state in the planner: a dot and a word, the way a Servicios card says
// it (`ServiceReadinessCard`). Until 2026-11-10 only a draft said anything, in an amber chip that
// outweighed the meeting's own date; saying «Publicada» too means a row never leaves the reader
// guessing whether the pastors already see it. The draft's dot is hollow so the two states differ
// by shape as well as by colour.
//
// NEUTRAL — no hooks.
export default function MeetingState({ published }: { published: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-body text-[13px] ${published ? "text-positive-strong" : "text-warning-strong"}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${published ? "bg-positive-fg" : "border border-warning-fg"}`} />
      {published ? "Publicada" : "Borrador"}
    </span>
  );
}
