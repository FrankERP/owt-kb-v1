"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import { useThemePref } from "@/app/components/ThemeBootstrap";
import type { ThemePref } from "@/app/utils/themePref";
import SegmentedControl from "@/app/components/ui/SegmentedControl";

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
      {/* A radiogroup, not three toggles — SegmentedControl owns the semantics.
          `loaded` still gates everything: before the projection lands nothing is
          selected (`value={null}`). "Not known yet" is not "follows the system". */}
      <SegmentedControl
        labelledBy="tema-h"
        value={loaded ? (pref ?? "system") : null}
        onChange={(v) => void choose(v)}
        options={OPTIONS.map((o) => ({ value: o.value, label: o.label, busy: saving === o.value }))}
      />
      {error && (
        <p role="alert" className="font-body text-sm mt-3 text-negative-fg">
          {error}
        </p>
      )}
    </section>
  );
}
