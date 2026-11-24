"use client";
// A search box drawn as a hairline with a glass (ADR-0070): the filter drawer's
// chip clouds and the Miembros list share it. `type="search"` brings the
// browser's own clear control, so it never carries a second «×»; 16 px on a
// phone, so WebKit does not zoom the page on focus (`inputFontSize.test.ts`);
// `size={1}` lowers the input's intrinsic width floor so whatever sits beside
// it on the line survives a 320 px screen. Biblioteca's page-level search
// (`LibraryIndex`) keeps its own taller spelling.
export default function SearchLine({
  label,
  value,
  onChange,
  placeholder = label,
  className = "",
}: {
  /** The accessible name; also the placeholder unless one is given. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 items-center gap-2.5 border-b border-ink/[0.10] text-ink-dim focus-within:text-ink-muted ${className}`}>
      <svg className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.5" y2="16.5" />
      </svg>
      <input
        type="search"
        size={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent py-2.5 font-body text-[16px] text-ink placeholder:text-ink-dim focus:outline-none sm:text-sm"
      />
    </label>
  );
}
