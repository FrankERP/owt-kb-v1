"use client";

import { useEffect, useState } from "react";

/**
 * The Spanish announcement for the theme rollout (parent Q2's bounded default:
 * an in-app banner on `/me`, drafted at Child F).
 *
 * It ships in F2, WITH the flip — never before it. Its copy promises that the app
 * follows the device, which is false until `enableSystem` is true and the default
 * has moved, and `/me` is exactly where members go, so a banner living there is
 * not "inert unless they visit".
 *
 * IT WRITES NOTHING TO SANITY. Dismissal is a client-side flag only. Nothing here
 * touches `themePref`, so reading or dismissing this banner cannot remove a member
 * from the never-chosen population — the same property Child E protected, for the
 * same reason.
 */

const DISMISSED_KEY = "owt-theme-announced";

export default function ThemeAnnouncement() {
  // Start hidden and reveal after the mount check, so the banner never flashes
  // for a member who dismissed it on a previous visit.
  const [show, setShow] = useState(false);

  useEffect(() => {
    // A throw resolves to "not dismissed" — showing the banner twice is a far
    // better failure than breaking the page, and this file follows the same
    // fail-soft rule as every other localStorage access in this programme.
    try {
      if (!localStorage.getItem(DISMISSED_KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* non-fatal — they will see it again, which is the acceptable failure */
    }
  }

  if (!show) return null;

  return (
    <aside
      className="rounded-2xl border border-surface-accent-30 bg-surface-accent-faint p-4 mb-4 flex items-start gap-3"
      aria-label="Novedad: tema de la aplicación"
    >
      <p className="font-body text-sm text-ink flex-1">
        <strong className="font-display font-bold">Ahora puedes elegir el tema.</strong>{" "}
        La app sigue el modo claro u oscuro de tu teléfono. ¿Prefieres uno fijo?{" "}
        <a href="#tema" className="underline text-accent hover:no-underline">
          Elígelo aquí
        </a>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Descartar aviso"
        className="font-label text-xs uppercase tracking-widest text-mono-500 hover:text-ink transition-colors shrink-0"
      >
        Ocultar
      </button>
    </aside>
  );
}
