"use client";

// The blocking-issue summary that sits directly under the readiness strip
// (Plan B item 7).
//
// Copy comes from `serviceIssueLines`; this only renders it. Every line carries a
// tone icon AND text, and any id-bearing string wraps with
// `[overflow-wrap:anywhere]` so a long document id cannot widen the card past a
// 320px viewport.

import { CARD_STYLE, TONE_CLASS, type ServiceIssueLine } from "./serviceCardModel";

const TONE_ICON: Record<ServiceIssueLine["tone"], string> = {
  ok: "✓",
  approved: "✓",
  warn: "!",
  error: "⚠",
  unknown: "?",
  neutral: "·",
};

export default function ServiceIssueList({
  lines,
  max = 4,
}: {
  lines: readonly ServiceIssueLine[];
  /** Extra lines collapse into a count so a broken record cannot fill the page. */
  max?: number;
}) {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, max);
  const hidden = lines.length - shown.length;
  return (
    <ul className="min-w-0 space-y-1">
      {shown.map((line) => (
        <li
          key={line.key}
          className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 ${TONE_CLASS[line.tone]}`}
        >
          <span aria-hidden="true" className="shrink-0 font-label text-[11px] leading-5">
            {TONE_ICON[line.tone]}
          </span>
          <span className={`font-body text-xs leading-5 ${CARD_STYLE.longText}`}>{line.text}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="font-body text-[11px] text-mono-500">
          y {hidden} problema{hidden === 1 ? "" : "s"} más
        </li>
      )}
    </ul>
  );
}
