// The head of a section in Planear Jóvenes: an icon on a tinted tile, the section's name in the
// display face, a line under it saying what the section holds, and its actions on the right
// (ADR-0086). Two sections that each opened with one small-caps label read as one table; a head
// with its own shape is what tells «Rol del sábado» from «Calendario de grupos» while scrolling.
//
// NEUTRAL — no hooks.
export default function SectionHead({
  id,
  icon,
  title,
  note,
  children,
}: {
  /** The heading's id, for the section's `aria-labelledby`. */
  id: string;
  icon: React.ReactNode;
  title: string;
  note: string;
  /** The section's actions. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/[0.12] text-accent">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="font-display text-[28px] font-semibold leading-none text-ink md:text-[34px]">
            {title}
          </h2>
          <p className="mt-1.5 font-body text-[14px] leading-snug text-ink-dim">{note}</p>
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
