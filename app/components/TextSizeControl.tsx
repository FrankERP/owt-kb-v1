"use client";

import { useEffect, useState } from "react";
import { PRESETS, TextScaleMode, applyScale, getStoredMode, setStoredMode } from "@/app/utils/textZoom";

/**
 * Segmented text-size control. Persists the choice device-locally and applies it
 * immediately. "Automático" follows the device accessibility setting on native.
 */
export default function TextSizeControl() {
  const [mode, setMode] = useState<TextScaleMode>("auto");

  // Initialise from storage after mount (localStorage is client-only).
  useEffect(() => { setMode(getStoredMode()); }, []);

  function choose(next: TextScaleMode) {
    setMode(next);
    setStoredMode(next);
    applyScale(next);
  }

  return (
    <section className="rounded-2xl border border-surface-accent-20 p-5">
      <h3 className="font-display text-lg font-bold mb-1">Tamaño de texto</h3>
      <p className="font-body text-sm text-mono-500 dark:text-mono-400 mb-4">
        &quot;Automático&quot; sigue el ajuste de tu dispositivo. Elige un tamaño fijo para anularlo.
      </p>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = p.mode === mode;
          return (
            <button
              key={p.mode}
              type="button"
              onClick={() => choose(p.mode)}
              aria-pressed={active}
              className={`font-label text-xs uppercase tracking-widest px-4 py-2 rounded-full border transition-colors ${
                active
                  ? "border-accent text-accent bg-accent/10"
                  : "border-surface-accent-l25-d20 text-mono-500 dark:text-mono-400 hover:border-accent/50 dark:hover:border-surface-accent-l25-d20"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="font-body text-base mt-4 text-mono-600 dark:text-ink-muted/70">
        Texto de ejemplo — así se verá el contenido de la app.
      </p>
    </section>
  );
}
