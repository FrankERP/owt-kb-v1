// The lyric block's two typographic rules (R6, spec §19.5 rows "Lyrics block",
// decision P). NEUTRAL module — no `"use client"`, no hooks, nothing but React —
// so the song page (a Server Component) may CALL it directly (ADR-0028).
//
// `LYRIC_EYEBROW` styles EXISTING section headings (the `h2` a lyric sheet
// already carries, ChordChart's `# ` label). It never ADDS a label: decision N
// caps the label budget, and a lyric sheet that grew an eyebrow per verse would
// spend it all here.
//
// `dimRepeatMarkers` walks strings only. The PortableText `normal` block hands
// its children as a top-level string, or an array of strings and `<strong>`/`<em>`
// elements; a `//` INSIDE one of those marks stays undimmed, which is accepted —
// recursing into arbitrary element children would rewrite nodes this module does
// not own.

import { Children, isValidElement, type ReactNode } from "react";

export const LYRIC_EYEBROW = "font-label text-[11px] uppercase tracking-[0.24em] text-accent/80";

// `text-ink-dim` at FULL alpha, not the 70% modifier the plan sketched: the
// marker is text, and `lightContrast.test.ts` measured that modified pair at
// 3.60:1 in dark, under the 4.5 floor. (Naming it here as a class string would
// trip the same guard — it scans raw source, comments included.) The role
// already reads dimmer than the lyric body, which is the whole effect.
const MARK = "//";

export function dimRepeatMarkers(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    if (!node.includes(MARK)) return node;
    return node.split(MARK).flatMap((part, i) =>
      i === 0
        ? [part]
        : [
            <span key={`m${i}`} className="text-ink-dim" aria-label="repetir">
              {MARK}
            </span>,
            part,
          ],
    );
  }
  if (Array.isArray(node)) return Children.map(node, (child) => dimRepeatMarkers(child));
  if (isValidElement(node)) return node;
  return node;
}
