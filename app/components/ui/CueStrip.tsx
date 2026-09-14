"use client";

// The navbar cue strip (spec §12.8): the one piece of state a member always
// wants — when the next service is — under the title on every route.
//
// Client-side, like the notification badge, so `Navbar` stays a plain sync
// component that a static/ISR page can render. Two of these mount on every page
// (the phone column and the desktop one, each hidden at the other breakpoint), so
// the in-flight request is shared: without it every load asks twice, because both
// effects run before either response can fill the cache.
//
// `/` and `/me` already carry the countdown in their own headers, so the strip
// stays silent there — and asks for nothing, rather than fetching and hiding.
//
// The wrapper below reserves the line's height (1.5× the type size, this
// font's default leading) whenever the strip is armed — not just once `label`
// paints — because `Navbar` remounts on every route change: without a
// reservation the centred title block would shift ~15px each navigation while
// the fetch (or the cached read) is in flight.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Presence from "@/app/components/ui/Presence";
import { cueLabel, type Cue } from "@/app/utils/cue";

/**
 * Same shape as `NavMenu`'s badge cache, plus `id` (the signed-in member's
 * `sanityId`): `{ c: payload, t: written-at, id: owner }`. A stale-identity
 * hit (a shared machine, an impersonation switch) is a miss, not a leak of
 * someone else's cue.
 */
export const CUE_KEY = "owt_cue";
const CUE_TTL = 60 * 1000;

/** The routes whose own header already shows the countdown. */
const SILENT_ROUTES = new Set(["/", "/me"]);

let inflight: Promise<Cue | null> | null = null;

function loadCue(id: string): Promise<Cue | null> {
  inflight ??= fetch("/api/cue")
    .then((r) => (r.ok ? r.json() : { cue: null }))
    .then(({ cue }: { cue?: Cue | null }) => {
      const next = cue ?? null;
      try {
        sessionStorage.setItem(CUE_KEY, JSON.stringify({ c: next, t: Date.now(), id }));
      } catch { /* private mode: the cache is an optimisation, not the feature */ }
      return next;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

export default function CueStrip() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const id = session?.user?.sanityId ?? null;
  const authed = !!id;
  const silent = SILENT_ROUTES.has(pathname ?? "");
  // Reserved even before the fetch resolves: `Navbar` remounts on every route
  // change, and a strip that renders nothing until `label` is set would shift
  // the centred block ~15px on each navigation.
  const reserved = authed && !silent;
  // The LABEL is the state, not the cue: it is built from "today", and computing
  // a clock value during render is impure.
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!id || silent) { setLabel(""); return; }
    let cancelled = false;
    const paint = (cue: Cue | null) => {
      if (cancelled) return;
      setLabel(cue ? cueLabel(cue, new Date()) : "");
    };

    try {
      const raw = sessionStorage.getItem(CUE_KEY);
      if (raw) {
        const { c, t, id: cachedId } = JSON.parse(raw) as { c: Cue | null; t: number; id?: string };
        if (cachedId === id && Date.now() - t < CUE_TTL) { paint(c); return; }
      }
    } catch { /* ignore */ }

    loadCue(id).then(paint);
    return () => { cancelled = true; };
  }, [id, silent]);

  if (!reserved) return null;

  // `w-full min-w-0`: under the navbar's `items-center` flex column an auto-width
  // wrapper sizes to the nowrap label's full width and `truncate` never engages —
  // a long label would clip at BOTH ends with no ellipsis.
  return (
    <div className="w-full min-w-0 min-h-[15px] lg:min-h-[16.5px]">
      <Presence show={!!label} variant="fade">
        {/* `aria-live="off"`: it is ambient context, never an announcement.
            One line, always: `truncate`/`whitespace-nowrap` like the navbar's own
            title siblings, so a long cue ("SÁBADO · EN 11 DÍAS") clips instead of
            wrapping to a second line the reserved height does not cover. The phone
            tracking is tighter for the same reason — 0.22em at 10px spent the width
            on letter spacing; the desktop line has room and keeps it. */}
        <p
          aria-live="off"
          className="w-full truncate whitespace-nowrap text-center font-label text-[10px] lg:text-[11px] uppercase tracking-[0.12em] lg:tracking-[0.22em] text-ink-dim"
        >
          {label}
        </p>
      </Presence>
    </div>
  );
}
