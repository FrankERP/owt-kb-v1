// A person on a meeting as a face: two initials in a circle, the house rule (`initialsOf`, as the
// worship team block and the nav menu draw them). «Tú» takes the app's one green ring; a seat
// with nobody is a dashed, empty circle, so an unfilled seat is seen before it is read.
//
// NEUTRAL — no hooks.
import { initialsOf } from "../../utils/teamSections";

const SIZE = { sm: "h-6 w-6 text-[9px]", md: "h-9 w-9 text-[11px]" } as const;

export default function PersonAvatar({
  name,
  mine = false,
  size = "md",
  className = "",
}: {
  name: string | null;
  mine?: boolean;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const look = mine
    ? "border-2 border-positive-fg bg-positive-fg/10 text-positive-fg"
    : name
      ? "border border-ink/10 bg-surface-raised text-ink"
      : "border border-dashed border-ink/25 text-ink-dim";
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-label ${SIZE[size]} ${look} ${className}`}>
      {name ? initialsOf(name) : ""}
    </span>
  );
}
