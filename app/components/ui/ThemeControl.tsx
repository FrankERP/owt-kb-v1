"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useThemePref } from "@/app/components/ThemeBootstrap";
import type { ThemePref } from "@/app/utils/themePref";

const OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "dark", label: "Oscuro" },
  { value: "light", label: "Claro" },
];

/**
 * The member's theme choice.
 *
 * THREE STATES, NOT TWO. Dark, Light, and "has never chosen" — the last renders
 * with NEITHER button pressed. That is not a cosmetic nicety: an unset `themePref`
 * is the signal Child F's staged rollout reads, there is no route that can return
 * the field to unset, and `TextSizeControl` (the shape precedent) initialises to a
 * concrete default. Following it here would write "dark" the moment someone opened
 * /me and quietly remove them from F's cohort forever.
 *
 * It binds to the LITERAL `themePref` from ThemeBootstrap's context, never to
 * `resolvedTheme` — which is "dark" for an explicit-Dark member and an unset one
 * alike, and would therefore make the third state unrepresentable.
 */
export default function ThemeControl() {
  const { pref, loaded, setPref } = useThemePref();
  const { setTheme } = useTheme();
  const { data } = useSession();
  const [saving, setSaving] = useState<ThemePref | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hidden while impersonating rather than rendering a button that always 403s.
  // The mutation-handler invariant requires a failure be surfaced, and a red toast
  // on every impersonated toggle is a worse outcome than not offering the control.
  const isImpersonating = Boolean(
    (data?.user as { isImpersonating?: boolean } | undefined)?.isImpersonating,
  );
  if (isImpersonating) return null;

  async function choose(next: ThemePref) {
    if (saving) return;
    setSaving(next);
    setError(null);
    try {
      // WRITE FIRST, PAINT SECOND — the order is not a style preference. An
      // optimistic setTheme whose PATCH then failed would leave localStorage on
      // "light" while `themePref` stayed unset, and ThemeBootstrap's unset guard
      // (required, so an unset member is never overridden) means no later load
      // could correct it. The member would be stuck in a theme they never
      // persisted. The cost of this order is one round-trip before the repaint.
      const res = await fetch("/api/me/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
      if (!res.ok) {
        setError("No se pudo guardar tu preferencia. Inténtalo de nuevo.");
        return;
      }
      setPref(next);
      setTheme(next);
    } catch {
      setError("No se pudo guardar tu preferencia. Inténtalo de nuevo.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-2xl border border-surface-accent-20 p-5">
      <h3 className="font-display text-lg font-bold mb-1">Tema</h3>
      <p className="font-body text-sm text-mono-500 dark:text-mono-400 mb-4">
        Tu elección te sigue en todos tus dispositivos.
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          // `loaded` distinguishes "not fetched yet" from "never chosen": before
          // the projection lands, `pref` is undefined for everyone, and neither
          // button should look selected.
          const active = loaded && pref === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => void choose(o.value)}
              aria-pressed={active}
              disabled={saving !== null}
              className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-colors disabled:opacity-60 ${
                active
                  ? "border-accent text-accent bg-accent/10"
                  : "border-surface-accent-l25-d20 text-mono-500 dark:text-mono-400 hover:border-accent/50 dark:hover:border-surface-accent-l25-d20"
              }`}
            >
              {saving === o.value ? "Guardando…" : o.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="font-body text-sm mt-3 text-negative-fg">
          {error}
        </p>
      )}
    </section>
  );
}
