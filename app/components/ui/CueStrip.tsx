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

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Presence from "@/app/components/ui/Presence";
import { cueLabel, type Cue } from "@/app/utils/cue";

/** Same shape as `NavMenu`'s badge cache: `{ c: payload, t: written-at }`. */
export const CUE_KEY = "owt_cue";
const CUE_TTL = 60 * 1000;

/** The routes whose own header already shows the countdown. */
const SILENT_ROUTES = new Set(["/", "/me"]);

let inflight: Promise<Cue | null> | null = null;

function loadCue(): Promise<Cue | null> {
  inflight ??= fetch("/api/cue")
    .then((r) => (r.ok ? r.json() : { cue: null }))
    .then(({ cue }: { cue?: Cue | null }) => {
      const next = cue ?? null;
      try {
        sessionStorage.setItem(CUE_KEY, JSON.stringify({ c: next, t: Date.now() }));
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
  const authed = !!session?.user;
  const silent = SILENT_ROUTES.has(pathname ?? "");
  // The LABEL is the state, not the cue: it is built from "today", and computing
  // a clock value during render is impure.
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!authed || silent) { setLabel(""); return; }
    let cancelled = false;
    const paint = (cue: Cue | null) => {
      if (cancelled) return;
      const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
      setLabel(cue ? cueLabel(cue, today) : "");
    };

    try {
      const raw = sessionStorage.getItem(CUE_KEY);
      if (raw) {
        const { c, t } = JSON.parse(raw) as { c: Cue | null; t: number };
        if (Date.now() - t < CUE_TTL) { paint(c); return; }
      }
    } catch { /* ignore */ }

    loadCue().then(paint);
    return () => { cancelled = true; };
  }, [authed, silent]);

  return (
    <Presence show={!!label} variant="fade">
      {/* `aria-live="off"`: it is ambient context, never an announcement. */}
      <p
        aria-live="off"
        className="font-label text-[10px] lg:text-[11px] uppercase tracking-[0.22em] text-ink-dim"
      >
        {label}
      </p>
    </Presence>
  );
}
