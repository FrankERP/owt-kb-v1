"use client";

import { useEffect, useState } from "react";
import { PRESETS, TextScaleMode, applyScale, getStoredMode, setStoredMode } from "@/app/utils/textZoom";
import SegmentedControl from "@/app/components/ui/SegmentedControl";

/**
 * Segmented text-size control. Persists the choice device-locally and applies it
 * immediately. "Automático" follows the device accessibility setting on native.
 */
export default function TextSizeControl({ bare = false }: { bare?: boolean } = {}) {
  const [mode, setMode] = useState<TextScaleMode>("auto");

  // Initialise from storage after mount (localStorage is client-only).
  useEffect(() => { setMode(getStoredMode()); }, []);

  function choose(next: TextScaleMode) {
    setMode(next);
    setStoredMode(next);
    applyScale(next);
  }

  return (
    <section className={bare ? "" : "rounded-2xl border border-surface-accent-20 p-5"}>
      <h3 className={`font-display text-lg font-bold ${bare ? "" : "mb-1"}`}>Tamaño de texto</h3>
      <p className="font-body text-sm text-mono-500 dark:text-mono-400 mb-4">
        &quot;Automático&quot; sigue el ajuste de tu dispositivo. Elige un tamaño fijo para anularlo.
      </p>
      <SegmentedControl
        label="Tamaño de texto"
        value={mode}
        onChange={choose}
        options={PRESETS.map((p) => ({ value: p.mode, label: p.label }))}
      />
      <p className="font-body text-base mt-4 text-mono-600 dark:text-ink-muted/70">
        Texto de ejemplo — así se verá el contenido de la app.
      </p>
    </section>
  );
}
