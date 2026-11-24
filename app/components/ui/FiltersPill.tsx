"use client";
// The round «Filtros» pill that opens a filter sheet (ADR-0070's Biblioteca
// pass; Miembros since the Admin pass). ONE spelling of the sliders glyph and
// the armed count: `disclosure`, not `pill` — it opens a dialog, so it must not
// carry `aria-pressed` (see `Button`'s note on the variant).
import Button from "./Button";

export default function FiltersPill({
  count,
  open,
  onClick,
  className = "",
}: {
  /** Active filters; the label reads «Filtros · N» when > 0 and the pill is armed. */
  count: number;
  /** Whether the sheet it controls is open (`aria-expanded`). */
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="disclosure"
      size="lg"
      active={count > 0}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
      className={`shrink-0 gap-2 ${className}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h12M20 18h0" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </svg>
      Filtros{count > 0 ? ` · ${count}` : ""}
    </Button>
  );
}
