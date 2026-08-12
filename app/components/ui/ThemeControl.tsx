"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useThemePref } from "@/app/components/ThemeBootstrap";
import type { ThemePref } from "@/app/utils/themePref";

const OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "system", label: "Seguir sistema" },
  { value: "dark", label: "Oscuro" },
  { value: "light", label: "Claro" },
];

/**
 * The member's theme choice.
 *
 * THREE OPTIONS, AND UNSET RENDERS AS "SEGUIR SISTEMA".
 *
 * Child E deliberately rendered unset as NEITHER button pressed, because showing a
 * concrete default would have invited a member to "confirm" it and burn the unset
 * signal F's rollout depended on. **Child F inverts that on purpose.** Once the
 * default IS follow-the-system, unset and "system" mean the same thing, so showing
 * Seguir sistema as selected is honest rather than misleading — and there is no
 * longer a cohort to protect. A reviewer who read E's rules will flag this as a
 * regression; it is the opposite.
 *
 * Still true, and still load-bearing: this control must not WRITE on mount. A
 * member who has never chosen keeps an unset field until they tap something.
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
      // "light" while `themePref` stayed unset — and ThemeBootstrap only calls
      // setTheme for a value the projection actually returned, so no later load
      // would correct it. The member would be stuck in a theme they never
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
    <section id="tema" className="rounded-2xl border border-surface-accent-20 p-5">
      <h3 id="tema-h" className="font-display text-lg font-bold mb-1">Tema</h3>
      <p className="font-body text-sm text-mono-500 dark:text-mono-400 mb-4">
        Por defecto la app sigue el modo de tu teléfono. Tu elección te sigue en
        todos tus dispositivos.
      </p>
      {/* A radiogroup, not three toggles. `aria-pressed` on mutually exclusive
          buttons reads to a screen reader as three unrelated switches; radio
          semantics say "one of these three", which is what this is. */}
      <div role="radiogroup" aria-labelledby="tema-h" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          // `loaded` distinguishes "not fetched yet" from "never chosen": before
          // the projection lands, `pref` is undefined for everyone, and neither
          // button should look selected.
          // `loaded` still gates everything: before the projection lands, nothing
          // is selected. "Not known yet" is not "follows the system".
          // Unset resolves to the system option, which is what the default now is.
          const active = loaded && (pref ?? "system") === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => void choose(o.value)}
              // Not `disabled`: disabling the pressed control during the
              // round-trip drops it out of the a11y tree mid-interaction. Busy
              // + a guard in `choose()` gives the same protection.
              aria-busy={saving === o.value}
              className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-colors ${
                saving === o.value ? "opacity-60" : ""
              } ${
                active
                  ? "border-accent text-accent bg-accent/10"
                  : "border-surface-accent-l25-d20 text-mono-500 dark:text-mono-400 hover:border-accent/50 dark:hover:border-surface-accent-l25-d20"
              }`}
            >
              {o.label}
              {saving === o.value && (
                <span className="sr-only"> — guardando</span>
              )}
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
