"use client";

// A worship team member as a FACE: the photo (an uploaded one, else the Google account's), or two
// initials when there is none or it fails to load. It is the circle `TeamSections` has drawn since
// 2026-10-21, lifted out so a folded service card and an agenda row can show WHO is on a service
// as faces instead of a sentence of names (ADR-0087).
//
// Not the Jóvenes `PersonAvatar`: that one is initials only on purpose (its one reader carries no
// photos, ADR-0081) and has no state, so it stays neutral; this one needs `onError`.
//
// «Tú» takes the app's one green ring. `badge` is the seat's own glyph on the circle's corner —
// a microphone, a drum — so a row of faces says who PLAYS what before a label is read.

import Image from "next/image";
import { useState } from "react";
import { avatarSrc, initialsOf, personKey } from "@/app/utils/teamSections";

const SIZE = {
  xs: { box: "h-6 w-6", px: 24, text: "text-[9px]" },
  sm: { box: "h-7 w-7", px: 28, text: "text-[10px]" },
  md: { box: "h-9 w-9", px: 36, text: "text-[11px]" },
  lg: { box: "h-11 w-11", px: 44, text: "text-[13px]" },
} as const;

export type FaceSize = keyof typeof SIZE;

export default function Face({
  name,
  photo,
  me = false,
  dashed = false,
  size = "md",
  badge,
  className = "",
}: {
  name: string;
  photo?: string | null;
  me?: boolean;
  /** «Tú» with no photo yet: the ring is dashed, an invitation to add one. */
  dashed?: boolean;
  size?: FaceSize;
  /** The seat's glyph, drawn on the corner. */
  badge?: React.ReactNode;
  className?: string;
}) {
  // A photo that fails to load (a revoked Google URL, a deleted asset) falls back to
  // initials rather than a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const s = SIZE[size];
  const ring = me ? (dashed ? "border-2 border-dashed border-positive-fg" : "border-2 border-positive-fg") : "border border-ink/10";
  return (
    <span aria-hidden className={`relative inline-flex shrink-0 ${className}`}>
      <span className={`flex ${s.box} items-center justify-center overflow-hidden rounded-full bg-surface-raised ${ring}`}>
        {photo && !failed ? (
          // unoptimized: the original JPEG/PNG, never Next's WebP — the iOS WKWebView
          // fails to decode it (same reason as `MeHeader`'s avatar).
          <Image src={avatarSrc(photo)} alt="" width={s.px} height={s.px} unoptimized loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <span className={`font-label ${s.text} ${me ? "text-positive-fg" : "text-ink"}`}>{initialsOf(name)}</span>
        )}
      </span>
      {badge && (
        <span className={`absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-ink/[0.14] bg-surface-base ${me ? "text-positive-fg" : "text-ink-muted"}`}>
          {badge}
        </span>
      )}
    </span>
  );
}

/**
 * Several faces overlapped — «who is on it» at a glance on a folded card. At most `max` faces,
 * then «+N»; each one scales in a beat after the last (`animate-scale-in`, delayed by its index on top of
 * the card's own stagger), and reduced motion collapses that through the one global rule.
 */
export function FaceStack({
  names,
  photos,
  myName = "",
  max = 5,
  size = "sm",
  className = "",
}: {
  names: string[];
  photos?: Record<string, string>;
  /** `myNameFromSession`'s lowercased display name. */
  myName?: string;
  max?: number;
  size?: FaceSize;
  className?: string;
}) {
  // One face per person: someone who sings and plays is one face here.
  const people = [...new Map(names.filter(Boolean).map((n) => [personKey(n), n])).values()];
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  const s = SIZE[size];
  return (
    <span aria-hidden className={`inline-flex items-center ${className}`}>
      <span className="flex -space-x-2">
        {shown.map((name, i) => (
          <span key={personKey(name)} className="animate-scale-in rounded-full ring-2 ring-surface-card" style={{ animationDelay: `calc(var(--reveal-i, 0) * 40ms + ${160 + i * 45}ms)` }}>
            <Face name={name} photo={photos?.[personKey(name)]} me={!!myName && personKey(name) === myName} size={size} />
          </span>
        ))}
        {more > 0 && (
          <span className={`flex ${s.box} items-center justify-center rounded-full border border-ink/10 bg-surface-raised font-label ${s.text} text-ink-muted ring-2 ring-surface-card`}>
            +{more}
          </span>
        )}
      </span>
    </span>
  );
}
