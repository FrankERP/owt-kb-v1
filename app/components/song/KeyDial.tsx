"use client";

// The hero key, as a control (R4 ruling 8). It is the SAME chrome the static
// badge wears (a 48 px ring, the key in the display face — ADR-0070) — a
// transposable song does not get a different-looking key, it gets a key you
// can press — plus a chevron and the press/focus affordances of a real button.
//
// The readout is the SOUNDING key, so it moves with the chart below it: this
// reads `useTransposeOptional()` and only falls back to the label the page
// passed when there is no provider (or the song carries no key at all).

import NumberRoll from "../ui/NumberRoll";
import { useTransposeOptional } from "./TransposeProvider";
import { formatKey } from "@/app/utils/formatKey";

export default function KeyDial({
  open,
  onToggle,
  controls,
  keyLabel,
}: {
  open: boolean;
  onToggle: () => void;
  /** id of the drawer this dial discloses. */
  controls: string;
  /** The song's written key — the readout when no provider is above. */
  keyLabel: string;
}) {
  const shared = useTransposeOptional();
  const soundingKey = shared?.soundingKey ?? keyLabel;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`Tonalidad ${soundingKey}. Transponer`}
      data-open={open}
      className="inline-flex min-h-[48px] select-none items-center justify-center gap-2 rounded-full border border-ink/[0.28] pl-[18px] pr-4 font-display text-2xl font-semibold text-ink transition-[transform,box-shadow] duration-fast ease-out-brand active:translate-y-px active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base data-[open=true]:shadow-[0_0_0_2px_rgb(var(--accent-rgb)/0.35)]"
    >
      <NumberRoll value={formatKey(soundingKey)} />
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`transition-transform duration-fast ease-out-brand ${open ? "rotate-180" : ""}`}
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
